const getBaseUrl = (endpoint) => {
    // Bypass Nginx proxy to prevent 404 routing errors to Express
    // Force requests directly to the dedicated backend ports
    const host = window.location.hostname || 'localhost';

    if (endpoint.startsWith('/Auth') || endpoint.startsWith('/GradeTemplate') || endpoint.startsWith('/Grades')) {
        return `http://${host}:5000/api`;
    }
    return `http://${host}:4000/api`;
};
const fetchWithAuth = async (endpoint, options = {}) => {
    const token = localStorage.getItem('token');
    const baseUrl = getBaseUrl(endpoint);
    
    const headers = { ...options.headers };
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
        throw new Error(errorData.message || errorData.error || 'API Request Failed');
    }

    return await response.json();
};
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
export const fetchAllGrades = async (invokerId) => {
    return await fetchWithAuth(`/all-grades`);
};
export const issueGrade = async (gradeData) => {
    return await fetchWithAuth(`/issue-grade`, {
        method: 'POST',
        body: JSON.stringify(gradeData)
    });
};
export const approveGrade = async (recordId, invokerId) => {
    return await fetchWithAuth(`/approve-grade/${encodeURIComponent(recordId)}`, {
        method: 'POST'
    });
};
export const finalizeGrade = async (recordId, invokerId) => {
    return await fetchWithAuth(`/finalize-grade/${encodeURIComponent(recordId)}`, {
        method: 'POST'
    });
};
export const submitRegistrationRequest = async (userData) => {
    return await fetchWithAuth(`/Auth/request`, {
        method: 'POST',
        body: JSON.stringify(userData)
    });
};
export const sendVerificationCode = async (email) => {
    return await fetchWithAuth(`/Auth/send-verification`, {
        method: 'POST',
        body: JSON.stringify({ email })
    });
};
export const fetchPendingRequests = async () => {
    return await fetchWithAuth(`/Auth/requests/pending`);
};
export const approveRegistrationRequest = async (id, type) => {
    return await fetchWithAuth(`/Auth/requests/approve/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, {
        method: 'PUT'
    });
};
export const denyRegistrationRequest = async (id) => {
    return await fetchWithAuth(`/Auth/requests/deny/${encodeURIComponent(id)}`, {
        method: 'DELETE'
    });
};
export const fetchUserProfile = async (email, role) => {
    return await fetchWithAuth(`/Auth/user-profile?email=${encodeURIComponent(email)}&role=${encodeURIComponent(role)}`);
};
export const fetchApprovedStudents = async () => {
    return await fetchWithAuth(`/Auth/students/approved`);
};
export const assignStudent = async (id, assignmentData) => {
    return await fetchWithAuth(`/Auth/students/${encodeURIComponent(id)}/assign`, {
        method: 'PUT',
        body: JSON.stringify(assignmentData)
    });
};
export const fetchApprovedAdmins = async () => {
    return await fetchWithAuth(`/Auth/admins/department/approved`);
};
export const assignDepartmentAdmin = async (id, assignmentData) => {
    return await fetchWithAuth(`/Auth/admins/department/${encodeURIComponent(id)}/assign`, {
        method: 'PUT',
        body: JSON.stringify(assignmentData)
    });
};
export const fetchApprovedFaculties = async () => {
    return await fetchWithAuth(`/Auth/faculty/approved`);
};

export const assignFaculty = async (id, assignmentData) => {
    return await fetchWithAuth(`/Auth/faculty/${encodeURIComponent(id)}/assign`, {
        method: 'PUT',
        body: JSON.stringify(assignmentData)
    });
};

export const fetchDepartmentPendingStudents = async (email) => {
    return await fetchWithAuth(`/Auth/department/${encodeURIComponent(email)}/students/pending`);
};

export const approveStudentEnrollment = async (id) => {
    return await fetchWithAuth(`/Auth/students/${encodeURIComponent(id)}/approve-enrollment`, {
        method: 'PUT'
    });
};

export const dropStudent = async (id) => {
    return await fetchWithAuth(`/Auth/students/${encodeURIComponent(id)}/drop`, {
        method: 'DELETE'
    });
};

export const unassignFacultySection = async (email, department, yearLevel, section, subject) => {
    return await fetchWithAuth(`/Auth/faculty/${encodeURIComponent(email)}/assigned-sections?department=${encodeURIComponent(department)}&yearLevel=${encodeURIComponent(yearLevel)}&section=${encodeURIComponent(section)}&subject=${encodeURIComponent(subject || '')}`, {
        method: 'DELETE'
    });
};

export const fetchFacultySections = async (email) => {
    return await fetchWithAuth(`/Auth/faculty/${encodeURIComponent(email)}/assigned-sections`);
};

export const fetchFacultyStudents = async (email) => {
    return await fetchWithAuth(`/Auth/faculty/${encodeURIComponent(email)}/students`);
};

export const createSection = async (sectionData) => {
    return await fetchWithAuth(`/Auth/sections`, {
        method: 'POST',
        body: JSON.stringify(sectionData)
    });
};

export const fetchDepartmentSections = async (department) => {
    return await fetchWithAuth(`/Auth/sections/department/${encodeURIComponent(department)}`);
};

export const batchEnrollStudentsToSection = async (file, sectionId) => {
    const formData = new FormData();
    formData.append('file', file);

    return await fetchWithAuth(`/Auth/sections/${encodeURIComponent(sectionId)}/enroll`, {
        method: 'POST',
        body: formData
    });
};

export const batchUploadGrades = async (file, semester = '', schoolYear = '', course = '') => {
    const formData = new FormData();
    formData.append('file', file);
    if (semester) formData.append('semester', semester);
    if (schoolYear) formData.append('schoolYear', schoolYear);
    if (course) formData.append('course', course);

    return await fetchWithAuth(`/Grades/bulk-upload`, {
        method: 'POST',
        body: formData 
    });
};
export const batchUploadStudents = async (file, defaultDepartment = '') => {
    const formData = new FormData();
    formData.append('file', file);
    if (defaultDepartment) formData.append('defaultDepartment', defaultDepartment);

    return await fetchWithAuth(`/Auth/students/bulk-upload`, {
        method: 'POST',
        body: formData 
    });
};
export const uploadToIpfs = async (file) => {
    const formData = new FormData();
    formData.append('file', file);

    return await fetchWithAuth(`/Grades/upload-ipfs`, {
        method: 'POST',
        body: formData 
    });
};
export const fetchDepartmentTemplates = async (department) => {
    return await fetchWithAuth(`/GradeTemplate/department/${encodeURIComponent(department)}`);
};

export const reviewTemplate = async (id, status) => {
    return await fetchWithAuth(`/GradeTemplate/${encodeURIComponent(id)}/review`, {
        method: 'PUT',
        body: JSON.stringify({ status })
    });
};
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