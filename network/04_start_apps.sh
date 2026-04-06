log_info "Phase 14: Starting application services..."

if [ -d "../frontend" ]; then
    log_info "Building React Frontend..."
    if ! ( 
        cd ../frontend || exit 1
        npm run build > frontend_build.log 2>&1
    ); then
        log_error "React Frontend build failed. Check frontend/frontend_build.log"
    fi
    log_info "React Frontend built successfully."
else
    log_warn "Frontend directory not found at ../frontend. Skipping React build."
fi

wait_for_service localhost 5432 "PostgreSQL" 60

log_info "Initializing database schema..."
if [ -f "./init-db-schema.sh" ]; then
    bash ./init-db-schema.sh > /dev/null 2>&1 || log_warn "Schema init script had issues or already initialized."
fi

if [ -d "../client-app" ]; then
    if nc -z localhost 5000 > /dev/null 2>&1; then
        log_info "C# Backend is already running on port 5000. Stopping old instance..."
        fuser -k 5000/tcp 2>/dev/null || true
        sleep 2
    fi
    
    log_info "Starting C# Backend (client-app)..."
    (
        cd ../client-app || exit 1
        if [ -f ../network/.env ]; then
            while IFS='=' read -r key value || [ -n "$key" ]; do
                if [[ -n "$key" && "$key" != \#* ]]; then
                    value=$(echo "$value" | tr -d '\r')
                    [[ "$value" == \"*\" ]] && value="${value:1:-1}"
                    [[ "$value" == \'*\' ]] && value="${value:1:-1}"
                    export "$key"="$value"
                fi
            done < ../network/.env
        fi
        nohup dotnet run > backend.log 2>&1 &
        echo $! > /tmp/client_app_pid.tmp
    )
    if [ -f /tmp/client_app_pid.tmp ]; then
        CLIENT_APP_PID=$(cat /tmp/client_app_pid.tmp)
        rm -f /tmp/client_app_pid.tmp
        PIDS+=($CLIENT_APP_PID)
    fi
    wait_for_service localhost 5000 "C# Backend" 60
else
    log_warn "C# Backend directory not found at ../client-app. Skipping."
fi

if [ -d "../middleware" ]; then
    if nc -z localhost 4000 > /dev/null 2>&1; then
        log_info "Node.js Middleware is already running on port 4000. Stopping old instance..."
        fuser -k 4000/tcp 2>/dev/null || true
        sleep 2
    fi

    log_info "Starting Node.js Middleware..."
    (
        cd ../middleware || exit 1
        log_info "Enrolling CA Admins into CouchDB Wallet..."
        node enrollAllAdmins.js || log_warn "Admin enrollment had issues."
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
    log_warn "Middleware directory not found at ../middleware. Skipping."
fi

log_info "Phase 15: Bootstrapping initial registrar..."
BOOTSTRAP_URL="http://127.0.0.1:4000/api/bootstrap"
MAX_BOOTSTRAP_RETRIES=10
BOOTSTRAP_ATTEMPT=1
BOOTSTRAP_SUCCESS=false

while [ $BOOTSTRAP_ATTEMPT -le $MAX_BOOTSTRAP_RETRIES ]; do
    HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' $BOOTSTRAP_URL)
    
    if [ "$HTTP_CODE" -eq 200 ] || [ "$HTTP_CODE" -eq 201 ] || [ "$HTTP_CODE" -eq 204 ]; then 
        log_info "Registrar bootstrapped successfully!"
        BOOTSTRAP_SUCCESS=true
        break
    elif [ "$HTTP_CODE" -eq 409 ]; then 
        log_info "Registrar appears to be already bootstrapped (received HTTP 409 Conflict)."
        BOOTSTRAP_SUCCESS=true
        break
    else
        log_warn "Bootstrap failed (HTTP $HTTP_CODE). Retrying in 5 seconds... ($BOOTSTRAP_ATTEMPT/$MAX_BOOTSTRAP_RETRIES)"
        sleep 5
    fi
    BOOTSTRAP_ATTEMPT=$((BOOTSTRAP_ATTEMPT+1))
done

if [ "$BOOTSTRAP_SUCCESS" = false ]; then 
    log_error "Failed to bootstrap the initial registrar after multiple attempts."
fi