import { useState, type FormEvent } from 'react';
import { CheckCircle2, Circle, Eye, EyeOff, LogIn, MailCheck, ShieldAlert, UserPlus } from 'lucide-react';
import { checkPassword } from '../lib/password';
import type { BlockReason } from '../lib/account';
import { BrandMark, SecurityCopyright } from './SecurityScreens';

function PasswordField({ label, value, onChange, autoComplete }: { label: string; value: string; onChange: (v: string) => void; autoComplete: string }) {
  const [shown, setShown] = useState(false);
  return <label className="field-label">{label}
    <span className="password-field">
      <input dir="ltr" type={shown ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} autoCapitalize="none" autoCorrect="off" spellCheck={false} required/>
      <button type="button" className="icon-button" onClick={() => setShown((v) => !v)} aria-label={shown ? 'إخفاء كلمة السر' : 'إظهار كلمة السر'}>{shown ? <EyeOff size={18}/> : <Eye size={18}/>}</button>
    </span>
  </label>;
}

function PasswordChecklist({ password, email }: { password: string; email: string }) {
  const { rules } = checkPassword(password, email);
  return <ul className="password-rules" aria-label="شروط كلمة السر">{rules.map((rule) => <li key={rule.id} className={rule.pass ? 'pass' : ''}>{rule.pass ? <CheckCircle2 size={15}/> : <Circle size={15}/>} {rule.label}</li>)}</ul>;
}

export function LoginScreen({ onSignIn, onSignUp, onReset }: {
  onSignIn: (email: string, password: string) => Promise<string | null>;
  onSignUp: (email: string, password: string, name: string) => Promise<{ error?: string; needsConfirm?: boolean }>;
  onReset: (email: string) => Promise<string | null>;
}) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(''); setNotice(''); setBusy(true);
    try {
      if (mode === 'login') { const result = await onSignIn(email, password); if (result) setError(result); }
      else {
        const result = await onSignUp(email, password, name);
        if (result.error) setError(result.error);
        else if (result.needsConfirm) setNotice('بعتنالك رسالة تأكيد على إيميلك. اضغط على اللينك اللي فيها وبعدين سجّل دخول.');
      }
    } finally { setBusy(false); }
  };
  const forgot = async () => {
    setError(''); setNotice('');
    if (!email.trim()) { setError('اكتب الإيميل الأول وبعدين اضغط «نسيت كلمة السر».'); return; }
    setBusy(true);
    const result = await onReset(email);
    setBusy(false);
    if (result) setError(result); else setNotice('لو الإيميل متسجل، هتوصلك رسالة فيها لينك لتغيير كلمة السر.');
  };
  const canSubmit = !busy && email.trim() && password && (mode === 'login' || (name.trim() && checkPassword(password, email).ok));

  return <main className="security-screen" dir="rtl">
    <section className="security-card">
      <BrandMark/>
      <div className="security-hero-icon">{mode === 'login' ? <LogIn size={27}/> : <UserPlus size={27}/>}</div>
      <h1>{mode === 'login' ? 'أهلًا بيك تاني' : 'ابدأ تجربتك المجانية'}</h1>
      <p className="security-description">{mode === 'login' ? 'سجّل دخولك وشغلك هيكون قدامك على أي جهاز.' : 'حساب واحد لشغلك كله، ومحفوظ ومش هيضيع لو الموبايل اتغير.'}</p>
      <div className="auth-tabs" role="tablist">
        <button role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError(''); setNotice(''); }}>دخول</button>
        <button role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'active' : ''} onClick={() => { setMode('signup'); setError(''); setNotice(''); }}>حساب جديد</button>
      </div>
      <form className="security-form" onSubmit={(event) => void submit(event)}>
        {mode === 'signup' && <label className="field-label">اسمك<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} required/></label>}
        <label className="field-label">الإيميل<input dir="ltr" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoCapitalize="none" required/></label>
        <PasswordField label="كلمة السر" value={password} onChange={setPassword} autoComplete={mode === 'login' ? 'current-password' : 'new-password'}/>
        {mode === 'signup' && <PasswordChecklist password={password} email={email}/>}
        {error && <p className="security-error" role="alert">{error}</p>}
        {notice && <p className="security-notice" role="status"><MailCheck size={16}/> {notice}</p>}
        <button className="button button-primary button-block security-submit" disabled={!canSubmit}>{busy ? 'ثواني...' : mode === 'login' ? 'دخول' : 'إنشاء الحساب'}</button>
        {mode === 'login' && <button type="button" className="button button-quiet button-block" onClick={() => void forgot()} disabled={busy}>نسيت كلمة السر؟</button>}
      </form>
      {mode === 'signup' && <p className="security-footnote">بإنشاء الحساب أنت بتوافق على <a href="/terms" target="_blank" rel="noopener noreferrer">شروط الاستخدام</a> و<a href="/privacy" target="_blank" rel="noopener noreferrer">سياسة الخصوصية</a>.</p>}
    </section>
    <SecurityCopyright/>
  </main>;
}

export function NewPasswordScreen({ onSave }: { onSave: (password: string) => Promise<string | null> }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setBusy(true);
    const result = await onSave(password);
    setBusy(false);
    if (result) setError(result);
  };
  return <main className="security-screen" dir="rtl">
    <section className="security-card">
      <BrandMark/>
      <h1>اختار كلمة سر جديدة</h1>
      <form className="security-form" onSubmit={(event) => void submit(event)}>
        <PasswordField label="كلمة السر الجديدة" value={password} onChange={setPassword} autoComplete="new-password"/>
        <PasswordChecklist password={password} email=""/>
        {error && <p className="security-error" role="alert">{error}</p>}
        <button className="button button-primary button-block security-submit" disabled={busy || !checkPassword(password).ok}>{busy ? 'ثواني...' : 'حفظ كلمة السر'}</button>
      </form>
    </section>
    <SecurityCopyright/>
  </main>;
}

export function AdoptScreen({ onChoose }: { onChoose: (keep: boolean) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const choose = async (keep: boolean) => {
    if (!keep && !window.confirm('هتتمسح بيانات الجهاز ده نهائيًا. متأكد؟')) return;
    setBusy(true); await onChoose(keep); setBusy(false);
  };
  return <main className="security-screen" dir="rtl">
    <section className="security-card">
      <BrandMark/>
      <h1>لقينا شغل قديم على الجهاز</h1>
      <p className="security-description">فيه عملاء وحجوزات متسجلين على الموبايل ده من قبل. تحب ننقلهم لحسابك الجديد؟</p>
      <div className="security-form">
        <button className="button button-primary button-block security-submit" disabled={busy} onClick={() => void choose(true)}>أيوه، انقل شغلي لحسابي</button>
        <button className="button button-quiet button-block" disabled={busy} onClick={() => void choose(false)}>لأ، ابدأ من الصفر وامسح القديم</button>
      </div>
    </section>
    <SecurityCopyright/>
  </main>;
}

const blockedCopy: Record<BlockReason, { title: string; body: string }> = {
  pending: { title: 'حسابك بيستنى الموافقة', body: 'اتسجل حسابك تمام. هنفعّله قريب وهتقدر تدخل. لو استعجلت كلّمنا.' },
  suspended: { title: 'الحساب متوقف', body: 'تم إيقاف حسابك مؤقتًا. تواصل مع الدعم عشان نساعدك.' },
  'trial-ended': { title: 'التجربة المجانية خلصت', body: 'شغلك محفوظ وماتمسحش. كلّمنا عشان نفعّل الاشتراك وترجع تكمل.' },
  'subscription-ended': { title: 'الاشتراك انتهى', body: 'شغلك محفوظ وماتمسحش. جدّد الاشتراك عشان ترجع تكمل.' },
  'offline-unverified': { title: 'محتاجين نتأكد من حسابك', body: 'اتصل بالإنترنت وجرّب تاني. مش هتتمسح أي بيانات.' }
};

export function BlockedScreen({ reason, email, onRetry, onSignOut }: { reason: BlockReason; email: string; onRetry: () => Promise<void>; onSignOut: () => Promise<void> }) {
  const copy = blockedCopy[reason];
  const support = import.meta.env.VITE_SUPPORT_WHATSAPP;
  const [busy, setBusy] = useState(false);
  return <main className="security-screen" dir="rtl">
    <section className="security-card">
      <BrandMark/>
      <div className="security-hero-icon"><ShieldAlert size={27}/></div>
      <h1>{copy.title}</h1>
      <p className="security-description">{copy.body}</p>
      {email && <p className="security-footnote" dir="ltr">{email}</p>}
      <div className="security-form">
        <button className="button button-primary button-block security-submit" disabled={busy} onClick={async () => { setBusy(true); await onRetry(); setBusy(false); }}>{busy ? 'ثواني...' : 'جرّب تاني'}</button>
        {support && <a className="button button-outline button-block" href={`https://wa.me/${support}`} target="_blank" rel="noopener noreferrer">كلّم الدعم على واتساب</a>}
        <button className="button button-quiet button-block" onClick={() => void onSignOut()}>تسجيل خروج</button>
      </div>
    </section>
    <SecurityCopyright/>
  </main>;
}

export function SetupNeededScreen() {
  return <main className="security-screen" dir="rtl">
    <section className="security-card">
      <BrandMark/>
      <div className="security-hero-icon"><ShieldAlert size={27}/></div>
      <h1>التطبيق محتاج إعداد السيرفر</h1>
      <p className="security-description">مفيش عنوان سيرفر متسجل في الإعدادات، فمش هيقدر يفتح حسابات. المنصة بتشتغل بحسابات المصورين من خلال الإدارة، من غير أكواد تفعيل.</p>
      <ol className="setup-steps">
        <li>اعمل مشروع على Supabase وشغّل ملفات SQL.</li>
        <li>اعمل ملف <code dir="ltr">.env.local</code> فيه <code dir="ltr">VITE_SUPABASE_URL</code> و<code dir="ltr">VITE_SUPABASE_ANON_KEY</code>.</li>
        <li>اقفل سيرفر التطوير وشغّله من تاني (<code dir="ltr">npm run dev</code>)، عشان القيم بتتقرا عند التشغيل بس.</li>
      </ol>
      <p className="security-footnote">التفاصيل في ملف <code dir="ltr">CLOUD-SETUP-AR.md</code>.</p>
    </section>
    <SecurityCopyright/>
  </main>;
}
