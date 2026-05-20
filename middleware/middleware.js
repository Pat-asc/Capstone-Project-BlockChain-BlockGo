const FabricCAServices = require('fabric-ca-client');
const express = require('express');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { Gateway, Wallets } = require('fabric-network');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
require('dotenv').config({ path: path.resolve(__dirname, '../network/.env'), override: true });
const multer = require('multer');
const { spawn } = require('child_process');
const nodemailer = require('nodemailer');
const { Worker } = require('worker_threads');
const util = require('util');
const scryptAsync = util.promisify(crypto.scrypt);

require('events').EventEmitter.defaultMaxListeners = 100;

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

setInterval(() => {
    fs.readdir(uploadDir, (err, files) => {
        if (err) return;
        const now = Date.now();
        const maxAgeMs = 2 * 60 * 60 * 1000; // 2 Hours
        
        files.forEach(file => {
            const filePath = path.join(uploadDir, file);
            fs.stat(filePath, (err, stats) => {
                if (err) return;
                if (now - stats.mtime.getTime() > maxAgeMs) {
                    fs.unlink(filePath, e => {
                        if (!e) console.log(`[Garbage Collector] Deleted orphaned upload file: ${file}`);
                    });
                }
            });
        });
    });
}, 60 * 60 * 1000); // Runs every hour

const caConfigCache = new Map();

global.userGatewayCache = global.userGatewayCache || new Map();
const userGatewayCache = global.userGatewayCache;

const parsePositiveInt = (value, fallback) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const IDLE_TIMEOUT_MS = parsePositiveInt(process.env.GATEWAY_IDLE_TIMEOUT_MS, 5 * 60 * 1000);
const GATEWAY_PRUNE_INTERVAL_MS = parsePositiveInt(process.env.GATEWAY_PRUNE_INTERVAL_MS, 60 * 1000);

const disconnectCachedGateway = (username, reason = 'stale') => {
    const cached = userGatewayCache.get(username);
    if (!cached) return;

    try {
        cached.gateway.disconnect();
    } catch (e) {
        console.warn(`[Gateway Cache] Failed to disconnect ${username}: ${e.message}`);
    }

    userGatewayCache.delete(username);
    console.log(`[Gateway Cache] Closed ${reason} gateway for ${username}`);
};

const isGatewayCacheExpired = (cached) => {
    if (!cached?.lastAccessed) return true;
    return Date.now() - cached.lastAccessed > IDLE_TIMEOUT_MS;
};

setInterval(() => {
    for (const [username, cached] of userGatewayCache.entries()) {
        if (isGatewayCacheExpired(cached)) disconnectCachedGateway(username, 'idle');
    }
}, GATEWAY_PRUNE_INTERVAL_MS);

const resolveExistingPaths = (...candidates) => {
    const seen = new Set();
    const paths = [];

    for (const candidate of candidates.filter(Boolean)) {
        const resolved = path.resolve(__dirname, candidate);
        if (fs.existsSync(resolved) && !seen.has(resolved)) {
            seen.add(resolved);
            paths.push(resolved);
        }
    }

    return paths;
};

const getFileSignature = (filePath) => {
    const stat = fs.statSync(filePath);
    return `${filePath}:${stat.mtimeMs}:${stat.size}`;
};

const getCAConfig = (role) => {
    const normalizedRole = String(role || 'registrar').toLowerCase();
    const isContainerized = fs.existsSync('/.dockerenv') || fs.existsSync('/var/run/secrets/kubernetes.io');
    let caURL, caName, adminLabel, mspId, certPaths, cacheKey;

    if (normalizedRole === 'faculty') {
        caURL = process.env.FABRIC_CA_FACULTY_URL || (isContainerized ? 'https://ca.faculty.capstone.com:7054' : 'https://localhost:8054');
        caName = 'ca-faculty';
        adminLabel = 'admin-faculty';
        mspId = 'FacultyMSP';
        certPaths = resolveExistingPaths(
            process.env.FABRIC_CA_FACULTY_CERT,
            '../network/fabric-ca/faculty/ca-cert.pem',
            '../network/crypto-config-final-v2/peerOrganizations/faculty.capstone.com/tlsca/tlsca.faculty.capstone.com-cert.pem',
            '../network/fabric-ca/faculty/tls-cert.pem'
        );
    } else if (normalizedRole === 'department_admin' || normalizedRole === 'admin' || normalizedRole === 'deptadmin' || normalizedRole === 'department' || normalizedRole === 'chairperson') {
        caURL = process.env.FABRIC_CA_DEPARTMENT_URL || (isContainerized ? 'https://ca.department.capstone.com:7054' : 'https://localhost:9054');
        caName = 'ca-department';
        adminLabel = 'admin-department';
        mspId = 'DepartmentMSP';
        certPaths = resolveExistingPaths(
            process.env.FABRIC_CA_DEPARTMENT_CERT,
            '../network/fabric-ca/department/ca-cert.pem',
            '../network/crypto-config-final-v2/peerOrganizations/department.capstone.com/tlsca/tlsca.department.capstone.com-cert.pem',
            '../network/fabric-ca/department/tls-cert.pem'
        );
    } else {
        caURL = process.env.FABRIC_CA_REGISTRAR_URL || (isContainerized ? 'https://ca.registrar.capstone.com:7054' : 'https://localhost:7054');
        caName = 'ca-registrar';
        adminLabel = 'admin-registrar';
        mspId = 'RegistrarMSP';
        certPaths = resolveExistingPaths(
            process.env.FABRIC_CA_REGISTRAR_CERT,
            '../network/fabric-ca/registrar/ca-cert.pem',
            '../network/crypto-config-final-v2/peerOrganizations/registrar.capstone.com/tlsca/tlsca.registrar.capstone.com-cert.pem',
            '../network/fabric-ca/registrar/tls-cert.pem'
        );
    }

    if (!certPaths || certPaths.length === 0) {
        if (isContainerized) {
            console.warn(`[Fabric CA] No local TLS certs found for ${role}. Disabling strict TLS verification for internal K8s cluster routing.`);
        } else {
            throw new Error(`Fabric CA trust certificate was not found for role "${role}". Run full_deploy.sh so fabric-ca/*/ca-cert.pem and tls-cert.pem are generated.`);
        }
    }

    cacheKey = `${normalizedRole}:${(certPaths || []).map(getFileSignature).join('|')}`;
    if (caConfigCache.has(cacheKey)) {
        return caConfigCache.get(cacheKey);
    }

    const tlsOptions = {
        trustedRoots: certPaths ? certPaths.map((certPath) => fs.readFileSync(certPath, 'utf8')) : [],
        verify: certPaths && certPaths.length > 0
    };

    const caClient = new FabricCAServices(caURL, tlsOptions, caName);

    console.log(`[Fabric CA TLS] ${caName} trust roots: ${certPaths.map((certPath) => path.basename(path.dirname(certPath)) + '/' + path.basename(certPath)).join(', ')}`);

    const config = { caURL, caName, adminLabel, mspId, certPaths, tlsOptions, caClient };
    caConfigCache.set(cacheKey, config);
    return config;
};

const uploadExcel = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, uploadDir),
        filename: (req, file, cb) => {
            const safeName = path.basename(file.originalname); 
            cb(null, Date.now() + '-' + safeName);
        }
    }),
    limits: { fileSize: 15 * 1024 * 1024 }, // 15MB limit
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext !== '.csv' && ext !== '.xlsx' && ext !== '.xls') {
            return cb(new Error('INVALID_FILE_TYPE'));
        }
        cb(null, true);
    }
}).single('excel');

const handleUploadMiddleware = (req, res, next) => {
    uploadExcel(req, res, (err) => {
        if (err instanceof multer.MulterError) return res.status(400).json({ error: `Upload error: ${err.message}.` });
        if (err && err.message === 'INVALID_FILE_TYPE') return res.status(400).json({ error: 'Only Excel (.xlsx, .xls) and CSV (.csv) files are allowed.' });
        if (err) return res.status(500).json({ error: `Unknown upload error: ${err.message}` });
        next();
    });
};

const rateLimit = require('express-rate-limit');

const app = express();
app.set('trust proxy', 1);
app.use(express.json());

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-api-key, x-user-identity');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

const dbRead = new Pool({
    user: process.env.POSTGRES_USER || 'postgres',
    host: process.env.POSTGRES_HOST === 'postgres' ? '127.0.0.1' : (process.env.POSTGRES_HOST || '127.0.0.1'),
    database: process.env.POSTGRES_DB || 'ActivityLogs',
    password: process.env.POSTGRES_PASS || 'password',
    port: process.env.POSTGRES_PORT || 5432,
    max: 20,
    idleTimeoutMillis: 30000
});

let mainIp = process.env.MAIN_CAMPUS_IP;
if (mainIp === 'host-gateway') mainIp = '127.0.0.1';

const dbWrite = new Pool({
    user: process.env.POSTGRES_USER || 'postgres',
    host: process.env.POSTGRES_HOST === 'postgres' ? (mainIp || '127.0.0.1') : (process.env.POSTGRES_HOST || mainIp || '127.0.0.1'),
    database: process.env.POSTGRES_DB || 'ActivityLogs',
    password: process.env.POSTGRES_PASS || 'password',
    port: process.env.POSTGRES_PORT || 5432,
    max: 20,
    idleTimeoutMillis: 30000
});

dbRead.on('error', (err, client) => {
    console.error('Unexpected error on idle PostgreSQL read client:', err);
});
dbWrite.on('error', (err, client) => {
    console.error('Unexpected error on idle PostgreSQL write client:', err);
});
async function getWallet(role = 'registrar') {
    if (!role) role = 'registrar';
    const normalizedRole = String(role).toLowerCase();
    let couchUrl;
    const user = process.env.COUCHDB_USER || 'capstone';
    const pass = process.env.COUCHDB_PASS || 'pass123';
    const host = (fs.existsSync('/.dockerenv') || fs.existsSync('/var/run/secrets/kubernetes.io')) ? 'host.docker.internal' : '127.0.0.1';

    if (normalizedRole === 'faculty') {
        couchUrl = process.env.COUCHDB_WALLET_FACULTY_URL || `http://${user}:${pass}@${host}:6990`;
    } else if (normalizedRole === 'department_admin' || normalizedRole === 'deptadmin' || normalizedRole === 'department' || normalizedRole === 'admin' || normalizedRole === 'chairperson') {
        couchUrl = process.env.COUCHDB_WALLET_DEPARTMENT_URL || `http://${user}:${pass}@${host}:7990`;
    } else {
        couchUrl = process.env.COUCHDB_WALLET_REGISTRAR_URL || process.env.COUCHDB_WALLET_URL || `http://${user}:${pass}@${host}:5990`;
    }

    if (couchUrl) {
        const walletSuffix = normalizedRole === 'faculty'
            ? 'faculty'
            : (normalizedRole === 'department_admin' || normalizedRole === 'deptadmin' || normalizedRole === 'department' || normalizedRole === 'admin' || normalizedRole === 'chairperson')
                ? 'department'
                : 'registrar';
        const walletName = `fabric_wallet_${walletSuffix}`;
        const wallet = await Wallets.newCouchDBWallet(couchUrl, walletName);
        const encryptionKey = process.env.WALLET_ENCRYPTION_KEY;
        if (encryptionKey) {
            const originalPut = wallet.put.bind(wallet);
            const originalGet = wallet.get.bind(wallet);

            wallet.put = async (label, identity) => {
                const identityToStore = {
                    ...identity,
                    credentials: { ...identity?.credentials }
                };

                if (identityToStore.credentials && identityToStore.credentials.privateKey) {
                    const salt = crypto.randomBytes(16);
                    
                    const key = await scryptAsync(encryptionKey, salt, 32);
                    const iv = crypto.randomBytes(12);
                    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
                    
                    let encrypted = cipher.update(identityToStore.credentials.privateKey, 'utf8', 'hex');
                    encrypted += cipher.final('hex');
                    const authTag = cipher.getAuthTag().toString('hex');
                    
                    identityToStore.credentials.privateKey = `ENC:${salt.toString('hex')}:${iv.toString('hex')}:${authTag}:${encrypted}`;
                }
                return originalPut(label, identityToStore);
            };

            wallet.get = async (label) => {
                const identity = await originalGet(label);
                if (identity && identity.credentials && identity.credentials.privateKey && identity.credentials.privateKey.startsWith('ENC:')) {
                    const parts = identity.credentials.privateKey.split(':');
                    let key, ivHex, authTagHex, encryptedHex;
                    
                    if (parts.length === 5) {
                        const [, saltHex, ivPart, authTagPart, encryptedPart] = parts;
                        key = await scryptAsync(encryptionKey, Buffer.from(saltHex, 'hex'), 32);
                        ivHex = ivPart;
                        authTagHex = authTagPart;
                        encryptedHex = encryptedPart;
                    } else if (parts.length === 4) {
                        const [, ivPart, authTagPart, encryptedPart] = parts;
                        key = await scryptAsync(encryptionKey, 'salt', 32);
                        ivHex = ivPart;
                        authTagHex = authTagPart;
                        encryptedHex = encryptedPart;
                    } else {
                        throw new Error("Invalid encrypted private key format");
                    }
                    
                    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
                    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
                    
                    identity.credentials.privateKey = decipher.update(encryptedHex, 'hex', 'utf8') + decipher.final('utf8');
                }
                return identity;
            };
        }
        return wallet;
    }
    const walletPath = path.resolve(__dirname, process.env.WALLET_PATH || 'wallet');
    return await Wallets.newFileSystemWallet(walletPath);
}

let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error("FATAL ERROR: JWT_SECRET environment variable is missing. Please set it in your .env file.");
    process.exit(1);
}
// Normalize to exactly 32 bytes to prevent C# ASP.NET Core HS256 minimum key size exceptions (IDX10603)
JWT_SECRET = JWT_SECRET.trim().padEnd(32, '0').substring(0, 32);

const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;
if (!INTERNAL_API_KEY) {
    console.error("FATAL ERROR: INTERNAL_API_KEY environment variable is missing. Please set it in your .env file.");
    process.exit(1);
}

const authenticateJWT = (req, res, next) => {
    if (req.headers['x-api-key'] === INTERNAL_API_KEY) {
        req.isInternal = true;
        return next();
    }

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        jwt.verify(token, JWT_SECRET, (err, user) => {
            if (err) return res.status(403).json({ error: "Invalid or expired token." });
            req.user = user;
            next();
        });
    } else {
        return res.status(401).json({ error: "Authentication required. Please provide a valid JWT or Internal API Key." });
    }
};

const authorizeRole = (allowedRoles) => {
    return (req, res, next) => {
        if (req.isInternal) return next();
        if (!req.user || !req.user.role) {
            return res.status(403).json({ error: "Access denied: No role information found in token." });
        }
        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ error: `Access denied: Your role (${req.user.role}) is not authorized for this action.` });
        }
        next();
    };
};
const requireRegistrarOrInternal = (req, res, next) => {
    if (req.headers['x-api-key'] === INTERNAL_API_KEY) {
        return next();
    }

    if (req.user && req.user.role === 'RegistrarMSP') {
        return next();
    }

    return res.status(403).json({ 
        error: "Access denied. Cryptographic operations require Registrar privileges or a valid Internal API Key." 
    });
};

const clearCacheOnError = async (username, error) => {
    if (!username || !error || !error.message) return;
    const message = error.message.toLowerCase();
    if (
        message.includes('creator is malformed') ||
        message.includes('access denied') ||
        message.includes('unavailable') ||
        message.includes('unknown') ||
        message.includes('ssl') ||
        message.includes('tls') ||
        message.includes('certificate') ||
        message.includes('cert') ||
        message.includes('handshake')
    ) {
        console.warn(`[Self-Healing] Detected stale or rejected identity for ${username}`);
        if (userGatewayCache.has(username)) {
            disconnectCachedGateway(username, 'error');
        }
        try {
            const roles = ['registrar', 'faculty', 'department_admin'];
            for (const r of roles) {
                const wallet = await getWallet(r);
                if (await wallet.get(username)) {
                    console.warn(`[Self-Healing] Wiping stale wallet identity for ${username} in ${r} wallet`);
                    await wallet.remove(username);
                }
            }
        } catch (walletErr) {
            console.error(`[Self-Healing] Failed to remove stale wallet identity: ${walletErr.message}`);
        }
    }
};

async function importCryptogenAdmins() {
    console.log("Syncing natively trusted Cryptogen Admin certificates...");
    try {
        const orgs = [
            { mspId: 'RegistrarMSP', domain: 'registrar.capstone.com', label: 'system-admin-registrar', role: 'registrar' },
            { mspId: 'FacultyMSP', domain: 'faculty.capstone.com', label: 'system-admin-faculty', role: 'faculty' },
            { mspId: 'DepartmentMSP', domain: 'department.capstone.com', label: 'system-admin-department', role: 'department_admin' }
        ];

        const cryptoBase = '../network/crypto-config-final-v2';

        for (const org of orgs) {
            try {
                const wallet = await getWallet(org.role);
                let certPath = path.resolve(__dirname, `${cryptoBase}/peerOrganizations/${org.domain}/users/Admin@${org.domain}/msp/signcerts/Admin@${org.domain}-cert.pem`);
                
                if (!fs.existsSync(certPath)) {
                    certPath = path.resolve(__dirname, `${cryptoBase}/peerOrganizations/${org.domain}/users/Admin@${org.domain}/msp/signcerts/cert.pem`);
                }

                const keyDir = path.resolve(__dirname, `${cryptoBase}/peerOrganizations/${org.domain}/users/Admin@${org.domain}/msp/keystore`);

                if (fs.existsSync(certPath) && fs.existsSync(keyDir)) {
                    const cert = fs.readFileSync(certPath, 'utf8');
                    
                    const keyFiles = fs.readdirSync(keyDir).filter(f => f.endsWith('_sk'));
                    
                    if (keyFiles.length > 0) {
                        const keyPath = path.join(keyDir, keyFiles[0]);
                        const key = fs.readFileSync(keyPath, 'utf8');

                        await wallet.put(org.label, {
                            credentials: { certificate: cert, privateKey: key },
                            mspId: org.mspId,
                            type: 'X.509'
                        });
                    } else {
                        console.warn(`[Identity Sync] No private key (_sk file) found for ${org.domain}`);
                    }
                } else {
                    console.warn(`[Identity Sync] Required files missing for ${org.domain}. Check path: ${cryptoBase}`);
                }
            } catch (orgErr) {
                console.error(`[Identity Sync] Failed to process ${org.domain}: ${orgErr.message}`);
            }
        }
        console.log("Cryptogen Admin sync complete.");
    } catch (err) {
        console.error("Critical Failure in importCryptogenAdmins:", err.message);
    }
}

async function ensureAdminEnrolled(caURL, caName, mspId, adminLabel, tlsOptions, caClient) {
    try {
        let role = 'registrar';
        if (adminLabel === 'admin-faculty') role = 'faculty';
        else if (adminLabel === 'admin-department') role = 'department_admin';
        
        const wallet = await getWallet(role);
        let identity = await wallet.get(adminLabel);
        
        // If identity exists, we should still verify if it's actually valid for the current CA
        // For now, if we get an Authentication Failure later, we know we need to re-enroll.
        // A simple way to trigger re-enrollment is to check if the admin identity is present.
        if (identity) {
            console.log(`[Identity Guard] '${adminLabel}' already in wallet.`);
            return; 
        }

        console.log(`[Identity Guard] '${adminLabel}' missing from wallet. Attempting enrollment...`);
        
        const enrollSecret = process.env.BOOTSTRAP_REGISTRAR_PASS || 'adminpw';
        
        const ca = caClient || new FabricCAServices(caURL, tlsOptions, caName);
        
        const enrollment = await ca.enroll({
            enrollmentID: 'admin',
            enrollmentSecret: enrollSecret
        });

        const x509Identity = {
            credentials: { 
                certificate: enrollment.certificate, 
                privateKey: enrollment.key.toBytes() 
            },
            mspId: mspId,
            type: 'X.509',
        };

        await wallet.put(adminLabel, x509Identity);
        
        console.log(`Successfully enrolled and encrypted '${adminLabel}'.`);
    } catch (error) {
        console.error(`[ERROR] Failed to enroll admin '${adminLabel}': ${error.message}`);
        throw error; 
    }
}

async function getContractForUser(username, roleHint) {
    if (!username) {
        throw new Error('No identity provided. Transaction requires a valid username/identity.');
    }

    if (userGatewayCache.has(username)) {
        const cached = userGatewayCache.get(username);
        if (isGatewayCacheExpired(cached)) {
            disconnectCachedGateway(username, 'expired-before-use');
        } else {
            cached.lastAccessed = Date.now();
            return { contract: cached.contract, gateway: cached.gateway };
        }
    }

    const ccpPath = path.resolve(__dirname, '..', 'network', 'connection-profile.json');
    const ccp = JSON.parse(fs.readFileSync(ccpPath, 'utf8'));
    
    let wallet = await getWallet(roleHint);
    let identity = await wallet.get(username);
    if (!identity && !roleHint) {
        const roles = ['registrar', 'faculty', 'department_admin'];
        for (const r of roles) {
            wallet = await getWallet(r);
            identity = await wallet.get(username);
            if (identity) break;
        }
    }

    if (!identity) {
        throw new Error(`Access Denied: Wallet identity for '${username}' not found. The Registrar must register this user first.`);
    }

    let clientOrgName = null;
    for (const [orgName, orgDetails] of Object.entries(ccp.organizations)) {
        if (orgDetails.mspid === identity.mspId) {
            clientOrgName = orgName;
            break;
        }
    }
    
    if (!clientOrgName) {
        throw new Error(`Organization with MSP ID "${identity.mspId}" not found in connection profile.`);
    }

    console.log(`[Ledger Gateway] Routing transaction for ${username} via organization "${clientOrgName}"`);

    if (!ccp.client) ccp.client = {};
    ccp.client.organization = clientOrgName;

    const isContainerized = fs.existsSync('/.dockerenv') || fs.existsSync('/var/run/secrets/kubernetes.io');
    // Inject full network routing to bypass broken Service Discovery on localhost
    if (!isContainerized) {
        const getPEM = (org, peer) => {
            try { return fs.readFileSync(path.resolve(__dirname, `../network/crypto-config-final-v2/peerOrganizations/${org}/peers/${peer}/tls/ca.crt`), 'utf8'); } catch(e) { return ""; }
        };
        const getOrdererPEM = () => {
            try { return fs.readFileSync(path.resolve(__dirname, `../network/crypto-config-final-v2/ordererOrganizations/capstone.com/orderers/orderer.capstone.com/tls/ca.crt`), 'utf8'); } catch(e) { return ""; }
        };

        ccp.peers = {
            ...ccp.peers,
            'peer0.registrar.capstone.com': { url: 'grpcs://localhost:7051', tlsCACerts: { pem: getPEM('registrar.capstone.com', 'peer0.registrar.capstone.com') }, grpcOptions: { 'ssl-target-name-override': 'peer0.registrar.capstone.com' } },
            'peer0.faculty.capstone.com': { url: 'grpcs://localhost:9051', tlsCACerts: { pem: getPEM('faculty.capstone.com', 'peer0.faculty.capstone.com') }, grpcOptions: { 'ssl-target-name-override': 'peer0.faculty.capstone.com' } },
            'peer0.department.capstone.com': { url: 'grpcs://localhost:11051', tlsCACerts: { pem: getPEM('department.capstone.com', 'peer0.department.capstone.com') }, grpcOptions: { 'ssl-target-name-override': 'peer0.department.capstone.com' } }
        };

        ccp.orderers = {
            ...ccp.orderers,
            'orderer.capstone.com': { url: 'grpcs://localhost:7050', tlsCACerts: { pem: getOrdererPEM() }, grpcOptions: { 'ssl-target-name-override': 'orderer.capstone.com' } }
        };

        ccp.channels = {
            [process.env.CHANNEL_NAME || 'registrar-channel']: {
                orderers: ['orderer.capstone.com'],
                peers: {
                    'peer0.registrar.capstone.com': { endorsingPeer: true, chaincodeQuery: true, ledgerQuery: true, eventSource: true },
                    'peer0.faculty.capstone.com': { endorsingPeer: true, chaincodeQuery: true, ledgerQuery: true, eventSource: true },
                    'peer0.department.capstone.com': { endorsingPeer: true, chaincodeQuery: true, ledgerQuery: true, eventSource: true }
                }
            }
        };
    }

    const grpcOptions = {
        'grpc.keepalive_time_ms': 120000,
        'grpc.keepalive_timeout_ms': 20000,
        'grpc.keepalive_permit_without_calls': 1,
        'grpc.max_send_message_length': -1,
        'grpc.max_receive_message_length': -1
    };

    if (ccp.peers) {
        for (const peer in ccp.peers) {
            ccp.peers[peer].grpcOptions = { ...ccp.peers[peer].grpcOptions, ...grpcOptions };
        }
    }
    if (ccp.orderers) {
        for (const orderer in ccp.orderers) {
            ccp.orderers[orderer].grpcOptions = { ...ccp.orderers[orderer].grpcOptions, ...grpcOptions };
        }
    }

    const gateway = new Gateway();
    await gateway.connect(ccp, {
        wallet,
        identity: username, 
        discovery: { enabled: isContainerized, asLocalhost: !isContainerized }
    });

    const network = await gateway.getNetwork(process.env.CHANNEL_NAME || 'registrar-channel');
    const contract = network.getContract(process.env.CHAINCODE_NAME || 'registrar');

    userGatewayCache.set(username, { gateway, contract, lastAccessed: Date.now() });

    return { contract, gateway }; 
}

const getCallerIdentity = (req) => {
    if (req.user && req.user.username) return req.user.username;
    
    if (req.isInternal) {
        return req.headers['x-user-identity'] || req.query.invokerId || req.body.facultyId || req.body.FacultyId || req.body.ApprovedBy || req.body.approvedBy;
    }
    throw new Error("Unauthorized caller identity access attempt.");
};  

const loginLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 5, // Limit each IP to 5 requests per windowMs
    message: { error: 'Too many login attempts from this IP, please try again after 1 minute.' },
    standardHeaders: true,
    legacyHeaders: false,
});

app.post('/api/login', loginLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;
        const normalizedUsername = (username || '').trim().toLowerCase();
        const baseUsername = normalizedUsername.split('@')[0];
        
        const userResult = await dbRead.query(`
            SELECT u.* 
            FROM Users u 
            LEFT JOIN studentprofiles sp ON u.id = sp.user_id 
            WHERE LOWER(u.email) = $1 
               OR LOWER(u.email) = $2
               OR LOWER(sp.student_no) = $1 
               OR LOWER(sp.student_no) = $2
            LIMIT 1
        `, [normalizedUsername, baseUsername]);

        if (userResult.rows.length === 0) {
            return res.status(401).json({ error: "Invalid email/student_no. or password." });
        }
        
        const userRecord = userResult.rows[0];
        const walletIdentityName = userRecord.email;
        
        if (userRecord.status === 'pending') {
            return res.status(403).json({ error: "Account pending administrative approval." });
        }

        const validPassword = await bcrypt.compare(password, userRecord.password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: "Invalid email or password." });
        }

        const wallet = await getWallet(userRecord.role);
        let identity = await wallet.get(walletIdentityName);
        
        if (!identity) {
            console.warn(`[Self-Healing] Wallet missing for ${walletIdentityName}. Attempting automatic recovery...`);
            try {
                const { caURL, caName, adminLabel, mspId, tlsOptions, caClient } = getCAConfig(userRecord.role);
                const ca = caClient;
                
                try {
                    const enrollment = await ca.enroll({
                        enrollmentID: walletIdentityName,
                        enrollmentSecret: password,
                        attr_reqs: [{ name: 'role', optional: true }, { name: 'grade.manage', optional: true }]
                    });
                    await wallet.put(walletIdentityName, {
                        credentials: { certificate: enrollment.certificate, privateKey: enrollment.key.toBytes() },
                        mspId: mspId,
                        type: 'X.509'
                    });
                } catch (enrollErr) {
                    console.log(`[Self-Healing] Enrollment failed, attempting to register ${walletIdentityName} into CA...`);
                    
                    await ensureAdminEnrolled(caURL, caName, mspId, adminLabel, tlsOptions, caClient);
                    
                    const adminIdentity = await wallet.get(adminLabel);
                    if (!adminIdentity) throw new Error(`Admin ${adminLabel} missing from wallet.`);
                    
                    const provider = wallet.getProviderRegistry().getProvider(adminIdentity.type);
                    let adminUser = await provider.getUserContext(adminIdentity, 'admin');
                    
                    const registerPayload = {
                        enrollmentID: walletIdentityName,
                        enrollmentSecret: password,
                        role: (userRecord.role === 'registrar' || userRecord.role === 'department_admin' || userRecord.role === 'deptAdmin' || userRecord.role === 'chairperson') ? 'admin' : 'client',
                        attrs: [
                            { name: 'role', value: userRecord.role, ecert: true },
                            { name: 'grade.manage', value: userRecord.role === 'faculty' ? 'true' : 'false', ecert: true }
                        ]
                    };
                    
                    try {
                        await ca.register(registerPayload, adminUser);
                    } catch (regErr) {
                        if (regErr.toString().includes('code: 20') || regErr.toString().includes('Authentication failure')) {
                            console.warn(`[Self-Healing] Admin authentication failed for ${adminLabel}. Stale cert suspected. Re-enrolling...`);
                            await wallet.remove(adminLabel);
                            await ensureAdminEnrolled(caURL, caName, mspId, adminLabel, tlsOptions, caClient);
                            
                            const newAdminIdentity = await wallet.get(adminLabel);
                            adminUser = await provider.getUserContext(newAdminIdentity, 'admin');
                            await ca.register(registerPayload, adminUser);
                        } else if (regErr.toString().includes('code: 74') || regErr.toString().includes('is already registered')) {
                            console.log(`[Self-Healing] ${walletIdentityName} already exists in CA. Re-registering for wallet recovery...`);
                            const identityService = ca.newIdentityService();
                            try {
                                const forceDeleteUrl = identityService._client.getBaseURL() + '/api/v1/identities/' + walletIdentityName + '?force=true';
                                await identityService._client.delete(forceDeleteUrl, adminUser);
                                await ca.register(registerPayload, adminUser);
                            } catch (e) {
                                console.log(`[Self-Healing] CA Force Delete failed: ${e.message}. Attempting forced update...`);
                                await identityService.update(walletIdentityName, { 
                                    type: registerPayload.role,
                                    secret: password, 
                                    max_enrollments: -1,
                                    attrs: registerPayload.attrs 
                                }, adminUser);
                            }
                        } else {
                            throw regErr;
                        }
                    }
                    
                    const newEnrollment = await ca.enroll({
                        enrollmentID: walletIdentityName,
                        enrollmentSecret: password,
                        attr_reqs: [{ name: 'role', optional: true }, { name: 'grade.manage', optional: true }]
                    });
                    await wallet.put(walletIdentityName, {
                        credentials: { certificate: newEnrollment.certificate, privateKey: newEnrollment.key.toBytes() },
                        mspId: mspId,
                        type: 'X.509'
                    });
                }
                console.log(`[Self-Healing] Successfully recovered wallet for ${walletIdentityName}`);
                identity = await wallet.get(walletIdentityName);
            } catch (recoveryErr) {
                console.error(`[Self-Healing] Recovery failed: ${recoveryErr.message}`);
                return res.status(401).json({ error: "Blockchain Identity not found, and automatic recovery failed. Please contact admin." });
            }
        }


        const tokenPayload = { 
            username: walletIdentityName, 
            role: identity.mspId, 
            dbRole: userRecord.role,
            "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier": walletIdentityName,
            "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name": walletIdentityName,
            "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress": walletIdentityName,
            "http://schemas.microsoft.com/ws/2008/06/identity/claims/role": userRecord.role
        };
        
        const jwtOptions = { expiresIn: process.env.JWT_EXPIRES_IN || '12h' };
        if (process.env.JWT_ISSUER) jwtOptions.issuer = process.env.JWT_ISSUER;
        if (process.env.JWT_AUDIENCE) jwtOptions.audience = process.env.JWT_AUDIENCE;

        const token = jwt.sign(tokenPayload, JWT_SECRET, jwtOptions);
        res.status(200).json({ status: "success", token, message: "Use this token in the Authorization header: Bearer <token>" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/crypto/hash-password', async (req, res) => {
    try {
        const { password } = req.body;
        if (!password) {
            return res.status(400).json({ error: "Password is required." });
        }
        const hash = await bcrypt.hash(password, 10);
        res.status(200).json({ hash });
    } catch (error) {
        res.status(500).json({ error: "Failed to hash password." });
    }
});

app.post('/api/fabric/register-user', authenticateJWT, requireRegistrarOrInternal, async (req, res) => {
    try {
        const { email, role } = req.body;
        
        const { caURL, caName, adminLabel, mspId, tlsOptions, caClient } = getCAConfig(role);
        
        await ensureAdminEnrolled(caURL, caName, mspId, adminLabel, tlsOptions, caClient);

        const ca = caClient;
        const wallet = await getWallet(role);
        const adminIdentity = await wallet.get(adminLabel);
        if (!adminIdentity) {
            return res.status(500).json({ error: `Blockchain Admin '${adminLabel}' not found in wallet. Cannot register users.` });
        }

        const provider = wallet.getProviderRegistry().getProvider(adminIdentity.type);
        let adminUser = await provider.getUserContext(adminIdentity, 'admin');

        const secret = req.body.password || crypto.randomBytes(12).toString('hex');
        
        const registerUser = async (user) => {
            return await ca.register({
                enrollmentID: email,
                enrollmentSecret: secret,
                role: (role === 'registrar' || role === 'department_admin' || role === 'deptAdmin' || role === 'chairperson') ? 'admin' : 'client',
                attrs: [{ name: 'role', value: role, ecert: true }, { name: 'grade.manage', value: role === 'faculty' ? 'true' : 'false', ecert: true }]
            }, user);
        };

        try {
            await registerUser(adminUser);
        } catch (regErr) {        
            if (regErr.toString().includes('code: 20') || regErr.toString().includes('Authentication failure')) {
                console.warn(`[Self-Healing] Admin authentication failed for ${adminLabel}. Stale cert suspected. Re-enrolling...`);
                await wallet.remove(adminLabel);
                await ensureAdminEnrolled(caURL, caName, mspId, adminLabel, tlsOptions, caClient);
                
                const newAdminIdentity = await wallet.get(adminLabel);
                adminUser = await provider.getUserContext(newAdminIdentity, 'admin');
                await registerUser(adminUser);
            } else {
                throw regErr;
            }
        }

        const enrollment = await ca.enroll({ 
            enrollmentID: email, 
            enrollmentSecret: secret,
            attr_reqs: [
                { name: 'role', optional: true },
                { name: 'grade.manage', optional: true }
            ]
        });
        const x509Identity = { credentials: { certificate: enrollment.certificate, privateKey: enrollment.key.toBytes() }, mspId: mspId, type: 'X.509' };
        await wallet.put(email, x509Identity);

        res.status(200).json({ status: "Success", message: "Blockchain Wallet created successfully!" });
    } catch (error) {
        res.status(500).json({ error: "Failed to create Fabric wallet: " + error.message });
    }
});

const passwordResetLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	max: 5,
	message: { error: 'Too many password reset requests from this IP, please try again after 15 minutes.' },
    standardHeaders: true,
	legacyHeaders: false,
});

app.post('/api/forgot-password', passwordResetLimiter, async (req, res) => {
    try {
        const { email } = req.body;
        
        const user = await dbRead.query('SELECT * FROM Users WHERE email = $1', [email]);
        if (user.rows.length === 0) {
            return res.status(200).json({ message: "If that email exists, a reset link has been sent." });
        }

        const resetToken = crypto.randomBytes(32).toString('hex');
        const tokenExpiry = Date.now() + 3600000;

        await dbWrite.query('UPDATE Users SET password_reset_token = $1, password_reset_expires = $2 WHERE email = $3', [resetToken, tokenExpiry, email]);

        const frontendUrl = process.env.FRONTEND_URL || req.headers.origin || 'http://localhost';
        const resetURL = `${frontendUrl}/reset-password?token=${resetToken}`;
        
        console.log(`[DEV MODE] Reset Link generated: ${resetURL}\n`);

        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || process.env.EMAIL_HOST || 'smtp.gmail.com',
            port: process.env.SMTP_PORT || process.env.EMAIL_PORT || 587,
            secure: false,
            auth: {
                user: process.env.SMTP_USER || process.env.EMAIL_USER,
                pass: process.env.SMTP_PASS || process.env.EMAIL_PASS
            }
        });

        await transporter.sendMail({
            from: process.env.EMAIL_FROM || '"PLV Registrar BLOCKGO" <noreply@capstone.com>',
            to: email,
            subject: 'Password Reset Request',
            text: `You requested a password reset. Please click the following link to reset your password:\n\n${resetURL}\n\nIf you did not request this, please ignore this email.`,
            html: `<p>You requested a password reset. Please click the following link to reset your password:</p><p><a href="${resetURL}">${resetURL}</a></p><p>If you did not request this, please ignore this email.</p>`
        });
        console.log(`[PROD MODE] Actual email sent to ${email}`);

        res.status(200).json({ message: "If that email exists, a reset link has been sent." });
    } catch (error) {
        console.error("Forgot Password Error:", error);
        res.status(500).json({ error: "Server error during password reset request." });
    }
});

app.post('/api/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;

        const userResult = await dbRead.query('SELECT * FROM Users WHERE password_reset_token = $1 AND password_reset_expires > $2', [token, Date.now()]);
        if (userResult.rows.length === 0) {
            return res.status(400).json({ error: "Invalid or expired token" });
        }

        const user = userResult.rows[0];
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await dbWrite.query('UPDATE Users SET password_hash = $1, password_reset_token = NULL, password_reset_expires = NULL WHERE id = $2', [hashedPassword, user.id]);

        res.status(200).json({ message: "Password updated successfully. You can now log in." });
    } catch (error) {
        res.status(500).json({ error: "Server error." });
    }
});

app.post('/api/enroll', authenticateJWT, requireRegistrarOrInternal, async (req, res) => {
    try {
        const { username, password, role } = req.body;
        const { mspId, caClient } = getCAConfig(role);

        const ca = caClient;
        const wallet = await getWallet(role);

        if (await wallet.get(username)) {
            return res.status(200).json({ status: "success", message: "User is already enrolled in the wallet." });
        }

        console.log(`[Enroll] Downloading certificates for ${username} from ${caName}...`);
        const enrollment = await ca.enroll({
            enrollmentID: username,
            enrollmentSecret: password,
            attr_reqs: [
                { name: 'role', optional: true },
                { name: 'grade.manage', optional: true }
            ]
        });
        
        const x509Identity = {
            credentials: {
                certificate: enrollment.certificate,
                privateKey: enrollment.key.toBytes(),
            },
            mspId: mspId,
            type: 'X.509',
        };
        await wallet.put(username, x509Identity);

        console.log(`[Enroll] Successfully saved ${username} to wallet as ${mspId}!`);
        res.status(200).json({ status: "success", message: `Wallet created for ${username}` });

    } catch (error) {
        console.error('[Enroll] Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/register', authenticateJWT, requireRegistrarOrInternal, async (req, res) => {
    try {
        const { username, password, role } = req.body;
        
        const { caURL, caName, adminLabel, mspId, tlsOptions, caClient } = getCAConfig(role);
        
        await ensureAdminEnrolled(caURL, caName, mspId, adminLabel, tlsOptions, caClient);
        
        const wallet = await getWallet(role);
        const adminIdentity = await wallet.get(adminLabel);

        if (!adminIdentity) {
            console.error("Identity Guard Failed: Admin wallet missing from /wallet/ directory.");
            return res.status(500).json({ 
                error: "Middleware configuration error", 
                message: `Admin identity '${adminLabel}' not enrolled. Please run enrollAllAdmins.js first.` 
            });
        }

        const ca = caClient;

        const provider = wallet.getProviderRegistry().getProvider(adminIdentity.type);
        const adminUser = await provider.getUserContext(adminIdentity, 'admin');

        let secret = password;
        secret = await ca.register({
            enrollmentID: username,
            enrollmentSecret: password,
            role: (role === 'registrar' || role === 'department_admin' || role === 'deptAdmin' || role === 'chairperson') ? 'admin' : 'client',
            attrs: [
                { name: 'role', value: role, ecert: true },
                { name: 'grade.manage', value: role === 'faculty' ? 'true' : 'false', ecert: true }
            ]
        }, adminUser);

        res.status(201).json({ status: "success", secret });
    } catch (error) { 
        console.error(`[Register] Error:`, error.message);
        res.status(500).json({ error: "Server Exception", details: error.message }); 
    }
});

app.post('/api/revoke', authenticateJWT, requireRegistrarOrInternal, async (req, res) => {
    try {
        const { username, role } = req.body;
        
        const { caURL, caName, adminLabel, mspId, tlsOptions, caClient } = getCAConfig(role);
        
        await ensureAdminEnrolled(caURL, caName, mspId, adminLabel, tlsOptions, caClient);
        
        const wallet = await getWallet(role);
        const adminIdentity = await wallet.get(adminLabel);

        if (!adminIdentity) {
            console.error("Identity Guard Failed: Admin wallet missing from /wallet/ directory.");
            return res.status(500).json({ 
                error: "Middleware configuration error", 
                message: `Admin identity '${adminLabel}' not enrolled. Please run enrollAllAdmins.js first.` 
            });
        }

        const userIdentity = await wallet.get(username);
        if (!userIdentity) {
            return res.status(404).json({
                error: "Identity Mismatch",
                message: `Wallet for user ${username} does not exist.`
            });
        }

        const ca = caClient;

        const provider = wallet.getProviderRegistry().getProvider(adminIdentity.type);
        const adminUser = await provider.getUserContext(adminIdentity, 'admin');

        await ca.revoke({ enrollmentID: username, reason: "Revoked by admin" }, adminUser);
        if (await wallet.get(username)) await wallet.remove(username);

        if (userGatewayCache.has(username)) {
            userGatewayCache.get(username).gateway.disconnect();
            userGatewayCache.delete(username);
        }

        res.status(200).json({ status: "success", message: `Revoked ${username}` });
    } catch (error) { 
        console.error(`[Revoke] Error:`, error.message);
        res.status(500).json({ error: "Server Exception", details: error.message }); 
    }
});

app.get('/api/all-grades', authenticateJWT, async (req, res) => {
    let username;
    try {
        username = getCallerIdentity(req);
        
        let contractToUse;
        try {
            const { contract } = await getContractForUser(username, req.user ? req.user.dbRole : null);
            contractToUse = contract;
        } catch (walletErr) {
            if (req.isInternal || walletErr.message.includes('not found')) {
                console.warn(`[Ledger Gateway] Wallet missing for ${username}. Falling back to system-admin-registrar for internal read query.`);
                const { contract } = await getContractForUser('system-admin-registrar', 'registrar');
                contractToUse = contract;
            } else {
                throw walletErr;
            }
        }

        console.log(`[GetAllGrades] Querying for ${username}...`);
        let result;
        try {
            result = await contractToUse.evaluateTransaction('GetAllGrades');
        } catch (evalErr) {
            if (evalErr.message.includes('creator is malformed') || evalErr.message.includes('access denied') || evalErr.message.includes('UNKNOWN')) {
                console.warn(`[Self-Healing] ${username} identity rejected by peer. Falling back to system-admin-registrar.`);
                clearCacheOnError(username, evalErr); // Wipe the stale wallet in background
                const { contract: fallbackContract } = await getContractForUser('system-admin-registrar', 'registrar');
                result = await fallbackContract.evaluateTransaction('GetAllGrades');
            } else { throw evalErr; }
        }

        try {
            const grades = JSON.parse(result.toString());
            
            if (Array.isArray(grades)) {
                // --- Decode Base64 X.509 Identity from Chaincode for Frontend display ---
                grades.forEach(g => {
                    const facId = g.faculty_id || g.facultyId || g.FacultyId;
                    if (facId && facId.length > 40 && !facId.includes('@')) {
                        try {
                            const decoded = Buffer.from(facId, 'base64').toString('utf8');
                            const cnMatch = decoded.match(/CN=([^,]+)/);
                            if (cnMatch && cnMatch[1]) {
                                if (g.faculty_id) g.faculty_id = cnMatch[1];
                                if (g.facultyId) g.facultyId = cnMatch[1];
                                if (g.FacultyId) g.FacultyId = cnMatch[1];
                            }
                        } catch(e) {}
                    }
                });
            }
            
            let userRole = req.user ? req.user.dbRole : null;
            if (!userRole && req.isInternal) {
                try {
                    const userRes = await dbRead.query('SELECT role FROM Users WHERE email = $1', [username]);
                    if (userRes.rows.length > 0) userRole = userRes.rows[0].role;
                } catch (dbErr) {
                    console.error(`[DB Error] Failed to fetch role for ${username}: ${dbErr.message}`);
                }
            }
            
            if (userRole === 'student') {
                const studentGrades = grades.filter(g => 
                    g.student_hash === username || 
                    g.studentId === username ||
                    g.studentId === username.split('@')[0]
                );
                return res.status(200).json({ status: 'success', data: studentGrades });
            }
            else if (userRole === 'faculty') {
                const facultyGrades = grades.filter(g => g.faculty_id === username);
                return res.status(200).json({ status: 'success', data: facultyGrades });
            }
            else if (userRole === 'department_admin' || userRole === 'deptAdmin') {
                const profileRes = await dbRead.query(
                    'SELECT ap.department FROM AdminProfiles ap JOIN Users u ON ap.user_id = u.id WHERE u.email = $1',
                    [username]
                );
                
                if (profileRes.rows.length > 0 && profileRes.rows[0].department && profileRes.rows[0].department !== 'Unassigned') {
                    const adminDept = profileRes.rows[0].department;
                    
                    const baseDept = adminDept.toUpperCase().startsWith('BS') ? adminDept.substring(2) : adminDept;
                    
                    const deptGrades = grades.filter(g => {
                        const c = (g.course || '').toUpperCase();
                        const s = (g.subject_code || '').toUpperCase();
                        return c.includes(adminDept.toUpperCase()) || s.includes(adminDept.toUpperCase()) ||
                               c.includes(baseDept) || s.includes(baseDept);
                    });
                    return res.status(200).json({ status: 'success', data: deptGrades });
                }
                return res.status(200).json({ status: 'success', data: [] });
            }
            
            res.status(200).json({ status: 'success', data: grades });
        } catch (e) {
            res.status(200).json({ status: 'success', data: result.toString() });
        }
    } catch (error) {
        clearCacheOnError(username, error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/issue-grade', authenticateJWT, authorizeRole(['FacultyMSP', 'DepartmentMSP']), async (req, res) => {
    let username;
    try {
        username = getCallerIdentity(req);
        const { contract } = await getContractForUser(username, req.user ? req.user.dbRole : null);

        const gradeAsset = JSON.stringify(req.body);
        console.log(`[IssueGrade] Submitting as ${username}... Payload: ${gradeAsset}`);
        
        const result = await contract.submitTransaction('IssueGrade', gradeAsset);
        res.status(201).json({ status: "success", message: "Grade recorded", details: result.toString() });
    } catch (error) {
        clearCacheOnError(username, error);
        console.error('[IssueGrade] Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/get-grade/:id', authenticateJWT, async (req, res) => {
    let username;
    try {
        username = getCallerIdentity(req);
        
        let contractToUse;
        try {
            const { contract } = await getContractForUser(username, req.user ? req.user.dbRole : null);
            contractToUse = contract;
        } catch (walletErr) {
            if (req.isInternal || walletErr.message.includes('not found')) {
                const { contract } = await getContractForUser('system-admin-registrar', 'registrar');
                contractToUse = contract;
            } else { throw walletErr; }
        }

        console.log(`[ReadGrade] Fetching ${req.params.id} for ${username}...`);
        let result;
        try {
            result = await contractToUse.evaluateTransaction('ReadGrade', req.params.id);
        } catch (evalErr) {
            if (evalErr.message.includes('creator is malformed') || evalErr.message.includes('access denied') || evalErr.message.includes('UNKNOWN')) {
                clearCacheOnError(username, evalErr);
                const { contract: fallbackContract } = await getContractForUser('system-admin-registrar', 'registrar');
                result = await fallbackContract.evaluateTransaction('ReadGrade', req.params.id);
            } else { throw evalErr; }
        }

        res.status(200).json(JSON.parse(result.toString()));
    } catch (error) {
        clearCacheOnError(username, error);
        res.status(404).json({ error: "Record not found" });
    }
});

app.post('/api/update-grade', authenticateJWT, async (req, res) => {
    let username;
    try {
        username = getCallerIdentity(req);
        const { contract } = await getContractForUser(username, req.user ? req.user.dbRole : null);

        const gradeAsset = JSON.stringify(req.body);
        console.log(`[UpdateGrade] Updating as ${username}`);
        
        await contract.submitTransaction('UpdateGrade', gradeAsset);
        res.status(200).json({ status: "success", message: "Grade updated" });
    } catch (error) {
        clearCacheOnError(username, error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/approve-grade/:id', authenticateJWT, async (req, res) => {
    let username;
    try {
        username = getCallerIdentity(req);
        const { contract } = await getContractForUser(username, req.user ? req.user.dbRole : null);

        await contract.submitTransaction('ApproveGrade', req.params.id);
        res.status(200).json({ status: "success", message: "Grade approved" });
    } catch (error) {
        clearCacheOnError(username, error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/finalize-grade/:id', authenticateJWT, async (req, res) => {
    let username;
    try {
        username = getCallerIdentity(req);
        const { contract } = await getContractForUser(username, req.user ? req.user.dbRole : null);

        await contract.submitTransaction('FinalizeRecord', req.params.id);
        res.status(200).json({ status: "success", message: "Record finalized" });
    } catch (error) {
        clearCacheOnError(username, error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/return-grade/:id', authenticateJWT, async (req, res) => {
    let username;
    try {
        username = getCallerIdentity(req);
        const { note } = req.body;
        const { contract } = await getContractForUser(username, req.user ? req.user.dbRole : null);

        await contract.submitTransaction('ReturnGrade', req.params.id, note || 'Returned for revision');
        res.status(200).json({ status: "success", message: "Record returned for revision" });
    } catch (error) {
        clearCacheOnError(username, error);
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/wallet/:username', authenticateJWT, requireRegistrarOrInternal, async (req, res) => {
    try {
        let deleted = false;
        const roles = ['registrar', 'faculty', 'department_admin'];
        for (const r of roles) {
            const wallet = await getWallet(r);
            if (await wallet.get(req.params.username)) {
                await wallet.remove(req.params.username);
                deleted = true;
            }
        }
        if (deleted) {
            if (userGatewayCache.has(req.params.username)) {
                userGatewayCache.get(req.params.username).gateway.disconnect();
                userGatewayCache.delete(req.params.username);
            }
            return res.status(200).json({ status: "success", message: "Wallet identity deleted." });
        }
        res.status(404).json({ status: "error", message: "Identity not found in wallet." });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/SystemSettings/:key', async (req, res) => {
    try {
        const { key } = req.params;
        await dbWrite.query("CREATE TABLE IF NOT EXISTS systemsettings (key VARCHAR(100) PRIMARY KEY, value TEXT NOT NULL)");
        const result = await dbRead.query("SELECT value FROM systemsettings WHERE key = $1", [key]);
        if (result.rows.length > 0) {
            return res.status(200).json({ status: "Success", value: result.rows[0].value });
        }
        return res.status(200).json({ status: "NotFound", value: null });
    } catch (error) {
        res.status(500).json({ status: "Error", message: error.message });
    }
});

app.post('/api/SystemSettings', authenticateJWT, async (req, res) => {
    try {
        if (req.user && req.user.dbRole !== 'registrar' && req.user.dbRole !== 'admin') {
            return res.status(403).json({ status: "Error", message: "Only registrars can modify system settings." });
        }
        const key = req.body.key || req.body.Key;
        const value = req.body.value || req.body.Value;
        if (!key) return res.status(400).json({ status: "Error", message: "Key is required" });
        
        await dbWrite.query("CREATE TABLE IF NOT EXISTS systemsettings (key VARCHAR(100) PRIMARY KEY, value TEXT NOT NULL)");
        await dbWrite.query(
            "INSERT INTO systemsettings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
            [key, value]
        );
        return res.status(200).json({ status: "Success", message: "Setting updated successfully" });
    } catch (error) {
        res.status(500).json({ status: "Error", message: error.message });
    }
});

app.post('/api/SystemSettings/reset-season', authenticateJWT, async (req, res) => {
    try {
        if (req.user && req.user.dbRole !== 'registrar' && req.user.dbRole !== 'admin') {
            return res.status(403).json({ status: "Error", message: "Only registrars can reset the season." });
        }
        await dbWrite.query("TRUNCATE TABLE pending_grade_records");
        return res.status(200).json({ status: "Success", message: "Encoding season reset. Staging area cleared." });
    } catch (error) {
        res.status(500).json({ status: "Error", message: error.message });
    }
});

const handleBatchUpload = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded. Expected form-data field "excel".' });
        }

        const filePath = req.file.path;
        const mapperPath = path.resolve(__dirname, '..', 'mapper.py');
        
        if (!fs.existsSync(mapperPath)) {
            return res.status(500).json({ error: 'Mapper script not found', expected: mapperPath });
        }

        const facultyId = req.body.facultyId || req.body.username || req.user?.username || 'admin';
        
        const workerPath = path.resolve(__dirname, 'uploadWorker.js');
        if (!fs.existsSync(workerPath)) {
            return res.status(500).json({ error: 'Worker script not found' });
        }

        console.log(`[BatchUpload] Dispatching upload to worker thread for ${facultyId}`);

        const worker = new Worker(workerPath, {
            workerData: {
                mapperPath,
                filePath,
                facultyId,
                INTERNAL_API_KEY,
                term: req.body.term || ''
            }
        });

        worker.on('message', (message) => {
            if (!res.headersSent) {
                if (message.status === 'success') {
                    res.status(200).json({ status: 'success', message: 'Batch grades processed successfully', output: message.output });
                } else {
                    res.status(500).json({ status: 'error', ...message });
                }
            }
        });

        worker.on('error', (err) => {
            console.error('[Worker] Error:', err);
            if (!res.headersSent) res.status(500).json({ status: 'error', error: 'Worker process failed: ' + err.message });
        });

        worker.on('exit', (code) => {
            if (code !== 0 && !res.headersSent) {
                res.status(500).json({ status: 'error', error: `Worker stopped with exit code ${code}` });
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

app.post(['/api/batch-upload', '/api/upload-grades'], authenticateJWT, handleUploadMiddleware, handleBatchUpload);


app.post('/api/batch-issue-grade', async (req, res) => {
    let username;
    try {
        if (req.headers['x-api-key'] !== INTERNAL_API_KEY) {
            return res.status(401).json({ error: 'Invalid or missing API key' });
        }

        username = req.headers['x-user-identity'] || req.body.facultyId;
        if (!username) {
            return res.status(400).json({ 
                error: 'Missing faculty identity',
                hint: 'Provide x-user-identity header or facultyId in body'
            });
        }

        let wallet = await getWallet('faculty');
        let identity = await wallet.get(username);
        if (!identity) {
            wallet = await getWallet('department_admin');
            identity = await wallet.get(username);
        }
        if (!identity) {
            return res.status(401).json({ 
                error: `Faculty ${username} not found in wallet`,
                hint: 'Faculty must be registered and enrolled first'
            });
        }

        if (identity.mspId !== 'FacultyMSP' && identity.mspId !== 'DepartmentMSP') {
            return res.status(403).json({ 
                error: `Access denied: ${username} is not authorized to issue grades (MSP: ${identity.mspId})`
            });
        }

        const { contract } = await getContractForUser(username, 'faculty'); 
        const records = req.body;      const recordsJSON = JSON.stringify(records);
        console.log(`[BatchIssueGrade] Submitting as ${username}... Payload: ${recordsJSON.length} bytes`);
        
        const result = await contract.submitTransaction('IssueBatchGrades', recordsJSON);
        res.status(201).json({ 
            status: 'success', 
            message: 'Batch grades recorded',
            facultyId: username,
            details: result.toString() 
        });
    } catch (error) {
        clearCacheOnError(username, error);
        console.error('[BatchIssueGrade] Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/bootstrap', async (req, res) => {
    try {
        const email = 'registrar@plv.edu.ph';
        const password = 'admin123';
        const role = 'registrar';

        const userCheck = await dbRead.query('SELECT * FROM Users WHERE email = $1', [email]);
        if (userCheck.rows.length > 0) {
            return res.status(200).json({ message: "Bootstrap already completed. Registrar exists." });
        }

        const hash = await bcrypt.hash(password, 10);
        const userResult = await dbWrite.query(
            "INSERT INTO Users (email, password_hash, role, status) VALUES ($1, $2, $3, 'APPROVED') RETURNING id",
            [email, hash, role]
        );
        
        await dbWrite.query(
            "INSERT INTO AdminProfiles (user_id, full_name, admin_level, department) VALUES ($1, $2, $3, $4)",
            [userResult.rows[0].id, 'System Registrar', role, 'Registrar']
        );

        const { caURL, caName, adminLabel, mspId, tlsOptions, caClient } = getCAConfig(role);
        await ensureAdminEnrolled(caURL, caName, mspId, adminLabel, tlsOptions, caClient);
        
        const ca = caClient;
        const wallet = await getWallet(role);
        try {
            const adminIdentity = await wallet.get(adminLabel);
            const provider = wallet.getProviderRegistry().getProvider(adminIdentity.type);
            const adminUser = await provider.getUserContext(adminIdentity, 'admin');
            await ca.register({ enrollmentID: email, enrollmentSecret: password, role: 'admin', attrs: [{ name: 'role', value: role, ecert: true }] }, adminUser);
        } catch (err) { if (!err.toString().includes('is already registered')) throw err; }

        const enrollment = await ca.enroll({ 
            enrollmentID: email, 
            enrollmentSecret: password,
            attr_reqs: [{ name: 'role', optional: true }]
        });
        await wallet.put(email, { credentials: { certificate: enrollment.certificate, privateKey: enrollment.key.toBytes() }, mspId: mspId, type: 'X.509' });

        res.status(200).json({ status: "success", message: "Registrar securely bootstrapped! You can now log in." });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/health', (req, res) => res.status(200).json({ status: "operational", mode: 'Production Security (ABAC ACTIVE)' }));

const PORT = process.env.PORT || 4000;

async function startServer() {
    importCryptogenAdmins().catch(e => console.error("Startup wallet sync failed:", e.message));

    app.listen(PORT, '0.0.0.0', () => {
        console.log(`\nMiddleware online on port ${PORT}`);
        console.log(`Mode: Production Security (OBAC/ABAC ACTIVE)`);
        console.log(` Dynamic Identity Loading: Enabled\n`);
    });
}

startServer();

process.on('SIGINT', () => {
    console.log('\nGracefully shutting down...');
    userGatewayCache.forEach(cached => cached.gateway.disconnect());
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\nReceived SIGTERM from Kubernetes. Gracefully shutting down...');
    userGatewayCache.forEach(cached => cached.gateway.disconnect());
    process.exit(0);
});
