#!/usr/bin/env bash
# ==============================================================================
# photogal — LXC Container Automated Installer (Debian / Ubuntu / Alpine)
# ==============================================================================
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}==>${NC} Installing photogal inside LXC container..."

# 1. Detect OS & install dependencies
if [ -f /etc/debian_version ]; then
    echo -e "${BLUE}==>${NC} Detected Debian/Ubuntu environment."
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y
    apt-get install -y curl ca-certificates gnupg git python3 make g++ libc6

    # Install Node.js 22 LTS if not present or older
    if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d'.' -f1 | tr -d 'v')" -lt 20 ]; then
        echo -e "${BLUE}==>${NC} Installing Node.js 22.x LTS..."
        curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
        apt-get install -y nodejs
    fi
elif [ -f /etc/alpine-release ]; then
    echo -e "${BLUE}==>${NC} Detected Alpine Linux environment."
    apk update
    apk add --no-cache nodejs npm git python3 make g++ libc6-compat curl bash
else
    echo -e "${RED}Error:${NC} Unsupported OS. Please use Debian 12, Ubuntu 24.04, or Alpine."
    exit 1
fi

echo -e "${GREEN}✓${NC} Node.js version: $(node -v) | npm version: $(npm -v)"

# 2. Setup dedicated user
if ! id -u photogal >/dev/null 2>&1; then
    echo -e "${BLUE}==>${NC} Creating system user 'photogal'..."
    useradd -r -m -d /opt/photogal -s /bin/bash photogal || adduser -D -h /opt/photogal -s /bin/sh photogal
fi

# 3. Setup application directory
INSTALL_DIR="/opt/photogal"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# 4. Clone or update repository
REPO_URL="https://github.com/lespatrick/photogal.git"
if [ ! -d "$INSTALL_DIR/.git" ]; then
    echo -e "${BLUE}==>${NC} Cloning photogal from GitHub..."
    git clone "$REPO_URL" "$INSTALL_DIR"
else
    echo -e "${BLUE}==>${NC} Pulling latest changes..."
    git pull origin main
fi

# 5. Build application
echo -e "${BLUE}==>${NC} Installing npm dependencies & building Next.js standalone..."
npm ci
npm run build

# 6. Copy standalone output to running root
if [ -d "$INSTALL_DIR/.next/standalone" ]; then
    cp -r "$INSTALL_DIR/public" "$INSTALL_DIR/.next/standalone/"
    cp -r "$INSTALL_DIR/.next/static" "$INSTALL_DIR/.next/standalone/.next/"
    cp -r "$INSTALL_DIR/scripts" "$INSTALL_DIR/.next/standalone/" 2>/dev/null || true
    
    # Symlink data and storage to persist across builds
    mkdir -p "$INSTALL_DIR/data" "$INSTALL_DIR/storage"
    ln -sfn "$INSTALL_DIR/data" "$INSTALL_DIR/.next/standalone/data"
    ln -sfn "$INSTALL_DIR/storage" "$INSTALL_DIR/.next/standalone/storage"
fi

# 7. Set directory permissions
mkdir -p "$INSTALL_DIR/data" "$INSTALL_DIR/storage"
chown -R photogal:photogal "$INSTALL_DIR"

# 8. Setup systemd service (if systemd is running)
if pidof systemd >/dev/null 2>&1 || [ -d /run/systemd/system ]; then
    echo -e "${BLUE}==>${NC} Installing systemd service..."
    cp "$INSTALL_DIR/deploy/lxc/photogal.service" /etc/systemd/system/photogal.service
    systemctl daemon-reload
    systemctl enable photogal.service
    systemctl restart photogal.service
    echo -e "${GREEN}✓${NC} photogal service is running!"
else
    echo -e "${BLUE}==>${NC} Systemd not detected (container init mode). Starting directly or use supervisor."
fi

IP_ADDR=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")
echo -e "\n${GREEN}================================================================${NC}"
echo -e "${GREEN}✓ photogal successfully installed in LXC!${NC}"
echo -e "  URL:   http://${IP_ADDR}:3000"
echo -e "  Admin: http://${IP_ADDR}:3000/admin (Login: admin, Hasło: admin123)"
echo -e "${GREEN}================================================================${NC}"
