#!/bin/bash
# Quick resume script - skip to Phase 8+ (chaincode deployment)

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

export CHANNEL_NAME="registrar-channel"
export CC_NAME="registrar"
export CC_VERSION="1.0"

log_info "Resuming deployment from chaincode phase..."

# ============================================================
# PHASE 8: CHAINCODE PACKAGING
# ============================================================
log_info "Phase 8: Packaging chaincode..."

rm -f registrar.tar.gz code.tar.gz metadata.json connection.json 2>/dev/null || true

CC_TLS_CERT=$(cat ./crypto-config/peerOrganizations/registrar.capstone.com/tlsca/tlsca.registrar.capstone.com-cert.pem 2>/dev/null | awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' || echo "")

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

log_info "Chaincode package created"

# ============================================================
# PHASE 9: CHAINCODE INSTALL
# ============================================================
log_info "Phase 9: Installing chaincode..."

docker exec -e CORE_PEER_ADDRESS=peer0.registrar.capstone.com:7051 cli peer lifecycle chaincode install registrar.tar.gz 2>&1 | grep -q "Chaincode code package identifier" && log_info "Install successful" || log_warn "Install may have failed or already installed"

sleep 5

# ============================================================
# PHASE 10: GET PACKAGE ID
# ============================================================
log_info "Phase 10: Getting package ID..."

CC_PACKAGE_ID=$(docker exec \
    -e CORE_PEER_LOCALMSPID=RegistrarMSP \
    -e CORE_PEER_ADDRESS=peer0.registrar.capstone.com:7051 \
    -e CORE_PEER_MSPCONFIGPATH=/etc/hyperledger/fabric/crypto-config/peerOrganizations/registrar.capstone.com/users/Admin@registrar.capstone.com/msp \
    -e CORE_PEER_TLS_ROOTCERT_FILE=/etc/hyperledger/fabric/crypto-config/peerOrganizations/registrar.capstone.com/peers/peer0.registrar.capstone.com/tls/ca.crt \
    -e CORE_PEER_TLS_ENABLED=true \
    cli peer lifecycle chaincode queryinstalled 2>&1 | grep "Package ID: ${CC_NAME}" | tail -n 1 | awk '{print $3}' | sed 's/,$//'

if [ -z "$CC_PACKAGE_ID" ]; then
    log_error "Could not get chaincode package ID"
fi

log_info "Package ID: $CC_PACKAGE_ID"

CC_SEQUENCE=1
log_info "Setting sequence to 1"

# ============================================================
# PHASE 11: APPROVE CHAINCODE
# ============================================================
log_info "Phase 11: Approving chaincode (sequence $CC_SEQUENCE)..."

approve_cc() {
    ORG=$1
    PEER=$2
    PEER_ORG=$3
    log_info "Approving for $ORG..."
    docker exec \
        -e CORE_PEER_LOCALMSPID=${ORG^}MSP \
        -e CORE_PEER_ADDRESS=$PEER \
        -e CORE_PEER_MSPCONFIGPATH=/etc/hyperledger/fabric/crypto-config/peerOrganizations/$PEER_ORG/users/Admin@$PEER_ORG/msp \
        -e CORE_PEER_TLS_ROOTCERT_FILE=/etc/hyperledger/fabric/crypto-config/peerOrganizations/$PEER_ORG/peers/$PEER/tls/ca.crt \
        -e CORE_PEER_TLS_ENABLED=true \
        cli peer lifecycle chaincode approveformyorg \
        --channelID $CHANNEL_NAME \
        --name $CC_NAME \
        --version $CC_VERSION \
        --package-id $CC_PACKAGE_ID \
        --sequence $CC_SEQUENCE \
        -o orderer.capstone.com:7050 \
        --ordererTLSHostnameOverride orderer.capstone.com \
        --tls \
        --cafile /etc/hyperledger/fabric/crypto-config/ordererOrganizations/capstone.com/orderers/orderer.capstone.com/tls/ca.crt
}

approve_cc "registrar.capstone.com" "peer0.registrar.capstone.com:7051" "registrar.capstone.com" || log_error "Approve for registrar.capstone.com failed"
sleep 3
approve_cc "faculty.capstone.com" "peer0.faculty.capstone.com:7051" "faculty.capstone.com" || log_error "Approve for faculty.capstone.com failed"
sleep 3
approve_cc "department.capstone.com" "peer0.department.capstone.com:7051" "department.capstone.com" || log_error "Approve for department.capstone.com failed"

sleep 5

# ============================================================
# PHASE 12: COMMIT CHAINCODE
# ============================================================
log_info "Phase 12: Committing chaincode (sequence $CC_SEQUENCE)..."

docker exec \
    -e CORE_PEER_LOCALMSPID=RegistrarMSP \
    -e CORE_PEER_ADDRESS=peer0.registrar.capstone.com:7051 \
    -e CORE_PEER_MSPCONFIGPATH=/etc/hyperledger/fabric/crypto-config/peerOrganizations/registrar.capstone.com/users/Admin@registrar.capstone.com/msp \
    -e CORE_PEER_TLS_ROOTCERT_FILE=/etc/hyperledger/fabric/crypto-config/peerOrganizations/registrar.capstone.com/peers/peer0.registrar.capstone.com/tls/ca.crt \
    -e CORE_PEER_TLS_ENABLED=true \
    cli peer lifecycle chaincode commit \
    --channelID $CHANNEL_NAME \
    --name $CC_NAME \
    --version $CC_VERSION \
    --sequence $CC_SEQUENCE \
    -o orderer.capstone.com:7050 \
    --ordererTLSHostnameOverride orderer.capstone.com \
    --tls \
    --cafile /etc/hyperledger/fabric/crypto-config/ordererOrganizations/capstone.com/orderers/orderer.capstone.com/tls/ca.crt \
    --peerAddresses peer0.registrar.capstone.com:7051 \
    --tlsRootCertFiles /etc/hyperledger/fabric/crypto-config/peerOrganizations/registrar.capstone.com/peers/peer0.registrar.capstone.com/tls/ca.crt \
    --peerAddresses peer0.faculty.capstone.com:7051 \
    --tlsRootCertFiles /etc/hyperledger/fabric/crypto-config/peerOrganizations/faculty.capstone.com/peers/peer0.faculty.capstone.com/tls/ca.crt \
    --peerAddresses peer0.department.capstone.com:7051 \
    --tlsRootCertFiles /etc/hyperledger/fabric/crypto-config/peerOrganizations/department.capstone.com/peers/peer0.department.capstone.com/tls/ca.crt || log_error "Chaincode commit failed"

sleep 5
log_info "Chaincode committed successfully"

# ============================================================
# PHASE 13: UPDATE .ENV
# ============================================================
log_info "Phase 13: Updating environment..."

if grep -q "^CHAINCODE_ID=" .env; then
    sed -i.bak "s#^CHAINCODE_ID=.*#CHAINCODE_ID=$CC_PACKAGE_ID#" .env
else
    echo "CHAINCODE_ID=$CC_PACKAGE_ID" >> .env
fi
log_info "CHAINCODE_ID=$CC_PACKAGE_ID"

log_info "Restarting chaincode container..."
export CHAINCODE_ID=$CC_PACKAGE_ID
docker compose stop registrar-chaincode 2>/dev/null || true
docker compose rm -f registrar-chaincode 2>/dev/null || true
sleep 2
docker compose up -d --no-deps registrar-chaincode || log_warn "Chaincode restart had issues"

sleep 10

echo ""
echo "=========================================================="
echo "CHAINCODE DEPLOYMENT COMPLETE"
echo "=========================================================="
log_info "Chaincode: $CC_NAME v$CC_VERSION (Sequence: $CC_SEQUENCE)"
log_info "Package ID: $CC_PACKAGE_ID"
echo ""
log_info "Next steps: deploy application services and bootstrap initial registrar"
