#!/bin/bash

DB_NAME="ActivityLogs"
DB_USER="BLOCKGO"
BACKUP_FILE="pg_backup.sql"

SUDO=""
if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
fi

echo "--- PostgreSQL Data Migration ---"

# 1. Backup the native database
echo "Step 1: Backing up the native PostgreSQL database '$DB_NAME' to '$BACKUP_FILE'..."
if ! command -v pg_dump >/dev/null 2>&1; then
    echo "Error: 'pg_dump' command not found. Make sure PostgreSQL client tools are installed."
    exit 1
fi

$SUDO -u postgres pg_dump -U "$DB_USER" -d "$DB_NAME" > "$BACKUP_FILE"
if [ $? -ne 0 ]; then
    echo "Error: Failed to create database backup. Please check your native PostgreSQL status and credentials."
    exit 1
fi
echo "Backup successful."

# 2. Restore into the Docker container
echo "Step 2: Restoring backup into the 'postgres' Docker container..."
if ! docker ps -a --format '{{.Names}}' | grep -q "^postgres$"; then
    echo "Error: The 'postgres' Docker container is not running. Please run './full_deploy.sh' first."
    exit 1
fi

cat "$BACKUP_FILE" | docker exec -i postgres psql -U "$DB_USER" -d "$DB_NAME"
echo "Restore successful."

rm "$BACKUP_FILE"
echo "Migration complete! Your data is now in the containerized PostgreSQL."
