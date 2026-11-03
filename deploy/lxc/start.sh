#!/usr/bin/env bash
set -e
cd /opt/photogal

# Guarantee persistent directories regardless of whether running root or nested standalone
export DATA_DIR="${DATA_DIR:-/opt/photogal/data}"
export STORAGE_DIR="${STORAGE_DIR:-/opt/photogal/storage}"

# 1. Check for root standalone server (recommended layout)
if [ -f "server.js" ]; then
    exec /usr/bin/node server.js
fi

# 2. Check for nested standalone server
if [ -f ".next/standalone/server.js" ]; then
    exec /usr/bin/node .next/standalone/server.js
fi

# Fallback: check if server.js was generated in a nested folder
NESTED_SERVER=$(find .next/standalone -maxdepth 4 -name "server.js" 2>/dev/null | head -n 1 || true)
if [ -n "$NESTED_SERVER" ] && [ -f "$NESTED_SERVER" ]; then
    exec /usr/bin/node "$NESTED_SERVER"
fi

# Ultimate fallback: start via npm start
echo "Warning: Standalone server not found. Starting with npm start..."
exec npm start

