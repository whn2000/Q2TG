#!/bin/bash
# Auto-provision OneBot 11 configuration if not present
mkdir -p /app/napcat/config
if [ ! -f /app/napcat/config/onebot11.json ]; then
    cp /napcat-config-default.json /app/napcat/config/onebot11.json
    echo "[Init] Provisioned default onebot11.json"
fi
if [ -n "$ACCOUNT" ] && [ ! -f "/app/napcat/config/onebot11_${ACCOUNT}.json" ]; then
    cp /napcat-config-default.json "/app/napcat/config/onebot11_${ACCOUNT}.json"
    echo "[Init] Provisioned onebot11_${ACCOUNT}.json"
fi

# Patch sendMsg timeout after NapCat fully starts
(
    for i in $(seq 1 120); do
        if [ -f /app/napcat/napcat.mjs ] && grep -q 'totalSize / 1024 / 256' /app/napcat/napcat.mjs 2>/dev/null; then
            sed -i 's|1e4 + totalSize / 1024 / 256|3e4 + totalSize / 1024 / 128|' /app/napcat/napcat.mjs
            echo "[Patch] sendMsg timeout increased (30s base + 128KB/s)"
            break
        fi
        sleep 1
    done
) &

exec bash /app/entrypoint.sh
