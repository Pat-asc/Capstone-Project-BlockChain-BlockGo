# Search Index System Documentation

## Overview

The search index system provides fast, in-memory searching across grades, users, and registration requests. It includes:

- **Backend Search Service** (`middleware/searchService.js`) - Core search logic with fuzzy matching
- **API Endpoints** (`middleware/middleware.js`) - RESTful search endpoints
- **Frontend Integration** (`frontend/src/api.js`) - Search API wrapper functions
- **React Hook** (`frontend/src/hooks/useSearch.js`) - Custom hook for component integration
- **SearchBar Component** (`frontend/src/components/SearchBar.jsx`) - Reusable UI component

## Backend Setup

### Search Service Architecture

The `searchService.js` maintains three separate indices:
- **Grades Index**: Academic records from blockchain
- **Users Index**: User profiles from PostgreSQL
- **Registrations Index**: Pending registration requests

Each index is optimized for:
- Full-text search
- Fuzzy matching (typo tolerance)
- Custom filtering
- Fast lookups

### API Endpoints

#### 1. Reindex Search Data
**POST** `/api/search/reindex`
```
Authorization: Bearer {token}
```
Rebuilds search indices from current database and blockchain data.

**Response:**
```json
{
  "success": true,
  "stats": {
    "gradesCount": 125,
    "usersCount": 48,
    "registrationsCount": 12,
    "lastIndexTime": 1712345678000
  },
  "message": "Search index updated successfully"
}
```

#### 2. Global Search
**GET** `/api/search?q={query}&types={types}&filters={filters}`

**Parameters:**
- `q` (required): Search query string
- `types` (optional): Comma-separated types - `grades,users,registrations` (default: all)
- `filters` (optional): JSON object with type-specific filters

**Example:**
```
GET /api/search?q=john&types=users,registrations&filters={"role":"Student"}
```

**Response:**
```json
{
  "query": "john",
  "types": ["users", "registrations"],
  "results": {
    "users": [
      {
        "id": 1,
        "email": "john.doe@example.com",
        "first_name": "John",
        "last_name": "Doe",
        "role": "Student",
        "mspid": "StudentMSP"
      }
    ],
    "registrations": [
      {
        "id": 5,
        "email": "john.smith@example.com",
        "first_name": "John",
        "last_name": "Smith",
        "role": "Faculty",
        "status": "pending",
        "created_at": "2024-04-01T10:30:00Z"
      }
    ]
  },
  "stats": {
    "gradesCount": 125,
    "usersCount": 48,
    "registrationsCount": 12,
    "lastIndexTime": 1712345678000
  }
}
```

#### 3. Search Grades
**GET** `/api/search/grades?q={query}&filters={filters}`

**Available Filters:**
- `studentId`: Filter by student ID
- `courseCode`: Filter by course code
- `status`: Filter by grade status
- `issuedBy`: Filter by issuer

**Example:**
```
GET /api/search/grades?q=CS101&filters={"status":"approved"}
```

#### 4. Search Users
**GET** `/api/search/users?q={query}&filters={filters}`

**Available Filters:**
- `role`: Filter by role (Student, Faculty, Admin, etc.)
- `mspid`: Filter by MSP ID

**Example:**
```
GET /api/search/users?q=admin&filters={"role":"Faculty"}
```

#### 5. Search Registrations
**GET** `/api/search/registrations?q={query}&filters={filters}`

**Available Filters:**
- `status`: Filter by status (pending, approved, rejected)
- `role`: Filter by role

**Example:**
```
GET /api/search/registrations?q=jane&filters={"status":"pending"}
```

#### 6. Get Search Stats
**GET** `/api/search/stats`

Returns current index statistics without reindexing.

---

## Frontend Usage

### Option 1: Using the SearchBar Component

```jsx
import SearchBar from './components/SearchBar';
import { useState } from 'react';

function MyPage() {
    const [searchResults, setSearchResults] = useState(null);

    return (
        <SearchBar
            placeholder="Search grades, users, or registrations..."
            types="grades,users,registrations"
            onResults={(results) => setSearchResults(results)}
            showStats={true}
            debounceMs={300}
            minCharacters={2}
        />
    );
}
```

**SearchBar Props:**
- `placeholder` (string): Placeholder text
- `types` (string): Comma-separated search types
- `filters` (object): Additional filters
- `onResults` (function): Callback when results update
- `onError` (function): Callback for errors
- `onSearchStart` (function): Callback when search starts
- `showStats` (boolean): Show index statistics
- `debounceMs` (number): Debounce delay in milliseconds
- `minCharacters` (number): Minimum characters before search
- `className` (string): Additional CSS classes

### Option 2: Using the useSearch Hook

```jsx
import useSearch from './hooks/useSearch';
import { useEffect, useState } from 'react';

function MyComponent() {
    const [query, setQuery] = useState('');
    const { results, loading, error, search, debouncedSearch } = useSearch();

    // Custom search as user types
    useEffect(() => {
        if (query.length >= 2) {
            debouncedSearch(query, {
                types: 'grades',
                filters: { status: 'approved' },
                debounce: 300
            });
        }
    }, [query, debouncedSearch]);

    return (
        <div>
            <input 
                value={query} 
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search grades..."
            />
            
            {loading && <p>Searching...</p>}
            {error && <p>Error: {error}</p>}
            
            {results?.grades?.map(grade => (
                <div key={grade.id}>
                    {grade.studentId} - {grade.courseCode}: {grade.grade}
                </div>
            ))}
        </div>
    );
}
```

### Hook Methods

```javascript
const {
    // State
    results,          // Current search results
    loading,          // Loading state
    error,            // Error message
    stats,            // Index statistics

    // Methods
    search,                   // Full search with options
    debouncedSearch,          // Debounced search
    searchGradesOnly,         // Search grades only
    searchUsersOnly,          // Search users only
    searchRegistrationsOnly,  // Search registrations only
    reindex,                  // Reindex all data
    fetchStats,               // Get index stats
    clearResults,             // Clear current results
    getResultCount            // Get total result count
} = useSearch();
```

### Direct API Functions (from api.js)

```javascript
import {
    globalSearch,
    searchGrades,
    searchUsers,
    searchRegistrations,
    reindexSearch,
    getSearchStats
} from './api';

// Global search
const results = await globalSearch('john', 'users,registrations', { role: 'Faculty' });

// Specific searches
const grades = await searchGrades('CS101', { status: 'approved' });
const users = await searchUsers('admin', { role: 'Faculty' });
const registrations = await searchRegistrations('pending', { status: 'pending' });

// Maintenance
const indexData = await reindexSearch();
const stats = await getSearchStats();
```

---

## Search Features

### Full-Text Search
Searches across concatenated fields for each record type:

**Grades:** StudentID + CourseCode + CourseName + Grade + Status
**Users:** Email + FirstName + LastName + Role + MSPID
**Registrations:** Email + FirstName + LastName + Role + Status

### Fuzzy Matching
Provides typo tolerance. For example, searching "jon" will match "john".

### Filtering
Apply specific filters based on record type:

```javascript
// Search for approved grades by specific student
await searchGrades('CS101', { 
    studentId: 'STU001',
    status: 'approved' 
});

// Search for faculty users in Engineering
await searchUsers('Dr.', {
    role: 'Faculty',
    mspid: 'EngineeringMSP'
});
```

### Case-Insensitive
All searches are case-insensitive by default.

### Real-Time Indexing
Call `/api/search/reindex` periodically (e.g., every 5-10 minutes) or when significant data changes occur.

---

## Best Practices

### 1. Reindex Regularly
```javascript
// In your app initialization or main component
useEffect(() => {
    const reindexInterval = setInterval(() => {
        reindexSearch().catch(err => console.error('Reindex failed:', err));
    }, 5 * 60 * 1000); // Every 5 minutes

    return () => clearInterval(reindexInterval);
}, []);
```

### 2. Use Debouncing for Type-Ahead
```javascript
// Built into SearchBar and useSearch hook
<SearchBar debounceMs={300} /> // Wait 300ms after user stops typing
```

### 3. Combine SearchBar with Results Display
```jsx
function GradesPage() {
    const [results, setResults] = useState(null);

    return (
        <>
            <SearchBar 
                types="grades"
                onResults={setResults}
            />
            
            {results?.grades?.map(grade => (
                <GradeCard key={grade.id} grade={grade} />
            ))}
        </>
    );
}
```

### 4. Handle Large Result Sets
```javascript
// Limit displayed results in UI
const displayLimit = 20;
const displayedResults = results?.grades?.slice(0, displayLimit);
```

### 5. Cache Search Stats
```javascript
const { stats, fetchStats } = useSearch();

useEffect(() => {
    fetchStats().catch(console.error);
}, [fetchStats]);

if (stats) {
    console.log(`Database has ${stats.gradesCount} grades`);
}
```

---

## Performance Considerations

- **In-Memory Index**: Searches are extremely fast (O(n) where n = records of type)
- **Fuzzy Matching**: Adds ~10% overhead but very tolerable for typical datasets
- **Debouncing**: Prevents excessive API calls during typing
- **Reindexing**: Background operation, doesn't block searches

---

## Troubleshooting

### Search returns no results
1. Verify query has at least 2 characters (default minimum)
2. Check that index has been populated: `GET /api/search/stats`
3. Try reindexing: `POST /api/search/reindex`

### Index is stale
- Manually trigger reindex: `POST /api/search/reindex`
- Set up auto-reindex interval (recommended: 5-10 minutes)

### Authorization errors
- Ensure JWT token is in localStorage under key `token`
- Token must be valid and not expired
- User must have appropriate role permissions

### Performance issues
- Reduce `minCharacters` prop to prevent unnecessary searches
- Increase `debounceMs` to reduce API call frequency
- Consider pagination for large result sets
