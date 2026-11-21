import type { Table } from 'dexie';
import { markRemote, SYNC_TABLES, type PhotoFlowDatabase, type SyncTable } from './database';

export interface RemoteRow { id: string; updated_at: string; deleted_at: string | null; [key: string]: unknown }

/** What the sync engine needs from a server. The Supabase version is in syncRemote.ts; tests use an in-memory one. */
export interface RemoteApi {
  fetchChanged(table: SyncTable, since: string, limit: number): Promise<RemoteRow[]>;
  upsert(table: SyncTable, rows: Record<string, unknown>[]): Promise<void>;
  softDelete(table: SyncTable, ids: string[]): Promise<void>;
}
export interface SyncStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export interface SyncSummary { pushed: number; deleted: number; pulled: number; removed: number; skipped: number; errors: string[] }

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
interface Ctx { uuidOf(table: SyncTable, localId: number | undefined): Promise<string | undefined>; localIdOf(table: SyncTable, uuid: unknown): Promise<number | undefined> }
interface Mapper {
  toRemote(row: Row, ctx: Ctx): Promise<Record<string, unknown> | null>;
  toLocal(remote: RemoteRow, ctx: Ctx): Promise<Row | null>;
}

const cut = (value: unknown, max: number) => (value === undefined || value === null || value === '' ? null : String(value).slice(0, max));
const req = (value: unknown, max: number, fallback = '') => String(value ?? fallback).slice(0, max);
const iso = (value: unknown): string | undefined => { if (!value) return undefined; const d = new Date(String(value)); return Number.isNaN(d.getTime()) ? undefined : d.toISOString(); };
const num = (value: unknown, fallback = 0) => { const n = Number(value); return Number.isFinite(n) ? n : fallback; };
const opt = <T>(value: T | null | undefined): T | undefined => (value === null ? undefined : value);
const compact = (obj: Row): Row => { for (const key of Object.keys(obj)) if (obj[key] === undefined) delete obj[key]; return obj; };

const mappers: Record<SyncTable, Mapper> = {
  clients: {
    async toRemote(r) {
      return compact({ id: r.uuid, name: req(r.name, 120, '—'), phone: req(r.phone, 30), instagram: cut(r.instagram, 60), email: cut(r.email, 160), source: r.source ?? 'manual', notes: cut(r.notes, 4000), last_contact_at: iso(r.lastContactAt) ?? null, lead_status: r.leadStatus ?? null, created_at: iso(r.createdAt), deleted_at: null });
    },
    async toLocal(x) {
      return compact({ uuid: x.id, name: x.name, phone: x.phone ?? '', instagram: opt(x.instagram), email: opt(x.email), source: x.source, notes: opt(x.notes), createdAt: iso(x.created_at) ?? new Date().toISOString(), lastContactAt: iso(x.last_contact_at), leadStatus: opt(x.lead_status) });
    }
  },
  bookings: {
    async toRemote(r, ctx) {
      const clientId = await ctx.uuidOf('clients', r.clientId);
      if (!clientId) return null;
      return compact({ id: r.uuid, client_id: clientId, title: req(r.title, 160, 'جلسة'), type: req(r.type, 60), date: r.date, time: r.time, duration_minutes: Math.min(1440, Math.max(1, Math.round(num(r.durationMinutes, 60)))), location: cut(r.location, 200), price: Math.max(0, num(r.price)), deposit: Math.max(0, num(r.deposit)), status: r.status, notes: cut(r.notes, 4000), share_enabled: r.shareEnabled ?? true, created_at: iso(r.createdAt), deleted_at: null });
    },
    async toLocal(x, ctx) {
      const clientId = await ctx.localIdOf('clients', x.client_id);
      if (clientId === undefined) return null;
      return compact({ uuid: x.id, clientId, title: x.title, type: x.type ?? '', date: x.date, time: x.time, durationMinutes: num(x.duration_minutes, 60), location: opt(x.location), price: num(x.price), deposit: num(x.deposit), status: x.status, notes: opt(x.notes), createdAt: iso(x.created_at) ?? new Date().toISOString(), publicToken: opt(x.public_token), shareEnabled: x.share_enabled ?? true });
    }
  },
  projects: {
    async toRemote(r, ctx) {
      const bookingId = await ctx.uuidOf('bookings', r.bookingId);
      if (!bookingId) return null;
      const link = cut(r.deliveryLink, 500);
      return compact({ id: r.uuid, booking_id: bookingId, status: r.status, shot_count: r.shotCount === undefined || r.shotCount === null ? null : Math.max(0, Math.round(num(r.shotCount))), delivery_link: link && /^https?:\/\//i.test(link) ? link : null, notes: cut(r.notes, 4000), deleted_at: null });
    },
    async toLocal(x, ctx) {
      const bookingId = await ctx.localIdOf('bookings', x.booking_id);
      if (bookingId === undefined) return null;
      return compact({ uuid: x.id, bookingId, status: x.status, shotCount: opt(x.shot_count), deliveryLink: opt(x.delivery_link), notes: opt(x.notes), updatedAt: iso(x.updated_at) ?? new Date().toISOString() });
    }
  },
  transactions: {
    async toRemote(r, ctx) {
      const amount = num(r.amount);
      if (amount <= 0) return null;
      return compact({ id: r.uuid, type: r.type, title: req(r.title, 160, '—'), amount, date: r.date, client_id: (await ctx.uuidOf('clients', r.clientId)) ?? null, booking_id: (await ctx.uuidOf('bookings', r.bookingId)) ?? null, category: req(r.category, 60), notes: cut(r.notes, 4000), deleted_at: null });
    },
    async toLocal(x, ctx) {
      return compact({ uuid: x.id, type: x.type, title: x.title, amount: num(x.amount), date: x.date, clientId: await ctx.localIdOf('clients', x.client_id), bookingId: await ctx.localIdOf('bookings', x.booking_id), category: x.category ?? '', notes: opt(x.notes) });
    }
  },
  reminders: {
    async toRemote(r, ctx) {
      const dueAt = iso(r.dueAt);
      if (!dueAt) return null;
      return compact({ id: r.uuid, title: req(r.title, 160, '—'), body: cut(r.body, 2000), due_at: dueAt, client_id: (await ctx.uuidOf('clients', r.clientId)) ?? null, booking_id: (await ctx.uuidOf('bookings', r.bookingId)) ?? null, done: Boolean(r.done), notified_at: iso(r.notifiedAt) ?? null, deleted_at: null });
    },
    async toLocal(x, ctx) {
      return compact({ uuid: x.id, title: x.title, body: opt(x.body), dueAt: iso(x.due_at) ?? new Date().toISOString(), clientId: await ctx.localIdOf('clients', x.client_id), bookingId: await ctx.localIdOf('bookings', x.booking_id), done: Boolean(x.done), notifiedAt: iso(x.notified_at) });
    }
  },
  templates: {
    async toRemote(r) {
      return compact({ id: r.uuid, title: req(r.title, 120, '—'), channel: r.channel ?? 'both', body: req(r.body, 4000), deleted_at: null });
    },
    async toLocal(x) {
      return compact({ uuid: x.id, title: x.title, channel: x.channel, body: x.body });
    }
  }
};

const EPOCH = '1970-01-01T00:00:00.000Z';
const PUSH_CHUNK = 100;
const PULL_PAGE = 500;

/** Changes made on this phone that the server does not have yet. */
export async function countPending(db: PhotoFlowDatabase): Promise<number> {
  let total = await db.tombstones.count();
  for (const name of SYNC_TABLES) total += await db.table(name).where('dirty').equals(1).count();
  return total;
}

export function createSyncEngine(opts: { db: PhotoFlowDatabase; remote: RemoteApi; storage: SyncStorage; userId: string }) {
  const { db, remote, storage, userId } = opts;
  const cursorKey = (table: SyncTable) => `pf-sync:${userId}:${table}`;
  let running: Promise<SyncSummary> | null = null;
  let rerun = false;

  const ctx: Ctx = {
    async uuidOf(table, localId) {
      if (localId === undefined || localId === null) return undefined;
      const row = await db.table(table).get(localId);
      return row?.uuid as string | undefined;
    },
    async localIdOf(table, uuid) {
      if (!uuid) return undefined;
      const row = await db.table(table).where('uuid').equals(String(uuid)).first();
      return row?.id as number | undefined;
    }
  };

  async function markClean(table: Table<Row, number>, pushed: { id: number; modifiedAt?: string }[]) {
    if (!pushed.length) return;
    await db.transaction('rw', table, async (tx) => {
      markRemote(tx);
      for (const item of pushed) {
        const current = await table.get(item.id);
        if (current && current.modifiedAt === item.modifiedAt) await table.update(item.id, { dirty: 0 });
      }
    });
  }

  async function pushTable(name: SyncTable, summary: SyncSummary) {
    const table = db.table(name) as Table<Row, number>;
    const dirty = await table.where('dirty').equals(1).toArray();
    const items: { id: number; modifiedAt?: string; payload: Record<string, unknown> }[] = [];
    for (const row of dirty) {
      const payload = await mappers[name].toRemote(row, ctx);
      if (payload) items.push({ id: row.id, modifiedAt: row.modifiedAt, payload });
      else summary.skipped += 1;
    }
    for (let i = 0; i < items.length; i += PUSH_CHUNK) {
      const chunk = items.slice(i, i + PUSH_CHUNK);
      try {
        await remote.upsert(name, chunk.map((c) => c.payload));
        await markClean(table, chunk);
        summary.pushed += chunk.length;
      } catch (batchError) {
        // One bad row must not block everything else: retry one by one and keep only the bad ones dirty.
        for (const item of chunk) {
          try { await remote.upsert(name, [item.payload]); await markClean(table, [item]); summary.pushed += 1; }
          catch (error) { summary.errors.push(`${name}#${item.id}: ${error instanceof Error ? error.message : String(error ?? batchError)}`); }
        }
      }
    }
  }

  async function pushDeletes(summary: SyncSummary) {
    const stones = await db.tombstones.toArray();
    for (const name of SYNC_TABLES) {
      const group = stones.filter((s) => s.table === name);
      if (!group.length) continue;
      try {
        await remote.softDelete(name, group.map((s) => s.uuid));
        await db.tombstones.bulkDelete(group.map((s) => s.id as number));
        summary.deleted += group.length;
      } catch (error) { summary.errors.push(`delete ${name}: ${error instanceof Error ? error.message : String(error)}`); }
    }
  }

  async function pullTable(name: SyncTable, summary: SyncSummary) {
    const table = db.table(name) as Table<Row, number>;
    let cursor = storage.getItem(cursorKey(name)) ?? EPOCH;
    for (let page = 0; page < 200; page += 1) {
      const rows = await remote.fetchChanged(name, cursor, PULL_PAGE);
      if (!rows.length) break;
      await db.transaction('rw', SYNC_TABLES.map((t) => db.table(t)), async (tx) => {
        markRemote(tx);
        for (const row of rows) {
          const local = await table.where('uuid').equals(row.id).first();
          if (row.deleted_at) {
            if (local && local.dirty !== 1) { await table.delete(local.id); summary.removed += 1; }
            continue;
          }
          if (local && local.dirty === 1) continue; // an edit made on this phone and not uploaded yet wins
          if (local && local.modifiedAt === row.updated_at) continue; // already applied (pages overlap on purpose)
          const mapped = await mappers[name].toLocal(row, ctx);
          if (!mapped) { summary.skipped += 1; continue; }
          const next = { ...mapped, uuid: row.id, modifiedAt: row.updated_at, dirty: 0 };
          if (local) await table.update(local.id, next); else await table.add(next);
          summary.pulled += 1;
        }
      });
      const newest = rows.reduce((max, r) => (r.updated_at > max ? r.updated_at : max), cursor);
      if (rows.length < PULL_PAGE) { cursor = newest; storage.setItem(cursorKey(name), cursor); break; }
      if (newest === cursor) break; // nothing new in this page: avoid looping forever
      cursor = newest;
      storage.setItem(cursorKey(name), cursor);
    }
  }

  async function runOnce(): Promise<SyncSummary> {
    const summary: SyncSummary = { pushed: 0, deleted: 0, pulled: 0, removed: 0, skipped: 0, errors: [] };
    await pushDeletes(summary);
    for (const name of SYNC_TABLES) await pushTable(name, summary);
    for (const name of SYNC_TABLES) await pullTable(name, summary);
    return summary;
  }

  async function syncNow(): Promise<SyncSummary> {
    if (running) { rerun = true; return running; }
    const merged: SyncSummary = { pushed: 0, deleted: 0, pulled: 0, removed: 0, skipped: 0, errors: [] };
    running = (async () => {
      try {
        do {
          rerun = false;
          const part = await runOnce();
          merged.pushed += part.pushed; merged.deleted += part.deleted; merged.pulled += part.pulled; merged.removed += part.removed; merged.skipped += part.skipped; merged.errors.push(...part.errors);
        } while (rerun);
        return merged;
      } finally { running = null; }
    })();
    return running;
  }

  const pendingCount = () => countPending(db);

  return { syncNow, pendingCount, resetCursors: () => SYNC_TABLES.forEach((t) => storage.setItem(cursorKey(t), EPOCH)) };
}
