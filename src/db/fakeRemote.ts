import type { SyncTable } from './database';
import type { RemoteApi, RemoteRow } from './sync';

/** In-memory stand-in for the server, used only by tests. Mimics: server-side updated_at, soft delete, FK checks, public_token. */
export class FakeRemote implements RemoteApi {
  tables: Record<SyncTable, Map<string, RemoteRow>> = { clients: new Map(), bookings: new Map(), projects: new Map(), transactions: new Map(), reminders: new Map(), templates: new Map() };
  clock = Date.parse('2026-01-01T00:00:00.000Z');
  offline = false;
  reject: (table: SyncTable, row: Record<string, unknown>) => string | null = () => null;
  upsertCalls = 0;
  private tick() { this.clock += 5; return new Date(this.clock).toISOString(); }

  async fetchChanged(table: SyncTable, since: string, limit: number) {
    if (this.offline) throw new Error('Failed to fetch');
    return [...this.tables[table].values()].filter((r) => r.updated_at >= since).sort((a, b) => a.updated_at.localeCompare(b.updated_at)).slice(0, limit).map((r) => ({ ...r }));
  }
  async upsert(table: SyncTable, rows: Record<string, unknown>[]) {
    if (this.offline) throw new Error('Failed to fetch');
    this.upsertCalls += 1;
    const stamp = this.tick();
    for (const row of rows) {
      const bad = this.reject(table, row);
      if (bad) throw new Error(bad);
      if (table === 'bookings' && !this.tables.clients.has(String(row.client_id))) throw new Error('foreign key: client');
      if (table === 'projects' && !this.tables.bookings.has(String(row.booking_id))) throw new Error('foreign key: booking');
    }
    for (const row of rows) {
      const id = String(row.id);
      const existing = this.tables[table].get(id);
      const merged: RemoteRow = { ...(existing ?? { public_token: table === 'bookings' ? `tok-${id}` : undefined }), ...row, id, updated_at: stamp, deleted_at: (row.deleted_at as string | null | undefined) ?? null };
      this.tables[table].set(id, merged);
    }
  }
  async softDelete(table: SyncTable, ids: string[]) {
    if (this.offline) throw new Error('Failed to fetch');
    const stamp = this.tick();
    for (const id of ids) { const row = this.tables[table].get(id); if (row) this.tables[table].set(id, { ...row, deleted_at: stamp, updated_at: stamp }); }
  }
  live(table: SyncTable) { return [...this.tables[table].values()].filter((r) => !r.deleted_at); }
}
