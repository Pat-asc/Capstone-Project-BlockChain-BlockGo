#!/bin/bash

echo "Tearing down the network and cleaning up..."

# Bring down all containers and delete volumes
docker compose down -v 2>/dev/null || true

# Remove generated crypto material and channel artifacts
rm -rf ./crypto-config
rm -rf ./channel-artifacts/*
rm -f .env

echo "Cleanup complete. You can now run ./full_deploy.sh safely."