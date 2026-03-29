const path = require('path');
require('dotenv').config();
require('dotenv').config({ path: path.resolve(__dirname, '../network/.env'), override: true });
const { Wallets } = require('fabric-network');
const crypto = require('crypto');

async function migrate() {
    console.log("--- STARTING WALLET MIGRATION ---");
    
    const walletPath = path.resolve(__dirname, process.env.WALLET_PATH || 'wallet');
    const localWallet = await Wallets.newFileSystemWallet(walletPath);
    
    // 2. Connect to CouchDB Wallet
    let couchUrl = process.env.COUCHDB_WALLET_URL;
    if (!couchUrl) {
        if (process.env.COUCHDB_USER && process.env.COUCHDB_PASS) {
            couchUrl = `http://${process.env.COUCHDB_USER}:${process.env.COUCHDB_PASS}@127.0.0.1:5989`;
        } else {
            console.error("ERROR: COUCHDB_WALLET_URL, or COUCHDB_USER and COUCHDB_PASS are not set in .env!");
            process.exit(1);
        }
    }
    console.log(`CouchDB Wallet URL: ${couchUrl}`); // Added for debugging
    const couchWallet = await Wallets.newCouchDBWallet(couchUrl, 'fabric_wallet');
    
    // 3. Apply Encryption Wrapper to CouchDB
    const encryptionKey = process.env.WALLET_ENCRYPTION_KEY;
    if (encryptionKey) {
        const originalPut = couchWallet.put.bind(couchWallet);
        couchWallet.put = async (label, identity) => {
            if (identity && identity.credentials && identity.credentials.privateKey) {
                const salt = crypto.randomBytes(16);
                const key = crypto.scryptSync(encryptionKey, salt, 32);
                const iv = crypto.randomBytes(12);
                const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
                let encrypted = cipher.update(identity.credentials.privateKey, 'utf8', 'hex');
                encrypted += cipher.final('hex');
                const authTag = cipher.getAuthTag().toString('hex');
                identity.credentials.privateKey = `ENC:${salt.toString('hex')}:${iv.toString('hex')}:${authTag}:${encrypted}`;
            }
            return originalPut(label, identity);
        };
    }

    // 4. Fetch and Migrate
    const identities = await localWallet.list();
    if (identities.length === 0) {
        console.log("No identities found in the local wallet.");
        return;
    }

    for (const label of identities) {
        console.log(`Migrating identity: ${label}...`);
        const identity = await localWallet.get(label);
        await couchWallet.put(label, identity);
        console.log(`Successfully migrated and encrypted: ${label}`);
    }

    console.log("\nMIGRATION COMPLETE! You can now safely delete the local 'wallet' folder.");
}

migrate().catch(console.error);