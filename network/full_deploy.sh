#!/bin/bash
set -e

CRYPTO_DIR="./crypto-config-final-v2"
ARTIFACTS_DIR="./channel-artifacts-final"
CHANNEL_NAME="registrar-channel"
CC_NAME="registrar"
CC_VERSION="1.0"
EXPECTED_FABRIC_VERSION="2.5.4"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; BLUE='\033[0;34m'; NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

find . -type f -name "*.yaml" -exec sed -i.bak 's/\r$//' {} + 2>/dev/null || true
find . -type f -name "*.bak" -delete 2>/dev/null || true

declare -a PIDS

cleanup_processes() {
    echo ""
    log_info "Shutting down background application services..."
    for pid in "${PIDS[@]}"; do
        if ps -p $pid > /dev/null 2>&1; then 
            pkill -P $pid 2>/dev/null || true
            kill $pid 2>/dev/null || true
        fi
    done
}

trap cleanup_processes EXIT

wait_for_service() {
    local host=$1; local port=$2; local name=$3; local timeout=$4
    local start_time=$(date +%s)
    log_info "Waiting for $name ($host:$port)..."
    while ! (echo > /dev/tcp/$host/$port) >/dev/null 2>&1; do
        if [ $(($(date +%s) - start_time)) -ge $timeout ]; then log_error "$name timeout!"; fi
        sleep 2
    done
    log_info "$name is ready!"
}

log_info "Phase 0-3: Preparing Environment..."
mkdir -p "$ARTIFACTS_DIR"
export PATH=$PATH:$(pwd)/bin
export FABRIC_CFG_PATH=$(pwd)

log_info "Wiping Docker engine memory and ghost volumes..."
docker compose down -v 2>/dev/null || true
docker system prune --volumes -f > /dev/null 2>&1 || true
find . -type f -name "fabric-ca-server.db" -delete 2>/dev/null || true
find . -type f -name "IssuerPublicKey" -delete 2>/dev/null || true
find . -type f -name "IssuerRevocationPublicKey" -delete 2>/dev/null || true

log_info "Evaluating Native CouchDB environment..."
COUCH_CONFIG="/opt/couchdb/etc/local.ini"

if [ ! -f "$COUCH_CONFIG" ]; then COUCH_CONFIG="/etc/couchdb/local.ini"; fi

if [ -f "$COUCH_CONFIG" ] && command -v sudo >/dev/null 2>&1; then
    sudo sed -i.bak 's/^;port = 5984/port = 5990/' "$COUCH_CONFIG"
    sudo sed -i.bak 's/^port = 5984/port = 5990/' "$COUCH_CONFIG"
    sudo sed -i.bak 's/^;bind_address = 127.0.0.1/bind_address = 127.0.0.1/' "$COUCH_CONFIG"
    if command -v systemctl >/dev/null 2>&1; then 
        sudo systemctl restart couchdb 
    elif command -v service >/dev/null 2>&1; then
        sudo service couchdb restart
    fi
else
    log_warn "Local CouchDB config not found or OS not supported. Skipping native DB port shift."
fi

log_info "Phase 4-5: Generating Blockchain Artifacts..."
rm -rf "$CRYPTO_DIR" "$ARTIFACTS_DIR" 2>/dev/null || true
mkdir -p "$ARTIFACTS_DIR"

./bin/cryptogen generate --config=./crypto-config.yaml --output="$CRYPTO_DIR" || log_error "Cryptogen failed"
./bin/configtxgen -profile UniversityGenesis -channelID system-channel -outputBlock "$ARTIFACTS_DIR/orderer.genesis.block" || log_error "Genesis failed"
./bin/configtxgen -profile RegistrarChannel -outputCreateChannelTx "$ARTIFACTS_DIR/${CHANNEL_NAME}.tx" -channelID $CHANNEL_NAME || log_error "Tx failed"

find "$CRYPTO_DIR" -type f -name "*_sk" -execdir cp -n {} priv_sk \; 2>/dev/null || true

log_info "Phase 5.5: Compiling Frontend Static Build (Pre-Docker)..."
log_info "Cleaning up previous frontend build artifacts..."
(cd ../frontend && rm -rf build && npm install && npm run build)

log_info "Phase 6: Launching Network & Syncing Wallet..."
docker compose up -d

wait_for_service 127.0.0.1 7050 "Orderer Service" 150
wait_for_service 127.0.0.1 5990 "CouchDB Wallet" 150

log_info "Waiting for peer services to become available..."
wait_for_service 127.0.0.1 7051 "Registrar Peer" 150
wait_for_service 127.0.0.1 8051 "Faculty Peer" 150
wait_for_service 127.0.0.1 9051 "Department Peer" 150

ENV_USER=$(grep "^COUCHDB_USER=" .env | cut -d '=' -f 2 | tr -d '\r' | tr -d '"' | tr -d "'")
ENV_PASS=$(grep "^COUCHDB_PASS=" .env | cut -d '=' -f 2 | tr -d '\r' | tr -d '"' | tr -d "'")

log_info "Resetting fabric_wallet database natively on port 5990..."
curl -s -X DELETE http://${ENV_USER}:${ENV_PASS}@127.0.0.1:5990/fabric_wallet > /dev/null 2>&1 || true
curl -s -X PUT http://${ENV_USER}:${ENV_PASS}@127.0.0.1:5990/fabric_wallet > /dev/null 2>&1 || true
curl -s -X PUT http://${ENV_USER}:${ENV_PASS}@127.0.0.1:5990/_users > /dev/null 2>&1 || true

log_info "Phase 7: Establishing the Channel..."

CLI_MSP="/etc/hyperledger/fabric/crypto-config-final-v2/peerOrganizations/registrar.capstone.com/users/Admin@registrar.capstone.com/msp"

docker exec -e CORE_PEER_MSPCONFIGPATH=$CLI_MSP cli peer channel create \
    -c $CHANNEL_NAME \
    -f ./channel-artifacts-final/$CHANNEL_NAME.tx \
    --outputBlock ./channel-artifacts-final/$CHANNEL_NAME.block \
    -o orderer.capstone.com:7050 \
    --tls \
    --cafile /etc/hyperledger/fabric/crypto-config-final-v2/ordererOrganizations/capstone.com/orderers/orderer.capstone.com/tls/ca.crt

log_info "Channel block created. Stabilizing..."
sleep 10

for domain in registrar.capstone.com faculty.capstone.com department.capstone.com; do
    ORG_NAME=$(echo ${domain%%.*} | awk '{print toupper(substr($0,1,1)) tolower(substr($0,2))}')
    log_info "Joining $domain to channel as ${ORG_NAME}MSP..."
    
    docker exec -e CORE_PEER_ADDRESS=peer0.$domain:7051 \
                -e CORE_PEER_LOCALMSPID="${ORG_NAME}MSP" \
                -e CORE_PEER_MSPCONFIGPATH=/etc/hyperledger/fabric/crypto-config-final-v2/peerOrganizations/$domain/users/Admin@$domain/msp \
                -e CORE_PEER_TLS_ROOTCERT_FILE=/etc/hyperledger/fabric/crypto-config-final-v2/peerOrganizations/$domain/peers/peer0.$domain/tls/ca.crt \
                -e CORE_PEER_TLS_ENABLED=true \
                cli peer channel join -b ./channel-artifacts-final/$CHANNEL_NAME.block
done

log_info "Phase 8-13: Packaging and Committing Chaincode..."

CC_TLS_CERT=$(cat "$CRYPTO_DIR/peerOrganizations/registrar.capstone.com/tlsca/tlsca.registrar.capstone.com-cert.pem" | awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}')

cat > connection.json <<EOF
{"address":"registrar-chaincode:9999","dial_timeout":"10s","tls_required":true,"client_auth_required":false,"root_cert":"${CC_TLS_CERT}"}
EOF

tar cfz code.tar.gz connection.json
echo '{"path":"","type":"ccaas","label":"'${CC_NAME}'_1.0"}' > metadata.json
tar cfz registrar.tar.gz metadata.json code.tar.gz

for domain in registrar.capstone.com faculty.capstone.com department.capstone.com; do
    ORG_NAME=$(echo ${domain%%.*} | awk '{print toupper(substr($0,1,1)) tolower(substr($0,2))}')
    docker exec -e CORE_PEER_ADDRESS=peer0.$domain:7051 \
                -e CORE_PEER_LOCALMSPID="${ORG_NAME}MSP" \
                -e CORE_PEER_MSPCONFIGPATH=/etc/hyperledger/fabric/crypto-config-final-v2/peerOrganizations/$domain/users/Admin@$domain/msp \
                -e CORE_PEER_TLS_ROOTCERT_FILE=/etc/hyperledger/fabric/crypto-config-final-v2/peerOrganizations/$domain/peers/peer0.$domain/tls/ca.crt \
                -e CORE_PEER_TLS_ENABLED=true \
                cli peer lifecycle chaincode install registrar.tar.gz
done

CC_PACKAGE_ID=$(docker exec -e CORE_PEER_TLS_ENABLED=true \
    -e CORE_PEER_TLS_ROOTCERT_FILE=/etc/hyperledger/fabric/crypto-config-final-v2/peerOrganizations/registrar.capstone.com/peers/peer0.registrar.capstone.com/tls/ca.crt \
    cli peer lifecycle chaincode queryinstalled | grep "Package ID: ${CC_NAME}" | head -n 1 | awk '{print $3}' | sed 's/,$//')

log_info "Package ID: $CC_PACKAGE_ID"

sed -i.bak "s/^CHAINCODE_ID=.*/CHAINCODE_ID=$CC_PACKAGE_ID/" .env || echo "CHAINCODE_ID=$CC_PACKAGE_ID" >> .env
rm -f .env.bak 2>/dev/null || true

docker compose up -d --no-deps registrar-chaincode

for domain in registrar.capstone.com faculty.capstone.com department.capstone.com; do
    ORG_NAME=$(echo ${domain%%.*} | awk '{print toupper(substr($0,1,1)) tolower(substr($0,2))}')
    docker exec -e CORE_PEER_ADDRESS=peer0.$domain:7051 \
                -e CORE_PEER_LOCALMSPID="${ORG_NAME}MSP" \
                -e CORE_PEER_MSPCONFIGPATH=/etc/hyperledger/fabric/crypto-config-final-v2/peerOrganizations/$domain/users/Admin@$domain/msp \
                -e CORE_PEER_TLS_ROOTCERT_FILE=/etc/hyperledger/fabric/crypto-config-final-v2/peerOrganizations/$domain/peers/peer0.$domain/tls/ca.crt \
                -e CORE_PEER_TLS_ENABLED=true \
            cli peer lifecycle chaincode approveformyorg \
            --channelID $CHANNEL_NAME \
            --name $CC_NAME \
            --version 1.0 \
            --package-id $CC_PACKAGE_ID \
            --sequence 1 \
            -o orderer.capstone.com:7050 \
            --tls \
            --cafile /etc/hyperledger/fabric/crypto-config-final-v2/ordererOrganizations/capstone.com/orderers/orderer.capstone.com/tls/ca.crt
        sleep 3
done

log_info "Waiting for orderer to process chaincode approvals across all peers..."
sleep 10

docker exec -e CORE_PEER_LOCALMSPID="RegistrarMSP" \
            -e CORE_PEER_MSPCONFIGPATH=/etc/hyperledger/fabric/crypto-config-final-v2/peerOrganizations/registrar.capstone.com/users/Admin@registrar.capstone.com/msp \
            -e CORE_PEER_TLS_ROOTCERT_FILE=/etc/hyperledger/fabric/crypto-config-final-v2/peerOrganizations/registrar.capstone.com/peers/peer0.registrar.capstone.com/tls/ca.crt \
            -e CORE_PEER_TLS_ENABLED=true \
            cli peer lifecycle chaincode commit \
            --channelID $CHANNEL_NAME \
            --name $CC_NAME \
            --version 1.0 \
            --sequence 1 \
            -o orderer.capstone.com:7050 \
            --tls \
            --cafile /etc/hyperledger/fabric/crypto-config-final-v2/ordererOrganizations/capstone.com/orderers/orderer.capstone.com/tls/ca.crt \
            --peerAddresses peer0.registrar.capstone.com:7051 --tlsRootCertFiles /etc/hyperledger/fabric/crypto-config-final-v2/peerOrganizations/registrar.capstone.com/peers/peer0.registrar.capstone.com/tls/ca.crt \
            --peerAddresses peer0.faculty.capstone.com:7051 --tlsRootCertFiles /etc/hyperledger/fabric/crypto-config-final-v2/peerOrganizations/faculty.capstone.com/peers/peer0.faculty.capstone.com/tls/ca.crt \
            --peerAddresses peer0.department.capstone.com:7051 --tlsRootCertFiles /etc/hyperledger/fabric/crypto-config-final-v2/peerOrganizations/department.capstone.com/peers/peer0.department.capstone.com/tls/ca.crt

log_info "Phase 14: Starting App & Middleware..."

docker cp ./init-db-schema.sql postgres:/tmp/init-db-schema.sql 2>/dev/null || true
docker exec postgres psql -U BLOCKGO -d ActivityLogs -f /tmp/init-db-schema.sql 2>/dev/null || true
docker exec postgres psql -U BLOCKGO -d ActivityLogs -c "TRUNCATE TABLE users CASCADE;" 2>/dev/null || true

load_env_vars() {
    while IFS='=' read -r key value || [ -n "$key" ]; do
        if [[ -n "$key" && "$key" != \#* ]]; then
            value=$(echo "$value" | tr -d '\r')
            [[ "$value" == \"*\" ]] && value="${value:1:-1}"
            [[ "$value" == \'*\' ]] && value="${value:1:-1}"
            export "$key"="$value"
        fi
    done < ../network/.env
}

pushd ../middleware > /dev/null
load_env_vars
node enrollAdmin.js
nohup npm start > middleware.log 2>&1 &
PIDS+=($!)
popd > /dev/null

wait_for_service 127.0.0.1 4000 "Middleware" 150

pushd ../client-app > /dev/null
load_env_vars
nohup dotnet run > backend.log 2>&1 &
PIDS+=($!)
popd > /dev/null

log_info "Phase 15: Final Bootstrap..."
for i in {1..10}; do
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4000/api/bootstrap)
    if [ "$HTTP_CODE" -eq 200 ] || [ "$HTTP_CODE" -eq 409 ]; then
        echo -e "\n${BLUE}BLOCKGO IS LIVE!${NC}"
        echo "Frontend: http://localhost:8080"
        echo "Admin: registrar@plv.edu.ph / admin123"
        while true; do sleep 86400; done
    fi
    sleep 5
done

log_error "Bootstrap failed."