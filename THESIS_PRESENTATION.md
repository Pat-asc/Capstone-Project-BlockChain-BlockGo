# Guide: System Architecture & Flows

This document is designed to help you explain the **Hybrid Web2/Web3 Architecture** to your thesis panel clearly and professionally.

## 1. The Core Concept: "The Bank Lobby vs. The Bank Vault"
*Use this analogy during your presentation to explain WHY you used both PostgreSQL and Hyperledger Fabric.*

> "Our system operates like a highly secure bank.
> 
> The **Web2 Database (C# & PostgreSQL)** is the **Bank Lobby**. It is fast, efficient, and handles everyday tasks like checking IDs, managing the waitlist, and organizing people into departments. We keep it here to comply with the Data Privacy Act, as blockchains are permanent and cannot easily delete user data.
> 
> The **Web3 Blockchain (Node.js & Hyperledger Fabric)** is the **Bank Vault**. It is heavily guarded, decentralized, and permanent. We don't put everyday passwords or pending requests in the vault; we only put the most critical, finalized assets there—which, in our case, are the students' academic grades."

---

## 2. Sequence Diagram: Registration & Identity Bridge
This diagram shows how a user moves from the "Web2 Waitlist" to getting a "Web3 Blockchain Identity".

```mermaid
sequenceDiagram
    autonumber
    actor U as New User
    participant UI as React Frontend
    participant C as C# Backend (Port 5000)
    participant DB as PostgreSQL
    participant N as Node.js Bridge (Port 4000)
    participant CA as Fabric CA

    Note over U,CA: Phase 1: The Waitlist (Web2)
    U->>UI: Submit Registration Form
    UI->>C: POST /api/Auth/request
    C->>N: Request Password Hash
    N-->>C: Returns bcrypt Hash
    C->>DB: Save User as 'Pending'
    DB-->>C: Confirm Save
    C-->>UI: "Added to Waitlist"

    Note over U,CA: Phase 2: Administrative Approval & Web3 Bridge
    actor A as Registrar
    A->>UI: Clicks "Approve" on Dashboard
    UI->>C: PUT /api/Auth/requests/approve
    C->>DB: Update status to 'APPROVED'
    C->>N: Internal POST /api/fabric/register-user
    N->>CA: Generate random secret & Register Identity
    CA-->>N: Issue X.509 Cryptographic Certificate
    N->>N: Save Identity to /wallet
    N-->>C: "Blockchain Wallet Created"
    C-->>UI: 200 OK (User successfully onboarded)
```

---

## 3. Sequence Diagram: The Grade Lifecycle
This diagram shows the strict Attribute-Based Access Control (ABAC) and the decentralized approval flow for grades.

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
    UI->>N: POST /api/issue-grade (with JWT)
    N->>HLF: SubmitTransaction('IssueGrade')
    HLF->>HLF: Smart Contract verifies 'Faculty' attribute
    HLF-->>N: Status: 'Issued'
    N-->>UI: "Grade Recorded"

    Note over D,HLF: Phase 2: Department Verification
    D->>UI: Reviews Pending Grades
    UI->>N: POST /api/approve-grade
    N->>HLF: SubmitTransaction('ApproveGrade')
    HLF->>HLF: Smart Contract verifies 'Department_Admin' attribute
    HLF-->>N: Status: 'DepartmentApproved'
    N-->>UI: "Grade Verified by Dean"

    Note over R,HLF: Phase 3: Finalization & Locking
    R->>UI: Reviews Verified Grades
    UI->>N: POST /api/finalize-grade
    N->>HLF: SubmitTransaction('FinalizeRecord')
    HLF->>HLF: Smart Contract verifies 'Registrar' attribute
    HLF-->>N: Status: 'Finalized' (Permanently Locked)
    N-->>UI: "Grade Finalized to Ledger"
```


REDIS is Free for local Development but in production and deployment it will require a paid subscription.
REDIS is for memory caching.