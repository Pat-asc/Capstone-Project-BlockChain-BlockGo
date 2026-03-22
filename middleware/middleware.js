const FabricCAServices = require('fabric-ca-client');
require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { Gateway, Wallets } = require('fabric-network');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { spawn } = require('child_process');
const upload = multer({ dest: 'uploads/' });

const app = express();
app.use(express.json());

// --- 1. POSTGRESQL CONNECTION & INITIALIZATION ---
const db = new Pool({
    user: process.env.POSTGRES_USER || 'postgres',
    host: process.env.POSTGRES_HOST || 'localhost',
    database: process.env.POSTGRES_DB || 'ActivityLogs',
    password: process.env.POSTGRES_PASS || 'password',
    port: process.env.POSTGRES_PORT || 5432,
});

async function getWallet() {
    // Example: COUCHDB_WALLET_URL="http://admin:password@localhost:5984"
    if (process.env.COUCHDB_WALLET_URL) {
        return await Wallets.newCouchDBWallet(process.env.COUCHDB_WALLET_URL, 'fabric_wallet');
    }
    const walletPath = path.resolve(__dirname, process.env.WALLET_PATH || 'wallet');
    return await Wallets.newFileSystemWallet(walletPath);
}

const JWT_SECRET = process.env.JWT_SECRET || 'capstone-super-secret-key';

const authenticateJWT = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        jwt.verify(token, JWT_SECRET, (err, user) => {
            if (err) return res.status(403).json({ error: "Invalid or expired token." });
            req.user = user;
            next();
        });
    } else {
        next();
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

async function getContractForUser(username) {
    if (!username) {
        throw new Error('No identity provided. Transaction requires a valid username/identity.');
    }

    const wallet = await getWallet();

    const identity = await wallet.get(username);
    if (!identity) {
        throw new Error(`Access Denied: Wallet identity for '${username}' not found. The Registrar must register this user first.`);
    }

    const ccpPath = path.resolve(__dirname, process.env.CONNECTION_PROFILE_PATH || 'connection.json');
    const ccp = JSON.parse(fs.readFileSync(ccpPath, 'utf8'));
    if (!ccp.organizations) ccp.organizations = {};
    
    let clientOrg = null;
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

    return { contract, gateway }; 
}

const getCallerIdentity = (req) => {
    if (req.user && req.user.username) return req.user.username;
    return req.headers['x-user-identity'] || req.body.facultyId || req.body.ApprovedBy || 'admin'; 
};  

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        const userResult = await db.query('SELECT * FROM Users WHERE email = $1', [username]);
        if (userResult.rows.length === 0) {
            return res.status(401).json({ error: "Invalid credentials." });
        }
        
        const userRecord = userResult.rows[0];
        
        if (userRecord.status === 'pending') {
            return res.status(403).json({ error: "Account pending administrative approval." });
        }

        const validPassword = await bcrypt.compare(password, userRecord.password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: "Invalid credentials." });
        }

        const wallet = await getWallet();
        const identity = await wallet.get(username);
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

app.post('/api/fabric/register-user', async (req, res) => {
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

// --- BOOTSTRAP ROOT ADMIN (Solves the Catch-22 of needing an admin to approve an admin) ---
app.get('/api/bootstrap', async (req, res) => {
    try {
        const email = 'registrar@plv.edu.ph';
        const pass = 'admin123';

        const userCheck = await db.query('SELECT * FROM Users WHERE email = $1', [email]);
        if (userCheck.rows.length > 0) return res.json({ message: "Registrar already exists in DB." });

        // 1. Insert Master Admin into Database as APPROVED
        const hash = await bcrypt.hash(pass, 10);
        const userRes = await db.query("INSERT INTO Users (email, password_hash, role, status) VALUES ($1, $2, 'registrar', 'APPROVED') RETURNING id", [email, hash]);
        await db.query("INSERT INTO AdminProfiles (user_id, full_name, admin_level) VALUES ($1, 'System Registrar', 'registrar')", [userRes.rows[0].id]);

        // 2. Call the internal bridge to create the Fabric wallet
        const result = await fetch(`http://127.0.0.1:${process.env.PORT || 4000}/api/fabric/register-user`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email, role: 'registrar' })
        });

        const walletResponse = await result.json();
        res.json({ message: "Root registrar created successfully!", email, password: pass, wallet: walletResponse });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        
        const user = await db.query('SELECT * FROM Users WHERE email = $1', [email]);
        if (user.rows.length === 0) {
            return res.status(200).json({ message: "If that email exists, a reset link has been sent." });
        }

        const resetToken = crypto.randomBytes(32).toString('hex');
        const tokenExpiry = Date.now() + 3600000; // 1 hour

        await db.query('UPDATE Users SET reset_token = $1, reset_token_expiry = $2 WHERE email = $3', [resetToken, tokenExpiry, email]);

        // Emulating email delivery in console for testing
        console.log(`[DEV MODE] Email Sent to ${email}\nReset Link: http://localhost/reset-password?token=${resetToken}\n`);

        res.status(200).json({ message: "If that email exists, a reset link has been sent." });
    } catch (error) {
        res.status(500).json({ error: "Server error during password reset request." });
    }
});

app.post('/api/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;

        const userResult = await db.query('SELECT * FROM Users WHERE reset_token = $1 AND reset_token_expiry > $2', [token, Date.now()]);
        if (userResult.rows.length === 0) {
            return res.status(400).json({ error: "Invalid or expired token" });
        }

        const user = userResult.rows[0];
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await db.query('UPDATE Users SET password_hash = $1, reset_token = NULL, reset_token_expiry = NULL WHERE id = $2', [hashedPassword, user.id]);

        res.status(200).json({ message: "Password updated successfully. You can now log in." });
    } catch (error) {
        res.status(500).json({ error: "Server error." });
    }
});

app.post('/api/enroll', async (req, res) => {
    try {
        const { username, password, role } = req.body;
        const FabricCAServices = require('fabric-ca-client');
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
app.post('/api/register', async (req, res) => {
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
app.post('/api/revoke', async (req, res) => {
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

        res.status(200).json({ status: "success", message: `Revoked ${username}` });
    } catch (error) { 
        console.error(`[Revoke] Error:`, error.message);
        res.status(500).json({ error: "Server Exception", details: error.message }); 
    }
});
app.get('/api/all-grades', authenticateJWT, async (req, res) => {
    let gateway;
    try {
        const username = getCallerIdentity(req);
        const { contract, gateway: gw } = await getContractForUser(username);
        gateway = gw;

        console.log(`[GetAllGrades] Querying as ${username}...`);
        const result = await contract.evaluateTransaction('GetAllGrades');
        
        try {
            const grades = JSON.parse(result.toString());
            res.status(200).json({ status: 'success', data: grades });
        } catch (e) {
            res.status(200).json({ status: 'success', data: result.toString() });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    } finally {
        if (gateway) gateway.disconnect();
    }
});

app.post('/api/issue-grade', authenticateJWT, authorizeRole(['FacultyMSP']), async (req, res) => {
    let gateway;
    try {
        const username = getCallerIdentity(req);
        const { contract, gateway: gw } = await getContractForUser(username);
        gateway = gw;

        const gradeAsset = JSON.stringify(req.body);
        console.log(`[IssueGrade] Submitting as ${username}... Payload: ${gradeAsset}`);
        
        const result = await contract.submitTransaction('IssueGrade', gradeAsset);
        res.status(201).json({ status: "success", message: "Grade recorded", details: result.toString() });
    } catch (error) {
        console.error('[IssueGrade] Error:', error.message);
        res.status(500).json({ error: error.message });
    } finally {
        if (gateway) gateway.disconnect();
    }
});
app.get('/api/get-grade/:id', authenticateJWT, async (req, res) => {
    let gateway;
    try {
        const username = getCallerIdentity(req);
        const { contract, gateway: gw } = await getContractForUser(username);
        gateway = gw;

        console.log(`[ReadGrade] Fetching ${req.params.id} as ${username}...`);
        const result = await contract.evaluateTransaction('ReadGrade', req.params.id);
        
        res.status(200).json(JSON.parse(result.toString()));
    } catch (error) {
        res.status(404).json({ error: "Record not found" });
    } finally {
        if (gateway) gateway.disconnect();
    }
});
app.post('/api/update-grade', authenticateJWT, async (req, res) => {
    let gateway;
    try {
        const username = getCallerIdentity(req);
        const { contract, gateway: gw } = await getContractForUser(username);
        gateway = gw;

        const gradeAsset = JSON.stringify(req.body);
        console.log(`[UpdateGrade] Updating as ${username}`);
        
        await contract.submitTransaction('UpdateGrade', gradeAsset);
        res.status(200).json({ status: "success", message: "Grade updated" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    } finally {
        if (gateway) gateway.disconnect();
    }
});
app.post('/api/approve-grade/:id', authenticateJWT, async (req, res) => {
    let gateway;
    try {
        const username = getCallerIdentity(req);
        const { contract, gateway: gw } = await getContractForUser(username);
        gateway = gw;

        await contract.submitTransaction('ApproveGrade', req.params.id);
        res.status(200).json({ status: "success", message: "Grade approved" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    } finally {
        if (gateway) gateway.disconnect();
    }
});
app.post('/api/finalize-grade/:id', authenticateJWT, async (req, res) => {
    let gateway;
    try {
        const username = getCallerIdentity(req);
        const { contract, gateway: gw } = await getContractForUser(username);
        gateway = gw;

        await contract.submitTransaction('FinalizeRecord', req.params.id);
        res.status(200).json({ status: "success", message: "Record finalized" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    } finally {
        if (gateway) gateway.disconnect();
    }
});
app.delete('/api/wallet/:username', async (req, res) => {
    try {
        const wallet = await getWallet();
        
        const exists = await wallet.get(req.params.username);
        if (exists) {
            await wallet.remove(req.params.username);
            return res.status(200).json({ status: "success", message: "Wallet identity deleted." });
        }
        res.status(404).json({ status: "error", message: "Identity not found in wallet." });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
app.get('/api/health', (req, res) => res.status(200).json({ status: "operational", mode: 'Production Security (ABAC ACTIVE)' }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    console.log(`\nMiddleware online on port ${PORT}`);
    console.log(`Mode: Production Security (ABAC ACTIVE)`);
    console.log(` Dynamic Identity Loading: Enabled\n`);
});