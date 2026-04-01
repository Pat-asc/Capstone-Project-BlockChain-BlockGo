const FabricCAServices = require('fabric-ca-client');
const { Wallets } = require('fabric-network');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../network/.env'), override: true });

async function enrollRegistrar() {
    try {
        let couchUrl = process.env.COUCHDB_WALLET_URL;
        if (!couchUrl && process.env.COUCHDB_USER && process.env.COUCHDB_PASS) {
            couchUrl = `http://${process.env.COUCHDB_USER}:${process.env.COUCHDB_PASS}@127.0.0.1:5989`;
        }
        if (!couchUrl) return console.log("CouchDB URL not found");

        const wallet = await Wallets.newCouchDBWallet(couchUrl, 'fabric_wallet');
        const existing = await wallet.get('registrar@plv.edu.ph');
        if (existing) {
            console.log("✓ Registrar already in wallet");
            return;
        }

        console.log("Enrolling registrar with CA...");
        const ca = new FabricCAServices('https://localhost:7054', { verify: false }, 'ca-registrar');
        const enrollment = await ca.enroll({ enrollmentID: 'admin', enrollmentSecret: 'adminpw' });
        await wallet.put('registrar@plv.edu.ph', {
            credentials: { certificate: enrollment.certificate, privateKey: enrollment.key.toBytes() },
            mspId: 'RegistrarMSP',
            type: 'X.509',
        });
        console.log("✓ Registrar enrolled successfully");
    } catch (error) {
        console.log("Enrollment skipped or error:", error.message);
    }
}
enrollRegistrar();
