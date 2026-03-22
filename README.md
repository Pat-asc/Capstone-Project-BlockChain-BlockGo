# PLV Blockchain Grades Ledger 🎓🔗

A highly secure, microservices-based grading ledger and identity management system built for Pamantasan ng Lungsod ng Valenzuela (PLV). This project integrates traditional Web2 relational databases with Web3 Hyperledger Fabric blockchain technology to ensure absolute immutability, transparency, and security of student records.

---

## 🏗️ System Architecture & Tech Stack

This system utilizes a clean separation of concerns, splitting standard database orchestration from cryptographic blockchain operations.

### 1. Frontend (React.js)
- Serves as the user interface for Students, Faculty, Department Admins (Deans), and the Registrar.
- Hosted securely behind an **Nginx Reverse Proxy** (Port 80), eliminating the need for users to specify ports.
- Communicates with backends via JWT authorization.

### 2. Database Orchestrator (ASP.NET Core / C#)
- **Port:** 5000 (Internal)
- **Role:** Standard Web2 operations.
- Manages the **PostgreSQL** relational database (`ActivityLogs`).
- Handles the user waitlist, profile data, and organizational assignments (Departments, Sections, Year Levels).
- Uses an internal `HttpClient` to ping the Node.js middleware for secure hashing and blockchain wallet creation.

### 3. Blockchain Bridge / Middleware (Node.js & Express)
- **Port:** 4000 (Internal)
- **Role:** Web3 & Cryptography gateway.
- Integrates the **Hyperledger Fabric SDK**.
- Manages X.509 Cryptographic Certificates, JWT generation, and bcrypt password hashing.
- Submits and queries smart contract (Chaincode) transactions on the Fabric Ledger.

### 4. Distributed Network (Docker)
- **Hyperledger Fabric (v2.5.4):** 3 Organizations (RegistrarMSP, FacultyMSP, DepartmentMSP) with 2 Peers each.
- **State Database:** CouchDB for rich queries.
- **Chaincode:** Go-based Smart Contract running as a Service (CCaaS).
- **Storage:** IPFS (InterPlanetary File System) nodes for distributed file/asset storage.

---

## 👥 User Roles & Workflows

### 1. The Registrar (Master Admin)
- **Waitlist Management:** Approves newly registered users (Students, Faculty, and Staff).
- **Assignment:** Assigns approved Department Admins to specific colleges (e.g., CS, IT) and assigns approved Faculty to specific departments, sections, and year levels.
- **Assignments (Students):** Routes approved students to a specific Department and Section.
- **Ledger:** Finalizes grades and commits them permanently to the blockchain.

### 2. Department Admin (Dean)
- **Enrollment:** Reviews students assigned to their department by the Registrar and officially "Enrolls" them.
- **Grade Verification:** Reviews grades issued by faculty members within their department and "Approves" them for Registrar finalization.

### 3. Faculty
- **Grade Issuance:** Creates new grade records on the blockchain using the `IssueGrade` smart contract function.
- **Visibility:** Can only view grades they personally issued, or grades related to their specific department assignments.

### 4. Student
- **Visibility:** Has strictly limited access. Can only view their own finalized grades.

---

## 🚀 Quick Start & Deployment Guide

### Prerequisites
- Ubuntu/Debian (or WSL2 on Windows)
- Docker & Docker Compose
- Node.js (v20+)
- .NET 8.0 SDK

### Step 1: Deploy the Network
Navigate to the `network` directory and run the automated deployment script. This script installs dependencies, generates secure passwords, builds the blockchain network, and starts both backend servers and the frontend.

```bash
cd network
chmod +x full_deploy.sh
./full_deploy.sh
```

### Step 2: Bootstrap the Root Registrar
Because the system utilizes a strict waitlist, a "Catch-22" exists where you need an admin to approve an admin. To bypass this for the initial setup, navigate to the bootstrap endpoint in your browser:

👉 **http://localhost/api/bootstrap**

*This will securely inject `registrar@plv.edu.ph` into PostgreSQL and instantly generate their Hyperledger Fabric wallet.*

### Step 3: Access the Portal
Navigate to **http://localhost** in your browser.
Log in using the bootstrapped credentials:
- **Email:** `registrar@plv.edu.ph`
- **Password:** `admin123`

---

## 📂 Directory Structure

```text
Capstone-Project/
├── chaincode/               # Go Smart Contract (CCaaS)
├── client-app/              # C# ASP.NET Core Backend (PostgreSQL Logic)
│   ├── Controllers/         # AuthController.cs (Assignments & Waitlist)
│   └── appsettings.json     # DB Connections & Smtp Config
├── frontend/                # React.js UI
│   ├── src/
│   │   ├── api.js           # API Wrapper (Handles routing & JWTs)
│   │   └── GradesDashboard.jsx # Main Dashboard UI
├── middleware/              # Node.js Backend (Fabric Bridge)
│   ├── middleware.js        # Express API (Fabric SDK, Bcrypt, JWT)
│   └── nginx/               # Nginx Reverse Proxy Configurations
└── network/                 # Docker Compose & Fabric Configs
    ├── crypto-config/       # Auto-generated X.509 certificates
    ├── fabric-ca/           # Certificate Authority Configs
    ├── channel-artifacts/   # Genesis block & channel transactions
    └── full_deploy.sh       # Master startup script
```

---

## 🔄 API Flow Example (Registration & Approval)

1. **Signup Request:**
   - Frontend (`React`) sends POST to `/api/Auth/request`.
   - Nginx routes `/api/Auth/*` to **C# (Port 5000)**.
   - C# pauses, sends POST to **Node.js (Port 4000)** `/api/crypto/hash-password`.
   - Node.js returns the `bcrypt` hash.
   - C# saves the user to PostgreSQL with status `pending`.

2. **Approval:**
   - Registrar clicks "Approve".
   - Frontend sends PUT to `/api/Auth/requests/approve/...`.
   - C# updates PostgreSQL status to `APPROVED`.
   - C# sends internal POST to **Node.js (Port 4000)** `/api/fabric/register-user`.
   - Node.js registers the user with `ca.registrar.capstone.com`, downloads their certificate, and saves it to the local `/wallet`.

---

## 🛠️ Troubleshooting & Helpful Commands

**View Node.js Middleware Logs:**
```bash
cd middleware
cat middleware.log
```

**View C# Backend Logs:**
```bash
cd client-app
cat backend.log
# Or view Serilog text files in client-app/logs/
```

**Restart Nginx Proxy (If React isn't updating):**
```bash
cd network
docker compose restart nginx-shield
```

**Database Backup:**
```bash
cd network
./backup_postgres.sh
```

**Check Chaincode Container:**
```bash
docker logs registrar-chaincode
```

---

*Project architecture designed and maintained for robust security, immutable auditing, and strict attribute-based access control (ABAC).*