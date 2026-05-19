#!/bin/bash

# Initialize Fabric Channel in Kubernetes
# Requires: osnadmin CLI, peer CLI, crypto materials

set -e

CHANNEL_NAME=${1:-registrar-channel}
ORDERER_NAMESPACE=${2:-plv-main-campus}

echo "Waiting for orderer pod to be scheduled..."
while [ -z "$ORDERER_POD" ]; do
  ORDERER_POD=$(kubectl get pods -n ${ORDERER_NAMESPACE} -l app=orderer-1 -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
  sleep 2
done

echo "Waiting for fabric-cli pod..."
while [ -z "$CLI_POD" ]; do
  CLI_POD=$(kubectl get pods -n plv-main-campus -l app=fabric-cli -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
  sleep 2
done

echo "Waiting for fabric-cli to be fully ready..."
kubectl wait --for=condition=Ready pod/$CLI_POD -n plv-main-campus --timeout=120s
sleep 5

ORDERER_PORT=${4:-7053}

echo "======================================"
echo "Fabric Channel Initialization"
echo "======================================"
echo "Channel: $CHANNEL_NAME"
echo "Orderer: $ORDERER_POD (ns: $ORDERER_NAMESPACE)"
echo "CLI: $CLI_POD"
echo ""

# Step 3: Create channel via osnadmin
echo ""
echo "Step 3: Creating channel via osnadmin..."
kubectl exec $CLI_POD -c cli -n plv-main-campus -- \
    osnadmin channel join --client-cert /var/hyperledger/orderer/tls/server.crt \
    --client-key /var/hyperledger/orderer/tls/server.key \
    --ca-file /var/hyperledger/orderer/tls/ca.crt \
    --channelID $CHANNEL_NAME \
    --config-block /opt/fabric-config/network/channel-artifacts/registrar-channel.block \
    -o orderer-1.plv-main-campus.svc.cluster.local:7053
    
if [ $? -eq 0 ]; then
    echo "Channel created successfully"
else
    echo "Channel may already exist or error occurred (check logs)"
fi

# Step 4: Verify channel
echo ""
echo "Step 4: Verifying channel..."
kubectl exec $CLI_POD -c cli -n plv-main-campus -- \
    osnadmin channel list --client-cert /var/hyperledger/orderer/tls/server.crt \
    --client-key /var/hyperledger/orderer/tls/server.key \
    --ca-file /var/hyperledger/orderer/tls/ca.crt \
    -o orderer-1.plv-main-campus.svc.cluster.local:7053

echo ""
echo "Channel initialization complete"
echo ""
echo "Next: Install chaincode on peers"
echo "  ./k8s/install-chaincode.sh"
