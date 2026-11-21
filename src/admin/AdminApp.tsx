import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { adminCall, adminSupabase, ForbiddenError, type AccountRow, type AuditRow, type Overview } from './adminClient';

type Stage = 'loading' | 'login' | 'enroll' | 'verify' | 'denied' | 'ready';
type Tab = 'overview' | 'accounts' | 'log' | 'settings';

const fmtDate = (v: string | null) => (v ? new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(v)) : '—');
const fmtTime = (v: string | null) => (v ? new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(v)) : 'لسه');
const statusLabel = (a: Pick<AccountRow, 'status' | 'trial_ends_at' | 'paid_until'>) => {
  const now = Date.now();
  if (a.status === 'suspended') return { text: 'موقوف', tone: 'bad' };
  if (a.status === 'pending') return { text: 'ينتظر موافقة', tone: 'warn' };
  if (a.status === 'trial') return a.trial_ends_at && new Date(a.trial_ends_at).getTime() > now ? { text: 'تجربة', tone: 'ok' } : { text: 'التجربة خلصت', tone: 'warn' };
  return !a.paid_until || new Date(a.paid_until).getTime() > now ? { text: 'مشترك', tone: 'good' } : { text: 'الاشتراك خلص', tone: 'warn' };
};

export default function AdminApp() {
  const [stage, setStage] = useState<Stage>('loading');
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('overview');
  const [factorId, setFactorId] = useState('');
  const [qr, setQr] = useState('');
  const [secret, setSecret] = useState('');

  useEffect(() => {
    document.title = 'PhotoFlow';
    const robots = document.createElement('meta'); robots.name = 'robots'; robots.content = 'noindex,nofollow'; document.head.appendChild(robots);
    return () => robots.remove();
  }, []);

  const deny = useCallback(async () => { await adminSupabase?.auth.signOut(); setStage('denied'); }, []);

  /** Decide the next step from the session's assurance level (2-factor required). */
  const advance = useCallback(async () => {
    if (!adminSupabase) { setStage('denied'); return; }
    const { data: session } = await adminSupabase.auth.getSession();
    if (!session.session) { setStage('login'); return; }
    const { data: level } = await adminSupabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (level?.currentLevel === 'aal2') {
      try { const ok = await adminCall<boolean>('is_admin'); if (ok) setStage('ready'); else await deny(); } catch { await deny(); }
      return;
    }
    if (level?.nextLevel === 'aal2') {
      const { data: factors } = await adminSupabase.auth.mfa.listFactors();
      const totp = factors?.totp?.[0];
      if (totp) { setFactorId(totp.id); setStage('verify'); return; }
    }
    const { data, error: enrollError } = await adminSupabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `PhotoFlow ${new Date().toISOString().slice(0, 10)}` });
    if (enrollError || !data) { setError('تعذر تجهيز التحقق بخطوتين.'); setStage('login'); return; }
    setFactorId(data.id); setQr(data.totp.qr_code); setSecret(data.totp.secret); setStage('enroll');
  }, [deny]);

  useEffect(() => { void advance(); }, [advance]);

  // Leave the panel signed out after 15 idle minutes.
  const idle = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (stage !== 'ready') return;
    const reset = () => { window.clearTimeout(idle.current); idle.current = window.setTimeout(() => { void adminSupabase?.auth.signOut().then(() => setStage('login')); }, 15 * 60 * 1000); };
    reset();
    const events = ['pointerdown', 'keydown', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, reset));
    return () => { window.clearTimeout(idle.current); events.forEach((e) => window.removeEventListener(e, reset)); };
  }, [stage]);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const login = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setBusy(true);
    const { error: signError } = await adminSupabase!.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (signError) { setError('بيانات الدخول غلط.'); return; }
    setPassword(''); await advance();
  };
  const verify = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setBusy(true);
    const { error: verifyError } = await adminSupabase!.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
    setBusy(false);
    if (verifyError) { setError('الكود غلط أو انتهى. جرّب كود جديد.'); setCode(''); return; }
    setCode(''); await advance();
  };

  if (stage === 'denied') return <main className="admin-gate" dir="rtl"><h1>الصفحة مش موجودة</h1></main>;
  if (stage === 'loading') return <main className="admin-gate" dir="rtl"><p>...</p></main>;
  if (stage === 'login') return <main className="admin-gate" dir="rtl"><form className="admin-card" onSubmit={(e) => void login(e)}>
    <h1>PhotoFlow</h1>
    <label className="field-label">الإيميل<input dir="ltr" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required/></label>
    <label className="field-label">كلمة السر<input dir="ltr" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required/></label>
    {error && <p className="security-error" role="alert">{error}</p>}
    <button className="button button-primary button-block" disabled={busy}>{busy ? '...' : 'دخول'}</button>
  </form></main>;
  if (stage === 'enroll' || stage === 'verify') return <main className="admin-gate" dir="rtl"><form className="admin-card" onSubmit={(e) => void verify(e)}>
    <h1>{stage === 'enroll' ? 'فعّل التحقق بخطوتين' : 'كود التحقق'}</h1>
    {stage === 'enroll' && <><p className="security-description">امسح الكود بتطبيق مصادقة (Google Authenticator أو Microsoft Authenticator)، وبعدين اكتب الكود اللي بيظهر.</p>
      {qr && <img className="admin-qr" src={qr} alt="QR" width={200} height={200}/>}
      {secret && <p className="admin-secret" dir="ltr">{secret}</p>}</>}
    <label className="field-label">الكود (6 أرقام)<input className="pin-input" dir="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required/></label>
    {error && <p className="security-error" role="alert">{error}</p>}
    <button className="button button-primary button-block" disabled={busy || code.length !== 6}>{busy ? '...' : 'تأكيد'}</button>
  </form></main>;

  return <main className="admin-shell" dir="rtl">
    <header className="admin-top"><strong>PhotoFlow · الإدارة</strong><button className="button button-quiet button-small" onClick={() => void adminSupabase?.auth.signOut().then(() => setStage('login'))}>خروج</button></header>
    <nav className="admin-tabs">{([['overview', 'نظرة عامة'], ['accounts', 'الحسابات'], ['log', 'السجل'], ['settings', 'الإعدادات']] as [Tab, string][]).map(([key, label]) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}</button>)}</nav>
    <div className="admin-body">
      {tab === 'overview' && <OverviewTab onForbidden={deny}/>}
      {tab === 'accounts' && <AccountsTab onForbidden={deny}/>}
      {tab === 'log' && <LogTab onForbidden={deny}/>}
      {tab === 'settings' && <SettingsTab onForbidden={deny}/>}
    </div>
  </main>;
}

function useLoad<T>(fn: () => Promise<T>, onForbidden: () => void, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const reload = useCallback(() => { setError(''); fn().then(setData).catch((e) => { if (e instanceof ForbiddenError) onForbidden(); else setError('تعذر التحميل.'); }); }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(reload, [reload]);
  return { data, error, reload };
}

function OverviewTab({ onForbidden }: { onForbidden: () => void }) {
  const { data, error } = useLoad(() => adminCall<Overview>('admin_overview'), onForbidden);
  if (error) return <p className="security-error">{error}</p>;
  if (!data) return <p>...</p>;
  const n = (v: number) => new Intl.NumberFormat('ar-EG').format(v);
  const a = data.accounts;
  return <>
    <div className="admin-stats">
      <div><span>كل الحسابات</span><b>{n(a.total)}</b></div>
      <div><span>مشتركين</span><b>{n(a.active)}</b></div>
      <div><span>في التجربة</span><b>{n(a.trial)}</b></div>
      <div><span>ينتظروا موافقة</span><b>{n(a.pending)}</b></div>
      <div><span>تجربتهم خلصت</span><b>{n(a.trial_expired + a.active_expired)}</b></div>
      <div><span>موقوفين</span><b>{n(a.suspended)}</b></div>
      <div><span>تسجيلات آخر ٧ أيام</span><b>{n(data.signups_7d)}</b></div>
      <div><span>تسجيلات آخر ٣٠ يوم</span><b>{n(data.signups_30d)}</b></div>
      <div><span>نشطين النهارده</span><b>{n(data.active_users_1d)}</b></div>
      <div><span>نشطين آخر ٧ أيام</span><b>{n(data.active_users_7d)}</b></div>
      <div><span>طلبات حجز (٧ أيام)</span><b>{n(data.booking_requests_7d)}</b></div>
      <div><span>حجوزات كلها</span><b>{n(data.totals.bookings)}</b></div>
    </div>
    <h2 className="admin-h2">الاستخدام (آخر ٧ أيام)</h2>
    {Object.keys(data.events_7d).length ? <ul className="admin-list">{Object.entries(data.events_7d).map(([k, v]) => <li key={k}><span dir="ltr">{k}</span><b>{n(v)}</b></li>)}</ul> : <p className="muted">لسه مفيش نشاط مسجل.</p>}
  </>;
}

function AccountsTab({ onForbidden }: { onForbidden: () => void }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState({ search: '', status: '' });
  const { data, error, reload } = useLoad(() => adminCall<AccountRow[]>('admin_list_accounts', { p_search: query.search, p_status: query.status || null, p_limit: 100, p_offset: 0 }), onForbidden, [query]);
  const [open, setOpen] = useState<AccountRow | null>(null);
  return <>
    <form className="admin-search" onSubmit={(e) => { e.preventDefault(); setQuery({ search, status }); }}>
      <input placeholder="ابحث بالإيميل أو الاسم أو الرقم أو اللينك" value={search} onChange={(e) => setSearch(e.target.value)}/>
      <select value={status} onChange={(e) => { setStatus(e.target.value); setQuery({ search, status: e.target.value }); }}><option value="">كل الحالات</option><option value="trial">تجربة</option><option value="active">مشترك</option><option value="pending">ينتظر موافقة</option><option value="suspended">موقوف</option></select>
      <button className="button button-outline button-small">بحث</button>
    </form>
    {error && <p className="security-error">{error}</p>}
    {!data ? <p>...</p> : !data.length ? <p className="muted">مفيش نتايج.</p> : <ul className="admin-accounts">{data.map((a) => { const s = statusLabel(a); return <li key={a.id}><button onClick={() => setOpen(a)}>
      <div><strong>{a.studio_name || a.display_name || a.email}</strong><small dir="ltr">{a.email}</small></div>
      <div className="admin-meta"><span className={`admin-badge ${s.tone}`}>{s.text}</span><small>{a.clients_count} عميل · {a.bookings_count} حجز · آخر دخول {fmtTime(a.last_seen_at)}</small></div>
    </button></li>; })}</ul>}
    {open && <AccountSheet account={open} onClose={() => setOpen(null)} onChanged={() => { setOpen(null); reload(); }} onForbidden={onForbidden}/>}
  </>;
}

function AccountSheet({ account, onClose, onChanged, onForbidden }: { account: AccountRow; onClose: () => void; onChanged: () => void; onForbidden: () => void }) {
  const [note, setNote] = useState(account.admin_note ?? '');
  const [paidUntil, setPaidUntil] = useState(account.paid_until ? account.paid_until.slice(0, 10) : '');
  const [plan, setPlan] = useState(account.plan === 'free' ? '' : account.plan);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const s = statusLabel(account);

  const run = async (name: string, params: Record<string, unknown>, done: string, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true); setMessage('');
    try { await adminCall(name, params); setMessage(done); onChanged(); }
    catch (e) { if (e instanceof ForbiddenError) onForbidden(); else setMessage('حصل خطأ: ' + (e instanceof Error ? e.message : '')); }
    finally { setBusy(false); }
  };
  const plusMonths = (months: number) => {
    const base = account.paid_until && new Date(account.paid_until) > new Date() ? new Date(account.paid_until) : new Date();
    base.setMonth(base.getMonth() + months);
    setPaidUntil(base.toISOString().slice(0, 10));
  };

  return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><div className="modal-card admin-sheet" role="dialog" aria-modal="true">
    <div className="modal-head"><div><h2>{account.studio_name || account.display_name || 'حساب'}</h2><p dir="ltr">{account.email}</p></div><button className="icon-button" onClick={onClose} aria-label="إغلاق">✕</button></div>
    <div className="admin-facts">
      <div><span>الحالة</span><b><i className={`admin-badge ${s.tone}`}>{s.text}</i></b></div>
      <div><span>التجربة تنتهي</span><b>{fmtDate(account.trial_ends_at)}</b></div>
      <div><span>الاشتراك لحد</span><b>{fmtDate(account.paid_until)}</b></div>
      <div><span>سجّل في</span><b>{fmtDate(account.created_at)}</b></div>
      <div><span>آخر دخول</span><b>{fmtTime(account.last_seen_at)}</b></div>
      <div><span>عملاء / حجوزات</span><b>{account.clients_count} / {account.bookings_count}</b></div>
      <div><span>طلبات الحجز</span><b>{account.requests_count}</b></div>
      <div><span>رقم المصور</span><b dir="ltr">{account.phone || '—'}</b></div>
    </div>
    <h3 className="admin-h3">تمديد التجربة</h3>
    <div className="admin-row">{[7, 14, 30].map((d) => <button key={d} className="button button-outline button-small" disabled={busy} onClick={() => void run('admin_extend_trial', { p_user: account.id, p_days: d }, 'تم التمديد.')}>+{d} يوم</button>)}</div>
    <h3 className="admin-h3">تفعيل اشتراك</h3>
    <div className="admin-row">{[1, 3, 12].map((m) => <button key={m} className="button button-quiet button-small" onClick={() => plusMonths(m)}>+{m === 12 ? 'سنة' : `${m} شهر`}</button>)}</div>
    <div className="form-two-col"><label className="field-label">ينتهي في<input type="date" value={paidUntil} onChange={(e) => setPaidUntil(e.target.value)}/></label><label className="field-label">الباقة<input value={plan} onChange={(e) => setPlan(e.target.value)} placeholder="مثال: شهري"/></label></div>
    <button className="button button-primary button-block" disabled={busy || !paidUntil} onClick={() => void run('admin_set_paid', { p_user: account.id, p_until: new Date(`${paidUntil}T23:59:59`).toISOString(), p_plan: plan.trim() || null }, 'تم تفعيل الاشتراك.')}>تفعيل الاشتراك</button>
    <h3 className="admin-h3">التحكم في الحساب</h3>
    <div className="admin-row">
      {account.status === 'pending' && <button className="button button-primary button-small" disabled={busy} onClick={() => void run('admin_set_status', { p_user: account.id, p_status: 'trial', p_reason: 'approved' }, 'تمت الموافقة.')}>وافق وابدأ التجربة</button>}
      {account.status === 'suspended'
        ? <button className="button button-primary button-small" disabled={busy} onClick={() => void run('admin_set_status', { p_user: account.id, p_status: account.paid_until && new Date(account.paid_until) > new Date() ? 'active' : 'trial', p_reason: 'unsuspended' }, 'تم إلغاء الإيقاف.')}>إلغاء الإيقاف</button>
        : <button className="button button-danger button-small" disabled={busy} onClick={() => void run('admin_set_status', { p_user: account.id, p_status: 'suspended', p_reason: 'manual' }, 'تم الإيقاف.', 'هيتقفل الحساب وبياناته فورًا وهيخرج من كل أجهزته. تكمل؟')}>إيقاف الحساب</button>}
    </div>
    <h3 className="admin-h3">ملاحظة (ليك بس)</h3>
    <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثال: دفع كاش بتاريخ..."/>
    <button className="button button-outline button-small" disabled={busy} onClick={() => void run('admin_set_note', { p_user: account.id, p_note: note }, 'اتحفظت الملاحظة.')}>حفظ الملاحظة</button>
    {message && <p className="admin-message" role="status">{message}</p>}
  </div></div>;
}

const actionLabel: Record<string, string> = { set_status: 'تغيير حالة', extend_trial: 'تمديد تجربة', set_paid: 'تفعيل اشتراك', set_note: 'ملاحظة', set_setting: 'تغيير إعداد' };
function LogTab({ onForbidden }: { onForbidden: () => void }) {
  const { data, error } = useLoad(() => adminCall<AuditRow[]>('admin_audit_list', { p_limit: 100 }), onForbidden);
  if (error) return <p className="security-error">{error}</p>;
  if (!data) return <p>...</p>;
  return data.length ? <ul className="admin-list">{data.map((r) => <li key={r.id}><span>{actionLabel[r.action] ?? r.action}<small dir="ltr">{JSON.stringify(r.details)}</small></span><small>{fmtTime(r.created_at)}</small></li>)}</ul> : <p className="muted">مفيش قرارات مسجلة لسه.</p>;
}

function SettingsTab({ onForbidden }: { onForbidden: () => void }) {
  const { data, error, reload } = useLoad(() => adminCall<Record<string, unknown>>('admin_get_settings'), onForbidden);
  const [days, setDays] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => { if (data) setDays(String(data.trial_days ?? 14)); }, [data]);
  const save = async (key: string, value: unknown) => {
    setMessage('');
    try { await adminCall('admin_set_setting', { p_key: key, p_value: value }); setMessage('اتحفظ.'); reload(); }
    catch (e) { if (e instanceof ForbiddenError) onForbidden(); else setMessage('قيمة غير صالحة.'); }
  };
  if (error) return <p className="security-error">{error}</p>;
  if (!data) return <p>...</p>;
  return <div className="admin-settings">
    <h2 className="admin-h2">الحسابات الجديدة</h2>
    <div className="admin-row"><button className={`button button-small ${data.default_status === 'trial' ? 'button-primary' : 'button-outline'}`} onClick={() => void save('default_status', 'trial')}>تجربة مجانية فورًا</button><button className={`button button-small ${data.default_status === 'pending' ? 'button-primary' : 'button-outline'}`} onClick={() => void save('default_status', 'pending')}>لازم موافقتي</button></div>
    <p className="muted">«لازم موافقتي» معناها أي حد يسجل بيستنى لحد ما توافق عليه من تبويب الحسابات.</p>
    <label className="field-label">مدة التجربة (أيام)<input type="number" min="1" max="365" value={days} onChange={(e) => setDays(e.target.value)}/></label>
    <button className="button button-outline button-small" onClick={() => void save('trial_days', Number(days))}>حفظ المدة</button>
    {message && <p className="admin-message" role="status">{message}</p>}
  </div>;
}
