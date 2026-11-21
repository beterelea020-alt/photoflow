export interface PasswordRule { id: string; label: string; pass: boolean }

const COMMON = ['1234567890', 'password123', 'qwerty12345', '0123456789', 'photoflow123', 'iloveyou123', '1234512345', 'password1234'];

/** Same policy that is switched on in the Supabase dashboard: 10+ characters with every character type. */
export function checkPassword(password: string, email = ''): { ok: boolean; rules: PasswordRule[] } {
  const lower = password.toLowerCase();
  const local = email.split('@')[0]?.toLowerCase() ?? '';
  const rules: PasswordRule[] = [
    { id: 'length', label: '١٠ حروف أو أكتر', pass: password.length >= 10 },
    { id: 'lower', label: 'حرف إنجليزي صغير (a-z)', pass: /[a-z]/.test(password) },
    { id: 'upper', label: 'حرف إنجليزي كبير (A-Z)', pass: /[A-Z]/.test(password) },
    { id: 'digit', label: 'رقم', pass: /\d/.test(password) },
    { id: 'symbol', label: 'رمز زي ! @ # $ %', pass: /[^A-Za-z0-9\s]/.test(password) },
    { id: 'common', label: 'مش كلمة سر مشهورة ولا جزء من الإيميل', pass: password.length > 0 && !COMMON.includes(lower) && !(local.length >= 4 && lower.includes(local)) }
  ];
  return { ok: rules.every((rule) => rule.pass), rules };
}
