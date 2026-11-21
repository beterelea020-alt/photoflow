import type { SupabaseClient } from '@supabase/supabase-js';
import { useSyncExternalStore } from 'react';

export interface BookingRequestRow {
  id: string; name: string; phone: string; type: string; package_name: string | null;
  requested_date: string; requested_time: string | null; notes: string | null; status: 'new' | 'accepted' | 'rejected'; created_at: string;
}

let rows: BookingRequestRow[] = [];
let client: SupabaseClient | null = null;
let timer: number | undefined;
let cleanups: (() => void)[] = [];
const listeners = new Set<() => void>();
const publish = (next: BookingRequestRow[]) => { rows = next; listeners.forEach((fn) => fn()); };

export async function refreshRequests() {
  if (!client || !navigator.onLine) return;
  const { data, error } = await client.from('booking_requests').select('id, name, phone, type, package_name, requested_date, requested_time, notes, status, created_at').eq('status', 'new').order('created_at', { ascending: false }).limit(50);
  if (!error && data) publish(data as BookingRequestRow[]);
}

export function startRequests(supabase: SupabaseClient) {
  stopRequests();
  client = supabase;
  const onVisible = () => { if (document.visibilityState === 'visible') void refreshRequests(); };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', refreshRequests);
  timer = window.setInterval(() => void refreshRequests(), 60 * 1000);
  cleanups = [() => document.removeEventListener('visibilitychange', onVisible), () => window.removeEventListener('online', refreshRequests), () => window.clearInterval(timer)];
  void refreshRequests();
}
export function stopRequests() { cleanups.forEach((fn) => fn()); cleanups = []; client = null; publish([]); }

export async function setRequestStatus(id: string, status: 'accepted' | 'rejected') {
  publish(rows.filter((r) => r.id !== id));
  if (client) await client.from('booking_requests').update({ status }).eq('id', id);
}

export const useBookingRequests = () => useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, () => rows);
