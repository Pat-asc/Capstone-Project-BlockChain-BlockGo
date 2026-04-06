/**
 * Search Index System - Testing Guide
 * 
 * Use this guide to test the search functionality at various levels
 */

// ============================================================================
// BACKEND TESTING (via cURL or Postman)
// ============================================================================

/**
 * Test 1: Reindex Search Data
 * 
 * This rebuilds the search index from current database and blockchain state.
 */
curl -X POST http://localhost:4000/api/search/reindex \
  -H "Authorization: Bearer {YOUR_JWT_TOKEN}" \
  -H "Content-Type: application/json"

// Expected Response:
// {
//   "success": true,
//   "stats": {
//     "gradesCount": 125,
//     "usersCount": 48,
//     "registrationsCount": 12,
//     "lastIndexTime": 1712345678000
//   },
//   "message": "Search index updated successfully"
// }


/**
 * Test 2: Get Search Statistics
 * 
 * Shows current index statistics without reindexing
 */
curl -X GET http://localhost:4000/api/search/stats \
  -H "Authorization: Bearer {YOUR_JWT_TOKEN}"

// Expected Response:
// {
//   "gradesCount": 125,
//   "usersCount": 48,
//   "registrationsCount": 12,
//   "lastIndexTime": 1712345678000
// }


/**
 * Test 3: Global Search
 * 
 * Search across all data types
 */
curl -X GET "http://localhost:4000/api/search?q=john&types=users,registrations" \
  -H "Authorization: Bearer {YOUR_JWT_TOKEN}"

// Expected Response:
// {
//   "query": "john",
//   "types": ["users", "registrations"],
//   "results": {
//     "users": [
//       {
//         "id": 1,
//         "email": "john.doe@example.com",
//         "first_name": "John",
//         "last_name": "Doe",
//         "role": "Student",
//         "mspid": "StudentMSP"
//       }
//     ],
//     "registrations": []
//   },
//   "stats": {...}
// }


/**
 * Test 4: Search Grades with Filters
 * 
 * Search grades with filters
 */
curl -X GET "http://localhost:4000/api/search/grades?q=CS101&filters={\"status\":\"approved\"}" \
  -H "Authorization: Bearer {YOUR_JWT_TOKEN}"

// Expected Response:
// {
//   "query": "CS101",
//   "results": [
//     {
//       "id": "grade-123",
//       "studentId": "STU001",
//       "courseCode": "CS101",
//       "courseName": "Introduction to Computer Science",
//       "grade": "A",
//       "status": "approved",
//       "issuedBy": "prof-001",
//       "timestamp": "2024-04-01T10:30:00Z"
//     }
//   ],
//   "count": 1
// }


/**
 * Test 5: Search Users
 */
curl -X GET "http://localhost:4000/api/search/users?q=admin&filters={\"role\":\"Faculty\"}" \
  -H "Authorization: Bearer {YOUR_JWT_TOKEN}"


/**
 * Test 6: Search Registrations
 */
curl -X GET "http://localhost:4000/api/search/registrations?q=jane&filters={\"status\":\"pending\"}" \
  -H "Authorization: Bearer {YOUR_JWT_TOKEN}"


// ============================================================================
// FRONTEND TESTING (Browser Console)
// ============================================================================

/**
 * Test 1: Import and test API functions directly
 */
import * as api from './src/api.js';

// Reindex search data
await api.reindexSearch();

// Get search stats
const stats = await api.getSearchStats();
console.log('Index stats:', stats);

// Global search
const results = await api.globalSearch('john', 'users,registrations');
console.log('Global search results:', results);

// Search grades
const grades = await api.searchGrades('CS101', { status: 'approved' });
console.log('Grade search results:', grades);

// Search users
const users = await api.searchUsers('admin', { role: 'Faculty' });
console.log('User search results:', users);

// Search registrations
const regs = await api.searchRegistrations('pending', { status: 'pending' });
console.log('Registration search results:', regs);


/**
 * Test 2: Test useSearch hook in React component
 */

// Create a test component
import React from 'react';
import useSearch from './hooks/useSearch';

function SearchTest() {
    const { search, searchGradesOnly, results, loading, error, getResultCount } = useSearch();

    const handleTest = async () => {
        console.log('Testing useSearch hook...');

        // Test 1: Search grades
        console.log('Test 1: Search grades');
        await searchGradesOnly('CS101', { status: 'approved' });
        console.log('Results:', results);

        // Test 2: Global search
        console.log('Test 2: Global search');
        await search('john', { 
            types: 'users,registrations',
            debounce: 100 
        });
        console.log('Results:', results);
        console.log('Result count:', getResultCount());
    };

    return (
        <div>
            <button onClick={handleTest}>Run Search Tests</button>
            {loading && <p>Loading...</p>}
            {error && <p>Error: {error}</p>}
            {results && <p>Results: {JSON.stringify(results, null, 2)}</p>}
        </div>
    );
}


/**
 * Test 3: Test SearchBar component
 */

// Create a test page
import React, { useState } from 'react';
import SearchBar from './components/SearchBar';

function SearchBarTest() {
    const [results, setResults] = useState(null);

    return (
        <div>
            <h1>SearchBar Component Test</h1>
            
            <SearchBar
                placeholder="Test search..."
                types="grades,users,registrations"
                onResults={setResults}
                showStats={true}
                debounceMs={300}
            />

            {results && (
                <pre>{JSON.stringify(results, null, 2)}</pre>
            )}
        </div>
    );
}


// ============================================================================
// PERFORMANCE TESTING
// ============================================================================

/**
 * Test search performance with large datasets
 */

const performanceTest = async () => {
    // Measure reindex time
    console.time('Reindex');
    await api.reindexSearch();
    console.timeEnd('Reindex');

    // Measure search time
    console.time('Search: single character');
    await api.globalSearch('c', 'grades,users,registrations');
    console.timeEnd('Search: single character');

    console.time('Search: two characters');
    await api.globalSearch('cs', 'grades,users,registrations');
    console.timeEnd('Search: two characters');

    console.time('Search: specific course code');
    await api.searchGrades('CS101', { status: 'approved' });
    console.timeEnd('Search: specific course code');

    // Measure debounced search time with multiple calls
    console.time('Debounced search (5 calls)');
    for (let i = 1; i <= 5; i++) {
        await api.globalSearch('test' + i, 'users');
    }
    console.timeEnd('Debounced search (5 calls)');
};


// ============================================================================
// INTEGRATION TESTING CHECKLIST
// ============================================================================

/*

1. BACKEND API TESTS
   ☐ Verify /api/search/reindex endpoint exists
   ☐ Verify /api/search endpoint works
   ☐ Verify /api/search/grades endpoint works
   ☐ Verify /api/search/users endpoint works
   ☐ Verify /api/search/registrations endpoint works
   ☐ Verify /api/search/stats endpoint works
   ☐ Verify all endpoints require JWT authentication
   ☐ Verify filters work correctly
   ☐ Verify fuzzy matching works
   ☐ Verify case-insensitive search works

2. FRONTEND API FUNCTION TESTS
   ☐ globalSearch() returns correct results
   ☐ searchGrades() returns correct results
   ☐ searchUsers() returns correct results
   ☐ searchRegistrations() returns correct results
   ☐ reindexSearch() successfully reindexes
   ☐ getSearchStats() returns valid stats

3. REACT HOOK TESTS
   ☐ useSearch hook initializes correctly
   ☐ search() method returns results
   ☐ debouncedSearch() delays execution
   ☐ searchGradesOnly() returns only grades
   ☐ searchUsersOnly() returns only users
   ☐ searchRegistrationsOnly() returns only registrations
   ☐ reindex() updates stats
   ☐ fetchStats() gets current stats
   ☐ clearResults() clears state
   ☐ getResultCount() returns correct count
   ☐ Error handling works correctly
   ☐ Loading states update correctly

4. COMPONENT TESTS  
   ☐ SearchBar component renders
   ☐ SearchBar input works
   ☐ SearchBar displays results
   ☐ SearchBar shows loading state
   ☐ SearchBar shows error state
   ☐ SearchBar clear button works
   ☐ SearchBar respects minCharacters prop
   ☐ SearchBar respects debounceMs prop
   ☐ SearchBar respects types prop
   ☐ SearchBar shows stats when enabled

5. PERFORMANCE TESTS
   ☐ Search completes in < 100ms for small queries
   ☐ Reindex completes in reasonable time
   ☐ Debouncing works (verify API calls reduced)
   ☐ Memory usage stays reasonable
   ☐ No memory leaks on repeated searches

6. EDGE CASES
   ☐ Empty search query handled
   ☐ Very long search queries handled
   ☐ Special characters in search handled
   ☐ Non-existent data returns empty results
   ☐ Null/undefined filters handled
   ☐ Unauthorized requests rejected
   ☐ Token expiration handled
   ☐ Network errors handled gracefully

7. INTEGRATION TESTS
   ☐ Search works in GradesDashboard
   ☐ Search works in UserManagement
   ☐ Search works in RegistrationPage
   ☐ Auto-reindex updates data correctly
   ☐ Search reflects newly added data

*/

// ============================================================================
// DEBUGGING TIPS
// ============================================================================

/*

1. Enable verbose logging
   - In searchService.js, add console.log statements in _searchGrades, etc.
   - In useSearch hook, log all state changes

2. Check index state
   - In browser console: await api.getSearchStats()
   - Check that gradesCount, usersCount, registrationsCount > 0

3. Verify data is indexed
   - Reindex: await api.reindexSearch()
   - Check stats again

4. Test individual searches
   - Try searching for known values
   - Check fuzzy matching: search 'jon' to find 'john'
   - Check filters: search with status filter, etc.

5. Monitor API calls
   - Open browser DevTools Network tab
   - Watch for search requests
   - Check response payloads

6. Check authentication
   - Verify JWT token in localStorage
   - Check token expiration
   - Try with Authorization header in Postman

7. Performance monitoring
   - Use console.time/console.timeEnd
   - Profile in DevTools Performance tab
   - Check Memory tab for memory leaks

*/
