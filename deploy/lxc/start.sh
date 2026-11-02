#!/usr/bin/env bash
set -e
cd /opt/photogal

# If standalone server exists, launch it
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
