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
    useradd -r -d /opt/photogal -s /bin/bash photogal 2>/dev/null || adduser -D -h /opt/photogal -s /bin/sh photogal 2>/dev/null || true
fi

# 3. Setup application directory
INSTALL_DIR="/opt/photogal"
mkdir -p "$INSTALL_DIR"

# 4. Clone or update repository
REPO_URL="https://github.com/lespatrick/photogal.git"
if [ ! -d "$INSTALL_DIR/.git" ]; then
    echo -e "${BLUE}==>${NC} Cloning photogal from GitHub..."
    if [ -z "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]; then
        git clone "$REPO_URL" "$INSTALL_DIR"
    else
        TMP_CLONE=$(mktemp -d)
        git clone "$REPO_URL" "$TMP_CLONE"
        cp -a "$TMP_CLONE/." "$INSTALL_DIR/"
        rm -rf "$TMP_CLONE"
    fi
else
    echo -e "${BLUE}==>${NC} Pulling latest changes..."
    cd "$INSTALL_DIR"
    git pull origin main
fi

# Ensure working directory is the application root
cd "$INSTALL_DIR"

# 5. Build application
echo -e "${BLUE}==>${NC} Installing npm dependencies & building Next.js standalone..."
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

# 6. Copy standalone output to running root
if [ -d "$INSTALL_DIR/.next/standalone" ]; then
    cp -r "$INSTALL_DIR/public" "$INSTALL_DIR/.next/standalone/"
    mkdir -p "$INSTALL_DIR/.next/standalone/.next"
    cp -r "$INSTALL_DIR/.next/static" "$INSTALL_DIR/.next/standalone/.next/"
    cp -r "$INSTALL_DIR/scripts" "$INSTALL_DIR/.next/standalone/" 2>/dev/null || true
    
    # Symlink data and storage to persist across builds
    mkdir -p "$INSTALL_DIR/data" "$INSTALL_DIR/storage"
    ln -sfn "$INSTALL_DIR/data" "$INSTALL_DIR/.next/standalone/data"
    ln -sfn "$INSTALL_DIR/storage" "$INSTALL_DIR/.next/standalone/storage"
fi

# 7. Create default .env file if it does not exist
if [ ! -f "$INSTALL_DIR/.env" ]; then
    echo -e "${BLUE}==>${NC} Generating initial .env configuration..."
    RANDOM_AUTH_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" 2>/dev/null || openssl rand -hex 32)
    cat <<EOF > "$INSTALL_DIR/.env"
# ==============================================================================
# photogal — Environment Configuration
# ==============================================================================
NODE_ENV=production
PORT=3000
HOSTNAME=0.0.0.0
NEXT_TELEMETRY_DISABLED=1

# Initial Administrator Password (change after first login)
ADMIN_PASSWORD=${ADMIN_PASSWORD:-admin123}

# Unique HMAC session signing secret (auto-generated)
AUTH_SECRET=${RANDOM_AUTH_SECRET}

# Allow direct HTTP access on LAN/IP (set to false when behind HTTPS reverse proxy)
ALLOW_HTTP=${ALLOW_HTTP:-true}

# Trust Reverse Proxy headers (X-Forwarded-For, X-Real-IP)
TRUST_PROXY=true

# Custom Storage & Database Paths (defaults to /opt/photogal/storage and /opt/photogal/data)
# STORAGE_DIR=/mnt/nas/photos
# DATA_DIR=/mnt/nas/data

# Optional: WebAuthn / Passkey & Domain Security (uncomment and configure for domain)
# ALLOWED_HOSTS=gallery.yourdomain.com
# RP_ID=gallery.yourdomain.com
# RP_ORIGIN=https://gallery.yourdomain.com
EOF
    chmod 600 "$INSTALL_DIR/.env"
fi

# 8. Set directory permissions
mkdir -p "$INSTALL_DIR/data" "$INSTALL_DIR/storage"
chown -R photogal:photogal "$INSTALL_DIR"

# 9. Setup systemd service (if systemd is running)
if pidof systemd >/dev/null 2>&1 || [ -d /run/systemd/system ]; then
    echo -e "${BLUE}==>${NC} Installing systemd service..."
    chmod +x "$INSTALL_DIR/deploy/lxc/start.sh"
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
echo -e "  Admin: http://${IP_ADDR}:3000/admin (Login: admin, Hasło: ${ADMIN_PASSWORD:-admin123})"
echo -e "${GREEN}================================================================${NC}"
