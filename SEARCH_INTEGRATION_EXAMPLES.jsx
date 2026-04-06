/**
 * Search Integration Examples
 * 
 * This file demonstrates how to integrate the search index system
 * into various scenarios within the BlockGo application.
 */

// ============================================================================
// EXAMPLE 1: Add Search to Grades Dashboard (GradesDashboard.jsx)
// ============================================================================

import React, { useState, useEffect } from 'react';
import SearchBar from './SearchBar';
import useSearch from '../hooks/useSearch';

function GradesDashboardWithSearch() {
    const [filteredGrades, setFilteredGrades] = useState([]);
    const { reindex } = useSearch();

    // Initialize search index when component mounts
    useEffect(() => {
        reindex().catch(err => console.error('Failed to initialize search:', err));
    }, [reindex]);

    const handleSearchResults = (results) => {
        if (results?.grades) {
            setFilteredGrades(results.grades);
        }
    };

    return (
        <div className="grades-dashboard">
            <h1>Grades Dashboard</h1>
            
            {/* Add search bar at top */}
            <SearchBar
                placeholder="Search by student ID, course code, or grade..."
                types="grades"
                onResults={handleSearchResults}
                minCharacters={2}
                debounceMs={300}
            />

            {/* Display filtered grades */}
            <div className="grades-list">
                {filteredGrades.length > 0 ? (
                    filteredGrades.map(grade => (
                        <div key={grade.id} className="grade-card">
                            <h3>{grade.courseCode}: {grade.courseName}</h3>
                            <p>Student: {grade.studentId}</p>
                            <p>Grade: {grade.grade}</p>
                            <p>Status: {grade.status}</p>
                        </div>
                    ))
                ) : (
                    <p>No grades found. Try a different search.</p>
                )}
            </div>
        </div>
    );
}

export default GradesDashboardWithSearch;


// ============================================================================
// EXAMPLE 2: User Management Page with Advanced Filtering
// ============================================================================

import { useState } from 'react';
import useSearch from '../hooks/useSearch';

function UserManagementPage() {
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedRole, setSelectedRole] = useState('');
    const { searchUsersOnly, results, loading } = useSearch();

    const handleSearch = async () => {
        const filters = selectedRole ? { role: selectedRole } : {};
        await searchUsersOnly(searchQuery, filters);
    };

    return (
        <div className="user-management">
            <h1>User Management</h1>

            {/* Search and filter controls */}
            <div className="search-controls">
                <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                    placeholder="Search by name, email, or ID..."
                />

                <select value={selectedRole} onChange={(e) => setSelectedRole(e.target.value)}>
                    <option value="">All Roles</option>
                    <option value="Student">Students</option>
                    <option value="Faculty">Faculty</option>
                    <option value="Admin">Admin</option>
                </select>

                <button onClick={handleSearch} disabled={!searchQuery || loading}>
                    {loading ? 'Searching...' : 'Search'}
                </button>
            </div>

            {/* Results display */}
            {results?.users && (
                <table className="users-table">
                    <thead>
                        <tr>
                            <th>Email</th>
                            <th>Name</th>
                            <th>Role</th>
                            <th>MSP ID</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {results.users.map(user => (
                            <tr key={user.id}>
                                <td>{user.email}</td>
                                <td>{user.first_name} {user.last_name}</td>
                                <td>{user.role}</td>
                                <td>{user.mspid}</td>
                                <td>
                                    <button onClick={() => handleEditUser(user.id)}>Edit</button>
                                    <button onClick={() => handleDeleteUser(user.id)}>Delete</button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}


// ============================================================================
// EXAMPLE 3: Real-time Search with Debouncing
// ============================================================================

import React, { useState, useCallback } from 'react';
import useSearch from '../hooks/useSearch';

function RealTimeSearchExample() {
    const [query, setQuery] = useState('');
    const { debouncedSearch, results, loading, error } = useSearch();

    // Perform debounced search automatically when query changes
    const handleQueryChange = useCallback((newQuery) => {
        setQuery(newQuery);
        // debouncedSearch automatically debounces
        if (newQuery.length >= 2) {
            debouncedSearch(newQuery, {
                types: 'grades,users,registrations',
                debounce: 300
            });
        }
    }, [debouncedSearch]);

    const totalResults = results ? Object.values(results).flat().length : 0;

    return (
        <div className="real-time-search">
            <h2>Global Search</h2>

            <input
                type="text"
                value={query}
                onChange={(e) => handleQueryChange(e.target.value)}
                placeholder="Search everything..."
                className={loading ? 'loading' : ''}
            />

            {error && <div className="error">{error}</div>}

            {loading && <div className="loading">Searching...</div>}

            {results && (
                <div className="results">
                    <p>Found {totalResults} results</p>

                    {results.grades?.length > 0 && (
                        <section className="grades-results">
                            <h3>Grades ({results.grades.length})</h3>
                            {results.grades.map(g => (
                                <div key={g.id}>{g.courseCode}: {g.grade}</div>
                            ))}
                        </section>
                    )}

                    {results.users?.length > 0 && (
                        <section className="users-results">
                            <h3>Users ({results.users.length})</h3>
                            {results.users.map(u => (
                                <div key={u.id}>{u.first_name} {u.last_name} ({u.role})</div>
                            ))}
                        </section>
                    )}

                    {results.registrations?.length > 0 && (
                        <section className="registrations-results">
                            <h3>Registrations ({results.registrations.length})</h3>
                            {results.registrations.map(r => (
                                <div key={r.id}>{r.email} - {r.status}</div>
                            ))}
                        </section>
                    )}
                </div>
            )}
        </div>
    );
}


// ============================================================================
// EXAMPLE 4: Search with Authentication Check
// ============================================================================

import { useEffect, useState } from 'react';
import useSearch from '../hooks/useSearch';
import { reindexSearch } from '../api';

function ProtectedSearchComponent() {
    const [isAuthorized, setIsAuthorized] = useState(false);
    const { results, error, search } = useSearch();

    // Check authorization when component mounts
    useEffect(() => {
        const token = localStorage.getItem('token');
        const userRole = localStorage.getItem('userRole');

        if (token && (userRole === 'Admin' || userRole === 'Faculty')) {
            setIsAuthorized(true);
            // Trigger reindex for authorized users
            reindexSearch().catch(console.error);
        }
    }, []);

    if (!isAuthorized) {
        return <div>Unauthorized: Search feature requires Admin or Faculty role.</div>;
    }

    return (
        <div>
            {/* Render search component only if authorized */}
            <SearchBar
                types="grades"
                onResults={(results) => console.log('Results:', results)}
            />

            {error && <div className="error">{error}</div>}
        </div>
    );
}


// ============================================================================
// EXAMPLE 5: Modal Search for Quick Lookup
// ============================================================================

import React, { useState, useEffect } from 'react';
import useSearch from '../hooks/useSearch';
import './SearchModal.css';

function SearchModal({ isOpen, onClose }) {
    const [query, setQuery] = useState('');
    const { search, results, loading } = useSearch();

    // Focus on input when modal opens
    useEffect(() => {
        if (isOpen) {
            setTimeout(() => {
                const input = document.getElementById('modal-search-input');
                if (input) input.focus();
            }, 100);
        }
    }, [isOpen]);

    // Perform search when query changes
    useEffect(() => {
        if (query.length >= 2) {
            search(query, { debounce: 200 });
        }
    }, [query, search]);

    if (!isOpen) return null;

    return (
        <div className="search-modal-overlay" onClick={onClose}>
            <div className="search-modal-content" onClick={(e) => e.stopPropagation()}>
                <button className="close-btn" onClick={onClose}>×</button>

                <input
                    id="modal-search-input"
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search grades, users, or registrations..."
                />

                {loading && <div>Searching...</div>}

                {results && (
                    <div className="modal-results">
                        {/* Display results in organized sections */}
                        {results.grades?.map(g => (
                            <div key={g.id} className="result-item grade">
                                <strong>{g.courseCode}</strong>
                                <p>{g.studentId} - {g.grade}</p>
                            </div>
                        ))}
                        {results.users?.map(u => (
                            <div key={u.id} className="result-item user">
                                <strong>{u.first_name} {u.last_name}</strong>
                                <p>{u.email} ({u.role})</p>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

// Usage in main App:
// function App() {
//     const [showSearch, setShowSearch] = useState(false);
//     return (
//         <>
//             <button onClick={() => setShowSearch(true)}>Search (Ctrl+K)</button>
//             <SearchModal isOpen={showSearch} onClose={() => setShowSearch(false)} />
//         </>
//     );
// }


// ============================================================================
// EXAMPLE 6: Initialization in App.js
// ============================================================================

import { useEffect } from 'react';
import { reindexSearch } from './api';

function App() {
    useEffect(() => {
        // Initialize search index on app load
        reindexSearch()
            .then(() => console.log('Search index initialized'))
            .catch(err => console.error('Failed to initialize search:', err));

        // Set up periodic reindexing (every 5 minutes)
        const reindexInterval = setInterval(() => {
            reindexSearch()
                .then(() => console.log('Search index refreshed'))
                .catch(err => console.error('Reindex failed:', err));
        }, 5 * 60 * 1000);

        return () => clearInterval(reindexInterval);
    }, []);

    return (
        <div className="app">
            {/* Your app components */}
        </div>
    );
}


// ============================================================================
// EXAMPLE 7: Custom Search Filter Component
// ============================================================================

import { useState, useCallback } from 'react';
import useSearch from '../hooks/useSearch';

function AdvancedSearchFilter() {
    const [filters, setFilters] = useState({
        courseCode: '',
        studentId: '',
        gradeStatus: 'all'
    });
    const { searchGradesOnly, results, loading } = useSearch();

    const handleSearch = useCallback(async () => {
        const filterObj = {
            ...(filters.courseCode && { courseCode: filters.courseCode }),
            ...(filters.studentId && { studentId: filters.studentId }),
            ...(filters.gradeStatus !== 'all' && { status: filters.gradeStatus })
        };

        // Search for any non-empty text, or use a wildcard
        const query = filters.courseCode || filters.studentId || '*';
        await searchGradesOnly(query, filterObj);
    }, [filters, searchGradesOnly]);

    return (
        <div className="advanced-filter">
            <div className="filter-group">
                <label>Course Code:</label>
                <input
                    type="text"
                    value={filters.courseCode}
                    onChange={(e) => setFilters({...filters, courseCode: e.target.value})}
                    placeholder="e.g., CS101"
                />
            </div>

            <div className="filter-group">
                <label>Student ID:</label>
                <input
                    type="text"
                    value={filters.studentId}
                    onChange={(e) => setFilters({...filters, studentId: e.target.value})}
                    placeholder="e.g., STU001"
                />
            </div>

            <div className="filter-group">
                <label>Status:</label>
                <select
                    value={filters.gradeStatus}
                    onChange={(e) => setFilters({...filters, gradeStatus: e.target.value})}
                >
                    <option value="all">All</option>
                    <option value="pending">Pending</option>
                    <option value="approved">Approved</option>
                    <option value="finalized">Finalized</option>
                </select>
            </div>

            <button onClick={handleSearch} disabled={loading}>
                {loading ? 'Searching...' : 'Search'}
            </button>

            {results?.grades && (
                <div className="results">
                    <p>Found {results.grades.length} results</p>
                </div>
            )}
        </div>
    );
}

export default AdvancedSearchFilter;
