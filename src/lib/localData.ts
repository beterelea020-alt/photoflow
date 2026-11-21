import { clearAllData } from '../db/actions';
import { db } from '../db/database';
import { PIN_RECORD_KEY } from './security';

export const OWNER_KEY = 'pf-owner-id';

/** True when this phone holds work that belongs to nobody yet (the old local-only version). */
export async function hasLocalWork(): Promise<boolean> {
  const counts = await Promise.all([db.clients.count(), db.bookings.count(), db.transactions.count(), db.reminders.count()]);
  return counts.some((n) => n > 0);
}

export async function resetLocalData() {
  await clearAllData(false);
  await db.tombstones.clear();
  Object.keys(localStorage).filter((k) => k.startsWith('pf-sync:')).forEach((k) => localStorage.removeItem(k));
}

export function clearPinData() {
  localStorage.removeItem(PIN_RECORD_KEY);
  localStorage.removeItem('photoflow-pin-failures');
  localStorage.removeItem('photoflow-pin-locked-until');
}
