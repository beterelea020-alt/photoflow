import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { cloudConfigured } from '../lib/supabase';

/**
 * Separate login for the admin panel: kept in sessionStorage (ends when the tab closes) under its own key,
 * so it never mixes with a photographer's session on the same browser.
 */
export const adminSupabase: SupabaseClient | null = cloudConfigured
  ? createClient(import.meta.env.VITE_SUPABASE_URL as string, import.meta.env.VITE_SUPABASE_ANON_KEY as string, {
      auth: { persistSession: true, storage: window.sessionStorage, storageKey: 'photoflow-admin-auth', autoRefreshToken: true, detectSessionInUrl: false }
    })
  : null;

export class ForbiddenError extends Error {}

export async function adminCall<T>(name: string, params?: Record<string, unknown>): Promise<T> {
  if (!adminSupabase) throw new Error('not configured');
  const { data, error } = await adminSupabase.rpc(name, params ?? {});
  if (error) {
    if (error.code === '42501' || /forbidden/.test(error.message)) throw new ForbiddenError(error.message);
    throw new Error(error.message);
  }
  return data as T;
}

export interface Overview {
  accounts: { total: number; pending: number; trial: number; trial_expired: number; active: number; active_expired: number; suspended: number };
  signups_7d: number; signups_30d: number; active_users_7d: number; active_users_1d: number; booking_requests_7d: number;
  totals: { clients: number; bookings: number; transactions: number };
  events_7d: Record<string, number>;
}
export interface AccountRow {
  id: string; email: string; display_name: string; studio_name: string; phone: string; slug: string | null;
  status: 'pending' | 'trial' | 'active' | 'suspended'; trial_ends_at: string | null; paid_until: string | null; plan: string;
  booking_page_enabled: boolean; created_at: string; last_seen_at: string | null;
  clients_count: number; bookings_count: number; requests_count: number; admin_note: string | null;
}
export interface AuditRow { id: number; admin_id: string | null; action: string; target_user: string | null; details: Record<string, unknown>; created_at: string }
