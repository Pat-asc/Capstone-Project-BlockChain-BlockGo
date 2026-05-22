#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

CHANNEL_NAME="${CHANNEL_NAME:-registrar-channel}"
CHAINCODE_NAME="${CHAINCODE_NAME:-registrar}"
CHAINCODE_VERSION="${CHAINCODE_VERSION:-1.0}"
CHAINCODE_SEQUENCE="${CHAINCODE_SEQUENCE:-1}"
CHAINCODE_LABEL="${CHAINCODE_NAME}_${CHAINCODE_VERSION}"
ORDERER_HOST="orderer.capstone.com"
ORDERER_ADDRESS="${ORDERER_HOST}:7050"
ORDERER_TLS_CA="/var/hyperledger/crypto/orderer/tls/ca.crt"

echo "======================================"
echo "Fabric Chaincode Installation (CCaaS)"
echo "======================================"

CLI_POD=$(kubectl get pods -n plv-main-campus -l app=fabric-cli -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
if [ -z "$CLI_POD" ]; then
  echo "ERROR: Could not find fabric-cli pod!"
  echo "Run: kubectl apply -f k8s/13-cli.yaml && kubectl -n plv-main-campus rollout status deploy/fabric-cli --timeout=5m"
  exit 1
fi

if ! kubectl get pod -n plv-main-campus "$CLI_POD" -o jsonpath='{.status.phase}' | grep -q '^Running$'; then
  echo "ERROR: fabric-cli pod exists but is not Running."
  kubectl get pods -n plv-main-campus -l app=fabric-cli
  exit 1
fi

ROOT_CERT_FILE="./crypto-config-final-v2/chaincode-tls/ca-bundle/ca-bundle.pem"
if [ ! -f "$ROOT_CERT_FILE" ]; then
  echo "ERROR: Missing chaincode TLS root certificate: $ROOT_CERT_FILE"
  echo "Run the crypto generation step and then bash k8s/create-crypto-secrets.sh first."
  exit 1
fi

ROOT_CERT=$(base64 < "$ROOT_CERT_FILE" | tr -d '\n' | tr -d '\r')

org_names=(registrar faculty department)
declare -A org_label=(
  [registrar]="Registrar"
  [faculty]="Faculty"
  [department]="Department"
)
declare -A org_msp=(
  [registrar]="RegistrarMSP"
  [faculty]="FacultyMSP"
  [department]="DepartmentMSP"
)
declare -A peer_host=(
  [registrar]="peer0.registrar.capstone.com"
  [faculty]="peer0.faculty.capstone.com"
  [department]="peer0.department.capstone.com"
)
declare -A peer_service=(
  [registrar]="peer-registrar.plv-main-campus.svc.cluster.local"
  [faculty]="peer-faculty.plv-annex-campus.svc.cluster.local"
  [department]="peer-department.plv-pubad-campus.svc.cluster.local"
)
declare -A chaincode_ns=(
  [registrar]="plv-main-campus"
  [faculty]="plv-annex-campus"
  [department]="plv-pubad-campus"
)
declare -A admin_msp=(
  [registrar]="/var/hyperledger/crypto/registrar/admin/msp"
  [faculty]="/var/hyperledger/crypto/faculty/admin/msp"
  [department]="/var/hyperledger/crypto/department/admin/msp"
)
declare -A peer_tls_ca=(
  [registrar]="/var/hyperledger/crypto/registrar/peer/tls/ca.crt"
  [faculty]="/var/hyperledger/crypto/faculty/peer/tls/ca.crt"
  [department]="/var/hyperledger/crypto/department/peer/tls/ca.crt"
)
declare -A package_id

exec_cli() {
  MSYS_NO_PATHCONV=1 kubectl exec "$CLI_POD" -n plv-main-campus -- bash -c "$1"
}

peer_env() {
  local org=$1
  printf 'CORE_PEER_ADDRESS=%s:7051 CORE_PEER_LOCALMSPID=%s CORE_PEER_MSPCONFIGPATH=%s CORE_PEER_TLS_ROOTCERT_FILE=%s CORE_PEER_TLS_SERVERHOSTOVERRIDE=%s' \
    "${peer_host[$org]}" "${org_msp[$org]}" "${admin_msp[$org]}" "${peer_tls_ca[$org]}" "${peer_host[$org]}"
}

peer_args=()
for org in "${org_names[@]}"; do
  peer_args+=(--peerAddresses "${peer_host[$org]}:7051" --tlsRootCertFiles "${peer_tls_ca[$org]}")
done

echo "[INFO] Preparing DNS aliases inside fabric-cli pod..."
exec_cli "set -e
add_host() {
  local service=\"\$1\"
  local host=\"\$2\"
  local ip
  ip=\$(getent hosts \"\$service\" | awk '{print \$1}' | head -n 1)
  if [ -z \"\$ip\" ]; then
    echo \"ERROR: Cannot resolve \$service\" >&2
    exit 1
  fi
  sed -i \"/[[:space:]]\$host\$/d\" /etc/hosts
  echo \"\$ip \$host\" >> /etc/hosts
}
add_host orderer-1.plv-main-campus.svc.cluster.local $ORDERER_HOST
add_host ${peer_service[registrar]} ${peer_host[registrar]}
add_host ${peer_service[faculty]} ${peer_host[faculty]}
add_host ${peer_service[department]} ${peer_host[department]}"

echo "[INFO] Verifying mounted admin MSP and TLS files..."
for org in "${org_names[@]}"; do
  exec_cli "test -f ${admin_msp[$org]}/signcerts/cert.pem && test -f ${admin_msp[$org]}/keystore/priv_sk && test -f ${peer_tls_ca[$org]}"
done
exec_cli "test -f $ORDERER_TLS_CA"

echo "[INFO] Packaging chaincode connection profiles locally..."
mkdir -p cc-pkg
for org in "${org_names[@]}"; do
  cat <<EOF | tr -d '\r' > cc-pkg/connection.json
{
  "address": "${org}-chaincode.${chaincode_ns[$org]}.svc.cluster.local:9999",
  "dial_timeout": "10s",
  "tls_required": true,
  "client_auth_required": false,
  "root_cert": "${ROOT_CERT}"
}
EOF

  cat <<EOF | tr -d '\r' > cc-pkg/metadata.json
{
  "type": "ccaas",
  "label": "${CHAINCODE_LABEL}"
}
EOF

  tar cfz cc-pkg/code.tar.gz -C cc-pkg connection.json
  tar cfz "${org}.tar.gz" -C cc-pkg code.tar.gz metadata.json

  echo "[INFO] Transferring ${org}.tar.gz to CLI pod..."
  kubectl cp "${org}.tar.gz" "plv-main-campus/${CLI_POD}:/tmp/${org}.tar.gz"
done
rm -rf cc-pkg ./*.tar.gz

echo ""
echo "[INFO] Installing chaincode package on each peer..."
for org in "${org_names[@]}"; do
  echo "-> Installing on ${peer_host[$org]}..."
  exec_cli "$(peer_env "$org") peer lifecycle chaincode install /tmp/${org}.tar.gz"
done

echo ""
echo "[INFO] Querying package IDs per organization..."
for org in "${org_names[@]}"; do
  package_id[$org]=$(exec_cli "$(peer_env "$org") peer lifecycle chaincode queryinstalled" | awk -v label="$CHAINCODE_LABEL" '$0 ~ label { gsub(",", "", $3); print $3 }' | tail -n 1)
  if [ -z "${package_id[$org]}" ]; then
    echo "ERROR: Could not find package ID for ${org_label[$org]}MSP."
    exit 1
  fi
  echo "-> ${org_label[$org]}MSP package ID: ${package_id[$org]}"
done

echo ""
echo "[INFO] Approving chaincode for organizations..."
for org in "${org_names[@]}"; do
  echo "-> Approving for ${org_msp[$org]}..."
  exec_cli "$(peer_env "$org") peer lifecycle chaincode approveformyorg -o $ORDERER_ADDRESS --ordererTLSHostnameOverride $ORDERER_HOST --tls --cafile $ORDERER_TLS_CA --channelID $CHANNEL_NAME --name $CHAINCODE_NAME --version $CHAINCODE_VERSION --package-id ${package_id[$org]} --sequence $CHAINCODE_SEQUENCE"
done

echo ""
echo "[INFO] Checking commit readiness..."
exec_cli "$(peer_env registrar) peer lifecycle chaincode checkcommitreadiness --channelID $CHANNEL_NAME --name $CHAINCODE_NAME --version $CHAINCODE_VERSION --sequence $CHAINCODE_SEQUENCE --output json"

echo ""
echo "[INFO] Committing chaincode to ledger..."
exec_cli "$(peer_env registrar) peer lifecycle chaincode commit -o $ORDERER_ADDRESS --ordererTLSHostnameOverride $ORDERER_HOST --tls --cafile $ORDERER_TLS_CA --channelID $CHANNEL_NAME --name $CHAINCODE_NAME --version $CHAINCODE_VERSION --sequence $CHAINCODE_SEQUENCE ${peer_args[*]}"

echo ""
echo "[INFO] Initializing ledger data..."
sleep 3
exec_cli "$(peer_env registrar) peer chaincode invoke -o $ORDERER_ADDRESS --ordererTLSHostnameOverride $ORDERER_HOST --tls --cafile $ORDERER_TLS_CA -C $CHANNEL_NAME -n $CHAINCODE_NAME -c '{\"function\":\"InitLedger\",\"Args\":[]}' ${peer_args[*]}"

echo ""
echo "============================================================"
echo "Chaincode successfully installed and initialized."
echo "The entire PLV BlockGO Network is fully operational!"
echo "============================================================"
