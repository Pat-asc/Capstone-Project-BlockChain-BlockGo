/**
 * SearchBar Component - Reusable search interface
 * 
 * Usage:
 *   <SearchBar 
 *     placeholder="Search grades..." 
 *     types="grades"
 *     onResults={(results) => console.log(results)}
 *     showStats={true}
 *   />
 */

import React, { useState, useEffect } from 'react';
import useSearch from '../hooks/useSearch';
import './SearchBar.css';

const SearchBar = ({
    placeholder = 'Search across system...',
    types = 'grades,users,registrations',
    filters = {},
    onResults = null,
    onError = null,
    onSearchStart = null,
    showStats = false,
    debounceMs = 300,
    minCharacters = 2,
    maxResults = 50,
    className = ''
}) => {
    const [query, setQuery] = useState('');
    const { results, loading, error, stats, debouncedSearch, clearResults } = useSearch();

    // Handle search input change
    useEffect(() => {
        if (query.length >= minCharacters) {
            if (onSearchStart) onSearchStart();
            debouncedSearch(query, { types, filters, debounce: debounceMs });
        } else if (query.length === 0) {
            clearResults();
        }
    }, [query, types, filters, minCharacters, debounceMs, debouncedSearch, clearResults, onSearchStart]);

    // Notify parent of results
    useEffect(() => {
        if (results && onResults) {
            onResults(results);
        }
    }, [results, onResults]);

    // Notify parent of errors
    useEffect(() => {
        if (error && onError) {
            onError(error);
        }
    }, [error, onError]);

    const handleClear = () => {
        setQuery('');
        clearResults();
    };

    const resultCount = results ? Object.values(results).flat().length : 0;

    return (
        <div className={`search-bar-container ${className}`}>
            <div className="search-input-wrapper">
                <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={placeholder}
                    className={`search-input ${error ? 'error' : ''} ${loading ? 'loading' : ''}`}
                    disabled={loading}
                />
                
                {loading && <span className="search-spinner">⊙</span>}
                
                {query && (
                    <button
                        className="search-clear-btn"
                        onClick={handleClear}
                        title="Clear search"
                        type="button"
                    >
                        ✕
                    </button>
                )}
            </div>

            {error && (
                <div className="search-error">
                    <span className="error-icon">⚠</span>
                    {error}
                </div>
            )}

            {query.length > 0 && query.length < minCharacters && (
                <div className="search-hint">
                    Type at least {minCharacters} characters to search
                </div>
            )}

            {results && !loading && resultCount > 0 && (
                <div className="search-results-summary">
                    <span className="result-count">
                        Found {resultCount} result{resultCount !== 1 ? 's' : ''}
                    </span>
                    {results.grades && results.grades.length > 0 && (
                        <span className="result-type">Grades: {results.grades.length}</span>
                    )}
                    {results.users && results.users.length > 0 && (
                        <span className="result-type">Users: {results.users.length}</span>
                    )}
                    {results.registrations && results.registrations.length > 0 && (
                        <span className="result-type">Registrations: {results.registrations.length}</span>
                    )}
                </div>
            )}

            {results && !loading && resultCount === 0 && query.length >= minCharacters && (
                <div className="search-no-results">
                    No results found for "{query}"
                </div>
            )}

            {showStats && stats && (
                <div className="search-stats">
                    <small>
                        Index: {stats.gradesCount} grades, {stats.usersCount} users, {stats.registrationsCount} registrations
                    </small>
                </div>
            )}
        </div>
    );
};

export default SearchBar;
