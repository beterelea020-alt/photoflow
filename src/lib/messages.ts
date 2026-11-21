import type { Booking, Client, LocalProfile, MessageTemplate, Project } from '../types';
import { currency, fullDateLabel, timeLabel } from './utils';

/** Titles are how the app finds the right ready-made message for each situation. */
export const TPL = {
  reply: 'رد أولي على الاستفسار',
  deposit: 'طلب العربون',
  confirm: 'تأكيد الحجز',
  reminder: 'تذكير بالموعد',
  thanks: 'شكر بعد الجلسة',
  ready: 'الصور جاهزة',
  balance: 'طلب المبلغ المتبقي',
  review: 'طلب تقييم'
} as const;
export type TemplateKey = keyof typeof TPL;

export const DEFAULT_TEMPLATES: Omit<MessageTemplate, 'id'>[] = [
  { title: TPL.reply, channel: 'both', body: 'أهلًا {name} 🤎\nشكرًا لتواصلك معانا.\nممكن تقولي نوع التصوير والتاريخ اللي في بالك والمكان؟ وأرد عليك بالتفاصيل والأسعار على طول.' },
  { title: TPL.deposit, channel: 'whatsapp', body: 'أهلًا {name} 🤎\nعشان نثبّت حجز {title} يوم {date} الساعة {time} محتاجين عربون.\nإجمالي الاتفاق {price}.\nتقدر تحوّل العربون وتبعتلي صورة التحويل، وأأكد الحجز فورًا.' },
  { title: TPL.confirm, channel: 'whatsapp', body: 'أهلًا {name} 🤎\nبنأكد معاك حجز {title} يوم {date} الساعة {time}.\nالمكان: {location}\nإجمالي الاتفاق {price}، المدفوع {deposit}، والمتبقي {remaining}.\nمستنيينك!' },
  { title: TPL.reminder, channel: 'whatsapp', body: 'أهلًا {name} 🤎\nتذكير بسيط بموعد التصوير {date} الساعة {time}.\nالمكان: {location}\nلو في أي تغيير قولي من دلوقتي. مستنيينك!' },
  { title: TPL.thanks, channel: 'whatsapp', body: 'أهلًا {name} 🤎\nشكرًا إنك اخترتنا، الجلسة كانت جميلة جدًا.\nهبدأ في تجهيز الصور وأبلغك أول ما تبقى جاهزة.' },
  { title: TPL.ready, channel: 'whatsapp', body: 'أهلًا {name} 🤎\nصورك جاهزة! تقدر تشوفها وتنزلها من هنا:\n{link}\nيا رب تعجبك.' },
  { title: TPL.balance, channel: 'whatsapp', body: 'أهلًا {name} 🤎\nتذكير لطيف بالمبلغ المتبقي من حجز {title}: {remaining}.\nتقدر تحوّله في الوقت المناسب ليك، وشكرًا لتعاونك.' },
  { title: TPL.review, channel: 'whatsapp', body: 'أهلًا {name} 🤎\nيسعدني لو تقولي رأيك في التجربة، رأيك مهم جدًا وبيساعد غيرك يعرفنا.\nشكرًا ليك!' }
];

export const TEMPLATE_FIELDS: Record<string, string> = {
  name: 'اسم العميل', title: 'اسم الجلسة', date: 'تاريخ الحجز', time: 'وقت الحجز', location: 'مكان التصوير',
  price: 'السعر', deposit: 'المدفوع', remaining: 'المتبقي', link: 'رابط الصور (من تفاصيل المشروع)', studio: 'اسم الاستوديو'
};
/** Lines that use an optional value are dropped when the value is empty. */
const OPTIONAL = ['location', 'studio'];

export function buildValues(ctx: { client?: Client; booking?: Booking; project?: Project; profile?: LocalProfile }): Record<string, string> {
  const { client, booking, project, profile } = ctx;
  const values: Record<string, string> = { location: '', studio: (profile?.studioName || profile?.name || '').trim() };
  if (client) values.name = client.name;
  if (booking) {
    values.title = booking.title;
    values.date = fullDateLabel(booking.date);
    values.time = timeLabel(booking.time);
    values.location = booking.location?.trim() ?? '';
    values.price = currency(booking.price);
    values.deposit = currency(booking.deposit);
    values.remaining = currency(Math.max(0, booking.price - booking.deposit));
  }
  if (project?.deliveryLink) values.link = project.deliveryLink;
  return values;
}

export function renderMessage(body: string, values: Record<string, string>): { text: string; missing: string[] } {
  const lines = body.split('\n').filter((line) => {
    const tokens = Array.from(line.matchAll(/\{(\w+)\}/g), (m) => m[1]);
    return !tokens.some((key) => OPTIONAL.includes(key) && values[key] === '');
  });
  const text = lines.join('\n').replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match).replace(/\n{3,}/g, '\n\n').trim();
  const missing = Array.from(new Set(text.match(/\{\w+\}/g) ?? [])).map((token) => TEMPLATE_FIELDS[token.slice(1, -1)] ?? token);
  return { text, missing };
}

/** Uses the photographer's own saved version of a message when one exists. */
export function renderByKey(key: TemplateKey, templates: MessageTemplate[], ctx: Parameters<typeof buildValues>[0]) {
  const saved = templates.find((t) => t.title === TPL[key]);
  const body = saved?.body ?? DEFAULT_TEMPLATES.find((t) => t.title === TPL[key])!.body;
  return renderMessage(body, buildValues(ctx));
}

/** "منى أحمد 01012345678" or a pasted WhatsApp contact → { name, phone } */
export function parseContactText(raw: string): { name: string; phone: string } {
  const text = raw.replace(/[\u200e\u200f\u202a-\u202e]/g, '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  const phoneMatch = text.match(/\+?\d[\d\s().-]{7,}\d/);
  const phone = phoneMatch ? phoneMatch[0].replace(/[^\d+]/g, '') : '';
  const name = text.replace(phoneMatch?.[0] ?? '', ' ').replace(/[:،,;|\-–—]+/g, ' ').replace(/\s+/g, ' ').trim();
  return { name, phone };
}

export const isEgyptianMobile = (normalized: string) => /^20(10|11|12|15)\d{8}$/.test(normalized);

export async function shareText(text: string) {
  try {
    if (navigator.share) { await navigator.share({ text }); return; }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
}
