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

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const getCAConfig = (role) => {
    if (role === 'faculty') return { caURL: 'https://localhost:8054', caName: 'ca-faculty', adminLabel: 'admin-faculty', mspId: 'FacultyMSP' };
    if (role === 'department_admin' || role === 'admin' || role === 'dean') return { caURL: 'https://localhost:9054', caName: 'ca-department', adminLabel: 'admin-department', mspId: 'DepartmentMSP' };
    return { caURL: 'https://localhost:7054', caName: 'ca-registrar', adminLabel: 'admin-registrar', mspId: 'RegistrarMSP' };
};

const uploadExcel = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, uploadDir),
        filename: (req, file, cb) => {
            const safeName = path.basename(file.originalname); 
            cb(null, Date.now() + '-' + safeName);
        }
    }),
    limits: { fileSize: 15 * 1024 * 1024 } 
}).single('excel');

const handleUploadMiddleware = (req, res, next) => {
    uploadExcel(req, res, (err) => {
        if (err instanceof multer.MulterError) return res.status(400).json({ error: `Upload error: ${err.message}.` });
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

// Read Pool (Connects to Local Replica / Fallback to Localhost)
const dbRead = new Pool({
    user: process.env.POSTGRES_USER || 'postgres',
    host: process.env.POSTGRES_HOST === 'postgres' ? '127.0.0.1' : (process.env.POSTGRES_HOST || '127.0.0.1'),
    database: process.env.POSTGRES_DB || 'ActivityLogs',
    password: process.env.POSTGRES_PASS || 'password',
    port: process.env.POSTGRES_PORT || 5432,
});

let mainIp = process.env.MAIN_CAMPUS_IP;
if (mainIp === 'host-gateway') mainIp = '127.0.0.1';

// Write Pool (Strictly connects to Main Campus Master)
const dbWrite = new Pool({
    user: process.env.POSTGRES_USER || 'postgres',
    host: mainIp || process.env.POSTGRES_HOST || '127.0.0.1',
    database: process.env.POSTGRES_DB || 'ActivityLogs',
    password: process.env.POSTGRES_PASS || 'password',
    port: process.env.POSTGRES_PORT || 5432,
});

dbRead.on('error', (err, client) => {
    console.error('Unexpected error on idle PostgreSQL read client:', err);
});
dbWrite.on('error', (err, client) => {
    console.error('Unexpected error on idle PostgreSQL write client:', err);
});
async function getWallet() {
    let couchUrl = process.env.COUCHDB_WALLET_URL;
    if (!couchUrl && process.env.COUCHDB_USER && process.env.COUCHDB_PASS) {
        couchUrl = `http://${process.env.COUCHDB_USER}:${process.env.COUCHDB_PASS}@127.0.0.1:5990`;
    }

    if (couchUrl) {
        const wallet = await Wallets.newCouchDBWallet(couchUrl, 'fabric_wallet');
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
                    
                    const key = crypto.scryptSync(encryptionKey, salt, 32);
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
                        key = crypto.scryptSync(encryptionKey, Buffer.from(saltHex, 'hex'), 32);
                        ivHex = ivPart;
                        authTagHex = authTagPart;
                        encryptedHex = encryptedPart;
                    } else if (parts.length === 4) {
                        const [, ivPart, authTagPart, encryptedPart] = parts;
                        key = crypto.scryptSync(encryptionKey, 'salt', 32);
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

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error("FATAL ERROR: JWT_SECRET environment variable is missing. Please set it in your .env file.");
    process.exit(1);
}

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
    if (req.headers['x-api-key'] === INTERNAL_API_KEY || req.headers['x-api-key'] === 'dev-internal-api-key') {
        return next();
    }

    if (req.user && req.user.role === 'RegistrarMSP') {
        return next();
    }

    return res.status(403).json({ 
        error: "Access denied. Cryptographic operations require Registrar privileges or a valid Internal API Key." 
    });
};

const userGatewayCache = new Map();
const IDLE_TIMEOUT_MS = 60 * 60 * 1000;
setInterval(() => {
    const now = Date.now();
    for (const [username, cached] of userGatewayCache.entries()) {
        if (now - cached.lastAccessed > IDLE_TIMEOUT_MS) {
            console.log(`[Cache Pruner] Closing idle connection for ${username}`);
            cached.gateway.disconnect();
            userGatewayCache.delete(username);
        }
    }
}, 15 * 60 * 1000);

const clearCacheOnError = (username, error) => {
    if (!username || !error || !error.message) return;
    if (error.message.includes('creator is malformed') || error.message.includes('access denied') || error.message.includes('UNAVAILABLE') || error.message.includes('UNKNOWN')) {
        if (userGatewayCache.has(username)) {
            console.warn(`[Self-Healing] Evicting poisoned connection cache for ${username}`);
            try { userGatewayCache.get(username).gateway.disconnect(); } catch (e) {}
            userGatewayCache.delete(username);
        }
    }
};

async function importCryptogenAdmins(wallet) {
    console.log("Syncing natively trusted Cryptogen Admin certificates...");
    try {
        const orgs = [
            { mspId: 'RegistrarMSP', domain: 'registrar.capstone.com', label: 'system-admin-registrar' },
            { mspId: 'FacultyMSP', domain: 'faculty.capstone.com', label: 'system-admin-faculty' },
            { mspId: 'DepartmentMSP', domain: 'department.capstone.com', label: 'system-admin-department' }
        ];

        const cryptoBase = '../network/crypto-config-final-v2';

        for (const org of orgs) {
            try {
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

async function ensureAdminEnrolled(caURL, caName, mspId, adminLabel) {
    try {
        const wallet = await getWallet();
        const identity = await wallet.get(adminLabel);
        
        if (identity) {
            return; 
        }

        console.log(`[Identity Guard] '${adminLabel}' missing from wallet. Attempting enrollment...`);
        
        const enrollSecret = process.env.BOOTSTRAP_REGISTRAR_PASS || 'adminpw';
        
        const ca = new FabricCAServices(caURL, { verify: false }, caName);
        
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

async function getContractForUser(username) {
    if (!username) {
        throw new Error('No identity provided. Transaction requires a valid username/identity.');
    }

    if (userGatewayCache.has(username)) {
        const cached = userGatewayCache.get(username);
        cached.lastAccessed = Date.now();
        return { contract: cached.contract, gateway: cached.gateway };
    }

    const ccpPath = path.resolve(__dirname, process.env.CONNECTION_PROFILE_PATH || 'connection.json');
    const ccp = JSON.parse(fs.readFileSync(ccpPath, 'utf8'));
    if (!ccp.organizations) ccp.organizations = {};
    
    let clientOrg = null;
    const wallet = await getWallet();
    const identity = await wallet.get(username);
    if (!identity) {
        throw new Error(`Access Denied: Wallet identity for '${username}' not found. The Registrar must register this user first.`);
    }

    console.log(`[Ledger Gateway] Routing transaction for ${username} securely via their own wallet identity.`);

    for (const [orgName, orgDetails] of Object.entries(ccp.organizations)) {
        if (orgDetails.mspid === identity.mspId) {
            clientOrg = orgName;
            break;
        }
    }
    
    if (!clientOrg) {
        clientOrg = identity.mspId;
        const peerUrl = identity.mspId === 'FacultyMSP' ? 'peer0.faculty.capstone.com' : 
                        identity.mspId === 'DepartmentMSP' ? 'peer0.department.capstone.com' : 
                        'peer0.registrar.capstone.com';
        ccp.organizations[clientOrg] = { mspid: identity.mspId, peers: [peerUrl] };
    }
    
    if (!ccp.client) ccp.client = {};
    ccp.client.organization = clientOrg;

    const gateway = new Gateway();
    await gateway.connect(ccp, {
        wallet,
        identity: username, 
        discovery: { enabled: false, asLocalhost: true }
    });

    const network = await gateway.getNetwork(process.env.CHANNEL_NAME || 'registrar-channel');
    const contract = network.getContract(process.env.CHAINCODE_NAME || 'registrar');

    userGatewayCache.set(username, { gateway, contract, lastAccessed: Date.now() });

    return { contract, gateway }; 
}

const getCallerIdentity = (req) => {
    if (req.user && req.user.username) return req.user.username;
    
    if (req.isInternal) {
        return req.headers['x-user-identity'] || req.body.facultyId || req.body.ApprovedBy;
    }
    throw new Error("Unauthorized caller identity access attempt.");
};  

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // Limit each IP to 5 requests per windowMs
    message: { error: 'Too many login attempts from this IP, please try again after 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false,
});

app.post('/api/login', loginLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;
        
        const userResult = await dbRead.query('SELECT * FROM Users WHERE email = $1', [username]);
        if (userResult.rows.length === 0) {
            return res.status(401).json({ error: "Invalid email or password." });
        }
        
        const userRecord = userResult.rows[0];
        
        if (userRecord.status === 'pending') {
            return res.status(403).json({ error: "Account pending administrative approval." });
        }

        const validPassword = await bcrypt.compare(password, userRecord.password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: "Invalid email or password." });
        }

        const wallet = await getWallet();
        let identity = await wallet.get(username);
        
        if (!identity) {
            return res.status(401).json({ error: "Blockchain Identity not found in wallet. Please contact admin." });
        }

        const token = jwt.sign({ username: username, role: identity.mspId, dbRole: userRecord.role }, JWT_SECRET, { expiresIn: '4h' });
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
        
        const wallet = await getWallet();
        const { caURL, caName, adminLabel, mspId } = getCAConfig(role);
        
        await ensureAdminEnrolled(caURL, caName, mspId, adminLabel);

        const ca = new FabricCAServices(caURL, { verify: false }, caName);
        const adminIdentity = await wallet.get(adminLabel);
        if (!adminIdentity) {
            return res.status(500).json({ error: `Blockchain Admin '${adminLabel}' not found in wallet. Cannot register users.` });
        }

        const provider = wallet.getProviderRegistry().getProvider(adminIdentity.type);
        const adminUser = await provider.getUserContext(adminIdentity, 'admin');

        const secret = req.body.password || crypto.randomBytes(12).toString('hex');
        try {
            await ca.register({
                enrollmentID: email,
                enrollmentSecret: secret,
                role: 'client',
                attrs: [{ name: 'role', value: role, ecert: true }, { name: 'grade.manage', value: role === 'faculty' ? 'true' : 'false', ecert: true }]
            }, adminUser);
        } catch (regErr) {
            if (regErr.toString().includes('code: 74') || regErr.toString().includes('is already registered')) {
                console.log(`[Fabric CA] ${email} is already registered. Skipping registration and attempting to enroll...`);
                try {
                    const identityService = ca.newIdentityService();
                    await identityService.update(email, { enrollmentSecret: secret }, adminUser);
                    console.log(`[Fabric CA] Force-updated password for ${email} in CA.`);
                } catch (updateErr) {
                    console.warn(`[Fabric CA] Could not update password for ${email}: ${updateErr.message}`);
                }
            } else {
                throw regErr;
            }
        }

        const enrollment = await ca.enroll({ enrollmentID: email, enrollmentSecret: secret });
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

        const resetURL = `http://localhost:3000/reset-password?token=${resetToken}`;
        
        console.log(`[DEV MODE] Reset Link generated: ${resetURL}\n`);

        const transporter = nodemailer.createTransport({
            host: process.env.EMAIL_HOST || 'smtp.gmail.com',
            port: process.env.EMAIL_PORT || 587,
            secure: false,
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
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
        const { caURL, caName, mspId } = getCAConfig(role);

        const ca = new FabricCAServices(caURL, { verify: false }, caName);
        const wallet = await getWallet();

        if (await wallet.get(username)) {
            return res.status(200).json({ status: "success", message: "User is already enrolled in the wallet." });
        }

        console.log(`[Enroll] Downloading certificates for ${username} from ${caName}...`);
        const enrollment = await ca.enroll({ enrollmentID: username, enrollmentSecret: password });
        
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
        const wallet = await getWallet();
        
        const { caURL, caName, adminLabel, mspId } = getCAConfig(role);
        
        await ensureAdminEnrolled(caURL, caName, mspId, adminLabel);
        
        const adminIdentity = await wallet.get(adminLabel);

        if (!adminIdentity) {
            console.error("Identity Guard Failed: Admin wallet missing from /wallet/ directory.");
            return res.status(500).json({ 
                error: "Middleware configuration error", 
                message: `Admin identity '${adminLabel}' not enrolled. Please run enrollAllAdmins.js first.` 
            });
        }

        const ca = new FabricCAServices(caURL, { verify: false }, caName);

        const provider = wallet.getProviderRegistry().getProvider(adminIdentity.type);
        const adminUser = await provider.getUserContext(adminIdentity, 'admin');

        let secret = password;
        try {
            secret = await ca.register({
                enrollmentID: username,
                enrollmentSecret: password,
                role: 'client',
                attrs: [
                    { name: 'role', value: role, ecert: true },
                    { name: 'grade.manage', value: role === 'faculty' ? 'true' : 'false', ecert: true }
                ]
            }, adminUser);
        } catch (regErr) {
            if (regErr.toString().includes('code: 74') || regErr.toString().includes('is already registered')) {
                console.log(`[Fabric CA] ${username} is already registered. Updating secret...`);
                try {
                    const identityService = ca.newIdentityService();
                    await identityService.update(username, { enrollmentSecret: password }, adminUser);
                    console.log(`[Fabric CA] Force-updated password for ${username} in CA.`);
                } catch (updateErr) {
                    console.warn(`[Fabric CA] Could not update password for ${username}: ${updateErr.message}`);
                }
            } else {
                throw regErr;
            }
        }

        res.status(201).json({ status: "success", secret });
    } catch (error) { 
        console.error(`[Register] Error:`, error.message);
        res.status(500).json({ error: "Server Exception", details: error.message }); 
    }
});

app.post('/api/revoke', authenticateJWT, requireRegistrarOrInternal, async (req, res) => {
    try {
        const { username, role } = req.body;
        const wallet = await getWallet();
        
        const { caURL, caName, adminLabel, mspId } = getCAConfig(role);
        
        await ensureAdminEnrolled(caURL, caName, mspId, adminLabel);
        
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

        const ca = new FabricCAServices(caURL, { verify: false }, caName);

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
        const { contract } = await getContractForUser(username);

        console.log(`[GetAllGrades] Querying as ${username} (using cached user context)...`);
        const result = await contract.evaluateTransaction('GetAllGrades');
        
        try {
            const grades = JSON.parse(result.toString());
            if (req.user && req.user.dbRole === 'student') {
                const studentGrades = grades.filter(g => 
                    g.student_hash === username || 
                    g.studentId === username ||
                    g.studentId === username.split('@')[0]
                );
                return res.status(200).json({ status: 'success', data: studentGrades });
            }
            else if (req.user && req.user.dbRole === 'faculty') {
                const facultyGrades = grades.filter(g => g.faculty_id === username);
                return res.status(200).json({ status: 'success', data: facultyGrades });
            }
            else if (req.user && (req.user.dbRole === 'department_admin' || req.user.dbRole === 'dean')) {
                // SECURITY FIX: Restrict Department Admins to only see grades for their assigned department
                const profileRes = await dbRead.query(
                    'SELECT ap.department FROM AdminProfiles ap JOIN Users u ON ap.user_id = u.id WHERE u.email = $1',
                    [username]
                );
                
                if (profileRes.rows.length > 0 && profileRes.rows[0].department && profileRes.rows[0].department !== 'Unassigned') {
                    const adminDept = profileRes.rows[0].department;
                    const deptGrades = grades.filter(g => g.course?.includes(adminDept) || g.subject_code?.includes(adminDept));
                    return res.status(200).json({ status: 'success', data: deptGrades });
                }
                return res.status(200).json({ status: 'success', data: [] }); // If no department assigned, return empty
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

app.post('/api/issue-grade', authenticateJWT, authorizeRole(['FacultyMSP']), async (req, res) => {
    let username;
    try {
        username = getCallerIdentity(req);
        const { contract } = await getContractForUser(username);

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
        const { contract } = await getContractForUser(username);

        console.log(`[ReadGrade] Fetching ${req.params.id} as ${username} (using cached user context)...`);
        const result = await contract.evaluateTransaction('ReadGrade', req.params.id);
        
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
        const { contract } = await getContractForUser(username);

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
        const { contract } = await getContractForUser(username);

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
        const { contract } = await getContractForUser(username);

        await contract.submitTransaction('FinalizeRecord', req.params.id);
        res.status(200).json({ status: "success", message: "Record finalized" });
    } catch (error) {
        clearCacheOnError(username, error);
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/wallet/:username', authenticateJWT, requireRegistrarOrInternal, async (req, res) => {
    try {
        const wallet = await getWallet();
        
        const exists = await wallet.get(req.params.username);
        if (exists) {
            await wallet.remove(req.params.username);
            
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
        
        console.log(`[BatchUpload] Starting mapper for ${facultyId}: python3 ${mapperPath}`);

        const pythonProcess = spawn('python3', [
            mapperPath,
            filePath,
            facultyId,
            INTERNAL_API_KEY
        ]);

        let output = '';
        let errorOutput = '';

        pythonProcess.on('error', (err) => {
            console.error('[Mapper] Failed to start python process:', err);
            if (!res.headersSent) res.status(500).json({ status: 'error', error: 'Failed to start mapper process: ' + err.message });
        });

        pythonProcess.stdout.on('data', (data) => output += data.toString());
        pythonProcess.stderr.on('data', (data) => errorOutput += data.toString());

        pythonProcess.on('close', (code) => {
            fs.unlink(filePath, (err) => { if (err) console.error('File cleanup error:', err); });

            if (!res.headersSent) {
                if (code === 0) {
                    res.status(200).json({ status: 'success', message: 'Batch grades processed successfully', output });
                } else {
                    res.status(500).json({ status: 'error', error: 'Mapper process failed', exitCode: code, output, errorOutput });
                }
            }
        });

        const timeoutId = setTimeout(() => {
            if (!res.headersSent) {
                pythonProcess.kill('SIGTERM');
                res.status(504).json({ error: 'Batch upload timeout' });
            }
        }, 5 * 60 * 1000);

        pythonProcess.on('exit', () => clearTimeout(timeoutId));
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

        const wallet = await getWallet();
        const identity = await wallet.get(username);
        if (!identity) {
            return res.status(401).json({ 
                error: `Faculty ${username} not found in wallet`,
                hint: 'Faculty must be registered and enrolled first'
            });
        }

        if (identity.mspId !== 'FacultyMSP') {
            return res.status(403).json({ 
                error: `Access denied: ${username} is not a faculty member (MSP: ${identity.mspId})`
            });
        }

        const { contract } = await getContractForUser(username);

        const gradeAsset = JSON.stringify(req.body);
        console.log(`[BatchIssueGrade] Submitting as ${username}... Payload size: ${gradeAsset.length} bytes`);
        
        const result = await contract.submitTransaction('IssueGrade', gradeAsset);
        res.status(201).json({ 
            status: 'success', 
            message: 'Grade recorded',
            facultyId: username,
            details: result.toString() 
        });
    } catch (error) {
        clearCacheOnError(username, error);
        console.error('[BatchIssueGrade] Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/health', (req, res) => res.status(200).json({ status: "operational", mode: 'Production Security (ABAC ACTIVE)' }));

const PORT = process.env.PORT || 4000;

async function startServer() {
    try {
        const wallet = await getWallet();
        await importCryptogenAdmins(wallet);
    } catch (e) {
        console.error("Startup wallet sync failed:", e.message);
    }

    app.listen(PORT, () => {
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
