import type { SupabaseClient } from '@supabase/supabase-js';
import type { SyncTable } from './database';
import type { RemoteApi, RemoteRow } from './sync';

export class SupabaseRemote implements RemoteApi {
  constructor(private client: SupabaseClient) {}

  async fetchChanged(table: SyncTable, since: string, limit: number): Promise<RemoteRow[]> {
    const { data, error } = await this.client.from(table).select('*').gte('updated_at', since).order('updated_at', { ascending: true }).limit(limit);
    if (error) throw new Error(error.message);
    return (data ?? []) as RemoteRow[];
  }

  async upsert(table: SyncTable, rows: Record<string, unknown>[]): Promise<void> {
    const { error } = await this.client.from(table).upsert(rows, { onConflict: 'id' });
    if (error) throw new Error(error.message);
  }

  async softDelete(table: SyncTable, ids: string[]): Promise<void> {
    for (let i = 0; i < ids.length; i += 100) {
      const { error } = await this.client.from(table).update({ deleted_at: new Date().toISOString() }).in('id', ids.slice(i, i + 100));
      if (error) throw new Error(error.message);
    }
  }
}
