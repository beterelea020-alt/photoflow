import type { ServicePackage } from '../types';
import { supabase } from './supabase';

export interface PublicPage { studio_name: string; display_name: string; phone: string; note: string; packages: ServicePackage[]; busy_dates: string[] }
export interface BookingStatusView {
  studio_name: string; studio_phone: string; client_name: string; title: string; type: string; date: string; time: string;
  duration_minutes: number; location: string | null; price: number; deposit: number; remaining: number;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled'; project_status: string | null;
  payments: { date: string; amount: number }[]; updated_at: string;
}
export type RequestError = 'rate_limited' | 'not_available' | 'invalid_request' | 'network';

export async function fetchPublicPage(slug: string): Promise<PublicPage | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('public_page', { p_slug: slug });
  if (error) throw new Error(error.message);
  return (data as PublicPage | null) ?? null;
}

export async function submitBookingRequest(args: { slug: string; name: string; phone: string; type: string; date: string; time: string; notes: string; packageName: string; hp: string }): Promise<{ ok: true } | { error: RequestError }> {
  if (!supabase) return { error: 'not_available' };
  try {
    const { error } = await supabase.rpc('submit_booking_request', { p_slug: args.slug, p_name: args.name, p_phone: args.phone, p_type: args.type, p_date: args.date, p_time: args.time || null, p_notes: args.notes || null, p_package: args.packageName || null, p_hp: args.hp });
    if (!error) return { ok: true };
    if (/rate_limited/.test(error.message)) return { error: 'rate_limited' };
    if (/not_available/.test(error.message)) return { error: 'not_available' };
    if (/failed to fetch|network/i.test(error.message)) return { error: 'network' };
    return { error: 'invalid_request' };
  } catch { return { error: 'network' }; }
}

export async function fetchBookingStatus(token: string): Promise<BookingStatusView | null> {
  if (!supabase || !/^[0-9a-f-]{36}$/i.test(token)) return null;
  const { data, error } = await supabase.rpc('booking_status', { p_token: token });
  if (error) throw new Error(error.message);
  return (data as BookingStatusView | null) ?? null;
}
