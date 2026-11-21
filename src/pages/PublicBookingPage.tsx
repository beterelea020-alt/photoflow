import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CalendarDays, CheckCircle2, MessageCircle, Send } from 'lucide-react';
import { fetchPublicPage, submitBookingRequest, type PublicPage, type RequestError } from '../lib/publicApi';
import { escapePhoneForWhatsApp, fullDateLabel, isoToday, currency } from '../lib/utils';

const errorText: Record<RequestError, string> = {
  rate_limited: 'بعتّ طلبات كتير في وقت قصير. استنى شوية وجرّب تاني.',
  not_available: 'صفحة الحجز دي مش متاحة دلوقتي.',
  invalid_request: 'راجع البيانات: الاسم، ورقم الموبايل، والتاريخ لازم يكون النهارده أو بعده.',
  network: 'مفيش اتصال بالإنترنت. اتأكد وجرّب تاني.'
};
const types = ['زفاف', 'خطوبة', 'بورتريه', 'منتجات', 'فعاليات', 'تخرج', 'عائلي', 'أخرى'];

export default function PublicBookingPage({ slug }: { slug: string }) {
  const [state, setState] = useState<'loading' | 'missing' | 'ready' | 'sent'>('loading');
  const [page, setPage] = useState<PublicPage | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [type, setType] = useState('زفاف');
  const [packageId, setPackageId] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [notes, setNotes] = useState('');
  const [hp, setHp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    document.title = 'احجز جلسة تصوير';
    let off = false;
    fetchPublicPage(slug).then((p) => { if (off) return; if (!p) setState('missing'); else { setPage(p); setState('ready'); document.title = `احجز مع ${p.studio_name}`; } }).catch(() => { if (!off) setState('missing'); });
    return () => { off = true; };
  }, [slug]);

  const pack = useMemo(() => page?.packages.find((p) => p.id === packageId), [page, packageId]);
  const dateBusy = Boolean(date && page?.busy_dates.includes(date));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(''); setBusy(true);
    const result = await submitBookingRequest({ slug, name, phone, type: pack?.type ?? type, date, time, notes, packageName: pack?.name ?? '', hp });
    setBusy(false);
    if ('error' in result) setError(errorText[result.error]); else setState('sent');
  };

  if (state === 'loading') return <main className="security-screen" dir="rtl"><div className="app-loading"><strong>جارٍ التحميل...</strong></div></main>;
  if (state === 'missing' || !page) return <main className="security-screen" dir="rtl"><section className="security-card"><h1>الصفحة مش موجودة</h1><p className="security-description">اللينك ده مش شغال دلوقتي. اتأكد من اللينك أو كلّم المصور.</p></section></main>;

  const wa = escapePhoneForWhatsApp(page.phone);
  if (state === 'sent') return <main className="security-screen" dir="rtl"><section className="security-card public-card">
    <div className="security-hero-icon"><CheckCircle2 size={27}/></div>
    <h1>وصل طلبك</h1>
    <p className="security-description">{page.studio_name} هيتواصل معاك قريب على الرقم اللي كتبته لتأكيد الميعاد والتفاصيل.</p>
    {wa && <a className="button button-primary button-block" href={`https://wa.me/${wa}?text=${encodeURIComponent(`أهلًا، أنا ${name}. بعتّلكم طلب حجز يوم ${date ? fullDateLabel(date) : ''}.`)}`} target="_blank" rel="noopener noreferrer"><MessageCircle size={16}/> كلّمهم على واتساب</a>}
  </section></main>;

  return <main className="security-screen" dir="rtl"><section className="security-card public-card">
    <h1>{page.studio_name}</h1>
    {page.display_name && page.display_name !== page.studio_name && <p className="security-description">{page.display_name}</p>}
    {page.note && <p className="public-note">{page.note}</p>}
    <form className="security-form" onSubmit={(event) => void submit(event)}>
      {page.packages.length > 0 && <fieldset className="package-choice"><legend>اختار الباقة</legend>
        {page.packages.map((p) => <label key={p.id} className={`package-option ${packageId === p.id ? 'selected' : ''}`}><input type="radio" name="package" checked={packageId === p.id} onChange={() => setPackageId(p.id)}/><span><strong>{p.name}</strong><small>{p.type} · {p.durationMinutes} دقيقة</small></span><b>{currency(p.price)}</b></label>)}
        <label className={`package-option ${packageId === '' ? 'selected' : ''}`}><input type="radio" name="package" checked={packageId === ''} onChange={() => setPackageId('')}/><span><strong>مش متأكد / حاجة تانية</strong></span></label>
      </fieldset>}
      {!pack && <label className="field-label">نوع التصوير<select value={type} onChange={(e) => setType(e.target.value)}>{types.map((t) => <option key={t}>{t}</option>)}</select></label>}
      <label className="field-label">اسمك *<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} required/></label>
      <label className="field-label">رقم الموبايل (واتساب) *<input dir="ltr" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" placeholder="01xxxxxxxxx" required/></label>
      <div className="form-two-col">
        <label className="field-label">التاريخ المطلوب *<input type="date" min={isoToday()} value={date} onChange={(e) => setDate(e.target.value)} required/></label>
        <label className="field-label">الساعة (اختياري)<input type="time" value={time} onChange={(e) => setTime(e.target.value)}/></label>
      </div>
      {dateBusy && <p className="form-warning">اليوم ده عند المصور حجز تاني. ابعت الطلب برضه وهيتفق معاك على وقت مناسب.</p>}
      <label className="field-label">ملاحظات (اختياري)<textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} placeholder="المكان، عدد الأشخاص، أي تفاصيل..."/></label>
      <input className="hp-field" tabIndex={-1} autoComplete="off" aria-hidden="true" name="website" value={hp} onChange={(e) => setHp(e.target.value)}/>
      {error && <p className="security-error" role="alert">{error}</p>}
      <button className="button button-primary button-block security-submit" disabled={busy || !name.trim() || !phone.trim() || !date}><Send size={16}/> {busy ? 'ثواني...' : 'ابعت طلب الحجز'}</button>
      <p className="security-footnote"><CalendarDays size={14}/> ده طلب مش حجز مؤكد. المصور هيتواصل معاك للتأكيد.</p>
      <p className="security-footnote">بإرسال الطلب، اسمك ورقمك وتفاصيل الطلب بيتبعتوا لـ{page.studio_name} عشان يتواصل معاك. <a href="/privacy" target="_blank" rel="noopener noreferrer">سياسة الخصوصية</a></p>
    </form>
  </section></main>;
}
