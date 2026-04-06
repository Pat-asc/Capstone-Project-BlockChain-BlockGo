#!/bin/bash
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

declare -a PIDS

cleanup_processes() {
    echo ""
    log_info "Shutting down background application services..."
    for pid in "${PIDS[@]}"; do
        if ps -p $pid > /dev/null 2>&1; then
            kill $pid 2>/dev/null || true
        fi
    done
    log_info "Background processes stopped."
}

trap cleanup_processes EXIT

wait_for_service() {
    local host=$1
    local port=$2
    local service_name=$3
    local timeout=$4
    local start_time=$(date +%s)
    log_info "Waiting for $service_name ($host:$port) to be available..."
    while true; do
        current_time=$(date +%s)
        if [ $((current_time - start_time)) -ge $timeout ]; then
            log_error "$service_name ($host:$port) did not become available within $timeout seconds."
        fi
        if nc -z -w 2 $host $port > /dev/null 2>&1; then
            log_info "$service_name is available!"
            return 0
        fi
        sleep 2
    done
}

source ./01_dependencies.sh
source ./02_network_up.sh
source ./03_deploy_chaincode.sh
source ./04_start_apps.sh

echo ""
echo "=========================================================="
echo -e " ${BLUE}BLOCKGO NETWORK DEPLOYMENT COMPLETE${NC}"
echo "=========================================================="
echo ""
log_info "Channel: $CHANNEL_NAME"
log_info "Chaincode: $CC_NAME v$CC_VERSION (sequence $CC_SEQUENCE)"
log_info "Security: TLS ENABLED with embedded certificates"
echo ""
echo "Application is now running."
echo "Access the web application at: http://localhost:8080 (or port 80 if configured via proxy)"
echo ""
echo "Initial Registrar Credentials:"
echo "  Email: registrar@plv.edu.ph"
echo "  Password: admin123"
echo ""
echo "================================================="
echo " SERVICES ARE RUNNING IN THE BACKGROUND"
echo " Press Ctrl+C to stop all services and exit."
echo "================================================="

while true; do
    sleep 86400
done