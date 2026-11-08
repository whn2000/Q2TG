#!/bin/bash
set -e
cd "$(dirname "$0")"

echo "=== [$(date '+%Y-%m-%d %H:%M:%S')] Starting Q2TG manual update ==="
echo "Pulling latest changes from branch sleepyfox..."
git fetch origin sleepyfox
git reset --hard origin/sleepyfox

echo "Rebuilding and restarting Q2TG container..."
docker compose up -d --build q2tg

echo "=== Update finished successfully! (Current commit: $(git rev-parse --short HEAD)) ==="
