import { useEffect, useState, type FormEvent } from 'react';
import { Aperture, Copy, KeyRound, LockKeyhole, ShieldCheck } from 'lucide-react';

export function BrandMark() {
  return <div className="security-brand"><div className="brand-mark"><Aperture size={24}/></div><div><strong>PhotoFlow</strong><span>مساعد المصور</span></div></div>;
}

export function SecurityCopyright() {
  return <footer className="security-copyright">جميع الحقوق محفوظة © 2026 — <a href="https://peter-elia-cv.vercel.app/" target="_blank" rel="noopener noreferrer">Peter Elia</a></footer>;
}

export function ActivationScreen({ installId, onActivate, initialError }: { installId: string; onActivate: (code: string) => Promise<string | null>; initialError?: string }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError || '');
  const [copied, setCopied] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    const result = await onActivate(code.trim());
    setBusy(false);
    if (result) setError(result);
  };
  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(installId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch { setError('تعذر نسخ رمز التثبيت. حدده وانسخه يدويًا.'); }
  };
  return <main className="security-screen" dir="rtl">
    <section className="security-card activation-card">
      <BrandMark/>
      <div className="security-hero-icon"><KeyRound size={27}/></div>
      <h1>تفعيل PhotoFlow</h1>
      <p className="security-description">أدخل رمز التفعيل المخصص لهذا التثبيت لبدء استخدام التطبيق.</p>
      <div className="device-code-box">
        <div><span>رمز التثبيت</span><small>أرسل هذا الرمز للمطور للحصول على رمز التفعيل.</small></div>
        <code dir="ltr">{installId}</code>
        <button type="button" className="button button-outline button-small" onClick={() => void copyId()}><Copy size={14}/>{copied ? 'تم النسخ' : 'نسخ الرمز'}</button>
      </div>
      <form onSubmit={(event) => void submit(event)} className="security-form">
        <label className="field-label">رمز التفعيل<textarea value={code} onChange={(event) => setCode(event.target.value)} placeholder="الصق رمز التفعيل هنا" rows={3} spellCheck={false} autoCapitalize="off" autoCorrect="off" required/></label>
        {error && <p className="security-error" role="alert">{error}</p>}
        <button className="button button-primary button-block security-submit" disabled={busy || !code.trim()}>{busy ? 'جارٍ التحقق...' : 'تفعيل التطبيق'}</button>
      </form>
      <div className="security-footnote"><ShieldCheck size={15}/> رمز التفعيل صالح لهذا التثبيت فقط.</div>
    </section>
    <SecurityCopyright/>
  </main>;
}

export function PinSetupScreen({ onSave }: { onSave: (pin: string) => Promise<void> }) {
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (!/^\d{4}$/.test(pin)) return setError('اكتب أربعة أرقام بالضبط.');
    if (pin !== confirm) return setError('الرقمان غير متطابقين. حاول مرة أخرى.');
    setBusy(true);
    try { await onSave(pin); } catch { setError('تعذر حفظ رمز القفل. حاول مرة أخرى.'); }
    setBusy(false);
  };
  return <main className="security-screen" dir="rtl">
    <section className="security-card">
      <BrandMark/>
      <div className="security-hero-icon"><LockKeyhole size={27}/></div>
      <h1>أنشئ رمز قفل خاصًا بك</h1>
      <p className="security-description">اختار أربعة أرقام. سيطلبها التطبيق عند فتحه وبعد فترة من عدم الاستخدام.</p>
      <form onSubmit={(event) => void submit(event)} className="security-form">
        <label className="field-label">رمز القفل<input className="pin-input" inputMode="numeric" autoComplete="new-password" type="password" pattern="[0-9]*" maxLength={4} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="••••"/></label>
        <label className="field-label">تأكيد رمز القفل<input className="pin-input" inputMode="numeric" autoComplete="new-password" type="password" pattern="[0-9]*" maxLength={4} value={confirm} onChange={(event) => setConfirm(event.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="••••"/></label>
        {error && <p className="security-error" role="alert">{error}</p>}
        <button className="button button-primary button-block security-submit" disabled={busy || pin.length !== 4 || confirm.length !== 4}>{busy ? 'جارٍ الحفظ...' : 'حفظ رمز القفل'}</button>
      </form>
      <div className="security-footnote"><ShieldCheck size={15}/> لا تحفظ رمزك في مكان ظاهر للآخرين.</div>
    </section>
    <SecurityCopyright/>
  </main>;
}

export function PinLockScreen({ onUnlock, onRecover }: { onUnlock: (pin: string) => Promise<boolean>; onRecover: () => void }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [tries, setTries] = useState(() => Number(localStorage.getItem('photoflow-pin-failures') || '0'));
  const [lockedUntil, setLockedUntil] = useState(() => Number(localStorage.getItem('photoflow-pin-locked-until') || '0'));
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!lockedUntil) return;
    const timer = window.setInterval(() => { const current = Date.now(); setNow(current); if (current >= lockedUntil) { setLockedUntil(0); localStorage.removeItem('photoflow-pin-locked-until'); setError(''); } }, 500);
    return () => window.clearInterval(timer);
  }, [lockedUntil]);
  const remaining = Math.max(0, Math.ceil((lockedUntil - now) / 1000));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (remaining > 0 || pin.length !== 4) return;
    setBusy(true);
    const valid = await onUnlock(pin);
    setBusy(false);
    if (valid) { localStorage.removeItem('photoflow-pin-failures'); localStorage.removeItem('photoflow-pin-locked-until'); return; }
    const nextTries = tries + 1;
    setTries(nextTries);
    localStorage.setItem('photoflow-pin-failures', String(nextTries));
    setPin('');
    if (nextTries >= 5) {
      const nextLock = Date.now() + 30_000;
      setLockedUntil(nextLock);
      localStorage.setItem('photoflow-pin-locked-until', String(nextLock));
      setTries(0);
      localStorage.removeItem('photoflow-pin-failures');
      setError('تم إيقاف المحاولة مؤقتًا لمدة 30 ثانية.');
    } else {
      setError(`الرمز غير صحيح. المحاولات المتبقية: ${5 - nextTries}.`);
    }
  };
  return <main className="security-screen" dir="rtl">
    <section className="security-card pin-lock-card">
      <BrandMark/>
      <div className="security-hero-icon"><LockKeyhole size={27}/></div>
      <h1>التطبيق مقفول</h1>
      <p className="security-description">أدخل رمز القفل المكوّن من أربعة أرقام للمتابعة.</p>
      <form onSubmit={(event) => void submit(event)} className="security-form">
        <label className="field-label">رمز القفل<input className="pin-input" inputMode="numeric" autoComplete="current-password" type="password" pattern="[0-9]*" maxLength={4} autoFocus value={pin} onChange={(event) => { setPin(event.target.value.replace(/\D/g, '').slice(0, 4)); setError(''); }} placeholder="••••"/></label>
        {error && <p className="security-error" role="alert">{error}</p>}
        {remaining > 0 && <p className="security-wait">يمكنك المحاولة بعد {remaining} ثانية.</p>}
        <button className="button button-primary button-block security-submit" disabled={busy || remaining > 0 || pin.length !== 4}>{busy ? 'جارٍ الفتح...' : 'فتح التطبيق'}</button>
      </form>
      <button type="button" className="security-recover-button" onClick={() => { if (window.confirm('سيتم طلب رمز تفعيل جديد من المطور لإعادة إعداد رمز القفل. بياناتك المحفوظة لن تُمسح. هل تريد المتابعة؟')) onRecover(); }}>نسيت رمز القفل؟ إعادة التفعيل</button>
      <div className="security-footnote"><ShieldCheck size={15}/> بياناتك تظل محفوظة على هذا الجهاز.</div>
    </section>
    <SecurityCopyright/>
  </main>;
}

export function PinSettings({ onToast }: { onToast: (title: string, body?: string) => void }) {
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage('');
    if (!/^\d{4}$/.test(newPin) || newPin !== confirmPin) return setMessage('تأكد من إدخال نفس الرمز الجديد المكوّن من أربعة أرقام.');
    setBusy(true);
    try {
      const { verifyPin, savePin } = await import('../lib/security');
      if (!(await verifyPin(currentPin))) {
        setMessage('رمز القفل الحالي غير صحيح.');
      } else {
        await savePin(newPin);
        setCurrentPin(''); setNewPin(''); setConfirmPin('');
        onToast('تم تغيير رمز القفل');
      }
    } catch { setMessage('تعذر تغيير رمز القفل. حاول مرة أخرى.'); }
    setBusy(false);
  };
  return <form className="pin-settings-form" onSubmit={(event) => void submit(event)}>
    <label className="field-label">رمز القفل الحالي<input dir="ltr" inputMode="numeric" type="password" maxLength={4} value={currentPin} onChange={(event) => setCurrentPin(event.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="••••"/></label>
    <div className="settings-form-grid pin-settings-grid">
      <label className="field-label">الرمز الجديد<input dir="ltr" inputMode="numeric" type="password" maxLength={4} value={newPin} onChange={(event) => setNewPin(event.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="••••"/></label>
      <label className="field-label">تأكيد الرمز الجديد<input dir="ltr" inputMode="numeric" type="password" maxLength={4} value={confirmPin} onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="••••"/></label>
    </div>
    {message && <p className="security-error settings-inline-error">{message}</p>}
    <button className="button button-outline button-small" disabled={busy || currentPin.length !== 4 || newPin.length !== 4 || confirmPin.length !== 4}>{busy ? 'جارٍ التغيير...' : 'تغيير رمز القفل'}</button>
  </form>;
}
