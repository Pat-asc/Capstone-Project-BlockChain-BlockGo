#!/bin/bash
# ============================================================
# CAPSTONE PROJECT - FULL DEPLOYMENT
# ============================================================
# Master deployment script combining Fabric setup, App services,
# Bootstrapping, and process management.
# ============================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Store PIDs of background processes to clean up on exit
declare -a PIDS

cleanup_processes() {
    echo ""
    log_info "Shutting down background application services..."
    for pid in "${PIDS[@]}"; do
        if ps -p $pid > /dev/null 2>&1; then
            kill $pid 2>/dev/null || true
        fi
    done
    log_info "Background processes stopped."
}

# Register the cleanup function to be called on EXIT or script interruption
trap cleanup_processes EXIT

# Helper function to wait for a service
wait_for_service() {
    local host=$1
    local port=$2
    local service_name=$3
    local timeout=$4 # seconds
    local start_time=$(date +%s)
    log_info "Waiting for $service_name ($host:$port) to be available..."
    while true; do
        current_time=$(date +%s)
        if [ $((current_time - start_time)) -ge $timeout ]; then
            log_error "$service_name ($host:$port) did not become available within $timeout seconds."
        fi
        if nc -z -w 2 $host $port > /dev/null 2>&1; then
            log_info "$service_name is available!"
            return 0
        fi
        sleep 2
    done
}

# ============================================================
# PHASE 0: SYSTEM DEPENDENCIES
# ============================================================
log_info "Phase 0: Checking system dependencies..."
SUDO=""
if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
fi

if command -v apt-get >/dev/null 2>&1; then
    if ! command -v jq >/dev/null 2>&1 || ! command -v nc >/dev/null 2>&1; then
        log_info "Installing missing system dependencies (curl, wget, netcat, jq)..."
        $SUDO apt-get update -yqq >/dev/null 2>&1 || true
        $SUDO apt-get install -y curl wget netcat jq >/dev/null 2>&1
    fi

    if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
        log_info "Node.js or NPM not found. Installing Node.js 20.x LTS..."
        curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO bash - >/dev/null 2>&1
        $SUDO apt-get install -y nodejs >/dev/null 2>&1
        log_info "Node.js and NPM installed successfully."
    else
        log_info "Node.js ($(node -v)) and NPM ($(npm -v)) are installed."
    fi
else
    log_warn "'apt-get' not found. Please ensure curl, wget, netcat, and jq are installed."
fi

log_info "Checking Docker accessibility..."
if ! docker ps >/dev/null 2>&1; then
    log_error "Cannot connect to the Docker daemon. Is Docker running? Does your user have permission to run Docker commands without sudo?"
fi

# ============================================================
# PHASE 1: GENERATE SECURE .ENV CREDENTIALS
# ============================================================
log_info "Phase 1: Checking/Generating secure credentials..."
ENV_FILE="$(pwd)/.env"
if [ ! -f "$ENV_FILE" ]; then
    touch "$ENV_FILE"
fi

add_to_env_if_missing() {
    local KEY=$1
    local VAL=$2
    if ! grep -q "^${KEY}=" "$ENV_FILE"; then
        echo "${KEY}=${VAL}" >> "$ENV_FILE"
        log_info "Generated new secure value for ${KEY}"
    fi
}

add_to_env_if_missing "COUCHDB_USER" "capstone"
add_to_env_if_missing "COUCHDB_PASS" "pass123"

LOCAL_COUCH_USER=$(grep "^COUCHDB_USER=" "$ENV_FILE" | cut -d '=' -f 2)
LOCAL_COUCH_PASS=$(grep "^COUCHDB_PASS=" "$ENV_FILE" | cut -d '=' -f 2)

add_to_env_if_missing "POSTGRES_USER" "BLOCKGO"
add_to_env_if_missing "POSTGRES_PASS" "PLVBLOCKGO"
add_to_env_if_missing "POSTGRES_DB" "ActivityLogs"
add_to_env_if_missing "JWT_SECRET" "$(openssl rand -base64 32)"

# ============================================================
# PHASE 2: NPM DEPENDENCIES
# ============================================================
log_info "Phase 2: Installing project NPM dependencies..."

# Frontend
if [ -d "../frontend" ]; then
    if [ ! -d "../frontend/node_modules" ]; then
        log_info "Installing frontend dependencies..."
        (cd ../frontend && npm install) > /dev/null 2>&1 || log_warn "npm install for frontend failed"
    fi
fi

# Middleware
if [ -d "../middleware" ]; then
    if [ ! -d "../middleware/node_modules" ]; then
        log_info "Installing middleware dependencies..."
        (cd ../middleware && npm install) > /dev/null 2>&1 || log_warn "npm install for middleware failed"
    fi
fi

log_info "Dependencies ready"

# ============================================================
# PHASE 3: SETUP & BINARIES
# ============================================================
log_info "Phase 3: Checking binaries and setup..."

export PATH=$PATH:$(pwd)/bin
export FABRIC_CFG_PATH=$(pwd)
export CHANNEL_NAME="registrar-channel"
export CC_NAME="registrar"
export CC_VERSION="1.0"
export EXPECTED_FABRIC_VERSION="2.5.9" # Change this if your project requires a different version

verify_fabric_version() {
    if [ -f "./bin/cryptogen" ]; then
        local current_version=$(./bin/cryptogen version | grep -i 'version:' | awk '{print $2}' | tr -d '\r')
        if [ "$current_version" == "$EXPECTED_FABRIC_VERSION" ]; then
            return 0
        fi
        log_warn "Fabric version mismatch. Expected $EXPECTED_FABRIC_VERSION but found $current_version."
    fi
    return 1
}

verify_fabric_images() {
    if [ -z "$(docker images -q hyperledger/fabric-peer:$EXPECTED_FABRIC_VERSION 2> /dev/null)" ]; then
        return 1
    fi
    return 0
}

DOWNLOAD_ARGS=""
if ! verify_fabric_version || [ ! -f "./bin/configtxgen" ]; then DOWNLOAD_ARGS="b"; fi
if ! verify_fabric_images; then DOWNLOAD_ARGS="$DOWNLOAD_ARGS d"; fi

if [ -n "$DOWNLOAD_ARGS" ]; then
    log_info "Fabric binaries or Docker images (v$EXPECTED_FABRIC_VERSION) missing. Downloading them now..."
    curl -sSLO https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh
    chmod +x install-fabric.sh
    ./install-fabric.sh --fabric-version $EXPECTED_FABRIC_VERSION $DOWNLOAD_ARGS > /dev/null 2>&1
    rm install-fabric.sh
    log_info "Fabric components downloaded successfully."
else
    log_info "Fabric binaries and Docker images (v$EXPECTED_FABRIC_VERSION) already exist. Skipping download."
fi

[ ! -f "./bin/cryptogen" ] && log_error "cryptogen binary still not found after download attempt."
[ ! -f "./bin/configtxgen" ] && log_error "configtxgen binary still not found after download attempt."
[ ! -f "./configtx.yaml" ] && log_error "configtx.yaml not found"

log_info "All binaries and files OK"

# ============================================================
# PHASE 4: CRYPTO MATERIAL & GENESIS
# ============================================================
log_info "Phase 4: Crypto material and genesis block..."

if [ ! -d "./crypto-config" ] || [ ! -f "./channel-artifacts/genesis.block" ]; then
    log_info "Generating crypto material..."
    rm -rf ./crypto-config
    ./bin/cryptogen generate --config=./crypto-config.yaml --output="crypto-config" 2>/dev/null || log_error "Cryptogen failed"
    
    log_info "Generating genesis block..."
    ./bin/configtxgen -profile Genesis -channelID system-channel -outputBlock ./channel-artifacts/genesis.block 2>/dev/null || log_error "Genesis block generation failed"
else
    log_info "Crypto material and genesis block already exist"
fi

# ============================================================
# PHASE 5: CHANNEL TRANSACTION
# ============================================================
log_info "Phase 5: Channel transaction..."
if [ ! -f "./channel-artifacts/${CHANNEL_NAME}.tx" ]; then
    log_info "Generating channel transaction..."
    ./bin/configtxgen -profile RegistrarChannel -outputCreateChannelTx ./channel-artifacts/${CHANNEL_NAME}.tx -channelID $CHANNEL_NAME 2>/dev/null || log_error "Channel tx generation failed"
else
    log_info "Channel transaction already exists"
fi

# ============================================================
# PHASE 6: DOCKER CONTAINERS
# ============================================================
log_info "Phase 6: Starting Docker containers..."

if docker compose ps | grep -q "orderer"; then
    log_info "Containers already running"
else
    docker compose up -d 2>/dev/null || log_error "docker compose up failed"
    
    log_info "Waiting for containers to be ready..."
    wait_for_service localhost 7050 "Orderer Service" 30
    wait_for_service localhost 7051 "Registrar Peer" 30
    sleep 10
fi

# ============================================================
# PHASE 7: CREATE CHANNEL & JOIN PEERS
# ============================================================
log_info "Phase 7: Channel creation and peer joining..."

if ! docker exec cli peer channel list 2>/dev/null | grep -q "$CHANNEL_NAME"; then
    log_info "Creating channel $CHANNEL_NAME..."
    docker exec cli peer channel create -c $CHANNEL_NAME -f /etc/hyperledger/fabric/channel-artifacts/$CHANNEL_NAME.tx -o orderer.capstone.com:7050 --tls --cafile /etc/hyperledger/fabric/crypto-config/ordererOrganizations/capstone.com/orderers/orderer.capstone.com/tls/ca.crt >/dev/null 2>&1 || log_error "Channel creation failed"
    log_info "Channel created"
    
    log_info "Joining peers to channel..."
    docker exec -e CORE_PEER_ADDRESS=peer0.registrar.capstone.com:7051 cli peer channel join -b $CHANNEL_NAME.block >/dev/null 2>&1
    docker exec -e CORE_PEER_ADDRESS=peer0.faculty.capstone.com:7051 cli peer channel join -b $CHANNEL_NAME.block >/dev/null 2>&1
    docker exec -e CORE_PEER_ADDRESS=peer0.department.capstone.com:7051 cli peer channel join -b $CHANNEL_NAME.block >/dev/null 2>&1
    log_info "Peers joined"
else
    log_info "Channel and peers already configured"
fi

sleep 5

# ============================================================
# PHASE 8: CHAINCODE PACKAGING
# ============================================================
log_info "Phase 8: Packaging chaincode..."

rm -f registrar.tar.gz code.tar.gz metadata.json connection.json

# TLS-enabled connection.json with embedded certificate
# Fetch the cert dynamically to be safe
CC_TLS_CERT=$(cat ./crypto-config/peerOrganizations/registrar.capstone.com/tlsca/tlsca.registrar.capstone.com-cert.pem | awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}')

cat > connection.json <<EOF
{
  "address": "registrar-chaincode:9999",
  "dial_timeout": "10s",
  "tls_required": true,
  "client_auth_required": false,
  "root_cert": "${CC_TLS_CERT}"
}
EOF

tar cfz code.tar.gz connection.json
echo '{"path":"","type":"ccaas","label":"'${CC_NAME}'_1.0"}' > metadata.json
tar cfz registrar.tar.gz metadata.json code.tar.gz

log_info "Chaincode package created (TLS enabled)"

# ============================================================
# PHASE 9: CHAINCODE INSTALL
# ============================================================
log_info "Phase 9: Installing chaincode..."

install_chaincode() {
    PEER_ADDRESS=$1
    log_info "Installing on $PEER_ADDRESS..."
    docker exec -e CORE_PEER_ADDRESS=$PEER_ADDRESS cli peer lifecycle chaincode install registrar.tar.gz >/dev/null 2>&1 || log_warn "Chaincode install on $PEER_ADDRESS failed (might be installed already)"
}

install_chaincode "peer0.registrar.capstone.com:7051"
install_chaincode "peer0.faculty.capstone.com:7051"
install_chaincode "peer0.department.capstone.com:7051"

sleep 5

# ============================================================
# PHASE 10: GET PACKAGE ID & DETERMINE SEQUENCE
# ============================================================
log_info "Phase 10: Getting package ID..."

CC_PACKAGE_ID=$(docker exec -e CORE_PEER_LOCALMSPID=RegistrarMSP \
    -e CORE_PEER_ADDRESS=peer0.registrar.capstone.com:7051 \
    -e CORE_PEER_MSPCONFIGPATH=/etc/hyperledger/fabric/crypto-config/peerOrganizations/registrar.capstone.com/users/Admin@registrar.capstone.com/msp \
    -e CORE_PEER_TLS_ROOTCERT_FILE=/etc/hyperledger/fabric/crypto-config/peerOrganizations/registrar.capstone.com/peers/peer0.registrar.capstone.com/tls/ca.crt \
    cli peer lifecycle chaincode queryinstalled 2>&1 | grep "Package ID:" | awk '{print $3}' | sed 's/.$//')

[ -z "$CC_PACKAGE_ID" ] && log_error "Could not get chaincode package ID"
log_info "Package ID: $CC_PACKAGE_ID"

# Determine Sequence
CURRENT_SEQUENCE=$(docker exec -e CORE_PEER_LOCALMSPID=RegistrarMSP \
    -e CORE_PEER_ADDRESS=peer0.registrar.capstone.com:7051 \
    -e CORE_PEER_MSPCONFIGPATH=/etc/hyperledger/fabric/crypto-config/peerOrganizations/registrar.capstone.com/users/Admin@registrar.capstone.com/msp \
    -e CORE_PEER_TLS_ROOTCERT_FILE=/etc/hyperledger/fabric/crypto-config/peerOrganizations/registrar.capstone.com/peers/peer0.registrar.capstone.com/tls/ca.crt \
    cli peer lifecycle chaincode querycommitted -C $CHANNEL_NAME -O json 2>/dev/null | jq -r '.chaincode_definitions[] | select(.name == "'$CC_NAME'") | .sequence' || echo "")

COMMITTED_PACKAGE_ID=$(docker exec -e CORE_PEER_LOCALMSPID=RegistrarMSP \
    -e CORE_PEER_ADDRESS=peer0.registrar.capstone.com:7051 \
    -e CORE_PEER_MSPCONFIGPATH=/etc/hyperledger/fabric/crypto-config/peerOrganizations/registrar.capstone.com/users/Admin@registrar.capstone.com/msp \
    -e CORE_PEER_TLS_ROOTCERT_FILE=/etc/hyperledger/fabric/crypto-config/peerOrganizations/registrar.capstone.com/peers/peer0.registrar.capstone.com/tls/ca.crt \
    cli peer lifecycle chaincode querycommitted -C $CHANNEL_NAME -O json 2>/dev/null | jq -r '.chaincode_definitions[] | select(.name == "'$CC_NAME'") | .package_id' || echo "")

SKIP_COMMIT=false
if [ "$CC_PACKAGE_ID" == "$COMMITTED_PACKAGE_ID" ] && [ -n "$CC_PACKAGE_ID" ]; then
    log_info "Chaincode package is already committed at sequence $CURRENT_SEQUENCE. Skipping upgrade."
    SKIP_COMMIT=true
    CC_SEQUENCE=$CURRENT_SEQUENCE
elif [[ -z "$CURRENT_SEQUENCE" || "$CURRENT_SEQUENCE" == "null" ]]; then
    CC_SEQUENCE=1
    log_info "No existing chaincode definition found. Setting sequence to 1."
else
    CC_SEQUENCE=$((CURRENT_SEQUENCE + 1))
    log_info "Existing chaincode found at sequence $CURRENT_SEQUENCE. Upgrading to sequence $CC_SEQUENCE."
fi

sleep 3

# ============================================================
# PHASE 11: APPROVE CHAINCODE
# ============================================================
log_info "Phase 11: Approving chaincode (sequence $CC_SEQUENCE)..."

if [ "$SKIP_COMMIT" = false ]; then
approve_cc() {
    ORG=$1
    PEER=$2
    log_info "Approving for $ORG..."
    docker exec -e CORE_PEER_LOCALMSPID=${ORG^}MSP \
        -e CORE_PEER_ADDRESS=$PEER \
        -e CORE_PEER_MSPCONFIGPATH=/etc/hyperledger/fabric/crypto-config/peerOrganizations/$ORG/users/Admin@$ORG/msp \
        -e CORE_PEER_TLS_ROOTCERT_FILE=/etc/hyperledger/fabric/crypto-config/peerOrganizations/$ORG/peers/$PEER/tls/ca.crt \
        cli peer lifecycle chaincode approveformyorg --channelID $CHANNEL_NAME --name $CC_NAME --version $CC_VERSION \
        --package-id $CC_PACKAGE_ID --sequence $CC_SEQUENCE -o orderer.capstone.com:7050 \
        --ordererTLSHostnameOverride orderer.capstone.com --tls \
        --cafile /etc/hyperledger/fabric/crypto-config/ordererOrganizations/capstone.com/orderers/orderer.capstone.com/tls/ca.crt \
        >/dev/null 2>&1 || log_error "Approve for $ORG failed"
}

approve_cc "registrar.capstone.com" "peer0.registrar.capstone.com:7051"
approve_cc "faculty.capstone.com" "peer0.faculty.capstone.com:7051"
approve_cc "department.capstone.com" "peer0.department.capstone.com:7051"

sleep 5
else
    log_info "Skipping approval phase."
fi

# ============================================================
# PHASE 12: COMMIT CHAINCODE
# ============================================================
log_info "Phase 12: Committing chaincode (sequence $CC_SEQUENCE)..."

if [ "$SKIP_COMMIT" = false ]; then
docker exec -e CORE_PEER_LOCALMSPID=RegistrarMSP \
    -e CORE_PEER_ADDRESS=peer0.registrar.capstone.com:7051 \
    -e CORE_PEER_MSPCONFIGPATH=/etc/hyperledger/fabric/crypto-config/peerOrganizations/registrar.capstone.com/users/Admin@registrar.capstone.com/msp \
    -e CORE_PEER_TLS_ROOTCERT_FILE=/etc/hyperledger/fabric/crypto-config/peerOrganizations/registrar.capstone.com/peers/peer0.registrar.capstone.com/tls/ca.crt \
    cli peer lifecycle chaincode commit --channelID $CHANNEL_NAME --name $CC_NAME --version $CC_VERSION --sequence $CC_SEQUENCE \
    -o orderer.capstone.com:7050 --ordererTLSHostnameOverride orderer.capstone.com --tls \
    --cafile /etc/hyperledger/fabric/crypto-config/ordererOrganizations/capstone.com/orderers/orderer.capstone.com/tls/ca.crt \
    --peerAddresses peer0.registrar.capstone.com:7051 --tlsRootCertFiles /etc/hyperledger/fabric/crypto-config/peerOrganizations/registrar.capstone.com/peers/peer0.registrar.capstone.com/tls/ca.crt \
    --peerAddresses peer0.faculty.capstone.com:7051 --tlsRootCertFiles /etc/hyperledger/fabric/crypto-config/peerOrganizations/faculty.capstone.com/peers/peer0.faculty.capstone.com/tls/ca.crt \
    --peerAddresses peer0.department.capstone.com:7051 --tlsRootCertFiles /etc/hyperledger/fabric/crypto-config/peerOrganizations/department.capstone.com/peers/peer0.department.capstone.com/tls/ca.crt \
    >/dev/null 2>&1 || log_error "Chaincode commit failed"

sleep 5
log_info "Chaincode committed successfully"
else
    log_info "Skipping commit phase."
fi

# ============================================================
# PHASE 13: UPDATE .ENV AND RESTART CHAINCODE
# ============================================================
log_info "Phase 13: Updating environment variables and restarting chaincode..."

if grep -q "^CHAINCODE_ID=" .env; then
    sed -i.bak "s#^CHAINCODE_ID=.*#CHAINCODE_ID=$CC_PACKAGE_ID#" .env
else
    echo "CHAINCODE_ID=$CC_PACKAGE_ID" >> .env
fi
log_info "CHAINCODE_ID updated to: $CC_PACKAGE_ID"

log_info "Restarting registrar-chaincode container to pick up new ID..."
export CHAINCODE_ID=$CC_PACKAGE_ID
docker compose stop registrar-chaincode 2>/dev/null || true
docker compose rm -f registrar-chaincode 2>/dev/null || true
docker compose up -d --no-deps --force-recreate registrar-chaincode || log_error "Failed to restart chaincode container"

# ============================================================
# PHASE 14: START APPLICATION SERVICES AND FRONTEND
# ============================================================
log_info "Phase 14: Starting application services..."

# Build React Frontend
if [ -d "../frontend" ]; then
    log_info "Building React Frontend..."
    if ! ( 
        cd ../frontend || exit 1
        npm run build > frontend_build.log 2>&1
    ); then
        log_error "React Frontend build failed. Check frontend/frontend_build.log"
    fi
    log_info "React Frontend built successfully."
else
    log_warn "Frontend directory not found at ../frontend. Skipping React build."
fi

# Ensure databases are ready
wait_for_service localhost 5432 "PostgreSQL" 60

# Init Database Schema
log_info "Initializing database schema..."
if [ -f "./init-db-schema.sh" ]; then
    bash ./init-db-schema.sh > /dev/null 2>&1 || log_warn "Schema init script had issues or already initialized."
fi

# Start C# Backend
if [ -d "../client-app" ]; then
    if nc -z localhost 5000 > /dev/null 2>&1; then
        log_info "C# Backend is already running on port 5000. Stopping old instance..."
        fuser -k 5000/tcp 2>/dev/null || true
        sleep 2
    fi
    
    log_info "Starting C# Backend (client-app)..."
    (
        cd ../client-app || exit 1
        if [ -f ../network/.env ]; then
            while IFS='=' read -r key value || [ -n "$key" ]; do
                if [[ -n "$key" && "$key" != \#* ]]; then
                    value=$(echo "$value" | tr -d '\r')
                    [[ "$value" == \"*\" ]] && value="${value:1:-1}"
                    [[ "$value" == \'*\' ]] && value="${value:1:-1}"
                    export "$key"="$value"
                fi
            done < ../network/.env
        fi
        nohup dotnet run > backend.log 2>&1 &
        echo $! > /tmp/client_app_pid.tmp
    )
    if [ -f /tmp/client_app_pid.tmp ]; then
        CLIENT_APP_PID=$(cat /tmp/client_app_pid.tmp)
        rm -f /tmp/client_app_pid.tmp
        PIDS+=($CLIENT_APP_PID)
    fi
    wait_for_service localhost 5000 "C# Backend" 60
else
    log_warn "C# Backend directory not found at ../client-app. Skipping."
fi

# Start Node.js Middleware (Fabric Bridge)
if [ -d "../middleware" ]; then
    if nc -z localhost 4000 > /dev/null 2>&1; then
        log_info "Node.js Middleware is already running on port 4000. Stopping old instance..."
        fuser -k 4000/tcp 2>/dev/null || true
        sleep 2
    fi

    log_info "Starting Node.js Middleware..."
    (
        cd ../middleware || exit 1
        log_info "Enrolling CA Admins into CouchDB Wallet..."
        node enrollAllAdmins.js || log_warn "Admin enrollment had issues."
        nohup npm start > middleware.log 2>&1 &
        echo $! > /tmp/middleware_pid.tmp
    )
    if [ -f /tmp/middleware_pid.tmp ]; then
        MIDDLEWARE_PID=$(cat /tmp/middleware_pid.tmp)
        rm -f /tmp/middleware_pid.tmp
        PIDS+=($MIDDLEWARE_PID)
    fi
    wait_for_service localhost 4000 "Node.js Middleware" 60
else
    log_warn "Middleware directory not found at ../middleware. Skipping."
fi

# ============================================================
# PHASE 15: BOOTSTRAP INITIAL REGISTRAR
# ============================================================
log_info "Phase 15: Bootstrapping initial registrar..."
BOOTSTRAP_URL="http://127.0.0.1:4000/api/bootstrap"
MAX_BOOTSTRAP_RETRIES=10
BOOTSTRAP_ATTEMPT=1
BOOTSTRAP_SUCCESS=false

while [ $BOOTSTRAP_ATTEMPT -le $MAX_BOOTSTRAP_RETRIES ]; do
    HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' $BOOTSTRAP_URL)
    
    if [ "$HTTP_CODE" -eq 200 ] || [ "$HTTP_CODE" -eq 201 ] || [ "$HTTP_CODE" -eq 204 ]; then 
        log_info "Registrar bootstrapped successfully!"
        BOOTSTRAP_SUCCESS=true
        break
    elif [ "$HTTP_CODE" -eq 409 ]; then 
        log_info "Registrar appears to be already bootstrapped (received HTTP 409 Conflict)."
        BOOTSTRAP_SUCCESS=true
        break
    else
        log_warn "Bootstrap failed (HTTP $HTTP_CODE). Retrying in 5 seconds... ($BOOTSTRAP_ATTEMPT/$MAX_BOOTSTRAP_RETRIES)"
        sleep 5
    fi
    BOOTSTRAP_ATTEMPT=$((BOOTSTRAP_ATTEMPT+1))
done

if [ "$BOOTSTRAP_SUCCESS" = false ]; then 
    log_error "Failed to bootstrap the initial registrar after multiple attempts."
fi

# ============================================================
# FINAL SUMMARY
# ============================================================
echo ""
echo "=========================================================="
echo -e " ${BLUE}BLOCKGO NETWORK DEPLOYMENT COMPLETE${NC}"
echo "=========================================================="
echo ""
log_info "Channel: $CHANNEL_NAME"
log_info "Chaincode: $CC_NAME v$CC_VERSION (sequence $CC_SEQUENCE)"
log_info "Security: TLS ENABLED with embedded certificates"
echo ""
echo "Application is now running."
echo "Access the web application at: http://localhost:8080 (or port 80 if configured via proxy)"
echo ""
echo "Initial Registrar Credentials:"
echo "  Email: registrar@plv.edu.ph"
echo "  Password: admin123"
echo ""
echo "================================================="
echo " SERVICES ARE RUNNING IN THE BACKGROUND"
echo " Press Ctrl+C to stop all services and exit."
echo "================================================="

# Keep the script running to prevent the EXIT trap from killing the processes prematurely
while true; do
    sleep 86400
done
