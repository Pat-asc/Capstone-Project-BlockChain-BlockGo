#!/bin/bash

# Store PIDs of background processes to clean up on exit
declare -a PIDS

cleanup_processes() {
    echo "Shutting down background processes..."
    for pid in "${PIDS[@]}"; do
        if ps -p $pid > /dev/null; then
            kill $pid 2>/dev/null
        fi
    done
    echo "Background processes stopped."
}

# Register the cleanup function to be called on EXIT or script interruption
trap cleanup_processes EXIT

# --- 0. DEPENDENCY CHECK & INSTALLATION ---
echo ""
echo "--- CHECKING AND INSTALLING DEPENDENCIES ---"

SUDO=""
if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
fi

install_deps() {
    echo "Ensuring curl and wget are installed..."
    $SUDO apt-get install -y curl wget netcat >/dev/null 2>&1
    $SUDO apt-get install -y jq >/dev/null 2>&1

    echo "Checking Node.js and npm..."
    if ! command -v node >/dev/null 2>&1; then
        echo "Installing Node.js and npm..."
        curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO bash -
        $SUDO apt-get install -y nodejs
    else
        echo "Node.js is already installed ($(node -v))"
    fi

    echo "Checking .NET SDK..."
    if ! command -v dotnet >/dev/null 2>&1; then
        echo "Installing .NET SDK..."
        wget https://packages.microsoft.com/config/ubuntu/22.04/packages-microsoft-prod.deb -O packages-microsoft-prod.deb
        $SUDO dpkg -i packages-microsoft-prod.deb
        rm packages-microsoft-prod.deb
        $SUDO apt-get update
        $SUDO apt-get install -y dotnet-sdk-8.0
    else
        echo ".NET SDK is already installed ($(dotnet --version))"
    fi

    echo "Checking React tools..."
    if ! command -v create-react-app >/dev/null 2>&1; then
        echo "Installing React tools (create-react-app)..."
        $SUDO npm install -g create-react-app
    else
        echo "React tools are already installed"
    fi

    echo "Checking Hyperledger Fabric binaries..."
    if ! command -v peer >/dev/null 2>&1; then
        echo "Installing Hyperledger Fabric binaries..."
        curl -sSL https://bit.ly/2ysbOFE | bash -s -- 2.5.4 1.5.7 -d -s
    else
        echo "Hyperledger Fabric binaries are already installed"
    fi

    echo "Checking PostgreSQL..."
    if ! command -v psql >/dev/null 2>&1; then
        echo "Installing PostgreSQL..."
        $SUDO apt-get install -y postgresql postgresql-contrib
        $SUDO systemctl enable --now postgresql || true
    else
        echo "PostgreSQL is already installed ($(psql -V | head -n 1))"
    fi
}

if command -v apt-get >/dev/null 2>&1; then
    $SUDO apt-get update -yqq >/dev/null 2>&1 || true
    install_deps
else
    echo "'apt-get' not found (Not Debian/Ubuntu). Skipping automated dependency installation."
fi

# Ensure Fabric binaries are in PATH for subsequent commands
export PATH=$PATH:$(pwd)/fabric-samples/bin:$(pwd)/bin

# --- HELPER FUNCTION: WAIT FOR SERVICE ---
wait_for_service() {
    local host=$1
    local port=$2
    local service_name=$3
    local timeout=$4 # seconds
    local start_time=$(date +%s)
    echo "Waiting for $service_name ($host:$port) to be available..."
    while true; do
        current_time=$(date +%s)
        if [ $((current_time - start_time)) -ge $timeout ]; then
            echo "Error: $service_name ($host:$port) did not become available within $timeout seconds."
            exit 1
        fi
        if nc -z -w 2 $host $port > /dev/null 2>&1; then
            echo "$service_name is available!"
            return 0
        fi
        sleep 2
    done
}

echo ""
echo "--- DEPENDENCIES READY ---"

# --- 0.2 GENERATE SECURE .ENV CREDENTIALS ---
echo "--- CHECKING/GENERATING SECURE CREDENTIALS ---"
ENV_FILE="$(pwd)/.env"
if [ ! -f "$ENV_FILE" ]; then
    touch "$ENV_FILE"
fi

add_to_env_if_missing() {
    local KEY=$1
    local VAL=$2
    if ! grep -q "^${KEY}=" "$ENV_FILE"; then
        echo "${KEY}=${VAL}" >> "$ENV_FILE"
        echo "Generated new secure value for ${KEY}"
    fi
}

add_to_env_if_missing "COUCHDB_USER" "capstone"
add_to_env_if_missing "COUCHDB_PASS" "pass123"

LOCAL_COUCH_USER=$(grep "^COUCHDB_USER=" "$ENV_FILE" | cut -d '=' -f 2)
LOCAL_COUCH_PASS=$(grep "^COUCHDB_PASS=" "$ENV_FILE" | cut -d '=' -f 2)
add_to_env_if_missing "COUCHDB_WALLET_URL" "http://${LOCAL_COUCH_USER}:${LOCAL_COUCH_PASS}@127.0.0.1:5989"
add_to_env_if_missing "WALLET_ENCRYPTION_KEY" "$(openssl rand -hex 32)"

add_to_env_if_missing "POSTGRES_USER" "BLOCKGO"
add_to_env_if_missing "POSTGRES_PASS" "PLVBLOCKGO"
add_to_env_if_missing "POSTGRES_DB" "ActivityLogs"

add_to_env_if_missing "EMAIL_HOST" "smtp.gmail.com"
add_to_env_if_missing "EMAIL_PORT" "587"
add_to_env_if_missing "EMAIL_USER" "plv.registrar.blockgo@gmail.com"
add_to_env_if_missing "EMAIL_PASS" "wrqs zerf chfx xcrm"
add_to_env_if_missing "EMAIL_FROM" "\"PLV Registrar <noreply@capstone.com>\""
add_to_env_if_missing "JWT_SECRET" "$(openssl rand -base64 32)"

# --- SYNCED C# BACKEND SECRETS ---
SHARED_API_KEY=$(openssl rand -base64 32)
add_to_env_if_missing "INTERNAL_API_KEY" "$SHARED_API_KEY"
add_to_env_if_missing "InternalApiKey" "$SHARED_API_KEY"
add_to_env_if_missing "Smtp__Password" "wrqs zerf chfx xcrm"
add_to_env_if_missing "ConnectionStrings__PostgresConnection" "Host=127.0.0.1;Port=5432;Database=ActivityLogs;Username=BLOCKGO;Password=PLVBLOCKGO"

echo "--- SECURE CREDENTIALS READY IN .ENV ---"
echo ""

# --- 1. GENERATE CRYPTOGRAPHIC MATERIAL & CHANNEL ARTIFACTS ---
echo "--- PRE-FLIGHT ARTIFACT CHECK ---"

# The Ghost Folder Guard: Kill directories that should be files
if [ -d "./channel-artifacts/genesis.block" ]; then
    echo " Detected fake directory at genesis.block. Removing..."
    rm -rf ./channel-artifacts/genesis.block
fi

if [ ! -d "./crypto-config" ] || [ ! -f "./channel-artifacts/genesis.block" ]; then
    echo "--- GENERATING CRYPTOGRAPHIC MATERIAL & CHANNEL ARTIFACTS ---"

    # Clean the slate of old containers so new certificates don't mismatch old ledgers
    echo "Tearing down old Docker network to ensure a fresh state..."
    docker compose down -v --remove-orphans 2>/dev/null || docker-compose down -v --remove-orphans 2>/dev/null

    # Allow time for Docker/WSL to fully release file locks on bind mounts
    sleep 3

    if [ ! -f "crypto-config.yaml" ] || [ ! -f "configtx.yaml" ]; then
        echo "FATAL: crypto-config.yaml or configtx.yaml not found. Cannot proceed."
        exit 1
    fi

    # Clean the slate
    $SUDO rm -rf ./crypto-config ./channel-artifacts ./*.block ./*.tar.gz 2>/dev/null
    
    # Guard against WSL "pending deletion" ghost directory locking
    MAX_WAIT=15
    WAIT_COUNT=0
    while ! $SUDO mkdir -p ./crypto-config 2>/dev/null; do
        echo "Waiting for OS to release folder lock on crypto-config..."
        sleep 2
        $SUDO rm -rf ./crypto-config 2>/dev/null
        WAIT_COUNT=$((WAIT_COUNT+1))
        if [ $WAIT_COUNT -ge $MAX_WAIT ]; then
            echo "FATAL: Folder lock on crypto-config is permanent."
            echo "Please open Windows PowerShell and run 'wsl --shutdown', or restart Docker Desktop completely, then try again."
            exit 1
        fi
    done
    $SUDO mkdir -p ./channel-artifacts
    
    # Ensure the local user owns the folders so cryptogen can write to them
    $SUDO chown -R $(id -u):$(id -g) ./crypto-config ./channel-artifacts 2>/dev/null || true

    # Ensure binaries exist before running
    if [ ! -f "./bin/cryptogen" ] || [ ! -f "./bin/configtxgen" ]; then
        echo " Fabric binaries missing. Downloading now..."
        curl -sSL https://bit.ly/2ysbOFE | bash -s -- 2.5.4 1.5.7 -d -s
        # If extraction failed due to WSL permissions, use manual unzip
        if [ ! -f "./bin/cryptogen" ]; then
             curl -LO https://github.com/hyperledger/fabric/releases/download/v2.5.4/hyperledger-fabric-linux-amd64-2.5.4.tar.gz
             tar -xvzf hyperledger-fabric-linux-amd64-2.5.4.tar.gz bin/
             rm hyperledger-fabric-linux-amd64-2.5.4.tar.gz
        fi
    fi

    echo "Generating crypto material..."    
    ./bin/cryptogen generate --config=./crypto-config.yaml --output=./crypto-config    
    
    # Set config path so configtxgen finds your yaml
    export FABRIC_CFG_PATH=$(pwd)
    export SYS_CHANNEL=$(echo "system-channel" | tr -d '\r')
    export APP_CHANNEL=$(echo "registrar-channel" | tr -d '\r')

    echo "Generating genesis block (The DNA)..."
    ./bin/configtxgen -profile UniversityGenesis -channelID $SYS_CHANNEL -outputBlock ./channel-artifacts/genesis.block
    
    echo "Generating channel transaction (The Birth Certificate)..."
    ./bin/configtxgen -profile RegistrarChannel -outputCreateChannelTx ./channel-artifacts/registrar-channel.tx -channelID $APP_CHANNEL
    
    echo "--- ARTIFACTS GENERATED SUCCESSFULLY ---"
else
    echo "--- ARTIFACTS ALREADY EXIST, ENSURING VALIDITY ---"
    export FABRIC_CFG_PATH=$(pwd)
fi

# --- 0.5 DOCKER NETWORK STARTUP ---

echo "--- STARTING DOCKER CONTAINERS ---"
if ! command -v docker >/dev/null 2>&1; then
    echo "Docker is not installed! Please install Docker to proceed."
    exit 1
fi

if [ -f "docker-compose.yaml" ] || [ -f "docker-compose.yml" ]; then
    if [ -d "../frontend" ]; then
        mkdir -p ../frontend/build
    fi

    echo "Bringing up Docker Compose services..."
    docker compose up -d 2>/dev/null || docker-compose up -d
    echo "Waiting for Docker Compose services to initialize..."
    # Wait for the Nginx proxy (frontend) and Postgres to be ready, as they are crucial for the next steps
    wait_for_service localhost 80 "Nginx (Frontend Proxy)" 120
    wait_for_service localhost 5432 "PostgreSQL Database" 120
    # Wait for Fabric peers to be ready
    echo "Waiting a bit longer for Orderer to fully initialize before peer connections..."
    sleep 15 # Add extra sleep for orderer stability
    wait_for_service localhost 7051 "Registrar Peer" 120
    wait_for_service localhost 9051 "Faculty Peer" 120
    wait_for_service localhost 11051 "Department Peer" 120
else
    echo ""
    echo "No docker-compose.yaml found in $(pwd). Skipping automated container startup."
fi
echo ""

echo "--- STARTING COUCHDB FOR WALLETS ---"
if docker ps -a --format '{{.Names}}' | grep -Eq "^couchdb-wallet\$"; then
    docker start couchdb-wallet >/dev/null
    echo "CouchDB for wallets (existing) started."
else
    docker run -d --name couchdb-wallet -p 5989:5984 -v couchdb_wallet_data:/opt/couchdb/data -e COUCHDB_USER=${LOCAL_COUCH_USER} -e COUCHDB_PASSWORD=${LOCAL_COUCH_PASS} -e COUCHDB_SINGLE_NODE=true -e COUCHDB_INI_CLUSTER_N=1 -e COUCHDB_INI_COUCHDB_SINGLE_NODE=true couchdb:3.3 >/dev/null
    echo "New CouchDB container for wallets created and started on port 5989."
fi
# Now that the couchdb-wallet container is started, wait for it.
wait_for_service localhost 5989 "CouchDB Wallet" 120

# Wait for the Chaincode-as-a-Service container to be ready
wait_for_service localhost 9999 "Chaincode-as-a-Service" 120

# --- 1. CONFIGURATION ---
export CHANNEL_NAME=$(echo "registrar-channel" | tr -d '\r')
export CC_NAME=$(echo "registrar" | tr -d '\r')
export CC_VERSION=$(echo "1.0" | tr -d '\r')
export CC_POLICY=$(echo "OR('RegistrarMSP.member', 'FacultyMSP.member', 'DepartmentMSP.member')" | tr -d '\r')
export CC_LABEL="${CC_NAME}_${CC_VERSION}"

export CRYPTO_PATH="$(pwd)/crypto-config"
export ORDERER_CA="${CRYPTO_PATH}/ordererOrganizations/capstone.com/orderers/orderer.capstone.com/tls/ca.crt"
export REGISTRAR_CA="${CRYPTO_PATH}/peerOrganizations/registrar.capstone.com/peers/peer0.registrar.capstone.com/tls/ca.crt"
export FACULTY_CA="${CRYPTO_PATH}/peerOrganizations/faculty.capstone.com/peers/peer0.faculty.capstone.com/tls/ca.crt"
export DEPT_CA="${CRYPTO_PATH}/peerOrganizations/department.capstone.com/peers/peer0.department.capstone.com/tls/ca.crt"

export PATH=$PATH:$(pwd)/fabric-samples/bin:$(pwd)/bin # Correct path for Fabric binaries
export FABRIC_CFG_PATH=$(pwd)/config # This is for peer commands to find core.yaml

echo "--- STARTING FAIL-PROOF DEPLOYMENT ---"
echo ""

# --- 1.5 FAIL-PROOF TLS CHECK ---
echo "Checking TLS certificates..."
for cert in "$ORDERER_CA" "$REGISTRAR_CA" "$FACULTY_CA" "$DEPT_CA"; do
    if [ ! -f "$cert" ]; then
        echo "FATAL ERROR: TLS Certificate not found at $cert"
        exit 1
    fi
done
echo "All TLS certificates verified."
echo ""

# --- 2. HELPER: SWITCH IDENTITY ---
setIdentity() {
    local ORG=$1
    if [ "$ORG" == "registrar" ]; then
        export CORE_PEER_LOCALMSPID="RegistrarMSP"
        export CORE_PEER_ADDRESS="peer0.registrar.capstone.com:7051"
        export CORE_PEER_MSPCONFIGPATH="${CRYPTO_PATH}/peerOrganizations/registrar.capstone.com/users/Admin@registrar.capstone.com/msp"
        export CORE_PEER_TLS_ROOTCERT_FILE=$REGISTRAR_CA
        export CORE_PEER_TLS_CLIENTCERT_FILE="${CRYPTO_PATH}/peerOrganizations/registrar.capstone.com/users/Admin@registrar.capstone.com/tls/client.crt"
        export CORE_PEER_TLS_CLIENTKEY_FILE="${CRYPTO_PATH}/peerOrganizations/registrar.capstone.com/users/Admin@registrar.capstone.com/tls/client.key"
        export CORE_PEER_TLS_HOSTNAME_OVERRIDE="peer0.registrar.capstone.com"
    elif [ "$ORG" == "faculty" ]; then
        export CORE_PEER_LOCALMSPID="FacultyMSP"
        export CORE_PEER_ADDRESS="peer0.faculty.capstone.com:7051"
        export CORE_PEER_MSPCONFIGPATH="${CRYPTO_PATH}/peerOrganizations/faculty.capstone.com/users/Admin@faculty.capstone.com/msp"
        export CORE_PEER_TLS_ROOTCERT_FILE=$FACULTY_CA
        export CORE_PEER_TLS_CLIENTCERT_FILE="${CRYPTO_PATH}/peerOrganizations/faculty.capstone.com/users/Admin@faculty.capstone.com/tls/client.crt"
        export CORE_PEER_TLS_CLIENTKEY_FILE="${CRYPTO_PATH}/peerOrganizations/faculty.capstone.com/users/Admin@faculty.capstone.com/tls/client.key"
        export CORE_PEER_TLS_HOSTNAME_OVERRIDE="peer0.faculty.capstone.com"
    elif [ "$ORG" == "department" ]; then
        export CORE_PEER_LOCALMSPID="DepartmentMSP"
        export CORE_PEER_ADDRESS="peer0.department.capstone.com:7051"
        export CORE_PEER_MSPCONFIGPATH="${CRYPTO_PATH}/peerOrganizations/department.capstone.com/users/Admin@department.capstone.com/msp"
        export CORE_PEER_TLS_ROOTCERT_FILE=$DEPT_CA
        export CORE_PEER_TLS_CLIENTCERT_FILE="${CRYPTO_PATH}/peerOrganizations/department.capstone.com/users/Admin@department.capstone.com/tls/client.crt"
        export CORE_PEER_TLS_CLIENTKEY_FILE="${CRYPTO_PATH}/peerOrganizations/department.capstone.com/users/Admin@department.capstone.com/tls/client.key"
        export CORE_PEER_TLS_HOSTNAME_OVERRIDE="peer0.department.capstone.com"
    fi
    export CORE_PEER_BCCSP_SW_FILEKEYSTORE_KEYSTORE="${CORE_PEER_MSPCONFIGPATH}/keystore"
}

echo ""
# --- 3. CHANNEL CREATION ---
setIdentity "registrar"

# Wait for the orderer to be ready before attempting channel creation
wait_for_service localhost 7050 "Orderer Service" 120
if [ ! -f "./${CHANNEL_NAME}.block" ]; then
    echo "Creating channel: $CHANNEL_NAME..."    
    MAX_RETRY=5
    COUNTER=0 # Start counter from 0 for initial attempt
    while [ $COUNTER -le $MAX_RETRY ]; do
        CREATE_OUTPUT=$(peer channel create -o orderer.capstone.com:7050 --connTimeout 20s -c $CHANNEL_NAME \
            -f $(pwd)/channel-artifacts/${CHANNEL_NAME}.tx --ordererTLSHostnameOverride orderer.capstone.com \
            --tls true --cafile $ORDERER_CA --outputBlock ./${CHANNEL_NAME}.block 2>&1)
        if [ $? -eq 0 ]; then
            echo "Channel created successfully!"
            break
        elif echo "$CREATE_OUTPUT" | grep -qE "existing channel|already exists|BAD_REQUEST"; then
            echo "Channel already exists on orderer. Fetching genesis block..."
            peer channel fetch 0 ./${CHANNEL_NAME}.block -o orderer.capstone.com:7050 -c $CHANNEL_NAME --tls --cafile $ORDERER_CA --ordererTLSHostnameOverride orderer.capstone.com
            break
        else
            echo "Orderer not ready yet (Attempt $COUNTER/$MAX_RETRY). Waiting 5s..."
            echo "$CREATE_OUTPUT"
            sleep 5
            if [ $COUNTER -eq $MAX_RETRY ]; then
                echo "FATAL ERROR: Failed to create channel after multiple attempts. Orderer might not be fully operational."
                exit 1
            fi
            COUNTER=$((COUNTER+1))
        fi
    done
    echo ""
else
    echo "Channel block file already exists, skipping channel creation."
    echo ""
fi

echo "Waiting 10 seconds for channel creation to propagate across the network..."
sleep 10

# --- 4. JOIN CHANNEL ---
for ORG in "registrar" "faculty" "department"; do    
    for PEER_NUM in 0 1; do
        setIdentity $ORG # Set the admin identity for the organization

        # Determine the internal peer address for the CLI container
        local_peer_address="peer${PEER_NUM}.${ORG}.capstone.com:7051"

        # Convert host paths to container paths for the CLI container
        # Note: We use the Admin user of the org to perform the join on behalf of the peer
        CONTAINER_MSP_PATH=$(echo "$CORE_PEER_MSPCONFIGPATH" | sed "s|$(pwd)/crypto-config|/etc/hyperledger/fabric/crypto-config|")
        CONTAINER_TLS_ROOTCERT_FILE=$(echo "$CORE_PEER_TLS_ROOTCERT_FILE" | sed "s|$(pwd)/crypto-config|/etc/hyperledger/fabric/crypto-config|")
        CONTAINER_TLS_CLIENTCERT_FILE=$(echo "$CORE_PEER_TLS_CLIENTCERT_FILE" | sed "s|$(pwd)/crypto-config|/etc/hyperledger/fabric/crypto-config|")
        CONTAINER_TLS_CLIENTKEY_FILE=$(echo "$CORE_PEER_TLS_CLIENTKEY_FILE" | sed 's|'$(pwd)'/crypto-config|/etc/hyperledger/fabric/crypto-config|')

        # The hostname override should match the internal Docker service name for the peer
        CONTAINER_TLS_HOSTNAME_OVERRIDE_VAL="peer${PEER_NUM}.${ORG}.capstone.com"

        # Use a bash array for the docker exec command to avoid quoting issues with eval.
        DOCKER_EXEC_CMD=(docker exec
            -e "CORE_PEER_LOCALMSPID=${CORE_PEER_LOCALMSPID}"
            -e "CORE_PEER_MSPCONFIGPATH=${CONTAINER_MSP_PATH}"
            -e "CORE_PEER_TLS_ROOTCERT_FILE=${CONTAINER_TLS_ROOTCERT_FILE}"
            -e "CORE_PEER_TLS_CLIENTCERT_FILE=${CONTAINER_TLS_CLIENTCERT_FILE}"
            -e "CORE_PEER_TLS_CLIENTKEY_FILE=${CONTAINER_TLS_CLIENTKEY_FILE}"
            -e "CORE_PEER_TLS_HOSTNAME_OVERRIDE=${CONTAINER_TLS_HOSTNAME_OVERRIDE_VAL}"
            -e "CORE_PEER_ADDRESS=${local_peer_address}"
            -e "CORE_PEER_TLS_ENABLED=true"
            cli
            peer channel join -b "/opt/fabric-config/network/${CHANNEL_NAME}.block"
        )

        echo "Attempting to join peer${PEER_NUM} of $ORG to $CHANNEL_NAME..."
        JOIN_OUTPUT=$("${DOCKER_EXEC_CMD[@]}" 2>&1)
        if echo "$JOIN_OUTPUT" | grep -qE "already on channel|already exists"; then
            echo "peer${PEER_NUM} of $ORG is already on the channel."
        elif echo "$JOIN_OUTPUT" | grep -q "Successfully submitted proposal"; then
            echo "peer${PEER_NUM} of $ORG joined channel successfully."
            sleep 3 # Give the peer a moment to process the join
        else
            echo "FATAL ERROR: Error joining peer${PEER_NUM} of $ORG to channel: $JOIN_OUTPUT"
            exit 1 # Exit if a peer fails to join the channel
        fi
    done

    # Verify channel existence for the registrar peer after joining
    if [ "$ORG" == "registrar" ] && [ "$PEER_NUM" -eq 0 ]; then
        echo "Verifying channel existence for registrar peer..."
        
        # Construct the docker exec command for getinfo within the cli container
        DOCKER_EXEC_GETINFO_CMD=(docker exec
            -e "CORE_PEER_LOCALMSPID=${CORE_PEER_LOCALMSPID}"
            -e "CORE_PEER_MSPCONFIGPATH=${CONTAINER_MSP_PATH}"
            -e "CORE_PEER_TLS_ROOTCERT_FILE=${CONTAINER_TLS_ROOTCERT_FILE}"
            -e "CORE_PEER_TLS_CLIENTCERT_FILE=${CONTAINER_TLS_CLIENTCERT_FILE}" # These are for mTLS to the peer
            -e "CORE_PEER_TLS_CLIENTKEY_FILE=${CONTAINER_TLS_CLIENTKEY_FILE}"   #
            -e "CORE_PEER_TLS_HOSTNAME_OVERRIDE=peer0.registrar.capstone.com"
            -e "CORE_PEER_ADDRESS=peer0.registrar.capstone.com:7051"
            -e "CORE_PEER_TLS_ENABLED=true"
            cli
            peer channel getinfo -c "$CHANNEL_NAME" -o "orderer.capstone.com:7050" --tls true --cafile "/etc/hyperledger/fabric/crypto-config/ordererOrganizations/capstone.com/orderers/orderer.capstone.com/tls/ca.crt" --ordererTLSHostnameOverride "orderer.capstone.com" --connTimeout 20s
        )
        GETINFO_OUTPUT=$("${DOCKER_EXEC_GETINFO_CMD[@]}" 2>&1)
        if [ $? -ne 0 ]; then
            echo "FATAL ERROR: Registrar peer failed to get channel info after joining."
            echo "Error Output:"
            echo "$GETINFO_OUTPUT"
            exit 1
        fi
        echo "Channel info verified successfully."
    fi
    echo "" 
done

echo ""
echo "--- 4.5 RELAXING NODEOUS ---"
echo "Relaxing NodeOUs for all MSPs directly..."

relax_node_ous() {
    local ORG_NAME_LOWER=$1
    local ORG_NAME_CAMEL=$2
    
    echo "====================================================="
    echo "==> Relaxing NodeOUs for ${ORG_NAME_CAMEL}..."
    echo "====================================================="

    setIdentity $ORG_NAME_LOWER

    # Define container paths
    CONTAINER_MSP_PATH=$(echo "$CORE_PEER_MSPCONFIGPATH" | sed "s|$(pwd)/crypto-config|/etc/hyperledger/fabric/crypto-config|")
    CONTAINER_TLS_ROOTCERT_FILE=$(echo "$CORE_PEER_TLS_ROOTCERT_FILE" | sed "s|$(pwd)/crypto-config|/etc/hyperledger/fabric/crypto-config|")
    CONTAINER_TLS_CLIENTCERT_FILE=$(echo "$CORE_PEER_TLS_CLIENTCERT_FILE" | sed "s|$(pwd)/crypto-config|/etc/hyperledger/fabric/crypto-config|")
    CONTAINER_TLS_CLIENTKEY_FILE=$(echo "$CORE_PEER_TLS_CLIENTKEY_FILE" | sed 's|'$(pwd)'/crypto-config|/etc/hyperledger/fabric/crypto-config|')
    CONTAINER_ORDERER_CA="/etc/hyperledger/fabric/crypto-config/ordererOrganizations/capstone.com/orderers/orderer.capstone.com/tls/ca.crt"

    # Common docker exec command prefix
    DOCKER_EXEC_PREFIX=(docker exec
        -w "/opt/fabric-config/network"
        -e "CORE_PEER_LOCALMSPID=${CORE_PEER_LOCALMSPID}"
        -e "CORE_PEER_MSPCONFIGPATH=${CONTAINER_MSP_PATH}"
        -e "CORE_PEER_TLS_ROOTCERT_FILE=${CONTAINER_TLS_ROOTCERT_FILE}"
        -e "CORE_PEER_TLS_CLIENTCERT_FILE=${CONTAINER_TLS_CLIENTCERT_FILE}"
        -e "CORE_PEER_TLS_CLIENTKEY_FILE=${CONTAINER_TLS_CLIENTKEY_FILE}"
        -e "CORE_PEER_TLS_HOSTNAME_OVERRIDE=${CORE_PEER_TLS_HOSTNAME_OVERRIDE}"
        -e "CORE_PEER_ADDRESS=${CORE_PEER_ADDRESS}"
        -e "CORE_PEER_TLS_ENABLED=true"
        -e "CHANNEL_NAME=${CHANNEL_NAME}"
        cli
    )

    # Clean up transient files from previous aborted runs to prevent permission issues
    "${DOCKER_EXEC_PREFIX[@]}" rm -f config_block.pb config.json modified_config.json original_config.pb modified_config.pb config_update.pb config_update.json update_in_envelope.json update_in_envelope.pb

    echo "Fetching latest channel config..."
    local FETCH_RETRY=5
    local FETCH_COUNT=1
    while [ $FETCH_COUNT -le $FETCH_RETRY ]; do
        "${DOCKER_EXEC_PREFIX[@]}" peer channel fetch config config_block.pb -o orderer.capstone.com:7050 -c "$CHANNEL_NAME" --tls --cafile "$CONTAINER_ORDERER_CA" --ordererTLSHostnameOverride orderer.capstone.com && break
        echo "Failed to fetch config for ${ORG_NAME_CAMEL} (Attempt $FETCH_COUNT/$FETCH_RETRY). Retrying in 3s..."
        sleep 3
        FETCH_COUNT=$((FETCH_COUNT+1))
        if [ $FETCH_COUNT -gt $FETCH_RETRY ]; then echo "FATAL: Failed to fetch config for ${ORG_NAME_CAMEL}"; exit 1; fi
    done

    echo "Decoding config block to JSON..."
    "${DOCKER_EXEC_PREFIX[@]}" bash -c 'configtxlator proto_decode --input config_block.pb --type common.Block | jq .data.data[0].payload.data.config > config.json'
    if [ $? -ne 0 ]; then echo "FATAL: Failed to decode config for ${ORG_NAME_CAMEL}"; exit 1; fi

    echo "Removing NodeOUs and creating modified JSON..."
    "${DOCKER_EXEC_PREFIX[@]}" bash -c "jq 'del(.channel_group.groups.Application.groups.${ORG_NAME_CAMEL}.values.MSP.value.config.fabric_node_ous.admin_ou_identifier.certificate) | del(.channel_group.groups.Application.groups.${ORG_NAME_CAMEL}.values.MSP.value.config.fabric_node_ous.client_ou_identifier.certificate) | del(.channel_group.groups.Application.groups.${ORG_NAME_CAMEL}.values.MSP.value.config.fabric_node_ous.peer_ou_identifier.certificate) | del(.channel_group.groups.Application.groups.${ORG_NAME_CAMEL}.values.MSP.value.config.fabric_node_ous.orderer_ou_identifier.certificate)' config.json > modified_config.json"
    if [ $? -ne 0 ]; then echo "FATAL: Failed to modify config for ${ORG_NAME_CAMEL}"; exit 1; fi

    echo "Encoding original and modified configs to protobuf..."
    "${DOCKER_EXEC_PREFIX[@]}" configtxlator proto_encode --input config.json --type common.Config --output original_config.pb
    "${DOCKER_EXEC_PREFIX[@]}" configtxlator proto_encode --input modified_config.json --type common.Config --output modified_config.pb

    echo "Computing config update..."
    COMPUTE_OUTPUT=$("${DOCKER_EXEC_PREFIX[@]}" configtxlator compute_update --channel_id "$CHANNEL_NAME" --original original_config.pb --updated modified_config.pb --output config_update.pb 2>&1)
    
    if [[ $? -ne 0 ]]; then
        if echo "$COMPUTE_OUTPUT" | grep -q "no differences detected"; then
            echo "No NodeOU changes needed for ${ORG_NAME_CAMEL}, already relaxed. Skipping update."
            return 0 # This is a success case for idempotency
        else
            echo "FATAL: Failed to compute config update for ${ORG_NAME_CAMEL}: $COMPUTE_OUTPUT"
            exit 1
        fi
    fi

    echo "Decoding config update to JSON..."
    "${DOCKER_EXEC_PREFIX[@]}" bash -c 'configtxlator proto_decode --input config_update.pb --type common.ConfigUpdate > config_update.json'

    echo "Wrapping update in envelope..."
    "${DOCKER_EXEC_PREFIX[@]}" bash -c 'echo "{\"payload\":{\"header\":{\"channel_header\":{\"channel_id\":\"$CHANNEL_NAME\", \"type\":2}},\"data\":{\"config_update\":$(cat config_update.json)}}}" | jq . > update_in_envelope.json'

    echo "Encoding envelope to protobuf..."
    "${DOCKER_EXEC_PREFIX[@]}" configtxlator proto_encode --input update_in_envelope.json --type common.Envelope --output update_in_envelope.pb

    echo "Submitting channel update..."
    "${DOCKER_EXEC_PREFIX[@]}" peer channel update -f update_in_envelope.pb -c "$CHANNEL_NAME" -o orderer.capstone.com:7050 --tls --cafile "$CONTAINER_ORDERER_CA" --ordererTLSHostnameOverride orderer.capstone.com
    if [ $? -ne 0 ]; then echo "FATAL: Failed to submit update for ${ORG_NAME_CAMEL}"; exit 1; fi

    echo "SUCCESS: ${ORG_NAME_CAMEL} NodeOUs relaxed."
    sleep 3
}

# Ensure jq is installed in the cli container
docker exec -u root cli apt-get update -yqq && docker exec -u root cli apt-get install -y jq

relax_node_ous "registrar" "RegistrarMSP"
relax_node_ous "faculty" "FacultyMSP"
relax_node_ous "department" "DepartmentMSP"

echo "ALL RESTRAINTS REMOVED! THE CHANNEL NOW FULLY TRUSTS YOUR FABRIC CAS!"
echo ""
echo "--- 5. PACKAGE CCAAS & PRIVATE DATA ---"
echo ""
echo "Packaging Chaincode-as-a-Service and generating Private Data Collections..."

RELATIVE_KEY_PATH="./crypto-config/peerOrganizations/registrar.capstone.com/peers/registrar-chaincode.registrar.capstone.com/tls/server.key"
export CONTAINER_TLS_KEY_FILE="/etc/hyperledger/fabric/crypto-config/"${RELATIVE_KEY_PATH#./crypto-config/}
export CONTAINER_TLS_CERT_FILE="/etc/hyperledger/fabric/crypto-config/peerOrganizations/registrar.capstone.com/peers/registrar-chaincode.registrar.capstone.com/tls/server.crt"
export CONTAINER_CLIENT_CA_CERT_FILE="/etc/hyperledger/fabric/crypto-config/peerOrganizations/registrar.capstone.com/tlsca/tlsca.registrar.capstone.com-cert.pem"

if [ ! -f ".env" ]; then
    touch .env
fi
sed -i '/^CONTAINER_TLS_KEY_FILE/d' .env 2>/dev/null || true
sed -i '/^CONTAINER_TLS_CERT_FILE/d' .env 2>/dev/null || true
sed -i '/^CONTAINER_CLIENT_CA_CERT_FILE/d' .env 2>/dev/null || true
echo "CONTAINER_TLS_KEY_FILE=$CONTAINER_TLS_KEY_FILE" >> .env
echo "CONTAINER_TLS_CERT_FILE=$CONTAINER_TLS_CERT_FILE" >> .env
echo "CONTAINER_CLIENT_CA_CERT_FILE=$CONTAINER_CLIENT_CA_CERT_FILE" >> .env

CC_TLS_CERT=$(cat ${CRYPTO_PATH}/peerOrganizations/registrar.capstone.com/tlsca/tlsca.registrar.capstone.com-cert.pem | awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}')
cat <<EOF > connection.json
{
  "address": "registrar-chaincode:9999",
  "dial_timeout": "10s",
  "tls_required": true,
  "client_auth_required": false,
  "root_cert": "${CC_TLS_CERT}"
}
EOF
tar cfz code.tar.gz connection.json

echo '{"path": "", "type": "ccaas", "label": "'${CC_LABEL}'"}' > metadata.json
tar cfz ${CC_NAME}.tar.gz metadata.json code.tar.gz

cat <<EOF > collections.json
[
  {
     "name": "collectionGrades",
     "policy": "OR('RegistrarMSP.member', 'FacultyMSP.member', 'DepartmentMSP.member')",
     "requiredPeerCount": 0,
     "maxPeerCount": 3,
     "blockToLive": 0,
     "memberOnlyRead": true
  }
]
EOF
export CC_COLLECTIONS_CONFIG="$(pwd)/collections.json"

# --- 5.5 DETERMINE SEQUENCE ---
echo ""
echo "Determining chaincode sequence for upgrade or initial deployment..."
setIdentity "registrar"
DOCKER_EXEC_QUERY_COMMITTED_CMD=(docker exec
    -e "CORE_PEER_LOCALMSPID=${CORE_PEER_LOCALMSPID}"
    -e "CORE_PEER_MSPCONFIGPATH=$(echo $CORE_PEER_MSPCONFIGPATH | sed 's|'$(pwd)'/crypto-config|/etc/hyperledger/fabric/crypto-config|')"
    -e "CORE_PEER_TLS_ROOTCERT_FILE=$(echo $CORE_PEER_TLS_ROOTCERT_FILE | sed 's|'$(pwd)'/crypto-config|/etc/hyperledger/fabric/crypto-config|')"
    -e "CORE_PEER_TLS_CLIENTCERT_FILE=$(echo $CORE_PEER_TLS_CLIENTCERT_FILE | sed 's|'$(pwd)'/crypto-config|/etc/hyperledger/fabric/crypto-config|')"
    -e "CORE_PEER_TLS_CLIENTKEY_FILE=$(echo $CORE_PEER_TLS_CLIENTKEY_FILE | sed 's|'$(pwd)'/crypto-config|/etc/hyperledger/fabric/crypto-config|')"
    -e "CORE_PEER_TLS_HOSTNAME_OVERRIDE=${CORE_PEER_TLS_HOSTNAME_OVERRIDE}"
    -e "CORE_PEER_ADDRESS=${CORE_PEER_ADDRESS}"
    -e "CORE_PEER_TLS_ENABLED=true"
    cli
    peer lifecycle chaincode querycommitted -C "$CHANNEL_NAME" -n "$CC_NAME" -O json
)
CURRENT_SEQUENCE=$("${DOCKER_EXEC_QUERY_COMMITTED_CMD[@]}" 2>/dev/null | jq -r .sequence)

if [[ -z "$CURRENT_SEQUENCE" || "$CURRENT_SEQUENCE" == "null" ]]; then
    echo "No existing chaincode definition found. Setting sequence to 1 for initial commit."
    export CC_SEQUENCE=1
else
    export CC_SEQUENCE=$((CURRENT_SEQUENCE + 1))
    echo "Existing chaincode found at sequence $CURRENT_SEQUENCE. Upgrading to sequence $CC_SEQUENCE."
fi
echo ""

# --- 6. INSTALL & APPROVE ---
setIdentity "registrar"
echo "Installing chaincode on registrar to get Package ID..."
DOCKER_EXEC_INSTALL_CMD=(docker exec
    -e "CORE_PEER_LOCALMSPID=${CORE_PEER_LOCALMSPID}"
    -e "CORE_PEER_MSPCONFIGPATH=$(echo $CORE_PEER_MSPCONFIGPATH | sed 's|'$(pwd)'/crypto-config|/etc/hyperledger/fabric/crypto-config|')"
    -e "CORE_PEER_TLS_ROOTCERT_FILE=$(echo $CORE_PEER_TLS_ROOTCERT_FILE | sed 's|'$(pwd)'/crypto-config|/etc/hyperledger/fabric/crypto-config|')"
    -e "CORE_PEER_TLS_CLIENTCERT_FILE=$(echo $CORE_PEER_TLS_CLIENTCERT_FILE | sed 's|'$(pwd)'/crypto-config|/etc/hyperledger/fabric/crypto-config|')"
    -e "CORE_PEER_TLS_CLIENTKEY_FILE=$(echo $CORE_PEER_TLS_CLIENTKEY_FILE | sed 's|'$(pwd)'/crypto-config|/etc/hyperledger/fabric/crypto-config|')"
    -e "CORE_PEER_TLS_HOSTNAME_OVERRIDE=${CORE_PEER_TLS_HOSTNAME_OVERRIDE}"
    -e "CORE_PEER_ADDRESS=${CORE_PEER_ADDRESS}"
    -e "CORE_PEER_TLS_ENABLED=true"
    cli
    peer lifecycle chaincode install "/opt/fabric-config/network/${CC_NAME}.tar.gz"
)
INSTALL_OUTPUT=$("${DOCKER_EXEC_INSTALL_CMD[@]}" 2>&1)
echo "$INSTALL_OUTPUT"

PACKAGE_ID=$(echo "$INSTALL_OUTPUT" | sed -n 's/.*Chaincode code package identifier: //p')

if [ -z "$PACKAGE_ID" ]; then
    if echo "$INSTALL_OUTPUT" | grep -q "already successfully installed"; then
        echo "Chaincode already installed. Querying installed chaincodes to get Package ID..."
        DOCKER_EXEC_QUERY_INSTALLED_CMD=(docker exec
            -e "CORE_PEER_LOCALMSPID=${CORE_PEER_LOCALMSPID}"
            -e "CORE_PEER_MSPCONFIGPATH=$(echo $CORE_PEER_MSPCONFIGPATH | sed 's|'$(pwd)'/crypto-config|/etc/hyperledger/fabric/crypto-config|')"
            -e "CORE_PEER_TLS_ROOTCERT_FILE=$(echo $CORE_PEER_TLS_ROOTCERT_FILE | sed 's|'$(pwd)'/crypto-config|/etc/hyperledger/fabric/crypto-config|')"
            -e "CORE_PEER_TLS_CLIENTCERT_FILE=$(echo $CORE_PEER_TLS_CLIENTCERT_FILE | sed 's|'$(pwd)'/crypto-config|/etc/hyperledger/fabric/crypto-config|')"
            -e "CORE_PEER_TLS_CLIENTKEY_FILE=$(echo $CORE_PEER_TLS_CLIENTKEY_FILE | sed 's|'$(pwd)'/crypto-config|/etc/hyperledger/fabric/crypto-config|')"
            -e "CORE_PEER_TLS_HOSTNAME_OVERRIDE=${CORE_PEER_TLS_HOSTNAME_OVERRIDE}"
            -e "CORE_PEER_ADDRESS=${CORE_PEER_ADDRESS}"
            -e "CORE_PEER_TLS_ENABLED=true"
            cli
            peer lifecycle chaincode queryinstalled
        )
        PACKAGE_ID=$("${DOCKER_EXEC_QUERY_INSTALLED_CMD[@]}" 2>/dev/null | grep "${CC_LABEL}" | awk '{print $3}' | sed 's/,//')
    fi

    if [ -z "$PACKAGE_ID" ]; then
        echo "FATAL ERROR: Could not determine PACKAGE_ID after install. Please check the logs above."
        exit 1
    fi
fi
echo "Chaincode Package ID captured: $PACKAGE_ID"
echo ""

for ORG in "registrar" "faculty" "department"; do
    setIdentity $ORG
    echo "Ensuring CC is installed on $ORG..."
    DOCKER_EXEC_INSTALL_CMD=(docker exec
        -e "CORE_PEER_LOCALMSPID=${CORE_PEER_LOCALMSPID}"
        -e "CORE_PEER_MSPCONFIGPATH=$(echo $CORE_PEER_MSPCONFIGPATH | sed 's|'$(pwd)'/crypto-config|/etc/hyperledger/fabric/crypto-config|')"
        -e "CORE_PEER_TLS_ROOTCERT_FILE=$(echo $CORE_PEER_TLS_ROOTCERT_FILE | sed 's|'$(pwd)'/crypto-config|/etc/hyperledger/fabric/crypto-config|')"
        -e "CORE_PEER_TLS_CLIENTCERT_FILE=$(echo $CORE_PEER_TLS_CLIENTCERT_FILE | sed 's|'$(pwd)'/crypto-config|/etc/hyperledger/fabric/crypto-config|')"
        -e "CORE_PEER_TLS_CLIENTKEY_FILE=$(echo $CORE_PEER_TLS_CLIENTKEY_FILE | sed 's|'$(pwd)'/crypto-config|/etc/hyperledger/fabric/crypto-config|')"
        -e "CORE_PEER_TLS_HOSTNAME_OVERRIDE=${CORE_PEER_TLS_HOSTNAME_OVERRIDE}"
        -e "CORE_PEER_ADDRESS=${CORE_PEER_ADDRESS}"
        -e "CORE_PEER_TLS_ENABLED=true"
        cli
        peer lifecycle chaincode install "/opt/fabric-config/network/${CC_NAME}.tar.gz"
    )
    ORG_INSTALL_OUTPUT=$("${DOCKER_EXEC_INSTALL_CMD[@]}" 2>&1)
    if [[ $? -ne 0 ]] && ! echo "$ORG_INSTALL_OUTPUT" | grep -q "already successfully installed"; then
         echo "Warning: Install on $ORG returned an error (might be ignored if already installed): $ORG_INSTALL_OUTPUT"
    fi
    sleep 1 # Small delay after install
    
    echo "Approving CC for $ORG (ID: $PACKAGE_ID)..."
    DOCKER_EXEC_APPROVE_CMD=(docker exec
        -e "CORE_PEER_LOCALMSPID=${CORE_PEER_LOCALMSPID}"
        -e "CORE_PEER_MSPCONFIGPATH=$(echo $CORE_PEER_MSPCONFIGPATH | sed 's|'$(pwd)'/crypto-config|/etc/hyperledger/fabric/crypto-config|')"
        -e "CORE_PEER_TLS_ROOTCERT_FILE=$(echo $CORE_PEER_TLS_ROOTCERT_FILE | sed 's|'$(pwd)'/crypto-config|/etc/hyperledger/fabric/crypto-config|')"
        -e "CORE_PEER_TLS_CLIENTCERT_FILE=$(echo $CORE_PEER_TLS_CLIENTCERT_FILE | sed 's|'$(pwd)'/crypto-config|/etc/hyperledger/fabric/crypto-config|')"
        -e "CORE_PEER_TLS_CLIENTKEY_FILE=$(echo $CORE_PEER_TLS_CLIENTKEY_FILE | sed 's|'$(pwd)'/crypto-config|/etc/hyperledger/fabric/crypto-config|')"
        -e "CORE_PEER_TLS_HOSTNAME_OVERRIDE=${CORE_PEER_TLS_HOSTNAME_OVERRIDE}"
        -e "CORE_PEER_ADDRESS=${CORE_PEER_ADDRESS}"
        -e "CORE_PEER_TLS_ENABLED=true"
        cli
        peer lifecycle chaincode approveformyorg -o orderer.capstone.com:7050 --tls true --cafile "/etc/hyperledger/fabric/crypto-config/ordererOrganizations/capstone.com/orderers/orderer.capstone.com/tls/ca.crt" --ordererTLSHostnameOverride orderer.capstone.com
        --channelID "$CHANNEL_NAME" --name "$CC_NAME" --version "$CC_VERSION"
        --package-id "$PACKAGE_ID" --sequence "$CC_SEQUENCE" --signature-policy "$CC_POLICY"
        --collections-config "/opt/fabric-config/network/collections.json"
    )
    "${DOCKER_EXEC_APPROVE_CMD[@]}"
    sleep 1 # Small delay after approve
    echo ""
done

# --- 7. COMMIT ---
setIdentity "registrar"
echo "Committing chaincode definition to channel..."
DOCKER_EXEC_COMMIT_CMD=(docker exec
    -e "CORE_PEER_LOCALMSPID=${CORE_PEER_LOCALMSPID}"
    -e "CORE_PEER_MSPCONFIGPATH=$(echo $CORE_PEER_MSPCONFIGPATH | sed 's|'$(pwd)'/crypto-config|/etc/hyperledger/fabric/crypto-config|')"
    -e "CORE_PEER_TLS_ROOTCERT_FILE=$(echo $CORE_PEER_TLS_ROOTCERT_FILE | sed 's|'$(pwd)'/crypto-config|/etc/hyperledger/fabric/crypto-config|')"
    -e "CORE_PEER_TLS_CLIENTCERT_FILE=$(echo $CORE_PEER_TLS_CLIENTCERT_FILE | sed 's|'$(pwd)'/crypto-config|/etc/hyperledger/fabric/crypto-config|')"
    -e "CORE_PEER_TLS_CLIENTKEY_FILE=$(echo $CORE_PEER_TLS_CLIENTKEY_FILE | sed 's|'$(pwd)'/crypto-config|/etc/hyperledger/fabric/crypto-config|')"
    -e "CORE_PEER_ADDRESS=${CORE_PEER_ADDRESS}"
    -e "CORE_PEER_TLS_ENABLED=true"
    cli
    peer lifecycle chaincode commit -o orderer.capstone.com:7050 --tls true --cafile "/etc/hyperledger/fabric/crypto-config/ordererOrganizations/capstone.com/orderers/orderer.capstone.com/tls/ca.crt" --ordererTLSHostnameOverride orderer.capstone.com
    --channelID "$CHANNEL_NAME" --name "$CC_NAME" --version "$CC_VERSION"
    --sequence "$CC_SEQUENCE" --signature-policy "$CC_POLICY"
    --collections-config "/opt/fabric-config/network/collections.json"
    --peerAddresses "peer0.registrar.capstone.com:7051" --tlsRootCertFiles "/etc/hyperledger/fabric/crypto-config/peerOrganizations/registrar.capstone.com/peers/peer0.registrar.capstone.com/tls/ca.crt"
    --peerAddresses "peer0.faculty.capstone.com:7051" --tlsRootCertFiles "/etc/hyperledger/fabric/crypto-config/peerOrganizations/faculty.capstone.com/peers/peer0.faculty.capstone.com/tls/ca.crt"
    --peerAddresses "peer0.department.capstone.com:7051" --tlsRootCertFiles "/etc/hyperledger/fabric/crypto-config/peerOrganizations/department.capstone.com/peers/peer0.department.capstone.com/tls/ca.crt"
)
COMMIT_OUTPUT=$("${DOCKER_EXEC_COMMIT_CMD[@]}" 2>&1)
if [ $? -ne 0 ]; then
    if echo "$COMMIT_OUTPUT" | grep -q "already committed"; then
        echo "Chaincode definition is already committed. Skipping."
    else
        echo "FATAL ERROR: Chaincode commit failed."
        echo "$COMMIT_OUTPUT"
        exit 1
    fi
fi
echo ""
echo "--- DEPLOYMENT SUCCESSFUL --- "
echo "Final Package ID: $PACKAGE_ID"
echo "Private Data Collections injected seamlessly."
echo ""


# --- 7.5 UPDATE ENV AND RESTART CHAINCODE ---
echo "--- UPDATING CHAINCODE ENVIRONMENT ---"
PACKAGE_ID=$(echo "$PACKAGE_ID" | tr -d '\r\n')
sed -i.bak '/^CHAINCODE_ID=/d' .env 2>/dev/null || true
echo "CHAINCODE_ID=$PACKAGE_ID" >> .env
echo "Updated .env with CHAINCODE_ID=$PACKAGE_ID"

echo "Restarting registrar-chaincode container to pick up new ID..."
export CHAINCODE_ID=$PACKAGE_ID
docker compose stop registrar-chaincode 2>/dev/null || true
docker compose rm -f registrar-chaincode 2>/dev/null || true
docker compose up -d --no-deps --force-recreate --build registrar-chaincode
echo ""

# --- 8. TEST CHAINCODE ---
echo "--- TESTING CHAINCODE ---"
echo "Waiting for chaincode containers to initialize and become ready for transactions..."

# Give the chaincode container a bit more time to fully initialize after restart
wait_for_service localhost 9999 "Chaincode-as-a-Service" 90

# Function to check if chaincode is ready on a peer
check_chaincode_ready() {
    local org=$1
    local max_attempts=10
    local attempt=1
    echo "Checking if chaincode '$CC_NAME' is ready on $org peer..."
    while [ $attempt -le $max_attempts ]; do
        setIdentity $org # Ensure identity is set for the peer
        DOCKER_EXEC_QUERY_COMMITTED_CMD=(docker exec
            -e "CORE_PEER_LOCALMSPID=${CORE_PEER_LOCALMSPID}"
            -e "CORE_PEER_MSPCONFIGPATH=$(echo $CORE_PEER_MSPCONFIGPATH | sed 's|'$(pwd)'/crypto-config|/etc/hyperledger/fabric/crypto-config|')"
            -e "CORE_PEER_TLS_ROOTCERT_FILE=$(echo $CORE_PEER_TLS_ROOTCERT_FILE | sed 's|'$(pwd)'/crypto-config|/etc/hyperledger/fabric/crypto-config|')"
            -e "CORE_PEER_TLS_CLIENTCERT_FILE=$(echo $CORE_PEER_TLS_CLIENTCERT_FILE | sed 's|'$(pwd)'/crypto-config|/etc/hyperledger/fabric/crypto-config|')"
            -e "CORE_PEER_TLS_CLIENTKEY_FILE=$(echo $CORE_PEER_TLS_CLIENTKEY_FILE | sed 's|'$(pwd)'/crypto-config|/etc/hyperledger/fabric/crypto-config|')"
            -e "CORE_PEER_TLS_HOSTNAME_OVERRIDE=${CORE_PEER_TLS_HOSTNAME_OVERRIDE}"
            -e "CORE_PEER_ADDRESS=${CORE_PEER_ADDRESS}"
            -e "CORE_PEER_TLS_ENABLED=true"
            cli
            peer lifecycle chaincode querycommitted -C "$CHANNEL_NAME" -n "$CC_NAME" -O json --connTimeout 10s
        )
        "${DOCKER_EXEC_QUERY_COMMITTED_CMD[@]}" >/dev/null 2>&1
        if [ $? -eq 0 ]; then
            echo "Chaincode '$CC_NAME' is ready on $org peer."
            return 0
        fi
        echo "Chaincode '$CC_NAME' not yet ready on $org peer (Attempt $attempt/$max_attempts). Waiting 5s..."
        sleep 5
        attempt=$((attempt+1))
    done
    echo "FATAL ERROR: Chaincode '$CC_NAME' did not become ready on $org peer after multiple attempts."
    exit 1
}

# Check readiness for all peers involved in endorsement
check_chaincode_ready "registrar"
check_chaincode_ready "faculty"
check_chaincode_ready "department"

echo "Submitting an Invoke transaction (InitLedger)..."

# Use a loop for invoke and query with retries
MAX_TX_RETRY=5
TX_ATTEMPT=1
TX_SUCCESS=false

while [ $TX_ATTEMPT -le $MAX_TX_RETRY ]; do
    echo "Attempt $TX_ATTEMPT/$MAX_TX_RETRY: Invoking InitLedger..."
    DOCKER_EXEC_INVOKE_CMD=(docker exec
        -e "CORE_PEER_LOCALMSPID=RegistrarMSP" # Invoke as registrar
        -e "CORE_PEER_MSPCONFIGPATH=/etc/hyperledger/fabric/crypto-config/peerOrganizations/registrar.capstone.com/users/Admin@registrar.capstone.com/msp"
        -e "CORE_PEER_TLS_ROOTCERT_FILE=/etc/hyperledger/fabric/crypto-config/peerOrganizations/registrar.capstone.com/peers/peer0.registrar.capstone.com/tls/ca.crt"
        -e "CORE_PEER_TLS_CLIENTCERT_FILE=/etc/hyperledger/fabric/crypto-config/peerOrganizations/registrar.capstone.com/users/Admin@registrar.capstone.com/tls/client.crt"
        -e "CORE_PEER_TLS_CLIENTKEY_FILE=/etc/hyperledger/fabric/crypto-config/peerOrganizations/registrar.capstone.com/users/Admin@registrar.capstone.com/tls/client.key"
        -e "CORE_PEER_TLS_ENABLED=true"
        cli
        peer chaincode invoke -o orderer.capstone.com:7050 --tls true --cafile "/etc/hyperledger/fabric/crypto-config/ordererOrganizations/capstone.com/orderers/orderer.capstone.com/tls/ca.crt" --ordererTLSHostnameOverride orderer.capstone.com --connTimeout 60s
        -C "$CHANNEL_NAME" -n "$CC_NAME"
        --peerAddresses "peer0.registrar.capstone.com:7051" --tlsRootCertFiles "/etc/hyperledger/fabric/crypto-config/peerOrganizations/registrar.capstone.com/peers/peer0.registrar.capstone.com/tls/ca.crt"
        --peerAddresses "peer0.faculty.capstone.com:7051" --tlsRootCertFiles "/etc/hyperledger/fabric/crypto-config/peerOrganizations/faculty.capstone.com/peers/peer0.faculty.capstone.com/tls/ca.crt"
        --peerAddresses "peer0.department.capstone.com:7051" --tlsRootCertFiles "/etc/hyperledger/fabric/crypto-config/peerOrganizations/department.capstone.com/peers/peer0.department.capstone.com/tls/ca.crt"
        -c '{"Args":["InitLedger"]}'
    )
    INVOKE_OUTPUT=$("${DOCKER_EXEC_INVOKE_CMD[@]}" 2>&1)
    
    if [ $? -eq 0 ]; then
        echo "InitLedger invoked successfully."
        TX_SUCCESS=true
        break
    else
        echo "InitLedger invocation failed (Attempt $TX_ATTEMPT/$MAX_TX_RETRY). Retrying in 10 seconds..."
        echo "$INVOKE_OUTPUT" # Log the error output
        sleep 10
    fi
    TX_ATTEMPT=$((TX_ATTEMPT+1))
done

if [ "$TX_SUCCESS" = false ]; then
    echo "FATAL ERROR: Chaincode InitLedger invocation failed after multiple attempts."
    exit 1
fi

echo "Waiting 10 seconds for transaction to commit..."
sleep 10

TX_ATTEMPT=1
TX_SUCCESS=false
while [ $TX_ATTEMPT -le $MAX_TX_RETRY ]; do
    echo "Attempt $TX_ATTEMPT/$MAX_TX_RETRY: Querying the ledger to verify data..."
    DOCKER_EXEC_QUERY_CMD=(docker exec
        -e "CORE_PEER_LOCALMSPID=RegistrarMSP" # Query as registrar
        -e "CORE_PEER_MSPCONFIGPATH=/etc/hyperledger/fabric/crypto-config/peerOrganizations/registrar.capstone.com/users/Admin@registrar.capstone.com/msp"
        -e "CORE_PEER_TLS_ROOTCERT_FILE=/etc/hyperledger/fabric/crypto-config/peerOrganizations/registrar.capstone.com/peers/peer0.registrar.capstone.com/tls/ca.crt"
        -e "CORE_PEER_ADDRESS=peer0.registrar.capstone.com:7051"
        -e "CORE_PEER_TLS_CLIENTCERT_FILE=/etc/hyperledger/fabric/crypto-config/peerOrganizations/registrar.capstone.com/users/Admin@registrar.capstone.com/tls/client.crt"
        -e "CORE_PEER_TLS_CLIENTKEY_FILE=/etc/hyperledger/fabric/crypto-config/peerOrganizations/registrar.capstone.com/users/Admin@registrar.capstone.com/tls/client.key"
        -e "CORE_PEER_TLS_ENABLED=true"
        cli
        peer chaincode query -C "$CHANNEL_NAME" -n "$CC_NAME" -c '{"Args":["GetAllGrades"]}' --connTimeout 60s
    )
    QUERY_RESULT=$("${DOCKER_EXEC_QUERY_CMD[@]}" 2>&1)
    
    if [ $? -eq 0 ]; then
        echo "Chaincode query successful. Result: $QUERY_RESULT"
        TX_SUCCESS=true
        break
    else
        echo "Chaincode query failed (Attempt $TX_ATTEMPT/$MAX_TX_RETRY). Retrying in 10 seconds..."
        echo "$QUERY_RESULT" # Log the error output
        sleep 10
    fi
    TX_ATTEMPT=$((TX_ATTEMPT+1))
done

if [ "$TX_SUCCESS" = false ]; then
    echo "FATAL ERROR: Chaincode query failed after multiple attempts."
    exit 1
fi
echo ""

# --- 13. START APPLICATION SERVICES AND FRONTEND ---
echo "--- STARTING APPLICATION SERVICES ---"

# Start C# Backend
if [ -d "../client-app" ]; then
    if nc -z localhost 5000; then
        echo "C# Backend is already running on port 5000. Skipping startup."
    else
        echo "Starting C# Backend (client-app)..."
        ( # Run in a subshell to isolate directory changes and nohup
            cd ../client-app || { echo "Error: Cannot change directory to ../client-app"; exit 1; }
            echo "Installing C# packages and restoring dependencies..."
            dotnet restore || { echo "Error: dotnet restore failed."; exit 1; }
            echo "Starting C# backend in background (logs to backend.log)..."
            nohup dotnet run > backend.log 2>&1 &
            echo $! > /tmp/client_app_pid.tmp
        )
        if [ $? -ne 0 ]; then
            echo "FATAL ERROR: C# Backend initialization failed. Check the logs above."
            exit 1
        fi
        if [ -f /tmp/client_app_pid.tmp ]; then
            CLIENT_APP_PID=$(cat /tmp/client_app_pid.tmp)
            rm -f /tmp/client_app_pid.tmp
            PIDS+=($CLIENT_APP_PID) # Add PID to array
        fi
        wait_for_service localhost 5000 "C# Backend" 60
    fi
else
    echo "C# Backend directory not found at ../client-app. Skipping."
fi
echo ""

# Start Node.js Middleware (Fabric Bridge)
if [ -d "../middleware" ]; then
    if nc -z localhost 4000; then
        echo "Node.js Middleware is already running on port 4000. Skipping startup."
    else
        echo "Starting Node.js Middleware..."
        ( # Run in a subshell to isolate directory changes and nohup
            cd ../middleware || { echo "Error: Cannot change directory to ../middleware"; exit 1; }
            echo "Installing middleware dependencies..."
            npm install || { echo "Error: npm install in middleware failed."; exit 1; }
            echo "Enrolling CA Admins into CouchDB Wallet..."
            node enrollAllAdmins.js || echo "Warning: Admin enrollment had issues."
            echo "Starting middleware in background (logs to middleware.log)..."
            nohup npm start > middleware.log 2>&1 &
            # Capture PID of the background process for cleanup
            echo $! > /tmp/middleware_pid.tmp
        )
        if [ $? -ne 0 ]; then
            echo "FATAL ERROR: Node.js Middleware initialization failed."
            exit 1
        fi
        if [ -f /tmp/middleware_pid.tmp ]; then
            # Read PID from temp file into main script's PIDS array
            MIDDLEWARE_PID=$(cat /tmp/middleware_pid.tmp)
            rm -f /tmp/middleware_pid.tmp
            PIDS+=($MIDDLEWARE_PID)
        fi
        wait_for_service localhost 4000 "Node.js Middleware" 60
    fi
else
    echo "Middleware directory not found at ../middleware. Skipping."
fi
echo ""

# Build React Frontend
if [ -d "../frontend" ]; then
    echo "Building React Frontend..."
    ( # Run in a subshell to isolate directory changes
        cd ../frontend || { echo "Error: Cannot change directory to ../frontend"; exit 1; }
        echo "Installing frontend dependencies (logs to frontend_build.log)..."
        npm install > frontend_build.log 2>&1 || { echo "Error: npm install in frontend failed. Check frontend/frontend_build.log"; exit 1; }
        echo "Running React build process (this may take a moment)..."
        npm run build >> frontend_build.log 2>&1 || { echo "Error: npm run build failed. Check frontend/frontend_build.log"; exit 1; }
    )
    if [ $? -ne 0 ]; then
        echo "FATAL ERROR: React Frontend build failed."
        exit 1
    fi
    echo "React Frontend built successfully into ../frontend/build. Nginx will serve these files."
else
    echo "Frontend directory not found at ../frontend. Skipping React build."
fi
echo ""

# --- 14. BOOTSTRAP INITIAL REGISTRAR ---
echo "--- BOOTSTRAPPING INITIAL REGISTRAR ---"
BOOTSTRAP_URL="http://127.0.0.1:4000/api/bootstrap"
MAX_BOOTSTRAP_RETRIES=10
BOOTSTRAP_ATTEMPT=1
BOOTSTRAP_SUCCESS=false

while [ $BOOTSTRAP_ATTEMPT -le $MAX_BOOTSTRAP_RETRIES ]; do
    echo "Attempt $BOOTSTRAP_ATTEMPT/$MAX_BOOTSTRAP_RETRIES: Attempting to bootstrap registrar from $BOOTSTRAP_URL..."
    # Capture only the HTTP status code. -s silent, -o /dev/null discard output, -w '%{http_code}' get http code
    HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' $BOOTSTRAP_URL)
    
    if [ "$HTTP_CODE" -eq 200 ] || [ "$HTTP_CODE" -eq 204 ]; then # Assuming 200 OK or 204 No Content for success
        echo "Registrar bootstrapped successfully!"
        BOOTSTRAP_SUCCESS=true
        break
    elif [ "$HTTP_CODE" -eq 409 ]; then # 409 Conflict if already bootstrapped
        echo "ℹRegistrar appears to be already bootstrapped (received HTTP 409 Conflict)."
        BOOTSTRAP_SUCCESS=true
        break
    else
        echo "Bootstrap failed (HTTP $HTTP_CODE). Retrying in 5 seconds..."
        sleep 5
    fi
    BOOTSTRAP_ATTEMPT=$((BOOTSTRAP_ATTEMPT+1))
done

if [ "$BOOTSTRAP_SUCCESS" = false ]; then
    echo "FATAL ERROR: Failed to bootstrap the initial registrar after multiple attempts."
    exit 1
fi
echo ""

# --- 15. FINAL INSTRUCTIONS ---
echo "--- DEPLOYMENT COMPLETE! ---"
echo ""
echo "application is now running."
echo "Access the web application at: http://localhost"
echo ""
echo "Initial Registrar Credentials:"
echo "  Email: registrar@plv.edu.ph"
echo "  Password: admin123"
echo ""
echo "Please keep these credentials secure and consider changing the password after your first login."
echo ""
echo "================================================="
echo " SERVICES ARE RUNNING IN THE BACKGROUND"
echo " Press Ctrl+C to stop all services and exit."
echo "================================================="

# Keep the script running to prevent the EXIT trap from killing the background processes prematurely
while true; do
    sleep 86400
done