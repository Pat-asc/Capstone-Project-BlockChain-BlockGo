#!/bin/bash

# DATABASE SCHEMA INITIALIZATION
# Run this after full_deploy.sh to create all tables and schema

echo "=========================================================="
echo "DATABASE SCHEMA INITIALIZATION"
echo "=========================================================="
echo ""

# Get environment variables
ENV_FILE="$(cd "$(dirname "$0")" && pwd)/.env"
if [ ! -f "$ENV_FILE" ]; then
    echo "ERROR: .env file not found"
    exit 1
fi

POSTGRES_USER=$(grep "^POSTGRES_USER=" "$ENV_FILE" | cut -d '=' -f 2)
POSTGRES_PASS=$(grep "^POSTGRES_PASS=" "$ENV_FILE" | cut -d '=' -f 2)
POSTGRES_DB=$(grep "^POSTGRES_DB=" "$ENV_FILE" | cut -d '=' -f 2)

if [ -z "$POSTGRES_USER" ] || [ -z "$POSTGRES_PASS" ] || [ -z "$POSTGRES_DB" ]; then
    echo "ERROR: Database credentials not found in .env"
    exit 1
fi

echo "Connecting to PostgreSQL: $POSTGRES_DB"
echo ""

# Get container ID
CONTAINER_ID=$(docker ps | grep postgres | awk '{print $1}')
if [ -z "$CONTAINER_ID" ]; then
    echo "ERROR: PostgreSQL container not running"
    exit 1
fi

echo "Step 1: Creating Users table..."

docker exec "$CONTAINER_ID" bash -c "PGPASSWORD='$POSTGRES_PASS' psql -U $POSTGRES_USER -d $POSTGRES_DB" << 'SQL_EOF'
CREATE TABLE IF NOT EXISTS Users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(100),
    status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    password_reset_token VARCHAR(255),
    password_reset_expires BIGINT
);

CREATE INDEX IF NOT EXISTS idx_users_email ON Users(email);
CREATE INDEX IF NOT EXISTS idx_users_status ON Users(status);

SQL_EOF

if [ $? -eq 0 ]; then
    echo "✓ Users table created"
else
    echo "ERROR: Failed to create Users table"
    exit 1
fi

echo ""
echo "Step 2: Creating AdminProfiles table..."

docker exec "$CONTAINER_ID" bash -c "PGPASSWORD='$POSTGRES_PASS' psql -U $POSTGRES_USER -d $POSTGRES_DB" << 'SQL_EOF'
CREATE TABLE IF NOT EXISTS AdminProfiles (
    id SERIAL PRIMARY KEY,
    user_id INTEGER UNIQUE NOT NULL REFERENCES Users(id) ON DELETE CASCADE,
    full_name VARCHAR(255),
    admin_level VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_admin_user_id ON AdminProfiles(user_id);

SQL_EOF

if [ $? -eq 0 ]; then
    echo "✓ AdminProfiles table created"
else
    echo "ERROR: Failed to create AdminProfiles table"
    exit 1
fi

echo ""
echo "Step 3: Creating initial Registrar user..."

docker exec "$CONTAINER_ID" bash -c "PGPASSWORD='$POSTGRES_PASS' psql -U $POSTGRES_USER -d $POSTGRES_DB" << 'SQL_EOF'
DO $$
DECLARE
    user_id INTEGER;
BEGIN
    -- Check if registrar already exists
    IF NOT EXISTS (SELECT 1 FROM Users WHERE email = 'registrar@plv.edu.ph') THEN
        -- Insert user (password should be set via app or by admin)
        INSERT INTO Users (email, password_hash, role, status)
        VALUES ('registrar@plv.edu.ph', '$2b$10$dummyhash', 'registrar', 'APPROVED')
        RETURNING id INTO user_id;
        
        -- Insert admin profile
        INSERT INTO AdminProfiles (user_id, full_name, admin_level)
        VALUES (user_id, 'System Registrar', 'registrar');
        
        RAISE NOTICE 'Registrar user created';
    ELSE
        RAISE NOTICE 'Registrar user already exists';
    END IF;
END $$;

SQL_EOF

if [ $? -eq 0 ]; then
    echo "✓ Registrar user initialized"
else
    echo "WARNING: Registrar user initialization had issues (may already exist)"
fi

echo ""
echo "Step 4: Verifying schema..."

docker exec "$CONTAINER_ID" bash -c "PGPASSWORD='$POSTGRES_PASS' psql -U $POSTGRES_USER -d $POSTGRES_DB" << 'SQL_EOF'
SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name;
SQL_EOF

echo ""
echo "=========================================================="
echo "SCHEMA INITIALIZATION COMPLETE!"
echo "=========================================================="
echo ""
echo "Your database now has:"
echo "  ✓ Users table"
echo "  ✓ AdminProfiles table"
echo "  ✓ Registrar account (registrar@plv.edu.ph)"
echo ""
echo "NOTE: Update the registrar password via the app's password reset feature"
echo ""
