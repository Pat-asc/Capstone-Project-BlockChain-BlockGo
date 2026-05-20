#!/bin/bash
set -e
cd "$(dirname "$0")/.."

echo "======================================"
echo "Fabric Chaincode Installation (CCaaS)"
echo "======================================"

CLI_POD=$(kubectl get pods -n plv-main-campus -l app=fabric-cli -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
if [ -z "$CLI_POD" ]; then
  echo "ERROR: Could not find fabric-cli pod!"
  exit 1
fi

echo "[INFO] Packaging Chaincode properties locally..."
mkdir -p cc-pkg
ROOT_CERT=$(cat ./crypto-config-final-v2/chaincode-tls/ca-bundle/ca-bundle.pem | base64 | tr -d '\n' | tr -d '\r')

for org in registrar faculty department; do
  if [ "$org" == "registrar" ]; then NS="plv-main-campus"; fi
  if [ "$org" == "faculty" ]; then NS="plv-annex-campus"; fi
  if [ "$org" == "department" ]; then NS="plv-pubad-campus"; fi
  
  cat <<EOF | tr -d '\r' > cc-pkg/connection.json
{
  "address": "${org}-chaincode.${NS}.svc.cluster.local:9999",
  "dial_timeout": "10s",
  "tls_required": true,
  "client_auth_required": false,
  "root_cert": "${ROOT_CERT}"
}
EOF
  cat <<EOF | tr -d '\r' > cc-pkg/metadata.json
{
    "type": "ccaas",
    "label": "registrar_1.0"
}
EOF
  tar cfz cc-pkg/code.tar.gz -C cc-pkg connection.json
  tar cfz ${org}.tar.gz -C cc-pkg code.tar.gz metadata.json
  
  echo "[INFO] Transferring ${org}.tar.gz to CLI pod..."
  kubectl cp ${org}.tar.gz plv-main-campus/$CLI_POD:/tmp/${org}.tar.gz
done
rm -rf cc-pkg *.tar.gz

echo ""
echo "[INFO] Executing installation across peers..."

install_on_peer() {
  local ORG=$1; local DOM=$2; local PORT=$3
  echo "-> Installing on peer0.${DOM}..."
  MSYS_NO_PATHCONV=1 kubectl exec $CLI_POD -n plv-main-campus -- bash -c "CORE_PEER_ADDRESS=peer0.${DOM}:${PORT} CORE_PEER_LOCALMSPID=${ORG}MSP CORE_PEER_TLS_ROOTCERT_FILE=/opt/fabric-config/network/crypto-config-final-v2/peerOrganizations/${DOM}/peers/peer0.${DOM}/tls/ca.crt CORE_PEER_MSPCONFIGPATH=/opt/fabric-config/network/crypto-config-final-v2/peerOrganizations/${DOM}/users/Admin@${DOM}/msp peer lifecycle chaincode install /tmp/${1,,}.tar.gz"
}

install_on_peer "Registrar" "registrar.capstone.com" "7051"
install_on_peer "Faculty" "faculty.capstone.com" "9051"
install_on_peer "Department" "department.capstone.com" "11051"

echo ""
echo "[INFO] Querying Package ID..."
PKG_ID=$(MSYS_NO_PATHCONV=1 kubectl exec $CLI_POD -n plv-main-campus -- bash -c "CORE_PEER_ADDRESS=peer0.registrar.capstone.com:7051 CORE_PEER_LOCALMSPID=RegistrarMSP CORE_PEER_TLS_ROOTCERT_FILE=/opt/fabric-config/network/crypto-config-final-v2/peerOrganizations/registrar.capstone.com/peers/peer0.registrar.capstone.com/tls/ca.crt CORE_PEER_MSPCONFIGPATH=/opt/fabric-config/network/crypto-config-final-v2/peerOrganizations/registrar.capstone.com/users/Admin@registrar.capstone.com/msp peer lifecycle chaincode queryinstalled" | grep "registrar_1.0" | awk '{print $3}' | sed 's/,//')
echo "Identified Package ID: $PKG_ID"

echo ""
echo "[INFO] Approving chaincode for organizations..."

approve_org() {
  local ORG=$1; local DOM=$2; local PORT=$3
  echo "-> Approving for ${ORG}MSP..."
  MSYS_NO_PATHCONV=1 kubectl exec $CLI_POD -n plv-main-campus -- bash -c "CORE_PEER_ADDRESS=peer0.${DOM}:${PORT} CORE_PEER_LOCALMSPID=${ORG}MSP CORE_PEER_TLS_ROOTCERT_FILE=/opt/fabric-config/network/crypto-config-final-v2/peerOrganizations/${DOM}/peers/peer0.${DOM}/tls/ca.crt CORE_PEER_MSPCONFIGPATH=/opt/fabric-config/network/crypto-config-final-v2/peerOrganizations/${DOM}/users/Admin@${DOM}/msp peer lifecycle chaincode approveformyorg -o orderer-1.plv-main-campus.svc.cluster.local:7053 --ordererTLSHostnameOverride orderer.capstone.com --tls --cafile /opt/fabric-config/network/crypto-config-final-v2/ordererOrganizations/capstone.com/orderers/orderer.capstone.com/tls/ca.crt --channelID registrar-channel --name registrar --version 1.0 --package-id $PKG_ID --sequence 1"
}

approve_org "Registrar" "registrar.capstone.com" "7051"
approve_org "Faculty" "faculty.capstone.com" "9051"
approve_org "Department" "department.capstone.com" "11051"

echo ""
echo "[INFO] Committing chaincode to ledger..."
MSYS_NO_PATHCONV=1 kubectl exec $CLI_POD -n plv-main-campus -- bash -c "CORE_PEER_ADDRESS=peer0.registrar.capstone.com:7051 CORE_PEER_LOCALMSPID=RegistrarMSP CORE_PEER_TLS_ROOTCERT_FILE=/opt/fabric-config/network/crypto-config-final-v2/peerOrganizations/registrar.capstone.com/peers/peer0.registrar.capstone.com/tls/ca.crt CORE_PEER_MSPCONFIGPATH=/opt/fabric-config/network/crypto-config-final-v2/peerOrganizations/registrar.capstone.com/users/Admin@registrar.capstone.com/msp peer lifecycle chaincode commit -o orderer-1.plv-main-campus.svc.cluster.local:7053 --ordererTLSHostnameOverride orderer.capstone.com --tls --cafile /opt/fabric-config/network/crypto-config-final-v2/ordererOrganizations/capstone.com/orderers/orderer.capstone.com/tls/ca.crt --channelID registrar-channel --name registrar --version 1.0 --sequence 1 --peerAddresses peer0.registrar.capstone.com:7051 --tlsRootCertFiles /opt/fabric-config/network/crypto-config-final-v2/peerOrganizations/registrar.capstone.com/peers/peer0.registrar.capstone.com/tls/ca.crt --peerAddresses peer0.faculty.capstone.com:9051 --tlsRootCertFiles /opt/fabric-config/network/crypto-config-final-v2/peerOrganizations/faculty.capstone.com/peers/peer0.faculty.capstone.com/tls/ca.crt --peerAddresses peer0.department.capstone.com:11051 --tlsRootCertFiles /opt/fabric-config/network/crypto-config-final-v2/peerOrganizations/department.capstone.com/peers/peer0.department.capstone.com/tls/ca.crt"

echo ""
echo "[INFO] Initializing Ledger Data..."
sleep 3
MSYS_NO_PATHCONV=1 kubectl exec $CLI_POD -n plv-main-campus -- bash -c "CORE_PEER_ADDRESS=peer0.registrar.capstone.com:7051 CORE_PEER_LOCALMSPID=RegistrarMSP CORE_PEER_TLS_ROOTCERT_FILE=/opt/fabric-config/network/crypto-config-final-v2/peerOrganizations/registrar.capstone.com/peers/peer0.registrar.capstone.com/tls/ca.crt CORE_PEER_MSPCONFIGPATH=/opt/fabric-config/network/crypto-config-final-v2/peerOrganizations/registrar.capstone.com/users/Admin@registrar.capstone.com/msp peer chaincode invoke -o orderer-1.plv-main-campus.svc.cluster.local:7053 --ordererTLSHostnameOverride orderer.capstone.com --tls --cafile /opt/fabric-config/network/crypto-config-final-v2/ordererOrganizations/capstone.com/orderers/orderer.capstone.com/tls/ca.crt -C registrar-channel -n registrar -c '{\"function\":\"InitLedger\",\"Args\":[]}' --peerAddresses peer0.registrar.capstone.com:7051 --tlsRootCertFiles /opt/fabric-config/network/crypto-config-final-v2/peerOrganizations/registrar.capstone.com/peers/peer0.registrar.capstone.com/tls/ca.crt --peerAddresses peer0.faculty.capstone.com:9051 --tlsRootCertFiles /opt/fabric-config/network/crypto-config-final-v2/peerOrganizations/faculty.capstone.com/peers/peer0.faculty.capstone.com/tls/ca.crt --peerAddresses peer0.department.capstone.com:11051 --tlsRootCertFiles /opt/fabric-config/network/crypto-config-final-v2/peerOrganizations/department.capstone.com/peers/peer0.department.capstone.com/tls/ca.crt"

echo ""
echo "============================================================"
echo "✓ Chaincode Successfully Installed & Initialized!"
echo "The entire PLV BlockGO Network is fully operational!"
echo "============================================================"