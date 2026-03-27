#!/bin/bash

# Set the directory where backups will be stored
BACKUP_DIR="$(pwd)/db_backups"
mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

echo "Stopping CouchDB container to ensure data integrity during backup..."
docker stop couchdb-wallet > /dev/null

echo "Archiving CouchDB data volume..."
docker run --rm --volumes-from couchdb-wallet -v "$BACKUP_DIR:/backup" alpine tar czf /backup/couchdb_wallet_${TIMESTAMP}.tar.gz -C /opt/couchdb/data .

echo "Restarting CouchDB container..."
docker start couchdb-wallet > /dev/null

echo "Backup successfully saved to: $BACKUP_DIR/couchdb_wallet_${TIMESTAMP}.tar.gz"

# Cleanup: Keep only the 7 most recent backups
ls -1t "$BACKUP_DIR"/couchdb_wallet_*.tar.gz 2>/dev/null | tail -n +8 | xargs -r rm --