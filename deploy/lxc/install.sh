#!/usr/bin/env bash
# ==============================================================================
# photogal — LXC Container Automated Installer (Debian / Ubuntu / Alpine)
# ==============================================================================
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

INSTALL_DIR="/opt/photogal"
PHOTOGAL_REPO="${PHOTOGAL_REPO:-lespatrick/photogal}"
BUILD_FROM_SOURCE="false"
RELEASE_TAG="latest"

# Parse CLI options
for arg in "$@"; do
    case "$arg" in
        --build-from-source|-s)
            BUILD_FROM_SOURCE="true"
            ;;
        --tag=*)
            RELEASE_TAG="${arg#*=}"
            ;;
        --help|-h)
            echo "Usage: ./install.sh [OPTIONS]"
            echo "Options:"
            echo "  --build-from-source, -s   Force compilation from source (installs gcc/make/python3)"
            echo "  --tag=<tag>               Install specific GitHub Release tag (default: latest)"
            echo "  --help, -h                Show this help message"
            exit 0
            ;;
    esac
done

echo -e "${BLUE}==>${NC} Installing photogal inside LXC container..."
ARCH=$(uname -m)

# 1. Detect OS & install base runtime dependencies
if [ -f /etc/debian_version ]; then
    echo -e "${BLUE}==>${NC} Detected Debian/Ubuntu environment."
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y
    apt-get install -y curl ca-certificates gnupg libc6 tar

    if [ "$BUILD_FROM_SOURCE" = "true" ]; then
        apt-get install -y git python3 make g++
    fi

    # Install Node.js 22 LTS if not present or older
    if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d'.' -f1 | tr -d 'v')" -lt 20 ]; then
        echo -e "${BLUE}==>${NC} Installing Node.js 22.x LTS..."
        curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
        apt-get install -y nodejs
    fi
elif [ -f /etc/alpine-release ]; then
    echo -e "${BLUE}==>${NC} Detected Alpine Linux environment."
    apk update
    apk add --no-cache nodejs npm libc6-compat curl bash tar
    if [ "$BUILD_FROM_SOURCE" = "true" ]; then
        apk add --no-cache git python3 make g++
    fi
else
    echo -e "${RED}Error:${NC} Unsupported OS. Please use Debian 12, Ubuntu 24.04, or Alpine."
    exit 1
fi

echo -e "${GREEN}✓${NC} Node.js version: $(node -v)"

# 2. Setup dedicated user
if ! id -u photogal >/dev/null 2>&1; then
    echo -e "${BLUE}==>${NC} Creating system user 'photogal'..."
    useradd -r -d /opt/photogal -s /bin/bash photogal 2>/dev/null || adduser -D -h /opt/photogal -s /bin/sh photogal 2>/dev/null || true
fi

# 3. Setup application directory
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# 4. Attempt fast deployment from pre-built GitHub Actions release
INSTALLED_VIA_PREBUILT="false"

if [ "$BUILD_FROM_SOURCE" != "true" ] && [ "$ARCH" = "x86_64" ]; then
    TARBALL_URL="https://github.com/${PHOTOGAL_REPO}/releases/download/${RELEASE_TAG}/photogal-standalone-linux-x64.tar.gz"
    SHA_URL="${TARBALL_URL}.sha256"

    echo -e "${BLUE}==>${NC} Checking for pre-built release package ($ARCH) from GitHub Actions..."
    if curl -fsSLI "$TARBALL_URL" >/dev/null 2>&1; then
        TMP_DIR=$(mktemp -d /tmp/photogal-install-XXXXXX)
        trap 'rm -rf "$TMP_DIR"' EXIT

        echo -e "${BLUE}==>${NC} Downloading pre-built standalone bundle..."
        if curl -fsSL "$TARBALL_URL" -o "$TMP_DIR/bundle.tar.gz"; then
            if curl -fsSL "$SHA_URL" -o "$TMP_DIR/bundle.tar.gz.sha256" 2>/dev/null; then
                (cd "$TMP_DIR" && sha256sum -c bundle.tar.gz.sha256 >/dev/null 2>&1) && echo -e "${GREEN}✓${NC} Checksum verified."
            fi

            echo -e "${BLUE}==>${NC} Extracting application..."
            tar -xzf "$TMP_DIR/bundle.tar.gz" -C "$INSTALL_DIR"
            INSTALLED_VIA_PREBUILT="true"
            echo -e "${GREEN}✓${NC} Pre-built standalone bundle installed."
        fi
    else
        echo -e "${YELLOW}Notice:${NC} Pre-built package not found. Building from source..."
    fi
fi

# 5. Fallback: Clone & compile from source if pre-built wasn't used
if [ "$INSTALLED_VIA_PREBUILT" != "true" ]; then
    echo -e "${BLUE}==>${NC} Setting up build tools & compiling from source..."
    if [ -f /etc/debian_version ]; then
        apt-get install -y git python3 make g++
    elif [ -f /etc/alpine-release ]; then
        apk add --no-cache git python3 make g++
    fi

    REPO_URL="https://github.com/${PHOTOGAL_REPO}.git"
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
        git pull origin main
    fi

    npm ci
    NODE_OPTIONS="--max-old-space-size=2048" npm run build

    # Flatten if standalone generated nested
    if [ ! -f "$INSTALL_DIR/.next/standalone/server.js" ] && [ -d "$INSTALL_DIR/.next/standalone" ]; then
        NESTED_SERVER=$(find "$INSTALL_DIR/.next/standalone" -maxdepth 4 -name "server.js" | head -n 1 || true)
        if [ -n "$NESTED_SERVER" ]; then
            NESTED_DIR=$(dirname "$NESTED_SERVER")
            echo -e "${BLUE}==>${NC} Flattening standalone folder from $NESTED_DIR..."
            cp -a "$NESTED_DIR/." "$INSTALL_DIR/.next/standalone/"
        fi
    fi

    if [ -d "$INSTALL_DIR/.next/standalone" ]; then
        cp -r "$INSTALL_DIR/public" "$INSTALL_DIR/.next/standalone/"
        mkdir -p "$INSTALL_DIR/.next/standalone/.next"
        cp -r "$INSTALL_DIR/.next/static" "$INSTALL_DIR/.next/standalone/.next/"
        cp -r "$INSTALL_DIR/scripts" "$INSTALL_DIR/.next/standalone/" 2>/dev/null || true
    fi
fi

# 6. Ensure persistent directories exist and symlink if needed
mkdir -p "$INSTALL_DIR/data" "$INSTALL_DIR/storage"
if [ -d "$INSTALL_DIR/.next/standalone" ]; then
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
chown -R photogal:photogal "$INSTALL_DIR" 2>/dev/null || true
chmod -R 775 "$INSTALL_DIR/data" "$INSTALL_DIR/storage" 2>/dev/null || true

# 9. Setup systemd service (if systemd is running)
if pidof systemd >/dev/null 2>&1 || [ -d /run/systemd/system ]; then
    echo -e "${BLUE}==>${NC} Installing systemd service..."
    chmod +x "$INSTALL_DIR/deploy/lxc/start.sh"
    chmod +x "$INSTALL_DIR/deploy/lxc/update.sh" 2>/dev/null || true
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
