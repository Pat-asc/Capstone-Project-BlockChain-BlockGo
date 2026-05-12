#!/bin/bash
set -u

CHECK_INTERVAL="${NGINX_FAILOVER_INTERVAL:-3}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SHIELDS=(
    "nginx-shield-main:8080:nginx-shield-main-failover"
    "nginx-shield-annex:8090:nginx-shield-annex-failover"
    "nginx-shield-pubad:8100:nginx-shield-pubad-failover"
)

log_watchdog() {
    echo "[NGINX-FAILOVER] $1"
}

is_container_running() {
    local name=$1
    [ "$(docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null)" = "true" ]
}

is_port_open() {
    local port=$1
    nc -z -w 1 127.0.0.1 "$port" >/dev/null 2>&1
}

start_redirector() {
    local port=$1
    local redirect_container=$2

    docker rm -f "$redirect_container" >/dev/null 2>&1 || true

    docker run -d --name "$redirect_container" \
        -p "${port}:80" \
        -v "$SCRIPT_DIR/nginx-failover-redirect/default.conf:/etc/nginx/conf.d/default.conf:ro" \
        -v "$SCRIPT_DIR/nginx-failover-redirect/index.html:/usr/share/nginx/html/index.html:ro" \
        nginx:stable-alpine >/dev/null

    log_watchdog "Port $port is now serving the automatic redirect page."
}

stop_redirector() {
    local redirect_container=$1
    docker rm -f "$redirect_container" >/dev/null 2>&1 || true
}

manage_shield() {
    local shield_container=$1
    local port=$2
    local redirect_container=$3

    if is_container_running "$shield_container"; then
        if is_container_running "$redirect_container"; then
            stop_redirector "$redirect_container"
            log_watchdog "$shield_container is back. Removed temporary redirector on port $port."
        fi
        return
    fi

    if is_container_running "$redirect_container"; then
        return
    fi

    if is_port_open "$port"; then
        log_watchdog "Port $port is in use, so redirector for $shield_container cannot start yet."
        return
    fi

    start_redirector "$port" "$redirect_container" ||
        log_watchdog "Could not start redirector on port $port for $shield_container."
}

cd "$SCRIPT_DIR"

log_watchdog "Watching all Nginx shields. Any stopped shield port will redirect to an available shield."

while true; do
    for shield in "${SHIELDS[@]}"; do
        IFS=":" read -r shield_container port redirect_container <<< "$shield"
        manage_shield "$shield_container" "$port" "$redirect_container"
    done

    sleep "$CHECK_INTERVAL"
done
