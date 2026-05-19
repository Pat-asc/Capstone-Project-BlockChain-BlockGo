#!/bin/bash

# Install Chaincode on Fabric Peers in Kubernetes
# Assumes: Middleware and fabric-network already deployed

set -e

CHAINCODE_NAME=${1:-registrar}
CHAINCODE_VERSION=${2:-1.0}
CHAINCODE_PATH=${3:-./network}
PEERS=(
    "peer-registrar.plv-main-campus"
    "peer-faculty.plv-annex-campus"
    "peer-department.plv-pubad-campus"
)

echo "======================================"
echo "Fabric Chaincode Installation"
echo "======================================"
echo "Chaincode: $CHAINCODE_NAME v$CHAINCODE_VERSION"
echo ""

# Install via middleware API
echo "Installing chaincode via middleware API..."

# Assumes middleware is port-forwarded: kubectl port-forward -n plv-fabric svc/middleware-api 4000:4000

PAYLOAD=$(cat <<EOF
{
  "chaincodeName": "$CHAINCODE_NAME",
  "chaincodeVersion": "$CHAINCODE_VERSION",
  "chaincodePath": "$CHAINCODE_PATH",
  "chaincodeType": "golang"
}
EOF
)

curl -X POST http://localhost:4000/api/install-chaincode \
  -H "Content-Type: application/json" \
  -H "x-api-key: de70901b71a67b0b064e478771fa49fd47611422dbe8f9f4ee99b5075dcef008" \
  -d "$PAYLOAD"

if [ $? -eq 0 ]; then
    echo ""
    echo "✓ Chaincode installed"
else
    echo ""
    echo "ERROR: Installation failed"
    exit 1
fi

echo ""
echo "Next: Approve chaincode on organizations"
echo "  ./k8s/approve-chaincode.sh"
