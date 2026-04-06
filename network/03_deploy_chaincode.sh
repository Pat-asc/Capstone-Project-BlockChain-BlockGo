log_info "Phase 8: Packaging chaincode..."

rm -f registrar.tar.gz code.tar.gz metadata.json connection.json

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

log_info "Phase 9: Installing chaincode..."

install_chaincode() {
    ORG=$1
    PEER=$2
    PORT=$3
    MSPID=$4
    log_info "Installing on $PEER:$PORT..."
    docker exec -e CORE_PEER_LOCALMSPID=$MSPID \
        -e CORE_PEER_ADDRESS=$PEER:$PORT \
        -e CORE_PEER_MSPCONFIGPATH=/etc/hyperledger/fabric/crypto-config/peerOrganizations/$ORG/users/Admin@$ORG/msp \
        -e CORE_PEER_TLS_ROOTCERT_FILE=/etc/hyperledger/fabric/crypto-config/peerOrganizations/$ORG/peers/$PEER/tls/ca.crt \
        cli peer lifecycle chaincode install registrar.tar.gz >/dev/null 2>&1 || log_warn "Chaincode install on $PEER:$PORT failed (might be installed already)"
}

install_chaincode "registrar.capstone.com" "peer0.registrar.capstone.com" "7051" "RegistrarMSP"
install_chaincode "faculty.capstone.com" "peer0.faculty.capstone.com" "7051" "FacultyMSP"
install_chaincode "department.capstone.com" "peer0.department.capstone.com" "7051" "DepartmentMSP"

sleep 5

log_info "Phase 10: Getting package ID..."

CC_PACKAGE_ID=$(docker exec -e CORE_PEER_LOCALMSPID=RegistrarMSP \
    -e CORE_PEER_ADDRESS=peer0.registrar.capstone.com:7051 \
    -e CORE_PEER_MSPCONFIGPATH=/etc/hyperledger/fabric/crypto-config/peerOrganizations/registrar.capstone.com/users/Admin@registrar.capstone.com/msp \
    -e CORE_PEER_TLS_ROOTCERT_FILE=/etc/hyperledger/fabric/crypto-config/peerOrganizations/registrar.capstone.com/peers/peer0.registrar.capstone.com/tls/ca.crt \
    cli peer lifecycle chaincode queryinstalled 2>&1 | grep "Package ID:" | awk '{print $3}' | sed 's/.$//')

[ -z "$CC_PACKAGE_ID" ] && log_error "Could not get chaincode package ID"
log_info "Package ID: $CC_PACKAGE_ID"

CURRENT_SEQUENCE=$(docker exec -e CORE_PEER_LOCALMSPID=RegistrarMSP \
    -e CORE_PEER_ADDRESS=peer0.registrar.capstone.com:7051 \
    -e CORE_PEER_MSPCONFIGPATH=/etc/hyperledger/fabric/crypto-config/peerOrganizations/registrar.capstone.com/users/Admin@registrar.capstone.com/msp \
    -e CORE_PEER_TLS_ROOTCERT_FILE=/etc/hyperledger/fabric/crypto-config/peerOrganizations/registrar.capstone.com/peers/peer0.registrar.capstone.com/tls/ca.crt \
    cli peer lifecycle chaincode querycommitted -C $CHANNEL_NAME -O json 2>/dev/null | jq -r '.chaincode_definitions // [] | .[] | select(.name == "'$CC_NAME'") | .sequence' || echo "")

COMMITTED_PACKAGE_ID=$(docker exec -e CORE_PEER_LOCALMSPID=RegistrarMSP \
    -e CORE_PEER_ADDRESS=peer0.registrar.capstone.com:7051 \
    -e CORE_PEER_MSPCONFIGPATH=/etc/hyperledger/fabric/crypto-config/peerOrganizations/registrar.capstone.com/users/Admin@registrar.capstone.com/msp \
    -e CORE_PEER_TLS_ROOTCERT_FILE=/etc/hyperledger/fabric/crypto-config/peerOrganizations/registrar.capstone.com/peers/peer0.registrar.capstone.com/tls/ca.crt \
    cli peer lifecycle chaincode querycommitted -C $CHANNEL_NAME -O json 2>/dev/null | jq -r '.chaincode_definitions // [] | .[] | select(.name == "'$CC_NAME'") | .package_id' || echo "")

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

log_info "Phase 11: Approving chaincode (sequence $CC_SEQUENCE)..."

if [ "$SKIP_COMMIT" = false ]; then
approve_cc() {
    ORG=$1
    PEER=$2
    PORT=$3
    MSPID=$4
    log_info "Approving for $ORG..."
    if ! docker exec -e CORE_PEER_LOCALMSPID=$MSPID \
        -e CORE_PEER_ADDRESS=$PEER:$PORT \
        -e CORE_PEER_MSPCONFIGPATH=/etc/hyperledger/fabric/crypto-config/peerOrganizations/$ORG/users/Admin@$ORG/msp \
        -e CORE_PEER_TLS_ROOTCERT_FILE=/etc/hyperledger/fabric/crypto-config/peerOrganizations/$ORG/peers/$PEER/tls/ca.crt \
        cli peer lifecycle chaincode approveformyorg --channelID $CHANNEL_NAME --name $CC_NAME --version $CC_VERSION \
        --package-id $CC_PACKAGE_ID --sequence $CC_SEQUENCE -o orderer.capstone.com:7050 \
        --ordererTLSHostnameOverride orderer.capstone.com --tls \
        --cafile /etc/hyperledger/fabric/crypto-config/ordererOrganizations/capstone.com/orderers/orderer.capstone.com/tls/ca.crt; then
        log_error "Approve for $ORG failed. See error output above."
    fi
}

approve_cc "registrar.capstone.com" "peer0.registrar.capstone.com" "7051" "RegistrarMSP"
approve_cc "faculty.capstone.com" "peer0.faculty.capstone.com" "7051" "FacultyMSP"
approve_cc "department.capstone.com" "peer0.department.capstone.com" "7051" "DepartmentMSP"

sleep 5
else
    log_info "Skipping approval phase."
fi

log_info "Phase 12: Committing chaincode (sequence $CC_SEQUENCE)..."

if [ "$SKIP_COMMIT" = false ]; then
if ! docker exec -e CORE_PEER_LOCALMSPID=RegistrarMSP \
    -e CORE_PEER_ADDRESS=peer0.registrar.capstone.com:7051 \
    -e CORE_PEER_MSPCONFIGPATH=/etc/hyperledger/fabric/crypto-config/peerOrganizations/registrar.capstone.com/users/Admin@registrar.capstone.com/msp \
    -e CORE_PEER_TLS_ROOTCERT_FILE=/etc/hyperledger/fabric/crypto-config/peerOrganizations/registrar.capstone.com/peers/peer0.registrar.capstone.com/tls/ca.crt \
    cli peer lifecycle chaincode commit --channelID $CHANNEL_NAME --name $CC_NAME --version $CC_VERSION --sequence $CC_SEQUENCE \
    -o orderer.capstone.com:7050 --ordererTLSHostnameOverride orderer.capstone.com --tls \
    --cafile /etc/hyperledger/fabric/crypto-config/ordererOrganizations/capstone.com/orderers/orderer.capstone.com/tls/ca.crt \
    --peerAddresses peer0.registrar.capstone.com:7051 --tlsRootCertFiles /etc/hyperledger/fabric/crypto-config/peerOrganizations/registrar.capstone.com/peers/peer0.registrar.capstone.com/tls/ca.crt \
    --peerAddresses peer0.faculty.capstone.com:7051 --tlsRootCertFiles /etc/hyperledger/fabric/crypto-config/peerOrganizations/faculty.capstone.com/peers/peer0.faculty.capstone.com/tls/ca.crt \
    --peerAddresses peer0.department.capstone.com:7051 --tlsRootCertFiles /etc/hyperledger/fabric/crypto-config/peerOrganizations/department.capstone.com/peers/peer0.department.capstone.com/tls/ca.crt; then
    log_error "Chaincode commit failed. See error output above."
fi

sleep 5
log_info "Chaincode committed successfully"
else
    log_info "Skipping commit phase."
fi

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