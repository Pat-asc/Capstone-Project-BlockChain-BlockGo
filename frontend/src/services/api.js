const getBaseUrl = (endpoint) => {
    if (process.env.NODE_ENV !== 'development') return '/api';
    
    // C# Backend runs on 5000
    if (endpoint.startsWith('/Auth') || endpoint.startsWith('/GradeTemplate')) {
        return 'http://localhost:5000/api';
    }
    // Node.js Middleware runs on 4000
    return 'http://localhost:4000/api';
};

// --- JWT Wrapper & Auto-Logout Handler ---
const fetchWithAuth = async (endpoint, options = {}) => {
    const token = localStorage.getItem('token');
    const baseUrl = getBaseUrl(endpoint);
    
    const headers = { ...options.headers };

    // Let the browser handle Content-Type (and boundaries) automatically for FormData
    if (!(options.body instanceof FormData) && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
    }

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${baseUrl}${endpoint}`, {
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

// --- Public API Calls (Login, Forgot Password, etc.) ---
const fetchPublic = async (endpoint, options = {}) => {
    const baseUrl = getBaseUrl(endpoint);
    const response = await fetch(`${baseUrl}${endpoint}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...options.headers,
        },
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || errorData.message || 'API Request Failed');
    }
    return await response.json();
};

export const login = (credentials) => {
    return fetchPublic('/login', { method: 'POST', body: JSON.stringify(credentials) });
};

export const forgotPassword = (email) => {
    return fetchPublic('/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
};

export const resetPassword = (token, newPassword) => {
    return fetchPublic('/reset-password', { method: 'POST', body: JSON.stringify({ token, newPassword }) });
};

// Fetch all grades from the blockchain
export const fetchAllGrades = async (invokerId) => {
    // Node.js infers the user identity automatically via the JWT token
    return await fetchWithAuth(`/all-grades`);
};

// Faculty issues a new grade
export const issueGrade = async (gradeData) => {
    return await fetchWithAuth(`/issue-grade`, {
        method: 'POST',
        body: JSON.stringify(gradeData)
    });
};

// Department Admin approves the grade
export const approveGrade = async (recordId, invokerId) => {
    return await fetchWithAuth(`/approve-grade/${encodeURIComponent(recordId)}`, {
        method: 'POST'
    });
};

// Registrar finalizes the grade
export const finalizeGrade = async (recordId, invokerId) => {
    return await fetchWithAuth(`/finalize-grade/${encodeURIComponent(recordId)}`, {
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

export const approveStudentEnrollment = async (id) => {
    return await fetchWithAuth(`/Auth/students/${encodeURIComponent(id)}/approve-enrollment`, {
        method: 'PUT'
    });
};

export const fetchFacultySections = async (email) => {
    return await fetchWithAuth(`/Auth/faculty/${encodeURIComponent(email)}/assigned-sections`);
};

export const fetchFacultyStudents = async (email) => {
    return await fetchWithAuth(`/Auth/faculty/${encodeURIComponent(email)}/students`);
};

export const batchUploadGrades = async (file, semester = '', schoolYear = '') => {
    const formData = new FormData();
    formData.append('file', file);
    if (semester) formData.append('semester', semester);
    if (schoolYear) formData.append('schoolYear', schoolYear);

    return await fetchWithAuth(`/Grades/bulk-upload`, {
        method: 'POST',
        body: formData 
    });
};

// Fetch department templates
export const fetchDepartmentTemplates = async (department) => {
    return await fetchWithAuth(`/GradeTemplate/department/${encodeURIComponent(department)}`);
};

// Review a grade template
export const reviewTemplate = async (id, status) => {
    return await fetchWithAuth(`/GradeTemplate/${encodeURIComponent(id)}/review`, {
        method: 'PUT',
        body: JSON.stringify({ status })
    });
};

// Download Excel Grading Sheet Template
export const downloadGradingSheet = async (department, section) => {
    const baseUrl = getBaseUrl('/GradeTemplate');
    const token = localStorage.getItem('token');
    const endpoint = `/GradeTemplate/department/${encodeURIComponent(department)}/section/${encodeURIComponent(section)}/download`;
    
    const response = await fetch(`${baseUrl}${endpoint}`, {
        method: 'GET',
        headers: {
            'Authorization': token ? `Bearer ${token}` : ''
        }
    });

    if (response.status === 401 || response.status === 403) {
        console.warn("Session expired or unauthorized. Logging out...");
        localStorage.removeItem('token'); 
        window.location.reload();         
        throw new Error("Session expired");
    }

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to download template.');
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `GradingSheet_${department}_${section}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
};