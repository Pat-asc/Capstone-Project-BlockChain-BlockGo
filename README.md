# PLV Blockchain Grades Ledger (BlockGO)

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Status](https://img.shields.io/badge/Status-Production%20Ready-brightgreen)]()
[![Fabric Version](https://img.shields.io/badge/Hyperledger%20Fabric-v2.5.4-orange)]()

> A highly secure, enterprise-grade microservices-based grading ledger and identity management system built for Pamantasan ng Lungsod ng Valenzuela (PLV). This project seamlessly integrates traditional Web2 relational databases with cutting-edge blockchain technology using **Hyperledger Fabric**, providing immutable audit trails, transparent role-based access control, and cryptographic verification.

**Live Demo:** [BlockGO Portal](https://1b4f40ed.plv-blockgo-landing-dev-stage.pages.dev/)

---

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [System Architecture](#system-architecture--tech-stack)
- [User Roles & Workflows](#user-roles--workflows)
- [Technology Stack](#technology-stack)
- [Quick Start & Deployment](#quick-start--deployment-guide)
- [API Documentation](#api-documentation)
- [Security Highlights](#security-highlights)
- [Troubleshooting](#troubleshooting--helpful-commands)
- [Production Deployment](#production-deployment)
- [Contributing](#contributing)

---

## Overview

### The Problem
Traditional grading systems suffer from critical vulnerabilities:
- **Centralized data vulnerability** – Single point of failure
- **No immutable audit trails** – Grades can be altered retroactively
- **Limited transparency** – Stakeholders can't verify data integrity
- **Manual verification bottlenecks** – Slow approval workflows
- **No cryptographic proof** – Disputes difficult to resolve

### The Solution
**BlockGO** eliminates these issues by creating an **immutable, decentralized blockchain ledger** where:
- Grades are permanently recorded and cryptographically verified
- All transactions are transparent and auditable across organizations
- Role-based access ensures data security and privacy
- Distributed consensus prevents unauthorized modifications
- Automated workflows reduce approval time from days to minutes

---

## Key Features

| Feature | Description |
|---------|-------------|
| Immutable Ledger | Grades recorded on Hyperledger Fabric with cryptographic hashing |
| Identity Management | X.509 certificate-based authentication with role-based access control |
| Multi-Organization | 3 independent organizations (Registrar, Faculty, Department) with peer consensus |
| Rich Queries | CouchDB integration for complex grade analytics and reports |
| IPFS Storage | Distributed file system for encrypted grading sheets and documents |
| Microservices | Scalable architecture separating Web2 operations from Web3 blockchain logic |
| Kubernetes Ready | Production-grade K8s deployment with HPA, RBAC, and network policies |
| Enterprise Security | TLS 1.3, JWT auth, bcrypt hashing, ABAC, and full audit logging |
| Multi-User Dashboard | Tailored interfaces for Students, Faculty, Dept admins, and Registrar |
| Automated Workflows | Waitlist → Approval → Enrollment → Grade Issuance → Finalization |

---

## System Architecture & Tech Stack

This system utilizes a **clean separation of concerns**, splitting traditional database orchestration from cryptographic blockchain operations.

```
┌─────────────────────────────────────────────────────────────┐
│                    User Browsers (HTTPS)                     │
└────────────────────────┬────────────────────────────────────┘
                         │
        ┌────────────────▼────────────────┐
        │   Nginx Reverse Proxy (443)     │
        │   - Route /api/Auth/ → C#       │
        │   - Route /api/* → Node.js      │
        │   - Serve React Static Files    │
        └────────────┬──────────┬─────────┘
                     │          │
         ┌───────────▼─┐    ┌──▼──────────────┐
         │   Frontend  │    │  React Portal   │
         │  (Port 80)  │    │  Multi-Role UI  │
         └─────────────┘    └─────────────────┘
                     │          │
        ┌────────────┴──────────┴─────────────┐
        │     Internal Service Network        │
        └────┬─────────────────────────┬──────┘
             │                         │
    ┌────────▼──────┐        ┌────────▼──────────┐
    │  ASP.NET Core │        │  Node.js Bridge   │
    │   (Port 5000) │        │   (Port 4000)     │
    │               │        │                   │
    │ - PostgreSQL  │        │ - Fabric SDK      │
    │ - Waitlist    │        │ - Cryptography    │
    │ - Auth Logic  │        │ - JWT Generation  │
    └────────┬──────┘        └────────┬──────────┘
             │                        │
    ┌────────▼────────────────────────▼─────────────────┐
    │   Hyperledger Fabric Network (Docker/K8s)        │
    │                                                    │
    │  3 Organizations:                                 │
    │  - RegistrarMSP (Orderer + 2 Peers)              │
    │  - FacultyMSP (2 Peers + CouchDB)                │
    │  - DepartmentMSP (2 Peers + CouchDB)             │
    │                                                    │
    │  - Channel: grades-channel                        │
    │  - Chaincode: Go-based Smart Contract (CCaaS)    │
    │  - State DB: CouchDB for rich queries             │
    └─────────────────────────────────────────────────────┘
             │
    ┌────────▼──────────────────────┐
    │  Storage & Persistence         │
    │  - PostgreSQL (Activity Logs)  │
    │  - IPFS (Documents, Sheets)    │
    │  - CouchDB (Blockchain State)  │
    └───────────────────────────────┘
```

### 1. Frontend (React.js)
- **Purpose:** User interface for Students, Faculty, Department Admins (Dept admins), and the Registrar
- **Security:** Hosted behind Nginx Reverse Proxy with SSL/TLS encryption
- **Authentication:** JWT-based authorization with role-based dashboards
- **Performance:** Static file serving, SPA routing with React Router

### 2. Database Orchestrator (ASP.NET Core / C#)
- **Port:** 5000 (Internal)
- **Responsibility:** Standard Web2 operations
- **Database:** PostgreSQL (`ActivityLogs`, user profiles, organizational hierarchy)
- **Key Operations:**
  - User waitlist management
  - Department and section assignments
  - Account provisioning and deprovisioning
  - Coordinating with Node.js middleware for wallet creation
- **API Routes:** `/api/Auth/*` endpoints

### 3. Blockchain Bridge / Middleware (Node.js & Express)
- **Port:** 4000 (Internal)
- **Responsibility:** Web3 & Cryptography gateway
- **Integrations:**
  - Hyperledger Fabric SDK for chaincode interactions
  - X.509 certificate management via Fabric CA
  - JWT token generation and validation
  - bcrypt password hashing
  - CouchDB wallet management
- **Key Operations:**
  - Smart contract transaction submission/queries
  - User identity provisioning on blockchain
  - Cryptographic signature verification

### 4. Distributed Blockchain Network (Docker/Kubernetes)
- **Hyperledger Fabric v2.5.4** – 3 organizations with 2 peers each
- **Orderer:** Kafka-based consensus (RegistrarMSP)
- **State Database:** CouchDB for rich queries on grade records
- **Chaincode:** Go-based smart contract running as a Service (CCaaS)
- **Storage:** IPFS nodes for distributed file/asset storage
- **Networking:** Docker network (dev) or K8s services (production)

---

## Nginx Reverse Proxy Configuration

The Nginx container (`nginx-shield`) acts as the single entry point for all incoming HTTP traffic. It intelligently routes requests to the appropriate backend microservice and enforces modern TLS security standards.

**Configuration:** `middleware/nginx/nginx.conf`

```nginx
worker_processes 1;

events {
    worker_connections 1024;
}

http {
    # Service discovery via Docker DNS
    upstream client_app_backend { server client-app:5000; }
    upstream middleware_backend { server middleware:4000; }

    # HTTP → HTTPS redirect
    server {
        listen 80;
        server_name localhost;
        return 301 https://$host$request_uri;
    }

    # HTTPS server with modern TLS
    server {
        listen 443 ssl;
        server_name localhost;

        ssl_certificate /etc/nginx/ssl/localhost.crt;
        ssl_certificate_key /etc/nginx/ssl/localhost.key;

        # Security enhancements
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers 'TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384';
        ssl_prefer_server_ciphers off;

        # Route Web2 authentication to C#
        location /api/Auth/ {
            proxy_pass http://client_app_backend;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        # Route Web3 operations to Node.js
        location /api/ {
            proxy_pass http://middleware_backend;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        # Serve React SPA
        location / {
            root /usr/share/nginx/html;
            index index.html index.htm;
            try_files $uri $uri/ /index.html;
        }
    }
}
```

---

## User Roles & Workflows

### 1. The Registrar (Master Admin)
**Responsibilities:**
- Waitlist Management – Approves newly registered users (Students, Faculty, Staff)
- Department Admin Assignment – Routes approved admins to specific colleges
- Faculty Assignment – Routes approved faculty to departments/sections/year levels
- Student Assignment – Routes approved students to departments/sections
- Grade Finalization – Commits approved grades permanently to blockchain

### 2. Department Admin (Dept admin)
**Responsibilities:**
- Enrollment – Reviews students assigned by Registrar and officially enrolls them
- Grade Verification – Reviews faculty grades and approves them for Registrar finalization
- Department Reports – Views aggregate performance metrics and student records

### 3. Faculty
**Responsibilities:**
- Grade Issuance – Creates new grade records using `IssueGrade` smart contract
- Limited Visibility – Sees only their issued grades and department-related records
- Grade Management – Can modify unfinalized grades before Dept admin approval

### 4. Student
**Responsibilities:**
- View Grades – Has strictly limited access to view only finalized grades
- Receive Notifications – Alerts when grades are issued and finalized

---

## Technology Stack

### Frontend
- **Framework:** React.js (SPA with Router)
- **Communication:** Axios with JWT interceptors
- **UI/UX:** Responsive design, role-based dashboards
- **State Management:** React Context API / Redux

### Backend
| Component | Stack |
|-----------|-------|
| **Web2 Orchestrator** | ASP.NET Core 8.0, C#, Entity Framework |
| **Web3 Bridge** | Node.js, Express.js, Hyperledger Fabric SDK |
| **Databases** | PostgreSQL (relational), CouchDB (state), IPFS (distributed) |

### Blockchain & Cryptography
- **Framework:** Hyperledger Fabric v2.5.4
- **Chaincode:** Go Language (CCaaS)
- **PKI:** X.509 certificates, Fabric Certificate Authority
- **Hashing:** bcrypt (passwords), SHA-256 (transactions)
- **Authentication:** JWT (stateless), mTLS (service-to-service)

### DevOps & Infrastructure
- **Containerization:** Docker, Docker Compose
- **Orchestration:** Kubernetes v1.24+, Helm (optional)
- **Networking:** Nginx reverse proxy, Docker DNS, K8s ingress
- **Monitoring:** Kubernetes native (kubectl logs, metrics-server)

---

## Quick Start & Deployment Guide

### Prerequisites
- **OS:** Ubuntu/Debian (or WSL2 on Windows)
- **Container Runtime:** Docker & Docker Compose (v20+)
- **Runtime Environments:** Node.js (v20+), .NET 8.0 SDK
- **CLI Tools:** kubectl (if deploying to Kubernetes)
- **Resources:** 8GB+ RAM, 20GB+ disk space
### WARNING: THIS IS ONLY FOR TESTING( QA AND DEVS ONLY HAVE ACCESS.)
### Step 1: Clone & Navigate
```bash
git clone https://github.com/Pat-asc/Capstone-Project-BlockChain-BlockGo.git
cd Capstone-Project-BlockChain-BlockGo
```

### Step 2: Configure Environment
Create `network/.env` with required secrets:
```bash
cd network
cat > .env << 'EOF'
JWT_SECRET=your-super-secret-jwt-key-min-32-chars
INTERNAL_API_KEY=your-internal-api-key-for-service-auth
POSTGRES_PASS=secure-postgres-password-here
BOOTSTRAP_REGISTRAR_PASS=fabric-ca-admin-password
IPFS_ENCRYPTION_KEY=32character-encryption-key!
MOCK_REGISTRAR_PASS=initial-registrar-login-password
EOF
chmod 600 .env
```

### Step 3: Deploy the Network
```bash
chmod +x full_deploy.sh
./full_deploy.sh
```

This script will:
- Install dependencies (Node.js packages, .NET assemblies)
- Generate secure X.509 certificates
- Build Hyperledger Fabric network (3 orgs, 2 peers each)
- Start all Docker containers
- Initialize the blockchain channel

**Expected output:**
```
OK Network deployed successfully!
OK Fabric channel 'grades-channel' created
OK Chaincode installed and instantiated
OK Services running on:
   - Frontend: http://localhost
   - API: http://localhost/api
   - Middleware: http://localhost:4000 (internal)
```

### Step 4: Bootstrap Root Registrar

Because the system has a strict waitlist (to prevent unauthorized admin creation), the initial Registrar must be bootstrapped:

```bash
curl -X GET http://localhost/api/bootstrap \
  -H "x-api-key: $INTERNAL_API_KEY"
```

**Response:**
```json
{
  "success": true,
  "message": "Registrar bootstrapped successfully",
  "user": "registrar@plv.edu.ph"
}
```

### Step 5: Access the Portal
Navigate to **http://localhost** in your browser and log in:

| Field | Value |
|-------|-------|
| **Email** | `registrar@plv.edu.ph` |
| **Password** | [Your `MOCK_REGISTRAR_PASS` from `.env`] |

**Success!** You now have full access to the BlockGO system.

---

## API Documentation

### Authentication Flow

#### 1. Register User
```bash
POST /api/Auth/request
Content-Type: application/json

{
  "email": "student@plv.edu.ph",
  "fullName": "Juan Dela Cruz",
  "role": "STUDENT"
}
```

**Response:**
```json
{
  "id": "uuid-123",
  "email": "student@plv.edu.ph",
  "status": "PENDING",
  "createdAt": "2026-06-08T10:00:00Z"
}
```

#### 2. Registrar Approves User
```bash
PUT /api/Auth/requests/{id}/approve
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json

{
  "departmentId": "dept-123",
  "sectionId": "section-456"
}
```

**Workflow Behind the Scenes:**
1. ASP.NET Core updates PostgreSQL status to `APPROVED`
2. C# calls Node.js `/api/fabric/register-user`
3. Node.js registers user with Fabric CA
4. Certificate downloaded and saved to wallet
5. User can now authenticate and access blockchain

### Grade Management

#### Issue Grade (Faculty)
```bash
POST /api/grades/issue
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json

{
  "studentId": "student-123",
  "courseId": "course-789",
  "grade": "1.5",
  "semester": "2nd",
  "academicYear": "2025-2026"
}
```

#### Approve Grade (Dept admin)
```bash
PUT /api/grades/{gradeId}/approve
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json

{
  "approved": true,
  "remarks": "Grade verified against rubric"
}
```

#### Finalize Grade (Registrar)
```bash
PUT /api/grades/{gradeId}/finalize
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json
```

**Response:** Grade is now immutable on blockchain

---

## Security Highlights

### Authentication & Authorization
- JWT-based stateless authentication
- Role-Based Access Control (RBAC) at API level
- Attribute-Based Access Control (ABAC) for fine-grained permissions
- X.509 certificate validation for Fabric interactions

### Data Protection
- TLS 1.3 encryption in transit
- AES-256 encryption for IPFS stored files
- bcrypt password hashing (salt + rounds)
- Immutable blockchain ledger (cryptographic hashing)

### Network Security
- Nginx reverse proxy with WAF capabilities
- mTLS between microservices
- Network segmentation (Docker bridge / K8s network policies)
- API key authentication for internal service-to-service calls

### Auditing & Compliance
- Complete transaction audit trail on blockchain
- PostgreSQL activity logs with timestamps
- User action logging (who, what, when)
- Regulatory compliance ready (FERPA, GDPR)

---

## Directory Structure

```
Capstone-Project-BlockChain-BlockGo/
│
├── README.md                        # This file
├── Guide.md                         # Detailed System Architecture & DFDs
│
├── chaincode/                       # Hyperledger Fabric Smart Contract
│   ├── grades.go                    # Main chaincode logic
│   ├── models.go                    # Data structures
│   └── go.mod                       # Dependencies
│
├── client-app/                      # C# ASP.NET Core Backend
│   ├── Controllers/
│   │   ├── AuthController.cs        # Authentication & waitlist
│   │   ├── GradesController.cs      # Grade operations
│   │   └── AdminController.cs       # Admin functions
│   ├── Models/                      # Entity models
│   ├── Services/                    # Business logic
│   ├── appsettings.json            # Configuration & DB connection
│   └── Startup.cs                   # DI & middleware setup
│
├── frontend/                        # React.js UI Portal
│   ├── public/
│   │   └── index.html
│   ├── src/
│   │   ├── components/
│   │   │   ├── Dashboard.jsx
│   │   │   ├── LoginForm.jsx
│   │   │   ├── GradesList.jsx
│   │   │   └── AdminPanel.jsx
│   │   ├── pages/
│   │   ├── api.js                  # Axios API wrapper
│   │   ├── App.jsx
│   │   └── index.js
│   ├── package.json
│   └── .env.example
│
├── middleware/                      # Node.js Blockchain Bridge
│   ├── middleware.js                # Express app & API routes
│   ├── enrollAdmin.js              # Admin enrollment logic
│   ├── fabricInteraction.js         # Fabric SDK integration
│   ├── cryptoUtils.js              # Hashing, JWT generation
│   ├── walletManager.js            # CouchDB wallet operations
│   ├── nginx/
│   │   ├── nginx.conf              # Reverse proxy configuration
│   │   └── ssl/                    # SSL certificates
│   ├── package.json
│   └── middleware.log              # Runtime logs
│
├── network/                         # Deployment & Configuration
│   ├── docker-compose.yml          # Complete container orchestration
│   ├── full_deploy.sh              # Automated deployment script
│   ├── cleanup.ps1                 # Environment reset utility
│   ├── backup_postgres.sh          # Database backup script
│   │
│   ├── crypto-config/              # X.509 certificates (auto-generated)
│   │   ├── ordererOrganizations/
│   │   └── peerOrganizations/
│   │
│   ├── fabric-ca/                  # Certificate Authority configs
│   │   ├── registrar-ca/
│   │   ├── faculty-ca/
│   │   └── department-ca/
│   │
│   ├── channel-artifacts/          # Genesis & channel configs
│   │   ├── genesis.block
│   │   └── grades-channel.tx
│   │
│   └── k8s/                        # Kubernetes deployment files
│       ├── 01-namespace.yaml
│       ├── 02-configmap-secret.yaml
│       ├── 03-postgres.yaml
│       ├── 04-fabric-ca.yaml
│       ├── 05-fabric-peer.yaml
│       ├── 06-middleware-api.yaml
│       ├── 07-ipfs.yaml
│       ├── 08-ingress.yaml
│       ├── init-channel.sh
│       ├── install-chaincode.sh
│       └── README.md               # K8s deployment guide
│
├── .gitignore
├── .env.example                    # Environment template
└── LICENSE
```

---

## API Flow Example (Registration & Approval Workflow)

```
┌──────────────────────────────────────────────────────────────┐
│              Complete Registration Flow                       │
└──────────────────────────────────────────────────────────────┘

1. SIGNUP REQUEST
   ┌─────────────────────────────────────────────────────┐
   │ Student opens React app → Fills registration form   │
   │ Frontend: POST /api/Auth/request                    │
   └─────────────────────────────────────────────────────┘
          ↓
   ┌─────────────────────────────────────────────────────┐
   │ Nginx routes /api/Auth/* → ASP.NET Core (5000)      │
   └─────────────────────────────────────────────────────┘
          ↓
   ┌─────────────────────────────────────────────────────┐
   │ C# calls Node.js POST /api/crypto/hash-password    │
   │ Node.js computes bcrypt hash, returns to C#         │
   └─────────────────────────────────────────────────────┘
          ↓
   ┌─────────────────────────────────────────────────────┐
   │ C# saves user to PostgreSQL with status=PENDING    │
   │ User appears in Registrar's waitlist               │
   └─────────────────────────────────────────────────────┘

2. REGISTRAR APPROVAL
   ┌─────────────────────────────────────────────────────┐
   │ Registrar reviews pending users in dashboard       │
   │ Clicks "Approve" on student record                 │
   │ Frontend: PUT /api/Auth/requests/{id}/approve      │
   └─────────────────────────────────────────────────────┘
          ↓
   ┌─────────────────────────────────────────────────────┐
   │ Nginx routes → C# Backend updates PostgreSQL       │
   │ Status: PENDING → APPROVED                         │
   └─────────────────────────────────────────────────────┘
          ↓
   ┌─────────────────────────────────────────────────────┐
   │ C# sends POST to Node.js: /api/fabric/register-user│
   └─────────────────────────────────────────────────────┘
          ↓
   ┌─────────────────────────────────────────────────────┐
   │ Node.js uses Fabric SDK to:                        │
   │ - Contact ca.registrar.capstone.com (Fabric CA)   │
   │ - Register user and get X.509 certificate         │
   │ - Download certificate + private key              │
   │ - Save to local /wallet (CouchDB)                 │
   └─────────────────────────────────────────────────────┘
          ↓
   ┌─────────────────────────────────────────────────────┐
   │ C# sends welcome email to student                 │
   │ Student can now log in with registered credentials │
   └─────────────────────────────────────────────────────┘

3. USER LOGIN & BLOCKCHAIN ACCESS
   ┌─────────────────────────────────────────────────────┐
   │ Student logs in with email + password             │
   │ Frontend: POST /api/Auth/login                    │
   └─────────────────────────────────────────────────────┘
          ↓
   ┌─────────────────────────────────────────────────────┐
   │ C# validates credentials against PostgreSQL        │
   │ If valid, calls Node.js: /api/crypto/generate-jwt │
   │ Node.js returns signed JWT token                  │
   └─────────────────────────────────────────────────────┘
          ↓
   ┌─────────────────────────────────────────────────────┐
   │ Frontend stores JWT in localStorage                │
   │ All subsequent API calls include JWT header        │
   │ Authorization: Bearer <JWT_TOKEN>                 │
   └─────────────────────────────────────────────────────┘
          ↓
   ┌─────────────────────────────────────────────────────┐
   │ Student can now query grades from blockchain       │
   │ Node.js retrieves from Fabric ledger via CouchDB   │
   │ Only returns grades student is authorized to see   │
   └─────────────────────────────────────────────────────┘
```

---

## Troubleshooting & Helpful Commands

### Check Service Status
```bash
# View all running containers
docker ps -a

# Check Fabric network status
docker compose -f network/docker-compose.yml ps

# View specific service logs
docker logs blockgo-middleware -f
docker logs blockgo-postgres -f
docker logs blockgo-orderer -f
```

### View Detailed Logs

**Node.js Middleware:**
```bash
cd middleware
tail -f middleware.log
```

**C# Backend (Serilog):**
```bash
cd client-app
ls -la logs/
tail -f logs/*.txt
```

**Fabric Chaincode Container:**
```bash
docker logs registrar-chaincode -f
```

### Common Issues & Solutions

#### Port 80/443 Already in Use
```bash
# Find process using port
sudo lsof -i :80
sudo lsof -i :443

# Kill process
sudo kill -9 <PID>
```

#### Fabric Channel Creation Failed
```bash
# Restart network with clean state
cd network
./cleanup.ps1  # or bash cleanup.sh on Linux
./full_deploy.sh
```

#### Postgres Connection Error
```bash
# Verify PostgreSQL is running
docker logs blockgo-postgres

# Check credentials in appsettings.json
cat client-app/appsettings.json | grep ConnectionString

# Manually test connection
psql -h localhost -U BLOCKGO -d ActivityLogs
```

#### React Frontend Not Updating
```bash
# Restart Nginx proxy
docker compose restart nginx-shield

# Clear browser cache
# Or hard refresh: Ctrl+Shift+R (or Cmd+Shift+R on Mac)
```

#### Wallet/Certificate Missing
```bash
# Check wallet directory
ls -la middleware/wallet/

# Re-enroll admin
cd middleware && node enrollAdmin.js

# Verify Fabric CA is running
docker logs fabric-ca
```

### Database Backup & Recovery

**Create Backup:**
```bash
cd network
chmod +x backup_postgres.sh
./backup_postgres.sh
# Creates: backups/db_backup_YYYY-MM-DD_HH-MM-SS.sql
```

**Restore Backup:**
```bash
docker compose exec blockgo-postgres psql -U BLOCKGO -d ActivityLogs < backups/db_backup_latest.sql
```

### Performance Monitoring

```bash
# CPU/Memory usage
docker stats

# Fabric peer metrics
docker exec blockgo-peer0 peer node status

# Channel info
docker exec blockgo-peer0 peer channel getinfo -c grades-channel
```

---

## Production Deployment

### Kubernetes Deployment

#### Prerequisites
- Kubernetes cluster (v1.24+)
- `kubectl` configured and connected
- Helm (optional, for package management)
- 4+ CPU cores, 16GB+ RAM

#### Deploy to K8s
```bash
cd network/k8s

# Create namespaces
kubectl apply -f 01-namespace.yaml

# Deploy secrets & configs
kubectl apply -f 02-configmap-secret.yaml

# Deploy infrastructure
kubectl apply -f 03-postgres.yaml
kubectl apply -f 04-fabric-ca.yaml
kubectl apply -f 05-fabric-peer.yaml
kubectl apply -f 06-middleware-api.yaml
kubectl apply -f 07-ipfs.yaml
kubectl apply -f 08-ingress.yaml

# Initialize Fabric channel
./init-channel.sh

# Install & instantiate chaincode
./install-chaincode.sh
```

#### Verify Deployment
```bash
# Check all pods
kubectl get pods --all-namespaces

# View service endpoints
kubectl get svc --all-namespaces

# Monitor logs
kubectl logs -f deployment/plv-middleware -n plv-fabric
```

### Security Hardening (Production)

1. **Secrets Management**
   - Use HashiCorp Vault instead of K8s Secrets
   - Rotate credentials regularly
   - Enable encryption at rest (etcd encryption)

2. **Network Security**
   - Enable network policies (deny-all by default)
   - Restrict ingress to necessary ports only
   - Use service mesh (Istio/Linkerd) for mTLS

3. **Monitoring & Logging**
   - Deploy Prometheus + Grafana for metrics
   - Setup ELK stack (Elasticsearch, Logstash, Kibana) for centralized logging
   - Enable audit logging for all blockchain transactions

4. **High Availability**
   - Deploy Fabric orderers as StatefulSet with 3+ replicas
   - Configure peer anti-affinity rules
   - Setup database replication (PostgreSQL streaming replication)
   - Use PodDisruptionBudgets for graceful scaling

5. **Backup & Disaster Recovery**
   - Automated daily backups to cloud storage (S3, GCS, etc.)
   - Test recovery procedures monthly
   - Document RTO (Recovery Time Objective) & RPO (Recovery Point Objective)

---

## Contributing

We welcome contributions! Please follow these guidelines:

1. **Fork** the repository
2. **Create feature branch:** `git checkout -b feature/amazing-feature`
3. **Commit changes:** `git commit -m 'Add amazing feature'`
4. **Push to branch:** `git push origin feature/amazing-feature`
5. **Open Pull Request** with detailed description

### Development Setup
```bash
# Install dependencies
cd frontend && npm install
cd ../client-app && dotnet restore
cd ../middleware && npm install
```

### Running Tests
```bash
# Backend tests
cd client-app && dotnet test

# Chaincode tests
cd chaincode && go test ./...

# Frontend tests
cd frontend && npm test
```

---

## License

This project is licensed under the MIT License – see [LICENSE](LICENSE) file for details.

---

## Support & Resources

- **Documentation:** See [Guide.md](./Guide.md) for detailed architecture
- **Report Issues:** [GitHub Issues](https://github.com/Pat-asc/Capstone-Project-BlockChain-BlockGo/issues)
- **Discussions:** [GitHub Discussions](https://github.com/Pat-asc/Capstone-Project-BlockChain-BlockGo/discussions)
- **Email:** [pascualpatrick264@gmail.com](mailto:pascualpatrick264@gmail.com)

---

## Acknowledgments

- **Pamantasan ng Lungsod ng Valenzuela (PLV)** – Institution Partner
- **Hyperledger Fabric** – Blockchain Framework
- **The Open Source Community** – For amazing tools and libraries

---

**Last Updated:** June 8, 2026  
**Status:** Production Ready  
**Version:** 1.0.0

Project architecture designed and maintained for robust security, immutable auditing, and strict attribute-based access control (ABAC).
