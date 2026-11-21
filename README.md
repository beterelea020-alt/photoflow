# PhotoFlow Pilot

Arabic, mobile-first photographer workspace built with React, TypeScript, Vite, Dexie, and PWA support. Each pilot installation starts with empty data.

## Local development

Requires Node.js 20.19+.

```bash
npm install
npm run dev
npm run build
```

Vercel settings: Vite, `npm run build`, output folder `dist`.

## Core capabilities

- Clients, booking calendar, projects, follow-ups, finance, reports, and message templates.
- Local IndexedDB storage and JSON export / validated restore.
- Per-device signed activation tokens and four-digit app PIN.
- Five-minute idle lock, manual lock, and temporary delay after repeated wrong PIN entries.
- Light / dark appearance, installable mobile web app, offline app shell, and update checks.

## Activation architecture

The deployed app contains only an ECDSA P-256 public verification key. The matching private key is in a separate, developer-only license issuer package and must never be added to this repository or deployed to Vercel. Tokens include the installation ID, expiry, and customer label, and are signed offline by the issuer.

This offline design raises the bar against forged activation codes and binds issued codes to a browser installation. It cannot make client-side JavaScript tamper-proof, remotely revoke a license, or provide a hardware-backed device identity. Expiration relies on the local device clock. A determined person with local control can modify client code, roll back the clock, or copy browser storage.

## Data and privacy

Business records stay in the browser's local IndexedDB. A `.photoflow.json` backup contains all current business tables, profile settings, theme, export timestamp, and a SHA-256 integrity checksum. Restore replaces the current business data after confirmation. The file is not encrypted; store it securely. Activation and PIN are deliberately not included in backups because each new device must be activated and assigned its own PIN.

The four-digit PIN is stored as a PBKDF2-derived hash, not as plain digits. It gates the UI but does not encrypt the IndexedDB records. Do not describe this as full database encryption.

## Messaging limitations

Incoming WhatsApp and Instagram messages are recorded manually in this pilot. Prepared WhatsApp messages open the native WhatsApp conversation with draft text. Automatic inbound messages or in-app replies require official provider integration and a trusted webhook service in a later release.

## Font

Noto Sans Arabic is loaded from Google Fonts and cached after first successful fetch; the browser falls back to system Arabic fonts if unavailable.
