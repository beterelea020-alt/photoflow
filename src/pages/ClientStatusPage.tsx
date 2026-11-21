import { useEffect, useState } from 'react';
import { Check, MessageCircle } from 'lucide-react';
import { fetchBookingStatus, type BookingStatusView } from '../lib/publicApi';
import { currency, dateLabel, escapePhoneForWhatsApp, fullDateLabel, timeLabel } from '../lib/utils';

const stages: [string, string][] = [['shooting', 'التصوير'], ['editing', 'التعديل'], ['review', 'مراجعتك'], ['ready', 'جاهز للتسليم'], ['delivered', 'تم التسليم']];
const statusText = { pending: 'بانتظار التأكيد', confirmed: 'مؤكد', completed: 'مكتمل', cancelled: 'ملغي' } as const;

export default function ClientStatusPage({ token }: { token: string }) {
  const [view, setView] = useState<BookingStatusView | null>(null);
  const [state, setState] = useState<'loading' | 'missing' | 'ready'>('loading');

  useEffect(() => {
    document.title = 'متابعة حجزك';
    const robots = document.createElement('meta'); robots.name = 'robots'; robots.content = 'noindex,nofollow'; document.head.appendChild(robots);
    let off = false;
    const load = () => fetchBookingStatus(token).then((v) => { if (off) return; if (v) { setView(v); setState('ready'); } else setState('missing'); }).catch(() => { if (!off) setState((s) => (s === 'ready' ? s : 'missing')); });
    void load();
    const timer = window.setInterval(() => void load(), 60 * 1000);
    return () => { off = true; window.clearInterval(timer); robots.remove(); };
  }, [token]);

  if (state === 'loading') return <main className="security-screen" dir="rtl"><div className="app-loading"><strong>جارٍ التحميل...</strong></div></main>;
  if (state === 'missing' || !view) return <main className="security-screen" dir="rtl"><section className="security-card"><h1>اللينك مش شغال</h1><p className="security-description">ممكن يكون اتقفل أو غلط. كلّم المصور وهيبعتلك لينك جديد.</p></section></main>;

  const current = stages.findIndex(([key]) => key === view.project_status);
  const wa = escapePhoneForWhatsApp(view.studio_phone);
  return <main className="security-screen" dir="rtl"><section className="security-card public-card">
    <p className="eyebrow">{view.studio_name}</p>
    <h1>{view.title}</h1>
    <p className="security-description">أهلًا {view.client_name} 🤎</p>
    <div className="status-grid">
      <div><span>الموعد</span><strong>{fullDateLabel(view.date)}</strong><small>{timeLabel(view.time)}{view.location ? ` · ${view.location}` : ''}</small></div>
      <div><span>حالة الحجز</span><strong>{statusText[view.status]}</strong></div>
      <div><span>الإجمالي</span><strong>{currency(view.price)}</strong></div>
      <div><span>المدفوع</span><strong>{currency(view.deposit)}</strong></div>
      <div className="status-remaining"><span>المتبقي</span><strong className={view.remaining > 0 ? 'amount-negative' : 'amount-positive'}>{currency(view.remaining)}</strong></div>
    </div>
    {view.status !== 'cancelled' && <div className="stage-track" aria-label="مراحل الشغل">{stages.map(([key, label], index) => <div key={key} className={`stage ${current >= 0 && index < current ? 'done' : ''} ${index === current ? 'now' : ''}`}><i>{current >= 0 && index < current ? <Check size={14}/> : index + 1}</i><span>{label}</span></div>)}</div>}
    {view.payments.length > 0 && <div className="payments-box"><strong>الدفعات</strong>{view.payments.map((p, i) => <div className="payment-row" key={i}><span>{dateLabel(p.date)}</span><b className="amount-positive">{currency(p.amount)}</b></div>)}</div>}
    {wa && <a className="button button-primary button-block" href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer"><MessageCircle size={16}/> كلّم {view.studio_name}</a>}
    <p className="security-footnote">الصفحة بتتحدّث لوحدها.</p>
  </section></main>;
}
