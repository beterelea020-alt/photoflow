# Changelog

## 0.10.2
- `.gitignore` now excludes `.env*` files (except `.env.example`) and build folders, so server settings and the admin path are never committed by accident.

## 0.10.1
- Without a server address the app now shows a clear "server setup needed" screen instead of the old activation-code screen. The code mode only works if `VITE_ALLOW_LICENSE_MODE=true` is set explicitly.

## 0.10.0 — Terms, privacy, account deletion, real usage numbers
- **Terms of use** (`/terms`) and **Privacy policy** (`/privacy`), written from what the system actually does (what is collected, who sees it, what the admin can and cannot see, no photo storage, no ads, no selling). Fill `VITE_LEGAL_ENTITY`, `VITE_LEGAL_CONTACT`, `VITE_DATA_REGION` and the bracketed [placeholders]; until then a visible draft warning is shown. Must be reviewed by a lawyer before launch.
- Sign-up, the public booking page and Settings link to them; the booking page tells the visitor who receives their details.
- **Delete my account** (Settings): permanently removes the account and all its data from the server and the phone, after typing a confirmation word. (Database function `delete_my_account`, migration 0002.)
- **Admin numbers are now real**: the app reports "last seen" (at most every 10 minutes) and anonymous usage counters (event names only, such as `clients.created`; never any content). Fixed a bug where these requests were built but never sent.

## 0.9.0 — Admin panel, booking page, client link (Steps 3 and 4)
- **Admin panel** at a secret path (`VITE_ADMIN_PATH`): separate sign-in, mandatory 2-factor (TOTP) before anything loads, 15-minute idle sign-out, overview numbers, searchable accounts list, approve / suspend / unsuspend, extend trial, activate subscription (+1 month / 3 months / 1 year), private notes, audit log, and default-signup mode (free trial vs approval required). A signed-in non-admin never learns that an admin area exists.
- **Public booking page** at `/b/<name>`: studio name, welcome note, packages, busy-date warning, request form with a hidden anti-bot field and clear Arabic errors; confirmation offers WhatsApp to the studio.
- **Booking requests inbox**: new requests appear in Messages, in the Today list and in the on-open alert. "Accept" creates (or finds, by phone) the client and opens the booking form already filled from the request; accepting marks the request done.
- **Client tracking link** `/s/<token>`: the client sees date, place, price, paid, remaining, payments and a progress bar (shooting → editing → review → ready → delivered). Sent from the booking details by WhatsApp. Marked noindex.
- **Booking page settings** (link name with live availability check, welcome note, share/copy/open).
- Hosting rewrites added for deep links (`vercel.json`, `public/_redirects`).
- Fixed: a request time with seconds could break reminder creation; times are now normalised to HH:MM.

## 0.8.0 — Accounts and sync (Step 2)
- Cloud mode: when `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set at build time, the app uses real accounts: email + strong password (10+ characters, upper/lower/digit/symbol, checked live), password reset by email, and the device PIN stays as a local lock.
- Without those variables the app behaves exactly as before (license code mode).
- Account status from the server: pending / suspended / trial ended / subscription ended each show a clear screen. Suspension and expiry take effect while the app is open.
- Automatic two-way sync (offline-first): every change is saved on the phone first, then uploaded in the background; changes from other devices are downloaded. Works across several phones; edits not yet uploaded are never overwritten; deletes and "clear all" travel to the server.
- Old work already on a phone is offered for transfer to the new account on first login.
- Signing out uploads pending changes, then wipes the phone; "forgot PIN" is only possible through the account password.
- Profile (name, studio, phone, packages) is saved to the account.
- Default message templates are added once per account after the first sync (no duplicates across devices).
- Manual backup reminders are off in cloud mode; backup files still work.
- 27 automated tests for sync, change tracking, old-data migration, password policy and account rules (`npm test`).

## 0.7.0 — Alert on every open
- A "محتاج منك خطوة" sheet appears inside the app every time it is opened (right after unlock) when something needs attention: due follow-ups, today/tomorrow shoots, unconfirmed bookings and deposits, balances to collect, photos ready to send, and the weekly backup. Each item has a one-tap action; handled items disappear from the sheet.
- It appears again when you come back to the app after being away for more than 15 minutes.
- Due follow-ups can be ticked off straight from the alert or the Today card (previously only a toast after 30 seconds).
- The Today card no longer counts follow-ups scheduled for future days.
- When you leave the app, an unread-count badge is set on the installed app icon where the phone supports it (Android Chrome; limited on iPhone).
- All bottom sheets now use the full phone width.

## 0.6.0 — Complete pre-backend version
- Price packages ("باقاتي وأسعاري") in Settings; choosing a package in a new booking fills title, type, price and duration. Packages are saved in backups.
- Client-facing account statement as an image from any booking (shows agreed price, payments, remaining; internal expenses are never included), shared through the phone share sheet or downloaded.
- Month summary as an image, besides the text summary.
- Export payments and bookings to CSV (Excel/Google Sheets, Arabic safe, formula-injection safe) for an accountant.
- Client cards show the outstanding balance next to work value.
- First-run card asks for photographer and studio name.
- Arabic font is bundled with the app (works offline on first load); Google Fonts removed.

## 0.5.0 — Phases 2 and 3
- "النهارده" (Today) card on the home screen: tomorrow's shoots, unconfirmed bookings, deposits to request, balances to collect and photos ready to send, each with a one-tap WhatsApp message.
- Quick client entry: paste "name + number", pick from contacts (Android Chrome), duplicate-number warning, Egyptian-number hint, and "save and book" in one step.
- Ready-made Egyptian-Arabic message pack (8 templates) added on first run; the app always prefers the photographer's own edited version. Missing templates can be restored from the Templates screen.
- Booking details now show every payment and expense, net profit per booking, quick "add payment" (pre-filled with the remaining balance) and "add expense", and WhatsApp buttons for confirmation, balance request and photo delivery.
- Finance by month (switch months), month summary shareable to WhatsApp, per-booking profit list, and one-tap balance requests.
- Backup can be shared through the phone's share sheet (WhatsApp, Drive, Files) when the phone supports it.
- Agenda view works; the arrow icon is used for "go to" buttons instead of "+".
- Fixed layout shifting on very small phones (320px).

## 0.4.0 — Phase 1: mobile foundation and fixes
- Mobile-only layout at every width (single phone-width column, bottom navigation, sidebar removed).
- Text sizes raised (nothing below 12px), 16px inputs (no iOS zoom), 44px touch targets, safe-area and `dvh` support.
- Forms and details open as bottom sheets; tables became cards; project pipeline is vertical; "More" menu opens above the bottom bar.
- Edit and delete for clients, bookings, payments/expenses and reminders; project details (photo count, delivery link).
- Accounting: completed bookings keep counting as outstanding until fully paid; paid amount is always the sum of linked payments; payments on a booking with no price are no longer lost.
- WhatsApp templates fill from the real booking (date, time, place, price, paid, remaining, link); sending is blocked while data is missing; phone numbers such as 0020…, +20…, 01… are normalised.
- Persistent storage requested so the browser is much less likely to clear data.
- New license signing key (the previous private key was shared outside the developer machine).
- Fixed TypeScript build errors in `security.ts`.
