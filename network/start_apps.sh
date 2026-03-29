#!/bin/bash

# Store PIDs of background processes to clean up on exit
declare -a PIDS

cleanup_processes() {
    echo ""
    echo "Shutting down Application Services..."
    for pid in "${PIDS[@]}"; do
        if ps -p $pid > /dev/null 2>&1; then
            kill $pid 2>/dev/null
        fi
    done
    echo "Background processes stopped."
}

# Register the cleanup function to be called on EXIT or script interruption
trap cleanup_processes EXIT

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

echo "--- STARTING APPLICATION SERVICES ---"

# Start C# Backend
if [ -d "../client-app" ]; then
    if nc -z localhost 5000 > /dev/null 2>&1; then
        echo "C# Backend is already running on port 5000. Stopping old instance..."
        fuser -k 5000/tcp 2>/dev/null || true
        sleep 2
    fi
    
    echo "Starting C# Backend (client-app)..."
    ( # Run in a subshell
        cd ../client-app || exit 1
        echo "Starting C# backend in background (logs to client-app/backend.log)..."
        nohup dotnet run > backend.log 2>&1 &
        echo $! > /tmp/client_app_pid.tmp
    )
    if [ -f /tmp/client_app_pid.tmp ]; then
        CLIENT_APP_PID=$(cat /tmp/client_app_pid.tmp)
        rm -f /tmp/client_app_pid.tmp
        PIDS+=($CLIENT_APP_PID) # Add PID to array
    fi
    wait_for_service localhost 5000 "C# Backend" 60
else
    echo "C# Backend directory not found at ../client-app. Skipping."
fi
echo ""

# Start Node.js Middleware (Fabric Bridge)
if [ -d "../middleware" ]; then
    if nc -z localhost 4000 > /dev/null 2>&1; then
        echo "Node.js Middleware is already running on port 4000. Stopping old instance..."
        fuser -k 4000/tcp 2>/dev/null || true
        sleep 2
    fi

    echo "Starting Node.js Middleware..."
    ( # Run in a subshell
        cd ../middleware || exit 1
        echo "Ensuring CA Admins are enrolled in CouchDB..."
        node enrollAllAdmins.js || echo "Warning: Admin enrollment had issues."
        echo "Starting middleware in background (logs to middleware/middleware.log)..."
        nohup npm start > middleware.log 2>&1 &
        echo $! > /tmp/middleware_pid.tmp
    )
    if [ -f /tmp/middleware_pid.tmp ]; then
        MIDDLEWARE_PID=$(cat /tmp/middleware_pid.tmp)
        rm -f /tmp/middleware_pid.tmp
        PIDS+=($MIDDLEWARE_PID)
    fi
    wait_for_service localhost 4000 "Node.js Middleware" 60
else
    echo "Middleware directory not found at ../middleware. Skipping."
fi
echo ""

# Build React Frontend
if [ -d "../frontend" ]; then
    echo "Building React Frontend (this may take a moment, logs in frontend/frontend_build.log)..."
    ( 
        cd ../frontend || exit 1
        npm run build >> frontend_build.log 2>&1 
    )
    echo "React Frontend built successfully into ../frontend/build."
else
    echo "Frontend directory not found at ../frontend. Skipping React build."
fi
echo ""

# --- BOOTSTRAPPING INITIAL REGISTRAR ---
echo "--- BOOTSTRAPPING INITIAL REGISTRAR ---"
BOOTSTRAP_URL="http://127.0.0.1:4000/api/bootstrap"
MAX_BOOTSTRAP_RETRIES=5
BOOTSTRAP_ATTEMPT=1

while [ $BOOTSTRAP_ATTEMPT -le $MAX_BOOTSTRAP_RETRIES ]; do
    HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' $BOOTSTRAP_URL)
    
    if [ "$HTTP_CODE" -eq 200 ] || [ "$HTTP_CODE" -eq 204 ]; then 
        echo "Registrar bootstrapped successfully!"
        break
    elif [ "$HTTP_CODE" -eq 409 ]; then 
        echo "ℹRegistrar appears to be already bootstrapped (received HTTP 409 Conflict)."
        break
    else
        echo "Bootstrap failed (HTTP $HTTP_CODE). Retrying in 5 seconds..."
        sleep 5
    fi
    BOOTSTRAP_ATTEMPT=$((BOOTSTRAP_ATTEMPT+1))
done
echo ""

# --- FINAL INSTRUCTIONS ---
echo "--- STARTUP COMPLETE! ---"
echo ""
echo "Application is now running."
echo "Access the web application at: http://localhost"
echo ""
echo "Initial Registrar Credentials:"
echo "  Email: registrar@plv.edu.ph"
echo "  Password: admin123"
echo ""
echo "================================================="
echo " SERVICES ARE RUNNING IN THE BACKGROUND"
echo " Press Ctrl+C to stop all services and exit."
echo "================================================="

# Keep the script running to prevent the EXIT trap from killing the processes prematurely
while true; do
    sleep 86400
done