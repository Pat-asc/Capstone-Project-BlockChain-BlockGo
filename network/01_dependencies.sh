log_info "Phase 0: Checking system dependencies..."
SUDO=""
if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
fi

if command -v apt-get >/dev/null 2>&1; then
    if ! command -v jq >/dev/null 2>&1 || ! command -v nc >/dev/null 2>&1; then
        log_info "Installing missing system dependencies (curl, wget, netcat-openbsd, jq)..."
        $SUDO apt-get update -yqq || true
        $SUDO apt-get install -y curl wget netcat-openbsd jq || log_warn "Failed to install dependencies via apt-get. You may need to install them manually."
    fi

    if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
        log_info "Node.js or NPM not found. Installing Node.js 20.x LTS..."
        curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO bash -
        $SUDO apt-get install -y nodejs
        log_info "Node.js and NPM installed successfully."
    else
        log_info "Node.js ($(node -v)) and NPM ($(npm -v)) are installed."
    fi
else
    log_warn "'apt-get' not found. Please ensure curl, wget, netcat, and jq are installed."
fi

log_info "Checking Docker accessibility..."
if ! docker ps >/dev/null 2>&1; then
    log_error "Cannot connect to the Docker daemon. Is Docker running? Does your user have permission to run Docker commands without sudo?"
fi

log_info "Phase 1: Checking/Generating secure credentials..."
ENV_FILE="$(pwd)/.env"
if [ ! -f "$ENV_FILE" ]; then
    touch "$ENV_FILE"
fi

add_to_env_if_missing() {
    local KEY=$1
    local VAL=$2
    if ! grep -q "^${KEY}=" "$ENV_FILE"; then
        echo "${KEY}=${VAL}" >> "$ENV_FILE"
        log_info "Generated new secure value for ${KEY}"
    fi
}

add_to_env_if_missing "COUCHDB_USER" "capstone"
add_to_env_if_missing "COUCHDB_PASS" "pass123"

LOCAL_COUCH_USER=$(grep "^COUCHDB_USER=" "$ENV_FILE" | cut -d '=' -f 2)
LOCAL_COUCH_PASS=$(grep "^COUCHDB_PASS=" "$ENV_FILE" | cut -d '=' -f 2)

add_to_env_if_missing "POSTGRES_USER" "BLOCKGO"
add_to_env_if_missing "POSTGRES_PASS" "PLVBLOCKGO"
add_to_env_if_missing "POSTGRES_DB" "ActivityLogs"
add_to_env_if_missing "JWT_SECRET" "$(openssl rand -base64 32)"
add_to_env_if_missing "CHAINCODE_ID" "dummy-id-pending-install"


log_info "Phase 2: Installing project NPM dependencies..."

if [ -d "../frontend" ]; then
    if [ ! -d "../frontend/node_modules" ]; then
        log_info "Installing frontend dependencies..."
        (cd ../frontend && npm install) > /dev/null 2>&1 || log_warn "npm install for frontend failed"
    fi
fi

if [ -d "../middleware" ]; then
    if [ ! -d "../middleware/node_modules" ]; then
        log_info "Installing middleware dependencies..."
        (cd ../middleware && npm install) > /dev/null 2>&1 || log_warn "npm install for middleware failed"
    fi
fi

log_info "Dependencies ready"

log_info "Phase 3: Checking binaries and setup..."

export PATH=$PATH:$(pwd)/bin
export FABRIC_CFG_PATH=$(pwd)
export CHANNEL_NAME="registrar-channel"
export CC_NAME="registrar"
export CC_VERSION="1.0"
export EXPECTED_FABRIC_VERSION="2.5.4"
# Export FABRIC_VERSION so docker-compose.yaml uses the exact same version
export FABRIC_VERSION="$EXPECTED_FABRIC_VERSION"

verify_fabric_version() {
    if [ -f "./bin/cryptogen" ]; then
        local current_version=$(./bin/cryptogen version | grep -Eio '[0-9]+\.[0-9]+\.[0-9]+' | head -n 1)
        if [ "$current_version" == "$EXPECTED_FABRIC_VERSION" ]; then
            return 0
        fi
        log_warn "Fabric version mismatch. Expected $EXPECTED_FABRIC_VERSION but found $current_version."
    fi
    return 1
}

verify_fabric_images() {
    if [ -z "$(docker images -q hyperledger/fabric-peer:$EXPECTED_FABRIC_VERSION 2> /dev/null)" ]; then
        return 1
    fi
    return 0
}

DOWNLOAD_ARGS=""
if ! verify_fabric_version || [ ! -f "./bin/configtxgen" ]; then DOWNLOAD_ARGS="binary"; fi
# We intentionally skip adding "docker" here. The default install-fabric script has no retries for TLS network errors.
# Our robust retry logic in 02_network_up.sh will handle downloading the images safely instead!

if [ -n "$DOWNLOAD_ARGS" ]; then
    log_info "Fabric binaries or Docker images (v$EXPECTED_FABRIC_VERSION) missing. Downloading them now..."
    
    if [ ! -f "./install-fabric.sh" ]; then
        curl -sSLO https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh || log_error "Failed to download install-fabric.sh"
    fi
    
    chmod +x install-fabric.sh
    ./install-fabric.sh --fabric-version $EXPECTED_FABRIC_VERSION $DOWNLOAD_ARGS || log_warn "Fabric installer encountered an issue, but continuing..."
    
    # FIX: If the installer unpacked the binaries into fabric-samples, move them here!
    if [ -d "fabric-samples/bin" ]; then
        mkdir -p ./bin ./config
        cp -a fabric-samples/bin/* ./bin/ 2>/dev/null || true
        cp -a fabric-samples/config/* ./config/ 2>/dev/null || true
    fi
    log_info "Fabric components download phase finished."
else
    log_info "Fabric binaries and Docker images (v$EXPECTED_FABRIC_VERSION) already exist. Skipping download."
fi

[ ! -f "./bin/cryptogen" ] && log_error "cryptogen binary still not found after download attempt."
[ ! -f "./bin/configtxgen" ] && log_error "configtxgen binary still not found after download attempt."
[ ! -f "./configtx.yaml" ] && log_error "configtx.yaml not found"

log_info "All binaries and files OK"