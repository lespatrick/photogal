#!/usr/bin/env bash
# ==============================================================================
# photogal — Proxmox VE Helper Script (Run on Proxmox VE Node Host)
# ==============================================================================
set -euo pipefail

CT_ID="${1:-205}"
CT_NAME="${2:-photogal}"
STORAGE="${3:-local-lvm}"
BRIDGE="${4:-vmbr0}"
MEMORY="2048"
CORES="2"
DISK_SIZE="16G"

echo "==> Creating Proxmox LXC Container ID: ${CT_ID} (${CT_NAME})..."

# Find latest Debian 12 template in /var/lib/vz/template/cache
TEMPLATE=$(ls -t /var/lib/vz/template/cache/debian-12-standard*.tar.* 2>/dev/null | head -n 1 || true)

if [ -z "$TEMPLATE" ]; then
    echo "==> Downloading Debian 12 standard template..."
    pveam update
    pveam download local $(pveam available | grep "debian-12-standard" | tail -n1 | awk '{print $2}')
    TEMPLATE=$(ls -t /var/lib/vz/template/cache/debian-12-standard*.tar.* | head -n 1)
fi

echo "==> Creating LXC container..."
pct create "${CT_ID}" "${TEMPLATE}" \
    --hostname "${CT_NAME}" \
    --cores "${CORES}" \
    --memory "${MEMORY}" \
    --swap 512 \
    --rootfs "${STORAGE}:${DISK_SIZE}" \
    --net0 name=eth0,bridge="${BRIDGE}",ip=dhcp,firewall=1 \
    --features nesting=1 \
    --unprivileged 1 \
    --onboot 1 \
    --start 1

echo "==> Waiting for container network..."
sleep 8

echo "==> Installing photogal inside container..."
pct exec "${CT_ID}" -- bash -c "curl -fsSL https://raw.githubusercontent.com/lespatrick/photogal/main/deploy/lxc/install.sh | bash"

IP_ADDR=$(pct exec "${CT_ID}" -- hostname -I | awk '{print $1}')
echo "============================================================"
echo "✓ photogal container #${CT_ID} is ready!"
echo "  Web UI: http://${IP_ADDR}:3000"
echo "============================================================"
