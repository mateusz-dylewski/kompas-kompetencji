// Konfiguracja seedu danych demonstracyjnych (dane fikcyjne).
// Hasło kont demo pochodzi z KK_DEMO_PASSWORD. Wartość domyślna działa TYLKO w trybie lokalnym (KK_MODE != production);
// jest publiczna (README) i służy wyłącznie do testów na własnym komputerze. W repozytorium nie ma innych haseł.
//   KK_MODE=production  – brak domyślnego hasła, seed demo wyłączony (chyba że KK_SEED_DEMO=1 i KK_DEMO_PASSWORD)
//   KK_SEED_DEMO=0      – nie twórz kont demo także lokalnie
export const LOCAL_DEMO_PASSWORD = 'Demo-kompas-2026!';
export const DEMO_MANAGER = 'przelozony@demo.kk';
export const DEMO_EMPLOYEE = n => `pracownik${n}@demo.kk`;

export function demoConfig(env = process.env) {
  const mode = env.KK_MODE === 'production' ? 'production' : 'local';
  const seed = mode === 'local' ? env.KK_SEED_DEMO !== '0' : env.KK_SEED_DEMO === '1';
  const fromEnv = env.KK_DEMO_PASSWORD || '';
  const password = fromEnv || (mode === 'local' ? LOCAL_DEMO_PASSWORD : '');
  if (seed && !password) throw new Error('Seed demo w trybie produkcyjnym wymaga zmiennej KK_DEMO_PASSWORD.');
  if (seed && password.length < 10) throw new Error('KK_DEMO_PASSWORD musi mieć co najmniej 10 znaków.');
  // Podpowiedź hasła na ekranie logowania tylko dla publicznej wartości lokalnej
  return { mode, seed, password, hintPassword: mode === 'local' && !fromEnv ? LOCAL_DEMO_PASSWORD : null };
}
