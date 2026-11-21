import { describe, expect, it } from 'vitest';
import { checkPassword } from './password';
import { accessFromAccount, authErrorMessage } from './account';

describe('password policy', () => {
  it('accepts a strong password', () => expect(checkPassword('Lamsa#2026-ok', 'a@b.com').ok).toBe(true));
  it.each(['short1A!', 'alllowercase1!', 'ALLUPPERCASE1!', 'NoDigitsHere!!', 'NoSymbols12345A', '1234567890', 'Password123'])('rejects %s', (pw) => expect(checkPassword(pw).ok).toBe(false));
  it('rejects a password built from the email name', () => expect(checkPassword('peterelea#2026A', 'peterelea@gmail.com').ok).toBe(false));
});

describe('account access', () => {
  const now = Date.parse('2026-12-01T00:00:00Z');
  it('trial valid / ended', () => {
    expect(accessFromAccount({ status: 'trial', trialEndsAt: '2026-12-10T00:00:00Z', paidUntil: null }, now).allowed).toBe(true);
    expect(accessFromAccount({ status: 'trial', trialEndsAt: '2026-11-20T00:00:00Z', paidUntil: null }, now)).toEqual({ allowed: false, reason: 'trial-ended' });
  });
  it('active without end date, active expired, suspended, pending', () => {
    expect(accessFromAccount({ status: 'active', trialEndsAt: null, paidUntil: null }, now).allowed).toBe(true);
    expect(accessFromAccount({ status: 'active', trialEndsAt: null, paidUntil: '2026-11-01T00:00:00Z' }, now)).toEqual({ allowed: false, reason: 'subscription-ended' });
    expect(accessFromAccount({ status: 'suspended', trialEndsAt: null, paidUntil: null }, now)).toEqual({ allowed: false, reason: 'suspended' });
    expect(accessFromAccount({ status: 'pending', trialEndsAt: null, paidUntil: null }, now)).toEqual({ allowed: false, reason: 'pending' });
  });
  it('friendly Arabic messages for common sign-in errors', () => {
    expect(authErrorMessage({ message: 'Invalid login credentials' })).toContain('غلط');
    expect(authErrorMessage({ message: 'User already registered' })).toContain('متسجل');
    expect(authErrorMessage({ message: 'TypeError: Failed to fetch' })).toContain('النت');
  });
});
