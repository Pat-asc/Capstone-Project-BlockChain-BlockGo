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
const upload = multer({ dest: uploadDir });
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

// --- 1. POSTGRESQL CONNECTION & INITIALIZATION ---
const db = new Pool({
    user: process.env.POSTGRES_USER || 'postgres',
    host: process.env.POSTGRES_HOST === 'postgres' ? '127.0.0.1' : (process.env.POSTGRES_HOST || '127.0.0.1'),
    database: process.env.POSTGRES_DB || 'ActivityLogs',
    password: process.env.POSTGRES_PASS || 'password',
    port: process.env.POSTGRES_PORT || 5432,
});

// Catch idle client errors so they don't crash the server
db.on('error', (err, client) => {
    console.error('Unexpected error on idle PostgreSQL client:', err);
});

db.query(`
    ALTER TABLE Users 
    ADD COLUMN IF NOT EXISTS password_reset_token VARCHAR(255),
    ADD COLUMN IF NOT EXISTS password_reset_expires BIGINT;
`).catch(err => console.error("Error updating database schema:", err));

async function getWallet() {
    let couchUrl = process.env.COUCHDB_WALLET_URL;
    if (!couchUrl && process.env.COUCHDB_USER && process.env.COUCHDB_PASS) {
        couchUrl = `http://${process.env.COUCHDB_USER}:${process.env.COUCHDB_PASS}@127.0.0.1:5989`;
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

const authenticateJWT = (req, res, next) => {
    const internalApiKey = process.env.INTERNAL_API_KEY || 'default-internal-secret-change-me';
    if (req.headers['x-api-key'] === internalApiKey) {
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
    const internalApiKey = process.env.INTERNAL_API_KEY || 'default-internal-secret-change-me';
    if (req.headers['x-api-key'] === internalApiKey) {
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
    console.log("Importing natively trusted Cryptogen Admin certificates...");
    try {
        const orgs = [
            { mspId: 'RegistrarMSP', domain: 'registrar.capstone.com', label: 'system-admin-registrar' },
            { mspId: 'FacultyMSP', domain: 'faculty.capstone.com', label: 'system-admin-faculty' },
            { mspId: 'DepartmentMSP', domain: 'department.capstone.com', label: 'system-admin-department' }
        ];
        
        for (const org of orgs) {
            let certPath = path.resolve(__dirname, `../network/crypto-config/peerOrganizations/${org.domain}/users/Admin@${org.domain}/msp/signcerts/Admin@${org.domain}-cert.pem`);
            if (!fs.existsSync(certPath)) {
                certPath = path.resolve(__dirname, `../network/crypto-config/peerOrganizations/${org.domain}/users/Admin@${org.domain}/msp/signcerts/cert.pem`);
            }

            const keyDir = path.resolve(__dirname, `../network/crypto-config/peerOrganizations/${org.domain}/users/Admin@${org.domain}/msp/keystore`);
            
            if (fs.existsSync(certPath) && fs.existsSync(keyDir)) {
                const cert = fs.readFileSync(certPath, 'utf8');
                const keyFiles = fs.readdirSync(keyDir).filter(f => f.endsWith('_sk'));
                if (keyFiles.length > 0) {
                    const key = fs.readFileSync(path.join(keyDir, keyFiles[0]), 'utf8');
                    await wallet.put(org.label, { credentials: { certificate: cert, privateKey: key }, mspId: org.mspId, type: 'X.509' });
                }
            }
        }
        console.log("Cryptogen Admin certificates synced successfully.");
    } catch (err) {
        console.error("Failed to import cryptogen admins:", err.message);
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

    const systemLabel = identity.mspId === 'FacultyMSP' ? 'system-admin-faculty' :
                        identity.mspId === 'DepartmentMSP' ? 'system-admin-department' :
                        'system-admin-registrar';
    const useIdentity = (await wallet.get(systemLabel)) ? systemLabel : username;
    
    console.log(`[Ledger Gateway] Routing transaction for ${username} via identity proxy: ${useIdentity}`);

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
        identity: useIdentity, 
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
        
        const userResult = await db.query('SELECT * FROM Users WHERE email = $1', [username]);
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
        let caURL, caName, adminLabel, mspId;
        if (role === 'faculty') {
            caURL = 'https://localhost:8054'; caName = 'ca-faculty'; adminLabel = 'admin-faculty'; mspId = 'FacultyMSP';
        } else if (role === 'department_admin' || role === 'dean') {
            caURL = 'https://localhost:9054'; caName = 'ca-department'; adminLabel = 'admin-department'; mspId = 'DepartmentMSP';
        } else {
            caURL = 'https://localhost:7054'; caName = 'ca-registrar'; adminLabel = 'admin-registrar'; mspId = 'RegistrarMSP';
        }

        const ca = new FabricCAServices(caURL, { verify: false }, caName);
        const adminIdentity = await wallet.get(adminLabel);
        if (!adminIdentity) {
            return res.status(500).json({ error: `Blockchain Admin '${adminLabel}' not found in wallet. Cannot register users.` });
        }

        const provider = wallet.getProviderRegistry().getProvider(adminIdentity.type);
        const adminUser = await provider.getUserContext(adminIdentity, 'admin');

        const randomSecret = crypto.randomBytes(12).toString('hex');
        await ca.register({
            enrollmentID: email,
            enrollmentSecret: randomSecret,
            role: 'client',
            attrs: [{ name: 'role', value: role, ecert: true }, { name: 'grade.manage', value: role === 'faculty' ? 'true' : 'false', ecert: true }]
        }, adminUser);

        const enrollment = await ca.enroll({ enrollmentID: email, enrollmentSecret: randomSecret });
        const x509Identity = { credentials: { certificate: enrollment.certificate, privateKey: enrollment.key.toBytes() }, mspId: mspId, type: 'X.509' };
        await wallet.put(email, x509Identity);

        res.status(200).json({ status: "Success", message: "Blockchain Wallet created successfully!" });
    } catch (error) {
        res.status(500).json({ error: "Failed to create Fabric wallet: " + error.message });
    }
});

app.get('/api/bootstrap', async (req, res) => {
    try {
        const email = 'registrar@plv.edu.ph';
        const pass = 'admin123';

        const userCheck = await db.query('SELECT * FROM Users WHERE email = $1', [email]);
        const wallet = await getWallet();
        const identityExists = await wallet.get(email);

        if (userCheck.rows.length > 0) {
            if (!identityExists) {
                console.log("Registrar found in DB but missing from wallet. Attempting to heal/re-register...");
                const result = await fetch(`http://127.0.0.1:${process.env.PORT || 4000}/api/fabric/register-user`, {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'x-api-key': process.env.INTERNAL_API_KEY || 'default-internal-secret-change-me'
                    },
                    body: JSON.stringify({ email: email, role: 'registrar' })
                });
                const walletResponse = await result.json();
                return res.json({ message: "Registrar was in DB but missing wallet. Wallet healed successfully!", wallet: walletResponse });
            }
            return res.json({ message: "Registrar already exists in DB and Wallet." });
        }

        const hash = await bcrypt.hash(pass, 10);
        const userRes = await db.query("INSERT INTO Users (email, password_hash, role, status) VALUES ($1, $2, 'registrar', 'APPROVED') RETURNING id", [email, hash]);
        await db.query("INSERT INTO AdminProfiles (user_id, full_name, admin_level) VALUES ($1, 'System Registrar', 'registrar')", [userRes.rows[0].id]);

        const result = await fetch(`http://127.0.0.1:${process.env.PORT || 4000}/api/fabric/register-user`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'x-api-key': process.env.INTERNAL_API_KEY || 'default-internal-secret-change-me'
            },
            body: JSON.stringify({ email: email, role: 'registrar' })
        });

        const walletResponse = await result.json();
        res.json({ message: "Root registrar created successfully!", email, password: pass, wallet: walletResponse });
    } catch (error) {
        res.status(500).json({ error: error.message });
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
        
        const user = await db.query('SELECT * FROM Users WHERE email = $1', [email]);
        if (user.rows.length === 0) {
            return res.status(200).json({ message: "If that email exists, a reset link has been sent." });
        }

        const resetToken = crypto.randomBytes(32).toString('hex');
        const tokenExpiry = Date.now() + 3600000;

        await db.query('UPDATE Users SET password_reset_token = $1, password_reset_expires = $2 WHERE email = $3', [resetToken, tokenExpiry, email]);

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

        const userResult = await db.query('SELECT * FROM Users WHERE password_reset_token = $1 AND password_reset_expires > $2', [token, Date.now()]);
        if (userResult.rows.length === 0) {
            return res.status(400).json({ error: "Invalid or expired token" });
        }

        const user = userResult.rows[0];
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await db.query('UPDATE Users SET password_hash = $1, password_reset_token = NULL, password_reset_expires = NULL WHERE id = $2', [hashedPassword, user.id]);

        res.status(200).json({ message: "Password updated successfully. You can now log in." });
    } catch (error) {
        res.status(500).json({ error: "Server error." });
    }
});

app.post('/api/enroll', authenticateJWT, requireRegistrarOrInternal, async (req, res) => {
    try {
        const { username, password, role } = req.body;
        let caURL, caName, mspId;
        
        if (role === 'faculty') {
            caURL = 'https://localhost:8054';
            caName = 'ca-faculty';
            mspId = 'FacultyMSP';
        } else if (role === 'department_admin') {
            caURL = 'https://localhost:9054'; 
            caName = 'ca-department';
            mspId = 'DepartmentMSP';
        } else {
            caURL = 'https://localhost:7054'; 
            caName = 'ca-registrar';
            mspId = 'RegistrarMSP';
        }

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
        
        let caURL, caName, adminLabel;
        if (role === 'faculty') {
            caURL = 'https://localhost:8054';
            caName = 'ca-faculty';
            adminLabel = 'admin-faculty';
        } else if (role === 'department_admin') {
            caURL = 'https://localhost:9054'; 
            caName = 'ca-department';
            adminLabel = 'admin-department';
        } else {
            caURL = 'https://localhost:7054'; 
            caName = 'ca-registrar';
            adminLabel = 'admin-registrar';
        }
        
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

        const secret = await ca.register({
            enrollmentID: username,
            enrollmentSecret: password,
            role: 'client',
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
        const wallet = await getWallet();
        
        let caURL, caName, adminLabel;
        if (role === 'faculty') {
            caURL = 'https://localhost:8054';
            caName = 'ca-faculty';
            adminLabel = 'admin-faculty';
        } else if (role === 'department_admin') {
            caURL = 'https://localhost:9054'; 
            caName = 'ca-department';
            adminLabel = 'admin-department';
        } else {
            caURL = 'https://localhost:7054'; 
            caName = 'ca-registrar';
            adminLabel = 'admin-registrar';
        }
        
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

app.post('/api/upload-grades', (req, res, next) => {
    upload.any()(req, res, (err) => {
        if (err instanceof multer.MulterError) {
            return res.status(400).json({ error: `Upload error: ${err.message}.` });
        } else if (err) {
            return res.status(500).json({ error: `Unknown upload error: ${err.message}` });
        }
        next();
    });
}, async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        req.file = req.files[0]; 

        console.log(`[UploadGrades] File received: ${req.file.filename}`);
        const filePath = req.file.path;
        const username = req.body.username || 'admin';
        const internalApiKey = process.env.INTERNAL_API_KEY || 'default-internal-secret-change-me';

        const pythonProcess = spawn('python', [
            path.join(__dirname, 'mapper.py'),
            filePath,
            path.join(__dirname, 'evidence.pdf'),
            internalApiKey
        ]);

        let output = '';
        let errorOutput = '';

        pythonProcess.on('error', (err) => {
            console.error('[Mapper] Failed to start python process:', err);
            if (!res.headersSent) {
                res.status(500).json({ status: 'error', error: 'Failed to start mapper process: ' + err.message });
            }
        });

        pythonProcess.stdout.on('data', (data) => {
            output += data.toString();
            console.log(`[Mapper] ${data}`);
        });

        pythonProcess.stderr.on('data', (data) => {
            errorOutput += data.toString();
            console.error(`[Mapper Error] ${data}`);
        });

        pythonProcess.on('close', (code) => {
            fs.unlink(filePath, (err) => {
                if (err) console.error('File cleanup error:', err);
            });

            if (!res.headersSent) {
                if (code === 0) {
                    res.status(200).json({ 
                        status: 'success', 
                        message: 'Grades processed and submitted to blockchain',
                        output: output
                    });
                } else {
                    res.status(500).json({ 
                        status: 'error',
                        error: 'Mapper process failed',
                        output: output,
                        errorOutput: errorOutput
                    });
                }
            }
        });
    } catch (error) {
        console.error('[UploadGrades] Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});



// Alias for upload-grades


app.post('/api/batch-issue-grade', async (req, res) => {
    let username;
    try {
        const internalApiKey = process.env.INTERNAL_API_KEY || 'default-internal-secret-change-me';
        if (req.headers['x-api-key'] !== internalApiKey) {
            return res.status(401).json({ error: 'Invalid or missing API key' });
        }

        // FIX: Get ACTUAL faculty identity from request (not hardcoded system-admin)
        username = req.headers['x-user-identity'] || req.body.facultyId;
        if (!username) {
            return res.status(400).json({ 
                error: 'Missing faculty identity',
                hint: 'Provide x-user-identity header or facultyId in body'
            });
        }

        // Verify faculty identity exists in wallet
        const wallet = await getWallet();
        const identity = await wallet.get(username);
        if (!identity) {
            return res.status(401).json({ 
                error: `Faculty ${username} not found in wallet`,
                hint: 'Faculty must be registered and enrolled first'
            });
        }

        // Verify it's actually a faculty identity
        if (identity.mspId !== 'FacultyMSP') {
            return res.status(403).json({ 
                error: `Access denied: ${username} is not a faculty member (MSP: ${identity.mspId})`
            });
        }

        // Get contract using ACTUAL faculty identity
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

app.post('/api/batch-upload', (req, res, next) => {
    const storage = multer.diskStorage({
        destination: (req, file, cb) => {
            if (!fs.existsSync(uploadDir)) {
                fs.mkdirSync(uploadDir, { recursive: true });
            }
            cb(null, uploadDir);
        },
        filename: (req, file, cb) => {
            // Preserve original filename
            cb(null, Date.now() + '-' + file.originalname);
        }
    });
    const uploadWithStorage = multer({ storage: storage });
    uploadWithStorage.any()(req, res, (err) => {
        if (err instanceof multer.MulterError) {
            return res.status(400).json({ error: `Upload error: ${err.message}.` });
        } else if (err) {
            return res.status(500).json({ error: `Unknown upload error: ${err.message}` });
        }
        next();
    });
}, async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        req.file = req.files[0]; // Map the first dynamically uploaded file
        const filePath = req.file.path;
        console.log(`[BatchUpload] File received: ${req.file.filename}`);
        console.log(`[BatchUpload] File path: ${filePath}`);
        console.log(`[BatchUpload] File size: ${req.file.size} bytes`);

        if (!fs.existsSync(filePath)) {
            return res.status(500).json({ error: 'File upload failed - file not found on disk' });
        }

        const mapperPath = path.resolve(__dirname, '..', 'mapper.py');
        
        if (!fs.existsSync(mapperPath)) {
            return res.status(500).json({ 
                error: 'Mapper script not found',
                expected: mapperPath
            });
        }

        const internalApiKey = process.env.INTERNAL_API_KEY || 'default-internal-secret-change-me';

        console.log(`[BatchUpload] Starting mapper: python3 ${mapperPath}`);
        const pythonProcess = spawn('python3', [
            mapperPath,
            filePath,
            internalApiKey
        ]);

        let output = '';
        let errorOutput = '';

        pythonProcess.on('error', (err) => {
            console.error('[Mapper] Failed to start python process:', err);
            if (!res.headersSent) {
                res.status(500).json({ status: 'error', error: 'Failed to start mapper process: ' + err.message });
            }
        });

        pythonProcess.stdout.on('data', (data) => {
            output += data.toString();
            console.log(`[Mapper] ${data}`);
        });

        pythonProcess.stderr.on('data', (data) => {
            errorOutput += data.toString();
            console.error(`[Mapper Error] ${data}`);
        });

        pythonProcess.on('close', (code) => {
            fs.unlink(filePath, (err) => {
                if (err) console.error('File cleanup error:', err);
            });

            if (!res.headersSent) {
                if (code === 0) {
                    res.status(200).json({ 
                        status: 'success', 
                        message: 'Batch grades processed successfully',
                        output: output
                    });
                } else {
                    res.status(500).json({ 
                        status: 'error',
                        error: 'Mapper process failed',
                        exitCode: code,
                        output: output,
                        errorOutput: errorOutput
                    });
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
        console.error('[BatchUpload] Error:', error.message);
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
