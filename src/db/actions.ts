import { db as appDb, markRemote, notifyLocalChange, SYNC_TABLES, type PhotoFlowDatabase } from './database';

const db = appDb;
import type { Transaction } from '../types';

async function removeBookingRecords(id: number) {
  await db.projects.where('bookingId').equals(id).delete();
  await db.reminders.where('bookingId').equals(id).delete();
  // Money already recorded is kept; it is only detached from the deleted booking.
  await db.transactions.where('bookingId').equals(id).modify({ bookingId: undefined });
  await db.bookings.delete(id);
}

export async function deleteBooking(id: number) {
  await db.transaction('rw', [db.bookings, db.projects, db.reminders, db.transactions], async () => { await removeBookingRecords(id); });
}

export async function deleteClient(id: number) {
  await db.transaction('rw', [db.clients, db.bookings, db.projects, db.reminders, db.transactions], async () => {
    const bookingIds = (await db.bookings.where('clientId').equals(id).primaryKeys()) as number[];
    for (const bookingId of bookingIds) await removeBookingRecords(bookingId);
    await db.reminders.where('clientId').equals(id).delete();
    await db.transactions.where('clientId').equals(id).modify({ clientId: undefined });
    await db.clients.delete(id);
  });
}

/** A booking's paid amount is always the sum of its linked income records. */
async function recomputeDeposit(bookingId: number) {
  const list = await db.transactions.where('bookingId').equals(bookingId).toArray();
  const paid = list.filter((t) => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
  await db.bookings.update(bookingId, { deposit: paid });
}

export async function saveTransaction(values: Omit<Transaction, 'id'>, editId?: number) {
  await db.transaction('rw', [db.transactions, db.bookings], async () => {
    const previous = editId ? await db.transactions.get(editId) : undefined;
    if (editId) await db.transactions.update(editId, values); else await db.transactions.add(values);
    const affected = new Set<number>();
    if (previous?.bookingId) affected.add(previous.bookingId);
    if (values.bookingId) affected.add(values.bookingId);
    for (const bookingId of affected) await recomputeDeposit(bookingId);
  });
}

export async function deleteTransaction(id: number) {
  await db.transaction('rw', [db.transactions, db.bookings], async () => {
    const previous = await db.transactions.get(id);
    await db.transactions.delete(id);
    if (previous?.bookingId) await recomputeDeposit(previous.bookingId);
  });
}

/** Remember every existing row as deleted so the next sync removes them from the server too. */
export async function recordTombstonesForAll(database: PhotoFlowDatabase = appDb) {
  for (const name of SYNC_TABLES) {
    const rows = await database.table(name).toArray();
    const stones = rows.filter((r) => r.uuid).map((r) => ({ table: name, uuid: r.uuid as string }));
    if (stones.length) await database.tombstones.bulkAdd(stones);
  }
}

/** Empties the phone. With track=true the deletions are also sent to the server on the next sync. */
export async function clearAllData(track = true, database: PhotoFlowDatabase = appDb) {
  if (track) await recordTombstonesForAll(database);
  await database.transaction('rw', [database.clients, database.bookings, database.projects, database.transactions, database.reminders, database.templates], async (tx) => {
    markRemote(tx); // deletions are already recorded above
    await Promise.all([database.clients.clear(), database.bookings.clear(), database.projects.clear(), database.transactions.clear(), database.reminders.clear(), database.templates.clear()]);
  });
  if (track) notifyLocalChange();
}
