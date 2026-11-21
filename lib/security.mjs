// Konfiguracja bezpieczeństwa (etap P0 planu: docs/bezpieczenstwo/plan-zabezpieczen.md).
//   KK_PUBLIC_ORIGIN   – publiczny adres aplikacji, w produkcji wymagany i tylko https:// (np. https://kompas.urzad.gov.pl)
//   KK_TRUSTED_PROXY   – adresy IP zaufanych reverse proxy (po przecinku); tylko od nich czytamy X-Forwarded-For
//   KK_SIGN_KEY        – klucz podpisów mock (min. 32 znaki); w produkcji wymagany, lokalnie plik data/sign.key
//   KK_AUDIT_KEY       – klucz HMAC dziennika zdarzeń (min. 32 znaki); w produkcji wymagany, lokalnie plik data/audit.key
//   KK_AUDIT_MIGRATE=1 – w produkcji: jednorazowe opieczętowanie HMAC wpisów dziennika sprzed migracji
const MIN_KEY = 32;

export function securityConfig(env = process.env) {
  const prod = env.KK_MODE === 'production';
  const publicOrigin = String(env.KK_PUBLIC_ORIGIN || '').trim().replace(/\/+$/, '');
  const trustedProxies = new Set(String(env.KK_TRUSTED_PROXY || '').split(',').map(s => normIp(s.trim())).filter(Boolean));
  const key = name => {
    const v = String(env[name] || '').trim();
    if (v && v.length < MIN_KEY) throw new Error(`${name} musi mieć co najmniej ${MIN_KEY} znaki.`);
    if (prod && !v) throw new Error(`Tryb produkcyjny wymaga zmiennej ${name} (klucz spoza katalogu danych, min. ${MIN_KEY} znaki).`);
    return v || null;
  };
  if (publicOrigin && !/^https?:\/\/[^/\s]+$/.test(publicOrigin)) throw new Error('KK_PUBLIC_ORIGIN: podaj sam adres, np. https://kompas.urzad.gov.pl');
  if (prod && !publicOrigin.startsWith('https://')) throw new Error('Tryb produkcyjny wymaga KK_PUBLIC_ORIGIN z adresem https://');
  const signKey = key('KK_SIGN_KEY'), auditKey = key('KK_AUDIT_KEY');
  if (signKey && auditKey && signKey === auditKey) throw new Error('KK_SIGN_KEY i KK_AUDIT_KEY muszą być różne.');
  return {
    prod, publicOrigin: publicOrigin || null, trustedProxies, signKey, auditKey,
    auditMigrate: !prod || env.KK_AUDIT_MIGRATE === '1',
    // __Host-: przeglądarka przyjmie cookie tylko z Secure, Path=/ i bez Domain (nie ustawi go poddomena)
    cookieName: prod ? '__Host-kk_sid' : 'kk_sid',
    cookieFlags: `HttpOnly; SameSite=Strict; Path=/${prod ? '; Secure' : ''}`,
  };
}

export const normIp = ip => String(ip || '').replace(/^::ffff:/, '');

// Adres klienta: X-Forwarded-For czytamy tylko, gdy połączenie przyszło od zaufanego proxy.
// Bierzemy pierwszy od prawej adres spoza listy zaufanych (lewe wpisy może podrobić klient).
export function clientIp(peer, xff, trusted) {
  const p = normIp(peer);
  if (!trusted.has(p)) return p;
  const hops = String(xff || '').split(',').map(s => normIp(s.trim())).filter(Boolean);
  for (let i = hops.length - 1; i >= 0; i--) if (!trusted.has(hops[i])) return hops[i];
  return p;
}

// Polityka haseł: długość, brak najpopularniejszych haseł i fragmentów loginu
const COMMON = new Set(['123456789012', 'qwertyuiopas', 'haslo1234567', 'hasło1234567', 'password1234', 'zaq12wsxcde3', '1qaz2wsx3edc',
  'administrator', 'polska123456', 'kompas123456', 'kompaskompetencji', 'qwerty123456', 'aaaaaaaaaaaa', 'abcdefghijkl']);
export const PASSWORD_MIN = 12;
export function passwordProblem(pw, email = '') {
  const s = String(pw || '');
  if (s.length < PASSWORD_MIN) return `Hasło musi mieć co najmniej ${PASSWORD_MIN} znaków.`;
  if (s.length > 200) return 'Hasło może mieć najwyżej 200 znaków.';
  if (/^(.)\1+$/.test(s) || COMMON.has(s.toLowerCase())) return 'To hasło jest zbyt popularne. Wybierz inne.';
  const local = String(email).split('@')[0].toLowerCase();
  if (local.length >= 4 && s.toLowerCase().includes(local)) return 'Hasło nie może zawierać nazwy konta.';
  if (new Set(s).size < 5) return 'Hasło musi zawierać co najmniej 5 różnych znaków.';
  return null;
}
