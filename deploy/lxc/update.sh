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

INSTALL_DIR="${INSTALL_DIR:-/opt/photogal}"
PHOTOGAL_REPO="${PHOTOGAL_REPO:-lespatrick/photogal}"
BUILD_FROM_SOURCE="false"
RELEASE_TAG="latest"
CLEANUP_DIR=""
trap '[ -n "${CLEANUP_DIR:-}" ] && rm -rf "$CLEANUP_DIR"' EXIT

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
# RESCUE & MIGRATE: Move .next/standalone data as primary production data
# ------------------------------------------------------------------------------
rescue_standalone_data() {
    # 1. Stop service first so SQLite checkpoints WAL cleanly before file operations
    if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet photogal.service 2>/dev/null; then
        echo -e "${BLUE}==>${NC} Stopping photogal service for data migration..."
        systemctl stop photogal.service 2>/dev/null || true
    fi

    # 2. Treat .next/standalone/data as primary production database if it exists and is not a symlink
    if [ -d "$INSTALL_DIR/.next/standalone/data" ] && [ ! -L "$INSTALL_DIR/.next/standalone/data" ]; then
        if [ -f "$INSTALL_DIR/.next/standalone/data/photogal.db" ]; then
            echo -e "${YELLOW}==>${NC} Migrating primary production database from .next/standalone/data to $INSTALL_DIR/data/..."
            mkdir -p "$INSTALL_DIR/data"
            cp -a "$INSTALL_DIR/.next/standalone/data/." "$INSTALL_DIR/data/"
            echo -e "${GREEN}✓${NC} Database successfully moved to primary path."
        fi
    fi

    # 3. Treat .next/standalone/storage/galleries as primary storage if it exists and is not a symlink
    if [ -d "$INSTALL_DIR/.next/standalone/storage/galleries" ] && [ ! -L "$INSTALL_DIR/.next/standalone/storage/galleries" ]; then
        echo -e "${YELLOW}==>${NC} Migrating photo galleries from .next/standalone/storage to $INSTALL_DIR/storage/..."
        mkdir -p "$INSTALL_DIR/storage/galleries"
        cp -a "$INSTALL_DIR/.next/standalone/storage/galleries/." "$INSTALL_DIR/storage/galleries/"
        echo -e "${GREEN}✓${NC} Photos successfully moved to primary storage path."
    fi
}

# ------------------------------------------------------------------------------
# POST-UPDATE CLEANUP: Completely remove legacy standalone data paths (no symlinks)
# ------------------------------------------------------------------------------
cleanup_standalone_data() {
    if [ -d "$INSTALL_DIR/.next/standalone" ]; then
        echo -e "${BLUE}==>${NC} Removing legacy standalone data and storage paths..."
        if [ -d "$INSTALL_DIR/.next/standalone/data" ] && [ ! -L "$INSTALL_DIR/.next/standalone/data" ]; then
            rm -rf "$INSTALL_DIR/.next/standalone/data"
        elif [ -L "$INSTALL_DIR/.next/standalone/data" ]; then
            rm -f "$INSTALL_DIR/.next/standalone/data"
        fi

        if [ -d "$INSTALL_DIR/.next/standalone/storage" ] && [ ! -L "$INSTALL_DIR/.next/standalone/storage" ]; then
            rm -rf "$INSTALL_DIR/.next/standalone/storage"
        elif [ -L "$INSTALL_DIR/.next/standalone/storage" ]; then
            rm -f "$INSTALL_DIR/.next/standalone/storage"
        fi
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

    CLEANUP_DIR=$(mktemp -d /tmp/photogal-update-XXXXXX)
    local tmp_dir="$CLEANUP_DIR"

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
                rm -rf "$CLEANUP_DIR"
                CLEANUP_DIR=""
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

    # Post-update cleanup: remove legacy standalone data and ensure proper symlinks
    cleanup_standalone_data

    echo -e "\n${GREEN}✓ photogal updated instantly via pre-built package!${NC}"
    rm -rf "$CLEANUP_DIR"
    CLEANUP_DIR=""
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

    # Post-update cleanup: remove legacy standalone data and ensure proper symlinks
    cleanup_standalone_data

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
