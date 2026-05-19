#!/bin/bash

# Join Fabric Peers to Channel in Kubernetes
set -e

# Ensure script always runs from the network/ directory context
cd "$(dirname "$0")/.."

CHANNEL_NAME=${1:-registrar-channel}

echo "======================================"
echo "Fabric Peer Channel Join"
echo "======================================"
echo "Channel: $CHANNEL_NAME"
echo ""

# Function to join a peer
join_peer() {
    local DEPLOY_NAME=$1
    local NAMESPACE=$2

    echo "Joining $DEPLOY_NAME in $NAMESPACE to $CHANNEL_NAME..."
    
    local ORG_NAME=${DEPLOY_NAME#peer-}
    local OVERRIDE="peer0.${ORG_NAME}.capstone.com"
    local DOMAIN="${ORG_NAME}.capstone.com"

    local max_retries=20
    local attempt=1
    while [ $attempt -le $max_retries ]; do
        # Dynamically fetch pod name in case it restarted (CrashLoopBackOff)
        local POD_NAME=$(kubectl get pods -n $NAMESPACE -l app=$DEPLOY_NAME -o jsonpath='{.items[0].metadata.name}')
        
        if [ -n "$POD_NAME" ]; then
            # Re-copy files in every iteration because if the pod crashes, its /tmp directory is wiped!
            kubectl cp ./channel-artifacts-final/${CHANNEL_NAME}.block $NAMESPACE/$POD_NAME:/tmp/${CHANNEL_NAME}.block 2>/dev/null || true
            kubectl cp ./crypto-config-final-v2/peerOrganizations/${DOMAIN}/users/Admin@${DOMAIN}/msp $NAMESPACE/$POD_NAME:/tmp/admin-msp 2>/dev/null || true

            set +e
            local OUTPUT=$(kubectl exec deployment/$DEPLOY_NAME -n $NAMESPACE -- env CORE_PEER_MSPCONFIGPATH=/tmp/admin-msp CORE_PEER_TLS_SERVERHOSTOVERRIDE=$OVERRIDE CORE_PEER_ADDRESS=127.0.0.1:7051 peer channel join -b /tmp/${CHANNEL_NAME}.block 2>&1)
            local EXIT_CODE=$?
            set -e

            if [ $EXIT_CODE -eq 0 ] || echo "$OUTPUT" | grep -q "already exists"; then
                echo "✓ Successfully joined channel"
                return 0
            fi
        fi
        echo "⚠ Attempt $attempt failed (Pod may be initializing/restarting). Retrying in 10 seconds..."
        sleep 10
        attempt=$((attempt + 1))
    done
    echo "⚠ Peer in $DEPLOY_NAME may already be in the channel or failed to connect."
}

# 1. Registrar Org
join_peer "peer-registrar" "plv-main-campus"

# 2. Faculty Org
join_peer "peer-faculty" "plv-annex-campus"

# 3. Department Org
join_peer "peer-department" "plv-pubad-campus"

echo ""
echo "✓ Peer join operations complete"
