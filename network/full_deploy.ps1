<#
 .SYNOPSIS
 This script orchestrates the deployment of the Capstone project's Hyperledger Fabric network
 and related services from a PowerShell environment on Windows, utilizing WSL for Linux-specific operations.

 .DESCRIPTION
 This script performs the following actions:
 1. **Dependency Check & Installation:** Ensures essential tools (curl, wget, jq, Node.js, .NET SDK, React tools,
    Hyperledger Fabric binaries, PostgreSQL client) are available. Linux-specific dependencies are
    installed within WSL.
 2. **Generate Secure .ENV Credentials:** Creates or updates the .env file with necessary credentials.
 3. **Generate Cryptographic Material & Channel Artifacts:** Uses Hyperledger Fabric tools (cryptogen, configtxgen)
    to create network configurations. These operations run in WSL.
 4. **Docker Network Startup:** Brings up Docker Compose services and starts a CouchDB container for wallets.
 5. **Configuration:** Sets up environment variables required for Fabric operations.
 6. **Channel Creation & Join:** Creates the Fabric channel and ensures all peer organizations join it. These operations run in WSL.
 7. **Package Chaincode-as-a-Service (CCaaS) & Private Data:** Prepares the chaincode for deployment.
 8. **Determine Chaincode Sequence:** Checks for existing chaincode definitions to handle initial deployment or upgrade.
 9. **Install & Approve Chaincode:** Installs and approves the chaincode for each organization. These operations run in WSL.
 10. **Commit Chaincode:** Commits the chaincode definition to the channel. This operation runs in WSL.
 11. **Update ENV and Restart Chaincode:** Updates the CHAINCODE_ID in .env and restarts the chaincode container.
 12. **Test Chaincode:** Executes a basic invoke and query to verify chaincode functionality. These operations run in WSL.
 13. **Start Application Services and Frontend:** Launches the Node.js middleware, ASP.NET Core backend, and builds/serves the React frontend. This ensures all components of the application stack are running and accessible.
 14. **Bootstrap Initial Registrar:** Executes an internal process to register the primary `registrar@plv.edu.ph` user in the PostgreSQL database and provision their corresponding Hyperledger Fabric identity, enabling immediate administrative access without manual approval.
 15. **Final Instructions:** Provides the user with the URL to access the web application and the default credentials for the bootstrapped Registrar user.

 .NOTES
 Author: Gemini Code Assist
 Version: 1.0
 Date: 2024-07-30
 #>