#!/bin/sh
set -e

echo "Starting Litestream initialization..."

# Restore the database if it exists in S3
# If no database is found, litestream restore will just exit or fail harmlessly, so we use || true
litestream restore -if-replica-exists /app/data/db/data.sqlite || true

echo "Running model definitions patch..."
cd /usr/local/bin && node patch-models.js || true
cd /app

echo "Starting Litestream replication and 9Router..."
# Run litestream replication in the background, and use -exec to start the node server directly
exec litestream replicate -exec "node custom-server.js"
