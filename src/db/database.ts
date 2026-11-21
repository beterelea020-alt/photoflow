import Dexie, { type Table } from 'dexie';
import type { Booking, Client, MessageTemplate, Project, Reminder, Transaction } from '../types';
import { newUuid } from '../lib/uuid';

export type SyncTable = 'clients' | 'bookings' | 'projects' | 'transactions' | 'reminders' | 'templates';
/** Parents first: a booking needs its client to exist on the server before it can be uploaded. */
export const SYNC_TABLES: SyncTable[] = ['clients', 'bookings', 'projects', 'transactions', 'reminders', 'templates'];

export interface Tombstone { id?: number; table: SyncTable; uuid: string }

const listeners = new Set<() => void>();
export const onLocalChange = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const notifyLocalChange = () => listeners.forEach((fn) => fn());

const createdListeners = new Set<(table: SyncTable) => void>();
export const onRecordCreated = (fn: (table: SyncTable) => void) => { createdListeners.add(fn); return () => { createdListeners.delete(fn); }; };

/** Transactions started by the sync engine are flagged so its own writes are not treated as user edits. */
export const markRemote = (trans: unknown) => { (trans as { __remote?: boolean }).__remote = true; };
const isRemote = (trans: unknown) => Boolean((trans as { __remote?: boolean } | undefined)?.__remote);

export class PhotoFlowDatabase extends Dexie {
  clients!: Table<Client, number>;
  bookings!: Table<Booking, number>;
  projects!: Table<Project, number>;
  transactions!: Table<Transaction, number>;
  reminders!: Table<Reminder, number>;
  templates!: Table<MessageTemplate, number>;
  tombstones!: Table<Tombstone, number>;

  constructor(name = 'photoflow-local-v2') {
    super(name);
    this.version(1).stores({
      clients: '++id, name, phone, source, createdAt',
      bookings: '++id, clientId, date, status, type',
      projects: '++id, bookingId, status, updatedAt',
      transactions: '++id, type, date, clientId, bookingId, category',
      reminders: '++id, dueAt, done, bookingId, clientId',
      templates: '++id, title, channel'
    });
    this.version(2).stores({
      clients: '++id, name, phone, source, createdAt, &uuid, dirty',
      bookings: '++id, clientId, date, status, type, &uuid, dirty',
      projects: '++id, bookingId, status, updatedAt, &uuid, dirty',
      transactions: '++id, type, date, clientId, bookingId, category, &uuid, dirty',
      reminders: '++id, dueAt, done, bookingId, clientId, &uuid, dirty',
      templates: '++id, title, channel, &uuid, dirty',
      tombstones: '++id, table, uuid'
    }).upgrade(async (tx) => {
      // Everything that already exists on the phone is "not uploaded yet": the first sync uploads it all.
      const now = new Date().toISOString();
      for (const name of SYNC_TABLES) {
        await tx.table(name).toCollection().modify((row: Record<string, unknown>) => {
          row.uuid = row.uuid ?? newUuid();
          row.modifiedAt = row.modifiedAt ?? now;
          row.dirty = 1;
        });
      }
    });

    for (const name of SYNC_TABLES) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const table = this.table(name) as Table<any, any>;
      table.hook('creating', function (this: any, _key: any, obj: any, trans: any) {
        if (isRemote(trans)) return;
        const row = obj as Record<string, unknown>;
        row.uuid = row.uuid ?? newUuid();
        row.modifiedAt = new Date().toISOString();
        row.dirty = 1;
        this.onsuccess = () => { notifyLocalChange(); createdListeners.forEach((fn) => fn(name)); };
      });
      table.hook('updating', function (this: any, _mods: any, _key: any, obj: any, trans: any) {
        if (isRemote(trans)) return undefined;
        this.onsuccess = notifyLocalChange;
        return { uuid: (obj as { uuid?: string }).uuid ?? newUuid(), modifiedAt: new Date().toISOString(), dirty: 1 };
      });
      table.hook('deleting', (_key: any, obj: any, trans: any) => {
        if (isRemote(trans)) return;
        const uuid = (obj as { uuid?: string }).uuid;
        if (!uuid) return;
        // A separate transaction after success keeps this working inside any caller transaction.
        const self = this;
        queueMicrotask(() => { void self.tombstones.add({ table: name, uuid }).then(notifyLocalChange); });
      });
    }
  }
}

export const db = new PhotoFlowDatabase();
