export type AccountStatus = 'pending' | 'trial' | 'active' | 'suspended';
export type BlockReason = 'pending' | 'suspended' | 'trial-ended' | 'subscription-ended' | 'offline-unverified';

export interface AccountInfo {
  id: string;
  email: string;
  status: AccountStatus;
  trialEndsAt: string | null;
  paidUntil: string | null;
  displayName: string;
  studioName: string;
  phone: string;
  slug: string | null;
  bookingPageEnabled: boolean;
  bookingPageNote: string;
  packages: unknown[];
  checkedAt: string; // when the server last confirmed this
}

/** Same rule as public.is_account_active() on the server. */
export function accessFromAccount(info: Pick<AccountInfo, 'status' | 'trialEndsAt' | 'paidUntil'>, now = Date.now()): { allowed: true } | { allowed: false; reason: BlockReason } {
  if (info.status === 'suspended') return { allowed: false, reason: 'suspended' };
  if (info.status === 'pending') return { allowed: false, reason: 'pending' };
  if (info.status === 'trial') return info.trialEndsAt && new Date(info.trialEndsAt).getTime() > now ? { allowed: true } : { allowed: false, reason: 'trial-ended' };
  if (info.status === 'active') return !info.paidUntil || new Date(info.paidUntil).getTime() > now ? { allowed: true } : { allowed: false, reason: 'subscription-ended' };
  return { allowed: false, reason: 'pending' };
}

export const OFFLINE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
export const ACCOUNT_CACHE_KEY = 'pf-account';

export function readCachedAccount(userId: string, now = Date.now()): AccountInfo | null {
  try {
    const cached = JSON.parse(localStorage.getItem(ACCOUNT_CACHE_KEY) || 'null') as AccountInfo | null;
    if (!cached || cached.id !== userId) return null;
    if (now - new Date(cached.checkedAt).getTime() > OFFLINE_GRACE_MS) return null; // too long since the server confirmed it
    return cached;
  } catch { return null; }
}
export const writeCachedAccount = (info: AccountInfo) => localStorage.setItem(ACCOUNT_CACHE_KEY, JSON.stringify(info));
export const clearCachedAccount = () => localStorage.removeItem(ACCOUNT_CACHE_KEY);

export function authErrorMessage(error: { message?: string; code?: string; status?: number } | null | undefined): string {
  const text = `${error?.code ?? ''} ${error?.message ?? ''}`.toLowerCase();
  if (text.includes('invalid login') || text.includes('invalid_credentials')) return 'الإيميل أو كلمة السر غلط.';
  if (text.includes('already registered') || text.includes('user_already_exists')) return 'الإيميل ده متسجل قبل كده. جرّب تسجيل الدخول.';
  if (text.includes('email not confirmed') || text.includes('email_not_confirmed')) return 'لازم تأكد الإيميل الأول. شوف رسالة التأكيد في بريدك.';
  if (text.includes('weak_password') || text.includes('password should')) return 'كلمة السر ضعيفة. اتبع الشروط اللي تحت.';
  if (text.includes('rate limit') || text.includes('over_email_send_rate_limit') || text.includes('too many') || error?.status === 429) return 'محاولات كتير. استنى شوية وجرّب تاني.';
  if (text.includes('failed to fetch') || text.includes('network') || text.includes('load failed')) return 'مفيش اتصال بالإنترنت. اتأكد من النت وجرّب تاني.';
  if (text.includes('database error saving new user')) return 'تعذر إنشاء الحساب دلوقتي. جرّب بعد شوية أو كلّم الدعم.';
  return 'حصلت مشكلة. جرّب تاني بعد شوية.';
}
