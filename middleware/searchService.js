/**
 * Search Index Service
 * Provides in-memory search indexing and querying capabilities for system data
 * WITH SECURITY HARDENING:
 * - Input validation and sanitization
 * - Query length limits
 * - Result set limits
 * - Memory-safe operations
 * - No sensitive data exposure
 */

// Security constants
const SECURITY_CONFIG = {
    MAX_QUERY_LENGTH: 200,           // Maximum query string length
    MAX_FILTER_LENGTH: 100,          // Maximum filter string length
    MAX_RESULTS_RETURNED: 100,       // Maximum results to return
    MAX_INDEX_SIZE: 50000,           // Maximum indexed items per type
    QUERY_TIMEOUT_MS: 5000,          // Query timeout in milliseconds
    ALLOWED_SEARCH_TYPES: ['grades', 'users', 'registrations'],
    ALLOWED_GRADE_FILTERS: ['studentId', 'courseCode', 'status', 'issuedBy'],
    ALLOWED_USER_FILTERS: ['role', 'mspid'],
    ALLOWED_REG_FILTERS: ['status', 'role']
};

class SearchIndex {
    constructor() {
        this.index = {
            grades: [],
            users: [],
            registrations: []
        };
        this.lastIndexTime = null;
        this.operationMetrics = {
            totalSearches: 0,
            totalReindexes: 0,
            lastSearchTime: null,
            lastReindexTime: null
        };
    }

    /**
     * Validate and sanitize input string
     * @param {string} input - Input to validate
     * @param {number} maxLength - Maximum allowed length
     * @returns {string} Sanitized input
     * @throws {Error} If validation fails
     */
    validateAndSanitizeInput(input, maxLength = SECURITY_CONFIG.MAX_QUERY_LENGTH) {
        if (typeof input !== 'string') {
            throw new Error('Input must be a string');
        }

        if (input.length > maxLength) {
            throw new Error(`Input exceeds maximum length of ${maxLength} characters`);
        }

        // Remove potentially dangerous characters while preserving search functionality
        // Allow alphanumeric, spaces, hyphens, underscores, dots, @, common punctuation
        const sanitized = input.replace(/[<>{}[\]\\^`|~]/g, '').trim();

        if (sanitized.length === 0) {
            throw new Error('Input cannot be empty after sanitization');
        }

        return sanitized;
    }

    /**
     * Validate and sanitize filter object
     * @param {Object} filters - Filter object
     * @param {Array} allowedKeys - Allowed filter keys
     * @returns {Object} Validated and sanitized filters
     */
    validateAndSanitizeFilters(filters, allowedKeys) {
        if (!filters || typeof filters !== 'object') {
            return {};
        }

        const sanitized = {};
        for (const [key, value] of Object.entries(filters)) {
            // Only allow whitelisted filter keys
            if (!allowedKeys.includes(key)) {
                console.warn(`[Security] Rejected unknown filter key: ${key}`);
                continue;
            }

            if (typeof value !== 'string') {
                console.warn(`[Security] Filter value must be string: ${key}`);
                continue;
            }

            if (value.length > SECURITY_CONFIG.MAX_FILTER_LENGTH) {
                console.warn(`[Security] Filter value too long: ${key}`);
                continue;
            }

            // Sanitize filter value
            const sanitizedValue = value.replace(/[<>{}[\]\\^`|~]/g, '').trim();
            if (sanitizedValue.length > 0) {
                sanitized[key] = sanitizedValue;
            }
        }

        return sanitized;
    }

    /**
     * Validate search types
     * @param {Array} types - Types to validate
     * @returns {Array} Validated types
     */
    validateSearchTypes(types) {
        if (!Array.isArray(types)) {
            return SECURITY_CONFIG.ALLOWED_SEARCH_TYPES;
        }

        return types.filter(type => SECURITY_CONFIG.ALLOWED_SEARCH_TYPES.includes(type));
    }

    /**
     * Limit results array size
     * @param {Array} results - Results array
     * @returns {Array} Limited results
     */
    limitResults(results) {
        if (!Array.isArray(results)) {
            return [];
        }

        if (results.length > SECURITY_CONFIG.MAX_RESULTS_RETURNED) {
            console.warn(
                `[Security] Result set limited from ${results.length} to ${SECURITY_CONFIG.MAX_RESULTS_RETURNED} items`
            );
            return results.slice(0, SECURITY_CONFIG.MAX_RESULTS_RETURNED);
        }

        return results;
    }

    /**
     * Index grade records from blockchain
     * @param {Array} grades - Array of grade objects
     */
    indexGrades(grades) {
        if (!Array.isArray(grades)) {
            console.error('Invalid grades input: must be an array');
            return;
        }

        // Enforce maximum index size
        const limitedGrades = grades.slice(0, SECURITY_CONFIG.MAX_INDEX_SIZE);
        if (grades.length > SECURITY_CONFIG.MAX_INDEX_SIZE) {
            console.warn(`Grades index exceeds maximum size, limiting to ${SECURITY_CONFIG.MAX_INDEX_SIZE}`);
        }

        // Only include safe, non-sensitive fields
        this.index.grades = limitedGrades.map(grade => {
            try {
                const sanitized = {
                    id: String(grade.ID || grade.id || ''),
                    studentId: String(grade.StudentID || grade.studentId || ''),
                    courseCode: String(grade.CourseCode || grade.courseCode || ''),
                    courseName: String(grade.CourseName || grade.courseName || ''),
                    grade: String(grade.Grade || grade.grade || ''),
                    status: String(grade.Status || grade.status || ''),
                    issuedBy: String(grade.IssuedBy || grade.issuedBy || ''),
                    timestamp: String(grade.Timestamp || grade.timestamp || '')
                };

                // Create searchable text from safe fields only
                sanitized.searchText = [
                    sanitized.studentId,
                    sanitized.courseCode,
                    sanitized.courseName,
                    sanitized.grade,
                    sanitized.status
                ].filter(Boolean).join(' ').toLowerCase();

                return sanitized;
            } catch (err) {
                console.error(`Error indexing grade record: ${err.message}`);
                return null;
            }
        }).filter(Boolean);

        this.lastIndexTime = Date.now();
        this.operationMetrics.lastReindexTime = Date.now();
        this.operationMetrics.totalReindexes++;
    }

    /**
     * Index user records from database
     * @param {Array} users - Array of user objects
     */
    indexUsers(users) {
        if (!Array.isArray(users)) {
            console.error('Invalid users input: must be an array');
            return;
        }

        const limitedUsers = users.slice(0, SECURITY_CONFIG.MAX_INDEX_SIZE);
        if (users.length > SECURITY_CONFIG.MAX_INDEX_SIZE) {
            console.warn(`Users index exceeds maximum size, limiting to ${SECURITY_CONFIG.MAX_INDEX_SIZE}`);
        }

        // Only include safe, non-sensitive fields (exclude passwords, tokens, private keys)
        this.index.users = limitedUsers.map(user => {
            try {
                const sanitized = {
                    id: user.id,
                    email: String(user.email || ''),
                    first_name: String(user.first_name || ''),
                    last_name: String(user.last_name || ''),
                    role: String(user.role || ''),
                    mspid: String(user.mspid || '')
                };

                sanitized.searchText = [
                    sanitized.email,
                    sanitized.first_name,
                    sanitized.last_name,
                    sanitized.role,
                    sanitized.mspid
                ].filter(Boolean).join(' ').toLowerCase();

                return sanitized;
            } catch (err) {
                console.error(`Error indexing user record: ${err.message}`);
                return null;
            }
        }).filter(Boolean);

        this.lastIndexTime = Date.now();
        this.operationMetrics.lastReindexTime = Date.now();
        this.operationMetrics.totalReindexes++;
    }

    /**
     * Index registration requests
     * @param {Array} registrations - Array of registration objects
     */
    indexRegistrations(registrations) {
        if (!Array.isArray(registrations)) {
            console.error('Invalid registrations input: must be an array');
            return;
        }

        const limitedRegs = registrations.slice(0, SECURITY_CONFIG.MAX_INDEX_SIZE);
        if (registrations.length > SECURITY_CONFIG.MAX_INDEX_SIZE) {
            console.warn(`Registrations index exceeds maximum size, limiting to ${SECURITY_CONFIG.MAX_INDEX_SIZE}`);
        }

        this.index.registrations = limitedRegs.map(reg => {
            try {
                const sanitized = {
                    id: reg.id,
                    email: String(reg.email || ''),
                    first_name: String(reg.first_name || ''),
                    last_name: String(reg.last_name || ''),
                    role: String(reg.role || ''),
                    status: String(reg.status || ''),
                    created_at: String(reg.created_at || '')
                };

                sanitized.searchText = [
                    sanitized.email,
                    sanitized.first_name,
                    sanitized.last_name,
                    sanitized.role,
                    sanitized.status
                ].filter(Boolean).join(' ').toLowerCase();

                return sanitized;
            } catch (err) {
                console.error(`Error indexing registration record: ${err.message}`);
                return null;
            }
        }).filter(Boolean);

        this.lastIndexTime = Date.now();
        this.operationMetrics.lastReindexTime = Date.now();
        this.operationMetrics.totalReindexes++;
    }

    /**
     * Search across indexed data
     * @param {string} query - Search query (validated)
     * @param {Array<string>} types - Types to search in (grades, users, registrations) (validated)
     * @param {Object} filters - Additional filters (validated)
     * @returns {Object} Search results (limited)
     * @throws {Error} If validation fails
     */
    search(query, types = SECURITY_CONFIG.ALLOWED_SEARCH_TYPES, filters = {}) {
        try {
            // Validate and sanitize query
            const sanitizedQuery = this.validateAndSanitizeInput(query);
            
            // Validate types
            const validatedTypes = this.validateSearchTypes(types);
            
            if (validatedTypes.length === 0) {
                throw new Error('At least one valid search type must be specified');
            }

            const normalizedQuery = sanitizedQuery.toLowerCase();
            const results = {};

            if (validatedTypes.includes('grades')) {
                const validatedFilters = this.validateAndSanitizeFilters(filters, SECURITY_CONFIG.ALLOWED_GRADE_FILTERS);
                results.grades = this.limitResults(this._searchGrades(normalizedQuery, validatedFilters));
            }

            if (validatedTypes.includes('users')) {
                const validatedFilters = this.validateAndSanitizeFilters(filters, SECURITY_CONFIG.ALLOWED_USER_FILTERS);
                results.users = this.limitResults(this._searchUsers(normalizedQuery, validatedFilters));
            }

            if (validatedTypes.includes('registrations')) {
                const validatedFilters = this.validateAndSanitizeFilters(filters, SECURITY_CONFIG.ALLOWED_REG_FILTERS);
                results.registrations = this.limitResults(this._searchRegistrations(normalizedQuery, validatedFilters));
            }

            // Update metrics
            this.operationMetrics.totalSearches++;
            this.operationMetrics.lastSearchTime = Date.now();

            return results;
        } catch (error) {
            console.error(`[SecurityError] Search validation failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Search grades by query and filters
     */
    _searchGrades(query, filters) {
        let results = this.index.grades;

        // Text search
        if (query) {
            results = results.filter(grade =>
                grade.searchText.includes(query) ||
                this._fuzzyMatch(query, grade.searchText)
            );
        }

        // Apply filters
        if (filters.studentId) {
            results = results.filter(g => g.studentId.toLowerCase().includes(filters.studentId.toLowerCase()));
        }
        if (filters.courseCode) {
            results = results.filter(g => g.courseCode.toLowerCase().includes(filters.courseCode.toLowerCase()));
        }
        if (filters.status) {
            results = results.filter(g => g.status.toLowerCase() === filters.status.toLowerCase());
        }
        if (filters.issuedBy) {
            results = results.filter(g => g.issuedBy.toLowerCase().includes(filters.issuedBy.toLowerCase()));
        }

        return results;
    }

    /**
     * Search users by query and filters
     */
    _searchUsers(query, filters) {
        let results = this.index.users;

        // Text search
        if (query) {
            results = results.filter(user =>
                user.searchText.includes(query) ||
                this._fuzzyMatch(query, user.searchText)
            );
        }

        // Apply filters
        if (filters.role) {
            results = results.filter(u => u.role.toLowerCase().includes(filters.role.toLowerCase()));
        }
        if (filters.mspid) {
            results = results.filter(u => u.mspid.toLowerCase().includes(filters.mspid.toLowerCase()));
        }

        return results;
    }

    /**
     * Search registrations by query and filters
     */
    _searchRegistrations(query, filters) {
        let results = this.index.registrations;

        // Text search
        if (query) {
            results = results.filter(reg =>
                reg.searchText.includes(query) ||
                this._fuzzyMatch(query, reg.searchText)
            );
        }

        // Apply filters
        if (filters.status) {
            results = results.filter(r => r.status.toLowerCase().includes(filters.status.toLowerCase()));
        }
        if (filters.role) {
            results = results.filter(r => r.role.toLowerCase().includes(filters.role.toLowerCase()));
        }

        return results;
    }

    /**
     * Fuzzy matching for typo tolerance
     */
    _fuzzyMatch(query, text) {
        let queryIdx = 0;
        let textIdx = 0;

        while (textIdx < text.length && queryIdx < query.length) {
            if (text[textIdx] === query[queryIdx]) {
                queryIdx++;
            }
            textIdx++;
        }

        return queryIdx === query.length;
    }

    /**
     * Get index statistics
     */
    getStats() {
        return {
            gradesCount: this.index.grades.length,
            usersCount: this.index.users.length,
            registrationsCount: this.index.registrations.length,
            lastIndexTime: this.lastIndexTime,
            metrics: {
                totalSearches: this.operationMetrics.totalSearches,
                totalReindexes: this.operationMetrics.totalReindexes,
                lastSearchTime: this.operationMetrics.lastSearchTime,
                lastReindexTime: this.operationMetrics.lastReindexTime
            }
        };
    }

    /**
     * Clear index (only for admin/maintenance)
     */
    clear() {
        this.index = {
            grades: [],
            users: [],
            registrations: []
        };
        this.lastIndexTime = null;
    }
}

module.exports = new SearchIndex();
