const FabricCAServices = require('fabric-ca-client');
const { Wallets } = require('fabric-network');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

require('dotenv').config({ path: path.resolve(__dirname, '../network/.env'), override: true });

async function getWallet() {
    let couchUrl = process.env.COUCHDB_WALLET_URL;
    if (!couchUrl && process.env.COUCHDB_USER && process.env.COUCHDB_PASS) {
        couchUrl = `http://${process.env.COUCHDB_USER}:${process.env.COUCHDB_PASS}@127.0.0.1:5990`;
    }

    if (couchUrl) {
        console.log(`\nConnecting to CouchDB wallet...`);
        try {
            const wallet = await Wallets.newCouchDBWallet(couchUrl, 'fabric_wallet');
            console.log('CouchDB wallet connection successful.');
            
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
                            ivHex = ivPart; authTagHex = authTagPart; encryptedHex = encryptedPart;
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
        } catch (error) {
            console.error(`Failed to connect to CouchDB wallet: ${error.message}`);
            process.exit(1);
        }
    }
    
    console.log('\nUsing FileSystem wallet (fallback)...');
    const walletPath = path.resolve(__dirname, process.env.WALLET_PATH || 'wallet');
    return await Wallets.newFileSystemWallet(walletPath);
}

async function enrollCAAdmin(caClient, wallet, orgMspId, enrollmentId, enrollmentSecret, walletLabel) {
    try {
        const identity = await wallet.get(walletLabel);
        if (identity) {
            console.log(`[${walletLabel}] Stale identity found in CouchDB wallet. Removing for fresh deployment...`);
            await wallet.remove(walletLabel); // FORCE WIPE GHOST KEYS
        }

        const enrollment = await caClient.enroll({
            enrollmentID: enrollmentId,
            enrollmentSecret: enrollmentSecret
        });
        const x509Identity = {
            credentials: {
                certificate: enrollment.certificate,
                privateKey: enrollment.key.toBytes(),
            },
            mspId: orgMspId,
            type: 'X.509',
        };
        await wallet.put(walletLabel, x509Identity);
        console.log(`Successfully enrolled admin user "${enrollmentId}" and imported it into the wallet as "${walletLabel}".`);

    } catch (error) {
        console.error(`Failed to enroll admin user "${walletLabel}": ${error.message}`);
        throw error; // Force failure so it doesn't cascade
    }
}

async function bootstrapRootUser(wallet) {
    console.log('\n--- Bootstrapping Root Registrar User ---');
    const dbRead = new Pool({
        user: process.env.POSTGRES_USER || 'postgres',
        host: process.env.POSTGRES_HOST === 'postgres' ? '127.0.0.1' : (process.env.POSTGRES_HOST || '127.0.0.1'),
        database: process.env.POSTGRES_DB || 'ActivityLogs',
        password: process.env.POSTGRES_PASS || 'password',
        port: process.env.POSTGRES_PORT || 5432,
    });

    let mainIp = process.env.MAIN_CAMPUS_IP;
    if (mainIp === 'host-gateway') mainIp = '127.0.0.1';

    const dbWrite = new Pool({
        user: process.env.POSTGRES_USER || 'postgres',
        host: mainIp || process.env.POSTGRES_HOST || '127.0.0.1',
        database: process.env.POSTGRES_DB || 'ActivityLogs',
        password: process.env.POSTGRES_PASS || 'password',
        port: process.env.POSTGRES_PORT || 5432,
    });

    try {
        const email = process.env.BOOTSTRAP_REGISTRAR_EMAIL || 'registrar@plv.edu.ph';
        const pass = process.env.BOOTSTRAP_REGISTRAR_PASS || 'adminpw';

        const userCheck = await dbRead.query('SELECT * FROM Users WHERE email = $1', [email]);
        let identityExists = await wallet.get(email);

        // If Postgres is empty but CouchDB isn't, CouchDB has stale data. Flush it.
        if (userCheck.rows.length === 0 && identityExists) {
            console.log(`Stale wallet identity found for ${email} without DB record. Removing...`);
            await wallet.remove(email);
            identityExists = false;
        }

        if (userCheck.rows.length > 0 && identityExists) {
            console.log('Root registrar user already exists in DB and Wallet. Skipping bootstrap.');
            return;
        }

        if (userCheck.rows.length === 0) {
            console.log('Root registrar not found in database. Creating...');
            const hash = await bcrypt.hash(pass, 10);
            const userRes = await dbWrite.query("INSERT INTO Users (email, password_hash, role, status) VALUES ($1, $2, 'registrar', 'APPROVED') RETURNING id", [email, hash]);
            await dbWrite.query("INSERT INTO AdminProfiles (user_id, full_name, admin_level) VALUES ($1, 'System Registrar', 'registrar')", [userRes.rows[0].id]);
            console.log('Root registrar created in database.');
        }

        if (!identityExists) {
            console.log('Root registrar wallet identity not found. Creating...');
            const { caURL, caName, adminLabel, mspId } = { caURL: 'https://localhost:7054', caName: 'ca-registrar', adminLabel: 'admin-registrar', mspId: 'RegistrarMSP' };
            
            const ca = new FabricCAServices(caURL, { verify: false }, caName);
            const adminIdentity = await wallet.get(adminLabel);
            if (!adminIdentity) {
                throw new Error(`Prerequisite failed: Blockchain Admin '${adminLabel}' not found in wallet.`);
            }

            const provider = wallet.getProviderRegistry().getProvider(adminIdentity.type);
            const adminUser = await provider.getUserContext(adminIdentity, 'admin');

            try {
                await ca.register({
                    enrollmentID: email,
                    enrollmentSecret: pass,
                    role: 'admin',
                    attrs: [{ name: 'role', value: 'registrar', ecert: true }]
                }, adminUser);
            } catch (regErr) {
                if (regErr.toString().includes('is already registered')) {
                    console.log(`Identity ${email} already registered in CA. Forcing password update...`);
                    const identityService = ca.newIdentityService();
                    await identityService.update(email, { enrollmentSecret: pass }, adminUser);
                } else {
                    throw regErr;
                }
            }

        const enrollment = await ca.enroll({
            enrollmentID: email,
            enrollmentSecret: pass
        });
            const x509Identity = { credentials: { certificate: enrollment.certificate, privateKey: enrollment.key.toBytes() }, mspId: mspId, type: 'X.509' };
            await wallet.put(email, x509Identity);
            console.log('Root registrar wallet identity created successfully.');
        }
    } finally {
        await dbRead.end();
        await dbWrite.end();
    }
}

async function bootstrapMockStudents(wallet) {
    console.log('\n--- Bootstrapping Mock Students Wallets ---');
    const ca = new FabricCAServices('https://localhost:7054', { verify: false }, 'ca-registrar');
    const adminIdentity = await wallet.get('admin-registrar');
    
    if (!adminIdentity) {
        console.warn('admin-registrar not found, skipping mock student wallet generation.');
        return;
    }
    
    const provider = wallet.getProviderRegistry().getProvider(adminIdentity.type);
    const adminUser = await provider.getUserContext(adminIdentity, 'admin');

    const mockData = [
        { email: 'mock.student1@plv.edu.ph', pass: '05/15/2005' },
        { email: 'mock.student2@plv.edu.ph', pass: '06/20/2004' },
        { email: 'mock.student3@plv.edu.ph', pass: '03/10/2005' },
        { email: 'mock.student4@plv.edu.ph', pass: '11/25/2003' },
        { email: 'mock.student5@plv.edu.ph', pass: '08/05/2004' },
        { email: 'mock.student6@plv.edu.ph', pass: '01/12/2005' },
        { email: 'mock.student7@plv.edu.ph', pass: '07/30/2003' },
        { email: 'mock.student8@plv.edu.ph', pass: '04/18/2004' },
        { email: 'mock.student9@plv.edu.ph', pass: '12/22/2005' },
        { email: 'mock.student10@plv.edu.ph', pass: '09/08/2003' }
    ];

    for (const student of mockData) {
        const { email, pass } = student;
        const identityExists = await wallet.get(email);
        
        if (!identityExists) {
            try {
                await ca.register({
                    enrollmentID: email,
                    enrollmentSecret: pass,
                    role: 'client',
                    attrs: [
                        { name: 'role', value: 'student', ecert: true },
                        { name: 'grade.manage', value: 'false', ecert: true }
                    ]
                }, adminUser);
            } catch (regErr) {
                if (!regErr.toString().includes('is already registered')) {
                    console.error(`Failed to register ${email}: ${regErr.message}`);
                    continue;
                }
            }

            try {
                const enrollment = await ca.enroll({ enrollmentID: email, enrollmentSecret: pass });
                const x509Identity = { credentials: { certificate: enrollment.certificate, privateKey: enrollment.key.toBytes() }, mspId: 'RegistrarMSP', type: 'X.509' };
                await wallet.put(email, x509Identity);
                console.log(`Generated Fabric Wallet for mock student: ${email}`);
            } catch (enrollErr) {
                console.error(`Failed to enroll ${email}: ${enrollErr.message}`);
            }
        }
    }
}

async function main() {
    console.log('--- Running CA Admin Enrollment Script ---');
    try {
        const wallet = await getWallet();
        const enrollSecret = process.env.BOOTSTRAP_REGISTRAR_PASS || 'adminpw';
        const caRegistrar = new FabricCAServices('https://localhost:7054', { tlsCACerts: [], verify: false }, 'ca-registrar');
        await enrollCAAdmin(caRegistrar, wallet, 'RegistrarMSP', 'admin', enrollSecret, 'admin-registrar');
        const caFaculty = new FabricCAServices('https://localhost:8054', { tlsCACerts: [], verify: false }, 'ca-faculty');
        await enrollCAAdmin(caFaculty, wallet, 'FacultyMSP', 'admin', enrollSecret, 'admin-faculty');
        const caDepartment = new FabricCAServices('https://localhost:9054', { tlsCACerts: [], verify: false }, 'ca-department');
        await enrollCAAdmin(caDepartment, wallet, 'DepartmentMSP', 'admin', enrollSecret, 'admin-department');
        await bootstrapRootUser(wallet);
        await bootstrapMockStudents(wallet);

    } catch (error) {
        console.error(`\nEnrollment script failed: ${error}`);
        process.exit(1);
    }
    console.log('\n--- Enrollment Script Finished ---');
}
main();