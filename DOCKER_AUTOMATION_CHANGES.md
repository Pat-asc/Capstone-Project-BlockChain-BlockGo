# Docker Automation Changes

This document summarizes the Docker automation and containerization updates added for the C# backend and Node.js middleware.

## What Was Added

### C# Backend Container

- Added a production Dockerfile at `client-app/Dockerfile`.
- The image builds the .NET 8 backend using the SDK image, then runs it with the smaller ASP.NET runtime image.
- Added `client-app/.dockerignore` so build output, logs, and local env files are not copied into the image.
- Added a backend health endpoint at:

```text
/health
```

### Backend Restart Automation

- Updated `network/docker-compose-main.yaml` so the backend runs as `blockgo-backend`.
- Added:

```yaml
restart: unless-stopped
```

- Added a Docker healthcheck that calls:

```text
http://127.0.0.1:5000/health
```

- Added `network/backend-autoheal.sh`.
- Added a `backend-autoheal` service in Docker Compose.
- The watchdog checks the `blockgo-backend` container every 15 seconds.
- If the backend container is stopped or unhealthy, it restarts it automatically.

### Middleware Containerization

- Updated `middleware/Dockerfile` so the middleware builds from the repo root.
- The middleware image now includes:
  - Node.js dependencies from `middleware/package-lock.json`
  - Python 3
  - Python packages required by `mapper.py`
  - The root `mapper.py` file
- Added `middleware/requirements.txt` for mapper dependencies:

```text
requests
ipfshttpclient
python-dotenv
cryptography
openpyxl
```

- Added a middleware healthcheck for:

```text
http://127.0.0.1:4000/api/health
```

### Middleware Runtime Fixes

- Updated `middleware/middleware.js` so Docker containers use Docker service names instead of incorrectly falling back to `127.0.0.1`.
- `POSTGRES_HOST=postgres` now works correctly inside the middleware container.
- Added support for `POSTGRES_WRITE_HOST`.

### Mapper Container Support

- Updated `mapper.py` so it can read container-friendly URLs from environment variables:

```text
CSHARP_API_URL=http://blockgo-backend:5000
IPFS_API_URL=/dns/ipfs0/tcp/5001/http
```

### Nginx Routing

- Updated `middleware/nginx/default.conf`.
- Nginx now routes main-campus traffic directly to Docker services:

```text
blockgo-backend:5000
middleware:4000
```

### Docker Ignore

- Added root `.dockerignore` to reduce Docker build context size and avoid copying generated blockchain/network data.

## Main Files Changed

```text
.dockerignore
client-app/.dockerignore
client-app/Dockerfile
client-app/Program.cs
mapper.py
middleware/Dockerfile
middleware/middleware.js
middleware/nginx/default.conf
middleware/requirements.txt
network/backend-autoheal.sh
network/docker-compose-main.yaml
```

## How To Run

From the `network` folder:

```powershell
docker compose -f docker-compose-main.yaml up -d --build middleware dotnet-container backend-autoheal nginx-shield-main
```

To check container health:

```powershell
docker ps
docker inspect blockgo-backend --format "{{json .State.Health}}"
docker inspect blockgo-middleware --format "{{json .State.Health}}"
```

To view auto-heal logs:

```powershell
docker logs -f blockgo-backend-autoheal
```

## Verification Completed

The following checks were run successfully:

```powershell
docker compose -f docker-compose-main.yaml config --quiet
docker compose -f docker-compose-main.yaml build middleware dotnet-container
docker run --rm blockgo-middleware:latest node --check /app/middleware.js
docker run --rm blockgo-middleware:latest python3 -m py_compile /mapper.py
```

## Notes

- The backend and middleware images both build successfully.
- Docker Compose may warn if required environment variables are missing, such as `POSTGRES_USER`, `POSTGRES_PASS`, `POSTGRES_DB`, `COUCHDB_USER`, `COUCHDB_PASS`, `JWT_SECRET`, and `INTERNAL_API_KEY`.
- Existing deleted crypto keystore files under `network/crypto-config-final-v2` were already present in git status and were not part of these Docker changes.
