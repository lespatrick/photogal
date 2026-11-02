#!/usr/bin/env bash
# ==============================================================================
# photogal — Proxmox VE Helper Script (Interactive Form / Setup Wizard)
# ==============================================================================
set -euo pipefail

# 1. Verify Proxmox VE environment
if ! command -v pct >/dev/null 2>&1; then
    echo -e "\033[0;31mError:\033[0m This script must be run directly on a Proxmox VE node host (pct command not found)." >&2
    exit 1
fi

# Detect whether whiptail is available and a controlling terminal exists
if command -v whiptail >/dev/null 2>&1 && [ -c /dev/tty ]; then
    USE_WHIPTAIL="true"
else
    USE_WHIPTAIL="false"
fi

# Helper functions for UI dialogs
input_box() {
    local title="$1"
    local text="$2"
    local default="${3:-}"
    local result=""
    if [ "$USE_WHIPTAIL" = "true" ]; then
        result=$(whiptail --title "$title" --backtitle "photogal — Proxmox VE Setup Wizard" --inputbox "$text" 12 72 "$default" 3>&1 1>&2 2>&3 < /dev/tty) || {
            echo "Installation cancelled." >&2
            exit 0
        }
    else
        echo -e "\n\033[1;34m[${title}]\033[0m $text"
        if [ -c /dev/tty ]; then
            read -r -p "Value [${default}]: " result < /dev/tty || exit 0
        else
            read -r -p "Value [${default}]: " result || exit 0
        fi
        result="${result:-$default}"
    fi
    echo "$result"
}

yesno_box() {
    local title="$1"
    local text="$2"
    if [ "$USE_WHIPTAIL" = "true" ]; then
        if whiptail --title "$title" --backtitle "photogal — Proxmox VE Setup Wizard" --yesno "$text" 17 74 3>&1 1>&2 2>&3 < /dev/tty; then
            return 0
        else
            return 1
        fi
    else
        echo -e "\n\033[1;34m[${title}]\033[0m\n$text"
        local ans=""
        if [ -c /dev/tty ]; then
            read -r -p "Proceed? (Y/n): " ans < /dev/tty || return 1
        else
            read -r -p "Proceed? (Y/n): " ans || return 1
        fi
        case "$ans" in
            [nN][oO]|[nN]) return 1 ;;
            *) return 0 ;;
        esac
    fi
}

menu_box() {
    local title="$1"
    local text="$2"
    local result=""
    shift 2
    if [ "$USE_WHIPTAIL" = "true" ]; then
        result=$(whiptail --title "$title" --backtitle "photogal — Proxmox VE Setup Wizard" --menu "$text" 14 74 2 "$@" 3>&1 1>&2 2>&3 < /dev/tty) || {
            echo "Installation cancelled." >&2
            exit 0
        }
    else
        echo -e "\n\033[1;34m[${title}]\033[0m $text"
        local keys=()
        while [ $# -gt 0 ]; do
            echo "  $1) $2"
            keys+=("$1")
            shift 2
        done
        if [ -c /dev/tty ]; then
            read -r -p "Enter choice [${keys[0]}]: " result < /dev/tty || exit 0
        else
            read -r -p "Enter choice [${keys[0]}]: " result || exit 0
        fi
        result="${result:-${keys[0]}}"
    fi
    echo "$result"
}

# 3. Detect Proxmox system defaults
NEXT_ID=$(pvesh get /cluster/nextid 2>/dev/null || pct list 2>/dev/null | awk 'NR>1 {print $1}' | sort -n | tail -1 | awk '{print $1+1}' || true)
NEXT_ID="${NEXT_ID:-205}"

DETECTED_STORAGE=$(pvesm status -content rootdir 2>/dev/null | awk 'NR>1 {print $1; exit}' || true)
DETECTED_STORAGE="${DETECTED_STORAGE:-local-lvm}"

DETECTED_BRIDGE=$(ip -o link show type bridge 2>/dev/null | awk -F': ' '{print $2}' | head -n1 || true)
DETECTED_BRIDGE="${DETECTED_BRIDGE:-vmbr0}"

# 4. Check for CLI arguments or launch interactive wizard
if [ $# -gt 0 ]; then
    # Non-interactive CLI mode
    CT_ID="${1:-$NEXT_ID}"
    CT_NAME="${2:-photogal}"
    STORAGE="${3:-$DETECTED_STORAGE}"
    BRIDGE="${4:-$DETECTED_BRIDGE}"
    HOST_STORAGE="${5:-}"
    HOST_DATA="${6:-}"
    MEMORY="2048"
    CORES="2"
    DISK_SIZE="16"
    ADMIN_PASS="admin123"
    ALLOW_HTTP="true"
else
    # Interactive Wizard Mode
    MODE=$(menu_box "photogal — Proxmox VE Setup" "Choose configuration mode for the new photogal container:" \
        "1" "Default Installation (Auto ID, 2 vCPU, 2GB RAM, internal storage)" \
        "2" "Advanced Installation (Custom: ID, Specs, Storage Pool & NAS Mounts)")

    if [ "$MODE" = "1" ]; then
        CT_ID="$NEXT_ID"
        CT_NAME="photogal"
        STORAGE="$DETECTED_STORAGE"
        DISK_SIZE="16"
        CORES="2"
        MEMORY="2048"
        BRIDGE="$DETECTED_BRIDGE"
        HOST_STORAGE=""
        HOST_DATA=""
        ADMIN_PASS="admin123"
        ALLOW_HTTP="true"
    else
        CT_ID=$(input_box "Container ID" "Enter unique Container ID (CTID):" "$NEXT_ID")
        CT_NAME=$(input_box "Hostname" "Enter container hostname:" "photogal")
        STORAGE=$(input_box "Root Storage Pool" "Enter Proxmox storage pool for container rootfs (e.g. local-lvm, local-zfs, local):" "$DETECTED_STORAGE")
        DISK_SIZE=$(input_box "Disk Size (GB)" "Enter root disk size in GB (e.g. 16, 32):" "16")
        CORES=$(input_box "CPU Cores" "Number of CPU cores allocated:" "2")
        MEMORY=$(input_box "RAM (MB)" "Memory allocated in MB:" "2048")
        BRIDGE=$(input_box "Network Bridge" "Select network bridge interface:" "$DETECTED_BRIDGE")

        HOST_STORAGE=$(input_box "Photo Storage Mount (Host Path)" "Optional host path or ZFS dataset for photos (e.g. /mnt/pve/nas/photos).\nLeave blank to use container internal disk:" "")
        HOST_DATA=$(input_box "Database Mount (Host Path)" "Optional host path for SQLite database (e.g. /mnt/pve/nas/data).\nLeave blank to use container internal disk:" "")

        ADMIN_PASS=$(input_box "Admin Password" "Initial administrator password for web UI:" "admin123")

        ACCESS_MODE=$(menu_box "Web Access Protocol" "How will clients and the photographer access the gallery?" \
            "1" "Direct HTTP on LAN / IP (ALLOW_HTTP=true)" \
            "2" "Behind HTTPS Reverse Proxy (Nginx / Caddy / Cloudflare)")

        if [ "$ACCESS_MODE" = "1" ]; then
            ALLOW_HTTP="true"
        else
            ALLOW_HTTP="false"
        fi
    fi

    # Sanitize DISK_SIZE to numeric GB only (pct create requires integer GB, e.g. '16' not '16G')
    DISK_SIZE_GB=$(echo "${DISK_SIZE}" | tr -dc '0-9')
    DISK_SIZE_GB="${DISK_SIZE_GB:-16}"

    # Review & Confirmation Screen
    CONFIRM_TEXT="Please review container configuration:

Container ID:        ${CT_ID}
Hostname:            ${CT_NAME}
Storage Pool:        ${STORAGE} (${DISK_SIZE_GB} GB)
vCPU / RAM:          ${CORES} Cores / ${MEMORY} MB
Network:             ${BRIDGE} (DHCP)
External Photos:     ${HOST_STORAGE:-None (Internal)}
External Database:   ${HOST_DATA:-None (Internal)}
Admin Password:      ${ADMIN_PASS}
Direct HTTP Mode:    ${ALLOW_HTTP}

Proceed with creating and launching the container?"

    if ! yesno_box "Confirm Installation" "$CONFIRM_TEXT"; then
        echo "Installation cancelled by user."
        exit 0
    fi
fi

# Sanitize DISK_SIZE for non-interactive CLI mode as well
DISK_SIZE_GB=$(echo "${DISK_SIZE:-16}" | tr -dc '0-9')
DISK_SIZE_GB="${DISK_SIZE_GB:-16}"

echo -e "\n\033[1;34m==>\033[0m Creating Proxmox LXC Container ID: ${CT_ID} (${CT_NAME})..."

# Validate STORAGE pool exists and supports container rootdir
if ! pvesm status -storage "${STORAGE}" >/dev/null 2>&1; then
    echo -e "\033[0;31mError:\033[0m Storage pool '${STORAGE}' was not found in Proxmox." >&2
    echo "Available storage pools supporting rootdir (containers):" >&2
    pvesm status -content rootdir 2>/dev/null || pvesm status 2>/dev/null || true
    exit 1
fi

# 5. Fetch Debian 12 standard template
TEMPLATE=$(ls -t /var/lib/vz/template/cache/debian-12-standard*.tar.* 2>/dev/null | head -n 1 || true)

if [ -z "$TEMPLATE" ]; then
    echo "==> Downloading Debian 12 standard template..."
    pveam update
    pveam download local "$(pveam available | grep "debian-12-standard" | tail -n1 | awk '{print $2}')"
    TEMPLATE=$(ls -t /var/lib/vz/template/cache/debian-12-standard*.tar.* | head -n 1)
fi

# 6. Create LXC container
echo "==> Creating LXC container #${CT_ID}..."
pct create "${CT_ID}" "${TEMPLATE}" \
    --hostname "${CT_NAME}" \
    --cores "${CORES}" \
    --memory "${MEMORY}" \
    --swap 512 \
    --rootfs "${STORAGE}:${DISK_SIZE_GB}" \
    --net0 name=eth0,bridge="${BRIDGE}",ip=dhcp,firewall=1 \
    --features nesting=1 \
    --unprivileged 1 \
    --onboot 1

# 7. Setup bind mounts for external storage pools / NAS if provided
if [ -n "${HOST_STORAGE}" ]; then
    echo "==> Configuring external photo storage bind mount: ${HOST_STORAGE} -> /opt/photogal/storage..."
    mkdir -p "${HOST_STORAGE}"
    pct set "${CT_ID}" -mp0 "${HOST_STORAGE},mp=/opt/photogal/storage"
    chown -R 100000:100000 "${HOST_STORAGE}" 2>/dev/null || chmod -R 775 "${HOST_STORAGE}" 2>/dev/null || true
fi

if [ -n "${HOST_DATA}" ]; then
    echo "==> Configuring external database bind mount: ${HOST_DATA} -> /opt/photogal/data..."
    mkdir -p "${HOST_DATA}"
    pct set "${CT_ID}" -mp1 "${HOST_DATA},mp=/opt/photogal/data"
    chown -R 100000:100000 "${HOST_DATA}" 2>/dev/null || chmod -R 775 "${HOST_DATA}" 2>/dev/null || true
fi

# 8. Start container and wait for network
echo "==> Starting LXC container #${CT_ID}..."
pct start "${CT_ID}"

echo "==> Waiting for container network..."
sleep 8

# 9. Install photogal inside container with configured credentials
echo "==> Installing photogal inside container..."
pct exec "${CT_ID}" -- env ADMIN_PASSWORD="${ADMIN_PASS}" ALLOW_HTTP="${ALLOW_HTTP}" bash -c "curl -fsSL https://raw.githubusercontent.com/lespatrick/photogal/main/deploy/lxc/install.sh | bash"

IP_ADDR=$(pct exec "${CT_ID}" -- hostname -I 2>/dev/null | awk '{print $1}' || echo "container_ip")
echo "============================================================"
echo "✓ photogal container #${CT_ID} is ready!"
echo "  Web UI: http://${IP_ADDR}:3000"
echo "  Admin:  http://${IP_ADDR}:3000/admin (User: admin, Hasło: ${ADMIN_PASS})"
echo "============================================================"
