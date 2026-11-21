export type Channel = 'whatsapp' | 'instagram' | 'manual';
export type LeadStatus = 'new' | 'contacted' | 'interested' | 'booked' | 'lost';
export type BookingStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled';
export type ProjectStatus = 'shooting' | 'editing' | 'review' | 'ready' | 'delivered';
export type TransactionType = 'income' | 'expense';

/** Added by the sync layer. uuid = id on the server; dirty = changed on this phone and not uploaded yet. */
export interface SyncMeta {
  uuid?: string;
  modifiedAt?: string;
  dirty?: 0 | 1;
}

export interface Client extends SyncMeta {
  id?: number;
  name: string;
  phone: string;
  instagram?: string;
  email?: string;
  source: Channel;
  notes?: string;
  createdAt: string;
  lastContactAt?: string;
  leadStatus?: LeadStatus;
}

export interface Booking extends SyncMeta {
  id?: number;
  clientId: number;
  title: string;
  type: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  durationMinutes: number;
  location?: string;
  price: number;
  deposit: number;
  status: BookingStatus;
  notes?: string;
  createdAt: string;
  publicToken?: string; // client status link token (from the server)
  shareEnabled?: boolean;
}

export interface Project extends SyncMeta {
  id?: number;
  bookingId: number;
  status: ProjectStatus;
  shotCount?: number;
  deliveryLink?: string;
  notes?: string;
  updatedAt: string;
}

export interface Transaction extends SyncMeta {
  id?: number;
  type: TransactionType;
  title: string;
  amount: number;
  date: string;
  clientId?: number;
  bookingId?: number;
  category: string;
  notes?: string;
}

export interface Reminder extends SyncMeta {
  id?: number;
  title: string;
  body?: string;
  dueAt: string;
  bookingId?: number;
  clientId?: number;
  done: boolean;
  notifiedAt?: string;
}

export interface MessageTemplate extends SyncMeta {
  id?: number;
  title: string;
  channel: 'whatsapp' | 'instagram' | 'both';
  body: string;
}

export interface ServicePackage {
  id: string;
  name: string;
  type: string;
  price: number;
  durationMinutes: number;
}

export interface LocalProfile {
  name: string;
  studioName: string;
  phone: string;
  currency: string;
  packages?: ServicePackage[];
}

export interface AppBackup {
  schemaVersion: 1 | 2;
  exportedAt: string;
  profile: LocalProfile;
  clients: Client[];
  bookings: Booking[];
  projects: Project[];
  transactions: Transaction[];
  reminders: Reminder[];
  templates: MessageTemplate[];
}
