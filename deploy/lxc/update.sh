#!/usr/bin/env bash
# ==============================================================================
# photogal — Fast In-Place Updater for LXC / VM deployments
# ==============================================================================
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

INSTALL_DIR="/opt/photogal"

if [ ! -d "$INSTALL_DIR" ]; then
    echo -e "${RED}Error:${NC} Directory $INSTALL_DIR does not exist."
    exit 1
fi

echo -e "${BLUE}==>${NC} Updating photogal from GitHub..."
cd "$INSTALL_DIR"

# 1. Pull latest git commits
git pull origin main

# 2. Reinstall dependencies & build standalone app
echo -e "${BLUE}==>${NC} Installing dependencies and building..."
npm ci
NODE_OPTIONS="--max-old-space-size=2048" npm run build

# Check if server.js is in a nested directory inside standalone (can happen in certain Next.js environments)
if [ ! -f "$INSTALL_DIR/.next/standalone/server.js" ] && [ -d "$INSTALL_DIR/.next/standalone" ]; then
    NESTED_SERVER=$(find "$INSTALL_DIR/.next/standalone" -maxdepth 4 -name "server.js" | head -n 1 || true)
    if [ -n "$NESTED_SERVER" ]; then
        NESTED_DIR=$(dirname "$NESTED_SERVER")
        echo -e "${BLUE}==>${NC} Flattening standalone folder from $NESTED_DIR..."
        cp -a "$NESTED_DIR/." "$INSTALL_DIR/.next/standalone/"
    fi
fi

# 3. Synchronize standalone assets
if [ -d "$INSTALL_DIR/.next/standalone" ]; then
    cp -r "$INSTALL_DIR/public" "$INSTALL_DIR/.next/standalone/"
    mkdir -p "$INSTALL_DIR/.next/standalone/.next"
    cp -r "$INSTALL_DIR/.next/static" "$INSTALL_DIR/.next/standalone/.next/"
    cp -r "$INSTALL_DIR/scripts" "$INSTALL_DIR/.next/standalone/" 2>/dev/null || true
    
    mkdir -p "$INSTALL_DIR/data" "$INSTALL_DIR/storage"
    ln -sfn "$INSTALL_DIR/data" "$INSTALL_DIR/.next/standalone/data"
    ln -sfn "$INSTALL_DIR/storage" "$INSTALL_DIR/.next/standalone/storage"
fi

# 4. Fix permissions
chown -R photogal:photogal "$INSTALL_DIR"

# 5. Restart systemd service
if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files photogal.service >/dev/null 2>&1; then
    echo -e "${BLUE}==>${NC} Restarting photogal service..."
    systemctl restart photogal.service
    echo -e "${GREEN}✓${NC} photogal updated and restarted successfully!"
    systemctl status photogal.service --no-pager -n 5
else
    echo -e "${GREEN}✓${NC} Build finished. Please restart your photogal container/process."
fi

