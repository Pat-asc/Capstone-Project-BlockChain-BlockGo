log_info "Phase 4: Crypto material and genesis block..."

if [ ! -d "./crypto-config" ] || [ ! -f "./channel-artifacts/genesis.block" ]; then
    log_info "Generating crypto material..."
    # Bring down containers to ensure bind mounts aren't broken by folder regeneration
    docker compose down -v 2>/dev/null || true
    mkdir -p ./crypto-config
    rm -rf ./crypto-config/*
    ./bin/cryptogen generate --config=./crypto-config.yaml --output="crypto-config" || log_error "Cryptogen failed"
    
    log_info "Generating genesis block..."
    ./bin/configtxgen -profile UniversityGenesis -channelID system-channel -outputBlock ./channel-artifacts/genesis.block || log_error "Genesis block generation failed"
else
    log_info "Crypto material and genesis block already exist"
fi

log_info "Phase 5: Channel transaction..."
if [ ! -f "./channel-artifacts/${CHANNEL_NAME}.tx" ]; then
    log_info "Generating channel transaction..."
    ./bin/configtxgen -profile RegistrarChannel -outputCreateChannelTx ./channel-artifacts/${CHANNEL_NAME}.tx -channelID $CHANNEL_NAME || log_error "Channel tx generation failed"
else
    log_info "Channel transaction already exists"
fi

log_info "Phase 6: Starting Docker containers..."

if docker compose ps | grep -q "orderer"; then
    log_info "Containers already running"
else
    log_info "Pulling Docker images individually for network stability..."
    
    # Define all images that need to be pulled from docker-compose.yaml.
    # This is more resilient to network errors than 'docker compose pull'.
    IMAGES=(
        "hyperledger/fabric-ca:1.5.7"
        "hyperledger/fabric-orderer:${FABRIC_VERSION}"
        "couchdb:3.3.3"
        "hyperledger/fabric-peer:${FABRIC_VERSION}"
        "ipfs/kubo:latest"
        "postgres:14-alpine"
        "nginx:stable-alpine"
        "hyperledger/fabric-tools:${FABRIC_VERSION}"
        "hyperledger/fabric-ccenv:${FABRIC_VERSION}"
        "hyperledger/fabric-baseos:${FABRIC_VERSION}"
    )

    for IMAGE in "${IMAGES[@]}"; do
        log_info "Pulling image: $IMAGE"
        MAX_PULL_RETRIES=20
        for ((PULL_ATTEMPT=1; PULL_ATTEMPT<=MAX_PULL_RETRIES; PULL_ATTEMPT++)); do
            if docker pull "$IMAGE"; then break; fi
            if [ $PULL_ATTEMPT -eq $MAX_PULL_RETRIES ]; then
                log_error "Failed to pull image $IMAGE after $MAX_PULL_RETRIES attempts."
            fi
            log_warn "Pull for $IMAGE failed. Retrying in 5 seconds (Attempt $PULL_ATTEMPT/$MAX_PULL_RETRIES)..."
            sleep 5
        done
    done

    if ! docker compose up -d; then
        log_warn "docker compose up failed! Printing container logs for debugging:"
        docker compose logs --tail=30
        log_error "docker compose up failed. Please check the logs above."
    fi
    
    log_info "Waiting for containers to be ready..."
    wait_for_service localhost 7050 "Orderer Service" 30
    wait_for_service localhost 7051 "Registrar Peer" 30
    sleep 10
fi

log_info "Phase 7: Channel creation and peer joining..."

if ! docker exec cli peer channel list 2>/dev/null | grep -q "$CHANNEL_NAME"; then
    log_info "Creating channel $CHANNEL_NAME..."
    
    # Copy the transaction file directly into the cli container to bypass any volume mount issues
    docker cp ./channel-artifacts/${CHANNEL_NAME}.tx cli:/tmp/${CHANNEL_NAME}.tx
    
    if ! docker exec cli peer channel create -c $CHANNEL_NAME -f /tmp/$CHANNEL_NAME.tx -o orderer.capstone.com:7050 --tls --cafile /etc/hyperledger/fabric/crypto-config/ordererOrganizations/capstone.com/orderers/orderer.capstone.com/tls/ca.crt; then
        log_error "Channel creation failed. Please check the error output above."
    fi
    log_info "Channel created"
    
    log_info "Joining peers to channel..."
    # Join Registrar peer (with retry loop to wait for CouchDB initialization)
    for i in {1..12}; do
        if docker exec -e CORE_PEER_ADDRESS=peer0.registrar.capstone.com:7051 \
            cli peer channel join -b $CHANNEL_NAME.block; then
            break
        fi
        log_warn "Registrar peer not ready yet, retrying in 5 seconds (Attempt $i/12)..."
        sleep 5
        if [ $i -eq 12 ]; then
            log_error "Failed to join Registrar peer. The peer container may have crashed."
        fi
    done
        
    # Join Faculty peer
    docker exec -e CORE_PEER_LOCALMSPID=FacultyMSP -e CORE_PEER_ADDRESS=peer0.faculty.capstone.com:7051 \
        -e CORE_PEER_TLS_ROOTCERT_FILE=/etc/hyperledger/fabric/crypto-config/peerOrganizations/faculty.capstone.com/peers/peer0.faculty.capstone.com/tls/ca.crt \
        -e CORE_PEER_MSPCONFIGPATH=/etc/hyperledger/fabric/crypto-config/peerOrganizations/faculty.capstone.com/users/Admin@faculty.capstone.com/msp \
        cli peer channel join -b $CHANNEL_NAME.block
        
    # Join Department peer
    docker exec -e CORE_PEER_LOCALMSPID=DepartmentMSP -e CORE_PEER_ADDRESS=peer0.department.capstone.com:7051 \
        -e CORE_PEER_TLS_ROOTCERT_FILE=/etc/hyperledger/fabric/crypto-config/peerOrganizations/department.capstone.com/peers/peer0.department.capstone.com/tls/ca.crt \
        -e CORE_PEER_MSPCONFIGPATH=/etc/hyperledger/fabric/crypto-config/peerOrganizations/department.capstone.com/users/Admin@department.capstone.com/msp \
        cli peer channel join -b $CHANNEL_NAME.block
    log_info "Peers joined"
else
    log_info "Channel and peers already configured"
fi

sleep 5