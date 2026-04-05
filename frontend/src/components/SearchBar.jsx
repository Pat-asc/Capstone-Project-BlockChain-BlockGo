// src/components/SearchBar.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Unified Search Index component for the PLV BlockGo system.
//
// Security fixes applied:
//   [M1] Role gating uses loggedInRole (JWT claim) — not email substring matching
//   [H2] Minimum 2-char query enforced before debounce fires (server also enforces)
//   [L2] Highlight regex memoized with useMemo — not recompiled every render
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { searchIndex } from '../services/api';

// ── Helpers ───────────────────────────────────────────────────────────────────

const debounce = (fn, delay) => {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
    };
};

const STATUS_COLORS = {
    Finalized:          { bg: '#e6f4ea', color: '#1e8e3e' },
    DepartmentApproved: { bg: '#e8f0fe', color: '#1967d2' },
    Issued:             { bg: '#fef7e0', color: '#b08d00' },
    Corrected:          { bg: '#fff3e0', color: '#e65100' },
    active:             { bg: '#e6f4ea', color: '#1e8e3e' },
    pending:            { bg: '#fef7e0', color: '#b08d00' },
    suspended:          { bg: '#ffebee', color: '#d32f2f' },
};

const Badge = ({ label }) => {
    const style = STATUS_COLORS[label] || { bg: '#f1f3f4', color: '#5f6368' };
    return (
        <span style={{
            backgroundColor: style.bg, color: style.color,
            padding: '3px 10px', borderRadius: '20px',
            fontSize: '0.78em', fontWeight: 'bold', whiteSpace: 'nowrap',
        }}>
            {label}
        </span>
    );
};

const SourceTag = ({ source }) => {
    const labels = {
        'blockchain':        { label: '⛓ Blockchain', bg: '#e3f2fd', color: '#1565c0' },
        'postgres:users':    { label: '🗄 Users DB',   bg: '#f3e5f5', color: '#6a1b9a' },
        'postgres:profiles': { label: '👤 Profiles',   bg: '#e8f5e9', color: '#2e7d32' },
    };
    const tag = labels[source] || { label: source, bg: '#f5f5f5', color: '#555' };
    return (
        <span style={{
            backgroundColor: tag.bg, color: tag.color,
            padding: '2px 8px', borderRadius: '4px',
            fontSize: '0.72em', fontWeight: 'bold',
        }}>
            {tag.label}
        </span>
    );
};

// [L2] Highlight receives a pre-built memoized regex — never recompiled per cell.
const Highlight = ({ text = '', regex }) => {
    if (!regex || !text) return <span>{String(text)}</span>;
    const parts = String(text).split(regex);
    return (
        <span>
            {parts.map((part, i) =>
                regex.test(part)
                    ? <mark key={i} style={{ backgroundColor: '#fff59d', padding: 0, borderRadius: '2px' }}>{part}</mark>
                    : <span key={i}>{part}</span>
            )}
        </span>
    );
};

// ── Sub-tables ────────────────────────────────────────────────────────────────

const GradesTable = ({ data, regex }) => (
    <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9em' }}>
            <thead>
                <tr style={{ backgroundColor: '#003366', color: 'white' }}>
                    {['Record ID','Student','Subject','Course','Grade','Semester','Faculty','Status','Source'].map(h => (
                        <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: '600', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {data.map((g, i) => (
                    <tr key={g.id || i} style={{ backgroundColor: i % 2 === 0 ? '#fff' : '#f8f9fa', borderBottom: '1px solid #eee' }}>
                        <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontSize: '0.85em', color: '#555' }}>
                            <Highlight text={g.id} regex={regex} />
                        </td>
                        <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontSize: '0.82em', color: '#666', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={g.student}>
                            <Highlight text={g.student} regex={regex} />
                        </td>
                        <td style={{ padding: '10px 14px', fontWeight: 'bold' }}>
                            <Highlight text={g.subject_code} regex={regex} />
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                            <Highlight text={g.course} regex={regex} />
                        </td>
                        <td style={{ padding: '10px 14px', fontWeight: '900', fontSize: '1.05em' }}>{g.grade}</td>
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: '#555' }}>{g.semester} {g.school_year}</td>
                        <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontSize: '0.82em', color: '#666', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={g.faculty_id}>
                            <Highlight text={g.faculty_id} regex={regex} />
                        </td>
                        <td style={{ padding: '10px 14px' }}><Badge label={g.status} /></td>
                        <td style={{ padding: '10px 14px' }}><SourceTag source={g._source} /></td>
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
);

const UsersTable = ({ data, regex }) => (
    <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9em' }}>
            <thead>
                <tr style={{ backgroundColor: '#4a148c', color: 'white' }}>
                    {['ID','Email','Role','Status','Created','Source'].map(h => (
                        <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: '600' }}>{h}</th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {data.map((u, i) => (
                    <tr key={u.id || i} style={{ backgroundColor: i % 2 === 0 ? '#fff' : '#f8f9fa', borderBottom: '1px solid #eee' }}>
                        <td style={{ padding: '10px 14px', color: '#888', fontSize: '0.85em' }}>{u.id}</td>
                        <td style={{ padding: '10px 14px' }}><Highlight text={u.email} regex={regex} /></td>
                        <td style={{ padding: '10px 14px', fontWeight: 'bold', textTransform: 'capitalize' }}>{u.role}</td>
                        <td style={{ padding: '10px 14px' }}><Badge label={u.status} /></td>
                        <td style={{ padding: '10px 14px', color: '#888', fontSize: '0.85em', whiteSpace: 'nowrap' }}>
                            {u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}
                        </td>
                        <td style={{ padding: '10px 14px' }}><SourceTag source={u._source} /></td>
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
);

const ProfilesTable = ({ data, regex }) => (
    <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9em' }}>
            <thead>
                <tr style={{ backgroundColor: '#1b5e20', color: 'white' }}>
                    {['Name','Email','Type','Student No.','Department','Section / Level','Source'].map(h => (
                        <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: '600' }}>{h}</th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {data.map((p, i) => (
                    <tr key={`${p.profile_id}-${p.profile_type}` || i} style={{ backgroundColor: i % 2 === 0 ? '#fff' : '#f8f9fa', borderBottom: '1px solid #eee' }}>
                        <td style={{ padding: '10px 14px', fontWeight: 'bold' }}><Highlight text={p.full_name} regex={regex} /></td>
                        <td style={{ padding: '10px 14px', color: '#555' }}><Highlight text={p.email} regex={regex} /></td>
                        <td style={{ padding: '10px 14px', textTransform: 'capitalize', color: '#333' }}>{p.profile_type}</td>
                        <td style={{ padding: '10px 14px', color: '#888' }}>{p.student_no || '—'}</td>
                        <td style={{ padding: '10px 14px' }}><Highlight text={p.department} regex={regex} /></td>
                        <td style={{ padding: '10px 14px' }}><Highlight text={p.section || p.assignment_status} regex={regex} /></td>
                        <td style={{ padding: '10px 14px' }}><SourceTag source={p._source} /></td>
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
);

// ── Pagination ────────────────────────────────────────────────────────────────

const Pagination = ({ total, page, limit, onPageChange }) => {
    const totalPages = Math.ceil(total / limit);
    if (totalPages <= 1) return null;
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 14px', borderTop: '1px solid #eee', fontSize: '0.85em' }}>
            <button disabled={page <= 1} onClick={() => onPageChange(page - 1)}
                style={{ padding: '4px 10px', borderRadius: 4, border: '1px solid #ccc', cursor: page <= 1 ? 'not-allowed' : 'pointer', background: page <= 1 ? '#f5f5f5' : 'white' }}>
                ‹ Prev
            </button>
            <span style={{ color: '#555' }}>Page {page} of {totalPages} ({total} results)</span>
            <button disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}
                style={{ padding: '4px 10px', borderRadius: 4, border: '1px solid #ccc', cursor: page >= totalPages ? 'not-allowed' : 'pointer', background: page >= totalPages ? '#f5f5f5' : 'white' }}>
                Next ›
            </button>
        </div>
    );
};

// ── Section Wrapper ───────────────────────────────────────────────────────────

const ResultSection = ({ title, icon, result, regex, TableComponent, accentColor, page, onPageChange }) => {
    const [collapsed, setCollapsed] = useState(false);
    if (!result || result.total === 0) return null;
    return (
        <div style={{ marginBottom: 20, border: '1px solid #e0e0e0', borderRadius: 8, overflow: 'hidden', boxShadow: '0 2px 6px rgba(0,0,0,0.06)' }}>
            <div onClick={() => setCollapsed(c => !c)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', backgroundColor: accentColor, color: 'white', cursor: 'pointer', userSelect: 'none' }}>
                <span style={{ fontWeight: 'bold', fontSize: '0.95em' }}>{icon} {title}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ backgroundColor: 'rgba(255,255,255,0.25)', padding: '2px 10px', borderRadius: 20, fontSize: '0.82em', fontWeight: 'bold' }}>
                        {result.total} result{result.total !== 1 ? 's' : ''}
                    </span>
                    <span style={{ fontSize: '0.8em' }}>{collapsed ? '▶' : '▼'}</span>
                </span>
            </div>
            {!collapsed && (
                <>
                    <TableComponent data={result.data} regex={regex} />
                    <Pagination total={result.total} page={page} limit={result.limit} onPageChange={onPageChange} />
                </>
            )}
        </div>
    );
};

// ── Main Component ────────────────────────────────────────────────────────────
// Props:
//   loggedInEmail  {string} – caller's email (display only, never used for access gating)
//   loggedInRole   {string} – MSP role from decoded JWT e.g. 'RegistrarMSP'
//
// [M1] The parent component MUST pass loggedInRole decoded from the JWT token.
//      Do NOT derive it from the email string. Example in GradesDashboard:
//        const decoded = jwt_decode(localStorage.getItem('token'));
//        <SearchBar loggedInEmail={decoded.username} loggedInRole={decoded.role} />

const SearchBar = ({ loggedInEmail, loggedInRole }) => {
    const [inputValue, setInputValue]       = useState('');
    const [activeQuery, setActiveQuery]     = useState('');
    const [typeFilter, setTypeFilter]       = useState('all');
    const [loading, setLoading]             = useState(false);
    const [results, setResults]             = useState(null);
    const [error, setError]                 = useState(null);
    const [validationMsg, setValidationMsg] = useState('');

    const [gradePages, setGradePages]       = useState(1);
    const [userPages, setUserPages]         = useState(1);
    const [profilePages, setProfilePages]   = useState(1);

    const inputRef = useRef(null);

    // [M1] Gating based solely on JWT role claim passed as prop
    const isRegistrar            = loggedInRole === 'RegistrarMSP';
    const canSearchUsersAndProfiles = isRegistrar;

    // [L2] Build highlight regex once per committed query — memoized, not per-cell
    const highlightRegex = useMemo(() => {
        if (!activeQuery || activeQuery.length < 2) return null;
        const escaped = activeQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(${escaped})`, 'gi');
    }, [activeQuery]);

    const runSearch = useCallback(async (query, type, gPage, uPage, pPage) => {
        if (!query || query.trim().length < 2) { setResults(null); return; }
        setLoading(true);
        setError(null);
        try {
            const res = await searchIndex({ query, type, page: gPage, limit: 20 });
            setResults(res.results);
        } catch (err) {
            setError(err.message);
            setResults(null);
        } finally {
            setLoading(false);
        }
    }, []);

    // eslint-disable-next-line react-hooks/exhaustive-deps
    const debouncedSearch = useCallback(
        debounce((q, t) => {
            setGradePages(1); setUserPages(1); setProfilePages(1);
            runSearch(q, t, 1, 1, 1);
        }, 420),
        [runSearch]
    );

    const handleInput = (e) => {
        const val = e.target.value;
        setInputValue(val);

        // [H2] Gate: show hint and suppress API call for < 2 chars
        if (val.trim().length > 0 && val.trim().length < 2) {
            setValidationMsg('Enter at least 2 characters to search.');
            setResults(null);
            return;
        }
        setValidationMsg('');
        setActiveQuery(val);
        debouncedSearch(val, typeFilter);
    };

    const handleTypeChange = (e) => {
        const t = e.target.value;
        setTypeFilter(t);
        setGradePages(1); setUserPages(1); setProfilePages(1);
        if (activeQuery.trim().length >= 2) runSearch(activeQuery, t, 1, 1, 1);
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (inputValue.trim().length < 2) {
            setValidationMsg('Enter at least 2 characters to search.');
            return;
        }
        setValidationMsg('');
        setGradePages(1); setUserPages(1); setProfilePages(1);
        setActiveQuery(inputValue);
        runSearch(inputValue, typeFilter, 1, 1, 1);
    };

    const handleClear = () => {
        setInputValue(''); setActiveQuery('');
        setResults(null); setError(null); setValidationMsg('');
        inputRef.current?.focus();
    };

    const handleGradePage   = (p) => { setGradePages(p);   runSearch(activeQuery, typeFilter, p, userPages, profilePages); };
    const handleUserPage    = (p) => { setUserPages(p);    runSearch(activeQuery, typeFilter, gradePages, p, profilePages); };
    const handleProfilePage = (p) => { setProfilePages(p); runSearch(activeQuery, typeFilter, gradePages, userPages, p); };

    const totalHits =
        (results?.grades?.total   || 0) +
        (results?.users?.total    || 0) +
        (results?.profiles?.total || 0);

    useEffect(() => {
        const onKey = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                inputRef.current?.focus();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    return (
        <div style={{ fontFamily: "'Inter', 'Segoe UI', sans-serif" }}>

            {/* ── Search Input Row ── */}
            <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                <div style={{ position: 'relative', flex: 1 }}>
                    <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: '1em', color: '#888', pointerEvents: 'none' }}>🔍</span>
                    <input
                        ref={inputRef}
                        type="text"
                        value={inputValue}
                        onChange={handleInput}
                        maxLength={100}
                        placeholder="Search grades, student IDs, subject codes, names… (Ctrl+K)"
                        style={{
                            width: '100%',
                            padding: '11px 40px 11px 38px',
                            borderRadius: 6,
                            border: `1.5px solid ${validationMsg ? '#e53935' : '#ccc'}`,
                            fontSize: '0.95em',
                            outline: 'none',
                            boxSizing: 'border-box',
                            transition: 'border-color 0.2s',
                        }}
                        onFocus={e => { if (!validationMsg) e.target.style.borderColor = '#003366'; }}
                        onBlur={e => { if (!validationMsg) e.target.style.borderColor = '#ccc'; }}
                    />
                    {inputValue && (
                        <button type="button" onClick={handleClear}
                            style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#aaa', fontSize: '1.1em', lineHeight: 1 }}
                            title="Clear">×
                        </button>
                    )}
                </div>

                {/* [M1] Type options gated by loggedInRole (JWT), not email */}
                <select value={typeFilter} onChange={handleTypeChange}
                    style={{ padding: '11px 10px', borderRadius: 6, border: '1.5px solid #ccc', fontSize: '0.9em', outline: 'none', cursor: 'pointer', color: '#333' }}>
                    <option value="all">All</option>
                    <option value="grades">Grades</option>
                    {canSearchUsersAndProfiles && <option value="users">Users</option>}
                    {canSearchUsersAndProfiles && <option value="profiles">Profiles</option>}
                </select>

                <button type="submit"
                    disabled={loading || inputValue.trim().length < 2}
                    style={{
                        padding: '11px 20px', backgroundColor: '#003366', color: 'white',
                        border: 'none', borderRadius: 6, fontWeight: 'bold', fontSize: '0.9em',
                        cursor: loading || inputValue.trim().length < 2 ? 'not-allowed' : 'pointer',
                        opacity: loading || inputValue.trim().length < 2 ? 0.6 : 1,
                        whiteSpace: 'nowrap', transition: 'opacity 0.2s',
                    }}>
                    {loading ? 'Searching…' : 'Search'}
                </button>
            </form>

            {/* [H2] Inline validation hint */}
            {validationMsg && (
                <p style={{ margin: '4px 0 12px 2px', fontSize: '0.82em', color: '#e53935' }}>{validationMsg}</p>
            )}

            {/* ── Status Bar ── */}
            {activeQuery && !loading && results !== null && !validationMsg && (
                <div style={{ fontSize: '0.83em', color: '#555', marginBottom: 12, marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>
                        {totalHits === 0
                            ? `No results for "${activeQuery}"`
                            : `${totalHits} result${totalHits !== 1 ? 's' : ''} for "${activeQuery}"`}
                    </span>
                    {results?.errors?.length > 0 && (
                        <span style={{ color: '#d32f2f', fontWeight: 'bold' }}>
                            ⚠ Some sources unavailable — results may be incomplete
                        </span>
                    )}
                </div>
            )}

            {/* ── Loading ── */}
            {loading && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 0', color: '#555' }}>
                    <div style={{ width: 18, height: 18, border: '2px solid #ddd', borderTop: '2px solid #003366', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                    Querying blockchain and database…
                </div>
            )}

            {/* ── Error ── */}
            {error && (
                <div style={{ backgroundColor: '#ffebee', color: '#d32f2f', padding: '10px 14px', borderRadius: 6, borderLeft: '4px solid #d32f2f', marginBottom: 14, fontSize: '0.9em' }}>
                    ⚠ {error}
                </div>
            )}

            {/* ── No Results ── */}
            {!loading && results !== null && totalHits === 0 && (
                <div style={{ textAlign: 'center', padding: '30px 0', color: '#888' }}>
                    <div style={{ fontSize: '2em', marginBottom: 8 }}>🔎</div>
                    <div style={{ fontWeight: 'bold', marginBottom: 4 }}>No records found</div>
                    <div style={{ fontSize: '0.88em' }}>Try a different keyword, subject code, student ID, or name.</div>
                </div>
            )}

            {/* ── Results ── */}
            {!loading && results && totalHits > 0 && (
                <>
                    <ResultSection title="Blockchain Grades" icon="⛓"
                        result={results.grades} regex={highlightRegex}
                        TableComponent={GradesTable} accentColor="#003366"
                        page={gradePages} onPageChange={handleGradePage} />

                    {/* [M1] Only rendered when loggedInRole === 'RegistrarMSP' */}
                    {canSearchUsersAndProfiles && (
                        <>
                            <ResultSection title="Users" icon="🗄"
                                result={results.users} regex={highlightRegex}
                                TableComponent={UsersTable} accentColor="#4a148c"
                                page={userPages} onPageChange={handleUserPage} />
                            <ResultSection title="Profiles" icon="👤"
                                result={results.profiles} regex={highlightRegex}
                                TableComponent={ProfilesTable} accentColor="#1b5e20"
                                page={profilePages} onPageChange={handleProfilePage} />
                        </>
                    )}
                </>
            )}
        </div>
    );
};

export default SearchBar;
