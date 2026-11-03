#!/usr/bin/env bash
# ==============================================================================
# photogal — Fast In-Place Updater for LXC / VM deployments
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
            echo "Usage: ./update.sh [OPTIONS]"
            echo "Options:"
            echo "  --build-from-source, -s   Force recompilation from source (git pull + npm build)"
            echo "  --tag=<tag>               Install specific GitHub Release tag (default: latest)"
            echo "  --help, -h                Show this help message"
            exit 0
            ;;
    esac
done

if [ ! -d "$INSTALL_DIR" ]; then
    echo -e "${RED}Error:${NC} Directory $INSTALL_DIR does not exist."
    exit 1
fi

echo -e "${BLUE}==>${NC} Updating photogal..."
ARCH=$(uname -m)

# ------------------------------------------------------------------------------
# RESCUE & MIGRATE: Rescue any database or photos saved in .next/standalone
# ------------------------------------------------------------------------------
rescue_standalone_data() {
    # Check if .next/standalone/data has a database that is NOT a symlink
    if [ -f "$INSTALL_DIR/.next/standalone/data/photogal.db" ] && [ ! -L "$INSTALL_DIR/.next/standalone/data/photogal.db" ]; then
        local standalone_size root_size
        standalone_size=$(stat -c%s "$INSTALL_DIR/.next/standalone/data/photogal.db" 2>/dev/null || stat -f%z "$INSTALL_DIR/.next/standalone/data/photogal.db" 2>/dev/null || echo 0)
        root_size=0
        if [ -f "$INSTALL_DIR/data/photogal.db" ] && [ ! -L "$INSTALL_DIR/data/photogal.db" ]; then
            root_size=$(stat -c%s "$INSTALL_DIR/data/photogal.db" 2>/dev/null || stat -f%z "$INSTALL_DIR/data/photogal.db" 2>/dev/null || echo 0)
        fi

        # If root database is missing, empty, or standalone has a larger database
        if [ "$root_size" -lt 10000 ] || [ "$standalone_size" -gt "$root_size" ]; then
            echo -e "${YELLOW}==>${NC} Rescuing database from legacy .next/standalone location to $INSTALL_DIR/data/..."
            mkdir -p "$INSTALL_DIR/data"
            cp -a "$INSTALL_DIR/.next/standalone/data/." "$INSTALL_DIR/data/"
        fi
    fi

    # Check if .next/standalone/storage/galleries has folders and is NOT a symlink
    if [ -d "$INSTALL_DIR/.next/standalone/storage/galleries" ] && [ ! -L "$INSTALL_DIR/.next/standalone/storage/galleries" ]; then
        echo -e "${YELLOW}==>${NC} Rescuing photo galleries from legacy .next/standalone location..."
        mkdir -p "$INSTALL_DIR/storage/galleries"
        cp -an "$INSTALL_DIR/.next/standalone/storage/galleries/." "$INSTALL_DIR/storage/galleries/" 2>/dev/null || \
        cp -a "$INSTALL_DIR/.next/standalone/storage/galleries/." "$INSTALL_DIR/storage/galleries/" 2>/dev/null || true
    fi
}

# ------------------------------------------------------------------------------
# SAFETY: Automated Snapshot / Backup of Database & Configuration
# ------------------------------------------------------------------------------
backup_user_data() {
    # First rescue any files if they were in the legacy standalone path
    rescue_standalone_data

    local backup_root="$INSTALL_DIR/backups"
    local timestamp
    timestamp=$(date +"%Y%m%d_%H%M%S")
    local backup_dest="$backup_root/backup-$timestamp"

    if [ -d "$INSTALL_DIR/data" ] || [ -f "$INSTALL_DIR/.env" ] || [ -d "$INSTALL_DIR/.next/standalone/data" ]; then
        echo -e "${BLUE}==>${NC} Creating automated pre-update backup at $backup_dest..."
        mkdir -p "$backup_dest"
        if [ -d "$INSTALL_DIR/data" ]; then
            cp -a "$INSTALL_DIR/data" "$backup_dest/" 2>/dev/null || true
        fi
        if [ -d "$INSTALL_DIR/.next/standalone/data" ] && [ ! -L "$INSTALL_DIR/.next/standalone/data" ]; then
            cp -a "$INSTALL_DIR/.next/standalone/data" "$backup_dest/standalone-data" 2>/dev/null || true
        fi
        if [ -f "$INSTALL_DIR/.env" ]; then
            cp -a "$INSTALL_DIR/.env" "$backup_dest/" 2>/dev/null || true
        fi

        # Prune old backups: keep the 5 most recent
        local old_backups
        old_backups=$(ls -dt "$backup_root"/backup-* 2>/dev/null | tail -n +6 || true)
        if [ -n "$old_backups" ]; then
            echo "$old_backups" | xargs rm -rf 2>/dev/null || true
        fi
        echo -e "${GREEN}✓${NC} Pre-update backup created."
    fi
}

# ------------------------------------------------------------------------------
# FAST PATH: Download pre-built standalone bundle from GitHub Actions Releases
# ------------------------------------------------------------------------------
fast_update() {
    local tarball_url="https://github.com/${PHOTOGAL_REPO}/releases/download/${RELEASE_TAG}/photogal-standalone-linux-x64.tar.gz"
    local sha_url="${tarball_url}.sha256"

    echo -e "${BLUE}==>${NC} Checking for pre-built release package ($ARCH) from GitHub Actions..."
    
    # Check if release asset exists
    if ! curl -fsSLI "$tarball_url" >/dev/null 2>&1; then
        echo -e "${YELLOW}Notice:${NC} Pre-built release not found at $tarball_url. Falling back to source build."
        return 1
    fi

    # Perform automated backup before any file changes
    backup_user_data

    local tmp_dir
    tmp_dir=$(mktemp -d /tmp/photogal-update-XXXXXX)
    trap 'rm -rf "$tmp_dir"' EXIT

    echo -e "${BLUE}==>${NC} Downloading pre-built standalone bundle..."
    curl -fsSL "$tarball_url" -o "$tmp_dir/bundle.tar.gz"

    # Verify sha256 checksum if available
    if curl -fsSL "$sha_url" -o "$tmp_dir/bundle.tar.gz.sha256" 2>/dev/null; then
        echo -e "${BLUE}==>${NC} Verifying SHA-256 integrity..."
        local expected_sha actual_sha
        expected_sha=$(awk '{print $1}' "$tmp_dir/bundle.tar.gz.sha256" | tr -d ' \r\n')
        actual_sha=""
        if command -v sha256sum >/dev/null 2>&1; then
            actual_sha=$(sha256sum "$tmp_dir/bundle.tar.gz" | awk '{print $1}' | tr -d ' \r\n')
        elif command -v shasum >/dev/null 2>&1; then
            actual_sha=$(shasum -a 256 "$tmp_dir/bundle.tar.gz" | awk '{print $1}' | tr -d ' \r\n')
        fi

        if [ -n "$expected_sha" ] && [ -n "$actual_sha" ]; then
            if [ "$expected_sha" != "$actual_sha" ]; then
                echo -e "${RED}Warning:${NC} Checksum mismatch (expected $expected_sha, got $actual_sha). Falling back to source build."
                return 1
            fi
            echo -e "${GREEN}✓${NC} Checksum verified."
        fi
    fi

    # Extract to staging directory
    mkdir -p "$tmp_dir/extracted"
    tar -xzf "$tmp_dir/bundle.tar.gz" -C "$tmp_dir/extracted"

    # CRITICAL DATA PROTECTION: Strip any data, storage, backups, or .env files from the bundle
    # to guarantee user databases and media are NEVER overwritten
    rm -rf "$tmp_dir/extracted/data"
    rm -rf "$tmp_dir/extracted/storage"
    rm -rf "$tmp_dir/extracted/backups"
    rm -f "$tmp_dir/extracted/.env"*

    # Stop service only right before swapping files (< 2 seconds downtime)
    if command -v systemctl >/dev/null 2>&1; then
        echo -e "${BLUE}==>${NC} Stopping photogal service for file swap..."
        systemctl stop photogal.service 2>/dev/null || true
    fi

    # Ensure persistent directories exist before sync
    mkdir -p "$INSTALL_DIR/data" "$INSTALL_DIR/storage"

    # Sync extracted files into INSTALL_DIR, preserving existing data, storage, and .env
    cp -a "$tmp_dir/extracted/." "$INSTALL_DIR/"

    # Re-apply symlinks for data and storage if standalone uses nested folder
    if [ -d "$INSTALL_DIR/.next/standalone" ]; then
        rm -rf "$INSTALL_DIR/.next/standalone/data" "$INSTALL_DIR/.next/standalone/storage"
        ln -sfn "$INSTALL_DIR/data" "$INSTALL_DIR/.next/standalone/data"
        ln -sfn "$INSTALL_DIR/storage" "$INSTALL_DIR/.next/standalone/storage"
    fi

    # Update systemd service definition and launcher
    if [ -f "$INSTALL_DIR/deploy/lxc/photogal.service" ] && [ -d /etc/systemd/system ]; then
        cp "$INSTALL_DIR/deploy/lxc/photogal.service" /etc/systemd/system/photogal.service
        chmod +x "$INSTALL_DIR/deploy/lxc/start.sh"
        chmod +x "$INSTALL_DIR/deploy/lxc/update.sh"
        systemctl daemon-reload
    fi

    # Fix permissions
    chown -R photogal:photogal "$INSTALL_DIR" 2>/dev/null || true
    chmod -R 775 "$INSTALL_DIR/data" "$INSTALL_DIR/storage" 2>/dev/null || true

    # Restart service immediately
    if command -v systemctl >/dev/null 2>&1; then
        echo -e "${BLUE}==>${NC} Starting photogal service..."
        systemctl restart photogal.service
        sleep 1
        systemctl status photogal.service --no-pager || true
    fi

    echo -e "\n${GREEN}✓ photogal updated instantly via pre-built package!${NC}"
    return 0
}

# ------------------------------------------------------------------------------
# FALLBACK: Compile from source (git pull + npm install + npm run build)
# ------------------------------------------------------------------------------
source_update() {
    echo -e "${BLUE}==>${NC} Compiling from source..."

    # Pre-update automated backup
    backup_user_data

    # 1. Stop systemd service first so it does not loop during build
    if command -v systemctl >/dev/null 2>&1; then
        echo -e "${BLUE}==>${NC} Stopping photogal service..."
        systemctl stop photogal.service 2>/dev/null || true
    fi

    cd "$INSTALL_DIR"

    # 2. Pull latest git commits cleanly if .git directory exists
    if [ -d "$INSTALL_DIR/.git" ]; then
        git fetch origin main
        git reset --hard origin/main
    else
        echo -e "${YELLOW}Notice:${NC} No .git directory found. Cloning fresh repository..."
        git clone "https://github.com/${PHOTOGAL_REPO}.git" "$INSTALL_DIR.tmp"
        cp -a "$INSTALL_DIR.tmp/.git" "$INSTALL_DIR/"
        rm -rf "$INSTALL_DIR.tmp"
        git reset --hard origin/main
    fi

    # 3. Update systemd service definition and launcher immediately
    if [ -f "$INSTALL_DIR/deploy/lxc/photogal.service" ] && [ -d /etc/systemd/system ]; then
        cp "$INSTALL_DIR/deploy/lxc/photogal.service" /etc/systemd/system/photogal.service
        chmod +x "$INSTALL_DIR/deploy/lxc/start.sh"
        chmod +x "$INSTALL_DIR/deploy/lxc/update.sh"
        systemctl daemon-reload
    fi

    # 4. Install dependencies
    echo -e "${BLUE}==>${NC} Installing dependencies..."
    npm install

    # 5. Build Next.js application
    echo -e "${BLUE}==>${NC} Building production bundle..."
    NODE_OPTIONS="--max-old-space-size=2048" npm run build

    # 6. Synchronize standalone assets
    if [ -d "$INSTALL_DIR/.next/standalone" ]; then
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
        
        # Ensure root server.js is updated as well for consistent start.sh execution
        if [ -f "$INSTALL_DIR/.next/standalone/server.js" ]; then
            cp "$INSTALL_DIR/.next/standalone/server.js" "$INSTALL_DIR/server.js" 2>/dev/null || true
        fi

        mkdir -p "$INSTALL_DIR/data" "$INSTALL_DIR/storage"
        rm -rf "$INSTALL_DIR/.next/standalone/data" "$INSTALL_DIR/.next/standalone/storage"
        ln -sfn "$INSTALL_DIR/data" "$INSTALL_DIR/.next/standalone/data"
        ln -sfn "$INSTALL_DIR/storage" "$INSTALL_DIR/.next/standalone/storage"
    fi

    # 7. Fix directory permissions
    mkdir -p "$INSTALL_DIR/data" "$INSTALL_DIR/storage"
    chown -R photogal:photogal "$INSTALL_DIR" 2>/dev/null || true
    chmod -R 775 "$INSTALL_DIR/data" "$INSTALL_DIR/storage" 2>/dev/null || true

    # 8. Start service
    if command -v systemctl >/dev/null 2>&1; then
        echo -e "${BLUE}==>${NC} Starting photogal service..."
        systemctl restart photogal.service
        sleep 2
        systemctl status photogal.service --no-pager || true
    fi

    echo -e "\n${GREEN}✓ photogal updated and running from source!${NC}"
}

# Run fast update for x86_64 unless source compilation requested
if [ "$BUILD_FROM_SOURCE" != "true" ] && [ "$ARCH" = "x86_64" ]; then
    if fast_update; then
        exit 0
    fi
fi

# Fallback to source compilation
source_update
