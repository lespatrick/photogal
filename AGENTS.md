# AGENTS.md — Developer & AI Agent Guide for photogal

This document provides architectural context, coding standards, and operational guidelines for AI agents and human developers maintaining **photogal**.

---

## 📸 1. Project Overview & Philosophy

**photogal** is an ultra-fast, minimalist, self-hosted Progressive Web Application (PWA) designed for professional photography studios to share client galleries and manage the photo selection/proofing workflow.

### Core Philosophy:
- **Editorial Studio Aesthetics**: Monochromatic, elegant, photo-centric design. We use *Cormorant Garamond* for titles and *Inter* for clean metadata and UI elements.
- **Zero AI-Gimmicks**: No glowing gradients, neon borders, or tacky AI tropes. Keep surfaces clean, borders hairline (`var(--border-hairline)`), and spacing generous.
- **Pure Vanilla CSS**: Strictly NO TailwindCSS. All styles are defined in `src/app/globals.css` using structured CSS variables for Dark and Light modes.
- **Self-Contained & Cloud-Free**: Powered by embedded SQLite (`better-sqlite3`) in WAL mode and local disk storage with on-the-fly Sharp WebP generation.

---

## 🛠️ 2. Technology Stack

- **Framework**: Next.js 16 (App Router, Turbopack, standalone output)
- **Language**: TypeScript 5.x (Strict mode)
- **Styling**: Vanilla CSS (`src/app/globals.css`) with CSS custom properties
- **Database**: SQLite 3 with `better-sqlite3` (WAL journal mode, foreign keys enabled)
- **Image Processing**: `sharp` (High-performance multi-threaded WebP generation)
- **Authentication**:
  - Biometrics / FIDO2: `@simplewebauthn/server` & `@simplewebauthn/browser` (Touch ID, Face ID, YubiKey)
  - Passwords: Node.js native `crypto.scryptSync` with random 16-byte salt
  - Sessions: HMAC-SHA256 signed tokens stored in `HttpOnly`, `SameSite=Lax` cookies
- **Archive Generation**: `archiver` (Streaming ZIP compression without disk buffering)
- **Containerization**: Docker (Multi-stage Node.js 22 Alpine, GitHub Container Registry)

---

## 📁 3. Directory Layout & Key Modules

```text
photogal/
├── data/                               # Persistent SQLite database (photogal.db, WAL/SHM)
├── storage/                            # Physical media directory (ignored by git)
│   └── galleries/[id]/
│       ├── original/                   # Original JPG uploads (high-res source)
│       ├── thumb/                      # Fast grid thumbnails (WebP, max 600px width/height)
│       └── preview/                    # Lightbox previews (WebP, max 2200px width/height)
├── public/                             # Static files, PWA manifest, service worker
├── scripts/
│   └── seed-demo.js                    # Database schema bootstrap & demo gallery seed
├── src/
│   ├── app/
│   │   ├── admin/                      # Photographer Management Panel
│   │   │   ├── galleries/[id]/page.tsx # Gallery management, photo upload, export modal
│   │   │   ├── login/page.tsx          # Passkey & password login
│   │   │   └── page.tsx                # Dashboard: list, create modal, security modal
│   │   ├── api/
│   │   │   ├── admin/
│   │   │   │   ├── change-password/    # In-app admin password modification
│   │   │   │   ├── galleries/          # Gallery CRUD, upload, export, security status
│   │   │   │   ├── login/              # Admin password session management
│   │   │   │   └── passkey/            # WebAuthn options & verification
│   │   │   ├── client/
│   │   │   │   └── galleries/[slug]/   # PIN check, selections, finalize, ZIP download
│   │   │   └── media/[...path]/        # Authenticated/safe media stream serving
│   │   ├── g/[slug]/page.tsx           # Client view: PIN gate, Masonry grid, Lightbox, Dock
│   │   ├── globals.css                 # Single source of truth for design system & tokens
│   │   └── layout.tsx                  # Global HTML wrapper, PWA tags, Theme & Toast providers
│   ├── components/
│   │   ├── ThemeProvider.tsx           # Dark/Light theme toggle & persistent storage
│   │   └── ToastProvider.tsx           # Minimalist non-intrusive notification toasts
│   └── lib/
│       ├── auth.ts                     # Password verify, token sign/verify, session cookies
│       ├── db.ts                       # Database connection, pragmas, schema DDL
│       ├── image.ts                    # Sharp WebP pipeline & metadata extractor
│       ├── storage.ts                  # Filesystem path helpers & directory bootstrap
│       └── webauthn.ts                 # SimpleWebAuthn challenge generator & verifier
├── Dockerfile                          # Optimized production container
└── docker-compose.yml                  # Service orchestration
```

---

## 🔒 4. Security Principles & Hardening

1. **PIN Protection (Client Gate)**:
   - Always compare PIN codes using constant-time comparison (`crypto.timingSafeEqual`) to defeat CPU instruction timing attacks.
   - After 3 consecutive failed attempts from an IP, apply a **2.5s tarpit sleep** to slow down brute-force scripts.
   - After 5 failures from an IP, issue a 15-minute soft ban (`HTTP 429 Too Many Requests`).
   - After 10 total gallery failures, put the gallery into emergency lock (`pin_locked_until`), requiring photographer reset in Admin UI.
   - Anonymize IP addresses using salted SHA-256 before storing in `pin_attempts` for GDPR/RODO compliance.

2. **Admin Authentication**:
   - Primary: WebAuthn / FIDO2 Passkeys.
   - Fallback: Admin password salted with `crypto.randomBytes(16)` and hashed via `scryptSync(password, salt, 64)`.
   - Never expose raw database files or `.env` files in client builds.

3. **In-App Modals**:
   - **NEVER** use browser-native `window.confirm()` or `window.prompt()`. Always use custom, beautifully styled in-app confirmation modals with explicit cancel and confirm buttons to prevent browser auto-dismiss bugs.

4. **Defensive API Responses**:
   - When calling `fetch(...)` on the frontend, always read `res.text()` inside a `try-catch` before `JSON.parse` to avoid unhandled `"Unexpected end of JSON input"` exceptions when server returns 500 or non-JSON payloads.

---

## 🚀 5. Useful Commands

```bash
# Start local dev server (port 3000)
npm run dev

# Run production build and check TypeScript validity
npm run build

# Seed or reset demo wedding gallery
node scripts/seed-demo.js

# Build and start via Docker Compose
docker compose up -d --build
```

---

## 🤖 6. Guidelines for AI Agents

- **Maintain Branding**: All user-facing text, page titles, and metatags must use **photogal**.
- **CSS Modularity**: Keep all styles within `src/app/globals.css`. Ensure new elements have corresponding theme tokens for both Light and Dark mode.
- **Database Migrations**: When adding columns to SQLite tables, use `ALTER TABLE ... ADD COLUMN` inside `initDatabase()` wrapped in `try-catch` to avoid breaking existing databases.
- **Atomic Commits**: Always commit work in cohesive, logical units with descriptive conventional commit messages.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
