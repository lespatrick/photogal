<div align="center">

# 📷 photogal
### Autorska Platforma Prezentacji & Selekcji Zdjęć dla Fotografów

*Minimalistyczna, ultraszybka aplikacja PWA zaprojektowana z myślą o profesjonalnym studio fotograficznym i eleganckim doświadczeniu klienta.*

[![Next.js](https://img.shields.io/badge/Next.js-16.4-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![SQLite](https://img.shields.io/badge/SQLite-WAL_Mode-003B57?style=for-the-badge&logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![WebAuthn](https://img.shields.io/badge/WebAuthn-Passkeys_FIDO2-4285F4?style=for-the-badge&logo=fido&logoColor=white)](https://webauthn.io/)
[![PWA](https://img.shields.io/badge/PWA-Ready-5A0FC8?style=for-the-badge&logo=pwa&logoColor=white)](https://web.dev/progressive-web-apps/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)

[Przegląd](#-o-projekcie) •
[Funkcje](#-kluczowe-funkcjonalności) •
[Bezpieczeństwo](#-architektura-bezpieczeństwa) •
[Szybki Start](#-instalacja-i-uruchomienie) •
[Docker](#-konteneryzacja-docker) •
[Struktura](#-struktura-katalogów)

---

</div>

## 🌿 O Projekcie

**photogal** to kompletny system do udostępniania galerii i selekcji ujęć po sesjach zdjęciowych (śluby, plenery, sesje studyjne i biznesowe).

Aplikacja powstała jako niezależna, self-hosted alternatywa dla komercyjnych serwisów (takich jak Photonesto, Pic-Time czy Pixieset), stawiająca na:
- **Redakcyjny, bezkompromisowy minimalizm** — brak szablonowych gradientów czy zbędnych ozdobników; fotografie są na pierwszym planie (typografia *Cormorant Garamond* + *Inter*).
- **Czysty Vanilla CSS** — 100% lekki, dedykowany arkusz stylów z pełną obsługą trybu ciemnego (Dark) i jasnego (Light).
- **Zero zewnętrznych zależności chmurowych** — SQLite w trybie WAL oraz lokalny system plików ze strumieniową kompresją Sharp.

---

## ✨ Kluczowe Funkcjonalności

### 1. Panel Fotografa (`/admin`)
* **Uwierzytelnianie biometryczne Passkey (FIDO2)**: Logowanie 1 kliknięciem przez Touch ID, Face ID, Windows Hello lub klucze sprzętowe YubiKey (z bezpiecznym fallbackiem na hasło).
* **Zarządzanie bezpieczeństwem**: Wbudowany modal do natychmiastowej zmiany hasła administratora oraz zarządzania zarejestrowanymi kluczami biometrycznymi.
* **Nowoczesny kreator sesji**: Definiowanie tytułu, daty sesji, tekstu powitalnego, limitu kadrów w cenie pakietu oraz losowanie 4-cyfrowego kodu PIN.
* **Upload Drag & Drop z automatyczną optymalizacją**:
  * Przyjmuje oryginalne pliki `.JPG` / `.JPEG`.
  * W locie generuje miniatury siatki **WebP (do 600px)** oraz podglądy pełnoekranowe **WebP (do 2200px)** przy użyciu biblioteki `sharp`.
  * Zachowuje pliki źródłowe do eksportu i pobierania pełnej jakości.
* **Płynny podgląd wyborów i notatek**: Zliczanie polubień w czasie rzeczywistym, wgląd w uwagi klienta i status realizacji.
* **Eksport do Lightroom & Capture One**:
  * Kopiowanie nazw plików oddzielonych przecinkami (`_DSC0012.JPG, _DSC0015.JPG`).
  * Kopiowanie z rozdzieleniem spacjami (wyszukiwarka biblioteki Lightroom).
  * Kopiowanie nazw bez rozszerzeń oraz pobieranie gotowego pliku tekstowego `.txt`.
* **Strumieniowe archiwum ZIP**: Generowanie paczki ze wszystkimi lub tylko wybranymi kadrami bezpośrednio z poziomu panelu.
* **Bezpieczne usuwanie**: Dedykowane modale potwierdzenia eliminujące przypadkowe usunięcie sesji, zdjęć lub kluczy dostępu.

### 2. Widok Klienta (`/g/[slug]`)
* **PIN Gate**: Dyskretny ekran weryfikacji kodu dostępu zapobiegający nieautoryzowanemu wglądowi w sesję.
* **Układ Masonry**: Automatycznie dopasowująca się responsywna siatka z obsługą zdjęć pionowych, poziomych i panoramicznych.
* **Dedykowany Lightbox**:
  * Pełne wsparcie dla gestów dotykowych (**Swipe w lewo / w prawo** na smartfonach).
  * Skróty klawiszowe na komputerach.
  * Natychmiastowe oznaczanie polubienia ujęcia serduszkiem.
* **Pływający dock postępu (Sticky Bottom Dock)**:
  * Stały wskaźnik postępu (np. `Wybrano 15 z 20 kadrów`).
  * Pasek procentowy dopełnienia pakietu.
  * Przycisk finalizacji selekcji.
* **Finalizacja i zablokowanie**:
  * Podsumowanie wyboru z polem na dodatkowe uwagi od klienta.
  * Automatyczne oznaczenie sesji jako zrealizowanej i zablokowanie dalszych modyfikacji.
* **PWA & Offline cache**: Możliwość zainstalowania jako aplikacja na ekranie głównym telefonu lub komputera (Service Worker + Web App Manifest).

---

## 🛡️ Architektura Bezpieczeństwa

System został zabezpieczony przed typowymi wektorami ataków na galerie prywatne:

| Mechanizm | Zastosowanie |
|---|---|
| **Constant-Time PIN Verification** | Wykorzystanie `crypto.timingSafeEqual` uniemożliwia ataki typu *timing attack* analizujące czas odpowiedzi CPU. |
| **Tarpit Delay** | Po 3 błędnych próbach PIN serwer narzuca sztuczne, progresywne opóźnienie `2.5s`, paraliżując automatyczne skanery. |
| **Soft IP Lockout** | Po 5 nieudanych próbach adres IP klienta jest blokowany na 15 minut (`HTTP 429 Too Many Requests`). |
| **Hard Gallery Lock** | Po 10 łącznych niepowodzeniach cała galeria przechodzi w stan blokady awaryjnej, wymagającej 1 kliknięcia fotografa w panelu admina. |
| **Privacy IP Hashing** | Adresy IP w bazie są natychmiast haszowane solonym `SHA-256` w celu pełnej zgodności z RODO/GDPR. |
| **Bezpieczne Sesje Admina** | Ciasteczka `HttpOnly`, `SameSite=Lax` podpisane HMAC-SHA256 z kluczem `AUTH_SECRET`. |

---

## ⌨️ Skróty Klawiszowe (Pełny Ekran / Lightbox)

| Klawisz | Akcja |
|:---:|---|
| <kbd>→</kbd> lub <kbd>L</kbd> | Następne zdjęcie |
| <kbd>←</kbd> lub <kbd>H</kbd> | Poprzednie zdjęcie |
| <kbd>Spacja</kbd> lub <kbd>F</kbd> | Polub / Odznacz zdjęcie |
| <kbd>Esc</kbd> | Zamknij podgląd pełnoekranowy |

---

## 🚀 Instalacja i Uruchomienie

### Wymagania wstępne:
- Node.js 18.x lub nowszy
- npm / pnpm / yarn

### 1. Klonowanie i instalacja pakietów:
```bash
git clone https://github.com/lespatrick/photogal.git
cd photogal
npm install
```

### 2. Inicjalizacja bazy i danych demonstracyjnych:
```bash
node scripts/seed-demo.js
```
*Skrypt tworzy bazę `data/photogal.db` oraz przykładową sesję ślubną.*

### 3. Uruchomienie w trybie deweloperskim:
```bash
npm run dev
```
Aplikacja uruchomi się pod adresem: **http://localhost:3000**

---

## 🐳 Konteneryzacja (Docker)

Aplikacja posiada zoptymalizowany wieloetapowy plik `Dockerfile` (Node.js Alpine) oraz `docker-compose.yml` z trwałymi wolumenami dla bazy i zdjęć:

```bash
# Uruchomienie kontenera w tle
docker compose up -d --build

# Podgląd logów
docker compose logs -f
```

### Wolumeny danych:
- `./data` — baza danych SQLite (`photogal.db`)
- `./storage` — katalog zdjęć oryginalnych oraz wygenerowanych miniatur WebP

---

## 🔑 Domyślne Dane Dostępowe

| Sekcja | URL | Dostęp |
|---|---|---|
| **Strona Główna** | `/` | Dostępna publicznie |
| **Panel Administratora** | `/admin` | Login: `admin`<br>Hasło: `admin123` *(zmień w sekcji Bezpieczeństwo)* |
| **Przykładowa Galeria** | `/g/anna-i-piotr-slub` | PIN: `2026` |

---

## 📁 Struktura Katalogów

```text
photogal/
├── data/                      # Baza danych SQLite (photogal.db, WAL)
├── public/                    # Zasoby statyczne, manifest PWA, Service Worker
├── scripts/                   # Skrypt inicjalizacji demo (seed-demo.js)
├── storage/                   # Zdjęcia oryginalne, miniatury WebP i podglądy
│   └── galleries/[id]/
│       ├── original/          # Źródłowe JPG
│       ├── thumb/             # Zoptymalizowane WebP (siatka)
│       └── preview/           # Podgląd pełnoekranowy WebP
├── src/
│   ├── app/                   # Next.js App Router
│   │   ├── admin/             # Panel fotografa & logowanie
│   │   ├── api/               # Endpointy REST (Auth, Passkey, Galerie, ZIP)
│   │   ├── g/[slug]/          # Widok klienta (PIN, Masonry, Lightbox)
│   │   ├── globals.css        # Kompletny minimalistyczny system stylów Vanilla CSS
│   │   └── layout.tsx         # Główny layout z motywami i PWA
│   ├── components/            # Komponenty UI (ThemeToggle, ToastProvider)
│   └── lib/                   # Logika biznesowa (db.ts, auth.ts, storage.ts, webauthn.ts)
├── Dockerfile                 # Produkcyjny obraz Docker
├── docker-compose.yml         # Konfiguracja Compose
└── package.json               # Zależności projektu
```

---

<div align="center">
  <sub>Stworzone z dbałością o estetykę i kunszt fotografii — <strong>photogal</strong></sub>
</div>
