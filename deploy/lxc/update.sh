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

# 1. Stop systemd service first so it does not loop during build
if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet photogal.service 2>/dev/null; then
    echo -e "${BLUE}==>${NC} Stopping photogal service..."
    systemctl stop photogal.service || true
fi

cd "$INSTALL_DIR"

# 2. Pull latest git commits cleanly
git fetch origin main
git reset --hard origin/main

# 3. Install dependencies
echo -e "${BLUE}==>${NC} Installing dependencies..."
npm install --omit=dev=false

# 4. Build Next.js application
echo -e "${BLUE}==>${NC} Building production bundle..."
NODE_OPTIONS="--max-old-space-size=2048" npm run build

# 5. Synchronize standalone assets
if [ -d "$INSTALL_DIR/.next/standalone" ]; then
    # Flatten if nested
    if [ ! -f "$INSTALL_DIR/.next/standalone/server.js" ]; then
        NESTED_SERVER=$(find "$INSTALL_DIR/.next/standalone" -maxdepth 4 -name "server.js" 2>/dev/null | head -n 1 || true)
        if [ -n "$NESTED_SERVER" ]; then
            NESTED_DIR=$(dirname "$NESTED_SERVER")
            echo -e "${BLUE}==>${NC} Flattening standalone folder from $NESTED_DIR..."
            cp -a "$NESTED_DIR/." "$INSTALL_DIR/.next/standalone/"
        fi
    fi

    cp -r "$INSTALL_DIR/public" "$INSTALL_DIR/.next/standalone/" 2>/dev/null || true
    mkdir -p "$INSTALL_DIR/.next/standalone/.next"
    cp -r "$INSTALL_DIR/.next/static" "$INSTALL_DIR/.next/standalone/.next/" 2>/dev/null || true
    cp -r "$INSTALL_DIR/scripts" "$INSTALL_DIR/.next/standalone/" 2>/dev/null || true
    
    mkdir -p "$INSTALL_DIR/data" "$INSTALL_DIR/storage"
    ln -sfn "$INSTALL_DIR/data" "$INSTALL_DIR/.next/standalone/data"
    ln -sfn "$INSTALL_DIR/storage" "$INSTALL_DIR/.next/standalone/storage"
fi

# 6. Update systemd service definition and launcher
if [ -f "$INSTALL_DIR/deploy/lxc/photogal.service" ] && [ -d /etc/systemd/system ]; then
    cp "$INSTALL_DIR/deploy/lxc/photogal.service" /etc/systemd/system/photogal.service
    chmod +x "$INSTALL_DIR/deploy/lxc/start.sh"
    systemctl daemon-reload
fi

# 7. Fix directory permissions
mkdir -p "$INSTALL_DIR/data" "$INSTALL_DIR/storage"
chown -R photogal:photogal "$INSTALL_DIR"
chmod -R 775 "$INSTALL_DIR/data" "$INSTALL_DIR/storage"

# 8. Start service
if command -v systemctl >/dev/null 2>&1; then
    echo -e "${BLUE}==>${NC} Starting photogal service..."
    systemctl restart photogal.service
    sleep 2
    systemctl status photogal.service --no-pager
fi

echo -e "\n${GREEN}✓ photogal updated and running!${NC}"
