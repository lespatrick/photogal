# 📦 photogal — Wdrożenie w kontenerze LXC (Proxmox VE / Linux Containers)

Katalog zawiera kompletne skrypty i konfiguracje do uruchomienia platformy **photogal** bezpośrednio w kontenerze LXC na systemach Proxmox VE, Debian, Ubuntu lub Alpine Linux.

---

## ⚡ Metoda 1: Interaktywny instalator Proxmox VE (z konsoli węzła PVE)

Uruchom poniższe polecenie w terminalu węzła Proxmox VE:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/lespatrick/photogal/main/deploy/lxc/proxmox-lxc.sh)"
```

Uruchomi się **interaktywny kreator (formularz TUI)** w stylu Proxmox Helper-Scripts:
- **Tryb Domyślny (Quick)**: Automatycznie wykrywa kolejny wolny ID kontenera, pulę dyskową (np. `local-lvm` lub `local-zfs`), przydziela 2 vCPU, 2GB RAM i 16GB dysku.
- **Tryb Zaawansowany (Custom)**: Pozwala w formularzu dostosować:
  - ID kontenera oraz nazwę hosta
  - Pulę dyskową i rozmiar dysku
  - Rdzenie CPU i pamięć RAM
  - Mostek sieciowy (bridge `vmbr0`)
  - **Ścieżkę do magazynu zdjęć na hoście / NAS (Bind-mount mp0)**
  - **Ścieżkę do bazy danych na hoście / NAS (Bind-mount mp1)**
  - Początkowe hasło administratora
  - Tryb protokołu (bezpośredni HTTP na LAN vs Reverse Proxy HTTPS)

> **Tryb wsadowy (headless / bez pytań)**:
> Skrypt akceptuje również argumenty z linii poleceń:
> ```bash
> ./proxmox-lxc.sh [CT_ID] [CT_NAME] [STORAGE_POOL] [BRIDGE] [HOST_PHOTOS_PATH] [HOST_DB_PATH]
> ```

---

## 🐧 Metoda 2: Instalacja wewnątrz istniejącego kontenera LXC

Zaloguj się do swojego kontenera Debian 12 / Ubuntu 24.04 / Alpine jako `root` i uruchom:

```bash
apt-get update -y && apt-get install -y curl && curl -fsSL https://raw.githubusercontent.com/lespatrick/photogal/main/deploy/lxc/install.sh | bash
```

---

## 🗄️ Podpinanie zewnętrznego magazynu (ZFS / NAS / NFS)

Istnieją dwie metody konfiguracji własnych ścieżek magazynu:

### Opcja A: Proxmox Host Bind-Mount (Zalecana)
W pliku `/etc/pve/lxc/<CTID>.conf` na hoście Proxmox dodaj punkty montowania:

```conf
# Podpięcie bazy danych i magazynu zdjęć
mp0: /mnt/pve/nas/photos,mp=/opt/photogal/storage
mp1: /mnt/pve/nas/data,mp=/opt/photogal/data
```

> **Ważne dla kontenerów Unprivileged**: Nadaj uprawnienia dla zmapowanego UID kontenera na hoście Proxmox:
> ```bash
> chown -R 100000:100000 /mnt/pve/nas/photos /mnt/pve/nas/data
> ```

### Opcja B: Wskazanie ścieżki w `/opt/photogal/.env`
Jeśli kontener montuje udział NFS/SMB bezpośrednio wewnątrz (np. w `/mnt/nas`), wskaż ścieżki w pliku `/opt/photogal/.env`:

```env
STORAGE_DIR=/mnt/nas/photos
DATA_DIR=/mnt/nas/data
```

---

## ⚙️ Konfiguracja zmiennych środowiskowych (`/opt/photogal/.env`)

Instalator automatycznie tworzy plik konfiguracyjny `/opt/photogal/.env` z losowo wygenerowanym kluczem sesji `AUTH_SECRET`:

| Zmienna | Domyślna wartość | Opis |
|---|---|---|
| `STORAGE_DIR` | `/opt/photogal/storage` | Ścieżka do magazynu zdjęć (oryginały, miniaturki WebP, podglądy). |
| `DATA_DIR` | `/opt/photogal/data` | Ścieżka do bazy danych SQLite (`photogal.db`). |
| `ALLOW_HTTP` | `true` | Pozwala na dostęp przez bezpośredni adres IP/HTTP w sieci LAN. Wyłącz (`false`), gdy wystawiasz za Reverse Proxy z HTTPS. |
| `TRUST_PROXY` | `true` | Ufa nagłówkom `X-Forwarded-For` i `X-Real-IP` z Nginx / Caddy / Cloudflare dla poprawnego rate-limitingu IP. |
| `ADMIN_PASSWORD` | `admin123` | Początkowe hasło administratora (zmień po pierwszym logowaniu). |
| `AUTH_SECRET` | *(losowy 64 hex)* | Klucz kryptograficzny HMAC do podpisywania tokenów sesji. |
| `ALLOWED_HOSTS` | *(opcjonalne)* | Dozwolone domeny (np. `galeria.twojadomena.pl`), ochrona przed Host Header Injection. |
| `RP_ID` / `RP_ORIGIN` | *(opcjonalne)* | Domena i adres HTTPS dla uwierzytelniania biometrycznego WebAuthn / Passkeys. |

Po edycji pliku `.env` zrestartuj usługę:
```bash
systemctl restart photogal
```

---

## 🛠️ Zarządzanie usługą `photogal` w kontenerze

```bash
# Status aplikacji
systemctl status photogal

# Podgląd logów w czasie rzeczywistym
journalctl -u photogal -f

# Restart po aktualizacji
systemctl restart photogal
```

---

## ⚡ Błyskawiczne Aktualizacje (GitHub Actions Pre-Built Standalone)

Dzięki workflow **GitHub Actions**, każdy push do gałęzi `main` oraz każdy release tag buduje gotowy, zoptymalizowany pakiet `photogal-standalone-linux-x64.tar.gz` (w środowisku Debian 12 Bookworm).

Podczas instalacji lub aktualizacji:
- Kontener pobiera gotowy pakiet standalone (~20MB) zamiast kompilować Next.js ze źródeł.
- Czas aktualizacji skraca się z **5 minut do ~5 sekund**, a przerwa w działaniu usługi wynosi **poniżej 2 sekund**.
- Brak obciążenia procesora i pamięci RAM węzła Proxmox / kontenera.

### Uruchomienie aktualizacji w kontenerze:
```bash
/opt/photogal/deploy/lxc/update.sh
```

### Opcje zaawansowane:
```bash
# Wymuszenie kompilacji ze źródeł (git pull + npm ci + npm run build)
/opt/photogal/deploy/lxc/update.sh --build-from-source

# Aktualizacja do konkretnego wydania (tagu)
/opt/photogal/deploy/lxc/update.sh --tag=v1.0.0
```

---

## 🛡️ Bezpieczeństwo Danych, Kopie Zapasowe i Odzyskiwanie

### Automatyczne kopie przed każdą aktualizacją
Przed każdą aktualizacją skrypt `/opt/photogal/deploy/lxc/update.sh` wykonuje automatyczną kopię bazy danych SQLite oraz pliku `.env` w katalogu:
`/opt/photogal/backups/backup-YYYYMMDD_HHMMSS/`
System automatycznie zachowuje 5 najświeższych kopii zapasowych.

### Przywrócenie bazy danych z kopii zapasowej:
Jeśli zajdzie potrzeba przywrócenia stanu bazy sprzed aktualizacji:
```bash
# 1. Zatrzymaj usługę
systemctl stop photogal

# 2. Skopiuj bazę z wybranego folderu kopii zapasowej
cp -a /opt/photogal/backups/backup-<TIMESTAMP>/data/. /opt/photogal/data/

# 3. Uruchom usługę
systemctl start photogal
```

### 🔍 Diagnostyka bazy danych (Liczba galerii, zdjęć, spójność)
Aby w dowolnym momencie sprawdzić stan bazy, liczbę zarejestrowanych galerii, zdjęć i wyborów klientów:
```bash
# Szybka inspekcja domyślnej bazy danych
node /opt/photogal/scripts/check-db.js

# Inspekcja konkretnego pliku (np. z kopii zapasowej)
node /opt/photogal/scripts/check-db.js /opt/photogal/backups/backup-<TIMESTAMP>/data/photogal.db

# Format JSON dla skryptów monitoringu
node /opt/photogal/scripts/check-db.js --json
```

### 🚑 Narzędzie ratunkowe: Odzyskiwanie galerii z dysku (Storage Scanner)
Jeśli po wcześniejszych wersjach skryptu baza uległa wyzerowaniu, ale zdjęcia fizycznie znajdują się w `/opt/photogal/storage/galleries/`:
```bash
# Skanowanie i podgląd galerii do odzyskania (tryb bezpieczny / dry-run)
node /opt/photogal/scripts/recover-galleries.js

# Wykonanie odzyskania i zarejestrowanie galerii oraz zdjęć w bazie danych:
node /opt/photogal/scripts/recover-galleries.js --execute
```
Narzędzie przeskanuje pliki na dysku, wyliczy wymiary zdjęć oraz odtworzy rekordy galerii z kodem PIN `1234` (możesz go zmienić w panelu `/admin`).
