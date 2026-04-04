#!/bin/bash
IMAGES=(
  "postgres:14-alpine"
  "hyperledger/fabric-orderer:2.5.4"
  "hyperledger/fabric-peer:2.5.4"
  "ipfs/kubo:latest"
  "hyperledger/fabric-ca:1.5.7"
  "hyperledger/fabric-tools:2.5.4"
)

for img in "${IMAGES[@]}"; do
  echo "Pulling $img..."
  while ! docker pull "$img"; do
    echo "Retrying $img in 3 seconds..."
    sleep 3
  done
done
