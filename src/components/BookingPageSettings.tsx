import { useEffect, useState } from 'react';
import { Copy, ExternalLink, Send } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { AccountInfo } from '../lib/account';
import { shareText } from '../lib/messages';

export function BookingPageSettings({ account, onToast }: { account: AccountInfo | null; onToast: (title: string, body?: string) => void }) {
  const [enabled, setEnabled] = useState(false);
  const [slug, setSlug] = useState('');
  const [note, setNote] = useState('');
  const [avail, setAvail] = useState<'idle' | 'checking' | 'ok' | 'taken' | 'invalid'>('idle');
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState({ enabled: false, slug: '' });
  const accountId = account?.id;

  useEffect(() => { if (account) { setEnabled(account.bookingPageEnabled); setSlug(account.slug ?? ''); setNote(account.bookingPageNote); setLive({ enabled: account.bookingPageEnabled, slug: account.slug ?? '' }); } }, [accountId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const client = supabase;
    if (!account || !client) return;
    if (!slug) { setAvail('idle'); return; }
    if (!/^[a-z0-9][a-z0-9-]{2,29}$/.test(slug)) { setAvail('invalid'); return; }
    if (slug === account.slug) { setAvail('ok'); return; }
    setAvail('checking');
    const timer = window.setTimeout(async () => {
      const { data, error } = await client.rpc('slug_available', { p_slug: slug });
      setAvail(error ? 'idle' : data ? 'ok' : 'taken');
    }, 400);
    return () => window.clearTimeout(timer);
  }, [slug, account]);

  if (!account || !supabase) return null;
  const link = live.slug ? `${window.location.origin}/b/${live.slug}` : '';
  const canSave = !busy && (!enabled || (slug && avail === 'ok'));

  const save = async () => {
    setBusy(true);
    const { error } = await supabase!.from('profiles').update({ slug: slug || null, booking_page_enabled: Boolean(enabled && slug), booking_page_note: note.slice(0, 500) }).eq('id', account.id);
    setBusy(false);
    if (error) { onToast(error.code === '23505' ? 'الاسم ده مستخدم' : 'تعذر الحفظ', error.code === '23505' ? 'اختار اسم تاني للينك.' : 'اتأكد من الاتصال وجرّب تاني.'); return; }
    setLive({ enabled: Boolean(enabled && slug), slug });
    onToast('تم حفظ صفحة الحجز', enabled && slug ? 'اللينك شغال دلوقتي.' : 'الصفحة مقفولة.');
  };
  const copy = async () => { try { await navigator.clipboard.writeText(link); onToast('تم نسخ اللينك'); } catch { onToast('تعذر النسخ', link); } };
  const hint = avail === 'checking' ? 'بنتأكد...' : avail === 'ok' ? 'متاح ✓' : avail === 'taken' ? 'مستخدم، جرّب اسم تاني' : avail === 'invalid' ? 'من ٣ لـ٣٠ حرف إنجليزي صغير أو أرقام أو -' : '';

  return <div className="settings-section">
    <div className="settings-section-title"><div className="settings-icon"><Send size={18}/></div><div><h2>صفحة الحجز</h2><p>لينك تحطه في إنستجرام وواتساب، والعميل يبعت طلب حجز بينزل عندك هنا.</p></div></div>
    <label className="toggle-row"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)}/> <span>تشغيل صفحة الحجز</span></label>
    <label className="field-label">اسم اللينك<input dir="ltr" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} placeholder="lamsa" autoCapitalize="none" maxLength={30}/></label>
    {hint && <p className={`slug-hint ${avail}`}>{hint}</p>}
    <label className="field-label">رسالة ترحيب تظهر للعميل (اختياري)<textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="مثال: بنرد خلال ساعات، والعربون بيثبت الحجز."/></label>
    <p className="muted">الباقات اللي في «باقاتي وأسعاري» ورقم واتساب بياناتك بيظهروا في الصفحة.</p>
    <button className="button button-primary" disabled={!canSave} onClick={() => void save()}>{busy ? 'ثواني...' : 'حفظ'}</button>
    {link && live.enabled && <div className="link-box"><code dir="ltr">{link}</code>
      <div className="admin-row"><button className="button button-outline button-small" onClick={() => void copy()}><Copy size={14}/> نسخ</button><button className="button button-outline button-small" onClick={() => void shareText(`احجز جلسة تصوير من هنا:\n${link}`)}><Send size={14}/> شارك</button><a className="button button-outline button-small" href={link} target="_blank" rel="noopener noreferrer"><ExternalLink size={14}/> افتح</a></div></div>}
  </div>;
}
