import type { SupabaseClient } from '@supabase/supabase-js';
import type { LocalProfile } from '../types';
import { db, onLocalChange, onRecordCreated, type SyncTable } from './database';
import { countPending, createSyncEngine } from './sync';
import { SupabaseRemote } from './syncRemote';

export interface SyncStatus { state: 'idle' | 'syncing' | 'offline' | 'error'; lastSyncAt: string | null; pending: number; error: string }

let status: SyncStatus = { state: 'idle', lastSyncAt: null, pending: 0, error: '' };
const listeners = new Set<() => void>();
const set = (patch: Partial<SyncStatus>) => { status = { ...status, ...patch }; listeners.forEach((fn) => fn()); };
export const getSyncStatus = () => status;
export const subscribeSync = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

let engine: ReturnType<typeof createSyncEngine> | null = null;
let cleanups: (() => void)[] = [];
let debounce: number | undefined;

async function run() {
  if (!engine) return;
  if (!navigator.onLine) { set({ state: 'offline', pending: await countPending(db) }); return; }
  set({ state: 'syncing' });
  try {
    const summary = await engine.syncNow();
    set({ state: summary.errors.length ? 'error' : 'idle', lastSyncAt: new Date().toISOString(), pending: await countPending(db), error: summary.errors[0] ?? '' });
  } catch (error) {
    set({ state: navigator.onLine ? 'error' : 'offline', error: error instanceof Error ? error.message : String(error), pending: await countPending(db) });
  }
}

export const syncNow = () => run();
export const pendingChanges = () => countPending(db);

let openedTracked = false;
const LAST_SEEN_KEY = 'pf-last-seen-ping';
/** Tells the server "this account was used" (at most every 10 minutes) so the admin can see who is active. */
async function touchLastSeen(client: SupabaseClient, userId: string) {
  if (!navigator.onLine) return;
  const last = Number(localStorage.getItem(LAST_SEEN_KEY) || 0);
  if (Date.now() - last < 10 * 60 * 1000) return;
  localStorage.setItem(LAST_SEEN_KEY, String(Date.now()));
  await client.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', userId);
}

/** Anonymous usage counters: only an event NAME ("booking.created"), never any content. One per type per flush. */
// Supabase builders only send the request once they are awaited / .then()-ed, so do it explicitly.
function trackEvent(client: SupabaseClient, name: string) { client.rpc('track_event', { p_name: name }).then(() => undefined, () => undefined); }

export function startSync(client: SupabaseClient, userId: string) {
  stopSync();
  const created = new Set<SyncTable>();
  const flush = () => { created.forEach((table) => trackEvent(client, `${table}.created`)); created.clear(); };
  const flushTimer = window.setInterval(flush, 20 * 1000);
  const stopCreated = onRecordCreated((table) => { if (table !== 'templates') created.add(table); });
  void touchLastSeen(client, userId);
  if (!openedTracked) { openedTracked = true; trackEvent(client, 'app.opened'); }
  engine = createSyncEngine({ db, remote: new SupabaseRemote(client), storage: localStorage, userId });
  const schedule = () => { window.clearTimeout(debounce); debounce = window.setTimeout(() => void run(), 2500); };
  const onVisible = () => { if (document.visibilityState === 'visible') { void run(); void touchLastSeen(client, userId); } };
  const timer = window.setInterval(() => void run(), 90 * 1000);
  window.addEventListener('online', run);
  document.addEventListener('visibilitychange', onVisible);
  cleanups = [stopCreated, () => window.clearInterval(flushTimer), flush, onLocalChange(schedule), () => window.removeEventListener('online', run), () => document.removeEventListener('visibilitychange', onVisible), () => window.clearInterval(timer)];
  void run();
}

export function stopSync() {
  cleanups.forEach((fn) => fn());
  cleanups = [];
  window.clearTimeout(debounce);
  engine = null;
  set({ state: 'idle', error: '' });
}

export async function pushProfile(client: SupabaseClient, userId: string, profile: LocalProfile) {
  if (!navigator.onLine) return;
  await client.from('profiles').update({ display_name: profile.name.slice(0, 80), studio_name: profile.studioName.slice(0, 80), phone: profile.phone.slice(0, 30), packages: profile.packages ?? [] }).eq('id', userId);
}
