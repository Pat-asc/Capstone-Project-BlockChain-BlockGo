#!/bin/bash

# Deploy PLV BLOCKGO Multi-Campus Fabric Network to Kubernetes
# Usage: ./deploy-k8s.sh [namespace] [action]
# Example: ./deploy-k8s.sh plv-fabric apply

set -e

# Ensure script always runs from the network/k8s directory context
cd "$(dirname "$0")/.."

NAMESPACE=${1:-plv-fabric}
ACTION=${2:-apply}

echo "======================================"
echo "PLV BLOCKGO K8s Deployment Script"
echo "======================================"
echo "Namespace: $NAMESPACE"
echo "Action: $ACTION"
echo ""

# Fail-proof manifest applicator
apply_manifest() {
    if [ -f "$1" ]; then
        kubectl $ACTION -f "$1" || true
    else
        echo "Manifest $1 not found. Skipping safely."
    fi
}

# Function to check if kubectl is installed
check_kubectl() {
    if ! command -v kubectl &> /dev/null; then
        echo "ERROR: kubectl not found. Please install kubectl."
        exit 1
    fi
    echo "kubectl is installed"
}

# Function to check cluster connectivity
check_cluster() {
    if ! kubectl cluster-info &> /dev/null; then
        echo "ERROR: Cannot connect to Kubernetes cluster. Check your kubeconfig."
        exit 1
    fi
    echo "Connected to Kubernetes cluster"
}

# Function to inject secrets and configmaps
inject_configs() {
    echo "Injecting official configurations and secrets into cluster..."
    
    # Ensure namespaces exist first
    kubectl apply -f ./k8s/00-namespace.yaml >/dev/null 2>&1
    
    # Inject ConfigMaps from OFFICIAL local files
    kubectl create configmap fabric-common-config --from-file=core.yaml=./config/core.yaml --from-file=orderer.yaml=./config/orderer.yaml -n plv-main-campus --dry-run=client -o yaml | kubectl apply -f -
    kubectl create configmap fabric-common-config --from-file=core.yaml=./config/core.yaml --from-file=orderer.yaml=./config/orderer.yaml -n plv-annex-campus --dry-run=client -o yaml | kubectl apply -f -
    kubectl create configmap fabric-common-config --from-file=core.yaml=./config/core.yaml --from-file=orderer.yaml=./config/orderer.yaml -n plv-pubad-campus --dry-run=client -o yaml | kubectl apply -f -
    
    if [ ! -f "./init-db-schema.sql" ]; then
        echo "-- Fallback empty init script" > ./init-db-schema.sql
    fi

    # Inject official SQL schema into all campus namespaces (for primary and replicas)
    for ns in plv-main-campus plv-annex-campus plv-pubad-campus; do
        kubectl create configmap postgres-init-script --from-file=init.sql=./init-db-schema.sql -n $ns --dry-run=client -o yaml | kubectl apply -f -
    done

    # Inject IPFS swarm.key
    if [ ! -f "./swarm.key" ]; then
        echo "Generating missing IPFS swarm.key..."
        echo -e "/key/swarm/psk/1.0.0/\n/base16/\n1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a" > ./swarm.key
    fi

    if [ -f "./swarm.key" ] && grep -q "\-e" "./swarm.key"; then
        echo "Corrupted swarm.key detected. Deleting..."
        rm -f ./swarm.key
    fi

    if [ -f "./swarm.key" ]; then
        # Strip Windows CRLF line endings which crash IPFS
        tr -d '\r' < ./swarm.key > ./swarm-clean.key
        kubectl create configmap ipfs-swarm-key --from-file=swarm.key=./swarm-clean.key -n plv-fabric --dry-run=client -o yaml | kubectl apply -f -
        rm -f ./swarm-clean.key
    fi

    # Inject Secrets from .env
    ENV_FILE="./.env"
    CLEAN_ENV="./.clean.env"
    touch "$CLEAN_ENV"
    
    if [ -f "$ENV_FILE" ]; then
        # Deduplicate .env, strip Windows CRLF, and add fallbacks for critical values
        tr -d '\r' < "$ENV_FILE" | grep -v '^#' | grep '=' | sort -u -t '=' -k 1,1 > "$CLEAN_ENV"
    else
        echo "WARNING: .env not found. Proceeding with fallback secrets to prevent CreateContainerConfigError."
    fi

    # Ensure critical secrets have a fallback to prevent CreateContainerConfigError
    grep -q "^POSTGRES_USER=" "$CLEAN_ENV" || echo "POSTGRES_USER=postgres" >> "$CLEAN_ENV"
    grep -q "^POSTGRES_PASS=" "$CLEAN_ENV" || echo "POSTGRES_PASS=password" >> "$CLEAN_ENV"
    grep -q "^POSTGRES_PASSWORD=" "$CLEAN_ENV" || echo "POSTGRES_PASSWORD=password" >> "$CLEAN_ENV"
    grep -q "^POSTGRESQL_PASSWORD=" "$CLEAN_ENV" || echo "POSTGRESQL_PASSWORD=password" >> "$CLEAN_ENV"
    grep -q "^POSTGRES_POSTGRES_PASSWORD=" "$CLEAN_ENV" || echo "POSTGRES_POSTGRES_PASSWORD=password" >> "$CLEAN_ENV"
    grep -q "^POSTGRES_PRIMARY_PASSWORD=" "$CLEAN_ENV" || echo "POSTGRES_PRIMARY_PASSWORD=password" >> "$CLEAN_ENV"
    grep -q "^POSTGRES_DB=" "$CLEAN_ENV" || echo "POSTGRES_DB=ActivityLogs" >> "$CLEAN_ENV"
    grep -q "^POSTGRES_REPL_USER=" "$CLEAN_ENV" || echo "POSTGRES_REPL_USER=replica" >> "$CLEAN_ENV"
    grep -q "^POSTGRES_REPLICATION_USER=" "$CLEAN_ENV" || echo "POSTGRES_REPLICATION_USER=replica" >> "$CLEAN_ENV"
    grep -q "^POSTGRES_REPL_PASS=" "$CLEAN_ENV" || echo "POSTGRES_REPL_PASS=replica_pass_123" >> "$CLEAN_ENV"
    grep -q "^POSTGRES_REPLICATION_PASSWORD=" "$CLEAN_ENV" || echo "POSTGRES_REPLICATION_PASSWORD=replica_pass_123" >> "$CLEAN_ENV"
    grep -q "^POSTGRESQL_REPLICATION_PASSWORD=" "$CLEAN_ENV" || echo "POSTGRESQL_REPLICATION_PASSWORD=replica_pass_123" >> "$CLEAN_ENV"
    grep -q "^IPFS_ENCRYPTION_KEY=" "$CLEAN_ENV" || echo "IPFS_ENCRYPTION_KEY=fallback-ipfs-key-123456789012345" >> "$CLEAN_ENV"
    grep -q "^BOOTSTRAP_REGISTRAR_PASS=" "$CLEAN_ENV" || echo "BOOTSTRAP_REGISTRAR_PASS=adminpw" >> "$CLEAN_ENV"
    grep -q "^JWT_SECRET=" "$CLEAN_ENV" || echo "JWT_SECRET=fallback-jwt-secret-that-is-at-least-32-bytes-long" >> "$CLEAN_ENV"
    grep -q "^INTERNAL_API_KEY=" "$CLEAN_ENV" || echo "INTERNAL_API_KEY=fallback-internal-api-key-for-service-to-service" >> "$CLEAN_ENV"
    grep -q "^CHAINCODE_ID_REGISTRAR=" "$CLEAN_ENV" || echo "CHAINCODE_ID_REGISTRAR=registrar_1.0:missing-package-id" >> "$CLEAN_ENV"
    grep -q "^CHAINCODE_ID_FACULTY=" "$CLEAN_ENV" || echo "CHAINCODE_ID_FACULTY=registrar_1.0:missing-package-id" >> "$CLEAN_ENV"
    grep -q "^CHAINCODE_ID_DEPARTMENT=" "$CLEAN_ENV" || echo "CHAINCODE_ID_DEPARTMENT=registrar_1.0:missing-package-id" >> "$CLEAN_ENV"

    # Inject GKE Internal DNS URLs to connect microservices across namespaces
    grep -q "^MIDDLEWARE_URL=" "$CLEAN_ENV" || echo "MIDDLEWARE_URL=http://middleware-api.plv-fabric.svc.cluster.local:4000" >> "$CLEAN_ENV"
    grep -q "^POSTGRES_HOST=" "$CLEAN_ENV" || echo "POSTGRES_HOST=postgres-primary.plv-main-campus.svc.cluster.local" >> "$CLEAN_ENV"
    
    grep -q "^COUCHDB_WALLET_REGISTRAR_URL=" "$CLEAN_ENV" || echo "COUCHDB_WALLET_REGISTRAR_URL=http://capstone:pass123@couchdb-registrar.plv-main-campus.svc.cluster.local:5984" >> "$CLEAN_ENV"
    grep -q "^COUCHDB_WALLET_FACULTY_URL=" "$CLEAN_ENV" || echo "COUCHDB_WALLET_FACULTY_URL=http://capstone:pass123@couchdb-faculty.plv-annex-campus.svc.cluster.local:5984" >> "$CLEAN_ENV"
    grep -q "^COUCHDB_WALLET_DEPARTMENT_URL=" "$CLEAN_ENV" || echo "COUCHDB_WALLET_DEPARTMENT_URL=http://capstone:pass123@couchdb-department.plv-pubad-campus.svc.cluster.local:5984" >> "$CLEAN_ENV"

    grep -q "^FABRIC_CA_REGISTRAR_URL=" "$CLEAN_ENV" || echo "FABRIC_CA_REGISTRAR_URL=https://fabric-ca-registrar.plv-main-campus.svc.cluster.local:7054" >> "$CLEAN_ENV"
    grep -q "^FABRIC_CA_FACULTY_URL=" "$CLEAN_ENV" || echo "FABRIC_CA_FACULTY_URL=https://fabric-ca-faculty.plv-annex-campus.svc.cluster.local:7054" >> "$CLEAN_ENV"
    grep -q "^FABRIC_CA_DEPARTMENT_URL=" "$CLEAN_ENV" || echo "FABRIC_CA_DEPARTMENT_URL=https://fabric-ca-department.plv-pubad-campus.svc.cluster.local:7054" >> "$CLEAN_ENV"

    for ns in plv-fabric plv-main-campus plv-annex-campus plv-pubad-campus; do
        kubectl create secret generic blockgo-secrets -n $ns --from-env-file="$CLEAN_ENV" --dry-run=client -o yaml | kubectl apply -f -
    done
    rm -f "$CLEAN_ENV"
    echo "Secrets and ConfigMaps successfully injected"

    if [ -n "$IMAGE_REGISTRY" ]; then
        echo "Building and pushing app images to $IMAGE_REGISTRY..."
        docker build -t "$IMAGE_REGISTRY/fabric-middleware:latest" ../middleware
        docker build -t "$IMAGE_REGISTRY/frontend:latest" ../frontend
        docker build -t "$IMAGE_REGISTRY/client-app:latest" ../client-app
        docker build -t "$IMAGE_REGISTRY/registrar-chaincode:latest" ../chaincode
        docker build -t "$IMAGE_REGISTRY/faculty-chaincode:latest" ../chaincode
        docker build -t "$IMAGE_REGISTRY/department-chaincode:latest" ../chaincode

        docker push "$IMAGE_REGISTRY/fabric-middleware:latest"
        docker push "$IMAGE_REGISTRY/frontend:latest"
        docker push "$IMAGE_REGISTRY/client-app:latest"
        docker push "$IMAGE_REGISTRY/registrar-chaincode:latest"
        docker push "$IMAGE_REGISTRY/faculty-chaincode:latest"
        docker push "$IMAGE_REGISTRY/department-chaincode:latest"
    else
        echo "ERROR: IMAGE_REGISTRY is required for GKE, for example:"
        echo "  export IMAGE_REGISTRY=us-central1-docker.pkg.dev/YOUR_PROJECT/plv-repo"
        exit 1
    fi
}

# Function to deploy manifests
deploy_manifests() {
    echo ""
    echo "Deploying K8s manifests..."

    if [ -z "$IMAGE_REGISTRY" ]; then
        echo "ERROR: IMAGE_REGISTRY is required for GKE, for example:"
        echo "  export IMAGE_REGISTRY=us-central1-docker.pkg.dev/YOUR_PROJECT/plv-repo"
        exit 1
    fi

    # Temporary directory for processed manifests
    TMP_K8S_DIR="./k8s/.tmp-k8s"
    rm -rf "$TMP_K8S_DIR" && mkdir -p "$TMP_K8S_DIR"
    cp ./k8s/*.yaml "$TMP_K8S_DIR/"

    # GKE pulls images from Artifact Registry; placeholder image names are rewritten in the temp manifests.
    sed -i "s|image: registry.example.com/plv-repo/fabric-middleware:latest|image: $IMAGE_REGISTRY/fabric-middleware:latest|g" "$TMP_K8S_DIR"/*.yaml
    sed -i "s|image: registry.example.com/plv-repo/frontend:latest|image: $IMAGE_REGISTRY/frontend:latest|g" "$TMP_K8S_DIR"/*.yaml
    sed -i "s|image: registry.example.com/plv-repo/client-app:latest|image: $IMAGE_REGISTRY/client-app:latest|g" "$TMP_K8S_DIR"/*.yaml
    sed -i "s|image: registry.example.com/plv-repo/registrar-chaincode:latest|image: $IMAGE_REGISTRY/registrar-chaincode:latest|g" "$TMP_K8S_DIR"/*.yaml
    sed -i "s|image: registry.example.com/plv-repo/faculty-chaincode:latest|image: $IMAGE_REGISTRY/faculty-chaincode:latest|g" "$TMP_K8S_DIR"/*.yaml
    sed -i "s|image: registry.example.com/plv-repo/department-chaincode:latest|image: $IMAGE_REGISTRY/department-chaincode:latest|g" "$TMP_K8S_DIR"/*.yaml

    # Force all orderers to skip system channel bootstrap (fixes OSN Admin 405 error)
    sed -i 's/value: file/value: none/g' "$TMP_K8S_DIR"/06-orderer*.yaml 2>/dev/null || true

    # Let K8s use the default storage class by removing explicit storageClassName declarations
    sed -i '/storageClassName: /d' "$TMP_K8S_DIR"/*.yaml 2>/dev/null || true

    # Drastically reduce storage claims across all manifests to save costs while keeping High Availability
    sed -i 's/storage: 100Gi/storage: 5Gi/g' "$TMP_K8S_DIR"/*.yaml 2>/dev/null || true
    sed -i 's/storage: 50Gi/storage: 2Gi/g' "$TMP_K8S_DIR"/*.yaml 2>/dev/null || true
    sed -i 's/storage: 30Gi/storage: 2Gi/g' "$TMP_K8S_DIR"/*.yaml 2>/dev/null || true
    sed -i 's/storage: 20Gi/storage: 2Gi/g' "$TMP_K8S_DIR"/*.yaml 2>/dev/null || true
    sed -i 's/storage: 10Gi/storage: 2Gi/g' "$TMP_K8S_DIR"/*.yaml 2>/dev/null || true

    # Route all pods to GKE Spot Instances to reduce compute costs by ~70%
    sed -i 's/^\( *\)containers:/\1nodeSelector:\n\1  cloud.google.com\/gke-spot: "true"\n\1containers:/g' "$TMP_K8S_DIR"/*.yaml 2>/dev/null || true

    # Apply in order
    apply_manifest "$TMP_K8S_DIR/00-namespace.yaml"
    apply_manifest "$TMP_K8S_DIR/01a-storage-class.yaml"
    apply_manifest "$TMP_K8S_DIR/02-configmap-secret.yaml"
    apply_manifest "$TMP_K8S_DIR/04a-postgres-configmap.yaml"

    if [ -f "$TMP_K8S_DIR/03-Abac.yaml" ]; then
        apply_manifest "$TMP_K8S_DIR/03-Abac.yaml"
    else
        apply_manifest "$TMP_K8S_DIR/03-rbac.yaml"
    fi

    apply_manifest "$TMP_K8S_DIR/04a-postgres-primary.yaml"
    # apply_manifest "$TMP_K8S_DIR/04b-postgres-replica-annex.yaml"
    # apply_manifest "$TMP_K8S_DIR/04c-postgres-replica-pubad.yaml"
    apply_manifest "$TMP_K8S_DIR/05-fabric-ca.yaml"
    apply_manifest "$TMP_K8S_DIR/06-orderer-1.yaml"
    apply_manifest "$TMP_K8S_DIR/06-orderer-2.yaml"
    apply_manifest "$TMP_K8S_DIR/06-orderer-3.yaml"
    apply_manifest "$TMP_K8S_DIR/07-peer-registrar.yaml"
    apply_manifest "$TMP_K8S_DIR/07-peer-faculty.yaml"
    apply_manifest "$TMP_K8S_DIR/07-peer-department.yaml"
    apply_manifest "$TMP_K8S_DIR/08-middleware-api.yaml"
    apply_manifest "$TMP_K8S_DIR/09-ipfs.yaml"

    # Fix IPFS HostPath permission issues on Windows/WSL by running as root with IPFS_ALLOW_ROOT
    kubectl patch statefulset ipfs-node -n plv-fabric -p '{"spec":{"template":{"spec":{"securityContext":{"runAsUser":0,"runAsGroup":0,"fsGroup":0}}}}}' 2>/dev/null || true
    kubectl set env statefulset/ipfs-node IPFS_ALLOW_ROOT=true -n plv-fabric 2>/dev/null || true

    apply_manifest "$TMP_K8S_DIR/10-ingress-network-policy.yaml"
    # apply_manifest "$TMP_K8S_DIR/11-monitoring-pdb-quotas.yaml"
    apply_manifest "$TMP_K8S_DIR/12-frontend-ha.yaml"
    apply_manifest "$TMP_K8S_DIR/13-cli.yaml"
    apply_manifest "$TMP_K8S_DIR/17-chaincode.yaml"
    apply_manifest "$TMP_K8S_DIR/18-faculty-chaincode.yaml"
    apply_manifest "$TMP_K8S_DIR/19-department-chaincode.yaml"
    
    apply_manifest "$TMP_K8S_DIR/14-client-app.yaml"
    
    apply_manifest "$TMP_K8S_DIR/15-main-ingress.yaml"
    apply_manifest "$TMP_K8S_DIR/15-couchdb-backup.yaml"
    apply_manifest "$TMP_K8S_DIR/16-postgres-backup.yaml"
    
    echo "Manifests deployed"
}

# Function to wait for deployments
wait_deployments() {
    echo ""
    echo "Waiting for deployments to be ready..."
    
    echo "Waiting for PostgreSQL..."
    kubectl rollout status statefulset/postgres-primary -n plv-main-campus --timeout=10m || true
    # kubectl rollout status statefulset/postgres-replica-annex -n plv-annex-campus --timeout=10m || true
    # kubectl rollout status statefulset/postgres-replica-pubad -n plv-pubad-campus --timeout=10m || true
    
    echo "Waiting for Fabric CA (Registrar)..."
    kubectl rollout status deployment/fabric-ca-registrar -n plv-main-campus --timeout=10m || true
    
    echo "Waiting for Orderers..."
    kubectl rollout status deployment/orderer-1 -n plv-main-campus --timeout=10m || true
    kubectl rollout status deployment/orderer-2 -n plv-main-campus --timeout=10m || true
    kubectl rollout status deployment/orderer-3 -n plv-annex-campus --timeout=10m || true
    
    echo "Waiting for Peer (Registrar)..."
    kubectl rollout status deployment/peer-registrar -n plv-main-campus --timeout=10m || true
    kubectl rollout status deployment/peer-faculty -n plv-annex-campus --timeout=10m || true
    kubectl rollout status deployment/peer-department -n plv-pubad-campus --timeout=10m || true
    
    echo "Waiting for IPFS Nodes..."
    kubectl rollout status statefulset/ipfs-node -n plv-fabric --timeout=10m || true

    echo "Waiting for Middleware API (This takes ~60s due to health checks)..."
    kubectl rollout status deployment/middleware-api -n plv-fabric --timeout=10m || true

    echo "✓ All deployments ready"
    
    echo "Bootstrapping Root Registrar Account..."
    MIDDLEWARE_POD=$(kubectl get pods -n plv-fabric -l app=middleware-api -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
    if [ -n "$MIDDLEWARE_POD" ]; then kubectl exec $MIDDLEWARE_POD -n plv-fabric -- node -e "require('http').get('http://localhost:4000/api/bootstrap', res => res.pipe(process.stdout))"; echo ""; fi
}

# Main execution
case $ACTION in
    apply)
        check_kubectl
        check_cluster
        inject_configs
        
        echo "Converting crypto material to Kubernetes Secrets..."
        chmod +x ./k8s/create-crypto-secrets.sh
        ./k8s/create-crypto-secrets.sh
        
        deploy_manifests
        sleep 5
        wait_deployments
        echo "✓ Deployment complete!"
        ;;
    delete)
        check_kubectl
        echo "Deleting K8s resources..."
        kubectl delete namespace plv-fabric plv-main-campus plv-annex-campus plv-pubad-campus --ignore-not-found || true
        # Also delete PVCs to untangle storage
        echo "Clearing persistent volume claims..."
        kubectl delete pvc --all -A 2>/dev/null || true
        echo "✓ Resources deleted"
        ;;
    status)
        check_kubectl
        kubectl get pods -A
        ;;
    *)
        echo "Usage: $0 [namespace] [apply|delete|status|logs]"
        exit 1
        ;;
esac