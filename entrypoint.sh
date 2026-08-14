#!/bin/bash
set -e

echo "Starting Litestream initialization..."

# Restore the database if it exists in S3
# If no database is found, litestream restore will just exit or fail harmlessly, so we use || true
litestream restore -if-replica-exists /app/data/db/data.sqlite || true

# Ensure the node user owns the restored database files so the app can read/write
chown -R 1000:1000 /app/data/db

echo "Starting Litestream replication and 9Router..."
# Run litestream replication in the background, and use -exec to start the original entrypoint and CMD
exec litestream replicate -exec "/entrypoint.sh node custom-server.js"
