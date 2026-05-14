const getBaseUrl = (endpoint) => {
    if (process.env.REACT_APP_API_BASE_URL) {
        return process.env.REACT_APP_API_BASE_URL.replace(/\/$/, '');
    }

    // All API calls go through Nginx proxy on /api
    return '/api';
};

export const getChatHubUrl = () => {
    if (process.env.REACT_APP_CHAT_HUB_URL) {
        return process.env.REACT_APP_CHAT_HUB_URL;
    }

    if (typeof window !== 'undefined' && window.location.hostname === 'localhost' && window.location.port === '3000') {
        return 'http://localhost:5000/chatHub';
    }

    return '/chatHub';
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

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = String(errorData.message || errorData.error || 'API Request Failed');
        throw new Error(errorMessage);
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

// ==================== MIDDLEWARE API - LOGIN & AUTH ====================
// These endpoints point to middleware.js running on port 4000
// Middleware uses role-based wallet routing (registrar/5990, faculty/6990, department/7990)

export const login = (credentials) => {
    // Middleware expects: { username: string, password: string }
    // Frontend passes: { username: email, password: password }
    // /api/login is served by middleware on port 4000
    const loginPayload = {
        username: credentials.username || credentials.email,
        password: credentials.password
    };
    console.log('[Login] POST /api/login with payload:', { username: loginPayload.username });
    return fetchPublic('/login', { 
        method: 'POST', 
        body: JSON.stringify(loginPayload) 
    });
};

export const forgotPassword = (email) => {
    return fetchPublic('/forgot-password', { 
        method: 'POST', 
        body: JSON.stringify({ email }) 
    });
};

export const resetPassword = (token, newPassword) => {
    return fetchPublic('/reset-password', { 
        method: 'POST', 
        body: JSON.stringify({ token, newPassword }) 
    });
};

export const hashPassword = async (password) => {
    return await fetchPublic('/crypto/hash-password', {
        method: 'POST',
        body: JSON.stringify({ password })
    });
};

export const bootstrapSystem = async () => {
    return await fetchPublic('/bootstrap');
};

// ==================== MIDDLEWARE API - STUDENT PROFILE ====================
export const getStudentProfile = async () => {
    return await fetchWithAuth('/student/profile');
};

export const updateStudentProfile = async (profileData) => {
    return await fetchWithAuth('/student/profile', {
        method: 'PUT',
        body: JSON.stringify(profileData)
    });
};

// ==================== GRADES API - C# STAGING + BLOCKCHAIN LEDGER ====================
export const getAllGrades = async (invokerId = 'system') => {
    return await fetchWithAuth(`/Grades/all?invokerId=${encodeURIComponent(invokerId)}`);
};

export const fetchAllGrades = async (invokerId) => {
    return await fetchWithAuth(`/Grades/all?invokerId=${encodeURIComponent(invokerId)}`);
};

export const issueGradeToBlockchain = async (gradeData) => {
    return await fetchWithAuth('/issue-grade', {
        method: 'POST',
        body: JSON.stringify(gradeData)
    });
};

export const getGrade = async (id) => {
    return await fetchWithAuth(`/get-grade/${encodeURIComponent(id)}`);
};

export const updateGradeInBlockchain = async (gradeData) => {
    return await fetchWithAuth('/update-grade', {
        method: 'POST',
        body: JSON.stringify(gradeData)
    });
};

export const approveGradeInBlockchain = async (id) => {
    return await fetchWithAuth(`/approve-grade/${encodeURIComponent(id)}`, {
        method: 'POST'
    });
};

export const finalizeGradeInBlockchain = async (id) => {
    return await fetchWithAuth(`/finalize-grade/${encodeURIComponent(id)}`, {
        method: 'POST'
    });
};

export const finalizeGrade = async (recordId, invokerId) => {
    return await fetchWithAuth(`/Grades/finalize/${encodeURIComponent(recordId)}?invokerId=${encodeURIComponent(invokerId)}`, {
        method: 'POST'
    });
};

export const returnGrade = async (id, note, invokerId = '') => {
    return await fetchWithAuth(`/Grades/return/${encodeURIComponent(id)}`, {
        method: 'POST',
        body: JSON.stringify({ note, invokerId })
    });
};

export const enrollFabricIdentity = async ({ username, role, password }) => {
    return await fetchWithAuth('/enroll', {
        method: 'POST',
        body: JSON.stringify({ username, role, password })
    });
};

export const registerFabricIdentity = async ({ username, role, password }) => {
    return await fetchWithAuth('/register', {
        method: 'POST',
        body: JSON.stringify({ username, role, password })
    });
};

export const revokeFabricIdentity = async ({ username, role, reason = '' }) => {
    return await fetchWithAuth('/revoke', {
        method: 'POST',
        body: JSON.stringify({ username, role, reason })
    });
};

export const deleteFabricWallet = async (username) => {
    return await fetchWithAuth(`/wallet/${encodeURIComponent(username)}`, {
        method: 'DELETE'
    });
};

export const fetchBlockchainGrades = async () => {
    return await fetchWithAuth('/all-grades');
};

export const middlewareBatchUploadGrades = async (file) => {
    const formData = new FormData();
    formData.append('excel', file);

    return await fetchWithAuth('/batch-upload', {
        method: 'POST',
        body: formData
    });
};

export const middlewareUploadGrades = async (file) => {
    const formData = new FormData();
    formData.append('excel', file);

    return await fetchWithAuth('/upload-grades', {
        method: 'POST',
        body: formData
    });
};

export const batchIssueGradeToBlockchain = async (grades = []) => {
    return await fetchWithAuth('/batch-issue-grade', {
        method: 'POST',
        body: JSON.stringify(grades)
    });
};

export const batchUploadGrades = async (file, semester = '', schoolYear = '', course = '', facultyId = '', term = '') => {
    const formData = new FormData();
    formData.append('file', file);

    const legacyFacultyId = !schoolYear && !course && !facultyId ? semester : '';
    const resolvedFacultyId = facultyId || legacyFacultyId;

    if (!legacyFacultyId && semester) formData.append('semester', semester);
    if (schoolYear) formData.append('schoolYear', schoolYear);
    if (course) formData.append('course', course);
    if (resolvedFacultyId) formData.append('facultyId', resolvedFacultyId);
    if (term) formData.append('term', term);

    return await fetchWithAuth(`/Grades/bulk-upload`, {
        method: 'POST',
        body: formData
    });
};

// ==================== MIDDLEWARE API - HEALTH CHECK ====================
export const getHealthStatus = async () => {
    return await fetchPublic('/health');
};

export const registerFabricUser = async ({ email, role, password }) => {
    return await fetchWithAuth('/fabric/register-user', {
        method: 'POST',
        body: JSON.stringify({ email, role, password })
    });
};

// ==================== C# BACKEND API - REGISTRATION & PROFILES ====================
// These endpoints route to C# backend through Nginx

export const issueGrade = async (gradeData) => {
    return await fetchWithAuth(`/Grades/record`, {
        method: 'POST',
        body: JSON.stringify(gradeData)
    });
};

export const submitSectionGrades = async (department, section) => {
    return await fetchWithAuth(`/Grades/submit-section?department=${encodeURIComponent(department)}&section=${encodeURIComponent(section)}`, {
        method: 'POST'
    });
};

export const submitFacultySectionToChairperson = async ({ department, section }) => {
    return await submitSectionGrades(department, section);
};

export const fetchChairpersonGradeRecords = async (invokerId = 'chairperson') => {
    return await fetchAllGrades(invokerId);
};

export const approveGrade = async (recordId, invokerId) => {
    return await fetchWithAuth(`/Grades/approve/${encodeURIComponent(recordId)}?invokerId=${encodeURIComponent(invokerId)}`, {
        method: 'POST'
    });
};

export const submitRegistrationRequest = async (userData) => {
    return await fetchPublic(`/Auth/request`, {
        method: 'POST',
        body: JSON.stringify(userData)
    });
};

export const sendVerificationCode = async (email) => {
    return await fetchPublic(`/Auth/send-verification`, {
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

export const cleanupPendingRequests = async () => {
    return await fetchWithAuth('/Auth/requests/cleanup-pending', {
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

export const revokeDepartmentAdmin = async (id) => {
    return await fetchWithAuth(`/Auth/admins/department/${encodeURIComponent(id)}/revoke`, {
        method: 'DELETE'
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

export const revokeFaculty = async (id) => {
    return await fetchWithAuth(`/Auth/faculty/${encodeURIComponent(id)}/revoke`, {
        method: 'DELETE'
    });
};

export const assignFacultyLoadToBackend = async (assignmentData) => {
    const facultyId = assignmentData.facultyId;

    if (!facultyId) {
        throw new Error('Faculty ID is required to assign faculty load.');
    }

    return await assignFaculty(facultyId, {
        Department: assignmentData.program || assignmentData.department || '',
        Section: assignmentData.sectionName || assignmentData.section || '',
        YearLevel: assignmentData.yearLevel || '',
        Subject: assignmentData.subjectCode || assignmentData.subject || '',
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

export const deleteAcademicSection = async (id) => {
    return await fetchWithAuth(`/Auth/sections/${encodeURIComponent(id)}`, {
        method: 'DELETE'
    });
};

export const deleteDepartmentAcademicSections = async (department) => {
    return await fetchWithAuth(`/Auth/sections/department/${encodeURIComponent(department)}`, {
        method: 'DELETE'
    });
};

export const batchEnrollStudentsToSection = async (file, sectionId) => {
    const formData = new FormData();
    formData.append('file', file);

    return await fetchWithAuth(`/Auth/sections/${encodeURIComponent(sectionId)}/enroll`, {
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

export const bulkEnrollStudents = async (file, defaultDepartment = '') => {
    return await batchUploadStudents(file, defaultDepartment);
};

export const registrarBulkEnrollStudents = async (file, department = '') => {
    return await bulkEnrollStudents(file, department);
};

export const bulkUploadMasterlist = async (file, department = '') => {
    const formData = new FormData();
    formData.append('file', file);
    if (department) formData.append('department', department);

    return await fetchWithAuth(`/Auth/bulk-masterlist`, {
        method: 'POST',
        body: formData
    });
};

export const getDecryptedIpfsUrl = (cid, vaultPassword = '') => {
    if (!cid) return "#";
    const token = localStorage.getItem('token');
    let url = `/api/Grades/view-ipfs/${cid}?vaultPassword=${encodeURIComponent(vaultPassword)}&access_token=${token}`;
    console.log("Constructed IPFS URL:", url);
    return url;
};

export const uploadToIpfs = async (file) => {
    const formData = new FormData();
    formData.append('file', file);

    return await fetchWithAuth(`/Grades/upload-ipfs`, {
        method: 'POST',
        body: formData 
    });
};

export const fetchGradeRecord = async (recordId) => {
    return await fetchWithAuth(`/Grades/${encodeURIComponent(recordId)}`);
};

export const fetchGradeHistory = async (recordId) => {
    return await fetchWithAuth(`/Grades/history/${encodeURIComponent(recordId)}`);
};

export const correctGrade = async (payload) => {
    return await fetchWithAuth('/Grades/correct', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
};

export const flagGrade = async (recordId, payload = {}) => {
    return await fetchWithAuth(`/Grades/flag/${encodeURIComponent(recordId)}`, {
        method: 'POST',
        body: JSON.stringify(payload)
    });
};

export const updateGradeStatus = async (recordId, payload = {}) => {
    return await fetchWithAuth(`/Grades/status/${encodeURIComponent(recordId)}`, {
        method: 'POST',
        body: JSON.stringify(payload)
    });
};

export const fetchDepartmentTemplates = async (department) => {
    return await fetchWithAuth(`/GradeTemplate/department/${encodeURIComponent(department)}`);
};

export const createGradeTemplate = async (payload) => {
    return await fetchWithAuth(`/GradeTemplate/create`, {
        method: 'POST',
        body: JSON.stringify(payload),
    });
};

export const reviewTemplate = async (id, status) => {
    return await fetchWithAuth(`/GradeTemplate/${encodeURIComponent(id)}/review`, {
        method: 'PUT',
        body: JSON.stringify({ status })
    });
};


export const getSystemSetting = async (key) => {
    return await fetchWithAuth(`/SystemSettings/${encodeURIComponent(key)}`);
};

export const updateSystemSetting = async (key, value) => {
    return await fetchWithAuth(`/SystemSettings`, {
        method: 'POST',
        body: JSON.stringify({ key, value })
    });
};

export const resetEncodingSeason = async () => {
    return await fetchWithAuth(`/SystemSettings/reset-season`, {
        method: 'POST'
    });
};

export const fetchStagedGrades = async (status = '') => {
    return await fetchWithAuth(`/BulkUpload/staged?status=${encodeURIComponent(status)}`);
};

export const approveStagedGrades = async (stagingIds) => {
    return await fetchWithAuth(`/BulkUpload/approve-grades`, {
        method: 'POST',
        body: JSON.stringify({ StagingIds: stagingIds })
    });
};

export const finalizeStagedGrades = async (stagingIds) => {
    return await fetchWithAuth(`/BulkUpload/finalize-grades`, {
        method: 'POST',
        body: JSON.stringify({ StagingIds: stagingIds })
    });
};

export const fetchSystemLogs = async () => {
    return await fetchWithAuth(`/Grades/audit-all`);
};

export const getAuditLogs = async (recordId) => {
    return await fetchWithAuth(`/Grades/audit-logs/${encodeURIComponent(recordId)}`);
};

export const fetchRegistrarDashboardOverview = async () => {
    return await fetchWithAuth('/RegistrarDashboard/overview');
};

export const queryRegistrarLogs = async (params = {}) => {
    const query = new URLSearchParams(
        Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '')
    ).toString();

    return await fetchWithAuth(`/RegistrarDashboard/logs/query${query ? `?${query}` : ''}`);
};

export const searchRegistrarRecords = async (params = {}) => {
    const query = new URLSearchParams(
        Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '')
    ).toString();

    return await fetchWithAuth(`/registrar/Search${query ? `?${query}` : ''}`);
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
