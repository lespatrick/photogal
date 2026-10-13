# 📦 photogal — Wdrożenie w kontenerze LXC (Proxmox VE / Linux Containers)

Katalog zawiera kompletne skrypty i konfiguracje do uruchomienia platformy **photogal** bezpośrednio w kontenerze LXC na systemach Proxmox VE, Debian, Ubuntu lub Alpine Linux.

---

## ⚡ Metoda 1: Szybka instalacja na Proxmox VE (z konsoli węzła PVE)

Uruchom poniższe polecenie w terminalu hosta Proxmox VE:

```bash
curl -fsSL https://raw.githubusercontent.com/lespatrick/photogal/main/deploy/lxc/proxmox-lxc.sh | bash
```

Skrypt automatycznie:
1. Utworzy unprivileged kontener Debian 12 (CT ID: `205`, 2 rdzenie CPU, 2048 MB RAM, 16 GB dysk).
2. Włączy zagnieżdżanie (`nesting=1`).
3. Zainstaluje Node.js 22 LTS, sklonuje repozytorium do `/opt/photogal` i skompiluje aplikację.
4. Skonfiguruje usługę systemd `photogal.service` uruchamianą automatycznie przy starcie kontenera.

---

## 🐧 Metoda 2: Instalacja wewnątrz istniejącego kontenera LXC

Zaloguj się do swojego kontenera Debian 12 / Ubuntu 24.04 / Alpine jako `root` i uruchom:

```bash
curl -fsSL https://raw.githubusercontent.com/lespatrick/photogal/main/deploy/lxc/install.sh | bash
```

---

## 🗄️ Podpinanie zewnętrznego magazynu (ZFS / NAS / NFS)

W przypadku przechowywania dużych sesji fotograficznych na osobnym wolumenie ZFS lub udziale sieciowym NAS, dodaj punkt montowania (Mount Point) w pliku `/etc/pve/lxc/<CTID>.conf` na hoście Proxmox:

```conf
# Podpięcie bazy danych i magazynu zdjęć
mp0: /mnt/pve/nas/photogal-data,mp=/opt/photogal/data
mp1: /mnt/pve/nas/photogal-storage,mp=/opt/photogal/storage
```

---

## ⚙️ Zarządzanie usługą `photogal` w kontenerze

```bash
# Status aplikacji
systemctl status photogal

# Podgląd logów w czasie rzeczywistym
journalctl -u photogal -f

# Restart po aktualizacji
systemctl restart photogal
```
