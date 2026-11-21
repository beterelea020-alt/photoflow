import { LICENSE_PUBLIC_KEY_SPKI_BASE64 } from './licensePublicKey';

export const INSTALL_ID_KEY = 'photoflow-install-id';
export const LICENSE_TOKEN_KEY = 'photoflow-license-token';
export const PIN_RECORD_KEY = 'photoflow-pin-record';
export const LICENSE_INFO_KEY = 'photoflow-license-info';

export interface LicensePayload {
  v: 1;
  licenseId: string;
  installId: string;
  customerName: string;
  issuedAt: string;
  expiresAt: string | null;
}

interface PinRecord {
  version: 1;
  salt: string;
  hash: string;
  iterations: number;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function getOrCreateInstallId(): string {
  const current = localStorage.getItem(INSTALL_ID_KEY);
  if (current && /^[a-f0-9-]{20,}$/i.test(current)) return current;
  const next = crypto.randomUUID();
  localStorage.setItem(INSTALL_ID_KEY, next);
  return next;
}

export async function verifyLicenseToken(token: string, expectedInstallId: string): Promise<{ valid: boolean; payload?: LicensePayload; reason?: string }> {
  try {
    const [payloadPart, signaturePart, extra] = token.trim().split('.');
    if (!payloadPart || !signaturePart || extra) return { valid: false, reason: 'صيغة رمز التفعيل غير صحيحة.' };

    const payloadBytes = fromBase64Url(payloadPart);
    const signature = fromBase64Url(signaturePart);
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as LicensePayload;
    if (payload.v !== 1 || !payload.licenseId || !payload.installId || !payload.issuedAt || !('expiresAt' in payload)) {
      return { valid: false, reason: 'بيانات رمز التفعيل غير مكتملة.' };
    }
    if (payload.installId !== expectedInstallId) return { valid: false, reason: 'رمز التفعيل صادر لجهاز آخر.' };
    if (payload.expiresAt && Date.now() > new Date(payload.expiresAt).getTime()) return { valid: false, reason: 'انتهت مدة التفعيل. تواصل مع المطور لتجديده.' };

    const publicKeyBytes = Uint8Array.from(atob(LICENSE_PUBLIC_KEY_SPKI_BASE64), (char) => char.charCodeAt(0));
    const publicKey = await crypto.subtle.importKey(
      'spki',
      publicKeyBytes,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      signature,
      new TextEncoder().encode(payloadPart)
    );
    return valid ? { valid: true, payload } : { valid: false, reason: 'رمز التفعيل غير معتمد.' };
  } catch {
    return { valid: false, reason: 'تعذر قراءة رمز التفعيل. راجع الرمز وحاول مرة أخرى.' };
  }
}

function derivePin(pin: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<ArrayBuffer> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
    .then((key) => crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256));
}

export async function savePin(pin: string): Promise<void> {
  if (!/^\d{4}$/.test(pin)) throw new Error('رمز القفل يجب أن يتكون من أربعة أرقام.');
  const iterations = 210_000;
  const salt = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)));
  const hash = new Uint8Array(await derivePin(pin, salt, iterations));
  const record: PinRecord = { version: 1, salt: toBase64Url(salt), hash: toBase64Url(hash), iterations };
  localStorage.setItem(PIN_RECORD_KEY, JSON.stringify(record));
}

export async function verifyPin(pin: string): Promise<boolean> {
  try {
    const stored = localStorage.getItem(PIN_RECORD_KEY);
    if (!stored || !/^\d{4}$/.test(pin)) return false;
    const record = JSON.parse(stored) as PinRecord;
    if (record.version !== 1 || !record.salt || !record.hash || !record.iterations) return false;
    const expected = fromBase64Url(record.hash);
    const actual = new Uint8Array(await derivePin(pin, fromBase64Url(record.salt), record.iterations));
    if (expected.length !== actual.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i += 1) diff |= expected[i] ^ actual[i];
    return diff === 0;
  } catch {
    return false;
  }
}

export function hasPin(): boolean {
  return Boolean(localStorage.getItem(PIN_RECORD_KEY));
}

export function clearActivation(): void {
  localStorage.removeItem(LICENSE_TOKEN_KEY);
  localStorage.removeItem(LICENSE_INFO_KEY);
  localStorage.removeItem(PIN_RECORD_KEY);
  localStorage.removeItem('photoflow-pin-failures');
  localStorage.removeItem('photoflow-pin-locked-until');
}
