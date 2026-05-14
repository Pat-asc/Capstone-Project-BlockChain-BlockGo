#!/bin/sh
set -eu

interval="${AUTOHEAL_INTERVAL_SECONDS:-15}"
container="${BACKEND_CONTAINER_NAME:-blockgo-backend}"

while true; do
  running="$(docker inspect --format '{{.State.Running}}' "$container" 2>/dev/null || echo false)"
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container" 2>/dev/null || echo missing)"

  if [ "$running" != "true" ] || [ "$health" = "unhealthy" ]; then
    echo "$(date -Iseconds) restarting $container (running=$running health=$health)"
    docker restart "$container" >/dev/null 2>&1 || true
  fi

  sleep "$interval"
done
