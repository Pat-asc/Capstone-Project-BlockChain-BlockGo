/**
 * useSearch - Custom React Hook for search functionality
 * 
 * Usage:
 *   const { results, loading, error, search, reindex } = useSearch();
 *   
 *   // Perform search
 *   await search('student123', { types: 'grades', filters: { status: 'approved' } });
 *   
 *   // Initialize/refresh index
 *   await reindex();
 */

import { useState, useCallback, useRef } from 'react';
import {
    globalSearch,
    searchGrades,
    searchUsers,
    searchRegistrations,
    reindexSearch,
    getSearchStats
} from './api';

const useSearch = () => {
    const [results, setResults] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [stats, setStats] = useState(null);
    const searchTimeoutRef = useRef(null);

    /**
     * Perform a search
     * @param {string} query - Search query
     * @param {Object} options - { types: 'grades,users,registrations', filters: {...}, debounce: ms }
     */
    const search = useCallback(async (query, options = {}) => {
        const {
            types = 'grades,users,registrations',
            filters = {},
            debounce = 300
        } = options;

        return new Promise((resolve, reject) => {
            // Clear previous timeout
            if (searchTimeoutRef.current) {
                clearTimeout(searchTimeoutRef.current);
            }

            // Set timeout for debouncing
            searchTimeoutRef.current = setTimeout(async () => {
                try {
                    setLoading(true);
                    setError(null);

                    if (!query || !query.trim()) {
                        setResults(null);
                        resolve(null);
                        return;
                    }

                    // Route to appropriate search function
                    const typeArray = types.split(',').map(t => t.trim());
                    
                    let data;
                    if (typeArray.length === 1) {
                        // Single type search for better UX
                        const type = typeArray[0];
                        if (type === 'grades') {
                            data = await searchGrades(query, filters);
                        } else if (type === 'users') {
                            data = await searchUsers(query, filters);
                        } else if (type === 'registrations') {
                            data = await searchRegistrations(query, filters);
                        }
                        data = { [type]: data?.results || data || [] };
                    } else {
                        // Multi-type search
                        data = await globalSearch(query, types, filters);
                    }

                    setResults(data);
                    resolve(data);
                } catch (err) {
                    const errorMsg = err.message || 'Search failed';
                    setError(errorMsg);
                    console.error('[useSearch] Error:', err);
                    reject(err);
                } finally {
                    setLoading(false);
                }
            }, debounce);
        });
    }, []);

    /**
     * Search with debounce already built in
     * Useful for real-time search on input change
     */
    const debouncedSearch = useCallback((query, options = {}) => {
        return search(query, { ...options, debounce: options.debounce || 300 });
    }, [search]);

    /**
     * Perform a quick search for grades only
     */
    const searchGradesOnly = useCallback(async (query, filters = {}) => {
        try {
            setLoading(true);
            setError(null);

            if (!query || !query.trim()) {
                setResults(null);
                return null;
            }

            const data = await searchGrades(query, filters);
            setResults({ grades: data?.results || data || [] });
            return data;
        } catch (err) {
            setError(err.message || 'Search failed');
            console.error('[useSearch] Grades search error:', err);
            throw err;
        } finally {
            setLoading(false);
        }
    }, []);

    /**
     * Perform a quick search for users only
     */
    const searchUsersOnly = useCallback(async (query, filters = {}) => {
        try {
            setLoading(true);
            setError(null);

            if (!query || !query.trim()) {
                setResults(null);
                return null;
            }

            const data = await searchUsers(query, filters);
            setResults({ users: data?.results || data || [] });
            return data;
        } catch (err) {
            setError(err.message || 'Search failed');
            console.error('[useSearch] Users search error:', err);
            throw err;
        } finally {
            setLoading(false);
        }
    }, []);

    /**
     * Perform a quick search for registrations only
     */
    const searchRegistrationsOnly = useCallback(async (query, filters = {}) => {
        try {
            setLoading(true);
            setError(null);

            if (!query || !query.trim()) {
                setResults(null);
                return null;
            }

            const data = await searchRegistrations(query, filters);
            setResults({ registrations: data?.results || data || [] });
            return data;
        } catch (err) {
            setError(err.message || 'Search failed');
            console.error('[useSearch] Registrations search error:', err);
            throw err;
        } finally {
            setLoading(false);
        }
    }, []);

    /**
     * Reindex the search database
     */
    const reindex = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);

            const data = await reindexSearch();
            if (data && data.stats) {
                setStats(data.stats);
            }
            return data;
        } catch (err) {
            setError(err.message || 'Reindex failed');
            console.error('[useSearch] Reindex error:', err);
            throw err;
        } finally {
            setLoading(false);
        }
    }, []);

    /**
     * Fetch current search stats
     */
    const fetchStats = useCallback(async () => {
        try {
            const data = await getSearchStats();
            setStats(data);
            return data;
        } catch (err) {
            console.error('[useSearch] Stats fetch error:', err);
            throw err;
        }
    }, []);

    /**
     * Clear search results
     */
    const clearResults = useCallback(() => {
        setResults(null);
        setError(null);
    }, []);

    /**
     * Get total result count
     */
    const getResultCount = useCallback(() => {
        if (!results) return 0;
        return (
            (results.grades?.length || 0) +
            (results.users?.length || 0) +
            (results.registrations?.length || 0)
        );
    }, [results]);

    return {
        // State
        results,
        loading,
        error,
        stats,

        // Methods
        search,
        debouncedSearch,
        searchGradesOnly,
        searchUsersOnly,
        searchRegistrationsOnly,
        reindex,
        fetchStats,
        clearResults,
        getResultCount
    };
};

export default useSearch;
