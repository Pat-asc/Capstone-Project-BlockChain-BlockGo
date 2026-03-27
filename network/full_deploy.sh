#!/bin/bash

# --- 0. DEPENDENCY CHECK & INSTALLATION ---
echo "--- CHECKING AND INSTALLING DEPENDENCIES ---"

# Determine if sudo is needed
SUDO=""
if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
fi

install_deps() {
    echo "Ensuring curl and wget are installed..."
    $SUDO apt-get install -y curl wget netcat >/dev/null 2>&1

    echo "Checking Node.js and npm..."
    if ! command -v node >/dev/null 2>&1; then
        echo "Installing Node.js and npm..."
        curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO bash -
        $SUDO apt-get install -y nodejs
    else
        echo "Node.js is already installed ($(node -v))"
    fi

    echo "Checking .NET SDK..."
    if ! command -v dotnet >/dev/null 2>&1; then
        echo "Installing .NET SDK..."
        # Assumes Ubuntu 22.04/20.04 for the package configuration
        wget https://packages.microsoft.com/config/ubuntu/22.04/packages-microsoft-prod.deb -O packages-microsoft-prod.deb
        $SUDO dpkg -i packages-microsoft-prod.deb
        rm packages-microsoft-prod.deb
        $SUDO apt-get update
        $SUDO apt-get install -y dotnet-sdk-8.0
    else
        echo ".NET SDK is already installed ($(dotnet --version))"
    fi

    echo "Checking React tools..."
    if ! command -v create-react-app >/dev/null 2>&1; then
        echo "Installing React tools (create-react-app)..."
        $SUDO npm install -g create-react-app
    else
        echo "React tools are already installed"
    fi

    echo "Checking Hyperledger Fabric binaries..."
    if ! command -v peer >/dev/null 2>&1; then
        echo "Installing Hyperledger Fabric binaries..."
        curl -sSL https://bit.ly/2ysbOFE | bash -s -- 2.5.4 1.5.7 -d -s
        export PATH=$PATH:$(pwd)/bin
        export FABRIC_CFG_PATH=$(pwd)/config
    else
        echo "Hyperledger Fabric binaries are already installed"
    fi

    echo "Checking PostgreSQL..."
    if ! command -v psql >/dev/null 2>&1; then
        echo "Installing PostgreSQL..."
        $SUDO apt-get install -y postgresql postgresql-contrib
        $SUDO systemctl enable --now postgresql || true
    else
        echo "PostgreSQL is already installed ($(psql -V | head -n 1))"
    fi
}

if command -v apt-get >/dev/null 2>&1; then
    # Suppress apt-get update output, but run it
    $SUDO apt-get update -yqq >/dev/null 2>&1 || true
    install_deps
else
    echo "'apt-get' not found (Not Debian/Ubuntu). Skipping automated dependency installation."
fi
echo "--- DEPENDENCIES READY ---"

# --- 0.2 GENERATE SECURE .ENV CREDENTIALS ---
echo "--- CHECKING/GENERATING SECURE CREDENTIALS ---"
ENV_FILE="$(pwd)/.env"
if [ ! -f "$ENV_FILE" ]; then
    touch "$ENV_FILE"
fi

add_to_env_if_missing() {
    local KEY=$1
    local VAL=$2
    if ! grep -q "^${KEY}=" "$ENV_FILE"; then
        echo "${KEY}=${VAL}" >> "$ENV_FILE"
        echo "Generated new secure value for ${KEY}"
    fi
}

# Generate random, strong hex passwords and users (ensuring standard chars only)
add_to_env_if_missing "COUCHDB_USER" "admin_$(openssl rand -hex 4)"
add_to_env_if_missing "COUCHDB_PASS" "$(openssl rand -hex 12)"

LOCAL_COUCH_USER=$(grep "^COUCHDB_USER=" "$ENV_FILE" | cut -d '=' -f 2)
LOCAL_COUCH_PASS=$(grep "^COUCHDB_PASS=" "$ENV_FILE" | cut -d '=' -f 2)
add_to_env_if_missing "COUCHDB_WALLET_URL" "http://${LOCAL_COUCH_USER}:${LOCAL_COUCH_PASS}@127.0.0.1:5985"
add_to_env_if_missing "WALLET_ENCRYPTION_KEY" "$(openssl rand -hex 32)"

add_to_env_if_missing "POSTGRES_USER" "pg_user_$(openssl rand -hex 4)"
add_to_env_if_missing "POSTGRES_PASS" "$(openssl rand -hex 12)"
add_to_env_if_missing "POSTGRES_DB" "ActivityLogs"
# Add placeholders for email service credentials
add_to_env_if_missing "EMAIL_HOST" "smtp.gmail.com"
add_to_env_if_missing "EMAIL_PORT" "587"
add_to_env_if_missing "EMAIL_USER" "plv.registrar.blockgo@gmail.com"
add_to_env_if_missing "EMAIL_PASS" "wrqs zerf chfx xcrm"
add_to_env_if_missing "EMAIL_FROM" "'PLV Registrar' <noreply@capstone.com>"

echo "--- SECURE CREDENTIALS READY IN .ENV ---"

# --- 0.5 DOCKER NETWORK STARTUP ---
echo "--- STARTING DOCKER CONTAINERS ---"
if ! command -v docker >/dev/null 2>&1; then
    echo "Docker is not installed! Please install Docker to proceed."
    exit 1
fi

if ! docker info >/dev/null 2>&1; then
    echo "Docker daemon is not running or you do not have permissions to access it."
    echo "Please ensure Docker is running and your user is in the 'docker' group (e.g., 'sudo usermod -aG docker $USER && newgrp docker')."
    exit 1
fi

if ! command -v docker compose >/dev/null 2>&1 && ! command -v docker-compose >/dev/null 2>&1; then
    echo "Docker Compose (v1 or v2) is not installed! Please install it to proceed."
    exit 1
fi

if [ -f "docker-compose.yaml" ] || [ -f "docker-compose.yml" ]; then
    # Ensure build directory exists before docker mounts it (prevents root permission issues)
    if [ -d "../frontend" ]; then
        mkdir -p ../frontend/build
    fi

    echo "Bringing up Docker Compose services..."
    # Support both 'docker compose' (v2) and 'docker-compose' (v1)
    docker compose up -d 2>/dev/null || docker-compose up -d
    echo "Waiting 15 seconds for containers to properly initialize..."
    sleep 15
else
    echo "No docker-compose.yaml found in $(pwd). Skipping automated container startup."
fi

echo "--- STARTING COUCHDB FOR WALLETS ---"
# Run a dedicated CouchDB container for wallets on port 5985 to avoid conflicts with Fabric state DBs
if docker ps -a --format '{{.Names}}' | grep -Eq "^couchdb-wallet\$"; then
    docker start couchdb-wallet >/dev/null
    echo "CouchDB for wallets (existing) started on port 5985."
else
    docker run -d --name couchdb-wallet -p 5985:5984 -e COUCHDB_USER=${LOCAL_COUCH_USER} -e COUCHDB_PASSWORD=${LOCAL_COUCH_PASS} couchdb:3.3 >/dev/null
    echo "New CouchDB container for wallets created and started on port 5985."
fi

# --- 1. CONFIGURATION ---
export CHANNEL_NAME="registrar-channel"
export CC_NAME="registrar"
export CC_VERSION="1.0"
export CC_SEQUENCE="1"
# Simplified policy for testing; ensure it matches your requirements
export CC_POLICY="OR('RegistrarMSP.member', 'FacultyMSP.member', 'DepartmentMSP.member')"
export CC_LABEL="${CC_NAME}_${CC_VERSION}"

# TLS Cert Paths
export CRYPTO_PATH="$(pwd)/crypto-config"
export ORDERER_CA="${CRYPTO_PATH}/ordererOrganizations/capstone.com/orderers/orderer.capstone.com/tls/ca.crt"

# Peer TLS Root Certs
export REGISTRAR_CA="${CRYPTO_PATH}/peerOrganizations/registrar.capstone.com/peers/peer0.registrar.capstone.com/tls/ca.crt"
export FACULTY_CA="${CRYPTO_PATH}/peerOrganizations/faculty.capstone.com/peers/peer0.faculty.capstone.com/tls/ca.crt"
export DEPT_CA="${CRYPTO_PATH}/peerOrganizations/department.capstone.com/peers/peer0.department.capstone.com/tls/ca.crt"

echo "--- STARTING FAIL-PROOF DEPLOYMENT ---"

# --- 1.5 FAIL-PROOF TLS CHECK ---
echo "Checking TLS certificates..."
for cert in "$ORDERER_CA" "$REGISTRAR_CA" "$FACULTY_CA" "$DEPT_CA"; do
    if [ ! -f "$cert" ]; then
        echo "FATAL ERROR: TLS Certificate not found at $cert"
        echo "Make sure your crypto-config folder is properly generated and mounted to the CLI container."
        exit 1
    fi
done
echo "All TLS certificates verified."

# --- 2. HELPER: SWITCH IDENTITY ---
setIdentity() {
    local ORG=$1
    # IMPORTANT: Internal Docker Port is ALWAYS 7051
    if [ "$ORG" == "registrar" ]; then
        export CORE_PEER_LOCALMSPID="RegistrarMSP"
        export CORE_PEER_ADDRESS="peer0.registrar.capstone.com:7051"
        export CORE_PEER_MSPCONFIGPATH="${CRYPTO_PATH}/peerOrganizations/registrar.capstone.com/users/Admin@registrar.capstone.com/msp"
        export CORE_PEER_TLS_ROOTCERT_FILE=$REGISTRAR_CA
    elif [ "$ORG" == "faculty" ]; then
        export CORE_PEER_LOCALMSPID="FacultyMSP"
        export CORE_PEER_ADDRESS="peer0.faculty.capstone.com:7051"
        export CORE_PEER_MSPCONFIGPATH="${CRYPTO_PATH}/peerOrganizations/faculty.capstone.com/users/Admin@faculty.capstone.com/msp"
        export CORE_PEER_TLS_ROOTCERT_FILE=$FACULTY_CA
    elif [ "$ORG" == "department" ]; then
        export CORE_PEER_LOCALMSPID="DepartmentMSP"
        export CORE_PEER_ADDRESS="peer0.department.capstone.com:7051"
        export CORE_PEER_MSPCONFIGPATH="${CRYPTO_PATH}/peerOrganizations/department.capstone.com/users/Admin@department.capstone.com/msp"
        export CORE_PEER_TLS_ROOTCERT_FILE=$DEPT_CA
    fi
}

# --- 3. CHANNEL CREATION (With Retry Logic) ---
setIdentity "registrar"
echo "Creating channel: $CHANNEL_NAME..."
MAX_RETRY=5
COUNTER=1
while [ $COUNTER -le $MAX_RETRY ]; do
    peer channel create -o orderer.capstone.com:7050 -c $CHANNEL_NAME \
        -f $(pwd)/channel-artifacts/${CHANNEL_NAME}.tx \
        --tls true --cafile $ORDERER_CA --outputBlock ./${CHANNEL_NAME}.block
    
    if [ $? -eq 0 ]; then
        echo "Channel created successfully!"
        break
    else
        echo "Orderer not ready yet (Attempt $COUNTER/$MAX_RETRY). Waiting 5s..."
        sleep 5
        COUNTER=$((COUNTER+1))
    fi
done

# --- 4. JOIN CHANNEL ---
for ORG in "registrar" "faculty" "department"; do
    setIdentity $ORG
    echo "Joining $ORG peer to $CHANNEL_NAME..."
    peer channel join -b ./${CHANNEL_NAME}.block
done

# --- 5. PACKAGE CCAAS & PRIVATE DATA ---
echo "Packaging Chaincode-as-a-Service and generating Private Data Collections..."

# --- Production Hardening: Generate TLS certs for chaincode service ---
mkdir -p ./chaincode-tls
if [ ! -f "./chaincode-tls/server.key" ]; then
    echo "Generating self-signed TLS certificate for chaincode service..."
    openssl req -newkey rsa:2048 -nodes -keyout ./chaincode-tls/server.key -x509 -days 3650 -out ./chaincode-tls/server.crt -subj "/CN=registrar-chaincode.capstone.com"
fi

# Create the inner code package containing connection.json
# For production, we enable TLS and provide the chaincode's root cert to the peer.
CC_TLS_CERT_B64=$(base64 -w 0 ./chaincode-tls/server.crt)
cat <<EOF > connection.json
{
  "address": "registrar-chaincode:9999",
  "dial_timeout": "10s",
  "tls_required": true,
  "client_auth_required": true,
  "root_cert": "${CC_TLS_CERT_B64}"
}
EOF
tar cfz code.tar.gz connection.json

# Create the metadata file
echo '{"path": "", "type": "ccaas", "label": "'${CC_LABEL}'"}' > metadata.json

# Create the final installable package (Outer tar)
tar cfz ${CC_NAME}.tar.gz metadata.json code.tar.gz

# Dynamically Generate the Collections Config File
cat <<EOF > collections.json
[
  {
     "name": "collectionGrades",
     "policy": "OR('RegistrarMSP.member', 'FacultyMSP.member', 'DepartmentMSP.member')",
     "requiredPeerCount": 0,
     "maxPeerCount": 3,
     "blockToLive": 0,
     "memberOnlyRead": true
  }
]
EOF
export CC_COLLECTIONS_CONFIG="$(pwd)/collections.json"

# --- 6. INSTALL & APPROVE ---
for ORG in "registrar" "faculty" "department"; do
    setIdentity $ORG
    echo "Installing CC on $ORG..."
    peer lifecycle chaincode install ${CC_NAME}.tar.gz
    
    # Grab the Package ID from the specific peer
    PACKAGE_ID=$(peer lifecycle chaincode queryinstalled | sed -n 's/.*Package ID: \([^,]*\).*/\1/p')
    echo "Approving CC for $ORG (ID: $PACKAGE_ID)..."
    
    peer lifecycle chaincode approveformyorg -o orderer.capstone.com:7050 --tls true --cafile $ORDERER_CA \
        --channelID $CHANNEL_NAME --name $CC_NAME --version $CC_VERSION \
        --package-id "$PACKAGE_ID" --sequence $CC_SEQUENCE --signature-policy "$CC_POLICY" \
        --collections-config $CC_COLLECTIONS_CONFIG
done

# --- 7. COMMIT ---
setIdentity "registrar"
echo "Committing chaincode definition to channel..."
peer lifecycle chaincode commit -o orderer.capstone.com:7050 --tls true --cafile $ORDERER_CA \
    --channelID $CHANNEL_NAME --name $CC_NAME --version $CC_VERSION \
    --sequence $CC_SEQUENCE --signature-policy "$CC_POLICY" \
    --collections-config $CC_COLLECTIONS_CONFIG \
    --peerAddresses peer0.registrar.capstone.com:7051 --tlsRootCertFiles $REGISTRAR_CA \
    --peerAddresses peer0.faculty.capstone.com:7051 --tlsRootCertFiles $FACULTY_CA \
    --peerAddresses peer0.department.capstone.com:7051 --tlsRootCertFiles $DEPT_CA

echo "--- DEPLOYMENT SUCCESSFUL --- "
echo "Final Package ID: $PACKAGE_ID"
echo "Private Data Collections injected seamlessly."

# --- 7.5 UPDATE ENV AND RESTART CHAINCODE ---
echo "--- UPDATING CHAINCODE ENVIRONMENT ---"
if [ ! -f ".env" ]; then
    touch .env
fi

if grep -q "^CHAINCODE_ID=" .env; then
    sed -i "s|^CHAINCODE_ID=.*|CHAINCODE_ID=$PACKAGE_ID|" .env
else
    echo "CHAINCODE_ID=$PACKAGE_ID" >> .env
fi
echo "Updated .env with CHAINCODE_ID=$PACKAGE_ID"

echo "Restarting registrar-chaincode container to pick up new ID..."
docker compose up -d --no-deps --force-recreate registrar-chaincode 2>/dev/null || docker-compose up -d --no-deps --force-recreate registrar-chaincode

# --- 8. TEST CHAINCODE (INVOKE & QUERY) ---
echo "--- TESTING CHAINCODE ---"
echo "Waiting 10 seconds for chaincode containers to initialize..."
sleep 10

echo "Submitting an Invoke transaction (InitLedger)..."
peer chaincode invoke -o orderer.capstone.com:7050 --tls true --cafile $ORDERER_CA \
    -C $CHANNEL_NAME -n $CC_NAME \
    --peerAddresses peer0.registrar.capstone.com:7051 --tlsRootCertFiles $REGISTRAR_CA \
    --peerAddresses peer0.faculty.capstone.com:7051 --tlsRootCertFiles $FACULTY_CA \
    --peerAddresses peer0.department.capstone.com:7051 --tlsRootCertFiles $DEPT_CA \
    -c '{"Args":["InitLedger"]}'

echo "Waiting 5 seconds for transaction to commit..."
sleep 5

echo "Querying the ledger to verify data..."
peer chaincode query -C $CHANNEL_NAME -n $CC_NAME -c '{"Args":["GetAllAssets"]}' || echo "Note: Update 'GetAllAssets' to match your chaincode's query function if needed."

# --- 9. START MIDDLEWARE & FRONTEND ---
echo "--- STARTING APPLICATION SERVICES ---"

echo "Starting C# Backend (client-app)..."
if [ -d "../client-app" ]; then
    cd ../client-app
    echo "Installing C# packages and restoring dependencies..."
    dotnet restore
    echo "Starting C# backend in background..."
    nohup dotnet run > backend.log 2>&1 &
    cd - > /dev/null
else
    echo "C# Backend directory not found at ../client-app. Skipping."
fi

echo "Starting Node.js Middleware..."
if [ -d "../middleware" ]; then
    cd ../middleware
    echo "Installing middleware dependencies..."
    npm install
    echo "Applying generated database credentials to middleware environment..."
    cp ../network/.env .env
    echo "Starting middleware in background..."
    nohup npm start > middleware.log 2>&1 &
    cd - > /dev/null
else
    echo "Middleware directory not found at ../middleware. Skipping."
fi

echo "Starting React Frontend..."
if [ -d "../frontend" ]; then
    cd ../frontend
    echo "Installing frontend dependencies..."
    npm install
    echo "Building frontend for production..."
    npm run build
    cd - > /dev/null
else
    echo "Frontend directory not found at ../frontend. Skipping."
fi