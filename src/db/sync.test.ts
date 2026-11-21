import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { PhotoFlowDatabase } from './database';
import { clearAllData } from './actions';
import { createSyncEngine, type SyncStorage } from './sync';
import { FakeRemote } from './fakeRemote';

let counter = 0;
const memoryStorage = (): SyncStorage => { const map = new Map<string, string>(); return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); } }; };
const device = (remote: FakeRemote, userId = 'user-1') => {
  const db = new PhotoFlowDatabase(`test-${++counter}`);
  const engine = createSyncEngine({ db, remote, storage: memoryStorage(), userId });
  return { db, engine };
};
const newClient = (name = 'منى') => ({ name, phone: '01012345678', source: 'manual' as const, createdAt: '2026-11-01T10:00:00.000Z' });
const newBooking = (clientId: number, extra = {}) => ({ clientId, title: 'جلسة خطوبة', type: 'خطوبة', date: '2026-12-01', time: '17:00', durationMinutes: 120, price: 6000, deposit: 2000, status: 'confirmed' as const, createdAt: '2026-11-01T10:00:00.000Z', ...extra });

describe('local change tracking', () => {
  it('new rows get a uuid and are marked as not uploaded', async () => {
    const { db } = device(new FakeRemote());
    const id = await db.clients.add(newClient());
    const row = await db.clients.get(id);
    expect(row?.uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(row?.dirty).toBe(1);
  });
  it('edits mark the row dirty again and keep the uuid (update and full put)', async () => {
    const remote = new FakeRemote();
    const { db, engine } = device(remote);
    const id = await db.transactions.add({ type: 'income', title: 'عربون', amount: 100, date: '2026-11-01', category: 'عربون' });
    await engine.syncNow();
    expect((await db.transactions.get(id))?.dirty).toBe(0);
    const uuid = (await db.transactions.get(id))?.uuid;
    await db.transactions.update(id, { amount: 150 });
    expect(await db.transactions.get(id)).toMatchObject({ dirty: 1, uuid, amount: 150 });
    await engine.syncNow();
    await db.transactions.put({ type: 'income', title: 'عربون', amount: 175, date: '2026-11-01', category: 'عربون', id });
    expect(await db.transactions.get(id)).toMatchObject({ dirty: 1, uuid, amount: 175 });
  });
  it('deleting records a tombstone, also for clear-all and bulk deletes', async () => {
    const { db } = device(new FakeRemote());
    const a = await db.clients.add(newClient('أ'));
    await db.clients.add(newClient('ب'));
    await db.clients.delete(a);
    await new Promise((r) => setTimeout(r, 10));
    expect(await db.tombstones.count()).toBe(1);
    await clearAllData(true, db);
    expect(await db.clients.count()).toBe(0);
    expect(await db.tombstones.count()).toBeGreaterThanOrEqual(2);
  });
  it('existing phone data (old schema) is picked up and queued for the first upload', async () => {
    const name = `legacy-${++counter}`;
    const old = new Dexie(name);
    old.version(1).stores({ clients: '++id, name, phone, source, createdAt', bookings: '++id, clientId, date, status, type', projects: '++id, bookingId, status, updatedAt', transactions: '++id, type, date, clientId, bookingId, category', reminders: '++id, dueAt, done, bookingId, clientId', templates: '++id, title, channel' });
    await old.table('clients').add(newClient('قديم'));
    await old.table('bookings').add(newBooking(1));
    old.close();
    const db = new PhotoFlowDatabase(name);
    const clients = await db.clients.toArray();
    expect(clients[0]).toMatchObject({ name: 'قديم', dirty: 1 });
    expect(clients[0].uuid).toBeTruthy();
    const remote = new FakeRemote();
    const engine = createSyncEngine({ db, remote, storage: memoryStorage(), userId: 'u' });
    const summary = await engine.syncNow();
    expect(summary.pushed).toBe(2);
    expect(remote.live('clients')).toHaveLength(1);
    expect(remote.live('bookings')[0].client_id).toBe(clients[0].uuid);
  });
});

describe('upload', () => {
  it('uploads a full booking tree with correct relations and then has nothing left to do', async () => {
    const remote = new FakeRemote();
    const { db, engine } = device(remote);
    const clientId = await db.clients.add(newClient());
    const bookingId = await db.bookings.add(newBooking(clientId));
    await db.projects.add({ bookingId, status: 'ready', deliveryLink: 'https://drive.example/x', updatedAt: '2026-11-01T10:00:00.000Z' });
    await db.transactions.add({ type: 'income', title: 'عربون', amount: 2000, date: '2026-11-01', clientId, bookingId, category: 'عربون' });
    await db.reminders.add({ title: 'تأكيد', dueAt: '2026-11-30T10:00:00.000Z', bookingId, clientId, done: false });
    await db.templates.add({ title: 'تأكيد الحجز', channel: 'whatsapp', body: 'أهلًا {name}' });
    const summary = await engine.syncNow();
    expect(summary.errors).toEqual([]);
    expect(remote.live('clients')).toHaveLength(1);
    const booking = remote.live('bookings')[0];
    expect(booking.client_id).toBe((await db.clients.get(clientId))?.uuid);
    expect(remote.live('projects')[0].booking_id).toBe(booking.id);
    expect(remote.live('transactions')[0]).toMatchObject({ booking_id: booking.id, amount: 2000 });
    expect(await engine.pendingCount()).toBe(0);
    const again = await engine.syncNow();
    expect(again.pushed).toBe(0);
  });
  it('the server link token comes back to the phone', async () => {
    const remote = new FakeRemote();
    const { db, engine } = device(remote);
    const clientId = await db.clients.add(newClient());
    const bookingId = await db.bookings.add(newBooking(clientId));
    await engine.syncNow();
    expect((await db.bookings.get(bookingId))?.publicToken).toMatch(/^tok-/);
  });
  it('a row the server rejects does not block the others and stays queued', async () => {
    const remote = new FakeRemote();
    remote.reject = (table, row) => (table === 'clients' && row.name === 'BAD' ? 'check constraint' : null);
    const { db, engine } = device(remote);
    await db.clients.add(newClient('سليم 1'));
    const bad = await db.clients.add(newClient('BAD'));
    await db.clients.add(newClient('سليم 2'));
    const summary = await engine.syncNow();
    expect(remote.live('clients')).toHaveLength(2);
    expect(summary.errors).toHaveLength(1);
    expect((await db.clients.get(bad))?.dirty).toBe(1);
  });
  it('a booking whose client is missing is skipped, not crashed on', async () => {
    const remote = new FakeRemote();
    const { db, engine } = device(remote);
    await db.bookings.add(newBooking(999));
    const summary = await engine.syncNow();
    expect(summary.skipped).toBe(1);
    expect(remote.live('bookings')).toHaveLength(0);
  });
  it('offline: nothing is lost, and the next sync uploads everything', async () => {
    const remote = new FakeRemote();
    const { db, engine } = device(remote);
    await db.clients.add(newClient());
    remote.offline = true;
    await expect(engine.syncNow()).rejects.toThrow();
    expect(await engine.pendingCount()).toBe(1);
    remote.offline = false;
    await engine.syncNow();
    expect(remote.live('clients')).toHaveLength(1);
    expect(await engine.pendingCount()).toBe(0);
  });
  it('an edit made while the upload is running stays queued', async () => {
    const remote = new FakeRemote();
    const { db, engine } = device(remote);
    const id = await db.clients.add(newClient('قبل'));
    const original = remote.upsert.bind(remote);
    remote.upsert = async (table, rows) => { await original(table, rows); if (table === 'clients') await db.clients.update(id, { name: 'بعد' }); };
    await engine.syncNow();
    expect((await db.clients.get(id))?.name).toBe('بعد');
    remote.upsert = original;
    await engine.syncNow();
    expect([...remote.live('clients')][0].name).toBe('بعد');
  });
});

describe('two phones, one account', () => {
  it('a second phone receives everything with its own local ids and working relations', async () => {
    const remote = new FakeRemote();
    const a = device(remote);
    const b = device(remote);
    await b.db.clients.add(newClient('عميل مختلف على التليفون ب')); // shifts local ids on B
    await b.engine.syncNow();
    const clientId = await a.db.clients.add(newClient('منى'));
    const bookingId = await a.db.bookings.add(newBooking(clientId));
    await a.db.transactions.add({ type: 'income', title: 'عربون', amount: 2000, date: '2026-11-01', clientId, bookingId, category: 'عربون' });
    await a.engine.syncNow();
    await b.engine.syncNow();
    const mona = (await b.db.clients.toArray()).find((c) => c.name === 'منى')!;
    const booking = (await b.db.bookings.toArray())[0];
    expect(booking.clientId).toBe(mona.id);
    expect((await b.db.transactions.toArray())[0]).toMatchObject({ clientId: mona.id, bookingId: booking.id });
    expect(mona.dirty).toBe(0);
  });
  it('edits and deletes travel between phones', async () => {
    const remote = new FakeRemote();
    const a = device(remote);
    const b = device(remote);
    const clientId = await a.db.clients.add(newClient('منى'));
    const bookingId = await a.db.bookings.add(newBooking(clientId));
    await a.engine.syncNow(); await b.engine.syncNow();
    await b.db.bookings.update((await b.db.bookings.toArray())[0].id!, { price: 7500 });
    await b.engine.syncNow(); await a.engine.syncNow();
    expect((await a.db.bookings.get(bookingId))?.price).toBe(7500);
    await a.db.bookings.delete(bookingId);
    await a.engine.syncNow(); await b.engine.syncNow();
    expect(await b.db.bookings.count()).toBe(0);
    expect(remote.live('bookings')).toHaveLength(0);
  });
  it('an edit that was not uploaded yet is not overwritten by the other phone', async () => {
    const remote = new FakeRemote();
    const a = device(remote);
    const b = device(remote);
    const id = await a.db.clients.add(newClient('أصلي'));
    await a.engine.syncNow(); await b.engine.syncNow();
    const bId = (await b.db.clients.toArray())[0].id!;
    await b.db.clients.update(bId, { name: 'من تليفون ب' });
    await b.engine.syncNow();
    await a.db.clients.update(id, { name: 'من تليفون أ' }); // not uploaded yet
    const rows = await remote.fetchChanged('clients', '0', 10);
    expect(rows[0].name).toBe('من تليفون ب');
    await a.engine.syncNow();
    expect((await a.db.clients.get(id))?.name).toBe('من تليفون أ');
    expect(remote.live('clients')[0].name).toBe('من تليفون أ');
  });
  it('clear-all on one phone removes the data on the other', async () => {
    const remote = new FakeRemote();
    const a = device(remote);
    const b = device(remote);
    await a.db.clients.add(newClient()); await a.db.clients.add(newClient('2'));
    await a.engine.syncNow(); await b.engine.syncNow();
    expect(await b.db.clients.count()).toBe(2);
    await clearAllData(true, a.db);
    await a.engine.syncNow(); await b.engine.syncNow();
    expect(await b.db.clients.count()).toBe(0);
    expect(remote.live('clients')).toHaveLength(0);
  });
  it('large histories are downloaded page by page', async () => {
    const remote = new FakeRemote();
    const a = device(remote);
    const b = device(remote);
    await a.db.clients.bulkAdd(Array.from({ length: 1230 }, (_, i) => newClient(`عميل ${i}`)));
    await a.engine.syncNow();
    await b.engine.syncNow();
    expect(await b.db.clients.count()).toBe(1230);
    const again = await b.engine.syncNow();
    expect(again.pulled).toBe(0);
  });
});
