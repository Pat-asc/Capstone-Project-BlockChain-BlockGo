const FabricCAServices = require('fabric-ca-client');
const { Wallets } = require('fabric-network');
const fs = require('fs');
const path = require('path');

// Load .env file from network directory to get CouchDB credentials
require('dotenv').config({ path: path.resolve(__dirname, '../network/.env'), override: true });

/**
 * Gets the wallet implementation (CouchDB or FileSystem) based on .env configuration.
 * @returns {Promise<Wallet>} A promise that resolves to the wallet instance.
 */
async function getWallet() {
    let couchUrl = process.env.COUCHDB_WALLET_URL;
    if (!couchUrl && process.env.COUCHDB_USER && process.env.COUCHDB_PASS) {
        // Default to localhost and the port exposed in docker-compose
        couchUrl = `http://${process.env.COUCHDB_USER}:${process.env.COUCHDB_PASS}@127.0.0.1:5989`;
    }

    if (couchUrl) {
        console.log(`\nConnecting to CouchDB wallet...`);
        try {
            const wallet = await Wallets.newCouchDBWallet(couchUrl, 'fabric_wallet');
            console.log('CouchDB wallet connection successful.');
            return wallet;
        } catch (error) {
            console.error(`Failed to connect to CouchDB wallet: ${error.message}`);
            console.error('Please ensure the couchdb-wallet container is running and accessible via `docker ps`.');
            process.exit(1);
        }
    }
    
    console.log('\nUsing FileSystem wallet (fallback)...');
    const walletPath = path.resolve(__dirname, process.env.WALLET_PATH || 'wallet');
    console.log(`Wallet path: ${walletPath}`);
    return await Wallets.newFileSystemWallet(walletPath);
}

/**
 * Enrolls a CA admin user and stores their identity in the wallet with a specific label.
 * @param {FabricCAServices} caClient The CA client instance.
 * @param {Wallet} wallet The wallet instance.
 * @param {string} orgMspId The MSP ID of the organization.
 * @param {string} enrollmentId The ID to use for enrollment (from CA config, e.g., 'admin').
 * @param {string} enrollmentSecret The secret for enrollment (from CA config, e.g., 'adminpw').
 * @param {string} walletLabel The label to store the identity under in the wallet (e.g., 'admin-registrar').
 */
async function enrollCAAdmin(caClient, wallet, orgMspId, enrollmentId, enrollmentSecret, walletLabel) {
    try {
        const identity = await wallet.get(walletLabel);
        if (identity) {
            console.log(`An identity for the admin user "${walletLabel}" already exists in the wallet.`);
            return;
        }

        const enrollment = await caClient.enroll({ enrollmentID: enrollmentId, enrollmentSecret: enrollmentSecret });
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
    }
}

async function main() {
    console.log('--- Running CA Admin Enrollment Script ---');
    try {
        const wallet = await getWallet();

        // The enrollment ID/secret comes from the respective fabric-ca-server-config.yaml files.
        // The wallet label is what the middleware.js application expects.
        // NOTE: This assumes all CA configs use 'admin'/'adminpw' as their bootstrap identity.

        // --- Registrar Admin ---
        const caRegistrar = new FabricCAServices('https://localhost:7054', { tlsCACerts: [], verify: false }, 'ca-registrar');
        await enrollCAAdmin(caRegistrar, wallet, 'RegistrarMSP', 'admin', 'adminpw', 'admin-registrar');

        // --- Faculty Admin ---
        const caFaculty = new FabricCAServices('https://localhost:8054', { tlsCACerts: [], verify: false }, 'ca-faculty');
        await enrollCAAdmin(caFaculty, wallet, 'FacultyMSP', 'admin', 'adminpw', 'admin-faculty');

        // --- Department Admin ---
        const caDepartment = new FabricCAServices('https://localhost:9054', { tlsCACerts: [], verify: false }, 'ca-department');
        await enrollCAAdmin(caDepartment, wallet, 'DepartmentMSP', 'admin', 'adminpw', 'admin-department');

    } catch (error) {
        console.error(`\nEnrollment script failed: ${error}`);
        process.exit(1);
    }
    console.log('\n--- Enrollment Script Finished ---');
}

main();