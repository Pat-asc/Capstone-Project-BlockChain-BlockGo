# PLV Grades Ledger: System Architecture & Data Flow Guide

This document provides a comprehensive overview of the system's architecture, data flows, and operational sequences. It is designed to serve as a technical reference and a presentation aid.

## 1. The Core Concept: A Hybrid Web2/Web3 Architecture

To explain the dual-database approach, we use the **"Bank Lobby vs. The Bank Vault"** analogy.

> "Our system operates like a highly secure, modern bank.
>
> The **Web2 services (C# & PostgreSQL)** act as the **Bank Lobby**. This is where we handle high-volume, everyday operations. It's fast, efficient, and flexible. We use it for managing user profiles, handling registration waitlists, and assigning roles—tasks that require frequent updates or potential deletion to comply with data privacy laws. Just like a bank lobby, it's the public-facing and operational hub.
>
> The **Web3 services (Node.js & Hyperledger Fabric)** function as the **Bank Vault**. The vault is not for everyday transactions; it's for securing the most critical, high-value assets that must never be altered. In our system, these assets are the finalized student grades. Once a grade is placed in the blockchain vault, it is cryptographically sealed, decentralized, and permanent, providing an immutable and auditable record for all time."

---

## 2. High-Level System Architecture

The system is a collection of microservices that work in concert, each with a specific responsibility, ensuring a clean separation of concerns.

```mermaid
graph TD
    subgraph User
        U[<fa:fa-user> User Browser]
    end

    subgraph "DMZ (Public Facing)"
        NG[<fa:fa-shield-alt> Nginx Reverse Proxy <br> Port 80/443]
    end

    subgraph "Web2 Services (The Lobby)"
        CS["<fa:fa-server> C# ASP.NET Backend <br> Port 5000"]
        PG["<fa:fa-database> PostgreSQL DB <br> User Profiles, Waitlist"]
    end

    subgraph "Web3 Services (The Vault)"
        NODE["<fa:fa-cogs> Node.js Bridge <br> Port 4000 <br> Fabric SDK, JWT, Bcrypt"]
        subgraph "Hyperledger Fabric Network"
            direction LR
            PEER_R[<fa:fa-cube> Registrar Peer]
            PEER_F[<fa:fa-cube> Faculty Peer]
            PEER_D[<fa:fa-cube> Dept. Peer]
            CC["<fa:fa-file-code> Go Chaincode <br> CCaaS"]
            ORD[<fa:fa-sitemap> Orderer]
        end
        WALLET["<fa:fa-wallet> CouchDB Wallet <br> Stores X.509 Identities"]
    end

    subgraph "Frontend Application"
        FE["<fa:fa-window-maximize> React Frontend Build"]
    end


    U --> NG
    NG -- "/ (React App)" --> FE
    NG -- "/api/Auth/*" --> CS
    NG -- "/api/*" --> NODE

    CS -- "Manages Users" --> PG
    CS -- "Requests Hashing/Wallet Creation" --> NODE

    NODE -- "Manages Identities" --> WALLET
    NODE -- "Submits/Queries Transactions" --> PEER_R
    NODE -- "Submits/Queries Transactions" --> PEER_F
    NODE -- "Submits/Queries Transactions" --> PEER_D
    
    PEER_R -- "Invokes" --> CC
    PEER_F -- "Invokes" --> CC
    PEER_D -- "Invokes" --> CC
    CC -- "Reads/Writes State" --> LEDGER["<fa:fa-database> CouchDB State DB"]
    
    PEER_R -- "Sends Blocks" --> ORD
    PEER_F -- "Sends Blocks" --> ORD
    PEER_D -- "Sends Blocks" --> ORD
    ORD -- "Orders Blocks" --> PEER_R
    ORD -- "Orders Blocks" --> PEER_F
    ORD -- "Orders Blocks" --> PEER_D

    style U fill:#f9f,stroke:#333,stroke-width:2px
    style NG fill:#bbf,stroke:#333,stroke-width:2px
    style CS fill:#9f9,stroke:#333,stroke-width:2px
    style NODE fill:#f99,stroke:#333,stroke-width:2px
```

---

## 3. Data Flow Diagrams (DFD)

### DFD Level 0 (Context Diagram)

This diagram shows the entire system as a single process and its interactions with external user roles, arranged for clarity.
 
```mermaid
graph LR
    subgraph "External Entities"
        E1[<fa:fa-user-tie> Registrar]
        E3[<fa:fa-chalkboard-teacher> Faculty]
        E4[<fa:fa-user-shield> Dept. Admin]
        E2[<fa:fa-user-graduate> Student]
    end

    P0("PLV Grades<br>Ledger System")

    E2 -- "Registration & Login" --> P0
    P0 -- "View Own Grades" --> E2

    E1 -- "Manages Waitlist & Users" --> P0
    P0 -- "Finalized Grade Reports" --> E1

    E3 -- "Issue Grades" --> P0
    P0 -- "View Issued Grades" --> E3

    E4 -- "Approve Grades" --> P0
    P0 -- "View Department Grades" --> E4

    style P0 fill:#dae,stroke:#333,stroke-width:4px,stroke-dasharray: 5 5
```

### DFD Level 1

This diagram decomposes the system into its core functional processes, illustrating how data flows between them to fulfill key requirements like user onboarding, authentication, and grade management.

```mermaid
graph TD
    subgraph "External Entities"
        U[<fa:fa-user> User]
    end
 
    subgraph "System Processes"
        P1("1.0<br>Frontend UI")
 
        subgraph "2.0 User & Profile Management (C#)"
            P2_1("2.1<br>Handle Waitlist")
            P2_2("2.2<br>Manage Profiles & Roles")
        end
 
        subgraph "3.0 Blockchain & Crypto Operations (Node.js)"
            P3_1("3.1<br>Authenticate & Issue JWT")
            P3_2("3.2<br>Manage Blockchain Identities")
            P3_3("3.3<br>Process Grade Transactions")
        end
    end
 
    subgraph "Data Stores"
        D1["<fa:fa-database> D1: User Profiles & Waitlist<br>(PostgreSQL)"]
        D2["<fa:fa-link> D2: Grades Ledger<br>(Hyperledger Fabric)"]
        D3["<fa:fa-wallet> D3: Crypto Identities<br>(CouchDB Wallet)"]
    end
 
    %% --- Data Flows ---
    U -- "Registration, Login, Grade Actions" --> P1
    P1 -- "Dashboards, Forms, Status Updates" --> U
    P1 -- "API: Registration Request" --> P2_1
    P1 -- "API: Approve/Assign User, View Profiles" --> P2_2
    P1 -- "API: Login, Grade Actions, View Grades" --> P3_1 & P3_3
    P2_1 & P2_2 -- "Profile & Waitlist Data" --> P1
    P3_1 & P3_3 -- "JWT, Grade Data, Tx Status" --> P1
    P2_1 -- "Write Pending User" --> D1
    P2_2 -- "Read/Write User Profiles & Roles" --> D1
    P2_2 -- "Internal Request: Create Wallet" --> P3_2
    P3_1 -- "Read Password Hash & Role" --> D1
    P3_1 -- "Verify Wallet Identity Exists" --> D3
    P3_2 -- "Write New Identity to Wallet" --> D3
    P3_3 -- "Submit/Query Transactions" --> D2
```

---

## 4. Sequence Diagrams

### User Registration & Onboarding
This sequence shows how a user moves from the "Web2 Waitlist" to getting a "Web3 Blockchain Identity".

```mermaid
sequenceDiagram
    autonumber
    actor U as New User
    participant UI as React Frontend
    participant C as C# Backend (Lobby)
    participant DB as PostgreSQL
    participant N as Node.js Bridge (Vault)
    participant CA as Fabric CA

    Note over U,CA: Phase 1: The Waitlist (Web2)
    U->>UI: Submits Registration Form
    UI->>C: POST /api/Auth/request
    C->>N: POST /api/crypto/hash-password
    N-->>C: Returns bcrypt Hash
    C->>DB: INSERT User with status 'Pending'
    DB-->>C: Confirm Save
    C-->>UI: "Request sent, pending approval"

    Note over U,CA: Phase 2: Approval & Web3 Bridge
    actor A as Registrar
    A->>UI: Clicks "Approve" on user
    UI->>C: PUT /api/Auth/requests/approve
    C->>DB: UPDATE User status to 'APPROVED'
    C->>N: Internal POST /api/fabric/register-user
    N->>CA: Register Identity with random secret
    N->>CA: Enroll Identity to get certificate
    CA-->>N: Issue X.509 Cryptographic Certificate
    N->>N: Store encrypted identity in CouchDB Wallet
    N-->>C: "Blockchain Wallet Created"
    C-->>UI: 200 OK (User successfully onboarded)
```

### User Login
This sequence shows how a user authenticates and receives a JWT token for accessing the system.

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant UI as React Frontend
    participant N as Node.js Bridge
    participant DB as PostgreSQL
    participant W as CouchDB Wallet

    U->>UI: Enters email and password, clicks Login
    UI->>N: POST /api/login with credentials
    N->>DB: SELECT * FROM Users WHERE email = ?
    DB-->>N: Returns user record (incl. password hash)
    N->>N: Compares provided password with stored hash using bcrypt
    alt Password is Valid
        N->>W: Check if identity exists for email
        W-->>N: Identity exists
        N->>N: Generate JWT Token with user roles (MSP ID)
        N-->>UI: 200 OK with JWT Token
        UI->>U: Login successful, store token
    else Password is Invalid
        N-->>UI: 401 Unauthorized
        UI->>U: "Invalid credentials"
    end
```

### The Grade Lifecycle
This diagram shows the strict, role-based approval flow for grades, from issuance to permanent finalization on the ledger.

```mermaid
sequenceDiagram
    autonumber
    actor F as Faculty
    participant UI as React Frontend
    participant N as Node.js (Fabric SDK)
    participant HLF as Hyperledger Fabric Ledger
    actor D as Dept Admin
    actor R as Registrar

    Note over F,HLF: Phase 1: Issuance
    F->>UI: Fills out "Issue Grade" Form
    UI->>N: POST /api/issue-grade (with Faculty JWT)
    N->>HLF: submitTransaction('IssueGrade', ...)
    HLF->>HLF: Smart contract verifies caller has 'FacultyMSP' role
    HLF-->>N: Transaction successful, Grade status: 'Issued'
    N-->>UI: "Grade Recorded"

    Note over D,HLF: Phase 2: Department Verification
    D->>UI: Reviews Pending Grades for their department
    UI->>N: POST /api/approve-grade/:id (with Dept. Admin JWT)
    N->>HLF: submitTransaction('ApproveGrade', ... )
    HLF->>HLF: Smart contract verifies caller has 'DepartmentMSP' role
    HLF-->>N: Transaction successful, Grade status: 'DepartmentApproved'
    N-->>UI: "Grade Verified by Dean"

    Note over R,HLF: Phase 3: Finalization & Locking
    R->>UI: Reviews Department-Approved Grades
    UI->>N: POST /api/finalize-grade/:id (with Registrar JWT)
    N->>HLF: submitTransaction('FinalizeRecord', ...)
    HLF->>HLF: Smart contract verifies caller has 'RegistrarMSP' role
    HLF-->>N: Transaction successful, Grade status: 'Finalized' (Now Immutable)
    N-->>UI: "Grade Finalized to Ledger"
```