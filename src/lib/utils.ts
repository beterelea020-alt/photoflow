export const currency = (value: number) => new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 0 }).format(value) + ' ج.م';
export const compactNumber = (value: number) => new Intl.NumberFormat('ar-EG', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
export const dateLabel = (value: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' }) => {
  if (!value) return '—';
  const date = new Date(`${value}T12:00:00`);
  return new Intl.DateTimeFormat('ar-EG', options).format(date);
};
export const fullDateLabel = (value: string) => dateLabel(value, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
export const timeLabel = (value: string) => {
  if (!value) return '—';
  const [h, m] = value.split(':').map(Number);
  return new Intl.DateTimeFormat('ar-EG', { hour: 'numeric', minute: '2-digit' }).format(new Date(2000, 0, 1, h, m));
};
export const isoToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
export const addDays = (date: Date, amount: number) => { const d = new Date(date); d.setDate(d.getDate() + amount); return d; };
export const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] ?? '').join('');
export const escapePhoneForWhatsApp = (phone: string) => {
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = `20${digits.slice(1)}`;
  else if (/^1[0125]\d{8}$/.test(digits)) digits = `20${digits}`;
  return digits;
};
export const openWhatsApp = (phone: string, message = '') => {
  const normalized = escapePhoneForWhatsApp(phone);
  if (!normalized) return;
  const url = `https://wa.me/${normalized}${message ? `?text=${encodeURIComponent(message)}` : ''}`;
  window.open(url, '_blank', 'noopener,noreferrer');
};
export const fillTemplate = (body: string, values: Record<string, string>) => body.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? `{${key}}`);
export const daysBetween = (a: string, b: string) => Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86400000);
