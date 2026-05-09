# Frontend-Middleware-Backend API Integration

## Overview
The frontend has been updated to connect to the Node.js middleware via the Nginx proxy. All API calls now go through `/api` endpoints which route to the middleware on port 4000.

## Port Configuration (NO CHANGES)
- **Frontend**: 3000 (React app)
- **Middleware**: 4000 (Node.js with Fabric)
- **Nginx Proxy**: 80/443 (routes /api to middleware)
- **Backend (C#)**: Separate endpoints routed by Nginx

## Updated Files

### 1. `frontend/src/services/api.js`
**Changes:**
- Added middleware authentication endpoints (`/login`, `/forgot-password`, `/reset-password`)
- Added middleware student profile endpoints (`/student/profile`)
- Added middleware blockchain grade endpoints:
  - `/all-grades` - Get all grades
  - `/issue-grade` - Issue a new grade
  - `/get-grade/:id` - Get specific grade
  - `/update-grade` - Update grade
  - `/approve-grade/:id` - Approve grade
  - `/finalize-grade/:id` - Finalize grade
  - `/batch-upload` - Batch upload grades (expects FormData with 'excel' field)
- Added `/health` endpoint to check middleware status
- Kept all C# backend endpoints intact

**Key Functions:**
```javascript
// Middleware (Node.js) - Authentication
login(credentials)                    // POST /api/login
forgotPassword(email)                 // POST /api/forgot-password
resetPassword(token, newPassword)     // POST /api/reset-password

// Middleware (Node.js) - Grades
getAllGrades()                        // GET /api/all-grades
issueGradeToBlockchain(gradeData)    // POST /api/issue-grade
approveGradeInBlockchain(id)         // POST /api/approve-grade/:id
finalizeGradeInBlockchain(id)        // POST /api/finalize-grade/:id
batchUploadGrades(file, facultyId)   // POST /api/batch-upload

// Health Check
getHealthStatus()                     // GET /api/health
```

### 2. `frontend/src/pages/LoginPage.jsx`
**Changes:**
- Replaced hardcoded login validation with actual API call to middleware
- Added `loading` state for form submission
- Added error display for failed login attempts
- Now calls `login()` function from api.js
- Stores JWT token in localStorage on successful login

**Flow:**
1. User enters email/password
2. Calls `login({ email, password })`
3. Middleware validates credentials and returns JWT token
4. Token stored in localStorage
5. Token decoded to extract user role
6. `onLogin()` called with user data

### 3. `frontend/src/App.jsx`
**Changes:**
- Replaced mock role assignment with real JWT-based authentication
- Added `token` state management
- Added `userEmail` state to track authenticated user
- Added loading state for app initialization
- Checks for existing token in localStorage on mount
- Updated `handleLogout()` to clear all auth data

**Authentication Flow:**
1. On mount, checks localStorage for existing token
2. If token exists, user stays logged in
3. JWT is decoded to extract `dbRole` (user role)
4. User is routed to appropriate portal
5. On logout, all auth data is cleared

## How JWT Token is Used

### Token Structure
The middleware returns a JWT with this payload:
```json
{
  "username": "user@email.com",
  "role": "FacultyMSP|DepartmentMSP|RegistrarMSP",
  "dbRole": "faculty|registrar|student|department_admin"
}
```

### Token Storage
```javascript
localStorage.setItem("token", response.token);
```

### Token Usage in API Calls
All authenticated requests automatically include:
```
Authorization: Bearer <token>
```

The `fetchWithAuth()` function handles this automatically.

### Token Expiration
- Middleware sets tokens to expire in 4 hours (configurable)
- If API returns 401/403, token is cleared and user redirected to login
- If wallet identity is missing, token is cleared for self-healing

## API Endpoint Mapping

### Middleware Endpoints (Node.js Port 4000)
```
POST   /api/login                          → Authenticate user
POST   /api/forgot-password                → Request password reset
POST   /api/reset-password                 → Reset password with token
GET    /api/student/profile                → Get student profile
PUT    /api/student/profile                → Update student profile
GET    /api/all-grades                     → Get all grades from blockchain
POST   /api/issue-grade                    → Record new grade to blockchain
GET    /api/get-grade/:id                  → Get specific grade
POST   /api/update-grade                   → Update grade on blockchain
POST   /api/approve-grade/:id              → Approve grade
POST   /api/finalize-grade/:id             → Finalize/commit grade
POST   /api/batch-upload                   → Batch upload grades (Excel/CSV)
GET    /api/health                         → Health check
```

### C# Backend Endpoints (routed by Nginx)
```
POST   /api/Auth/...                       → Authentication endpoints
POST   /api/Grades/...                     → Grade management
POST   /api/Auth/sections/...              → Section management
```

## Error Handling

### Session Expired (401/403)
- Token cleared from localStorage
- User redirected to login page
- Message displayed to user

### Wallet Identity Missing
- Triggers middleware self-healing
- Token cleared
- User redirected to login for re-authentication
- Blockchain automatically re-enrolls user

### Network Errors
- Error message displayed in UI
- User can retry operation

## Testing Login Flow

1. **Start the middleware:**
   ```bash
   cd middleware
   npm install
   node middleware.js
   ```

2. **Start the frontend:**
   ```bash
   cd frontend
   npm install
   npm start
   ```

3. **Test login:**
   - Navigate to http://localhost:3000
   - Enter email: `test@example.com`
   - Enter password: (any password)
   - Middleware validates against PostgreSQL Users table
   - Token returned and stored

## Troubleshooting

### "Failed to fetch" error
- Middleware not running on port 4000
- Nginx proxy not routing /api correctly
- Check: `GET http://localhost:4000/api/health`

### "Invalid email or password"
- User doesn't exist in PostgreSQL Users table
- Password hash doesn't match
- Check middleware logs for details

### Session expired after login
- JWT expired (4 hour default)
- Token corrupted or modified
- User needs to login again

### "Blockchain Identity not found"
- User exists in database but not in wallet
- Middleware self-healing will attempt to recover
- If fails, contact admin to re-register

## Frontend Dependencies Added
- No new dependencies needed
- Uses native `fetch()` API
- localStorage for token persistence
- JWT decoding via base64 (built-in)

## Environment Variables (if needed)
Configure in middleware `.env`:
```
JWT_SECRET=your-secret-key
INTERNAL_API_KEY=your-api-key
POSTGRES_USER=postgres
POSTGRES_PASS=password
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=5432
PORT=4000
```

## Next Steps
1. Verify middleware is running with: `GET /api/health`
2. Test login with valid credentials from Users table
3. Verify JWT token is stored: check Developer Tools > Application > Storage > localStorage
4. Update portal components to call middleware endpoints instead of mock data
5. Integrate blockchain calls where needed
