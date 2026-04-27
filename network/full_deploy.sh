#!/bin/bash
# ============================================================
# BLOCKGO - FULL DEPLOYMENT (FABRIC CA BOOTSTRAP VERSION)
# ============================================================
set -e

# --- Configuration ---
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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

declare -a PIDS

cleanup_processes() {
    echo ""
    log_info "Shutting down background services..."
    for pid in "${PIDS[@]}"; do
        if ps -p $pid > /dev/null 2>&1; then kill $pid 2>/dev/null || true; fi
    done
    pkill -f dotnet || true
    pkill -f "npm start" || true
    pkill -f "node" || true
    docker compose -f docker-compose-main.yaml -f docker-compose-annex.yaml -f docker-compose-pubad.yaml down -v 2>/dev/null || true
    docker rm -f couchdb_wallet 2>/dev/null || true
    log_info "All processes stopped and volumes wiped."
}

trap cleanup_processes EXIT

wait_for_service() {
    local host=$1; local port=$2; local name=$3; local timeout=$4
    local start_time=$(date +%s)
    log_info "Waiting for $name ($host:$port)..."
    while ! nc -z -w 2 $host $port > /dev/null 2>&1; do
        if [ $(($(date +%s) - start_time)) -ge $timeout ]; then log_error "$name timeout!"; fi
        sleep 2
    done
    log_info "$name is ready!"
}

load_env_vars() {
    if [ -f .env ]; then
        while IFS='=' read -r key value || [ -n "$key" ]; do
            if [[ -n "$key" && "$key" != \#* ]]; then
                value="${value%\"}"
                value="${value#\"}"
                value="${value%\'}"
                value="${value#\'}"
                export "$key"="$value"
            fi
        done < .env
    fi
}
load_env_vars # Load .env variables like BOOTSTRAP_REGISTRAR_PASS

spawn_couchdb_wallet() {
    log_info "Spawning standalone CouchDB Wallet container on port 5990..."
    docker rm -f couchdb_wallet 2>/dev/null || true
    docker run -d --name couchdb_wallet \
        --network registrar-net \
        -e COUCHDB_USER="${COUCHDB_USER:-capstone}" \
        -e COUCHDB_PASSWORD="${COUCHDB_PASS:-pass123}" \
        -p 5990:5984 \
        couchdb:3.2.2
}

# ============================================================
# PHASE 1: INITIAL CLEANING & CA STARTUP
# ============================================================
log_info "Phase 1: Initializing CA infrastructure..."
log_warn "Wiping previous CA databases and crypto material..."

# Purge orphaned local services holding ports for absolute idempotency
pkill -f dotnet || true
pkill -f "npm start" || true
pkill -f "node" || true

docker compose -f docker-compose-main.yaml -f docker-compose-annex.yaml -f docker-compose-pubad.yaml down -v 2>/dev/null || true
rm -rf ./fabric-ca/registrar/* ./fabric-ca/faculty/* ./fabric-ca/department/* 2>/dev/null || true
rm -rf "$CRYPTO_DIR" "$ARTIFACTS_DIR" 2>/dev/null || true
rm -rf ../middleware/wallet 2>/dev/null || true
mkdir -p "$ARTIFACTS_DIR"

export PATH=$PATH:$(pwd)/bin
export FABRIC_CFG_PATH=$(pwd)

TMP_DOCKER_CFG=$(mktemp -d)
echo "{}" > "$TMP_DOCKER_CFG/config.json"
DOCKER_CONFIG=$TMP_DOCKER_CFG docker compose -f docker-compose-main.yaml -f docker-compose-annex.yaml -f docker-compose-pubad.yaml up -d ca.registrar.capstone.com ca.faculty.capstone.com ca.department.capstone.com cli
rm -rf "$TMP_DOCKER_CFG"

wait_for_service 127.0.0.1 7054 "Registrar CA" 60

# ============================================================
# PHASE 2: DYNAMIC ENROLLMENT
# ============================================================
log_info "Phase 2: Enrolling Identities via Fabric CA..."

enroll_org_identities() {
    local ORG=$1; local DOMAIN=$2; local PORT=$3; local MSP_ID=$4
    local ADMIN_PASS=${BOOTSTRAP_REGISTRAR_PASS:-adminpw}
    local ORG_DIR="$(pwd)/${CRYPTO_DIR}/peerOrganizations/${DOMAIN}"
    local TLS_CERT="$(pwd)/fabric-ca/${ORG}/tls-cert.pem" 
    
    log_info "Bootstrapping ${MSP_ID}..."
    mkdir -p "${ORG_DIR}/msp" "${ORG_DIR}/users/Admin@${DOMAIN}/msp" "${ORG_DIR}/peers/peer0.${DOMAIN}/msp" "${ORG_DIR}/peers/peer0.${DOMAIN}/tls" "${ORG_DIR}/peers/peer1.${DOMAIN}/msp" "${ORG_DIR}/peers/peer1.${DOMAIN}/tls"

    while [ ! -f "${TLS_CERT}" ]; do sleep 2; done

    fabric-ca-client enroll -u https://admin:${ADMIN_PASS}@localhost:${PORT} --caname ca-${ORG} --tls.certfiles "${TLS_CERT}" --home "${ORG_DIR}"
    fabric-ca-client register --caname ca-${ORG} --id.name peer0 --id.secret peer0pw --id.type peer --tls.certfiles "${TLS_CERT}" --home "${ORG_DIR}"
    fabric-ca-client enroll -u https://peer0:peer0pw@localhost:${PORT} --caname ca-${ORG} -M "${ORG_DIR}/peers/peer0.${DOMAIN}/msp" --tls.certfiles "${TLS_CERT}" --home "${ORG_DIR}"

    fabric-ca-client enroll -u https://peer0:peer0pw@localhost:${PORT} --caname ca-${ORG} -M "${ORG_DIR}/peers/peer0.${DOMAIN}/tls" --enrollment.profile tls --csr.hosts "peer0.${DOMAIN},localhost" --tls.certfiles "${TLS_CERT}" --home "${ORG_DIR}"

    cp "${ORG_DIR}/peers/peer0.${DOMAIN}/tls/signcerts/"* "${ORG_DIR}/peers/peer0.${DOMAIN}/tls/server.crt"
    cp "${ORG_DIR}/peers/peer0.${DOMAIN}/tls/keystore/"* "${ORG_DIR}/peers/peer0.${DOMAIN}/tls/server.key"
    cp "${ORG_DIR}/msp/cacerts/localhost-${PORT}-ca-${ORG}.pem" "${ORG_DIR}/peers/peer0.${DOMAIN}/tls/ca.crt"
    fabric-ca-client register --caname ca-${ORG} --id.name peer1 --id.secret peer1pw --id.type peer --tls.certfiles "${TLS_CERT}" --home "${ORG_DIR}"
    fabric-ca-client enroll -u https://peer1:peer1pw@localhost:${PORT} --caname ca-${ORG} -M "${ORG_DIR}/peers/peer1.${DOMAIN}/msp" --tls.certfiles "${TLS_CERT}" --home "${ORG_DIR}"
    fabric-ca-client enroll -u https://peer1:peer1pw@localhost:${PORT} --caname ca-${ORG} -M "${ORG_DIR}/peers/peer1.${DOMAIN}/tls" --enrollment.profile tls --csr.hosts "peer1.${DOMAIN},localhost" --tls.certfiles "${TLS_CERT}" --home "${ORG_DIR}"
    cp "${ORG_DIR}/peers/peer1.${DOMAIN}/tls/signcerts/"* "${ORG_DIR}/peers/peer1.${DOMAIN}/tls/server.crt"
    cp "${ORG_DIR}/peers/peer1.${DOMAIN}/tls/keystore/"* "${ORG_DIR}/peers/peer1.${DOMAIN}/tls/server.key"
    # The peer's TLS CA cert is the root cert of the CA that issued its TLS cert.
    cp "${ORG_DIR}/msp/cacerts/localhost-${PORT}-ca-${ORG}.pem" "${ORG_DIR}/peers/peer1.${DOMAIN}/tls/ca.crt"

    fabric-ca-client register --caname ca-${ORG} --id.name orgadmin --id.secret adminpw --id.type admin --tls.certfiles "${TLS_CERT}" --home "${ORG_DIR}"
    fabric-ca-client enroll -u https://orgadmin:adminpw@localhost:${PORT} --caname ca-${ORG} -M "${ORG_DIR}/users/Admin@${DOMAIN}/msp" --tls.certfiles "${TLS_CERT}" --home "${ORG_DIR}"

    local CA_FILENAME="localhost-${PORT}-ca-${ORG}.pem"

    # Create tlscacerts for configtxgen and a compatibility link for Node.js Gateway
    mkdir -p "${ORG_DIR}/msp/tlscacerts" "${ORG_DIR}/tlsca"
    cp "${ORG_DIR}/msp/cacerts/${CA_FILENAME}" "${ORG_DIR}/msp/tlscacerts/tlsca.${DOMAIN}-cert.pem"
    cp "${ORG_DIR}/msp/cacerts/${CA_FILENAME}" "${ORG_DIR}/tlsca/tlsca.${DOMAIN}-cert.pem"

    cat <<EOF > "${ORG_DIR}/msp/config.yaml"
NodeOUs:
  Enable: true
  ClientOUIdentifier:
    Certificate: cacerts/${CA_FILENAME}
    OrganizationalUnitIdentifier: client
  PeerOUIdentifier:
    Certificate: cacerts/${CA_FILENAME}
    OrganizationalUnitIdentifier: peer
  AdminOUIdentifier:
    Certificate: cacerts/${CA_FILENAME}
    OrganizationalUnitIdentifier: admin
  OrdererOUIdentifier:
    Certificate: cacerts/${CA_FILENAME}
    OrganizationalUnitIdentifier: orderer
EOF
    cp "${ORG_DIR}/msp/config.yaml" "${ORG_DIR}/users/Admin@${DOMAIN}/msp/config.yaml"
    cp "${ORG_DIR}/msp/config.yaml" "${ORG_DIR}/peers/peer0.${DOMAIN}/msp/config.yaml"
    cp "${ORG_DIR}/msp/config.yaml" "${ORG_DIR}/peers/peer1.${DOMAIN}/msp/config.yaml"
}

enroll_orderer_identities() {
    local DOMAIN="capstone.com"
    local PORT=7054 # Using Registrar CA for Orderer
    local ADMIN_PASS=${BOOTSTRAP_REGISTRAR_PASS:-adminpw}
    local ORDERER_DIR="$(pwd)/${CRYPTO_DIR}/ordererOrganizations/${DOMAIN}"
    # Correctly use the TLS cert for the handshake, not the enrollment cert
    local TLS_CERT="$(pwd)/fabric-ca/registrar/tls-cert.pem"

    log_info "Bootstrapping Orderer (capstone.com)..."
    mkdir -p "${ORDERER_DIR}/msp" "${ORDERER_DIR}/orderers/orderer.${DOMAIN}/msp" "${ORDERER_DIR}/orderers/orderer.${DOMAIN}/tls" "${ORDERER_DIR}/orderers/orderer2.${DOMAIN}/msp" "${ORDERER_DIR}/orderers/orderer2.${DOMAIN}/tls" "${ORDERER_DIR}/orderers/orderer3.${DOMAIN}/msp" "${ORDERER_DIR}/orderers/orderer3.${DOMAIN}/tls"

    while [ ! -f "${TLS_CERT}" ]; do log_warn "Waiting for Orderer's CA TLS cert..."; sleep 2; done

    fabric-ca-client enroll -u https://admin:${ADMIN_PASS}@localhost:${PORT} --caname ca-registrar --tls.certfiles "${TLS_CERT}" --home "${ORDERER_DIR}"
    fabric-ca-client register --caname ca-registrar --id.name orderer --id.secret ordererpw --id.type orderer --tls.certfiles "${TLS_CERT}" --home "${ORDERER_DIR}"
    
    # Enroll for MSP
    fabric-ca-client enroll -u https://orderer:ordererpw@localhost:${PORT} --caname ca-registrar -M "${ORDERER_DIR}/orderers/orderer.${DOMAIN}/msp" --tls.certfiles "${TLS_CERT}" --home "${ORDERER_DIR}"

    # Enroll for TLS (This is what configtxgen needs!)
    fabric-ca-client enroll -u https://orderer:ordererpw@localhost:${PORT} --caname ca-registrar -M "${ORDERER_DIR}/orderers/orderer.${DOMAIN}/tls" --enrollment.profile tls --csr.hosts "orderer.capstone.com,localhost" --tls.certfiles "${TLS_CERT}" --home "${ORDERER_DIR}"

    # Normalize TLS filenames for Fabric
    cp "${ORDERER_DIR}/orderers/orderer.${DOMAIN}/tls/signcerts/"* "${ORDERER_DIR}/orderers/orderer.${DOMAIN}/tls/server.crt"
    cp "${ORDERER_DIR}/orderers/orderer.${DOMAIN}/tls/keystore/"* "${ORDERER_DIR}/orderers/orderer.${DOMAIN}/tls/server.key"
    # The orderer's TLS CA cert is the root cert of the CA that issued its TLS cert.
    cp "${ORDERER_DIR}/msp/cacerts/localhost-7054-ca-registrar.pem" "${ORDERER_DIR}/orderers/orderer.${DOMAIN}/tls/ca.crt"

    # Create admincerts directory for the orderer's MSP to satisfy admin requirement
    mkdir -p "${ORDERER_DIR}/orderers/orderer.${DOMAIN}/msp/admincerts"
    cp "${CRYPTO_DIR}/peerOrganizations/registrar.capstone.com/users/Admin@registrar.capstone.com/msp/signcerts/cert.pem" \
       "${ORDERER_DIR}/orderers/orderer.${DOMAIN}/msp/admincerts/cert.pem"
    
    # === ORDERER 2 (Annex) ===
    fabric-ca-client register --caname ca-registrar --id.name orderer2 --id.secret ordererpw --id.type orderer --tls.certfiles "${TLS_CERT}" --home "${ORDERER_DIR}"
    fabric-ca-client enroll -u https://orderer2:ordererpw@localhost:${PORT} --caname ca-registrar -M "${ORDERER_DIR}/orderers/orderer2.${DOMAIN}/msp" --tls.certfiles "${TLS_CERT}" --home "${ORDERER_DIR}"
    fabric-ca-client enroll -u https://orderer2:ordererpw@localhost:${PORT} --caname ca-registrar -M "${ORDERER_DIR}/orderers/orderer2.${DOMAIN}/tls" --enrollment.profile tls --csr.hosts "orderer2.capstone.com,localhost" --tls.certfiles "${TLS_CERT}" --home "${ORDERER_DIR}"
    cp "${ORDERER_DIR}/orderers/orderer2.${DOMAIN}/tls/signcerts/"* "${ORDERER_DIR}/orderers/orderer2.${DOMAIN}/tls/server.crt"
    cp "${ORDERER_DIR}/orderers/orderer2.${DOMAIN}/tls/keystore/"* "${ORDERER_DIR}/orderers/orderer2.${DOMAIN}/tls/server.key"
    cp "${ORDERER_DIR}/msp/cacerts/localhost-7054-ca-registrar.pem" "${ORDERER_DIR}/orderers/orderer2.${DOMAIN}/tls/ca.crt"
    mkdir -p "${ORDERER_DIR}/orderers/orderer2.${DOMAIN}/msp/admincerts"
    cp "${CRYPTO_DIR}/peerOrganizations/registrar.capstone.com/users/Admin@registrar.capstone.com/msp/signcerts/cert.pem" "${ORDERER_DIR}/orderers/orderer2.${DOMAIN}/msp/admincerts/cert.pem"

    # === ORDERER 3 (Pubad) ===
    fabric-ca-client register --caname ca-registrar --id.name orderer3 --id.secret ordererpw --id.type orderer --tls.certfiles "${TLS_CERT}" --home "${ORDERER_DIR}"
    fabric-ca-client enroll -u https://orderer3:ordererpw@localhost:${PORT} --caname ca-registrar -M "${ORDERER_DIR}/orderers/orderer3.${DOMAIN}/msp" --tls.certfiles "${TLS_CERT}" --home "${ORDERER_DIR}"
    fabric-ca-client enroll -u https://orderer3:ordererpw@localhost:${PORT} --caname ca-registrar -M "${ORDERER_DIR}/orderers/orderer3.${DOMAIN}/tls" --enrollment.profile tls --csr.hosts "orderer3.capstone.com,localhost" --tls.certfiles "${TLS_CERT}" --home "${ORDERER_DIR}"
    cp "${ORDERER_DIR}/orderers/orderer3.${DOMAIN}/tls/signcerts/"* "${ORDERER_DIR}/orderers/orderer3.${DOMAIN}/tls/server.crt"
    cp "${ORDERER_DIR}/orderers/orderer3.${DOMAIN}/tls/keystore/"* "${ORDERER_DIR}/orderers/orderer3.${DOMAIN}/tls/server.key"
    cp "${ORDERER_DIR}/msp/cacerts/localhost-7054-ca-registrar.pem" "${ORDERER_DIR}/orderers/orderer3.${DOMAIN}/tls/ca.crt"
    mkdir -p "${ORDERER_DIR}/orderers/orderer3.${DOMAIN}/msp/admincerts"
    cp "${CRYPTO_DIR}/peerOrganizations/registrar.capstone.com/users/Admin@registrar.capstone.com/msp/signcerts/cert.pem" "${ORDERER_DIR}/orderers/orderer3.${DOMAIN}/msp/admincerts/cert.pem"

    # Generate Orderer MSP config
    local CA_FILENAME="localhost-${PORT}-ca-registrar.pem"

    # Create tlscacerts for configtxgen and a compatibility link
    mkdir -p "${ORDERER_DIR}/msp/tlscacerts" "${ORDERER_DIR}/tlsca"
    cp "${ORDERER_DIR}/msp/cacerts/${CA_FILENAME}" "${ORDERER_DIR}/msp/tlscacerts/tlsca.${DOMAIN}-cert.pem"
    cp "${ORDERER_DIR}/msp/cacerts/${CA_FILENAME}" "${ORDERER_DIR}/tlsca/tlsca.${DOMAIN}-cert.pem"

    cat <<EOF > "${ORDERER_DIR}/msp/config.yaml"
NodeOUs:
  Enable: true
  ClientOUIdentifier:
    Certificate: cacerts/${CA_FILENAME}
    OrganizationalUnitIdentifier: client
  PeerOUIdentifier:
    Certificate: cacerts/${CA_FILENAME}
    OrganizationalUnitIdentifier: peer
  AdminOUIdentifier:
    Certificate: cacerts/${CA_FILENAME}
    OrganizationalUnitIdentifier: admin
  OrdererOUIdentifier:
    Certificate: cacerts/${CA_FILENAME}
    OrganizationalUnitIdentifier: orderer
EOF
    cp "${ORDERER_DIR}/msp/config.yaml" "${ORDERER_DIR}/orderers/orderer.${DOMAIN}/msp/config.yaml"
    cp "${ORDERER_DIR}/msp/config.yaml" "${ORDERER_DIR}/orderers/orderer2.${DOMAIN}/msp/config.yaml"
    cp "${ORDERER_DIR}/msp/config.yaml" "${ORDERER_DIR}/orderers/orderer3.${DOMAIN}/msp/config.yaml"
}

# Run all enrollments
enroll_org_identities "registrar" "registrar.capstone.com" 7054 "RegistrarMSP"
enroll_org_identities "faculty" "faculty.capstone.com" 8054 "FacultyMSP"
enroll_org_identities "department" "department.capstone.com" 9054 "DepartmentMSP"
enroll_orderer_identities

log_info "Creating dedicated TLS identity for Chaincode service..."
# Register a new identity for the chaincode service itself
fabric-ca-client register --caname ca-registrar --id.name chaincode --id.secret cc_pw --id.type client --tls.certfiles "$(pwd)/fabric-ca/registrar/tls-cert.pem" --home "$(pwd)/${CRYPTO_DIR}/peerOrganizations/registrar.capstone.com"
# Enroll to get its TLS certificate
fabric-ca-client enroll -u https://chaincode:cc_pw@localhost:7054 --caname ca-registrar -M "$(pwd)/${CRYPTO_DIR}/chaincode-tls" --enrollment.profile tls --csr.hosts "registrar-chaincode,faculty-chaincode,department-chaincode,localhost" --tls.certfiles "$(pwd)/fabric-ca/registrar/tls-cert.pem" --home "$(pwd)/${CRYPTO_DIR}/peerOrganizations/registrar.capstone.com"

# Normalize the filenames for the chaincode container's environment variables
mkdir -p "$(pwd)/${CRYPTO_DIR}/chaincode-tls/keystore"
mv "$(pwd)/${CRYPTO_DIR}/chaincode-tls/keystore/"* "$(pwd)/${CRYPTO_DIR}/chaincode-tls/keystore/server.key"
mkdir -p "$(pwd)/${CRYPTO_DIR}/chaincode-tls/signcerts"
mv "$(pwd)/${CRYPTO_DIR}/chaincode-tls/signcerts/"* "$(pwd)/${CRYPTO_DIR}/chaincode-tls/signcerts/server.crt"

log_info "Creating bundled TLS CA cert for Chaincode service to trust all peers..."
# Create a bundle of all organization's TLS CAs for the chaincode to trust
mkdir -p "$(pwd)/${CRYPTO_DIR}/chaincode-tls/ca-bundle"
{
    cat "$(pwd)/${CRYPTO_DIR}/peerOrganizations/registrar.capstone.com/tlsca/tlsca.registrar.capstone.com-cert.pem"
    echo ""
    cat "$(pwd)/${CRYPTO_DIR}/peerOrganizations/faculty.capstone.com/tlsca/tlsca.faculty.capstone.com-cert.pem"
    echo ""
    cat "$(pwd)/${CRYPTO_DIR}/peerOrganizations/department.capstone.com/tlsca/tlsca.department.capstone.com-cert.pem"
    echo ""
} > "$(pwd)/${CRYPTO_DIR}/chaincode-tls/ca-bundle/ca-bundle.pem"

log_info "Identities enrolled. Normalizing private keys..."
find "$CRYPTO_DIR" -type f -name "*_sk" -execdir cp -n {} priv_sk \; 2>/dev/null || true
# ============================================================
# PHASE 2.5: CREATE EXTERNAL BUILDER SCRIPTS
# ============================================================
log_info "Phase 2.5: Generating CCaaS External Builder scripts..."
mkdir -p ./builders/ccaas/bin

cat << 'EOF' | tr -d '\r' > ./builders/ccaas/bin/detect
#!/bin/sh
set -eu
exit 0
EOF

cat << 'EOF' | tr -d '\r' > ./builders/ccaas/bin/build
#!/bin/sh
set -eu
tar xfz "$1/code.tar.gz" -C "$3"
exit 0
EOF

cat << 'EOF' | tr -d '\r' > ./builders/ccaas/bin/release
#!/bin/sh
set -eu
mkdir -p "$2/chaincode/server"
cp "$1/connection.json" "$2/chaincode/server/connection.json"
exit 0
EOF

chmod -R +x ./builders/ccaas/bin
# ============================================================
# PHASE 3: FRONTEND BUILD & ARTIFACTS
# ============================================================
log_info "Phase 3: Building frontend application..."
(cd ../frontend && \
 rm -rf build && npm install && npm install react-router-dom @microsoft/signalr && \
 npm install -D tailwindcss@3 postcss autoprefixer && \
 npx tailwindcss init -p && \
 echo "module.exports = { content: ['./src/**/*.{js,jsx,ts,tsx}'], theme: { extend: {} }, plugins: [] };" > tailwind.config.js && \
 if [ -f src/index.css ] && ! grep -q "@tailwind" src/index.css; then echo -e "@tailwind base;\n@tailwind components;\n@tailwind utilities;\n$(cat src/index.css)" > src/index.css; \
 elif [ ! -f src/index.css ]; then echo -e "@tailwind base;\n@tailwind components;\n@tailwind utilities;\n" > src/index.css; fi && \
 DISABLE_ESLINT_PLUGIN=true npm run build)

if ! grep -q "orderer3.capstone.com" config/configtx.yaml; then
    log_error "Your configtx.yaml is missing the 3-node Raft cluster! Please update it to include orderer, orderer2, and orderer3."
fi

log_info "Generating Channel Artifacts..."
docker exec cli configtxgen -profile UniversityGenesis -channelID system-channel -outputBlock "/opt/fabric-config/network/${ARTIFACTS_DIR}/orderer.genesis.block"

docker exec cli configtxgen -profile RegistrarChannel -outputCreateChannelTx "/opt/fabric-config/network/${ARTIFACTS_DIR}/${CHANNEL_NAME}.tx" -channelID $CHANNEL_NAME


log_info "Phase 4: Launching Core Network Nodes..."

    # Ensure Docker didn't accidentally create an empty folder for the wrong filename
if [ -d "../middleware/nginx/nginx.conf" ]; then
    rm -rf "../middleware/nginx/nginx.conf"
fi

TMP_DOCKER_CFG=$(mktemp -d)
echo "{}" > "$TMP_DOCKER_CFG/config.json"

# Pre-pull base images using the standard daemon to avoid BuildKit IPv6 resolution bugs
DOCKER_CONFIG=$TMP_DOCKER_CFG docker pull golang:1.23-alpine || true
DOCKER_CONFIG=$TMP_DOCKER_CFG docker pull alpine:latest || true

DOCKER_CONFIG=$TMP_DOCKER_CFG docker compose -f docker-compose-main.yaml -f docker-compose-annex.yaml -f docker-compose-pubad.yaml up -d
rm -rf "$TMP_DOCKER_CFG"

# Spawn the standalone couchdb wallet
spawn_couchdb_wallet

wait_for_service 127.0.0.1 7050 "Orderer" 120
wait_for_service 127.0.0.1 8050 "Orderer2" 120
wait_for_service 127.0.0.1 9050 "Orderer3" 120
wait_for_service 127.0.0.1 7051 "Peer0 Registrar" 60
wait_for_service 127.0.0.1 5990 "CouchDB Wallet" 60

log_info "Waiting 15 seconds for Raft leader election..."
sleep 15

# ============================================================
# PHASE 5: CHANNEL ESTABLISHMENT
# ============================================================
log_info "Phase 5: Establishing the Channel..."
CLI_MSP="/etc/hyperledger/fabric/crypto-config-final-v2/peerOrganizations/registrar.capstone.com/users/Admin@registrar.capstone.com/msp"

docker exec -e CORE_PEER_MSPCONFIGPATH=$CLI_MSP cli peer channel create \
    -c $CHANNEL_NAME -f ./channel-artifacts-final/$CHANNEL_NAME.tx \
    --outputBlock ./channel-artifacts-final/$CHANNEL_NAME.block \
    -o orderer.capstone.com:7050 --tls \
    --cafile /etc/hyperledger/fabric/crypto-config-final-v2/ordererOrganizations/capstone.com/orderers/orderer.capstone.com/tls/ca.crt \
    --timeout 60s

for domain in registrar.capstone.com faculty.capstone.com department.capstone.com; do
    ORG_NAME=$(echo ${domain%%.*} | awk '{print toupper(substr($0,1,1)) tolower(substr($0,2))}')
    
    for peer in peer0 peer1; do
        PEER_PORT=7051
        if [ "$domain" == "faculty.capstone.com" ]; then PEER_PORT=9051; fi
        if [ "$domain" == "department.capstone.com" ]; then PEER_PORT=11051; fi
        if [ "$peer" == "peer1" ]; then
            if [ "$domain" == "registrar.capstone.com" ]; then PEER_PORT=7051; fi
            if [ "$domain" == "faculty.capstone.com" ]; then PEER_PORT=10051; fi
            if [ "$domain" == "department.capstone.com" ]; then PEER_PORT=12051; fi
        fi
        
        for i in {1..5}; do
            if docker exec -e CORE_PEER_ADDRESS=${peer}.$domain:$PEER_PORT -e CORE_PEER_LOCALMSPID="${ORG_NAME}MSP" \
                        -e CORE_PEER_MSPCONFIGPATH=/etc/hyperledger/fabric/crypto-config-final-v2/peerOrganizations/$domain/users/Admin@$domain/msp \
                        -e CORE_PEER_TLS_ROOTCERT_FILE=/etc/hyperledger/fabric/crypto-config-final-v2/peerOrganizations/$domain/peers/${peer}.$domain/tls/ca.crt \
                        -e CORE_PEER_TLS_ENABLED=true cli peer channel join -b ./channel-artifacts-final/$CHANNEL_NAME.block; then
                break
            else
                log_warn "${peer}.$domain join retry $i/5..."
                sleep 10
            fi
        done
    done
done

# ============================================================
# PHASE 5.5: CHAINCODE DEPLOYMENT (CCaaS)
# ============================================================
log_info "Phase 5.5: Deploying Chaincode as a Service (CCaaS)..."

mkdir -p cc-pkg

ROOT_CERT_CONTENT=$(cat "${CRYPTO_DIR}/chaincode-tls/ca-bundle/ca-bundle.pem" | sed 's/$/\\n/' | tr -d '\n' | tr -d '\r')

# Clean .env of old chaincode IDs
grep -v "^CHAINCODE_ID" .env > .env.tmp 2>/dev/null || true
mv .env.tmp .env

for domain in registrar.capstone.com faculty.capstone.com department.capstone.com; do
    ORG_NAME=$(echo ${domain%%.*} | awk '{print toupper(substr($0,1,1)) tolower(substr($0,2))}')
    PREFIX=${domain%%.*}
    
    # Create localized CCaaS connection file pointing to org's specific chaincode container
    cat <<EOF | tr -d '\r' > cc-pkg/connection.json
{
  "address": "${PREFIX}-chaincode:9999",
  "dial_timeout": "10s",
  "tls_required": true,
  "client_auth_required": false,
  "root_cert": "${ROOT_CERT_CONTENT}"
}
EOF

    cat <<EOF | tr -d '\r' > cc-pkg/metadata.json
{
    "type": "ccaas",
    "label": "registrar_1.0"
}
EOF

    tar cfz cc-pkg/code.tar.gz -C cc-pkg connection.json
    tar cfz channel-artifacts-final/${PREFIX}.tar.gz -C cc-pkg code.tar.gz metadata.json

    for peer in peer0 peer1; do
        log_info "Installing chaincode on ${peer}.${domain}..."
        
        PEER_PORT=7051
        if [ "$domain" == "faculty.capstone.com" ]; then PEER_PORT=9051; fi
        if [ "$domain" == "department.capstone.com" ]; then PEER_PORT=11051; fi
        if [ "$peer" == "peer1" ]; then
            if [ "$domain" == "registrar.capstone.com" ]; then PEER_PORT=7051; fi
            if [ "$domain" == "faculty.capstone.com" ]; then PEER_PORT=10051; fi
            if [ "$domain" == "department.capstone.com" ]; then PEER_PORT=12051; fi
        fi

        docker exec -e CORE_PEER_ADDRESS=${peer}.${domain}:${PEER_PORT} \
            -e CORE_PEER_LOCALMSPID="${ORG_NAME}MSP" \
            -e CORE_PEER_MSPCONFIGPATH=/etc/hyperledger/fabric/crypto-config-final-v2/peerOrganizations/${domain}/users/Admin@${domain}/msp \
            -e CORE_PEER_TLS_ROOTCERT_FILE=/etc/hyperledger/fabric/crypto-config-final-v2/peerOrganizations/${domain}/peers/${peer}.${domain}/tls/ca.crt \
            -e CORE_PEER_TLS_ENABLED=true \
            cli peer lifecycle chaincode install /opt/fabric-config/network/channel-artifacts-final/${PREFIX}.tar.gz
    done

    PEER_PORT=7051
    if [ "$domain" == "faculty.capstone.com" ]; then PEER_PORT=9051; fi
    if [ "$domain" == "department.capstone.com" ]; then PEER_PORT=11051; fi

    PKG_ID=$(docker exec -e CORE_PEER_ADDRESS=peer0.${domain}:${PEER_PORT} \
        -e CORE_PEER_LOCALMSPID="${ORG_NAME}MSP" \
        -e CORE_PEER_MSPCONFIGPATH=/etc/hyperledger/fabric/crypto-config-final-v2/peerOrganizations/${domain}/users/Admin@${domain}/msp \
        -e CORE_PEER_TLS_ROOTCERT_FILE=/etc/hyperledger/fabric/crypto-config-final-v2/peerOrganizations/${domain}/peers/peer0.${domain}/tls/ca.crt \
        -e CORE_PEER_TLS_ENABLED=true \
        cli peer lifecycle chaincode queryinstalled | grep "registrar_1.0" | tail -n 1 | awk '{print $3}' | sed 's/,//')

    log_info "${ORG_NAME} Chaincode Package ID: $PKG_ID"
    
    ENV_VAR_NAME="CHAINCODE_ID_$(echo ${ORG_NAME} | tr '[:lower:]' '[:upper:]')"
    echo "${ENV_VAR_NAME}=${PKG_ID}" >> .env
    export ${ENV_VAR_NAME}="${PKG_ID}"

    log_info "Approving chaincode for ${ORG_NAME}MSP..."
    docker exec -e CORE_PEER_ADDRESS=peer0.${domain}:${PEER_PORT} \
        -e CORE_PEER_LOCALMSPID="${ORG_NAME}MSP" \
        -e CORE_PEER_MSPCONFIGPATH=/etc/hyperledger/fabric/crypto-config-final-v2/peerOrganizations/${domain}/users/Admin@${domain}/msp \
        -e CORE_PEER_TLS_ROOTCERT_FILE=/etc/hyperledger/fabric/crypto-config-final-v2/peerOrganizations/${domain}/peers/peer0.${domain}/tls/ca.crt \
        -e CORE_PEER_TLS_ENABLED=true \
        cli peer lifecycle chaincode approveformyorg -o orderer.capstone.com:7050 --ordererTLSHostnameOverride orderer.capstone.com --tls \
        --cafile /etc/hyperledger/fabric/crypto-config-final-v2/ordererOrganizations/capstone.com/orderers/orderer.capstone.com/tls/ca.crt \
        --channelID $CHANNEL_NAME --name registrar --version 1.0 --package-id $PKG_ID --sequence 1
done

log_info "Restarting all chaincode containers with new localized Package IDs..."
TMP_DOCKER_CFG=$(mktemp -d)
echo "{}" > "$TMP_DOCKER_CFG/config.json"

DOCKER_CONFIG=$TMP_DOCKER_CFG docker pull golang:1.23-alpine || true
DOCKER_CONFIG=$TMP_DOCKER_CFG docker pull alpine:latest || true

DOCKER_CONFIG=$TMP_DOCKER_CFG docker compose -f docker-compose-main.yaml -f docker-compose-annex.yaml -f docker-compose-pubad.yaml up -d --build --force-recreate registrar-chaincode faculty-chaincode department-chaincode
rm -rf "$TMP_DOCKER_CFG"

log_info "Waiting for chaincode containers to become healthy..."
for i in {1..20}; do
    HEALTH_STATUS_REG=$(docker inspect --format '{{.State.Health.Status}}' registrar-chaincode 2>/dev/null)
    HEALTH_STATUS_FAC=$(docker inspect --format '{{.State.Health.Status}}' faculty-chaincode 2>/dev/null)
    HEALTH_STATUS_DEP=$(docker inspect --format '{{.State.Health.Status}}' department-chaincode 2>/dev/null)
    if [ "$HEALTH_STATUS_REG" == "healthy" ] && [ "$HEALTH_STATUS_FAC" == "healthy" ] && [ "$HEALTH_STATUS_DEP" == "healthy" ]; then
        break
    fi
    log_warn "Chaincodes (Reg: ${HEALTH_STATUS_REG:-starting}, Fac: ${HEALTH_STATUS_FAC:-starting}, Dep: ${HEALTH_STATUS_DEP:-starting}) ($i/20)"
    sleep 5
done 

log_info "Committing chaincode..."
docker exec -e CORE_PEER_ADDRESS=peer0.registrar.capstone.com:7051 \
    -e CORE_PEER_LOCALMSPID=RegistrarMSP \
    -e CORE_PEER_MSPCONFIGPATH=/etc/hyperledger/fabric/crypto-config-final-v2/peerOrganizations/registrar.capstone.com/users/Admin@registrar.capstone.com/msp \
    -e CORE_PEER_TLS_ROOTCERT_FILE=/etc/hyperledger/fabric/crypto-config-final-v2/peerOrganizations/registrar.capstone.com/peers/peer0.registrar.capstone.com/tls/ca.crt \
    -e CORE_PEER_TLS_ENABLED=true \
    cli peer lifecycle chaincode commit -o orderer.capstone.com:7050 --ordererTLSHostnameOverride orderer.capstone.com --tls \
    --cafile /etc/hyperledger/fabric/crypto-config-final-v2/ordererOrganizations/capstone.com/orderers/orderer.capstone.com/tls/ca.crt \
    --channelID $CHANNEL_NAME --name registrar --version 1.0 --sequence 1 \
    --peerAddresses peer0.registrar.capstone.com:7051 --tlsRootCertFiles /etc/hyperledger/fabric/crypto-config-final-v2/peerOrganizations/registrar.capstone.com/peers/peer0.registrar.capstone.com/tls/ca.crt \
    --peerAddresses peer0.faculty.capstone.com:9051 --tlsRootCertFiles /etc/hyperledger/fabric/crypto-config-final-v2/peerOrganizations/faculty.capstone.com/peers/peer0.faculty.capstone.com/tls/ca.crt \
    --peerAddresses peer0.department.capstone.com:11051 --tlsRootCertFiles /etc/hyperledger/fabric/crypto-config-final-v2/peerOrganizations/department.capstone.com/peers/peer0.department.capstone.com/tls/ca.crt

log_info "Initializing chaincode ledger..."
sleep 3
docker exec -e CORE_PEER_ADDRESS=peer0.registrar.capstone.com:7051 \
    -e CORE_PEER_LOCALMSPID=RegistrarMSP \
    -e CORE_PEER_MSPCONFIGPATH=/etc/hyperledger/fabric/crypto-config-final-v2/peerOrganizations/registrar.capstone.com/users/Admin@registrar.capstone.com/msp \
    -e CORE_PEER_TLS_ROOTCERT_FILE=/etc/hyperledger/fabric/crypto-config-final-v2/peerOrganizations/registrar.capstone.com/peers/peer0.registrar.capstone.com/tls/ca.crt \
    -e CORE_PEER_TLS_ENABLED=true \
    cli peer chaincode invoke -o orderer.capstone.com:7050 --ordererTLSHostnameOverride orderer.capstone.com --tls \
    --cafile /etc/hyperledger/fabric/crypto-config-final-v2/ordererOrganizations/capstone.com/orderers/orderer.capstone.com/tls/ca.crt \
    -C $CHANNEL_NAME -n registrar -c '{"function":"InitLedger","Args":[]}' \
    --peerAddresses peer0.registrar.capstone.com:7051 --tlsRootCertFiles /etc/hyperledger/fabric/crypto-config-final-v2/peerOrganizations/registrar.capstone.com/peers/peer0.registrar.capstone.com/tls/ca.crt \
    --peerAddresses peer0.faculty.capstone.com:9051 --tlsRootCertFiles /etc/hyperledger/fabric/crypto-config-final-v2/peerOrganizations/faculty.capstone.com/peers/peer0.faculty.capstone.com/tls/ca.crt \
    --peerAddresses peer0.department.capstone.com:11051 --tlsRootCertFiles /etc/hyperledger/fabric/crypto-config-final-v2/peerOrganizations/department.capstone.com/peers/peer0.department.capstone.com/tls/ca.crt
# ============================================================
# PHASE 6: APPS
# ============================================================
log_info "Phase 6: Running Database Schema Updates & Mock Data Injection..."

# Wait for postgres
sleep 20

POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=5432
POSTGRES_DB=${POSTGRES_DB:-blockgo}
POSTGRES_USER=${POSTGRES_USER:-blockgo}
POSTGRES_PASS=${POSTGRES_PASS:-blockgo123}

wait_for_service $POSTGRES_HOST $POSTGRES_PORT "Postgres" 120

# Run schema migrations (init-db-schema.sql already auto-run, but ensure new columns)
docker exec -e PGPASSWORD="$POSTGRES_PASS" postgres psql -U $POSTGRES_USER -d $POSTGRES_DB -f /docker-entrypoint-initdb.d/init.sql

# Inject 10 MOCK students with DOB passwords
cat << 'EOF' | docker exec -i -e PGPASSWORD="$POSTGRES_PASS" postgres psql -U $POSTGRES_USER -d $POSTGRES_DB
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Create MOCK Registrar (for chat testing)
WITH reg_user AS (
  INSERT INTO users (email, password_hash, role, status, created_at) VALUES 
  ('registrar@plv.edu.ph', crypt('admin123', gen_salt('bf', 12)), 'registrar', 'APPROVED', NOW())
  ON CONFLICT (email) DO NOTHING RETURNING id
)
INSERT INTO AdminProfiles (user_id, full_name, admin_level, department)
SELECT id, 'System Registrar', 'registrar', 'Registrar' FROM reg_user;

-- Create 10 MOCK students with DOB passwords
WITH mock_users AS (
  INSERT INTO users (email, password_hash, role, status, created_at) VALUES 
    ('mock.student1@plv.edu.ph', crypt('05/15/2005', gen_salt('bf', 12)), 'student', 'APPROVED', NOW()),
    ('mock.student2@plv.edu.ph', crypt('06/20/2004', gen_salt('bf', 12)), 'student', 'APPROVED', NOW()),
    ('mock.student3@plv.edu.ph', crypt('03/10/2005', gen_salt('bf', 12)), 'student', 'APPROVED', NOW()),
    ('mock.student4@plv.edu.ph', crypt('11/25/2003', gen_salt('bf', 12)), 'student', 'APPROVED', NOW()),
    ('mock.student5@plv.edu.ph', crypt('08/05/2004', gen_salt('bf', 12)), 'student', 'APPROVED', NOW()),
    ('mock.student6@plv.edu.ph', crypt('01/12/2005', gen_salt('bf', 12)), 'student', 'APPROVED', NOW()),
    ('mock.student7@plv.edu.ph', crypt('07/30/2003', gen_salt('bf', 12)), 'student', 'APPROVED', NOW()),
    ('mock.student8@plv.edu.ph', crypt('04/18/2004', gen_salt('bf', 12)), 'student', 'APPROVED', NOW()),
    ('mock.student9@plv.edu.ph', crypt('12/22/2005', gen_salt('bf', 12)), 'student', 'APPROVED', NOW()),
    ('mock.student10@plv.edu.ph', crypt('09/08/2003', gen_salt('bf', 12)), 'student', 'APPROVED', NOW())
  ON CONFLICT (email) DO NOTHING
  RETURNING id, email
),
mock_profiles AS (
  INSERT INTO StudentProfiles (user_id, full_name, student_no, department, date_of_birth, section, assignment_status)
  SELECT u.id, 
         CASE 
           WHEN u.email LIKE '%1@%' THEN 'Juan Dela Cruz' 
           WHEN u.email LIKE '%2@%' THEN 'Maria Santos' 
           WHEN u.email LIKE '%3@%' THEN 'Pedro Reyes' 
           WHEN u.email LIKE '%4@%' THEN 'Ana Lopez' 
           WHEN u.email LIKE '%5@%' THEN 'Jose Garcia' 
           WHEN u.email LIKE '%6@%' THEN 'Luz Mendoza' 
           WHEN u.email LIKE '%7@%' THEN 'Carlo Torres' 
           WHEN u.email LIKE '%8@%' THEN 'Sofia Ramos' 
           WHEN u.email LIKE '%9@%' THEN 'Miguel Lim' 
           ELSE 'Nina Tan'
         END,
         'MOCK-' || substring(u.email from position('@' in u.email)-7 for 7),
         CASE 
           WHEN u.email LIKE '%1@%' OR u.email LIKE '%6@%' THEN 'CS'
           WHEN u.email LIKE '%2@%' OR u.email LIKE '%7@%' THEN 'CE' 
           WHEN u.email LIKE '%3@%' OR u.email LIKE '%8@%' THEN 'IT'
           ELSE 'CS'
         END,
         CASE 
           WHEN u.email LIKE '%1@%' THEN '2005-05-15'::date
           WHEN u.email LIKE '%2@%' THEN '2004-06-20'::date
           WHEN u.email LIKE '%3@%' THEN '2005-03-10'::date
           WHEN u.email LIKE '%4@%' THEN '2003-11-25'::date
           WHEN u.email LIKE '%5@%' THEN '2004-08-05'::date
           WHEN u.email LIKE '%6@%' THEN '2005-01-12'::date
           WHEN u.email LIKE '%7@%' THEN '2003-07-30'::date
           WHEN u.email LIKE '%8@%' THEN '2004-04-18'::date
           WHEN u.email LIKE '%9@%' THEN '2005-12-22'::date
           ELSE '2003-09-08'::date
         END,
         CASE 
           WHEN u.email LIKE '%1@%' OR u.email LIKE '%2@%' THEN 'A'
           WHEN u.email LIKE '%3@%' OR u.email LIKE '%4@%' THEN 'B'
           ELSE 'C'
         END,
         'Pending Department Approval'
  FROM mock_users u
  ON CONFLICT (user_id) DO NOTHING
  RETURNING user_id
)
SELECT 'Mock data injected: ' || count(*) || ' students' FROM mock_profiles;
EOF

# Generate CSV export
docker exec -e PGPASSWORD="$POSTGRES_PASS" postgres psql -U $POSTGRES_USER -d $POSTGRES_DB -c "
COPY (
  SELECT sp.full_name, sp.student_no, u.email, sp.date_of_birth::text, sp.department, sp.section 
  FROM StudentProfiles sp JOIN Users u ON sp.user_id = u.id 
  WHERE u.email LIKE 'mock.%'
) TO STDOUT WITH CSV HEADER;
" > ./mock_students.csv
log_info "Mock students CSV generated: ./mock_students.csv"

# Mock cleanup function (called on trap EXIT)
cleanup_mock_data() {
  log_info "Cleaning up MOCK data..."
  docker exec -e PGPASSWORD="$POSTGRES_PASS" postgres psql -U $POSTGRES_USER -d $POSTGRES_DB -c "
    DELETE FROM AdminProfiles WHERE full_name = 'System Registrar';
    DELETE FROM StudentProfiles WHERE student_no LIKE 'MOCK-%';
    DELETE FROM Users WHERE email LIKE 'mock.student%' OR email = 'registrar@plv.edu.ph';
  "
}

trap "cleanup_mock_data 2>/dev/null || true; cleanup_processes" EXIT

log_info "Phase 6: Starting Application Services & Bootstrapping..."

pushd ../middleware > /dev/null
node enrollAdmin.js # This script now handles both admin enrollment AND root user bootstrapping.
nohup npm start > middleware.log 2>&1 &
PIDS+=($!)
popd > /dev/null


log_info "BLOCKGO IS LIVE! http://localhost:8080"
log_info "Student: http://localhost:8080/student | Faculty: http://localhost:8080/faculty"
log_info "Chat is embedded in the frontend! | Upload ./mock_students.csv in the frontend to test committing grades to CouchDB."

while true; do sleep 86400; done
