#!/bin/bash
# Fix case-sensitivity issues in middleware and C# code
# Run this AFTER pulling the updated init-db-schema.sql

set -e

echo "Fixing table references in middleware..."

# Replace all Users (uppercase) with users (lowercase)
sed -i 's/FROM Users /FROM users /g' ../middleware/middleware.js
sed -i "s/FROM \"Users\" /FROM users /g" ../middleware/middleware.js
sed -i "s/INSERT INTO Users /INSERT INTO users /g" ../middleware/middleware.js
sed -i "s/INSERT INTO \"Users\" /INSERT INTO users /g" ../middleware/middleware.js
sed -i "s/UPDATE Users /UPDATE users /g" ../middleware/middleware.js
sed -i "s/UPDATE \"Users\" /UPDATE users /g" ../middleware/middleware.js
sed -i "s/ALTER TABLE Users /ALTER TABLE users /g" ../middleware/middleware.js
sed -i "s/ALTER TABLE \"Users\" /ALTER TABLE users /g" ../middleware/middleware.js

# Fix AdminProfiles references
sed -i 's/INSERT INTO AdminProfiles /INSERT INTO adminprofiles /g' ../middleware/middleware.js

echo "Fixed middleware database queries (Users → users, AdminProfiles → adminprofiles)"

# Remove the problematic ALTER TABLE from middleware startup
sed -i '/ALTER TABLE users/,/catch.*console.error/d' ../middleware/middleware.js || true
sed -i '/Schema columns already created/,/console.log.*Schema initialized/d' ../middleware/middleware.js || true

echo "Removed problematic ALTER TABLE statement from middleware"

# Now regenerate the database with proper schema
echo "Dropping and recreating database with proper lowercase schema..."
docker exec postgres psql -U BLOCKGO -d postgres -c "DROP DATABASE IF EXISTS ActivityLogs;" 2>/dev/null || true
docker exec postgres psql -U BLOCKGO -d postgres -c "CREATE DATABASE ActivityLogs;" 2>/dev/null || true

echo "Applying schema..."
cat init-db-schema.sql | docker exec -i postgres psql -U BLOCKGO -d ActivityLogs

echo "Done! Schema is now properly initialized with lowercase table names."
