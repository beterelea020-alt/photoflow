import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** Cloud accounts are used only when both values are set at build time. Without them the app keeps working in the old local/license mode. */
export const cloudConfigured = Boolean(url && key && /^https?:\/\//.test(url));
export const AUTH_STORAGE_KEY = 'photoflow-auth';

export const supabase: SupabaseClient | null = cloudConfigured
  ? createClient(url as string, key as string, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: AUTH_STORAGE_KEY } })
  : null;

/** The signed-in user as saved on this phone; works offline when the network call to refresh the session fails. */
export function readStoredUser(): { id: string; email: string } | null {
  try {
    const raw = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || 'null');
    const user = raw?.user ?? raw?.currentSession?.user;
    return user?.id ? { id: String(user.id), email: String(user.email ?? '') } : null;
  } catch { return null; }
}
