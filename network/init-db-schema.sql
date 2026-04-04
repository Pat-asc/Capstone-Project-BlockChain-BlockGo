-- BlockGO Database Schema Initialization (Sanitized for compatibility)

-- 1. Users table (Lowercased for seamless C#/Node.js integration)
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Profile Tables
CREATE TABLE IF NOT EXISTS studentprofiles (
    profile_id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    full_name VARCHAR(100) NOT NULL,
    student_no VARCHAR(50),
    department VARCHAR(100),
    section VARCHAR(50),
    assignment_status VARCHAR(50) DEFAULT 'Unassigned'
);

CREATE TABLE IF NOT EXISTS facultyprofiles (
    profile_id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    full_name VARCHAR(100) NOT NULL,
    department VARCHAR(100),
    section VARCHAR(50),
    year_level VARCHAR(50)
);

CREATE TABLE IF NOT EXISTS adminprofiles (
    profile_id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    full_name VARCHAR(100) NOT NULL,
    admin_level VARCHAR(50),
    department VARCHAR(100)
);

-- 3. Academic Records (The core data for blockchain)
CREATE TABLE IF NOT EXISTS academic_records (
    record_id SERIAL PRIMARY KEY,
    student_id VARCHAR(100) NOT NULL,
    course_code VARCHAR(50) NOT NULL,
    course_name VARCHAR(255),
    grade VARCHAR(10),
    units DECIMAL(4,2),
    semester VARCHAR(20),
    academic_year VARCHAR(10),
    status VARCHAR(50),
    faculty_id VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Grade Records & Logs
CREATE TABLE IF NOT EXISTS grade_records (
    grade_id SERIAL PRIMARY KEY,
    academic_record_id INTEGER REFERENCES academic_records(record_id),
    raw_score DECIMAL(5,2),
    final_grade VARCHAR(10),
    status VARCHAR(50),
    recorded_by VARCHAR(100),
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS grade_correction_logs (
    log_id SERIAL PRIMARY KEY,
    record_id VARCHAR(100),
    old_grade VARCHAR(10),
    new_grade VARCHAR(10),
    reason_text TEXT,
    approved_by VARCHAR(100),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. Verification & Audit
CREATE TABLE IF NOT EXISTS verification_records (
    verification_id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    verification_token VARCHAR(255) UNIQUE,
    token_expires_at TIMESTAMP,
    is_verified BOOLEAN DEFAULT false,
    verified_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_logs (
    audit_id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    action VARCHAR(255) NOT NULL,
    entity_type VARCHAR(100),
    entity_id VARCHAR(100),
    old_values TEXT,
    new_values TEXT,
    ip_address VARCHAR(50),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_academic_records_student ON academic_records(student_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_studentprofiles_user_id ON studentprofiles(user_id);
CREATE INDEX IF NOT EXISTS idx_facultyprofiles_user_id ON facultyprofiles(user_id);
CREATE INDEX IF NOT EXISTS idx_adminprofiles_user_id ON adminprofiles(user_id);