#!/bin/bash
set -e
cd "$(dirname "$0")"

# Prevent concurrent update executions
LOCK_FILE="/tmp/q2tg_autoupdate.lock"
exec 200>"$LOCK_FILE"
flock -n 200 || { echo "[$(date '+%Y-%m-%d %H:%M:%S')] Another update is already running. Exiting."; exit 0; }

git fetch origin sleepyfox -q

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/sleepyfox)

if [ "$LOCAL" != "$REMOTE" ]; then
    echo "=== [$(date '+%Y-%m-%d %H:%M:%S')] New version detected ($LOCAL -> $REMOTE) ==="
    git reset --hard origin/sleepyfox
    echo "Rebuilding and restarting Q2TG container..."
    docker compose up -d --build q2tg
    echo "=== [$(date '+%Y-%m-%d %H:%M:%S')] Q2TG auto-update complete! Current commit: $(git rev-parse --short HEAD) ==="
fi
