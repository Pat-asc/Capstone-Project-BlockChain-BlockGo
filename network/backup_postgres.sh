#!/bin/bash

# Set the directory where backups will be stored
BACKUP_DIR="$(pwd)/db_backups"
mkdir -p "$BACKUP_DIR"

# Generate a timestamp for the backup file
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

# Load the generated environment variables
if [ -f ".env" ]; then
    source .env
else
    echo "Error: .env file not found. Cannot determine database credentials."
    exit 1
fi

echo "Starting backup for database: $POSTGRES_DB..."
# Execute the pg_dump command inside the running docker container
docker exec postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > "$BACKUP_DIR/backup_${TIMESTAMP}.sql"

echo "Backup successfully saved to: $BACKUP_DIR/backup_${TIMESTAMP}.sql"

# Cleanup: Keep only the 7 most recent backups and delete older ones
ls -1t "$BACKUP_DIR"/backup_*.sql | tail -n +8 | xargs -r rm --