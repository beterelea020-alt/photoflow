import { useCallback, useEffect, useRef, useState } from 'react';
import { clearPinData, hasLocalWork, OWNER_KEY, resetLocalData } from '../lib/localData';
import { cloudConfigured, readStoredUser, supabase } from '../lib/supabase';
import { ACCOUNT_CACHE_KEY, accessFromAccount, authErrorMessage, clearCachedAccount, readCachedAccount, writeCachedAccount, type AccountInfo, type BlockReason } from '../lib/account';
import { checkPassword } from '../lib/password';
import { pendingChanges, startSync, stopSync, syncNow } from '../db/syncRuntime';
import {
  getOrCreateInstallId,
  hasPin,
  clearActivation,
  LICENSE_INFO_KEY,
  LICENSE_TOKEN_KEY,
  savePin,
  verifyLicenseToken,
  verifyPin
} from '../lib/security';

type AccessStage = 'checking' | 'setup-needed' | 'activation' | 'login' | 'recovery' | 'adopt' | 'blocked' | 'pin-setup' | 'locked' | 'ready';

function useLicenseAccess(enabled: boolean) {
  const [stage, setStage] = useState<AccessStage>('checking');
  const [installId, setInstallId] = useState('');
  const [licenseMessage, setLicenseMessage] = useState('');

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const initialize = async () => {
      const id = getOrCreateInstallId();
      if (cancelled) return;
      setInstallId(id);
      const token = localStorage.getItem(LICENSE_TOKEN_KEY);
      if (!token) {
        setStage('activation');
        return;
      }
      const result = await verifyLicenseToken(token, id);
      if (cancelled) return;
      if (!result.valid) {
        setLicenseMessage(result.reason || 'التفعيل يحتاج إلى مراجعة.');
        setStage('activation');
        return;
      }
      setStage(hasPin() ? 'locked' : 'pin-setup');
    };
    void initialize();
    return () => { cancelled = true; };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || stage !== 'ready' || !installId) return;
    const checkLicense = async () => {
      const token = localStorage.getItem(LICENSE_TOKEN_KEY);
      if (!token) { setLicenseMessage('التفعيل غير موجود. أدخل رمز تفعيل جديدًا للمتابعة.'); setStage('activation'); return; }
      const result = await verifyLicenseToken(token, installId);
      if (!result.valid) { setLicenseMessage(result.reason || 'انتهت صلاحية التفعيل.'); setStage('activation'); }
    };
    const timer = window.setInterval(() => { void checkLicense(); }, 60 * 1000);
    return () => window.clearInterval(timer);
  }, [enabled, stage, installId]);

  const activate = async (code: string): Promise<string | null> => {
    const result = await verifyLicenseToken(code, installId);
    if (!result.valid || !result.payload) {
      const reason = result.reason || 'رمز التفعيل غير صحيح.';
      setLicenseMessage(reason);
      return reason;
    }
    localStorage.setItem(LICENSE_TOKEN_KEY, code.trim());
    localStorage.setItem(LICENSE_INFO_KEY, JSON.stringify({
      licenseId: result.payload.licenseId,
      customerName: result.payload.customerName,
      issuedAt: result.payload.issuedAt,
      expiresAt: result.payload.expiresAt
    }));
    setLicenseMessage('');
    setStage('pin-setup');
    return null;
  };

  const setupPin = async (pin: string) => {
    await savePin(pin);
    setStage('ready');
  };

  const unlock = async (pin: string): Promise<boolean> => {
    const valid = await verifyPin(pin);
    if (valid) setStage('ready');
    return valid;
  };

  const lock = () => setStage('locked');
  const recover = () => {
    clearActivation();
    setLicenseMessage('أعد إرسال رمز الجهاز للمطور للحصول على تفعيل جديد وإعادة ضبط رمز القفل.');
    setStage('activation');
  };

  return { stage, installId, licenseMessage, activate, setupPin, unlock, lock, recover };
}

export type AccessApi = ReturnType<typeof useAccessControl>;

const isNetworkProblem = (error: { message?: string } | null | undefined) => !navigator.onLine || /failed to fetch|network|load failed|fetch/i.test(error?.message ?? '');

function useCloudAccess(enabled: boolean) {
  const [stage, setStage] = useState<AccessStage>('checking');
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [blockReason, setBlockReason] = useState<BlockReason | null>(null);
  const [localWorkExists, setLocalWorkExists] = useState(false);
  const userRef = useRef<{ id: string; email: string } | null>(null);

  const loadAccount = useCallback(async (user: { id: string; email: string }): Promise<AccountInfo | null> => {
    if (!supabase) return null;
    try {
      const { data, error } = await supabase.from('profiles').select('id, display_name, studio_name, phone, slug, status, trial_ends_at, paid_until, booking_page_enabled, booking_page_note, packages').eq('id', user.id).single();
      if (error) throw error;
      const info: AccountInfo = { id: data.id, email: user.email, status: data.status, trialEndsAt: data.trial_ends_at, paidUntil: data.paid_until, displayName: data.display_name ?? '', studioName: data.studio_name ?? '', phone: data.phone ?? '', slug: data.slug, bookingPageEnabled: Boolean(data.booking_page_enabled), bookingPageNote: data.booking_page_note ?? '', packages: Array.isArray(data.packages) ? data.packages : [], checkedAt: new Date().toISOString() };
      writeCachedAccount(info);
      return info;
    } catch (error) {
      // No connection: trust what the server told us recently, but not forever.
      if (isNetworkProblem(error as { message?: string })) return readCachedAccount(user.id);
      return null;
    }
  }, []);

  const enter = useCallback(async (user: { id: string; email: string }) => {
    userRef.current = user;
    const info = await loadAccount(user);
    if (!info) { setBlockReason('offline-unverified'); setStage('blocked'); return; }
    setAccount(info);
    const verdict = accessFromAccount(info);
    if (!verdict.allowed) { setBlockReason(verdict.reason); setStage('blocked'); return; }
    const owner = localStorage.getItem(OWNER_KEY);
    if (owner && owner !== user.id) { await resetLocalData(); clearPinData(); localStorage.removeItem(OWNER_KEY); }
    if (!localStorage.getItem(OWNER_KEY)) {
      if (await hasLocalWork()) { setLocalWorkExists(true); setStage('adopt'); return; }
      localStorage.setItem(OWNER_KEY, user.id);
    }
    setStage(hasPin() ? 'locked' : 'pin-setup');
  }, [loadAccount]);

  useEffect(() => {
    if (!enabled || !supabase) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      const user = data.session?.user ? { id: data.session.user.id, email: data.session.user.email ?? '' } : readStoredUser();
      if (!user) { setStage('login'); return; }
      await enter(user);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') { setAccount(null); setStage('login'); }
      if (event === 'PASSWORD_RECOVERY') setStage('recovery');
    });
    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, [enabled, enter]);

  // Background sync runs while the account is allowed and the phone belongs to this user.
  useEffect(() => {
    if (!enabled || !supabase || !userRef.current) return;
    if (stage === 'pin-setup' || stage === 'locked' || stage === 'ready') startSync(supabase, userRef.current.id);
    else stopSync();
    return () => { stopSync(); };
  }, [enabled, stage]);

  // Suspension / expiry take effect while the app is open: re-check with the server every few minutes and by the clock every minute.
  useEffect(() => {
    if (!enabled || (stage !== 'ready' && stage !== 'locked')) return;
    const verify = async () => { const user = userRef.current; if (user && navigator.onLine) await enter(user).catch(() => undefined); };
    const byClock = () => {
      try {
        const cached = JSON.parse(localStorage.getItem(ACCOUNT_CACHE_KEY) || 'null') as AccountInfo | null;
        const verdict = cached ? accessFromAccount(cached) : null;
        if (verdict && !verdict.allowed) { setBlockReason(verdict.reason); setStage('blocked'); }
      } catch { /* ignore */ }
    };
    const serverTimer = window.setInterval(() => void verify(), 5 * 60 * 1000);
    const clockTimer = window.setInterval(byClock, 60 * 1000);
    return () => { window.clearInterval(serverTimer); window.clearInterval(clockTimer); };
  }, [enabled, stage, enter]);

  const signIn = async (email: string, password: string): Promise<string | null> => {
    if (!supabase) return 'الخدمة مش متاحة دلوقتي.';
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error || !data.user) return authErrorMessage(error);
    await enter({ id: data.user.id, email: data.user.email ?? email });
    return null;
  };

  const signUp = async (email: string, password: string, displayName: string): Promise<{ error?: string; needsConfirm?: boolean }> => {
    if (!supabase) return { error: 'الخدمة مش متاحة دلوقتي.' };
    if (!checkPassword(password, email).ok) return { error: 'كلمة السر لازم تحقق كل الشروط اللي تحت.' };
    const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { data: { display_name: displayName.trim() }, emailRedirectTo: window.location.origin } });
    if (error) return { error: authErrorMessage(error) };
    if (data.session?.user) { await enter({ id: data.session.user.id, email: data.session.user.email ?? email }); return {}; }
    return { needsConfirm: true };
  };

  const resetPassword = async (email: string): Promise<string | null> => {
    if (!supabase) return 'الخدمة مش متاحة دلوقتي.';
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
    return error ? authErrorMessage(error) : null;
  };

  const setNewPassword = async (password: string): Promise<string | null> => {
    if (!supabase) return 'الخدمة مش متاحة دلوقتي.';
    if (!checkPassword(password, userRef.current?.email ?? '').ok) return 'كلمة السر لازم تحقق كل الشروط اللي تحت.';
    const { data, error } = await supabase.auth.updateUser({ password });
    if (error || !data.user) return authErrorMessage(error);
    await enter({ id: data.user.id, email: data.user.email ?? '' });
    return null;
  };

  const adoptLocal = async (keep: boolean) => {
    const user = userRef.current;
    if (!user) return;
    if (!keep) await resetLocalData();
    localStorage.setItem(OWNER_KEY, user.id);
    setStage(hasPin() ? 'locked' : 'pin-setup');
  };

  /** Uploads what is pending first; if something could not be uploaded, asks before wiping the phone. */
  const signOut = async (force = false): Promise<{ ok: boolean; pending: number }> => {
    try { await syncNow(); } catch { /* offline */ }
    const pending = await pendingChanges();
    if (pending > 0 && !force) return { ok: false, pending };
    stopSync();
    await supabase?.auth.signOut();
    await resetLocalData();
    clearCachedAccount();
    clearPinData();
    localStorage.removeItem(OWNER_KEY);
    userRef.current = null;
    setAccount(null);
    setStage('login');
    return { ok: true, pending: 0 };
  };

  const retry = async () => { const user = userRef.current ?? readStoredUser(); if (user) await enter(user); else setStage('login'); };
  const setupPin = async (pin: string) => { await savePin(pin); setStage('ready'); };
  const unlock = async (pin: string): Promise<boolean> => { const valid = await verifyPin(pin); if (valid) setStage('ready'); return valid; };
  const lock = () => setStage('locked');
  // Forgot the PIN: the only safe way back in is the account password, so sign out (after uploading) and sign in again.
  const recover = async () => {
    const result = await signOut(false);
    if (!result.ok && window.confirm(`فيه ${result.pending} تغيير لسه ماتحفظش على السيرفر ومش هنقدر نرفعهم دلوقتي. لو كملت هتضيع. تكمل؟`)) await signOut(true);
  };

  return { stage, account, blockReason, localWorkExists, signIn, signUp, resetPassword, setNewPassword, adoptLocal, signOut, retry, setupPin, unlock, lock, recover };
}

/** The old activation-code mode is off unless explicitly allowed; without a server address the app says what is missing instead. */
const licenseModeAllowed = import.meta.env.VITE_ALLOW_LICENSE_MODE === 'true';

export function useAccessControl() {
  const license = useLicenseAccess(!cloudConfigured && licenseModeAllowed);
  const cloud = useCloudAccess(cloudConfigured);
  const none = {
    account: null as AccountInfo | null,
    blockReason: null as BlockReason | null,
    localWorkExists: false,
    signIn: async (_email: string, _password: string): Promise<string | null> => null,
    signUp: async (_email: string, _password: string, _name: string): Promise<{ error?: string; needsConfirm?: boolean }> => ({}),
    resetPassword: async (_email: string): Promise<string | null> => null,
    setNewPassword: async (_password: string): Promise<string | null> => null,
    adoptLocal: async (_keep: boolean) => undefined,
    signOut: async (_force?: boolean): Promise<{ ok: boolean; pending: number }> => ({ ok: true, pending: 0 }),
    retry: async () => undefined
  };
  if (!cloudConfigured && !licenseModeAllowed) return { mode: 'setup' as const, ...none, ...license, stage: 'setup-needed' as AccessStage };
  if (cloudConfigured) return { mode: 'cloud' as const, installId: '', licenseMessage: '', activate: async (_code: string): Promise<string | null> => null, ...cloud };
  return { mode: 'license' as const, ...none, ...license };
}
