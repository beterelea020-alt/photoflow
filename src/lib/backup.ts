import { recordTombstonesForAll } from '../db/actions';
import type { AppBackup, LocalProfile } from '../types';
import { db } from '../db/database';

export interface BackupPayload {
  app: 'PhotoFlow';
  schemaVersion: 2;
  exportedAt: string;
  profile: LocalProfile;
  theme: 'light' | 'dark';
  clients: Awaited<ReturnType<typeof db.clients.toArray>>;
  bookings: Awaited<ReturnType<typeof db.bookings.toArray>>;
  projects: Awaited<ReturnType<typeof db.projects.toArray>>;
  transactions: Awaited<ReturnType<typeof db.transactions.toArray>>;
  reminders: Awaited<ReturnType<typeof db.reminders.toArray>>;
  templates: Awaited<ReturnType<typeof db.templates.toArray>>;
}

export interface VerifiedBackup extends BackupPayload {
  checksum: string;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function createBackup(profile: LocalProfile, theme: 'light' | 'dark'): Promise<VerifiedBackup> {
  const payload: BackupPayload = {
    app: 'PhotoFlow',
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    profile,
    theme,
    clients: await db.clients.toArray(),
    bookings: await db.bookings.toArray(),
    projects: await db.projects.toArray(),
    transactions: await db.transactions.toArray(),
    reminders: await db.reminders.toArray(),
    templates: await db.templates.toArray()
  };
  return { ...payload, checksum: await sha256Hex(JSON.stringify(payload)) };
}

function isArrayField(value: unknown): value is unknown[] { return Array.isArray(value); }

export async function parseBackupFile(file: File): Promise<{ backup: AppBackup; theme?: 'light' | 'dark'; exportedAt?: string; legacy: boolean }> {
  const parsed = JSON.parse(await file.text()) as Record<string, unknown>;
  if (!parsed || typeof parsed !== 'object') throw new Error('ملف غير صالح.');
  const arrays = ['clients', 'bookings', 'projects', 'transactions', 'reminders', 'templates'];
  if (!arrays.every((field) => isArrayField(parsed[field]))) throw new Error('الملف لا يحتوي على كل أقسام بيانات PhotoFlow.');
  if (!parsed.profile || typeof parsed.profile !== 'object' || Array.isArray(parsed.profile)) throw new Error('بيانات المصور غير موجودة في الملف.');

  if (parsed.schemaVersion === 2) {
    if (parsed.app !== 'PhotoFlow' || typeof parsed.checksum !== 'string') throw new Error('هذا الملف ليس نسخة PhotoFlow صحيحة.');
    const { checksum, ...payload } = parsed;
    const actual = await sha256Hex(JSON.stringify(payload));
    if (actual !== checksum) throw new Error('الملف تغيّر أو تلف بعد إنشائه. نزّل نسخة جديدة وحاول مرة أخرى.');
    return { backup: parsed as unknown as AppBackup, theme: parsed.theme === 'dark' ? 'dark' : 'light', exportedAt: String(parsed.exportedAt || ''), legacy: false };
  }

  // Accept version 1 files created by the previous pilot release.
  if (parsed.schemaVersion === 1) {
    if (!Array.isArray(parsed.clients) || !Array.isArray(parsed.bookings)) throw new Error('نسخة قديمة غير مكتملة.');
    return { backup: parsed as unknown as AppBackup, legacy: true, exportedAt: String(parsed.exportedAt || '') };
  }
  throw new Error('إصدار ملف النسخة الاحتياطية غير مدعوم.');
}

export async function restoreBackup(backup: AppBackup): Promise<void> {
  await recordTombstonesForAll();
  await db.transaction('rw', [db.clients, db.bookings, db.projects, db.transactions, db.reminders, db.templates], async () => {
    await Promise.all([db.clients.clear(), db.bookings.clear(), db.projects.clear(), db.transactions.clear(), db.reminders.clear(), db.templates.clear()]);
    await Promise.all([
      backup.clients.length ? db.clients.bulkAdd(backup.clients) : Promise.resolve(),
      backup.bookings.length ? db.bookings.bulkAdd(backup.bookings) : Promise.resolve(),
      backup.projects?.length ? db.projects.bulkAdd(backup.projects) : Promise.resolve(),
      backup.transactions?.length ? db.transactions.bulkAdd(backup.transactions) : Promise.resolve(),
      backup.reminders?.length ? db.reminders.bulkAdd(backup.reminders) : Promise.resolve(),
      backup.templates?.length ? db.templates.bulkAdd(backup.templates) : Promise.resolve()
    ]);
  });
}
