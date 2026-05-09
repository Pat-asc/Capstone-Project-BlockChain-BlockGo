const FabricCAServices = require('fabric-ca-client');
const { Wallets } = require('fabric-network');
const path = require('path');
require('dotenv').config();
require('dotenv').config({ path: path.resolve(__dirname, '../network/.env'), override: true });
const crypto = require('crypto');

async function main() {
    try {
        // --- Use CouchDB Wallet ---
        let couchUrl = process.env.COUCHDB_WALLET_URL;
        if (!couchUrl && process.env.COUCHDB_USER && process.env.COUCHDB_PASS) {
            couchUrl = `http://${process.env.COUCHDB_USER}:${process.env.COUCHDB_PASS}@127.0.0.1:5990`;
        }
        if (!couchUrl) {
            throw new Error("CouchDB wallet URL or credentials not found in .env");
        }
        const wallet = await Wallets.newCouchDBWallet(couchUrl, 'fabric_wallet');

        // --- Apply Encryption Wrapper ---
        const encryptionKey = process.env.WALLET_ENCRYPTION_KEY;
        if (encryptionKey) {
            const originalPut = wallet.put.bind(wallet);
            wallet.put = async (label, identity) => {
                if (identity && identity.credentials && identity.credentials.privateKey) {
                    const salt = crypto.randomBytes(16);
                    const key = crypto.scryptSync(encryptionKey, salt, 32);
                    const iv = crypto.randomBytes(12);
                    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
                    let encrypted = cipher.update(identity.credentials.privateKey, 'utf8', 'hex');
                    encrypted += cipher.final('hex');
                    const authTag = cipher.getAuthTag().toString('hex');
                    // Replace plain text private key with encrypted payload
                    identity.credentials.privateKey = `ENC:${salt.toString('hex')}:${iv.toString('hex')}:${authTag}:${encrypted}`;
                }
                return originalPut(label, identity);
            };
        }

        // Use the same secret as defined in docker-compose and other scripts
        const enrollSecret = process.env.BOOTSTRAP_REGISTRAR_PASS || 'adminpw';

        // 1. Enroll Registrar Admin
        const caRegistrar = new FabricCAServices('https://localhost:7054', { verify: false }, 'ca-registrar');
        const enrollmentReq = await caRegistrar.enroll({
            enrollmentID: 'admin',
            enrollmentSecret: enrollSecret
        });
        await wallet.put('admin-registrar', {
            credentials: { certificate: enrollmentReq.certificate, privateKey: enrollmentReq.key.toBytes() },
            mspId: 'RegistrarMSP',
            type: 'X.509',
        });
        console.log('Successfully enrolled and encrypted admin-registrar (Port 7054)');

        // 2. Enroll Faculty Admin
        const caFaculty = new FabricCAServices('https://localhost:8054', { verify: false }, 'ca-faculty');
        const enrollmentFac = await caFaculty.enroll({
            enrollmentID: 'admin',
            enrollmentSecret: enrollSecret
        });
        await wallet.put('admin-faculty', {
            credentials: { certificate: enrollmentFac.certificate, privateKey: enrollmentFac.key.toBytes() },
            mspId: 'FacultyMSP',
            type: 'X.509',
        });
        console.log('Successfully enrolled and encrypted admin-faculty (Port 8054)');

        // 3. Enroll Department Admin
        const caDept = new FabricCAServices('https://localhost:9054', { verify: false }, 'ca-department');
        const enrollmentDept = await caDept.enroll({
            enrollmentID: 'admin',
            enrollmentSecret: enrollSecret
        });
        await wallet.put('admin-department', {
            credentials: { certificate: enrollmentDept.certificate, privateKey: enrollmentDept.key.toBytes() },
            mspId: 'DepartmentMSP',
            type: 'X.509',
        });
        console.log('Successfully enrolled and encrypted admin-department (Port 9054)');

    } catch (error) {
        console.error(`Failed to enroll admins: ${error}`);
    }
}
main();