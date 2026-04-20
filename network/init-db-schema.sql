-- BlockGO Database Schema Initialization

-- Create Users table (core authentication)
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) UNIQUE,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL,
    organization VARCHAR(100),
    status VARCHAR(20) DEFAULT 'pending',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    password_reset_token VARCHAR(255),
    password_reset_expires BIGINT
);

-- Create StudentProfiles table
CREATE TABLE IF NOT EXISTS studentprofiles (
    user_id SERIAL PRIMARY KEY,
    full_name VARCHAR(100),
    student_no VARCHAR(50),
    department VARCHAR(100),
    section VARCHAR(50),
    year_level VARCHAR(50),
    assignment_status VARCHAR(50) DEFAULT 'Unassigned',
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Create FacultyProfiles table
CREATE TABLE IF NOT EXISTS facultyprofiles (
    user_id SERIAL PRIMARY KEY,
    full_name VARCHAR(100),
    department VARCHAR(100),
    section VARCHAR(50),
    year_level VARCHAR(50),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Create AdminProfiles table
CREATE TABLE IF NOT EXISTS adminprofiles (
    user_id SERIAL PRIMARY KEY,
    full_name VARCHAR(100),
    admin_level VARCHAR(50),
    department VARCHAR(100),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Create User Requests table (registration requests)
CREATE TABLE IF NOT EXISTS userrequests (
    requestid SERIAL PRIMARY KEY,
    email VARCHAR(100) UNIQUE NOT NULL,
    fullname VARCHAR(100) NOT NULL,
    role VARCHAR(20) NOT NULL,
    department VARCHAR(50),
    requeststatus VARCHAR(20) DEFAULT 'PENDING',
    createdat TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create Grade Correction Logs table
CREATE TABLE IF NOT EXISTS gradecorrectionlogs (
    logid SERIAL PRIMARY KEY,
    recordid VARCHAR(100),
    oldgrade VARCHAR(10),
    newgrade VARCHAR(10),
    reasontext TEXT,
    approvedby VARCHAR(100),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create Academic Records table
CREATE TABLE IF NOT EXISTS academic_records (
    record_id SERIAL PRIMARY KEY,
    student_id VARCHAR(100) NOT NULL,
    course_code VARCHAR(50) NOT NULL,
    course_name VARCHAR(255),
    grade VARCHAR(10),
    credit_hours DECIMAL(4,2),
    semester VARCHAR(20),
    academic_year VARCHAR(10),
    status VARCHAR(50),
    faculty_id VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create Grade Records table
CREATE TABLE IF NOT EXISTS grade_records (
    grade_id SERIAL PRIMARY KEY,
    academic_record_id INTEGER REFERENCES academic_records(record_id),
    raw_score DECIMAL(5,2),
    final_grade VARCHAR(10),
    status VARCHAR(50),
    recorded_by VARCHAR(100),
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create Registration Requests table
CREATE TABLE IF NOT EXISTS registration_requests (
    registration_id SERIAL PRIMARY KEY,
    student_id VARCHAR(100) NOT NULL,
    course_id VARCHAR(50) NOT NULL,
    status VARCHAR(50) DEFAULT 'PENDING',
    approved_by VARCHAR(100),
    requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    approved_at TIMESTAMP
);

-- Create Verification Records table
CREATE TABLE IF NOT EXISTS verification_records (
    verification_id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    verification_token VARCHAR(255) UNIQUE,
    token_expires_at TIMESTAMP,
    is_verified BOOLEAN DEFAULT false,
    verified_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create Audit Logs table
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
CREATE TABLE IF NOT EXISTS gradetemplates (
    id SERIAL PRIMARY KEY,
    template_name VARCHAR(255) NOT NULL,
    department VARCHAR(100) NOT NULL,
    formula_config JSONB NOT NULL,
    status VARCHAR(50) DEFAULT 'Pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS facultysections (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    department VARCHAR(100) NOT NULL,
    section VARCHAR(50) NOT NULL,
    year_level VARCHAR(50),
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Optional: Prevent assigning the exact same section twice to the same professor
CREATE UNIQUE INDEX idx_unique_faculty_section ON FacultySections(user_id, department, section);

-- Optional: Create an index on the department for faster lookups
CREATE INDEX idx_gradetemplates_department ON GradeTemplates(department);


-- Create Indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_userrequests_email ON userrequests(email);
CREATE INDEX IF NOT EXISTS idx_academic_records_student ON academic_records(student_id);
CREATE INDEX IF NOT EXISTS idx_academic_records_semester ON academic_records(semester);
CREATE INDEX IF NOT EXISTS idx_grade_records_status ON grade_records(status);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);

-- Grant permissions (optional - adjust as needed)
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO blockgo;
