const BASE_URL = process.env.NODE_ENV === 'development' 
    ? 'http://localhost:5000/api' 
    : '/api';

// --- JWT Wrapper & Auto-Logout Handler ---
const fetchWithAuth = async (endpoint, options = {}) => {
    const token = localStorage.getItem('token');
    
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers,
    };

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${BASE_URL}${endpoint}`, {
        ...options,
        headers,
    });

    if (response.status === 401 || response.status === 403) {
        console.warn("Session expired or unauthorized. Logging out...");
        localStorage.removeItem('token'); 
        window.location.reload();         
        throw new Error("Session expired");
    }

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        // Prioritize 'message' from backend, then 'error', then a generic message
        throw new Error(errorData.message || errorData.error || 'API Request Failed');
    }

    return await response.json();
};

// Fetch all grades from the blockchain
export const fetchAllGrades = async (invokerId) => {
    if (!invokerId) return [];
    return await fetchWithAuth(`/Grades/all?invokerId=${encodeURIComponent(invokerId)}`);
};

// Faculty issues a new grade
export const issueGrade = async (gradeData) => {
    return await fetchWithAuth(`/Grades/record`, {
        method: 'POST',
        body: JSON.stringify(gradeData)
    });
};

// Department Admin approves the grade
export const approveGrade = async (recordId, invokerId) => {
    if (!invokerId) throw new Error("Invoker ID is required to approve a grade.");
    return await fetchWithAuth(`/Grades/approve/${encodeURIComponent(recordId)}?invokerId=${encodeURIComponent(invokerId)}`, {
        method: 'POST'
    });
};

// Registrar finalizes the grade
export const finalizeGrade = async (recordId, invokerId) => {
    if (!invokerId) throw new Error("Invoker ID is required to finalize a grade.");
    return await fetchWithAuth(`/Grades/finalize/${encodeURIComponent(recordId)}?invokerId=${encodeURIComponent(invokerId)}`, {
        method: 'POST'
    });
};

// Submit a registration request to the waitlist (PostgreSQL)
export const submitRegistrationRequest = async (userData) => {
    return await fetchWithAuth(`/Auth/request`, {
        method: 'POST',
        body: JSON.stringify(userData)
    });
};

// Send verification code for signup
export const sendVerificationCode = async (email) => {
    return await fetchWithAuth(`/Auth/send-verification`, {
        method: 'POST',
        body: JSON.stringify({ email })
    });
};

// Fetch pending registration requests (Both Student and Staff)
export const fetchPendingRequests = async () => {
    return await fetchWithAuth(`/Auth/requests/pending`);
};

// Approve a registration request
export const approveRegistrationRequest = async (id, type) => {
    return await fetchWithAuth(`/Auth/requests/approve/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, {
        method: 'PUT'
    });
};

// Deny/Delete a registration request
export const denyRegistrationRequest = async (id) => {
    return await fetchWithAuth(`/Auth/requests/deny/${encodeURIComponent(id)}`, {
        method: 'DELETE'
    });
};

// Fetch full user profile after login
export const fetchUserProfile = async (email, role) => {
    return await fetchWithAuth(`/Auth/user-profile?email=${encodeURIComponent(email)}&role=${encodeURIComponent(role)}`);
};

// Fetch approved students for assignment
export const fetchApprovedStudents = async () => {
    return await fetchWithAuth(`/Auth/students/approved`);
};

// Submit department/section assignment for a student
export const assignStudent = async (id, assignmentData) => {
    return await fetchWithAuth(`/Auth/students/${encodeURIComponent(id)}/assign`, {
        method: 'PUT',
        body: JSON.stringify(assignmentData)
    });
};

// Fetch approved department admins for assignment
export const fetchApprovedAdmins = async () => {
    return await fetchWithAuth(`/Auth/admins/department/approved`);
};

// Submit department assignment for an admin
export const assignDepartmentAdmin = async (id, assignmentData) => {
    return await fetchWithAuth(`/Auth/admins/department/${encodeURIComponent(id)}/assign`, {
        method: 'PUT',
        body: JSON.stringify(assignmentData)
    });
};

// Fetch approved faculties for assignment
export const fetchApprovedFaculties = async () => {
    return await fetchWithAuth(`/Auth/faculty/approved`);
};

// Submit assignment for a faculty
export const assignFaculty = async (id, assignmentData) => {
    return await fetchWithAuth(`/Auth/faculty/${encodeURIComponent(id)}/assign`, {
        method: 'PUT',
        body: JSON.stringify(assignmentData)
    });
};

// Fetch students assigned to department pending admin approval
export const fetchDepartmentPendingStudents = async (email) => {
    return await fetchWithAuth(`/Auth/department/${encodeURIComponent(email)}/students/pending`);
};

// Approve the student's assignment to the department
export const approveStudentEnrollment = async (id) => {
    return await fetchWithAuth(`/Auth/students/${encodeURIComponent(id)}/approve-enrollment`, {
        method: 'PUT'
    });
};
// ─────────────────────────────────────────────────────────────────────────────
// SEARCH INDEX
// Unified search across blockchain grades, PostgreSQL users, and profiles.
//
// Params:
//   query   {string}  – the search term (required, min 2 chars)
//   type    {string}  – 'all' | 'grades' | 'users' | 'profiles'  (default: 'all')
//   page    {number}  – 1-based page number                       (default: 1)
//   limit   {number}  – results per page, max 25                  (default: 20)
//
// Returns:
//   { status, type, results: { grades, users, profiles }, errors? }
//
// Security notes:
//   [H2] Minimum 2-char query enforced here AND server-side
//   [M2] limit capped at 25 client-side to match server cap
//   [M3] type validated client-side before the request is sent
// ─────────────────────────────────────────────────────────────────────────────
const ALLOWED_SEARCH_TYPES = new Set(['all', 'grades', 'users', 'profiles']);

export const searchIndex = async ({ query, type = 'all', page = 1, limit = 20 } = {}) => {
    const trimmed = (query || '').trim();

    // [H2] Enforce minimum length client-side (server also enforces this)
    if (trimmed.length < 2) throw new Error('Search query must be at least 2 characters.');
    if (trimmed.length > 100) throw new Error('Search query must be 100 characters or fewer.');

    // [M3] Validate type before sending
    if (!ALLOWED_SEARCH_TYPES.has(type)) throw new Error('Invalid search type.');

    // [M2] Cap limit at 25 to match server
    const safLimit = Math.min(25, Math.max(1, parseInt(limit, 10) || 20));

    const params = new URLSearchParams({
        q:     trimmed,
        type,
        page:  String(Math.max(1, parseInt(page, 10) || 1)),
        limit: String(safLimit),
    });
    return await fetchWithAuth(`/search?${params.toString()}`);
};
