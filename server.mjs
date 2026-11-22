// Kompas Kompetencji – serwer aplikacji (Node.js >= 22.5, zero zależności)
// Uruchomienie: node server.mjs   → http://localhost:8080
// AI: lokalny Ollama z modelem Qwen (domyślnie http://127.0.0.1:11434). Zmienne: KK_AI_URL, KK_AI_MODEL;
// z KK_AI_KEY – serwer zgodny z OpenAI (klucz tylko ze środowiska, np. node --env-file=.env server.mjs).
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { buildXml, buildDraftPdf, buildDraftXml, computeResults, ptsFor, PTS5, EVAL_SCHEMA, isSchema2 } from './lib/documents.mjs';
import { timingCheck, refDate, CYCLE_MONTHS, MIN_GAP_MONTHS, REEVAL_MONTHS, KICKOFF_DAYS, lastPeriodic, nextDueAfter, kickoffDue } from './lib/cycle.mjs';
import { demoConfig, DEMO_MANAGER, DEMO_EMPLOYEE } from './lib/seed-config.mjs';
import { buildFormPdf } from './lib/forms.mjs';
import { securityConfig, clientIp, passwordProblem } from './lib/security.mjs';
// Baza pytań asystenta (jedno źródło dla UI, API i promptów AI); opis: docs/asystent-instrukcja.md
const ASSISTANT = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'lib', 'asystent', 'baza-pytan.json'), 'utf8'));

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT !== undefined && process.env.PORT !== '' ? Number(process.env.PORT) : 8080; // PORT=0 → losowy port (testy)
const AI_URL = process.env.KK_AI_URL || 'http://127.0.0.1:11434';
const AI_MODEL = process.env.KK_AI_MODEL || 'qwen2.5:14b';
const AI_KEY = process.env.KK_AI_KEY || '';
const K_MIN = 5; // minimalna liczba osób do pokazania agregatów zespołu
const SESSION_MS = 8 * 3600 * 1000;
const DEMO = demoConfig(); // hasła demo z konfiguracji seedu (KK_DEMO_PASSWORD; domyślne tylko lokalnie)
const PROD = DEMO.mode === 'production';
const SEC = securityConfig(); // KK_PUBLIC_ORIGIN, KK_TRUSTED_PROXY, KK_SIGN_KEY, KK_AUDIT_KEY (lib/security.mjs)
// Limit prób logowania (okno 10 minut), tak by nie dało się zablokować cudzego konta ani całego biura:
//   para IP + e-mail: 5 nieudanych → blokada tej pary; adres IP: 50 nieudanych → blokada adresu;
//   e-mail (z wielu adresów): od 10 nieudanych rosnące odstępy między próbami (1, 2, 4… s, maks. 60 s)
const LOGIN_PAIR_MAX = 5, LOGIN_IP_MAX = 50, LOGIN_EMAIL_SOFT = 10, LOGIN_WINDOW_MS = 10 * 60 * 1000;
const ACTIVATION_MS = 24 * 3600 * 1000;

// ---------- Baza danych ----------
// KK_DATA_DIR: katalog bazy (domyślnie ./data, nie commitować); testy używają katalogu tymczasowego.
// Pliki tworzymy tylko dla właściciela procesu (katalog 0700, pliki 0600).
const DATA_DIR = path.resolve(process.env.KK_DATA_DIR || path.join(ROOT, 'data'));
process.umask(0o077);
fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
fs.chmodSync(DATA_DIR, 0o700);
const db = new DatabaseSync(path.join(DATA_DIR, 'kompas.db'));
for (const f of fs.readdirSync(DATA_DIR)) { try { fs.chmodSync(path.join(DATA_DIR, f), 0o600); } catch (_) { /* np. katalog outbox */ } }
db.exec(`
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('pracownik','przelozony')), position TEXT, unit TEXT, manager_id INTEGER, pass TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS evals(id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL, evaluator_id INTEGER NOT NULL,
  typ TEXT NOT NULL, period_from TEXT, period_to TEXT, status TEXT NOT NULL DEFAULT 'draft', data TEXT NOT NULL DEFAULT '{}',
  created TEXT NOT NULL, updated TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS goals(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, s TEXT, m TEXT, a TEXT, r TEXT, t TEXT,
  done INTEGER NOT NULL DEFAULT 0, progress INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT NOT NULL, target TEXT, at TEXT NOT NULL);
`);

try { db.exec('ALTER TABLE users ADD COLUMN avatar TEXT'); } catch (_) { /* kolumna już istnieje */ }
for (const sql of [
  'ALTER TABLE evals ADD COLUMN ack_at TEXT',
  'ALTER TABLE evals ADD COLUMN objection_at TEXT',
  'ALTER TABLE evals ADD COLUMN objection_text TEXT',
  'ALTER TABLE audit ADD COLUMN prev_hash TEXT',
  'ALTER TABLE audit ADD COLUMN hash TEXT',
  'ALTER TABLE evals ADD COLUMN objection_result TEXT',
  'ALTER TABLE evals ADD COLUMN objection_decided_at TEXT',
  'ALTER TABLE evals ADD COLUMN revision INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE audit ADD COLUMN prev_value TEXT',
  'ALTER TABLE audit ADD COLUMN new_value TEXT',
  'ALTER TABLE evals ADD COLUMN early_exception TEXT',
]) { try { db.exec(sql); } catch (_) { /* już istnieje */ } }
db.exec(`
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS revisions(id INTEGER PRIMARY KEY, eval_id INTEGER NOT NULL, rev INTEGER NOT NULL,
  data TEXT NOT NULL, status_before TEXT NOT NULL, reason TEXT, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS signatures(id INTEGER PRIMARY KEY, eval_id INTEGER NOT NULL, signer_id INTEGER NOT NULL,
  role TEXT NOT NULL, signed_at TEXT NOT NULL, doc_sha256 TEXT NOT NULL, sig_value TEXT NOT NULL, note TEXT);
CREATE TABLE IF NOT EXISTS ai_log(id INTEGER PRIMARY KEY, eval_id INTEGER, user_id INTEGER, action TEXT NOT NULL,
  model TEXT, input_sha256 TEXT, output_text TEXT, source TEXT, at TEXT NOT NULL);
-- Informacje: obserwacja zachowania przy konkretnym wskaźniku (sytuacja – działanie – rezultat)
CREATE TABLE IF NOT EXISTS evidence(id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL, evaluator_id INTEGER NOT NULL,
  date TEXT NOT NULL, indicator TEXT NOT NULL, situation TEXT NOT NULL, action TEXT NOT NULL, result TEXT NOT NULL,
  link TEXT, task_ref TEXT, created TEXT NOT NULL, updated TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS evidence_emp_date ON evidence(employee_id, date);
-- Rytm miesięczny: krótka rozmowa (do 20 min), 3 pola, bez punktacji
CREATE TABLE IF NOT EXISTS checkins(id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL, evaluator_id INTEGER NOT NULL, month TEXT NOT NULL,
  done_text TEXT NOT NULL DEFAULT '', attention_text TEXT NOT NULL DEFAULT '', goal_text TEXT NOT NULL DEFAULT '', date TEXT,
  status TEXT NOT NULL DEFAULT 'planowany' CHECK(status IN ('planowany','odbyty')), created TEXT NOT NULL, updated TEXT NOT NULL,
  UNIQUE(employee_id, month));
-- Feedback o rezultacie zadania (nie o osobie); bez pól o czasie pracy, obecności i aktywności
CREATE TABLE IF NOT EXISTS feedback(id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL, author_id INTEGER NOT NULL, indicator TEXT NOT NULL,
  source TEXT NOT NULL, level INTEGER CHECK(level IS NULL OR level IN (1,3,5,7,9)), justification TEXT NOT NULL, relation TEXT NOT NULL,
  date TEXT NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL);
-- Oceny cząstkowe kwartalne: przyznaje oceniający, z uzasadnieniem i wskazaniem informacji z kwartału
CREATE TABLE IF NOT EXISTS partial_ratings(id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL, evaluator_id INTEGER NOT NULL, quarter TEXT NOT NULL,
  competency TEXT NOT NULL, pts INTEGER NOT NULL CHECK(pts IN (1,3,5,7,9)), justification TEXT NOT NULL, evidence_ids TEXT NOT NULL DEFAULT '[]',
  created TEXT NOT NULL, updated TEXT NOT NULL, UNIQUE(employee_id, quarter, competency));
`);
// Klucze: w produkcji wyłącznie ze zmiennych (KK_SIGN_KEY, KK_AUDIT_KEY – z menedżera sekretów, poza katalogiem danych).
// Lokalnie, gdy zmiennych brak: pliki w data/ (0600, poza repozytorium).
const fileKey = name => {
  const f = path.join(DATA_DIR, name);
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(f, 'utf8').trim();
};
const SIGN_KEY = SEC.signKey || fileKey('sign.key');
const AUDIT_KEY = SEC.auditKey || fileKey('audit.key');

// Konta: hasło ustala pracownik (link aktywacyjny); must_change wymusza zmianę hasła nadanego przez kogoś innego
try {
  db.exec('ALTER TABLE users ADD COLUMN must_change INTEGER NOT NULL DEFAULT 0');
  // Migracja: konta założone przez przełożonego z hasłem początkowym (przed P0) muszą zmienić hasło
  db.exec("UPDATE users SET must_change=1 WHERE id IN (SELECT CAST(target AS INTEGER) FROM audit WHERE action='create_employee')");
} catch (_) { /* kolumna już istnieje */ }
db.exec(`CREATE TABLE IF NOT EXISTS activation(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, token_sha256 TEXT NOT NULL UNIQUE,
  exp TEXT NOT NULL, used_at TEXT, created_by INTEGER, created TEXT NOT NULL)`);

// Rozmowa rozpoczynająca okres oceny (poradnik KPRM, rozdz. 6.2): obowiązki, oczekiwania, cele, kryteria dodatkowe (maks. 3);
// zapoznanie pracownika = podpis części I arkusza (mock). Od dnia zapoznania liczy się okres podlegający ocenie.
db.exec(`CREATE TABLE IF NOT EXISTS kickoffs(id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL, evaluator_id INTEGER NOT NULL, typ TEXT NOT NULL CHECK(typ IN ('B','C')),
  date TEXT NOT NULL, prev_eval_id INTEGER, due TEXT, extra_criteria TEXT NOT NULL DEFAULT '[]', duties TEXT NOT NULL, expectations TEXT NOT NULL, goals TEXT NOT NULL,
  ack_at TEXT, eval_id INTEGER, created TEXT NOT NULL, updated TEXT NOT NULL)`);
// Ankieta przygotowania do rozmowy (1–5): bez identyfikatora osoby i oceny – tylko do zbiorczych metryk (K_MIN przełożonych)
db.exec(`CREATE TABLE IF NOT EXISTS prep_survey(id INTEGER PRIMARY KEY, rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5), month TEXT NOT NULL)`);
try { db.exec('ALTER TABLE evals ADD COLUMN survey_done INTEGER NOT NULL DEFAULT 0'); } catch (_) { /* już istnieje */ }
// Cele SMART: postęp z kroków (sprawdzalnych), a nie z suwaka – [{ t, done }]; progress = odsetek wykonanych kroków
try { db.exec("ALTER TABLE goals ADD COLUMN steps TEXT NOT NULL DEFAULT '[]'"); } catch (_) { /* już istnieje */ }
// Plan rozwoju i komunikat do pracownika pisze przełożony (etap 4); każda zmiana = nowy wiersz (historia wersji)
db.exec(`CREATE TABLE IF NOT EXISTS dev_plans(id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL, author_id INTEGER NOT NULL,
  plan TEXT NOT NULL, message TEXT NOT NULL DEFAULT '', created TEXT NOT NULL)`);
// Cele wyznacza przełożony (created_by); NULL = cel sprzed zmiany, założony przez pracownika
try { db.exec('ALTER TABLE goals ADD COLUMN created_by INTEGER'); } catch (_) { /* już istnieje */ }
// Migracja kroków { t, done } → { t, reported_at, confirmed_at, confirmed_by } (wykonane = potwierdzone przy migracji)
for (const g of db.prepare("SELECT id, steps, created FROM goals WHERE steps LIKE '%\"done\"%'").all()) {
  const steps = JSON.parse(g.steps || '[]').map(x => ('done' in x ? { t: x.t, reported_at: x.done ? g.created : null, confirmed_at: x.done ? g.created : null, confirmed_by: null } : x));
  db.prepare('UPDATE goals SET steps=? WHERE id=?').run(JSON.stringify(steps), g.id);
}

// Dziennik: pieczęć HMAC każdego wpisu (klucz spoza bazy) i blokada UPDATE/DELETE na poziomie bazy
try { db.exec('ALTER TABLE audit ADD COLUMN mac TEXT'); } catch (_) { /* już istnieje */ }
const auditMac = r => crypto.createHmac('sha256', AUDIT_KEY)
  .update(JSON.stringify([r.id, r.user_id ?? null, r.action, r.target ?? null, r.at, r.prev_hash ?? null, r.hash ?? null, r.prev_value ?? null, r.new_value ?? null])).digest('hex');
{
  // Wpisy sprzed migracji pieczętujemy raz (lokalnie automatycznie, w produkcji tylko z KK_AUDIT_MIGRATE=1).
  const legacy = db.prepare('SELECT * FROM audit WHERE mac IS NULL ORDER BY id').all();
  if (legacy.length && SEC.auditMigrate) {
    db.exec('DROP TRIGGER IF EXISTS audit_no_update');
    const up = db.prepare('UPDATE audit SET mac=? WHERE id=?');
    for (const r of legacy) up.run(auditMac(r), r.id);
    console.log(`Dziennik: opieczętowano HMAC ${legacy.length} wcześniejszych wpisów.`);
  } else if (legacy.length) {
    console.warn(`Dziennik: ${legacy.length} wpisów bez pieczęci HMAC – weryfikacja zgłosi naruszenie. Jednorazowa migracja: KK_AUDIT_MIGRATE=1.`);
  }
}
db.exec(`
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT, 'Dziennik zdarzeń: tylko dopisywanie'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT, 'Dziennik zdarzeń: tylko dopisywanie'); END;
`);

// Model kompetencji (ten sam plik co w przeglądarce)
const MODEL = JSON.parse(fs.readFileSync(path.join(ROOT, 'app', 'kompetencje.js'), 'utf8')
  .replace(/^\s*window\.KK_MODEL\s*=\s*/, '').replace(/;\s*$/, ''));
const MODEL_KEYS = new Set(MODEL.map(c => c.k));
// Wskaźniki: klucz „KOMPETENCJA|nr” (ten sam co w data.ratings oceny)
const INDICATORS = new Map(MODEL.flatMap(c => c.w.map((w, wi) => [`${c.k}|${wi}`, { k: c.k, wi, text: w.w }])));
// Kryteria obowiązkowe wg rozporządzenia z 4.04.2016: Arkusz B (kierowanie) i Arkusz C (pozostałe stanowiska)
const MAND_B = ['ZARZĄDZANIE LUDŹMI', 'PODEJMOWANIE DECYZJI', 'ORGANIZACJA PRACY', 'WSPÓŁPRACA', 'KOMUNIKACJA'];
const MAND_C = ['WYKORZYSTYWANIE WIEDZY', 'RZETELNOŚĆ', 'ORGANIZACJA PRACY', 'WSPÓŁPRACA', 'KOMUNIKACJA'];
const mandFor = typ => (typ === 'C' ? MAND_C : typ === 'B' ? MAND_B : []);
const MAX_EXTRA = 3;
// PTS5 (1/3/5/7/9) i PTS3 (3/5/7 – pierwsza ocena, do weryfikacji z przepisami z 2015 r.) są w lib/documents.mjs

const now = () => new Date().toISOString();
// Moduły spoza rozporządzenia: można je wyłączyć. Ocena okresowa, zapoznanie i sprzeciw są zawsze włączone.
const MODULES = {
  mod_evidence: { label: 'Informacje przy wskaźnikach (obserwacje: sytuacja, działanie, rezultat)', prefixes: ['/api/evidence'], default: '1' },
  mod_checkins: { label: 'Rozmowy miesięczne i przegląd miesiąca', prefixes: ['/api/checkins', '/api/month'], default: '1' },
  mod_feedback: { label: 'Informacja zwrotna między przełożonym a pracownikiem', prefixes: ['/api/feedback'], default: '1' },
  mod_partials: { label: 'Oceny cząstkowe kwartalne', prefixes: ['/api/partials'], default: '1' },
  mod_ai: { label: 'Asystent AI (podpowiedzi, nie decyzje)', prefixes: ['/api/ai/'], default: '1' },
  mod_employee_evidence: { label: 'Pracownik widzi swoje informacje (opcjonalne)', prefixes: [], default: '1' },
};
const settingVal = key => { const r = db.prepare('SELECT value FROM settings WHERE key=?').get(key); return r ? r.value : MODULES[key].default; };
const modOn = key => settingVal(key) === '1';
const modeOffFor = pathname => Object.entries(MODULES).find(([k, m]) => m.prefixes.some(pre => pathname.startsWith(pre)) && !modOn(k))?.[0] || null;
const hashPass = (pw, salt = crypto.randomBytes(16).toString('hex')) =>
  `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
// Konto bez hasła (przed aktywacją) ma pass=''. Fałszywy hash wyrównuje czas odpowiedzi,
// gdy konta nie ma albo nie jest aktywne – po czasie nie da się poznać, które adresy istnieją.
const DUMMY_PASS = hashPass(crypto.randomBytes(16).toString('hex'));
const checkPass = (pw, stored) => {
  const usable = typeof stored === 'string' && /^[0-9a-f]{32}:[0-9a-f]{128}$/.test(stored);
  const [salt, hash] = (usable ? stored : DUMMY_PASS).split(':');
  const a = Buffer.from(crypto.scryptSync(String(pw), salt, 64).toString('hex'));
  const b = Buffer.from(hash);
  return usable && a.length === b.length && crypto.timingSafeEqual(a, b);
};
// Dziennik ze łańcuchem hash: każdy wpis zawiera skrót poprzedniego (wykrywa modyfikacje).
// Zmiany ocen, informacji i feedbacku zapisują poprzednią i nową wartość (JSON); obie wchodzą do skrótu.
// Wpisy bez wartości liczą skrót jak dotąd, więc starsze dzienniki weryfikują się bez zmian.
const auditHash = (prev, uid, action, target, at, pv = null, nv = null) => crypto.createHash('sha256')
  .update([prev || '', uid ?? '', action, target, at, ...(pv !== null || nv !== null ? [pv ?? '', nv ?? ''] : [])].join('|')).digest('hex');
const audit = (uid, action, target = '', prevVal, newVal) => {
  const at = now();
  const pv = prevVal === undefined ? null : JSON.stringify(prevVal);
  const nv = newVal === undefined ? null : JSON.stringify(newVal);
  const last = db.prepare('SELECT id,hash FROM audit ORDER BY id DESC LIMIT 1').get();
  const prev = last?.hash || '';
  const hash = auditHash(prev, uid, action, String(target), at, pv, nv);
  // Identyfikator nadajemy jawnie (serwer jednowątkowy), bo pieczęć HMAC go obejmuje, a UPDATE na audit jest zablokowany
  const row = { id: (last?.id || 0) + 1, user_id: uid ?? null, action, target: String(target), at, prev_hash: prev, hash, prev_value: pv, new_value: nv };
  db.prepare('INSERT INTO audit(id,user_id,action,target,at,prev_hash,hash,prev_value,new_value,mac) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(row.id, row.user_id, action, row.target, at, prev, hash, pv, nv, auditMac(row));
};
// Różnica dwóch obiektów płaskich (klucz → [stara, nowa]); używana do zapisu zmian w dzienniku
const diffObj = (a = {}, b = {}) => {
  const prev = {}, next = {};
  for (const k of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
    if (JSON.stringify(a?.[k]) !== JSON.stringify(b?.[k])) { prev[k] = a?.[k] ?? null; next[k] = b?.[k] ?? null; }
  }
  return Object.keys(next).length ? { prev, next } : null;
};
const docHash = ev => {
  const data = typeof ev.data === 'string' ? ev.data : JSON.stringify(ev.data || {});
  return crypto.createHash('sha256').update(`${ev.id}|${ev.typ}|${ev.period_from}|${ev.period_to}|${data}`).digest('hex');
};
const sigValue = (hash, signerId, role, at) => crypto.createHmac('sha256', SIGN_KEY).update(`${hash}|${signerId}|${role}|${at}`).digest('hex');
const SIG_NOTE = 'Podpis elektroniczny systemu (SHA-256 + HMAC); integracja z podpisem kwalifikowanym lub zaufanym przy wdrożeniu';
const aiLog = (evalId, uid, action, input, out) => db.prepare('INSERT INTO ai_log(eval_id,user_id,action,model,input_sha256,output_text,source,at) VALUES(?,?,?,?,?,?,?,?)')
  .run(evalId ?? null, uid, action, AI_MODEL, crypto.createHash('sha256').update(String(input)).digest('hex'), String(out.text || ''), out.source || '', now());

// Dane demonstracyjne (tylko gdy baza jest pusta)
function seed() {
  if (!DEMO.seed || db.prepare('SELECT COUNT(*) n FROM users').get().n) return;
  const demoPass = DEMO.password;
  const ins = db.prepare('INSERT INTO users(email,name,role,position,unit,manager_id,pass,avatar) VALUES(?,?,?,?,?,?,?,?)');
  const mgr = ins.run(DEMO_MANAGER, 'Joanna Mazur', 'przelozony', 'Dyrektor Departamentu Cyfryzacji', 'Departament Cyfryzacji', null, hashPass(demoPass), '/app/assets/faces/f1.jpg').lastInsertRowid;
  // Dane przykładowe: imiona, nazwiska i stanowiska wymyślone; zdjęcia to darmowe placeholdery do podmiany
  const staff = [
    ['Katarzyna Wiśniewska', 'Specjalistka ds. analiz danych', 'f3'],
    ['Michał Zieliński', 'Główny specjalista ds. infrastruktury', 'f2'],
    ['Agnieszka Dąbrowska', 'Starszy referent ds. zamówień', 'f5'],
    ['Tomasz Nowak', 'Inspektor ds. bezpieczeństwa informacji', 'f4'],
    ['Magdalena Kaczmarek', 'Specjalistka ds. komunikacji', 'f7'],
    ['Piotr Lewandowski', 'Referent ds. dostępności cyfrowej', 'f6'],
  ];
  const emps = staff.map(([n, pos, av], i) => ins.run(DEMO_EMPLOYEE(i + 1), n, 'pracownik', pos, 'Departament Cyfryzacji', mgr, hashPass(demoPass), `/app/assets/faces/${av}.jpg`).lastInsertRowid);
  let seedN = 7;
  const rnd = () => ((seedN = (seedN * 9301 + 49297) % 233280) / 233280);
  const insE = db.prepare('INSERT INTO evals(employee_id,evaluator_id,typ,period_from,period_to,status,data,created,updated) VALUES(?,?,?,?,?,?,?,?,?)');
  emps.forEach((eid, i) => {
    const typ = i < 2 ? 'pierwsza' : 'B';
    const status = i === 0 ? 'discussed' : i < 5 ? 'submitted' : 'draft';
    const criteria = (typ === 'pierwsza' ? MODEL.slice(0, 6) : MODEL.filter(c => mandFor(typ).some(m => c.k.startsWith(m)))).map(c => c.k);
    const ratings = {};
    MODEL.filter(c => criteria.includes(c.k)).forEach(c => c.w.forEach((w, wi) => {
      const lvl0 = typ === 'pierwsza' ? 1 + Math.floor(rnd() * 3) : Math.floor(rnd() * 5);
      // szkice: poziomy realistyczne wokół oczekiwań (głównie 2, część 3, pojedyncze 1; bez 0)
      const lvl = status === 'draft' ? [2, 2, 3, 2, 1][lvl0] : lvl0;
      ratings[`${c.k}|${wi}`] = { lvl, ex: '' };
    }));
    const data = { criteria, ratings, dev: 'Szkolenie z analizy danych do końca kwartału.' };
    if (typ !== 'pierwsza') { // dane fikcyjne: oceny cząstkowe „przyznane” przez oceniającego w scenariuszu demo
      data.schema = EVAL_SCHEMA; data.partials = {};
      for (const k of criteria) data.partials[k] = { pts: PTS5[Math.floor(rnd() * 3) + 2] };
      if (status !== 'draft') { const r = computeResults({ typ, data }, MODEL); data.wynik = r.wynik; data.wynikSource = 'wyliczony'; data.wynikReasons = r.wynikReasons; }
    }
    insE.run(eid, mgr, typ, '2026-01-01', '2026-06-30', status, JSON.stringify(data), now(), now());
  });
  const plD = iso => iso.split('-').reverse().join('.'); // daty w treści dla ludzi: DD.MM.RRRR
  const at0 = now(), addD = (d, n) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
  const insG = db.prepare('INSERT INTO goals(user_id,s,m,a,r,t,done,progress,steps,created_by,created) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  const STEPS = ['Ukończone szkolenie z narzędzia', 'Pierwszy raport przygotowany z pomocą opiekuna', 'Dwa raporty przygotowane samodzielnie', 'Raportowanie zespołu przejęte'];
  emps.forEach((eid, i) => {
    const doneN = i % 3 === 0 ? STEPS.length : i % STEPS.length;
    // Kroki demo: potwierdzone, jeden zgłoszony (czeka na potwierdzenie), reszta otwarta
    const at = now();
    // Zgłoszony krok czeka na potwierdzenie tylko u pracownika3 (i pracownika1 w drugim celu) – Start bez powtarzalnych spraw
    const steps = STEPS.map((t, si) => ({ t, reported_at: si < doneN || (si === doneN && i === 2) ? at : null, confirmed_at: si < doneN ? at : null, confirmed_by: si < doneN ? mgr : null }));
    if (doneN === STEPS.length) steps.forEach(x => { x.reported_at = at; });
    insG.run(eid, 'Obsługa narzędzia analitycznego', '2 raporty miesięcznie samodzielnie', '2 godziny szkolenia tygodniowo', 'Przejęcie raportowania zespołu', '2026-12-31', doneN === STEPS.length ? 1 : 0, Math.round(doneN / STEPS.length * 100), JSON.stringify(steps), mgr, at);
  });
  // Drugi cel pracownika1: kroki w różnych stanach (potwierdzony, zgłoszony, do zrobienia)
  const st2 = [['Lista wymagań dostępności zebrana od zespołów', 1, 1], ['Audyt trzech serwisów przeprowadzony', 1, 0], ['Raport z zaleceniami przekazany kierownictwu', 0, 0], ['Poprawki wdrożone i sprawdzone ponownie', 0, 0]]
    .map(([t, rep, conf]) => ({ t, reported_at: rep ? at0 : null, confirmed_at: conf ? at0 : null, confirmed_by: conf ? mgr : null }));
  insG.run(emps[0], 'Poprawa dostępności serwisów departamentu', 'Audyt 3 serwisów i raport z zaleceniami', 'Udział w szkoleniu z dostępności cyfrowej', 'Zgodność serwisów z wymaganiami ustawy o dostępności cyfrowej', addD(today(), 60), 0, 25, JSON.stringify(st2), mgr, at0);
  // Rozmowy rozpoczynające (fikcyjne): dwie zapoznane przez pracownika, jedna czeka na zapoznanie; pracownik3 (emps[2]) zostaje „po terminie”
  const insK = db.prepare('INSERT INTO kickoffs(employee_id,evaluator_id,typ,date,prev_eval_id,due,extra_criteria,duties,expectations,goals,ack_at,eval_id,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const evOf = eid => db.prepare('SELECT id FROM evals WHERE employee_id=? ORDER BY id LIMIT 1').get(eid)?.id ?? null;
  const kd = d => addD(today(), d);
  insK.run(emps[3], mgr, 'B', kd(-20), evOf(emps[3]), '2026-07-30', JSON.stringify(['MYŚLENIE ANALITYCZNE', 'NEGOCJOWANIE']),
    'Prowadzenie rejestru incydentów bezpieczeństwa informacji i przegląd uprawnień w systemach.', 'Zgłoszenia incydentów rejestrowane w ciągu jednego dnia roboczego; kwartalny przegląd uprawnień.',
    'Skrócenie czasu obsługi incydentu oraz aktualizacja procedury do końca okresu.', `${kd(-18)}T09:00:00.000Z`, null, at0, at0);
  insK.run(emps[4], mgr, 'B', kd(-12), evOf(emps[4]), '2026-07-30', JSON.stringify(['KREATYWNOŚĆ']),
    'Przygotowanie komunikatów wewnętrznych i obsługa kanałów informacyjnych departamentu.', 'Komunikaty publikowane zgodnie z kalendarzem, bez uwag redakcyjnych w kolejnej rundzie.',
    'Uruchomienie cyklicznego biuletynu departamentu i ocena jego czytelności wśród odbiorców.', `${kd(-10)}T09:00:00.000Z`, null, at0, at0);
  // Zapisana, czeka na zapoznanie pracownika (ocena typu C jest szkicem poniżej)
  const kC = insK.run(emps[1], mgr, 'C', kd(-2), null, null, JSON.stringify(['ORIENTACJA NA KLIENTA']),
    'Wsparcie wdrożeń dostępności cyfrowej w serwisach departamentu.', 'Terminowe przekazywanie wyników kontroli oraz jasne opisy zaleceń.',
    'Przeprowadzenie kontroli dostępności dwóch serwisów i przygotowanie zaleceń.', null, null, at0, at0).lastInsertRowid;
  // Ocena typu C (szkic) dla pracownika2 – oceny cząstkowe zgodne ze schematem 2
  const cCrit = MODEL.filter(c => MAND_C.some(m => c.k.startsWith(m))).map(c => c.k);
  const cRatings = {}; let ci = 0;
  MODEL.filter(c => cCrit.includes(c.k)).forEach(c => c.w.forEach((w, wi) => { cRatings[`${c.k}|${wi}`] = { lvl: [2, 2, 3, 2, 2, 3, 1][ci++ % 7], ex: '' }; }));
  const cData = { criteria: cCrit, ratings: cRatings, dev: 'Szkolenie z zasad redagowania dokumentów urzędowych.', schema: EVAL_SCHEMA, partials: {} };
  cCrit.forEach((k, i) => { cData.partials[k] = { pts: PTS5[2 + (i % 3)] }; });
  const cId = db.prepare('INSERT INTO evals(employee_id,evaluator_id,typ,period_from,period_to,status,data,created,updated) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(emps[1], mgr, 'C', kd(-150), kd(-1), 'draft', JSON.stringify(cData), at0, '2026-01-02T08:00:00.000Z').lastInsertRowid;
  db.prepare('UPDATE kickoffs SET eval_id=? WHERE id=?').run(cId, kC);
  seedEvidence(mgr, emps, rnd);
  seedExamples();
  seedRhythm(mgr, emps);
  // Plan rozwoju i komunikat przełożonego dla pracownika1
  db.prepare('INSERT INTO dev_plans(employee_id,author_id,plan,message,created) VALUES(?,?,?,?,?)').run(emps[0], mgr,
    `1. Szkolenie z dostępności cyfrowej (WCAG) – zapis do ${plD(addD(today(), 14))}, udział do ${plD(addD(today(), 45))}.\n2. Wspólny audyt jednego serwisu z doświadczoną koleżanką z zespołu – do ${plD(addD(today(), 60))}.\n3. Prezentacja wniosków z audytu na spotkaniu zespołu – do ${plD(addD(today(), 90))}.`,
    'Dziękuję za rzetelne raporty w ostatnim kwartale. Proponuję rozwój w kierunku dostępności cyfrowej – porozmawiamy o tym na najbliższym spotkaniu miesięcznym.', at0);
}
// Przykłady w ocenach demo: z treści informacji osoby przy danym wskaźniku (sytuacja – działanie – rezultat); bez informacji – pusty
function seedExamples() {
  const ev = db.prepare('SELECT indicator,situation,action,result FROM evidence WHERE employee_id=? ORDER BY date,id');
  for (const e of db.prepare("SELECT id,employee_id,data FROM evals").all()) {
    const d = JSON.parse(e.data || '{}'); let ch = false;
    const byInd = new Map(); for (const x of ev.all(e.employee_id)) byInd.set(x.indicator, x);
    for (const [k, r] of Object.entries(d.ratings || {})) {
      const x = byInd.get(k);
      if (x && !r.ex) { r.ex = `${x.situation} – ${x.action.charAt(0).toLowerCase() + x.action.slice(1)} – ${x.result.charAt(0).toLowerCase() + x.result.slice(1)}.`; ch = true; }
    }
    if (ch) db.prepare('UPDATE evals SET data=? WHERE id=?').run(JSON.stringify(d), e.id);
  }
}
// Informacje demo (fikcyjne): okres oceny I półrocza 2026 oraz ostatnie miesiące (przegląd miesiąca)
function seedEvidence(mgr, emps, rnd) {
  const SIT = ['Przygotowanie raportu kwartalnego dla kierownictwa', 'Odpowiedź na pismo innej komórki organizacyjnej', 'Wdrożenie nowej procedury obiegu dokumentów',
    'Spotkanie projektowe z zespołem wykonawcy', 'Obsługa wniosku o udostępnienie informacji publicznej', 'Aktualizacja rejestru umów'];
  const ACT = ['Sprawdzono wymagania i uzgodniono harmonogram z osobami zależnymi', 'Przygotowano wersję roboczą i zebrano uwagi przed terminem',
    'Zgłoszono ryzyko opóźnienia z dwudniowym wyprzedzeniem i zaproponowano zmianę kolejności prac', 'Ustalenia podsumowano na piśmie i rozesłano uczestnikom',
    'Zebrano dane z trzech źródeł i zweryfikowano ich spójność przed przekazaniem', 'Omówiono zakres z przełożonym i doprecyzowano oczekiwany efekt',
    'Przygotowano krótką instrukcję dla pozostałych osób w zespole', 'Skonsultowano projekt z radcą prawnym i naniesiono zalecone zmiany',
    'Uzupełniono braki w dokumentacji i oznaczono wersję końcową', 'Przeprowadzono krótkie szkolenie wewnętrzne dla osób korzystających z rozwiązania'];
  const RES = ['Dokument przekazany w terminie, bez poprawek merytorycznych', 'Termin dotrzymany, uwagi uwzględnione w jednej rundzie',
    'Zmiana planu uzgodniona, zadanie zakończone w nowym terminie', 'Uczestnicy potwierdzili ustalenia, brak pytań zwrotnych',
    'Dane przyjęte przez odbiorcę bez konieczności uzupełnień', 'Przełożony zatwierdził rozwiązanie bez zmian w zakresie',
    'Instrukcja wykorzystana przez zespół w kolejnych zadaniach', 'Uwagi prawne wprowadzone, sprawa zamknięta w terminie',
    'Dokumentacja kompletna, kontrola wewnętrzna bez uwag', 'Osoby przeszkolone samodzielnie wykonują zadanie'];
  const pick = a => a[Math.floor(rnd() * a.length)];
  const ins = db.prepare('INSERT INTO evidence(employee_id,evaluator_id,date,indicator,situation,action,result,link,task_ref,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  const used = new Set(), usedAct = new Map();
  const add = (eid, date, ind) => {
    let sit, act, res, key, n = 0;
    const ua = usedAct.get(eid) || usedAct.set(eid, new Set()).get(eid);
    do { sit = pick(SIT); act = pick(ACT); res = pick(RES); key = `${eid}|${sit}|${act}|${res}`; } while ((used.has(key) || (ua.has(act) && ua.size < ACT.length)) && ++n < 400);
    ua.add(act);
    if (used.has(key)) return; // wyczerpane kombinacje – bez duplikatu
    used.add(key);
    return ins.run(eid, mgr, date, ind, sit, act, res, null, `ZAD-${100 + Math.floor(rnd() * 900)}`, now(), now());
  };
  // Każdy szkic oceny (B i C): do każdego wskaźnika co najmniej jedna informacja z okresu oceny, bez duplikatów treści u osoby
  const dd = (d, n) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
  for (const dr of db.prepare("SELECT employee_id, period_from, period_to, data FROM evals WHERE status='draft' ORDER BY id").all()) {
    const inds = Object.keys(JSON.parse(dr.data).ratings || {});
    const span = Math.max(1, Math.round((Date.parse(dr.period_to) - Date.parse(dr.period_from)) / 86400000));
    let n = 0;
    inds.forEach((ind, i) => {
      const date = dd(dr.period_from, Math.floor((i + 0.5) * span / inds.length));
      for (;;) { // następna wolna kombinacja treści u tej osoby
        const sit = SIT[Math.floor(n / ACT.length) % SIT.length], act = ACT[n % ACT.length], res = RES[(n + Math.floor(n / 24)) % RES.length]; n++;
        if (n > 500) return;
        if (db.prepare('SELECT 1 FROM evidence WHERE employee_id=? AND situation=? AND action=? AND result=?').get(dr.employee_id, sit, act, res)) continue;
        ins.run(dr.employee_id, mgr, date, ind, sit, act, res, null, `ZAD-${100 + Math.floor(rnd() * 900)}`, now(), now());
        return;
      }
    });
  }
  // Ostatnie miesiące: kilka informacji na osobę (wskaźniki z kryteriów obowiązkowych Arkusza C)
  const pool = [...INDICATORS.keys()].filter(k => MAND_C.some(m => k.startsWith(m)));
  const months = [-2, -1, 0].map(d => { const t = new Date(); t.setUTCDate(1); t.setUTCMonth(t.getUTCMonth() + d); return t.toISOString().slice(0, 7); });
  emps.slice(0, 4).forEach(eid => months.forEach(m => {
    for (let i = 0; i < 3; i++) {
      const day = Math.min(1 + Math.floor(rnd() * 27), m === today().slice(0, 7) ? Math.max(1, +today().slice(8, 10)) : 28);
      add(eid, `${m}-${String(day).padStart(2, '0')}`, pick(pool));
    }
  }));
}

// Migracja kształtu danych oceny do wersji 2 (oceny cząstkowe B/C przyznaje oceniający, wynik wyliczany).
// Szkice B/C bez pola schema dostają schema=2 i puste data.partials – oceniający musi przyznać oceny cząstkowe.
// Oceny złożone sprzed migracji zostają bez zmian (podpisany skrót treści), ich oceny cząstkowe to średnie wskaźników.
function migrateEvalSchema() {
  const rows = db.prepare("SELECT id,typ,data FROM evals WHERE status='draft' AND typ IN ('B','C')").all();
  let n = 0;
  for (const r of rows) {
    const d = JSON.parse(r.data || '{}');
    if (Number(d.schema) >= EVAL_SCHEMA) continue;
    const prev = { schema: d.schema ?? null, wynik: d.wynik ?? null };
    d.schema = EVAL_SCHEMA; d.partials = {}; delete d.wynik;
    db.prepare('UPDATE evals SET data=? WHERE id=?').run(JSON.stringify(d), r.id);
    audit(null, 'migrate_eval_schema2', r.id, prev, { schema: EVAL_SCHEMA, partials: {} });
    n++;
  }
  if (n) console.log(`Migracja: ${n} szkic(e) ocen okresowych przeniesiono do schematu ${EVAL_SCHEMA}.`);
}

// ---------- Sesje ----------
const sessions = new Map(); // token -> { uid, exp }
// Cookie sesji: lokalnie kk_sid, w produkcji __Host-kk_sid (Secure, Path=/, bez Domain)
const sidFrom = req => new RegExp(`(?:^|;\\s*)${SEC.cookieName}=([a-f0-9]{64})`).exec(req.headers.cookie || '')?.[1] || null;
function sessionUser(req) {
  const sid = sidFrom(req);
  if (!sid) return null;
  const s = sessions.get(sid);
  if (!s || s.exp < Date.now()) { sessions.delete(sid); return null; }
  return db.prepare('SELECT id,email,name,role,position,unit,manager_id,avatar,must_change FROM users WHERE id=?').get(s.uid) || null;
}
// Unieważnia sesje użytkownika (np. po zmianie hasła), z wyjątkiem bieżącej
const dropSessions = (uid, keep = null) => { for (const [k, s] of sessions) if (s.uid === uid && k !== keep) sessions.delete(k); };

// ---------- Pomocnicze ----------
const send = (res, code, obj, extra = {}) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...SECURITY, ...extra });
  res.end(JSON.stringify(obj));
};
const fail = (res, code, msg, extra) => send(res, code, { error: msg, ...(extra || {}) });
const readJson = req => new Promise((ok, bad) => {
  let b = '';
  req.on('data', c => { b += c; if (b.length > 1e6) { req.destroy(); bad(new Error('too_large')); } });
  req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch { bad(new Error('bad_json')); } });
});
const str = (x, max = 500) => (typeof x === 'string' ? x.trim().slice(0, max) : '');
const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().startsWith(v);
const isMonth = v => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const today = () => now().slice(0, 10);
const isQuarter = v => typeof v === 'string' && /^\d{4}-Q[1-4]$/.test(v);
const quarterRange = q => { const y = +q.slice(0, 4), n = +q.slice(6); const m1 = String(n * 3 - 2).padStart(2, '0'), m3 = `${y}-${String(n * 3).padStart(2, '0')}`; return [`${y}-${m1}-01`, monthEnd(m3)]; };
const quarterOf = date => `${date.slice(0, 4)}-Q${Math.floor((+date.slice(5, 7) - 1) / 3) + 1}`;
const monthEnd = m => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).toISOString().slice(0, 10);
const qs = req => new URL(req.url, 'http://x').searchParams;
// Pracownik z zespołu przełożonego (null, jeśli nie należy do zespołu)
const teamMember = (u, empId) => (u.role === 'przelozony' ? db.prepare("SELECT id,name FROM users WHERE id=? AND manager_id=? AND role='pracownik'").get(Number(empId), u.id) || null : null);
// Walidacja: zwraca { value, errors }; errors to mapa pole → komunikat (kod 400 „Nieprawidłowe dane.”)
const invalid = (res, errors, msg = 'Nieprawidłowe dane.') => fail(res, 400, msg, { fields: errors });
const publicUser = u => u && ({ id: u.id, email: u.email, name: u.name, role: u.role, position: u.position, unit: u.unit, avatar: u.avatar || null, mustChange: !!u.must_change });

const parseData = ev => (typeof ev.data === 'string' ? JSON.parse(ev.data || '{}') : (ev.data || {}));
// Ocena cząstkowa per kompetencja (B/C: przyznana przez oceniającego; pierwsza i dane sprzed migracji: średnia wskaźników)
function scoreEval(ev) {
  const data = parseData(ev);
  const res = computeResults({ ...ev, data: { ...data, criteria: (data.criteria || []).filter(k => MODEL_KEYS.has(k)) } }, MODEL);
  return Object.fromEntries(res.crit.map(c => [c.key, { avg: c.partial, n: c.rows.filter(r => r.pts !== null).length, total: c.rows.length }]));
}
const evalRow = ev => ({ ...ev, data: JSON.parse(ev.data || '{}') });

// Walidacja danych oceny z formularza
function sanitizeData(input, typ) {
  // Kryteria obowiązkowe B/C są zawsze zaznaczone (nie da się ich pominąć)
  const mandKeys = typ === 'B' || typ === 'C' ? MODEL.filter(c => mandFor(typ).some(m => c.k.startsWith(m))).map(c => c.k) : [];
  const criteria = [...new Set([...mandKeys, ...(Array.isArray(input?.criteria) ? input.criteria : []).filter(k => MODEL_KEYS.has(k))])];
  const ratings = {};
  const src = input?.ratings && typeof input.ratings === 'object' ? input.ratings : {};
  for (const [key, r] of Object.entries(src)) {
    const [k, wi] = key.split('|');
    if (!criteria.includes(k)) continue;
    const comp = MODEL.find(c => c.k === k);
    if (!comp || !(Number(wi) >= 0 && Number(wi) < comp.w.length)) continue;
    // pierwsza ocena: poziomy 1–3 (3/5/7 pkt); okresowa: 0–4 (1/3/5/7/9 pkt)
    const [minLvl, maxLvl] = typ === 'pierwsza' ? [1, 3] : [0, 4];
    if (r?.lvl === 'none') ratings[key] = { lvl: 'none', ex: str(r.ex, 1200) };
    else if (Number.isInteger(r?.lvl) && r.lvl >= minLvl && r.lvl <= maxLvl)
      ratings[key] = { lvl: r.lvl, ex: str(r.ex, 1200) };
  }
  const date = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
  const out = { criteria, ratings, dev: str(input?.dev, 2000), rozmowa: date(input?.rozmowa), terminOceny: date(input?.terminOceny),
    uzasadnienie: str(input?.uzasadnienie, 4000) };
  if (typ === 'pierwsza') {
    // pierwsza ocena: wynik wskazuje oceniający (zasady z 2015 r. do weryfikacji)
    out.wynik = ['pozytywna', 'negatywna'].includes(input?.wynik) ? input.wynik : '';
  } else {
    // ocena okresowa: oceny cząstkowe 1/3/5/7/9 przyznaje oceniający; wyniku nie wpisuje się – jest wyliczany (§ 11)
    out.schema = EVAL_SCHEMA;
    out.partials = {};
    const src2 = input?.partials && typeof input.partials === 'object' ? input.partials : {};
    for (const k of criteria) {
      const pts = Number(src2[k]?.pts);
      if (PTS5.includes(pts)) out.partials[k] = { pts };
    }
  }
  return out;
}
// Liczba informacji per wskaźnik w okresie (puste daty = bez ograniczenia)
function evidenceCounts(empId, from, to) {
  const rows = db.prepare(`SELECT indicator, COUNT(*) n FROM evidence WHERE employee_id=? ${isDate(from) ? 'AND date>=?' : ''} ${isDate(to) ? 'AND date<=?' : ''} GROUP BY indicator`)
    .all(empId, ...[from, to].filter(isDate));
  return Object.fromEntries(rows.map(r => [r.indicator, r.n]));
}
// Walidacja do złożenia oceny
function missingForSubmit(ev) {
  const data = parseData(ev);
  const miss = [];
  for (const k of data.criteria || []) {
    const comp = MODEL.find(c => c.k === k);
    comp.w.forEach((w, wi) => {
      const r = data.ratings?.[`${k}|${wi}`];
      if (!r) miss.push(`${comp.k}: wskaźnik ${wi + 1} nieoceniony`);
      else if (r.lvl !== 'none' && !(r.ex || '').trim()) miss.push(`${comp.k}: wskaźnik ${wi + 1} bez uzasadnienia`);
    });
    if (isSchema2(ev.typ, data) && !PTS5.includes(Number(data.partials?.[k]?.pts))) miss.push(`${comp.k}: brak oceny cząstkowej (1/3/5/7/9 pkt)`);
  }
  // Ocena okresowa: każdy oceniany wskaźnik ma co najmniej jedną informację z okresu oceny
  // albo jawną adnotację „brak podstaw do oceny” (lvl = 'none')
  if (ev.typ !== 'pierwsza') {
    const counts = evidenceCounts(ev.employee_id, ev.period_from, ev.period_to);
    for (const k of data.criteria || []) {
      const comp = MODEL.find(c => c.k === k);
      comp.w.forEach((w, wi) => {
        const r = data.ratings?.[`${k}|${wi}`];
        if (r && r.lvl !== 'none' && !counts[`${k}|${wi}`]) miss.push(`${comp.k}: wskaźnik ${wi + 1} bez informacji z okresu oceny (dodaj informację albo zaznacz „brak podstaw do oceny”)`);
      });
    }
  }
  if (ev.typ !== 'pierwsza') {
    const res = computeResults({ ...ev, data }, MODEL);
    if (res.wynik === 'negatywna' && !(data.uzasadnienie || '').trim()) miss.push('Uzasadnienie jest obowiązkowe przy ocenie negatywnej');
  }
  return miss;
}

// ---------- AI (lokalny Qwen przez Ollama) ----------
const AI_RULE_NOTE = 'Wygenerowano regułowo (lokalny model AI niedostępny).';
let aiStatusCache = { at: 0, v: null };
async function ollamaStatus() {
  // Tryb zgodny z OpenAI (KK_AI_KEY): dostępność sprawdzamy listą modeli serwera (wynik pamiętany 60 s)
  if (AI_KEY) {
    if (aiStatusCache.v && Date.now() - aiStatusCache.at < 60000) return aiStatusCache.v;
    const v = await remoteStatus();
    aiStatusCache = { at: Date.now(), v };
    return v;
  }
  return localStatus();
}
async function remoteStatus() {
  {
    try {
      const r = await fetch(`${AI_URL}/models`, { headers: { authorization: `Bearer ${AI_KEY}` }, signal: AbortSignal.timeout(4000) });
      if (!r.ok) return { ok: false, model: AI_MODEL, remote: true };
      const j = await r.json();
      const has = (j.data || []).some(m => m.id === AI_MODEL);
      return { ok: has, model: AI_MODEL, modelInstalled: has, remote: true, url: 'serwer zewnętrzny' };
    } catch { return { ok: false, model: AI_MODEL, remote: true }; }
  }
}
async function localStatus() {
  try {
    const r = await fetch(`${AI_URL}/api/tags`, { signal: AbortSignal.timeout(2500) });
    if (!r.ok) return { ok: false, model: AI_MODEL };
    const j = await r.json();
    const has = (j.models || []).some(m => m.name === AI_MODEL || m.model === AI_MODEL);
    return { ok: true, model: AI_MODEL, modelInstalled: has, url: 'lokalnie' };
  } catch { return { ok: false, model: AI_MODEL }; }
}
// Minimalizacja danych (RODO): z treści wysyłanej do modelu usuwamy imiona i nazwiska wszystkich kont,
// także gdy przełożony wpisał je w uzasadnieniu lub dowodzie. Prompt nie zawiera danych identyfikujących.
function redactNames(text) {
  const tokens = new Set();
  for (const { name, email } of db.prepare('SELECT name,email FROM users').all()) {
    for (const t of String(name).split(/\s+/)) if (t.length >= 3) tokens.add(t);
    tokens.add(email);
  }
  let out = String(text);
  for (const t of [...tokens].sort((a, b) => b.length - a.length)) {
    // odmiana: rdzeń bez ostatniej litery + do 4 liter końcówki (Katarzyna → Katarzyny, Michał → Michałem)
    const stem = !t.includes('@') && t.length >= 5 ? t.slice(0, -1) : t;
    const re = new RegExp(`(?<![\\p{L}])${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\p{L}]{0,4}(?![\\p{L}])`, 'gu');
    out = out.replace(re, '[osoba]');
  }
  return out;
}
async function llm(system, user, history = []) {
  user = redactNames(user);
  const hist = history.map(m => ({ role: m.role, content: redactNames(m.content) }));
  // Tryb zgodny z OpenAI (np. zewnętrzny endpoint testowy): tylko gdy ustawiono KK_AI_KEY w środowisku.
  // Klucz nigdy nie jest zapisany w kodzie ani w repozytorium.
  if (AI_KEY) {
    const r = await fetch(`${AI_URL}/chat/completions`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${AI_KEY}` },
      body: JSON.stringify({ model: AI_MODEL, temperature: 0.3, max_tokens: 700,
        messages: [{ role: 'system', content: system }, ...hist, { role: 'user', content: user }] }),
      signal: AbortSignal.timeout(120000),
    });
    if (!r.ok) throw new Error('llm_' + r.status);
    const j = await r.json();
    return (j.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  }
  const r = await fetch(`${AI_URL}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: AI_MODEL, stream: false, think: false, options: { temperature: 0.3, num_predict: 700 },
      messages: [{ role: 'system', content: system }, ...hist, { role: 'user', content: user }] }),
    signal: AbortSignal.timeout(120000),
  });
  if (!r.ok) throw new Error('llm_' + r.status);
  const j = await r.json();
  return (j.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}
// Dane do promptu: bez imion, tylko kompetencje, poziomy i krótkie uzasadnienia
function evalSummaryForAI(ev) {
  const data = JSON.parse(ev.data || '{}');
  const lines = [];
  for (const k of data.criteria || []) {
    const comp = MODEL.find(c => c.k === k);
    comp.w.forEach((w, wi) => {
      const r = data.ratings?.[`${k}|${wi}`];
      const lvl = !r ? 'nieoceniono' : r.lvl === 'none' ? 'brak podstaw' : `${ptsFor(ev.typ, r.lvl)} pkt`;
      lines.push(`- ${comp.k.toLowerCase()} / ${w.w}: ${lvl}${r?.ex ? ` (przykład: ${r.ex.slice(0, 200)})` : ''}`);
    });
  }
  return lines.join('\n');
}
const RULES = `Zasady: nie wystawiasz ocen i nie podejmujesz decyzji – to należy do przełożonego. Nie oceniasz osoby, tylko zachowania. Odpowiadasz po polsku, zwięźle, w punktach. Nie podajesz imion ani danych osobowych. Pytania formułujesz według zasad: ${ASSISTANT.zasady.join(' ')}`;

// Rytm miesięczny demo (fikcyjny): check-iny z poprzednich miesięcy, feedback, oceny cząstkowe za bieżący kwartał
function seedRhythm(mgr, emps) {
  const at = now(), cur = today().slice(0, 7);
  const prevMonths = [-2, -1].map(d => { const t = new Date(); t.setUTCDate(1); t.setUTCMonth(t.getUTCMonth() + d); return t.toISOString().slice(0, 7); });
  const insC = db.prepare('INSERT INTO checkins(employee_id,evaluator_id,month,done_text,attention_text,goal_text,date,status,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?)');
  emps.slice(0, 4).forEach(eid => prevMonths.forEach(m => insC.run(eid, mgr, m, 'Zamknięto zaplanowane zadania miesiąca, w tym raport dla kierownictwa.',
    'Dwa zadania zależne od innej komórki – uzgodnić terminy cząstkowe.', 'Przygotować listę kontrolną do raportu przed kolejnym terminem.', `${m}-20`, 'odbyty', at, at)));
  insC.run(emps[0], mgr, cur, '', '', '', null, 'planowany', at, at);
  const insF = db.prepare('INSERT INTO feedback(employee_id,author_id,indicator,source,level,justification,relation,date,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?)');
  const fbDate = `${prevMonths[1]}-12`;
  insF.run(emps[0], mgr, 'RZETELNOŚĆ|0', 'ZAD-214: zestawienie danych do sprawozdania', 7, 'Zestawienie przekazane z opisem metody i kontrolą sum; odbiorca nie zgłosił poprawek.', 'odbiorca', fbDate, at, at);
  insF.run(emps[0], mgr, 'KOMUNIKACJA|0', 'Spotkanie z wykonawcą – protokół ustaleń', null, 'Protokół rozesłany tego samego dnia, ustalenia jednoznaczne, bez pytań zwrotnych.', 'przelozony', fbDate, at, at);
  insF.run(emps[1], mgr, 'WSPÓŁPRACA|0', 'ZAD-331: wspólne opracowanie procedury', 5, 'Uwagi do procedury przekazane w terminie i uwzględnione w wersji końcowej.', 'wspolpracownik', fbDate, at, at);
  // Ocena cząstkowa kwartalna: wskazuje informacje tej osoby z bieżącego kwartału
  const q = quarterOf(today()), [qf, qt] = quarterRange(q);
  const evs = db.prepare('SELECT id,indicator FROM evidence WHERE employee_id=? AND date>=? AND date<=?').all(emps[0], qf, qt);
  const byComp = {};
  for (const e of evs) (byComp[INDICATORS.get(e.indicator).k] ||= []).push(e.id);
  const insP = db.prepare('INSERT INTO partial_ratings(employee_id,evaluator_id,quarter,competency,pts,justification,evidence_ids,created,updated) VALUES(?,?,?,?,?,?,?,?,?)');
  Object.entries(byComp).slice(0, 2).forEach(([k, ids], i) => insP.run(emps[0], mgr, q, k, [5, 7][i], 'Rezultaty zadań w kwartale zgodne z wymaganiami; opis w informacjach.', JSON.stringify(ids.slice(0, 3)), at, at));
}

// Dane demo i migracje (po definicji funkcji pomocniczych)
seed();
migrateEvalSchema();

// ---------- Trasy API ----------
const routes = [];
const route = (method, pattern, handler) => routes.push({ method, pattern, handler });

// Nieudane próby: klucz (p:IP|e-mail, ip:IP, e:e-mail) → znaczniki czasu z okna 10 minut (pamięć serwera, maks. 10 000 kluczy)
const loginFails = new Map();
const LOGIN_KEYS_MAX = 10000;
const recentFails = key => (loginFails.get(key) || []).filter(t => Date.now() - t < LOGIN_WINDOW_MS);
const noteFail = key => {
  if (!loginFails.has(key) && loginFails.size >= LOGIN_KEYS_MAX) loginFails.delete(loginFails.keys().next().value);
  loginFails.set(key, [...recentFails(key), Date.now()].slice(-LOGIN_IP_MAX));
};
const reqIp = req => clientIp(req.socket.remoteAddress, req.headers['x-forwarded-for'], SEC.trustedProxies);
const loginKeys = (ip, email) => ({ pair: `p:${ip}|${email}`, ip: `ip:${ip}`, email: `e:${email}` });
// Sekundy do kolejnej dozwolonej próby (0 = można próbować)
function loginWait(k) {
  const t = Date.now(); let wait = 0;
  const pair = recentFails(k.pair), ipF = recentFails(k.ip), em = recentFails(k.email);
  if (pair.length >= LOGIN_PAIR_MAX) wait = Math.max(wait, pair[pair.length - LOGIN_PAIR_MAX] + LOGIN_WINDOW_MS - t);
  if (ipF.length >= LOGIN_IP_MAX) wait = Math.max(wait, ipF[ipF.length - LOGIN_IP_MAX] + LOGIN_WINDOW_MS - t);
  if (em.length >= LOGIN_EMAIL_SOFT) {
    const gap = Math.min(60000, 1000 * 2 ** (em.length - LOGIN_EMAIL_SOFT));
    wait = Math.max(wait, em[em.length - 1] + gap - t);
  }
  return Math.max(0, Math.ceil(wait / 1000));
}
const tooMany = (res, wait) => send(res, 429, { error: `Zbyt wiele nieudanych prób. Spróbuj ponownie za ${wait < 60 ? `${wait} s` : `${Math.ceil(wait / 60)} min`}.` }, { 'retry-after': String(wait) });
// W dzienniku zapisujemy login tylko, gdy to istniejące konto (omyłkowo wpisane hasło nie trafi do dziennika)
const loginLabel = (email, u) => (u ? email : '[nieznany login]');
const COOKIE = SEC.cookieName, cookieFlags = SEC.cookieFlags;
route('POST', '/api/login', async (req, res) => {
  const b = await readJson(req);
  const email = str(b.email, 200).toLowerCase();
  const k = loginKeys(reqIp(req), email);
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  const wait = loginWait(k);
  if (wait) {
    audit(null, 'login_blocked', loginLabel(email, u));
    return tooMany(res, wait);
  }
  // checkPass liczy scrypt zawsze (także bez konta) – stały czas odpowiedzi
  if (!checkPass(String(b.password || ''), u?.pass) || !u) {
    for (const key of Object.values(k)) noteFail(key);
    audit(null, 'login_fail', loginLabel(email, u));
    return fail(res, 401, 'Nieprawidłowy e-mail lub hasło.');
  }
  loginFails.delete(k.pair);
  // Rotacja sesji: poprzedni identyfikator z tej przeglądarki jest unieważniany, zawsze wydajemy nowy
  const old = sidFrom(req);
  if (old) sessions.delete(old);
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { uid: u.id, exp: Date.now() + SESSION_MS });
  audit(u.id, 'login', old ? 'session_rotated' : '');
  send(res, 200, { user: publicUser(u) }, { 'set-cookie': `${COOKIE}=${token}; ${cookieFlags}; Max-Age=${SESSION_MS / 1000}` });
});
route('POST', '/api/logout', async (req, res) => {
  const sid = sidFrom(req);
  if (sid) sessions.delete(sid);
  send(res, 200, { ok: true }, { 'set-cookie': `${COOKIE}=; ${cookieFlags}; Max-Age=0` });
});

// ---------- Aktywacja konta i zmiana hasła ----------
// Link aktywacyjny: token 256 bitów, w bazie tylko SHA-256, ważny 24 h, jednorazowy.
// Dostarczenie: skrzynka nadawcza data/outbox/ (symulacja e-maila do pracownika; w produkcji do zastąpienia SMTP lub SSO).
// Przełożony nie dostaje linku w trybie produkcyjnym – nie może ustawić hasła za pracownika.
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const appOrigin = req => SEC.publicOrigin || `http://${String(req.headers.host || 'localhost').replace(/[^a-z0-9.:[\]-]/gi, '')}`;
function issueActivation(req, user, byId) {
  const token = crypto.randomBytes(32).toString('hex'), exp = new Date(Date.now() + ACTIVATION_MS).toISOString();
  db.prepare('DELETE FROM activation WHERE user_id=? AND used_at IS NULL').run(user.id);
  db.prepare('INSERT INTO activation(user_id,token_sha256,exp,created_by,created) VALUES(?,?,?,?,?)').run(user.id, sha256(token), exp, byId, now());
  const link = `${appOrigin(req)}/#aktywacja=${token}`;
  const outbox = path.join(DATA_DIR, 'outbox');
  fs.mkdirSync(outbox, { recursive: true, mode: 0o700 });
  fs.appendFileSync(path.join(outbox, 'aktywacje.jsonl'), JSON.stringify({ to: user.email, subject: 'Kompas Kompetencji: aktywacja konta', link, exp, at: now() }) + '\n', { mode: 0o600 });
  audit(byId, 'activation_issued', user.id, null, { exp });
  return { expires: exp, delivered: 'outbox', ...(PROD ? {} : { link }) };
}
route('POST', '/api/activate', async (req, res) => {
  const b = await readJson(req);
  const k = loginKeys(reqIp(req), '[aktywacja]');
  const wait = loginWait(k);
  if (wait) return tooMany(res, wait);
  const token = typeof b.token === 'string' && /^[a-f0-9]{64}$/.test(b.token) ? b.token : null;
  const row = token && db.prepare('SELECT * FROM activation WHERE token_sha256=?').get(sha256(token));
  if (!row || row.used_at || row.exp < now()) {
    noteFail(k.pair); noteFail(k.ip);
    return fail(res, 400, 'Link aktywacyjny jest nieprawidłowy, wykorzystany albo wygasł. Poproś przełożonego o nowy.');
  }
  const u = db.prepare('SELECT id,email FROM users WHERE id=?').get(row.user_id);
  const problem = passwordProblem(b.password, u.email);
  if (problem) return invalid(res, { password: problem }, problem);
  db.prepare('UPDATE users SET pass=?, must_change=0 WHERE id=?').run(hashPass(String(b.password)), u.id);
  db.prepare('UPDATE activation SET used_at=? WHERE id=?').run(now(), row.id);
  dropSessions(u.id);
  audit(u.id, 'account_activated', u.id);
  send(res, 200, { ok: true, email: u.email });
});
route('POST', '/api/password', async (req, res, u) => {
  const b = await readJson(req);
  const k = loginKeys(reqIp(req), u.email);
  const wait = loginWait(k);
  if (wait) return tooMany(res, wait);
  const full = db.prepare('SELECT pass FROM users WHERE id=?').get(u.id);
  if (!checkPass(String(b.current || ''), full.pass)) {
    noteFail(k.pair); noteFail(k.ip);
    audit(u.id, 'password_change_fail', u.id);
    return invalid(res, { current: 'Nieprawidłowe obecne hasło.' }, 'Nieprawidłowe obecne hasło.');
  }
  if (String(b.next || '') === String(b.current || '')) return invalid(res, { next: 'Nowe hasło musi się różnić od obecnego.' }, 'Nowe hasło musi się różnić od obecnego.');
  const problem = passwordProblem(b.next, u.email);
  if (problem) return invalid(res, { next: problem }, problem);
  db.prepare('UPDATE users SET pass=?, must_change=0 WHERE id=?').run(hashPass(String(b.next)), u.id);
  dropSessions(u.id, sidFrom(req));
  audit(u.id, 'password_change', u.id);
  send(res, 200, { ok: true });
});
// Konta demo na ekranie logowania (tylko lokalnie). Hasło podajemy wyłącznie, gdy to publiczna wartość domyślna.
route('GET', '/api/demo', async (req, res) => send(res, 200, DEMO.seed && !PROD
  ? { enabled: true, manager: DEMO_MANAGER, employee: DEMO_EMPLOYEE(1), password: DEMO.hintPassword }
  : { enabled: false }));
route('GET', '/api/me', async (req, res, u) => send(res, 200, { user: publicUser(u), ai: await ollamaStatus() }));
// Start aplikacji: zawsze 200 (niezalogowany: user=null), także przy wymuszonej zmianie hasła
route('GET', '/api/session', async (req, res, u) => send(res, 200, u ? { user: publicUser(u), ai: await ollamaStatus() } : { user: null }));
route('GET', '/api/settings', async (req, res) => send(res, 200, { modules: Object.entries(MODULES).map(([key, m]) => ({ key, label: m.label, on: modOn(key), regulation: false })), required: ['Ocena okresowa (Arkusz B/C)', 'Pierwsza ocena', 'Zapoznanie i sprzeciw (art. 83)', 'Dziennik zdarzeń'] }));
route('PUT', '/api/settings', async (req, res, u) => {
  if (u.role !== 'przelozony') return fail(res, 403, 'Tylko przełożony zmienia ustawienia.');
  const b = await readJson(req);
  for (const [key, v] of Object.entries(b.modules || {})) {
    if (!MODULES[key]) continue;
    db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, v ? '1' : '0');
    audit(u.id, 'setting', `${key}=${v ? 1 : 0}`);
  }
  send(res, 200, { ok: true });
});
route('GET', '/api/assistant', async (req, res) => send(res, 200, ASSISTANT));
route('GET', '/api/model', async (req, res) => send(res, 200, { model: MODEL, mandB: MAND_B, mandC: MAND_C, maxExtra: MAX_EXTRA, kMin: K_MIN,
  cycle: { cycleMonths: CYCLE_MONTHS, minGapMonths: MIN_GAP_MONTHS, reevalMonths: REEVAL_MONTHS, kickoffDays: KICKOFF_DAYS } }));
// Terminy: ostatnia ocena okresowa pracownika, najwcześniejszy termin kolejnej (6 mies.) i termin cyklu (24 mies.)
const empEvals = empId => db.prepare('SELECT id,typ,status,period_from,period_to,data,updated FROM evals WHERE employee_id=?').all(empId);
const TOO_EARLY = t => `Zbyt wczesna ocena: od poprzedniej oceny okresowej (${t.prevDate}) musi upłynąć ${MIN_GAP_MONTHS} miesięcy (najwcześniej ${t.earliest}). Możesz zapisać wyjątek z uzasadnieniem – trafi do dziennika.`;
const exceptionReason = b => str(b?.exception?.reason, 1000);

// ---------- Rozmowa rozpoczynająca okres oceny ----------
const latestKickoff = empId => db.prepare('SELECT * FROM kickoffs WHERE employee_id=? ORDER BY date DESC, id DESC LIMIT 1').get(empId) || null;
const mandKeysFor = typ => MODEL.filter(c => mandFor(typ).some(m => c.k.startsWith(m))).map(c => c.k);
const kickoffRow = r => r && ({ id: r.id, employeeId: r.employee_id, evaluatorId: r.evaluator_id, typ: r.typ, date: r.date, due: r.due, prevEvalId: r.prev_eval_id,
  late: !!(r.due && r.date > r.due), extraCriteria: JSON.parse(r.extra_criteria || '[]'), duties: r.duties, expectations: r.expectations, goals: r.goals,
  criteria: [...mandKeysFor(r.typ), ...JSON.parse(r.extra_criteria || '[]')].map(k => ({ k, n: MODEL.find(c => c.k === k)?.n || k, mandatory: mandKeysFor(r.typ).includes(k) })),
  ackAt: r.ack_at, evalId: r.eval_id, created: r.created, updated: r.updated });
const kickoffAuditView = r => ({ typ: r.typ, date: r.date, extra_criteria: typeof r.extra_criteria === 'string' ? JSON.parse(r.extra_criteria) : r.extra_criteria, duties: r.duties, expectations: r.expectations, goals: r.goals });
const KICKOFF_FIELDS = ['employeeId', 'typ', 'date', 'extraCriteria', 'duties', 'expectations', 'goals'];
function sanitizeKickoff(b, cur = null) {
  const errors = {}, v = {};
  for (const k of Object.keys(b || {})) if (!KICKOFF_FIELDS.includes(k)) errors[k] = 'Nieznane pole.';
  const has = k => !cur || b[k] !== undefined;
  if (has('typ')) { if (['B', 'C'].includes(b.typ)) v.typ = b.typ; else errors.typ = 'Arkusz: B (kierujący zespołem) albo C (pozostałe stanowiska).'; }
  if (has('date')) { if (isDate(b.date)) v.date = b.date; else errors.date = 'Podaj datę rozmowy (RRRR-MM-DD).'; }
  for (const [k, label] of [['duties', 'obowiązki'], ['expectations', 'oczekiwania'], ['goals', 'cele']]) {
    if (!has(k)) continue;
    const t = str(b[k], 2000);
    if (t.length >= 10) v[k] = t; else errors[k] = `Opisz ${label} (min. 10 znaków).`;
  }
  const typ = v.typ || cur?.typ;
  if (has('extraCriteria') || v.typ) {
    const list = b.extraCriteria !== undefined ? b.extraCriteria : JSON.parse(cur?.extra_criteria || '[]');
    const mand = mandKeysFor(typ);
    if (!Array.isArray(list) || list.some(k => !MODEL_KEYS.has(k)) || new Set(list).size !== list.length) errors.extraCriteria = 'Wybierz kryteria z modelu kompetencji.';
    else if (list.length > MAX_EXTRA) errors.extraCriteria = `Najwyżej ${MAX_EXTRA} kryteria dodatkowe.`;
    else if (list.some(k => mand.includes(k))) errors.extraCriteria = 'Kryterium obowiązkowe dla tego arkusza nie jest dodatkowe.';
    else v.extra_criteria = JSON.stringify(list);
  }
  return { value: v, errors };
}
route('GET', '/api/kickoffs', async (req, res, u) => {
  const { where, args } = scopedWhere(u, qs(req));
  send(res, 200, { kickoffs: db.prepare(`SELECT * FROM kickoffs WHERE ${where.join(' AND ')} ORDER BY date DESC, id DESC`).all(...args).map(kickoffRow) });
});
route('POST', '/api/kickoffs', async (req, res, u) => {
  if (u.role !== 'przelozony') return fail(res, 403, 'Rozmowę rozpoczynającą zapisuje przełożony.');
  const b = await readJson(req);
  const emp = teamMember(u, b.employeeId);
  if (!emp) return fail(res, 404, 'Nie znaleziono pracownika w Twoim zespole.');
  const { value: v, errors } = sanitizeKickoff({ extraCriteria: [], ...b });
  if (Object.keys(errors).length) return invalid(res, errors);
  const prev = lastPeriodic(empEvals(emp.id));
  const due = kickoffDue(prev), at = now();
  const id = db.prepare('INSERT INTO kickoffs(employee_id,evaluator_id,typ,date,prev_eval_id,due,extra_criteria,duties,expectations,goals,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(emp.id, u.id, v.typ, v.date, prev?.id ?? null, due, v.extra_criteria, v.duties, v.expectations, v.goals, at, at).lastInsertRowid;
  const row = db.prepare('SELECT * FROM kickoffs WHERE id=?').get(id);
  audit(u.id, 'create_kickoff', `kickoff:${id}`, null, { employeeId: emp.id, due, ...kickoffAuditView(row) });
  send(res, 201, { kickoff: kickoffRow(row) });
});
route('PUT', '/api/kickoffs/:id', async (req, res, u, p) => {
  const cur = db.prepare('SELECT * FROM kickoffs WHERE id=?').get(p.id);
  if (!cur || u.role !== 'przelozony' || cur.evaluator_id !== u.id) return fail(res, 404, 'Nie znaleziono rozmowy.');
  if (cur.ack_at) return fail(res, 409, 'Pracownik zapoznał się już z ustaleniami (część I). Zmiany wymagają nowej rozmowy.');
  const b = await readJson(req);
  if (b.employeeId !== undefined && Number(b.employeeId) !== cur.employee_id) return invalid(res, { employeeId: 'Nie można przenieść rozmowy na inną osobę.' });
  const { value: v, errors } = sanitizeKickoff(b, cur);
  if (Object.keys(errors).length) return invalid(res, errors);
  const next = { ...cur, ...v };
  const ch = diffObj(kickoffAuditView(cur), kickoffAuditView(next));
  if (!ch) return send(res, 200, { kickoff: kickoffRow(cur), changed: false });
  db.prepare('UPDATE kickoffs SET typ=?,date=?,extra_criteria=?,duties=?,expectations=?,goals=?,updated=? WHERE id=?')
    .run(next.typ, next.date, next.extra_criteria, next.duties, next.expectations, next.goals, now(), cur.id);
  audit(u.id, 'update_kickoff', `kickoff:${cur.id}`, ch.prev, ch.next);
  send(res, 200, { kickoff: kickoffRow(db.prepare('SELECT * FROM kickoffs WHERE id=?').get(cur.id)), changed: true });
});
// Zapoznanie pracownika z obowiązkami, kryteriami i celami (część I arkusza) – od tej daty liczy się okres oceny
route('POST', '/api/kickoffs/:id/acknowledge', async (req, res, u, p) => {
  const cur = db.prepare('SELECT * FROM kickoffs WHERE id=?').get(p.id);
  if (!cur || u.role !== 'pracownik' || cur.employee_id !== u.id) return fail(res, 404, 'Nie znaleziono rozmowy.');
  if (cur.ack_at) return fail(res, 409, 'Zapoznanie już zarejestrowano.');
  const at = now();
  db.prepare('UPDATE kickoffs SET ack_at=?, updated=? WHERE id=?').run(at, at, cur.id);
  audit(u.id, 'acknowledge_kickoff', `kickoff:${cur.id}`, { ack_at: null }, { ack_at: at });
  send(res, 201, { ok: true, ackAt: at });
});

// Dashboard pracownika
route('GET', '/api/dashboard', async (req, res, u) => {
  if (u.role === 'pracownik') {
    const evals = db.prepare("SELECT * FROM evals WHERE employee_id=? AND status!='draft' ORDER BY updated DESC").all(u.id).map(evalRow);
    const latest = evals[0] || null;
    const goals = goalsOf(u.id);
    // Plan rozwoju: wnioski z ostatniej oceny, w której przełożony je zapisał (zwykle po rozmowie oceniającej)
    const devEval = evals.find(e => (e.data?.dev || '').trim());
    const manager = u.manager_id ? db.prepare('SELECT name FROM users WHERE id=?').get(u.manager_id) : null;
    // § 6 rozporządzenia: oceniany zna kryteria i termin sporządzenia oceny także przed jej złożeniem (bez poziomów)
    const upcoming = db.prepare("SELECT * FROM evals WHERE employee_id=? AND status='draft' ORDER BY id").all(u.id).map(e => {
      const d = JSON.parse(e.data || '{}');
      return { id: e.id, typ: e.typ, periodFrom: e.period_from, periodTo: e.period_to, terminOceny: d.terminOceny || null, criteria: (d.criteria || []).map(k => MODEL.find(c => c.k === k)?.n || k) };
    });
    const tc = timingCheck(empEvals(u.id), today());
    return send(res, 200, {
      role: u.role, manager: manager?.name || null, upcoming, nextDue: tc.nextDue, dueReason: tc.dueReason, kickoff: kickoffRow(latestKickoff(u.id)),
      evals: evals.map(e => ({ id: e.id, typ: e.typ, status: e.status, periodFrom: e.period_from, periodTo: e.period_to, updated: e.updated })),
      latestScores: latest ? scoreEval(latest) : null,
      devPlan: devPlansOf(u.id)[0] || null,
      latestDev: devEval?.data?.dev || '',
      latestDevEval: devEval ? { id: devEval.id, typ: devEval.typ, status: devEval.status, periodFrom: devEval.period_from, periodTo: devEval.period_to } : null,
      latestEvalId: latest?.id ?? null,
      goals,
    });
  }
  // Dashboard przełożonego
  const team = db.prepare("SELECT id,name,position,avatar,pass='' AS pending FROM users WHERE manager_id=? ORDER BY name").all(u.id);
  const evals = db.prepare('SELECT * FROM evals WHERE evaluator_id=? ORDER BY updated DESC').all(u.id).map(evalRow);
  const byEmp = {};
  for (const e of evals) if (!byEmp[e.employee_id]) byEmp[e.employee_id] = e; // najnowsza ocena per pracownik
  const counts = { draft: 0, submitted: 0, discussed: 0, none: 0 };
  const teamRows = team.map(t => {
    const e = byEmp[t.id];
    const st = e ? e.status : 'none';
    counts[st]++;
    const tc = timingCheck(empEvals(t.id), today());
    return { id: t.id, name: t.name, position: t.position, avatar: t.avatar || null, status: st, evalId: e?.id || null, typ: e?.typ || null, updated: e?.updated || null,
      nextDue: tc.nextDue, earliestNext: tc.earliest, pending: !!t.pending };
  });
  // Agregaty tylko przy n >= K_MIN (ochrona przed identyfikacją)
  const done = Object.values(byEmp).filter(e => e.status !== 'draft');
  let agg = { suppressed: true, n: done.length, kMin: K_MIN };
  if (done.length >= K_MIN) {
    const sums = {};
    for (const e of done) for (const [k, v] of Object.entries(scoreEval(e))) {
      if (v.avg === null) continue;
      sums[k] ??= { s: 0, n: 0 };
      sums[k].s += v.avg; sums[k].n++;
    }
    agg = { suppressed: false, n: done.length, kMin: K_MIN,
      competencies: Object.entries(sums).map(([k, v]) => ({ k, avg: +(v.s / v.n).toFixed(2) })).sort((a, b) => a.avg - b.avg) };
  }
  const goalsOpen = db.prepare(`SELECT COUNT(*) n FROM goals WHERE done=0 AND user_id IN (${team.map(() => '?').join(',') || 'NULL'})`).get(...team.map(t => t.id)).n;
  const alerts = [];
  for (const e of evals) {
    const emp = team.find(t => t.id === e.employee_id);
    if (e.objection_at) alerts.push({ kind: 'objection', evalId: e.id, name: emp?.name || '', text: 'Złożono sprzeciw – rozpatrz go' });
    else if (e.status === 'submitted' && !e.ack_at && Date.now() - Date.parse(e.updated) > 7 * 86400000) alerts.push({ kind: 'noack', evalId: e.id, name: emp?.name || '', text: 'Ocena złożona ponad 7 dni temu, brak zapoznania' });
  }
  const todayStr = now().slice(0, 10);
  const deadlines = team.map(t => {
    const mine = evals.filter(e => e.employee_id === t.id);
    const last = lastPeriodic(mine);
    const { nextDue: due, dueReason } = nextDueAfter(last);
    const days = due ? Math.round((Date.parse(due) - Date.parse(todayStr)) / 86400000) : null;
    const what = dueReason === 'ponowna_po_negatywnej' ? `Ponowna ocena po ocenie negatywnej (${REEVAL_MONTHS} mies.) do ${due}` : `Ocena okresowa do ${due}`;
    return { id: t.id, name: t.name, lastEval: last ? refDate(last) : null, due, days, dueReason, text: due ? (days < 0 ? `Termin minął (${due})` : what) : 'Brak poprzedniej oceny okresowej – sprawdź termin pierwszej oceny' };
  }).sort((a, b) => (a.days ?? 1e9) - (b.days ?? 1e9));
  const dueById = Object.fromEntries(deadlines.map(d => [d.id, d.due]));
  teamRows.forEach(r => { r.nextDue = dueById[r.id] || null; });
  // Cele: kroki zgłoszone przez pracownika, czekające na potwierdzenie przełożonego
  for (const r of teamRows) {
    r.goalsToConfirm = goalsOf(r.id).reduce((n, g) => n + g.stepsReported, 0);
    if (r.goalsToConfirm) alerts.push({ kind: 'goals', employeeId: r.id, name: r.name, text: `Kroki celów do potwierdzenia: ${r.goalsToConfirm}` });
  }
  // Rozmowa rozpoczynająca: po każdej ocenie okresowej, w ciągu 30 dni; potem zapoznanie pracownika (część I)
  for (const r of teamRows) {
    const last = lastPeriodic(evals.filter(e => e.employee_id === r.id));
    const k = latestKickoff(r.id);
    r.kickoff = k ? { id: k.id, date: k.date, ackAt: k.ack_at, typ: k.typ, evalId: k.eval_id } : null;
    const due = kickoffDue(last);
    const current = k && (!last || k.date >= refDate(last)); // rozmowa po ostatniej ocenie (albo przed pierwszą)
    if (due && !current) alerts.push({ kind: 'kickoff', employeeId: r.id, name: r.name, text: due < todayStr ? `Termin rozmowy rozpoczynającej nowy okres minął (${due})` : `Rozmowa rozpoczynająca nowy okres do ${due}` });
    else if (current && !k.ack_at) alerts.push({ kind: 'kickoff_ack', employeeId: r.id, name: r.name, text: `Rozmowa rozpoczynająca z ${k.date} czeka na zapoznanie pracownika` });
  }
  send(res, 200, { role: u.role, alerts, deadlines, team: teamRows, counts, evals: evals.map(e => ({ id: e.id, employeeId: e.employee_id, typ: e.typ, status: e.status, updated: e.updated })), aggregate: agg, goalsOpen });
});

route('POST', '/api/employees', async (req, res, u) => {
  if (u.role !== 'przelozony') return fail(res, 403, 'Tylko przełożony może dodawać pracowników.');
  const b = await readJson(req);
  // Hasło ustala wyłącznie pracownik (link aktywacyjny) – przełożony nie może znać hasła ocenianego (art. 83: zapoznanie, sprzeciw)
  if (b.password !== undefined) return invalid(res, { password: 'Hasło ustala pracownik przez link aktywacyjny.' }, 'Hasło ustala pracownik przez link aktywacyjny.');
  const email = str(b.email, 200).toLowerCase(), name = str(b.name, 120);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !name) return fail(res, 400, 'Podaj e-mail i imię i nazwisko.');
  let id;
  try {
    id = Number(db.prepare('INSERT INTO users(email,name,role,position,unit,manager_id,pass) VALUES(?,?,?,?,?,?,?)')
      .run(email, name, 'pracownik', str(b.position, 120), str(b.unit, 120), u.id, '').lastInsertRowid);
  } catch { return fail(res, 409, 'Konto z tym adresem już istnieje.'); }
  audit(u.id, 'create_employee', id);
  send(res, 201, { id, activation: issueActivation(req, { id, email }, u.id) });
});
// Nowy link aktywacyjny (np. po wygaśnięciu) – tylko dla nieaktywowanego konta z zespołu
route('POST', '/api/employees/:id/activation', async (req, res, u, p) => {
  if (u.role !== 'przelozony') return fail(res, 403, 'Brak dostępu.');
  const emp = db.prepare("SELECT id,email,pass FROM users WHERE id=? AND manager_id=? AND role='pracownik'").get(p.id, u.id);
  if (!emp) return fail(res, 404, 'Nie znaleziono pracownika w Twoim zespole.');
  if (emp.pass) return fail(res, 409, 'Konto jest już aktywne.');
  send(res, 201, { activation: issueActivation(req, emp, u.id) });
});

// Oceny
route('GET', '/api/evals', async (req, res, u) => {
  const rows = u.role === 'przelozony'
    ? db.prepare('SELECT * FROM evals WHERE evaluator_id=? ORDER BY updated DESC').all(u.id)
    : db.prepare("SELECT * FROM evals WHERE employee_id=? AND status!='draft' ORDER BY updated DESC").all(u.id);
  send(res, 200, { evals: rows.map(evalRow) });
});
route('POST', '/api/evals', async (req, res, u) => {
  if (u.role !== 'przelozony') return fail(res, 403, 'Tylko przełożony tworzy ocenę.');
  const b = await readJson(req);
  const emp = db.prepare('SELECT id FROM users WHERE id=? AND manager_id=?').get(Number(b.employeeId), u.id);
  if (!emp) return fail(res, 404, 'Nie znaleziono pracownika w Twoim zespole.');
  const typ = ['pierwsza', 'B', 'C'].includes(b.typ) ? b.typ : null;
  if (!typ) return fail(res, 400, 'Nieprawidłowy typ oceny.');
  const errs = {};
  for (const k of ['periodFrom', 'periodTo']) if (b[k] && !isDate(b[k])) errs[k] = 'Data: RRRR-MM-DD.';
  if (isDate(b.periodFrom) && isDate(b.periodTo) && b.periodFrom > b.periodTo) errs.periodTo = 'Koniec okresu nie może być przed początkiem.';
  if (Object.keys(errs).length) return invalid(res, errs);
  // Reguła 6 miesięcy między ocenami okresowymi (blokada z możliwością wyjątku zapisanego w dzienniku)
  let exception = null;
  if (typ !== 'pierwsza') {
    const tc = timingCheck(empEvals(emp.id), b.periodTo || today());
    if (!tc.ok) {
      const reason = exceptionReason(b);
      if (reason.length < 10) return fail(res, 409, TOO_EARLY(tc), { code: 'too_early', earliest: tc.earliest, prevDate: tc.prevDate, prevEvalId: tc.prevId });
      exception = { reason, by: u.id, at: now(), earliest: tc.earliest, prevEvalId: tc.prevId };
    }
  }
  // Rozmowa rozpoczynająca (zapoznana przez pracownika, jeszcze bez oceny, ten sam arkusz): kryteria dodatkowe
  // i początek okresu (dzień zapoznania z kryteriami) przechodzą do szkicu oceny
  const k = latestKickoff(emp.id);
  const kick = k && k.ack_at && !k.eval_id && k.typ === typ ? k : null;
  const extra = kick ? JSON.parse(kick.extra_criteria) : [];
  const data = sanitizeData({ criteria: [...mandKeysFor(typ), ...extra], ratings: {} }, typ);
  if (kick) data.kickoff = { id: kick.id, date: kick.date, ackAt: kick.ack_at, extraCriteria: extra };
  const periodFrom = str(b.periodFrom, 10) || (kick ? kick.ack_at.slice(0, 10) : '');
  const id = db.prepare('INSERT INTO evals(employee_id,evaluator_id,typ,period_from,period_to,status,data,created,updated,early_exception) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(emp.id, u.id, typ, periodFrom, str(b.periodTo, 10), 'draft', JSON.stringify(data), now(), now(), exception ? JSON.stringify(exception) : null).lastInsertRowid;
  if (kick) db.prepare('UPDATE kickoffs SET eval_id=? WHERE id=?').run(id, kick.id);
  audit(u.id, 'create_eval', id, null, { employeeId: emp.id, typ, periodFrom, periodTo: str(b.periodTo, 10), kickoffId: kick?.id ?? null });
  if (exception) audit(u.id, 'eval_early_exception', id, null, exception);
  send(res, 201, { id, earlyException: !!exception, kickoffId: kick?.id ?? null });
});
const ownEval = (u, id) => db.prepare('SELECT * FROM evals WHERE id=?').get(id) || null;
// Wyjątek od reguły 6 miesięcy dla istniejącego szkicu (np. po zmianie okresu) – z uzasadnieniem, w dzienniku
route('POST', '/api/evals/:id/early-exception', async (req, res, u, p) => {
  const ev = ownEval(u, p.id);
  if (!ev || ev.evaluator_id !== u.id || u.role !== 'przelozony') return fail(res, 403, 'Brak dostępu.');
  if (ev.status !== 'draft') return fail(res, 409, 'Wyjątek zapisuje się przed złożeniem oceny.');
  const b = await readJson(req);
  const reason = str(b.reason, 1000);
  if (reason.length < 10) return invalid(res, { reason: 'Uzasadnij wyjątek (min. 10 znaków).' });
  const tc = timingCheck(empEvals(ev.employee_id), refDate(ev), ev.id);
  const exception = { reason, by: u.id, at: now(), earliest: tc.earliest, prevEvalId: tc.prevId };
  db.prepare('UPDATE evals SET early_exception=? WHERE id=?').run(JSON.stringify(exception), ev.id);
  audit(u.id, 'eval_early_exception', ev.id, ev.early_exception ? JSON.parse(ev.early_exception) : null, exception);
  send(res, 200, { ok: true, timingOk: tc.ok });
});
route('GET', '/api/evals/:id/document', async (req, res, u, p) => {
  const ev = ownEval(u, p.id);
  if (!ev) return fail(res, 404, 'Nie znaleziono.');
  if (new URL(req.url, 'http://x').searchParams.get('variant') === 'szkic') return draftDocument(req, res, u, ev);
  const canSee = (u.role === 'przelozony' && ev.evaluator_id === u.id) || (u.role === 'pracownik' && ev.employee_id === u.id && ev.status !== 'draft');
  if (!canSee) return fail(res, 403, 'Brak dostępu.');
  const url = new URL(req.url, 'http://x');
  const format = url.searchParams.get('format') === 'xml' ? 'xml' : 'pdf';
  const inline = url.searchParams.get('inline') === '1';
  const kind = ev.typ;
  const emp = db.prepare('SELECT name,position,unit FROM users WHERE id=?').get(ev.employee_id);
  const mgr = db.prepare('SELECT name,position,unit FROM users WHERE id=?').get(ev.evaluator_id);
  const data = JSON.parse(ev.data || '{}');
  const model = MODEL;
  const ctx = { ev: { ...ev, data }, emp, mgr: { ...mgr }, model, mandB: MAND_B, mandC: MAND_C,
    unit: mgr.unit || process.env.KK_UNIT || 'Nazwa urzędu (uzupełnij)',
    statusLabel: { draft: 'szkic', submitted: 'złożona', discussed: 'omówiona' }[ev.status] };
  ctx.res = computeResults(ctx.ev, model);
  ctx.signatures = db.prepare('SELECT s.role,s.signed_at,s.doc_sha256,s.sig_value,s.signer_id,u.name FROM signatures s JOIN users u ON u.id=s.signer_id WHERE s.eval_id=? ORDER BY s.id').all(ev.id)
    .map(r => ({ ...r, valid: r.sig_value === sigValue(r.doc_sha256, r.signer_id, r.role, r.signed_at) }));
  ctx.ack = { ackAt: ev.ack_at, objectionAt: ev.objection_at, objectionText: ev.objection_text, deadline: ev.ack_at ? new Date(Date.parse(ev.ack_at) + 7 * 86400000).toISOString().slice(0, 10) : null };
  const base = `arkusz-${kind}-${ev.id}`;
  audit(u.id, 'download_doc', `${ev.id}:${format}`);
  if (format === 'xml') {
    const body = buildXml(kind, ctx);
    res.writeHead(200, { 'content-type': 'application/xml; charset=utf-8', 'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${base}.xml"`, 'cache-control': 'no-store', ...SECURITY });
    return res.end(body);
  }
  const pdfBytes = await buildFormPdf(kind, ctx);
  res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${base}.pdf"`, 'cache-control': 'no-store', ...SECURITY });
  res.end(Buffer.from(pdfBytes));
});
// Szkic dokumentu z informacji i check-inów okresu: bez poziomów, ocen cząstkowych i wyniku (uzupełnia oceniający)
async function draftDocument(req, res, u, ev) {
  if (u.role !== 'przelozony' || ev.evaluator_id !== u.id) return fail(res, 403, 'Szkic z informacji jest dla oceniającego.');
  const q = qs(req), format = q.get('format') === 'xml' ? 'xml' : 'pdf', inline = q.get('inline') === '1';
  const from = isDate(ev.period_from) ? ev.period_from : '0000-01-01', to = isDate(ev.period_to) ? ev.period_to : '9999-12-31';
  const ctx = { ev: { ...ev, data: JSON.parse(ev.data || '{}') }, model: MODEL,
    emp: db.prepare('SELECT name,position,unit FROM users WHERE id=?').get(ev.employee_id), mgr: db.prepare('SELECT name,position,unit FROM users WHERE id=?').get(ev.evaluator_id),
    evidence: db.prepare('SELECT * FROM evidence WHERE employee_id=? AND date>=? AND date<=? ORDER BY date').all(ev.employee_id, from, to).map(evidenceRow),
    feedback: db.prepare('SELECT * FROM feedback WHERE employee_id=? AND date>=? AND date<=? ORDER BY date').all(ev.employee_id, from, to).map(feedbackRow),
    checkins: db.prepare('SELECT * FROM checkins WHERE employee_id=? AND month>=? AND month<=? ORDER BY month').all(ev.employee_id, from.slice(0, 7), to.slice(0, 7)).map(checkinRow) };
  ctx.unit = ctx.mgr.unit || process.env.KK_UNIT || 'Nazwa urzędu (uzupełnij)';
  audit(u.id, 'download_draft', `${ev.id}:${format}`);
  const base = `szkic-oceny-${ev.id}`;
  if (format === 'xml') {
    res.writeHead(200, { 'content-type': 'application/xml; charset=utf-8', 'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${base}.xml"`, 'cache-control': 'no-store', ...SECURITY });
    return res.end(buildDraftXml(ctx));
  }
  const bytes = await buildDraftPdf(ctx);
  res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${base}.pdf"`, 'cache-control': 'no-store', ...SECURITY });
  res.end(Buffer.from(bytes));
}
// Trend na przestrzeni dwóch lat (etap 5): zmiana ocen cząstkowych między dwiema ostatnimi złożonymi ocenami okresowymi B/C.
// Tylko formalne oceny sporządzone przez człowieka; bez średniej, bez wyniku łącznego, bez prognozy; oceny kwartalne nie wchodzą.
route('GET', '/api/evals/compare', async (req, res, u) => {
  let evs;
  if (u.role === 'pracownik') evs = db.prepare("SELECT * FROM evals WHERE employee_id=? AND status!='draft' AND typ IN ('B','C')").all(u.id);
  else {
    const emp = teamMember(u, qs(req).get('employeeId'));
    if (!emp) return fail(res, 404, 'Nie znaleziono pracownika w Twoim zespole.');
    evs = db.prepare("SELECT * FROM evals WHERE employee_id=? AND evaluator_id=? AND status!='draft' AND typ IN ('B','C')").all(emp.id, u.id);
  }
  const [cur, prev] = evs.filter(e => refDate(e)).sort((a, b) => (refDate(a) < refDate(b) ? 1 : -1));
  if (!cur || !prev) return send(res, 200, { available: false, count: evs.length });
  const pts = ev => Object.fromEntries(computeResults({ ...ev, data: JSON.parse(ev.data || '{}') }, MODEL).crit.filter(c => c.partial !== null).map(c => [c.key, c.partial]));
  const a = pts(prev), b = pts(cur);
  const competencies = Object.keys(b).filter(k => k in a).map(k => ({ k, name: MODEL.find(c => c.k === k)?.n || k, previous: a[k], current: b[k],
    direction: b[k] > a[k] ? 'wzrost' : b[k] < a[k] ? 'spadek' : 'bez zmian' }));
  const ref = e => ({ id: e.id, typ: e.typ, date: refDate(e), periodFrom: e.period_from, periodTo: e.period_to });
  send(res, 200, { available: true, previousEval: ref(prev), currentEval: ref(cur), competencies });
});
route('GET', '/api/evals/:id', async (req, res, u, p) => {
  const ev = ownEval(u, p.id);
  if (!ev) return fail(res, 404, 'Nie znaleziono.');
  const canSee = (u.role === 'przelozony' && ev.evaluator_id === u.id) || (u.role === 'pracownik' && ev.employee_id === u.id && ev.status !== 'draft');
  if (!canSee) return fail(res, 403, 'Brak dostępu.');
  const emp = db.prepare('SELECT name,position,avatar FROM users WHERE id=?').get(ev.employee_id);
  const timing = u.role === 'przelozony' && ev.typ !== 'pierwsza' ? { ...timingCheck(empEvals(ev.employee_id), refDate(ev), ev.id), exception: ev.early_exception ? JSON.parse(ev.early_exception) : null } : null;
  const evaluator = db.prepare('SELECT name,position FROM users WHERE id=?').get(ev.evaluator_id);
  send(res, 200, { eval: evalRow(ev), employee: emp, evaluator, missing: u.role === 'przelozony' ? missingForSubmit(ev) : [], timing });
});
route('PUT', '/api/evals/:id', async (req, res, u, p) => {
  const ev = ownEval(u, p.id);
  if (!ev || ev.evaluator_id !== u.id || u.role !== 'przelozony') return fail(res, 403, 'Brak dostępu.');
  if (ev.status !== 'draft') return fail(res, 409, 'Ocena jest już złożona i nie można jej edytować.');
  const b = await readJson(req);
  const data = sanitizeData(b.data, ev.typ);
  // Ustalenia z rozmowy rozpoczynającej ustawia serwer – klient ich nie zmienia
  const kick0 = parseData(ev).kickoff;
  if (kick0) data.kickoff = kick0;
  const pf = str(b.periodFrom, 10) || ev.period_from, pt = str(b.periodTo, 10) || ev.period_to;
  db.prepare('UPDATE evals SET data=?, period_from=?, period_to=?, updated=? WHERE id=?')
    .run(JSON.stringify(data), pf, pt, now(), ev.id);
  // Dziennik: tylko zmienione pola (wskaźniki, oceny cząstkowe, pola formularza), z poprzednią i nową wartością
  const old = parseData(ev);
  const flat = (d, from, to) => ({ ...Object.fromEntries(Object.entries(d.ratings || {}).map(([k, v]) => [`ratings.${k}`, v])),
    ...Object.fromEntries(Object.entries(d.partials || {}).map(([k, v]) => [`partials.${k}`, v.pts])),
    criteria: d.criteria, dev: d.dev, rozmowa: d.rozmowa, terminOceny: d.terminOceny, uzasadnienie: d.uzasadnienie, wynik: d.wynik, periodFrom: from, periodTo: to });
  const ch = diffObj(flat(old, ev.period_from, ev.period_to), flat(data, pf, pt));
  if (ch) audit(u.id, 'update_eval', ev.id, ch.prev, ch.next);
  send(res, 200, { ok: true, missing: missingForSubmit({ ...ev, data: JSON.stringify(data) }) });
});
route('POST', '/api/evals/:id/submit', async (req, res, u, p) => {
  const ev = ownEval(u, p.id);
  if (!ev || ev.evaluator_id !== u.id || u.role !== 'przelozony') return fail(res, 403, 'Brak dostępu.');
  if (ev.status !== 'draft') return fail(res, 409, 'Ocena już złożona.');
  const miss = missingForSubmit(ev);
  if (miss.length) return fail(res, 422, 'Ocena nie jest kompletna.', { missing: miss.slice(0, 50) });
  if (ev.typ !== 'pierwsza' && !ev.early_exception) {
    const tc = timingCheck(empEvals(ev.employee_id), refDate(ev), ev.id);
    if (!tc.ok) return fail(res, 409, TOO_EARLY(tc), { code: 'too_early', earliest: tc.earliest, prevDate: tc.prevDate, prevEvalId: tc.prevId });
  }
  // Wynik oceny okresowej zapisujemy jako wartość wyliczoną z ocen cząstkowych (§ 11), nie wpisywaną ręcznie
  const data = parseData(ev);
  if (isSchema2(ev.typ, data)) {
    const r = computeResults({ ...ev, data }, MODEL);
    data.wynik = r.wynik; data.wynikSource = 'wyliczony'; data.wynikReasons = r.wynikReasons;
  }
  db.prepare("UPDATE evals SET status='submitted', data=?, updated=? WHERE id=?").run(JSON.stringify(data), now(), ev.id);
  audit(u.id, 'submit_eval', ev.id, { status: ev.status }, { status: 'submitted', wynik: data.wynik ?? null });
  send(res, 200, { ok: true });
});
route('POST', '/api/evals/:id/discuss', async (req, res, u, p) => {
  const ev = ownEval(u, p.id);
  if (!ev || ev.evaluator_id !== u.id || u.role !== 'przelozony') return fail(res, 403, 'Brak dostępu.');
  if (ev.status !== 'submitted') return fail(res, 409, 'Najpierw złóż ocenę.');
  const b = await readJson(req);
  const data = JSON.parse(ev.data); const prevDev = data.dev ?? null; data.dev = str(b.dev, 2000) || data.dev;
  db.prepare("UPDATE evals SET status='discussed', data=?, updated=? WHERE id=?").run(JSON.stringify(data), now(), ev.id);
  audit(u.id, 'discuss_eval', ev.id, { status: ev.status, dev: prevDev }, { status: 'discussed', dev: data.dev ?? null });
  send(res, 200, { ok: true });
});

// Cele SMART (pracownik)
// ---------- Plan rozwoju i komunikat (pisze przełożony, pracownik czyta) ----------
const devPlanRow = r => r && ({ id: r.id, plan: r.plan, message: r.message, created: r.created, author: 'przełożony' });
const devPlansOf = empId => db.prepare('SELECT * FROM dev_plans WHERE employee_id=? ORDER BY id DESC').all(empId).map(devPlanRow);
route('GET', '/api/devplan', async (req, res, u) => {
  const empId = u.role === 'pracownik' ? u.id : teamMember(u, qs(req).get('employeeId'))?.id;
  if (!empId) return fail(res, 404, 'Nie znaleziono pracownika w Twoim zespole.');
  const list = devPlansOf(empId);
  send(res, 200, { current: list[0] || null, history: list.slice(1, 20) });
});
route('PUT', '/api/devplan', async (req, res, u) => {
  if (u.role !== 'przelozony') return fail(res, 403, 'Plan rozwoju pisze przełożony.');
  const b = await readJson(req);
  const emp = teamMember(u, b.employeeId);
  if (!emp) return fail(res, 404, 'Nie znaleziono pracownika w Twoim zespole.');
  const plan = str(b.plan, 3000), message = str(b.message, 1000);
  if (plan.length < 10) return invalid(res, { plan: 'Opisz plan rozwoju (min. 10 znaków).' }, 'Opisz plan rozwoju (min. 10 znaków).');
  const prev = devPlansOf(emp.id)[0] || null;
  if (prev && prev.plan === plan && prev.message === message) return send(res, 200, { current: prev, changed: false });
  const id = db.prepare('INSERT INTO dev_plans(employee_id,author_id,plan,message,created) VALUES(?,?,?,?,?)').run(emp.id, u.id, plan, message, now()).lastInsertRowid;
  audit(u.id, 'update_devplan', `devplan:${emp.id}`, prev ? { plan: prev.plan, message: prev.message } : null, { plan, message });
  send(res, 200, { current: devPlanRow(db.prepare('SELECT * FROM dev_plans WHERE id=?').get(id)), changed: true });
});

// Cele SMART wyznacza przełożony (moduł przełożonego, etap 3). Każdy krok jest sprawdzalny:
// pracownik ZGŁASZA wykonanie, przełożony POTWIERDZA. Postęp = potwierdzone kroki / wszystkie (deterministycznie).
// Krok: { t, reported_at, confirmed_at, confirmed_by }. Cel bez kroków (sprzed zmian) ma tylko stan zrealizowany / w toku.
const GOAL_STEPS_MAX = 8, GOAL_YEARS_MAX = 5;
const newStep = t => ({ t, reported_at: null, confirmed_at: null, confirmed_by: null });
const goalProgress = steps => (steps.length ? Math.round(steps.filter(x => x.confirmed_at).length / steps.length * 100) : null);
const goalRow = g => {
  const steps = JSON.parse(g.steps || '[]');
  return { ...g, steps, done: !!g.done, legacy: !g.created_by, stepsConfirmed: steps.filter(x => x.confirmed_at).length,
    stepsReported: steps.filter(x => x.reported_at && !x.confirmed_at).length };
};
const goalsOf = uid => db.prepare('SELECT * FROM goals WHERE user_id=? ORDER BY done, t, id').all(uid).map(goalRow);
const stepText = t => str(t, 150);
const goalAuditView = g => ({ s: g.s, m: g.m, a: g.a, r: g.r, t: g.t, done: !!g.done, steps: typeof g.steps === 'string' ? JSON.parse(g.steps) : g.steps });
function validateGoal(b, partial = false) {
  const errors = {}, v = {};
  for (const [k, label] of [['s', 'Konkretnie'], ['m', 'Mierzalnie'], ['a', 'Osiągalnie'], ['r', 'Istotnie']]) {
    if (partial && b[k] === undefined) continue;
    v[k] = str(b[k], 200); if (!v[k]) errors[k] = `Uzupełnij pole „${label}”.`;
  }
  if (!partial || b.t !== undefined) {
    const t = typeof b.t === 'string' ? b.t : '';
    const maxT = `${+today().slice(0, 4) + GOAL_YEARS_MAX}${today().slice(4)}`;
    if (!isDate(t)) errors.t = 'Podaj prawdziwą datę (DD.MM.RRRR).';
    else if (t < today()) errors.t = 'Termin nie może być w przeszłości.';
    else if (t > maxT) errors.t = `Termin najpóźniej za ${GOAL_YEARS_MAX} lat.`;
    else v.t = t;
  }
  return { v, errors };
}
route('GET', '/api/goals', async (req, res, u) => {
  if (u.role === 'pracownik') return send(res, 200, { goals: goalsOf(u.id) });
  const q = qs(req);
  const ids = q.get('employeeId') ? [teamMember(u, q.get('employeeId'))?.id].filter(Boolean)
    : db.prepare("SELECT id FROM users WHERE manager_id=? AND role='pracownik'").all(u.id).map(r => r.id);
  send(res, 200, { goals: ids.flatMap(goalsOf) });
});
route('POST', '/api/goals', async (req, res, u) => {
  if (u.role !== 'przelozony') return fail(res, 403, 'Cele wyznacza przełożony. Swoje propozycje zgłoś na rozmowie miesięcznej.');
  const b = await readJson(req);
  const emp = teamMember(u, b.employeeId);
  if (!emp) return fail(res, 404, 'Nie znaleziono pracownika w Twoim zespole.');
  const { v, errors } = validateGoal(b);
  const steps = Array.isArray(b.steps) ? b.steps.map(stepText).filter(Boolean) : [];
  if (!steps.length) errors.steps = 'Dodaj co najmniej jeden krok – po nim widać postęp.';
  else if (steps.length > GOAL_STEPS_MAX) errors.steps = `Najwyżej ${GOAL_STEPS_MAX} kroków.`;
  if (Object.keys(errors).length) return invalid(res, errors, Object.values(errors)[0]);
  const id = db.prepare('INSERT INTO goals(user_id,s,m,a,r,t,done,progress,steps,created_by,created) VALUES(?,?,?,?,?,?,0,0,?,?,?)')
    .run(emp.id, v.s, v.m, v.a, v.r, v.t, JSON.stringify(steps.map(newStep)), u.id, now()).lastInsertRowid;
  const row = db.prepare('SELECT * FROM goals WHERE id=?').get(id);
  audit(u.id, 'create_goal', `goal:${id}`, null, { employeeId: emp.id, ...goalAuditView(row) });
  send(res, 201, { id, goal: goalRow(row) });
});
// Trend między spotkaniami (etap 5): potwierdzone kroki narastająco na koniec każdego miesiąca + miesiące z odbytą rozmową
route('GET', '/api/goals/trend', async (req, res, u) => {
  const empId = u.role === 'pracownik' ? u.id : teamMember(u, qs(req).get('employeeId'))?.id;
  if (!empId) return fail(res, 404, 'Nie znaleziono pracownika w Twoim zespole.');
  const nowM = today().slice(0, 7);
  const checkins = db.prepare("SELECT month, date FROM checkins WHERE employee_id=? AND status='odbyty' ORDER BY month").all(empId);
  const lastTalk = checkins.length ? (checkins[checkins.length - 1].date || `${checkins[checkins.length - 1].month}-01`) : null;
  const goals = goalsOf(empId).filter(g => g.steps.length).map(g => {
    const months = monthsBetween(g.created.slice(0, 10), `${nowM}-01`).slice(-24);
    const series = months.map(m => ({ month: m, confirmed: g.steps.filter(x => x.confirmed_at && x.confirmed_at.slice(0, 7) <= m).length }));
    const sinceLastTalk = lastTalk ? g.steps.filter(x => x.confirmed_at && x.confirmed_at.slice(0, 10) > lastTalk).length : null;
    return { id: g.id, total: g.steps.length, series, talks: checkins.map(c => c.month).filter(m => months.includes(m)), sinceLastTalk };
  });
  send(res, 200, { lastTalk, goals });
});
// Pracownik (właściciel): { step, reported } – zgłasza / cofa zgłoszenie (nie cofa kroku potwierdzonego).
// Przełożony (cel osoby z zespołu): { step, confirmed }, { addStep }, zmiana s/m/a/r/t.
// Cel bez kroków: { done } – właściciel albo przełożony.
route('PATCH', '/api/goals/:id', async (req, res, u, p) => {
  const g = db.prepare('SELECT * FROM goals WHERE id=?').get(p.id);
  const isOwner = g && u.role === 'pracownik' && g.user_id === u.id;
  const isMgr = g && u.role === 'przelozony' && !!teamMember(u, g.user_id);
  if (!isOwner && !isMgr) return fail(res, 404, 'Nie znaleziono celu.');
  const b = await readJson(req);
  const steps = JSON.parse(g.steps || '[]');
  const next = { ...g };
  let action;
  const stepAt = () => { const i = Number(b.step); return Number.isInteger(i) && steps[i] ? steps[i] : null; };
  if (b.reported !== undefined) {
    if (!isOwner) return fail(res, 403, 'Wykonanie kroku zgłasza pracownik.');
    const st = stepAt(); if (!st) return invalid(res, { step: 'Nie ma takiego kroku.' });
    if (st.confirmed_at) return fail(res, 409, 'Krok jest już potwierdzony przez przełożonego.');
    st.reported_at = b.reported ? now() : null; action = 'goal_step_report';
  } else if (b.confirmed !== undefined) {
    if (!isMgr) return fail(res, 403, 'Krok potwierdza przełożony.');
    const st = stepAt(); if (!st) return invalid(res, { step: 'Nie ma takiego kroku.' });
    if (b.confirmed) { st.confirmed_at = now(); st.confirmed_by = u.id; } else { st.confirmed_at = null; st.confirmed_by = null; }
    action = 'goal_step_confirm';
  } else if (b.addStep !== undefined) {
    if (!isMgr) return fail(res, 403, 'Kroki dodaje przełożony.');
    const t = stepText(b.addStep);
    if (!t) return invalid(res, { addStep: 'Opisz krok.' });
    if (steps.length >= GOAL_STEPS_MAX) return invalid(res, { addStep: `Najwyżej ${GOAL_STEPS_MAX} kroków.` });
    steps.push(newStep(t)); action = 'update_goal';
  } else if (['s', 'm', 'a', 'r', 't'].some(k => b[k] !== undefined)) {
    if (!isMgr) return fail(res, 403, 'Cel zmienia przełożony.');
    const { v, errors } = validateGoal(b, true);
    if (Object.keys(errors).length) return invalid(res, errors, Object.values(errors)[0]);
    Object.assign(next, v); action = 'update_goal';
  } else if (b.done !== undefined) {
    if (steps.length) return invalid(res, { done: 'Cel z krokami jest zrealizowany, gdy przełożony potwierdzi wszystkie kroki.' });
    next.done = b.done ? 1 : 0; action = 'update_goal';
  } else return invalid(res, { step: 'Brak zmiany.' });
  const progress = goalProgress(steps);
  next.steps = JSON.stringify(steps);
  if (steps.length) next.done = progress === 100 ? 1 : 0;
  next.progress = progress ?? (next.done ? 100 : 0);
  db.prepare('UPDATE goals SET s=?,m=?,a=?,r=?,t=?,steps=?,done=?,progress=? WHERE id=?').run(next.s, next.m, next.a, next.r, next.t, next.steps, next.done, next.progress, g.id);
  const ch = diffObj(goalAuditView(g), goalAuditView(next));
  if (ch) audit(u.id, action, `goal:${g.id}`, ch.prev, ch.next);
  send(res, 200, { ok: true, goal: goalRow(db.prepare('SELECT * FROM goals WHERE id=?').get(g.id)) });
});

// ---------- Informacje (wskaźniki z app/kompetencje.js) ----------
const EVIDENCE_FIELDS = ['employeeId', 'date', 'indicator', 'situation', 'action', 'result', 'link', 'taskRef'];
function sanitizeEvidence(b, partial = false) {
  const errors = {}, v = {};
  const need = (k, ok, msg) => { if (b[k] === undefined && partial) return false; if (!ok) errors[k] = msg; return ok; };
  for (const k of Object.keys(b || {})) if (!EVIDENCE_FIELDS.includes(k)) errors[k] = 'Nieznane pole.';
  if (need('date', isDate(b.date) && b.date <= today(), 'Podaj datę zdarzenia (RRRR-MM-DD), nie późniejszą niż dziś.')) v.date = b.date;
  if (need('indicator', INDICATORS.has(b.indicator), 'Wybierz wskaźnik z modelu kompetencji.')) v.indicator = b.indicator;
  for (const [k, label] of [['situation', 'sytuację'], ['action', 'działanie'], ['result', 'rezultat']]) {
    const t = str(b[k], 1000);
    if (need(k, t.length >= 3, `Opisz ${label} (min. 3 znaki).`)) v[k] = t;
  }
  if (b.link !== undefined && b.link !== '' && b.link !== null) {
    let ok = false; try { const url = new URL(String(b.link)); ok = ['http:', 'https:'].includes(url.protocol) && String(b.link).length <= 500; } catch { /* zły adres */ }
    if (!ok) errors.link = 'Link musi być adresem http(s) (maks. 500 znaków).'; else v.link = String(b.link);
  } else if (b.link !== undefined) v.link = null;
  if (b.taskRef !== undefined) v.task_ref = str(b.taskRef, 100) || null;
  return { value: v, errors };
}
const evidenceRow = r => r && ({ id: r.id, employeeId: r.employee_id, evaluatorId: r.evaluator_id, date: r.date, indicator: r.indicator,
  competency: INDICATORS.get(r.indicator)?.k || null, indicatorText: INDICATORS.get(r.indicator)?.text || '', situation: r.situation, action: r.action,
  result: r.result, link: r.link, taskRef: r.task_ref, created: r.created, updated: r.updated });
const evidenceAuditView = r => ({ date: r.date, indicator: r.indicator, situation: r.situation, action: r.action, result: r.result, link: r.link ?? null, task_ref: r.task_ref ?? null });
// Filtr: employeeId, indicator (KOMP|nr) lub competency (KOMP), from/to (RRRR-MM-DD) lub month (RRRR-MM)
function evidenceQuery(u, q) {
  const where = [], args = [];
  if (u.role === 'pracownik') { where.push('employee_id=?'); args.push(u.id); }
  else {
    where.push('employee_id IN (SELECT id FROM users WHERE manager_id=?)'); args.push(u.id);
    if (q.get('employeeId')) { where.push('employee_id=?'); args.push(Number(q.get('employeeId'))); }
  }
  if (q.get('indicator')) { where.push('indicator=?'); args.push(q.get('indicator')); }
  if (q.get('competency')) { where.push("substr(indicator,1,length(?)+1)=?||'|'"); args.push(q.get('competency'), q.get('competency')); }
  const month = q.get('month');
  const from = isMonth(month) ? `${month}-01` : q.get('from'), to = isMonth(month) ? monthEnd(month) : q.get('to');
  if (isDate(from)) { where.push('date>=?'); args.push(from); }
  if (isDate(to)) { where.push('date<=?'); args.push(to); }
  return db.prepare(`SELECT * FROM evidence WHERE ${where.join(' AND ')} ORDER BY date DESC, id DESC LIMIT 1000`).all(...args);
}
route('GET', '/api/evidence', async (req, res, u) => {
  const q = qs(req);
  for (const [k, ok] of [['from', isDate], ['to', isDate], ['month', isMonth]]) if (q.get(k) && !ok(q.get(k))) return invalid(res, { [k]: 'Nieprawidłowy format daty.' });
  if (q.get('indicator') && !INDICATORS.has(q.get('indicator'))) return invalid(res, { indicator: 'Nieznany wskaźnik.' });
  if (u.role === 'pracownik' && !modOn('mod_employee_evidence')) return send(res, 200, { evidence: [] });
  send(res, 200, { evidence: evidenceQuery(u, q).map(evidenceRow) });
});
route('POST', '/api/evidence', async (req, res, u) => {
  if (u.role !== 'przelozony') return fail(res, 403, 'Informacje dodaje przełożony.');
  const b = await readJson(req);
  const emp = teamMember(u, b.employeeId);
  if (!emp) return fail(res, 404, 'Nie znaleziono pracownika w Twoim zespole.');
  const { value: v, errors } = sanitizeEvidence(b);
  if (Object.keys(errors).length) return invalid(res, errors);
  const at = now();
  const id = db.prepare('INSERT INTO evidence(employee_id,evaluator_id,date,indicator,situation,action,result,link,task_ref,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(emp.id, u.id, v.date, v.indicator, v.situation, v.action, v.result, v.link ?? null, v.task_ref ?? null, at, at).lastInsertRowid;
  const row = db.prepare('SELECT * FROM evidence WHERE id=?').get(id);
  audit(u.id, 'create_evidence', `evidence:${id}`, null, { employeeId: emp.id, ...evidenceAuditView(row) });
  send(res, 201, { evidence: evidenceRow(row) });
});
route('PUT', '/api/evidence/:id', async (req, res, u, p) => {
  if (u.role !== 'przelozony') return fail(res, 403, 'Informacje edytuje przełożony.');
  const cur = db.prepare('SELECT * FROM evidence WHERE id=?').get(p.id);
  if (!cur || !teamMember(u, cur.employee_id)) return fail(res, 404, 'Nie znaleziono informacji.');
  const b = await readJson(req);
  if (b.employeeId !== undefined && Number(b.employeeId) !== cur.employee_id) return invalid(res, { employeeId: 'Nie można przenieść informacji na inną osobę.' });
  const { value: v, errors } = sanitizeEvidence(b, true);
  if (Object.keys(errors).length) return invalid(res, errors);
  const next = { ...cur, ...v };
  const ch = diffObj(evidenceAuditView(cur), evidenceAuditView(next));
  if (!ch) return send(res, 200, { evidence: evidenceRow(cur), changed: false });
  db.prepare('UPDATE evidence SET date=?,indicator=?,situation=?,action=?,result=?,link=?,task_ref=?,updated=? WHERE id=?')
    .run(next.date, next.indicator, next.situation, next.action, next.result, next.link ?? null, next.task_ref ?? null, now(), cur.id);
  audit(u.id, 'update_evidence', `evidence:${cur.id}`, ch.prev, ch.next);
  send(res, 200, { evidence: evidenceRow(db.prepare('SELECT * FROM evidence WHERE id=?').get(cur.id)), changed: true });
});

// ---------- Rytm miesięczny: check-iny ----------
const CHECKIN_FIELDS = ['employeeId', 'month', 'done', 'attention', 'goal', 'date', 'status'];
const SCORE_KEYS = /^(level|lvl|pts|punkty|ocena|score|wynik|poziom)$/i;
function sanitizeCheckin(b, partial = false) {
  const errors = {}, v = {};
  for (const k of Object.keys(b || {})) {
    if (SCORE_KEYS.test(k)) errors[k] = 'Check-in nie zawiera punktacji – to rozmowa, nie ocena.';
    else if (!CHECKIN_FIELDS.includes(k)) errors[k] = 'Nieznane pole.';
  }
  if (!(partial && b.month === undefined)) {
    if (!isMonth(b.month) || b.month > today().slice(0, 7)) errors.month = 'Podaj miesiąc (RRRR-MM), nie późniejszy niż bieżący.'; else v.month = b.month;
  }
  for (const [k, col] of [['done', 'done_text'], ['attention', 'attention_text'], ['goal', 'goal_text']]) if (b[k] !== undefined) v[col] = str(b[k], 600);
  if (b.date !== undefined) { if (b.date === '' || b.date === null) v.date = null; else if (!isDate(b.date) || b.date > today()) errors.date = 'Data rozmowy: RRRR-MM-DD, nie w przyszłości.'; else v.date = b.date; }
  if (b.status !== undefined) { if (!['planowany', 'odbyty'].includes(b.status)) errors.status = 'Status: planowany albo odbyty.'; else v.status = b.status; }
  return { value: v, errors };
}
const checkinRow = r => r && ({ id: r.id, employeeId: r.employee_id, evaluatorId: r.evaluator_id, month: r.month, done: r.done_text, attention: r.attention_text,
  goal: r.goal_text, date: r.date, status: r.status, created: r.created, updated: r.updated });
const checkinAuditView = r => ({ month: r.month, done: r.done_text, attention: r.attention_text, goal: r.goal_text, date: r.date ?? null, status: r.status });
// Odbyty check-in musi mieć datę i wszystkie trzy pola (krótko – formularz na ok. 20 minut rozmowy)
const checkinComplete = r => (r.status !== 'odbyty' ? null
  : !r.date ? { date: 'Podaj datę odbytej rozmowy.' }
  : ['done_text', 'attention_text', 'goal_text'].some(k => !(r[k] || '').trim()) ? { done: 'Uzupełnij trzy pola: co zrobiono, co wymaga uwagi, jeden cel.' } : null);
function scopedWhere(u, q, alias = '') {
  const where = [], args = [], a = alias ? alias + '.' : '';
  if (u.role === 'pracownik') { where.push(`${a}employee_id=?`); args.push(u.id); }
  else {
    where.push(`${a}employee_id IN (SELECT id FROM users WHERE manager_id=?)`); args.push(u.id);
    if (q.get('employeeId')) { where.push(`${a}employee_id=?`); args.push(Number(q.get('employeeId'))); }
  }
  return { where, args };
}
route('GET', '/api/checkins', async (req, res, u) => {
  const q = qs(req);
  if (q.get('month') && !isMonth(q.get('month'))) return invalid(res, { month: 'Nieprawidłowy miesiąc.' });
  const { where, args } = scopedWhere(u, q);
  if (q.get('month')) { where.push('month=?'); args.push(q.get('month')); }
  send(res, 200, { checkins: db.prepare(`SELECT * FROM checkins WHERE ${where.join(' AND ')} ORDER BY month DESC`).all(...args).map(checkinRow) });
});
route('POST', '/api/checkins', async (req, res, u) => {
  if (u.role !== 'przelozony') return fail(res, 403, 'Check-in zapisuje przełożony.');
  const b = await readJson(req);
  const emp = teamMember(u, b.employeeId);
  if (!emp) return fail(res, 404, 'Nie znaleziono pracownika w Twoim zespole.');
  const { value: v, errors } = sanitizeCheckin(b);
  const row = { done_text: '', attention_text: '', goal_text: '', date: null, status: 'planowany', ...v };
  Object.assign(errors, Object.keys(errors).length ? {} : checkinComplete(row) || {});
  if (Object.keys(errors).length) return invalid(res, errors);
  if (db.prepare('SELECT id FROM checkins WHERE employee_id=? AND month=?').get(emp.id, row.month)) return fail(res, 409, 'Check-in za ten miesiąc już istnieje – edytuj go.');
  const at = now();
  const id = db.prepare('INSERT INTO checkins(employee_id,evaluator_id,month,done_text,attention_text,goal_text,date,status,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(emp.id, u.id, row.month, row.done_text, row.attention_text, row.goal_text, row.date, row.status, at, at).lastInsertRowid;
  const saved = db.prepare('SELECT * FROM checkins WHERE id=?').get(id);
  audit(u.id, 'create_checkin', `checkin:${id}`, null, { employeeId: emp.id, ...checkinAuditView(saved) });
  send(res, 201, { checkin: checkinRow(saved) });
});
route('PUT', '/api/checkins/:id', async (req, res, u, p) => {
  if (u.role !== 'przelozony') return fail(res, 403, 'Check-in edytuje przełożony.');
  const cur = db.prepare('SELECT * FROM checkins WHERE id=?').get(p.id);
  if (!cur || !teamMember(u, cur.employee_id)) return fail(res, 404, 'Nie znaleziono check-inu.');
  const b = await readJson(req);
  if (b.employeeId !== undefined && Number(b.employeeId) !== cur.employee_id) return invalid(res, { employeeId: 'Nie można przenieść check-inu na inną osobę.' });
  if (b.month !== undefined && b.month !== cur.month) return invalid(res, { month: 'Miesiąca check-inu nie zmienia się – utwórz nowy.' });
  const { value: v, errors } = sanitizeCheckin(b, true);
  const next = { ...cur, ...v };
  Object.assign(errors, Object.keys(errors).length ? {} : checkinComplete(next) || {});
  if (Object.keys(errors).length) return invalid(res, errors);
  const ch = diffObj(checkinAuditView(cur), checkinAuditView(next));
  if (!ch) return send(res, 200, { checkin: checkinRow(cur), changed: false });
  db.prepare('UPDATE checkins SET done_text=?,attention_text=?,goal_text=?,date=?,status=?,updated=? WHERE id=?')
    .run(next.done_text, next.attention_text, next.goal_text, next.date, next.status, now(), cur.id);
  audit(u.id, 'update_checkin', `checkin:${cur.id}`, ch.prev, ch.next);
  send(res, 200, { checkin: checkinRow(db.prepare('SELECT * FROM checkins WHERE id=?').get(cur.id)), changed: true });
});

// ---------- Feedback o rezultacie zadania ----------
const FEEDBACK_FIELDS = ['employeeId', 'indicator', 'source', 'level', 'justification', 'relation', 'date'];
// Zakaz pól o czasie pracy, obecności i aktywności (monitoring) – feedback dotyczy rezultatu zadania, nie osoby
const FEEDBACK_FORBIDDEN = /(czas|godzin|obecn|nieobecn|aktywn|hours?|time|attendance|presence|activity|online|login|klik|click|keystroke|screen)/i;
const RELATIONS = { przelozony: 'przełożony bezpośredni', wspolpracownik: 'współpracownik (przekazane przełożonemu)', odbiorca: 'odbiorca rezultatu (przekazane przełożonemu)' };
function sanitizeFeedback(b, partial = false) {
  const errors = {}, v = {};
  for (const k of Object.keys(b || {})) {
    if (FEEDBACK_FORBIDDEN.test(k)) errors[k] = 'Feedback dotyczy rezultatu zadania. Nie zapisujemy czasu pracy, obecności ani aktywności.';
    else if (!FEEDBACK_FIELDS.includes(k)) errors[k] = 'Nieznane pole.';
  }
  const need = (k, ok, msg) => { if (b[k] === undefined && partial) return false; if (!ok) errors[k] = msg; return ok; };
  if (need('indicator', INDICATORS.has(b.indicator), 'Wybierz wskaźnik z modelu kompetencji.')) v.indicator = b.indicator;
  const src = str(b.source, 300);
  if (need('source', src.length >= 3, 'Podaj źródło: zadanie, sprawę lub artefakt, którego dotyczy feedback.')) v.source = src;
  const just = str(b.justification, 2000);
  if (need('justification', just.length >= 10, 'Uzasadnienie jest wymagane (min. 10 znaków): opisz rezultat zadania.')) v.justification = just;
  if (need('relation', Object.hasOwn(RELATIONS, b.relation), 'Wybierz relację autora do rezultatu.')) v.relation = b.relation;
  if (need('date', isDate(b.date) && b.date <= today(), 'Podaj datę zdarzenia (RRRR-MM-DD), nie późniejszą niż dziś.')) v.date = b.date;
  if (b.level !== undefined) {
    if (b.level === null || b.level === '') v.level = null;
    else if (!PTS5.includes(Number(b.level))) errors.level = 'Poziom (opcjonalny): 1, 3, 5, 7 lub 9.';
    else v.level = Number(b.level);
  }
  return { value: v, errors };
}
const feedbackRow = r => r && ({ id: r.id, employeeId: r.employee_id, authorId: r.author_id, indicator: r.indicator, competency: INDICATORS.get(r.indicator)?.k || null,
  indicatorText: INDICATORS.get(r.indicator)?.text || '', source: r.source, level: r.level, justification: r.justification, relation: r.relation,
  relationLabel: RELATIONS[r.relation] || r.relation, date: r.date, created: r.created, updated: r.updated });
const feedbackAuditView = r => ({ indicator: r.indicator, source: r.source, level: r.level ?? null, justification: r.justification, relation: r.relation, date: r.date });
route('GET', '/api/feedback', async (req, res, u) => {
  const q = qs(req);
  const { where, args } = scopedWhere(u, q);
  if (q.get('indicator')) { if (!INDICATORS.has(q.get('indicator'))) return invalid(res, { indicator: 'Nieznany wskaźnik.' }); where.push('indicator=?'); args.push(q.get('indicator')); }
  const month = q.get('month');
  if (month && !isMonth(month)) return invalid(res, { month: 'Nieprawidłowy miesiąc.' });
  const from = month ? `${month}-01` : q.get('from'), to = month ? monthEnd(month) : q.get('to');
  if (isDate(from)) { where.push('date>=?'); args.push(from); }
  if (isDate(to)) { where.push('date<=?'); args.push(to); }
  send(res, 200, { feedback: db.prepare(`SELECT * FROM feedback WHERE ${where.join(' AND ')} ORDER BY date DESC, id DESC LIMIT 1000`).all(...args).map(feedbackRow), relations: RELATIONS });
});
route('POST', '/api/feedback', async (req, res, u) => {
  if (u.role !== 'przelozony') return fail(res, 403, 'Feedback zapisuje przełożony.');
  const b = await readJson(req);
  const { value: v, errors } = sanitizeFeedback(b);
  if (Object.keys(errors).length) return invalid(res, errors);
  const emp = teamMember(u, b.employeeId);
  if (!emp) return fail(res, 404, 'Nie znaleziono pracownika w Twoim zespole.');
  const at = now();
  const id = db.prepare('INSERT INTO feedback(employee_id,author_id,indicator,source,level,justification,relation,date,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(emp.id, u.id, v.indicator, v.source, v.level ?? null, v.justification, v.relation, v.date, at, at).lastInsertRowid;
  const row = db.prepare('SELECT * FROM feedback WHERE id=?').get(id);
  audit(u.id, 'create_feedback', `feedback:${id}`, null, { employeeId: emp.id, ...feedbackAuditView(row) });
  send(res, 201, { feedback: feedbackRow(row) });
});
route('PUT', '/api/feedback/:id', async (req, res, u, p) => {
  const cur = db.prepare('SELECT * FROM feedback WHERE id=?').get(p.id);
  if (!cur || cur.author_id !== u.id) return fail(res, cur ? 403 : 404, cur ? 'Feedback edytuje jego autor.' : 'Nie znaleziono feedbacku.');
  const b = await readJson(req);
  if (b.employeeId !== undefined && Number(b.employeeId) !== cur.employee_id) return invalid(res, { employeeId: 'Nie można przenieść feedbacku na inną osobę.' });
  const { value: v, errors } = sanitizeFeedback(b, true);
  if (Object.keys(errors).length) return invalid(res, errors);
  const next = { ...cur, ...v };
  const ch = diffObj(feedbackAuditView(cur), feedbackAuditView(next));
  if (!ch) return send(res, 200, { feedback: feedbackRow(cur), changed: false });
  db.prepare('UPDATE feedback SET indicator=?,source=?,level=?,justification=?,relation=?,date=?,updated=? WHERE id=?')
    .run(next.indicator, next.source, next.level ?? null, next.justification, next.relation, next.date, now(), cur.id);
  audit(u.id, 'update_feedback', `feedback:${cur.id}`, ch.prev, ch.next);
  send(res, 200, { feedback: feedbackRow(db.prepare('SELECT * FROM feedback WHERE id=?').get(cur.id)), changed: true });
});

// ---------- Oceny cząstkowe kwartalne (przyznaje oceniający, z uzasadnieniem i informacjami) ----------
const PARTIAL_FIELDS = ['employeeId', 'quarter', 'competency', 'pts', 'justification', 'evidenceIds'];
function sanitizePartial(b, empId, partial = false, cur = null) {
  const errors = {}, v = {};
  for (const k of Object.keys(b || {})) {
    if (/^(month|miesiac)$/i.test(k)) errors[k] = 'Ocena cząstkowa jest przypisana do kwartału, nie do miesiąca.';
    else if (!PARTIAL_FIELDS.includes(k)) errors[k] = 'Nieznane pole.';
  }
  const need = (k, ok, msg) => { if (b[k] === undefined && partial) return false; if (!ok) errors[k] = msg; return ok; };
  if (need('quarter', isQuarter(b.quarter) && quarterRange(b.quarter)[0] <= today(), 'Podaj kwartał (RRRR-Qn), który już się rozpoczął.')) v.quarter = b.quarter;
  if (need('competency', MODEL_KEYS.has(b.competency), 'Wybierz kryterium (kompetencję) z modelu.')) v.competency = b.competency;
  if (need('pts', PTS5.includes(Number(b.pts)), 'Ocena cząstkowa: 1, 3, 5, 7 lub 9 pkt.')) v.pts = Number(b.pts);
  const just = str(b.justification, 2000);
  if (need('justification', just.length >= 10, 'Uzasadnienie jest wymagane (min. 10 znaków).')) v.justification = just;
  if (need('evidenceIds', Array.isArray(b.evidenceIds) && b.evidenceIds.length > 0 && b.evidenceIds.length <= 50, 'Wskaż co najmniej jedną informację.')) v.evidenceIds = [...new Set(b.evidenceIds.map(Number))];
  // Informacje: tej samej osoby, z tego kryterium i z tego kwartału
  const quarter = v.quarter || cur?.quarter, comp = v.competency || cur?.competency;
  const ids = v.evidenceIds || (cur ? JSON.parse(cur.evidence_ids) : null);
  if (ids && quarter && comp && !errors.evidenceIds) {
    const [from, to] = quarterRange(quarter);
    const bad = ids.filter(id => { const e = db.prepare('SELECT employee_id,indicator,date FROM evidence WHERE id=?').get(id); return !e || e.employee_id !== empId || INDICATORS.get(e.indicator)?.k !== comp || e.date < from || e.date > to; });
    if (bad.length) errors.evidenceIds = `Informacje spoza tej osoby, kryterium lub kwartału: ${bad.join(', ')}.`;
  }
  return { value: v, errors };
}
const partialRow = r => r && ({ id: r.id, employeeId: r.employee_id, evaluatorId: r.evaluator_id, quarter: r.quarter, competency: r.competency, pts: r.pts,
  justification: r.justification, evidenceIds: JSON.parse(r.evidence_ids || '[]'), created: r.created, updated: r.updated });
const partialAuditView = r => ({ quarter: r.quarter, competency: r.competency, pts: r.pts, justification: r.justification, evidenceIds: typeof r.evidence_ids === 'string' ? JSON.parse(r.evidence_ids) : r.evidence_ids });
route('GET', '/api/partials', async (req, res, u) => {
  const q = qs(req);
  const { where, args } = scopedWhere(u, q);
  if (q.get('quarter')) { if (!isQuarter(q.get('quarter'))) return invalid(res, { quarter: 'Kwartał: RRRR-Qn.' }); where.push('quarter=?'); args.push(q.get('quarter')); }
  if (q.get('competency')) { where.push('competency=?'); args.push(q.get('competency')); }
  if (isDate(q.get('from'))) { where.push('quarter>=?'); args.push(quarterOf(q.get('from'))); }
  if (isDate(q.get('to'))) { where.push('quarter<=?'); args.push(quarterOf(q.get('to'))); }
  send(res, 200, { partials: db.prepare(`SELECT * FROM partial_ratings WHERE ${where.join(' AND ')} ORDER BY quarter DESC, competency`).all(...args).map(partialRow) });
});
route('POST', '/api/partials', async (req, res, u) => {
  if (u.role !== 'przelozony') return fail(res, 403, 'Ocenę cząstkową przyznaje oceniający.');
  const b = await readJson(req);
  const emp = teamMember(u, b.employeeId);
  if (!emp) return fail(res, 404, 'Nie znaleziono pracownika w Twoim zespole.');
  const { value: v, errors } = sanitizePartial(b, emp.id);
  if (Object.keys(errors).length) return invalid(res, errors);
  if (db.prepare('SELECT id FROM partial_ratings WHERE employee_id=? AND quarter=? AND competency=?').get(emp.id, v.quarter, v.competency)) return fail(res, 409, 'Ocena cząstkowa za ten kwartał i kryterium już istnieje – edytuj ją.');
  const at = now();
  const id = db.prepare('INSERT INTO partial_ratings(employee_id,evaluator_id,quarter,competency,pts,justification,evidence_ids,created,updated) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(emp.id, u.id, v.quarter, v.competency, v.pts, v.justification, JSON.stringify(v.evidenceIds), at, at).lastInsertRowid;
  const row = db.prepare('SELECT * FROM partial_ratings WHERE id=?').get(id);
  audit(u.id, 'create_partial', `partial:${id}`, null, { employeeId: emp.id, ...partialAuditView(row) });
  send(res, 201, { partial: partialRow(row) });
});
route('PUT', '/api/partials/:id', async (req, res, u, p) => {
  if (u.role !== 'przelozony') return fail(res, 403, 'Ocenę cząstkową zmienia oceniający.');
  const cur = db.prepare('SELECT * FROM partial_ratings WHERE id=?').get(p.id);
  if (!cur || !teamMember(u, cur.employee_id)) return fail(res, 404, 'Nie znaleziono oceny cząstkowej.');
  const b = await readJson(req);
  for (const k of ['employeeId', 'quarter', 'competency']) if (b[k] !== undefined && String(b[k]) !== String({ employeeId: cur.employee_id, quarter: cur.quarter, competency: cur.competency }[k])) return invalid(res, { [k]: 'Tego pola nie zmienia się – utwórz nową ocenę cząstkową.' });
  const { value: v, errors } = sanitizePartial(b, cur.employee_id, true, cur);
  if (Object.keys(errors).length) return invalid(res, errors);
  const next = { ...cur, ...v, evidence_ids: v.evidenceIds ? JSON.stringify(v.evidenceIds) : cur.evidence_ids };
  const ch = diffObj(partialAuditView(cur), partialAuditView(next));
  if (!ch) return send(res, 200, { partial: partialRow(cur), changed: false });
  db.prepare('UPDATE partial_ratings SET pts=?,justification=?,evidence_ids=?,updated=? WHERE id=?').run(next.pts, next.justification, next.evidence_ids, now(), cur.id);
  audit(u.id, 'update_partial', `partial:${cur.id}`, ch.prev, ch.next);
  send(res, 200, { partial: partialRow(db.prepare('SELECT * FROM partial_ratings WHERE id=?').get(cur.id)), changed: true });
});

// ---------- Przegląd miesiąca (przełożony): informacje według wskaźników, bez punktacji ----------
// Wskaźniki bez nowych informacji w miesiącu są pomijane, żeby nie generować pustych ocen.
route('GET', '/api/month', async (req, res, u) => {
  if (u.role !== 'przelozony') return fail(res, 403, 'Przegląd miesiąca jest dla przełożonego.');
  const q = qs(req);
  const month = q.get('month') || today().slice(0, 7);
  if (!isMonth(month)) return invalid(res, { month: 'Nieprawidłowy miesiąc.' });
  const emp = teamMember(u, q.get('employeeId'));
  if (!emp) return fail(res, 404, 'Nie znaleziono pracownika w Twoim zespole.');
  const ev = db.prepare('SELECT * FROM evidence WHERE employee_id=? AND date>=? AND date<=? ORDER BY date').all(emp.id, `${month}-01`, monthEnd(month)).map(evidenceRow);
  const groups = [];
  for (const [key, ind] of INDICATORS) {
    const items = ev.filter(e => e.indicator === key);
    if (items.length) groups.push({ indicator: key, competency: ind.k, text: ind.text, evidence: items });
  }
  const checkin = db.prepare('SELECT * FROM checkins WHERE employee_id=? AND month=?').get(emp.id, month);
  const fb = db.prepare('SELECT * FROM feedback WHERE employee_id=? AND date>=? AND date<=? ORDER BY date').all(emp.id, `${month}-01`, monthEnd(month)).map(feedbackRow);
  audit(u.id, 'view_month', `${emp.id}:${month}`);
  send(res, 200, { month, employeeId: emp.id, groups, evidenceCount: ev.length, checkin: checkinRow(checkin) || null, feedback: fb });
});

// ---------- Zestawienie dla przełożonego: liczby, daty i rozkład poziomów – bez średniej i bez sugestii wyniku ----------
function summaryFor(empId, from, to) {
  const inRange = (col = 'date') => `${col}>=? AND ${col}<=?`;
  const ev = db.prepare(`SELECT indicator,date FROM evidence WHERE employee_id=? AND ${inRange()} ORDER BY date`).all(empId, from, to);
  const fb = db.prepare(`SELECT indicator,level,date FROM feedback WHERE employee_id=? AND ${inRange()}`).all(empId, from, to);
  const ci = db.prepare(`SELECT month,status FROM checkins WHERE employee_id=? AND month>=? AND month<=? ORDER BY month`).all(empId, from.slice(0, 7), to.slice(0, 7));
  const pr = db.prepare('SELECT quarter,competency,pts FROM partial_ratings WHERE employee_id=? AND quarter>=? AND quarter<=? ORDER BY quarter').all(empId, quarterOf(from), quarterOf(to));
  const doneMonths = new Set(ci.filter(c => c.status === 'odbyty').map(c => c.month));
  const indicators = [];
  for (const [key, ind] of INDICATORS) {
    const e = ev.filter(x => x.indicator === key), f = fb.filter(x => x.indicator === key);
    if (!e.length && !f.length) continue;
    const months = new Set(e.map(x => x.date.slice(0, 7)));
    indicators.push({ indicator: key, competency: ind.k, text: ind.text, evidenceCount: e.length, firstDate: e[0]?.date || null, lastDate: e.at(-1)?.date || null,
      evidenceMonths: [...months], checkinsWithEvidence: [...months].filter(m => doneMonths.has(m)).length, feedbackCount: f.length,
      feedbackLevels: Object.fromEntries(PTS5.map(p => [p, f.filter(x => x.level === p).length])) });
  }
  const competencies = [...new Set(pr.map(p => p.competency))].map(k => ({ competency: k,
    partials: pr.filter(p => p.competency === k).map(p => ({ quarter: p.quarter, pts: p.pts })),
    distribution: Object.fromEntries(PTS5.map(v => [v, pr.filter(p => p.competency === k && p.pts === v).length])) }));
  return { from, to, indicators, indicatorsWithoutEvidence: [...INDICATORS.keys()].filter(k => !ev.some(x => x.indicator === k)).length,
    evidenceTotal: ev.length, feedbackTotal: fb.length,
    checkins: { total: ci.length, done: doneMonths.size, months: ci.map(c => ({ month: c.month, status: c.status })) }, competencies };
}
route('GET', '/api/summary', async (req, res, u) => {
  if (u.role !== 'przelozony') return fail(res, 403, 'Zestawienie jest dla przełożonego.');
  const q = qs(req);
  const emp = teamMember(u, q.get('employeeId'));
  if (!emp) return fail(res, 404, 'Nie znaleziono pracownika w Twoim zespole.');
  const to = q.get('to') || today();
  const from = q.get('from') || `${+to.slice(0, 4) - 1}${to.slice(4)}`;
  if (!isDate(from) || !isDate(to) || from > to) return invalid(res, { from: 'Podaj poprawny okres (od ≤ do, RRRR-MM-DD).' });
  audit(u.id, 'view_summary', `${emp.id}:${from}:${to}`);
  send(res, 200, { employeeId: emp.id, ...summaryFor(emp.id, from, to) });
});

// AI – wspomaganie przełożonego i pracownika (człowiek zawsze decyduje)
// ---------- Przygotowanie pracownika do rozmowy (etap 7): o co może zapytać przełożony ----------
// Wejście: kryteria bieżącej oceny lub rozmowy rozpoczynającej, pytania z bazy asystenta, własne cele i kroki.
// Informacje z okresu tylko jako liczby na kryterium i tylko przy włączonym module wglądu pracownika. Bez poziomów i oceniania.
function prepInput(u) {
  const draft = db.prepare("SELECT * FROM evals WHERE employee_id=? AND status='draft' ORDER BY id DESC LIMIT 1").get(u.id);
  const k = latestKickoff(u.id);
  const criteria = draft ? JSON.parse(draft.data || '{}').criteria || [] : k ? [...mandKeysFor(k.typ), ...JSON.parse(k.extra_criteria || '[]')] : [];
  const qs2 = criteria.map(c => { const e = ASSISTANT.kompetencje.find(x => c.startsWith(x.match)); return { k: c, name: MODEL.find(m => m.k === c)?.n || c, pytania: e ? [...e.niski.slice(0, 2), ...e.wysoki.slice(0, 2)] : [] }; });
  const goals = goalsOf(u.id).map(g => ({ cel: g.s, termin: g.t, kroki: g.steps.map(x => `${x.t} (${x.confirmed_at ? 'potwierdzony' : x.reported_at ? 'zgłoszony' : 'do zrobienia'})`) }));
  const from = isDate(draft?.period_from) ? draft.period_from : k?.ack_at ? k.ack_at.slice(0, 10) : `${+today().slice(0, 4) - 1}${today().slice(4)}`;
  const counts = modOn('mod_employee_evidence') ? Object.fromEntries(criteria.map(c => [c, db.prepare("SELECT COUNT(*) n FROM evidence WHERE employee_id=? AND date>=? AND substr(indicator,1,length(?)+1)=?||'|'").get(u.id, from, c, c).n])) : null;
  return { criteria: qs2, ogolne: ASSISTANT.ogolne || [], goals, counts };
}
function rulesPrep(inp) {
  const qs2 = inp.criteria.length ? inp.criteria.flatMap(c => c.pytania.slice(0, 2).map(q => `- (${c.name.toLowerCase()}) ${q}`)) : (Array.isArray(inp.ogolne) ? inp.ogolne : []).slice(0, 5).map(q => `- ${typeof q === 'string' ? q : q.q || ''}`);
  return ['O co może zapytać przełożony:', ...qs2.slice(0, 10),
    '', 'Co warto przygotować:', '- 1–2 konkretne sytuacje do każdego kryterium: sytuacja, Twoje działanie, rezultat.',
    ...inp.goals.slice(0, 3).map(g => `- Postęp celu „${g.cel}”: co zrobiłeś, co blokuje, czego potrzebujesz.`),
    '', 'O co Ty możesz zapytać:', '- Jakie są oczekiwania na kolejny okres i jak poznam, że je spełniam?', '- Jakiego wsparcia mogę oczekiwać (szkolenia, mentoring)?', '- Które moje działania warto powtarzać?'].join('\n');
}
route('POST', '/api/ai/prep', async (req, res, u) => {
  if (u.role !== 'pracownik') return fail(res, 403, 'Przygotowanie do rozmowy jest dla pracownika.');
  const inp = prepInput(u);
  const input = redactNames(JSON.stringify(inp));
  try {
    const text = await llm(`Jesteś asystentem pracownika urzędu przed rozmową z przełożonym (rozmowa miesięczna lub oceniająca). Pomagasz się przygotować. ${RULES}
Sekcje (nagłówki dokładnie tak): „O co może zapytać przełożony:” (wybierz i dopasuj pytania z bazy do kryteriów), „Co warto przygotować:” (konkretne przykłady sytuacji, postęp celów), „O co Ty możesz zapytać:”.
Nie podawaj poziomów, punktów ani przewidywanej oceny. Nie oceniaj osoby. Opieraj się tylko na danych poniżej.`, `DANE (JSON):\n${input}`);
    aiLog(null, u.id, 'prep', input, { text, source: 'ai' });
    send(res, 200, { text, source: 'ai', model: AI_MODEL });
  } catch {
    const text = rulesPrep(inp);
    aiLog(null, u.id, 'prep', input, { text, source: 'rules' });
    send(res, 200, { text: text + '\n\n' + AI_RULE_NOTE, source: 'rules' });
  }
});

// ---------- Brief do rozmowy (etap 6): wyszukiwanie faktów (serwer) + brief od modelu z odnośnikami do faktów ----------
// JSON „kto co robił” buduje serwer z wpisów zrobionych przez ludzi (informacje, feedback, rozmowy miesięczne, kroki celów).
// „Kto” to wyłącznie rola. Bez poziomów i punktów (także z feedbacku), bez wyniku. Model dostaje JSON po redactNames().
const FACT_ROLE = { informacja: 'przełożony', rozmowa: 'przełożony (rozmowa miesięczna)' };
function briefFacts(empId, from, to) {
  const facts = [];
  for (const e of db.prepare('SELECT * FROM evidence WHERE employee_id=? AND date>=? AND date<=? ORDER BY date').all(empId, from, to)) {
    const ind = INDICATORS.get(e.indicator);
    facts.push({ id: `I${e.id}`, rodzaj: 'informacja', data: e.date, kryterium: ind?.k || null, wskaznik: ind?.text?.replace(/\s+/g, ' ') || null,
      kto_zapisal: FACT_ROLE.informacja, sytuacja: e.situation, dzialanie: e.action, rezultat: e.result });
  }
  for (const f of db.prepare('SELECT * FROM feedback WHERE employee_id=? AND date>=? AND date<=? ORDER BY date').all(empId, from, to)) {
    const ind = INDICATORS.get(f.indicator);
    facts.push({ id: `F${f.id}`, rodzaj: 'feedback', data: f.date, kryterium: ind?.k || null, wskaznik: ind?.text?.replace(/\s+/g, ' ') || null,
      kto_zapisal: 'przełożony', zrodlo: RELATIONS[f.relation] || f.relation, zadanie: f.source, opis: f.justification });
  }
  for (const c of db.prepare("SELECT * FROM checkins WHERE employee_id=? AND month>=? AND month<=? AND status='odbyty' ORDER BY month").all(empId, from.slice(0, 7), to.slice(0, 7))) {
    facts.push({ id: `C${c.id}`, rodzaj: 'rozmowa miesięczna', data: c.date || `${c.month}-01`, kryterium: null, kto_zapisal: FACT_ROLE.rozmowa,
      co_zrobiono: c.done_text, co_wymaga_uwagi: c.attention_text, cel: c.goal_text });
  }
  for (const g of goalsOf(empId)) g.steps.forEach((x, i) => {
    const d = (x.confirmed_at || x.reported_at || '').slice(0, 10);
    if (!d || d < from || d > to) return;
    facts.push({ id: `G${g.id}.${i + 1}`, rodzaj: 'krok celu', data: d, kryterium: null, cel: g.s, krok: x.t,
      kto: x.confirmed_at ? 'pracownik (zgłoszenie), przełożony (potwierdzenie)' : 'pracownik (zgłoszenie, bez potwierdzenia)' });
  });
  // Scal fakty o identycznej treści (sytuacja, działanie, rezultat) – zostaje pierwszy id, reszta w „takze”
  const seen = new Map(), out = [];
  for (const f of facts) {
    if (f.rodzaj !== 'informacja') { out.push(f); continue; }
    const key = [f.sytuacja, f.dzialanie, f.rezultat].map(x => String(x ?? '').trim().toLowerCase()).join('\u0001');
    const first = seen.get(key);
    if (first) (first.takze ||= []).push(f.id); else { seen.set(key, f); out.push(f); }
  }
  return out.sort((a, b) => (a.data < b.data ? -1 : 1));
}
function briefContext(u, empId, b) {
  const draft = db.prepare("SELECT * FROM evals WHERE employee_id=? AND evaluator_id=? AND status='draft' ORDER BY id DESC LIMIT 1").get(empId, u.id);
  const k = latestKickoff(empId);
  const to = isDate(b.to) ? b.to : today();
  const from = isDate(b.from) ? b.from : (isDate(draft?.period_from) ? draft.period_from : k?.ack_at ? k.ack_at.slice(0, 10) : `${+to.slice(0, 4) - 1}${to.slice(4)}`);
  const criteria = draft ? JSON.parse(draft.data || '{}').criteria || [] : k ? [...mandKeysFor(k.typ), ...JSON.parse(k.extra_criteria || '[]')] : [];
  return { from, to, criteria };
}
function buildBriefJson(empId, ctx) {
  const facts = briefFacts(empId, ctx.from, ctx.to);
  const crits = ctx.criteria.length ? ctx.criteria : [...new Set(facts.map(f => f.kryterium).filter(Boolean))];
  const pokrycie = crits.map(k => { const fs = facts.filter(f => f.kryterium === k); return { kryterium: k, fakty: fs.length, miesiace: new Set(fs.map(f => f.data.slice(0, 7))).size }; });
  return { okres: { od: ctx.from, do: ctx.to }, fakty: facts, pokrycie, braki: pokrycie.filter(p => !p.fakty).map(p => p.kryterium) };
}
// Po modelu: usuń odnośniki do nieistniejących faktów; w „Przykładach” zdanie bez odnośnika oznacz „(bez źródła)”
function checkBriefRefs(text, ids) {
  let section = '';
  return String(text).split('\n').map(line => {
    if (/^\s*(#+|\*\*|[A-ZĄĆĘŁŃÓŚŹŻ][^.:]{2,40}:?\s*$)/.test(line)) section = line;
    let l = line.replace(/\[([IFCG][0-9.]+)\]/g, (m, id) => (ids.has(id) ? m : '')).replace(/(\S) {2,}/g, '$1 ').trimEnd();
    if (/przykład/i.test(section) && /^\s*([-*•]|\d+[.)])\s+\S/.test(l) && !/\[[IFCG][0-9.]+\]/.test(l)) l += ' (bez źródła)';
    return l;
  }).join('\n');
}
// Po modelu: ujednolicenie formatu – bez Markdown, cztery sekcje w stałej kolejności z dokładnymi nagłówkami
const BRIEF_HEADS = [['t', 'Tematy do omówienia:'], ['p', 'Przykłady z okresu:'], ['q', 'Pytania otwarte:'], ['b', 'Kryteria bez informacji:']];
function briefSectionOf(s) {
  if (/kryteri|brak(i|ujące)?\b|bez informacji/i.test(s) && !/przykład|pytani/i.test(s)) return 'b';
  if (/przykład/i.test(s)) return 'p';
  if (/pytani/i.test(s)) return 'q';
  if (/temat/i.test(s)) return 't';
  return null;
}
function normalizeBrief(text, json) {
  const sec = { t: [], p: [], q: [], b: [] };
  let cur = 't';
  for (const raw of String(text).replace(/\r/g, '').split('\n')) {
    const mdHead = /^\s*#{1,6}\s/.test(raw) || /^\s*(\*\*|__)[^*_]+(\*\*|__):?\s*$/.test(raw);
    let l = raw.replace(/^\s*#{1,6}\s*/, '').replace(/(\*\*|__)/g, '').replace(/`/g, '').trim();
    if (!l) continue;
    const bullet = /^([-*•]|\d+[.)])\s+(.*)$/.exec(l);
    const body = bullet ? bullet[2].trim() : l;
    const m = /^(.{2,70}?):\s*(.*)$/.exec(body);
    const headLike = mdHead || !bullet || /:$/.test(body);
    const headPart = m ? m[1] : body;
    const s = headLike && headPart.length <= 70 ? briefSectionOf(headPart) : null;
    if (s && (!bullet || mdHead || /:$/.test(body)) && !/^[-*•]\s/.test(l)) {
      cur = s;
      if (m && m[2].trim()) sec[cur].push(m[2].trim());
      continue;
    }
    if (mdHead && !bullet) { if (!/^brief\b/i.test(body)) sec[cur].push(body.replace(/:$/, '')); continue; }
    sec[cur].push(body);
  }
  if (!sec.p.length) {
    const by = (json.pokrycie || []).filter(p => p.fakty).sort((a, b) => b.fakty - a.fakty).slice(0, 3);
    sec.p = by.map(p => { const f = json.fakty.find(x => x.kryterium === p.kryterium); return `${p.kryterium.toLowerCase()}: ${f.sytuacja || f.opis || ''} [${f.id}]`; });
    if (!sec.p.length) sec.p = ['brak wpisów w okresie'];
  }
  if (!sec.b.length) sec.b = (json.braki || []).length ? json.braki.map(k => k.toLowerCase()) : ['brak'];
  if (!sec.t.length) sec.t = ['brak'];
  if (!sec.q.length) sec.q = ['brak'];
  return BRIEF_HEADS.map(([k, h]) => [h, ...sec[k].map(x => `- ${x}`)].join('\n')).join('\n\n');
}
function rulesBrief(json) {
  const by = json.pokrycie.filter(p => p.fakty).sort((a, b) => b.fakty - a.fakty);
  const ex = by.slice(0, 3).map(p => { const f = json.fakty.find(x => x.kryterium === p.kryterium); return `- ${p.kryterium.toLowerCase()}: ${f.sytuacja || f.opis || ''} [${f.id}]`; });
  return ['Tematy do omówienia:', ...by.slice(0, 3).map(p => `- ${p.kryterium.toLowerCase()} (${p.fakty} wpisów w ${p.miesiace} mies.)`),
    '', 'Przykłady z okresu:', ...(ex.length ? ex : ['- brak wpisów w okresie']),
    '', 'Pytania otwarte:', '- Która z tych sytuacji była dla Ciebie najważniejsza i dlaczego?', '- Co pomogło, a co przeszkadzało w osiągnięciu rezultatu?', '- Czego potrzebujesz w kolejnym okresie?',
    '', 'Kryteria bez informacji:', ...(json.braki.length ? json.braki.map(k => `- ${k.toLowerCase()}`) : ['- brak'])].join('\n');
}
route('POST', '/api/ai/brief', async (req, res, u) => {
  if (u.role !== 'przelozony') return fail(res, 403, 'Brief do rozmowy jest dla przełożonego.');
  const b = await readJson(req);
  const emp = teamMember(u, b.employeeId);
  if (!emp) return fail(res, 404, 'Nie znaleziono pracownika w Twoim zespole.');
  if ((b.from && !isDate(b.from)) || (b.to && !isDate(b.to)) || (b.from && b.to && b.from > b.to)) return invalid(res, { from: 'Podaj poprawny okres (RRRR-MM-DD).' });
  const json = buildBriefJson(emp.id, briefContext(u, emp.id, b));
  const ids = new Set(json.fakty.map(f => f.id));
  const input = redactNames(JSON.stringify(json));
  try {
    if (!json.fakty.length) throw new Error('no_facts');
    const raw = await llm(`Jesteś asystentem przełożonego w urzędzie. Przygotowujesz brief do rozmowy z pracownikiem WYŁĄCZNIE na podstawie faktów z JSON. ${RULES}
Sekcje (nagłówki dokładnie tak): „Tematy do omówienia:”, „Przykłady z okresu:”, „Pytania otwarte:”, „Kryteria bez informacji:”.
W „Przykładach” każde zdanie kończ odnośnikiem do faktu w nawiasie kwadratowym, np. [I12]. Używaj tylko identyfikatorów z pola "id".
Nie podawaj poziomów, punktów ani wyniku. Nie oceniaj osoby. Nie dodawaj niczego spoza faktów.`, `FAKTY (JSON):\n${input}`);
    const brief = checkBriefRefs(normalizeBrief(raw, json), ids);
    aiLog(null, u.id, 'brief', input, { text: brief, source: 'ai' });
    send(res, 200, { brief, json, source: 'ai', model: AI_MODEL });
  } catch {
    const brief = rulesBrief(json);
    aiLog(null, u.id, 'brief', input, { text: brief, source: 'rules' });
    send(res, 200, { brief: brief + (json.fakty.length ? '\n\n' + AI_RULE_NOTE : ''), json, source: 'rules' });
  }
});
// Dobór kryteriów dodatkowych do rozmowy rozpoczynającej: dane deterministyczne z serwera, model tylko wybiera z listy dozwolonych.
const CRIT_HINTS = [
  ['ORIENTACJA NA KLIENTA', /klient|interesant|obsług|petent|zewnętrzn/i, 'obsługę klientów lub interesantów'],
  ['MYŚLENIE ANALITYCZNE', /analiz|dane|danych|raport|statyst|sprawozdaw|budżet|finans/i, 'pracę z danymi, analizami lub raportami'],
  ['NEGOCJOWANIE', /negocj|umow|kontrahent|przetarg|zamówień/i, 'negocjacje lub uzgadnianie warunków'],
  ['WYSTĄPIENIA PUBLICZNE', /wystąpi|prezentac|szkole|konferenc|publiczn|rzecznik/i, 'wystąpienia, prezentacje lub szkolenia'],
  ['RADZENIE SOBIE W SYTUACJIACH KR', /kryzys|awari|reagowan|interwenc|pilne/i, 'działanie w sytuacjach kryzysowych lub pilnych'],
  ['ZARZĄDZANIE STRATEGICZNE', /strateg|planowan|programow|rozwój organizac/i, 'planowanie i prace o charakterze strategicznym'],
  ['KREATYWNOŚĆ', /innow|nowych rozwiąz|usprawnien|pomysł|projektow/i, 'wymyślanie usprawnień i nowych rozwiązań'],
  ['WYKORZYSTYWANIE WIEDZY', /specjalist|ekspert|doradz|prawn|legislac/i, 'wiedzę specjalistyczną'],
];
const critStem = w => w.toLowerCase().slice(0, 5);
const critWords = s => [...new Set(String(s || '').toLowerCase().match(/\p{L}{5,}/gu) || [])].map(critStem);

route('POST', '/api/ai/criteria', async (req, res, u) => {
  if (u.role !== 'przelozony') return fail(res, 403, 'Dobór kryteriów jest dla przełożonego.');
  const b = await readJson(req);
  const emp = teamMember(u, b.employeeId);
  if (!emp) return fail(res, 404, 'Nie znaleziono pracownika w Twoim zespole.');
  if (b.typ !== 'B' && b.typ !== 'C') return invalid(res, { typ: 'Wybierz arkusz B lub C.' });
  const duties = typeof b.duties === 'string' ? b.duties.slice(0, 3000) : '';
  const position = db.prepare('SELECT position FROM users WHERE id=?').get(emp.id)?.position || '';
  const mand = mandKeysFor(b.typ);
  const allowed = MODEL.filter(c => !mand.includes(c.k));
  const from = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  const ev = Object.fromEntries(allowed.map(c => [c.k, 0])), fb = { ...ev };
  for (const r of db.prepare('SELECT indicator FROM evidence WHERE employee_id=? AND date>=?').all(emp.id, from)) { const k = r.indicator.split('|')[0]; if (k in ev) ev[k]++; }
  for (const r of db.prepare('SELECT indicator FROM feedback WHERE employee_id=? AND date>=?').all(emp.id, from)) { const k = r.indicator.split('|')[0]; if (k in fb) fb[k]++; }
  const goals = db.prepare('SELECT s FROM goals WHERE user_id=?').all(emp.id).map(g => String(g.s || '').slice(0, 120)).filter(Boolean);
  const nameOf = k => MODEL.find(c => c.k === k)?.n || k;
  const list = allowed.map(c => `- ${c.k} (${c.n}): ${c.w.slice(0, 2).map(w => w.w.replace(/\s+/g, ' ')).join(' / ')} [informacje: ${ev[c.k]}, feedback: ${fb[c.k]}]`).join('\n');
  const input = redactNames(`STANOWISKO: ${position || 'brak danych'}\nOBOWIĄZKI: ${duties || 'brak opisu'}\nCELE: ${goals.join('; ') || 'brak'}\nDOZWOLONE KRYTERIA (klucz dokładnie jak poniżej):\n${list}`);
  const finish = (propozycje, odrzucone, source) => {
    aiLog(null, u.id, 'criteria', input, { text: JSON.stringify(propozycje), source });
    send(res, 200, { propozycje, odrzucone, source, ...(source === 'ai' ? { model: AI_MODEL } : {}) });
  };
  let odrzucone = 0;
  try {
    const raw = await llm(`Jesteś asystentem przełożonego w urzędzie. Dobierasz kryteria DODATKOWE do rozmowy rozpoczynającej. Wybierz 1–3 kryteria WYŁĄCZNIE z podanej listy dozwolonych (pole „kryterium” = klucz dokładnie jak na liście). Dla każdego napisz 1–2 zdania uzasadnienia odwołujące się do obowiązków, stanowiska lub zebranych informacji. Odpowiadaj po polsku. Nie oceniaj osoby, nie podawaj imion. Odpowiedz wyłącznie JSON-em: {"propozycje":[{"kryterium":"KLUCZ","uzasadnienie":"…"}]}`, input);
    const m = raw.match(/\{[\s\S]*\}/);
    const list2 = JSON.parse(m ? m[0] : raw)?.propozycje;
    if (!Array.isArray(list2)) throw new Error('bad_shape');
    const seen = new Set(), ok = [];
    for (const p of list2) {
      const k = typeof p?.kryterium === 'string' ? p.kryterium.trim() : '';
      const why = typeof p?.uzasadnienie === 'string' ? p.uzasadnienie.trim().slice(0, 600) : '';
      if (!allowed.some(c => c.k === k) || seen.has(k) || !why) { odrzucone++; continue; }
      seen.add(k);
      if (ok.length < MAX_EXTRA) ok.push({ k, n: nameOf(k), uzasadnienie: why }); else odrzucone++;
    }
    if (!ok.length) throw new Error('nothing_valid');
    return finish(ok, odrzucone, 'ai');
  } catch {
    // Fallback regułowy: słowa kluczowe stanowiska i obowiązków + liczba zebranych informacji
    const text = `${position} ${duties}`;
    const tw = new Set(critWords(text));
    const scored = allowed.map(c => {
      const hint = CRIT_HINTS.find(h => h[0] === c.k);
      const hintHit = hint && hint[1].test(text);
      const wordHits = [...new Set([...critWords(c.n), ...c.w.flatMap(w => critWords(w.w))])].filter(x => tw.has(x)).length;
      const info = ev[c.k] + fb[c.k];
      const parts = [];
      if (hintHit) parts.push(`Stanowisko lub obowiązki obejmują ${hint[2]}`);
      else if (wordHits) parts.push('Opis stanowiska i obowiązków odpowiada wskaźnikom tego kryterium');
      if (info) parts.push(`w ostatnich 12 miesiącach zebrano ${info} ${info === 1 ? 'informację' : 'informacji'} (informacje: ${ev[c.k]}, feedback: ${fb[c.k]})`);
      return { c, score: (hintHit ? 10 : 0) + Math.min(wordHits, 5) + Math.min(info, 5), parts };
    }).filter(x => x.score > 0).sort((a, z) => z.score - a.score || allowed.indexOf(a.c) - allowed.indexOf(z.c)).slice(0, MAX_EXTRA);
    const propozycje = scored.map(x => ({ k: x.c.k, n: x.c.n, uzasadnienie: `${x.parts.join('; ').replace(/^./, ch => ch.toUpperCase())} – kryterium ${x.c.n}.` }));
    if (!propozycje.length) { const c = allowed.find(x => x.k === 'ORIENTACJA NA KLIENTA') || allowed[0]; propozycje.push({ k: c.k, n: c.n, uzasadnienie: `Brak opisu obowiązków i zebranych informacji – kryterium ${c.n} to punkt wyjścia do rozmowy; uzupełnij obowiązki, aby dobór był trafniejszy.` }); }
    return finish(propozycje, odrzucone, 'rules');
  }
});
route('POST', '/api/ai/talk', async (req, res, u) => {
  const b = await readJson(req);
  const ev = ownEval(u, Number(b.evalId));
  if (!ev || ev.evaluator_id !== u.id) return fail(res, 403, 'Brak dostępu.');
  const scores = scoreEval(ev);
  const sorted = Object.entries(scores).filter(([, v]) => v.avg !== null).sort((a, b2) => b2[1].avg - a[1].avg);
  const fallback = [
    `Mocne strony: ${sorted.slice(0, 2).map(([k]) => k.toLowerCase()).join(', ') || 'brak ocenionych kompetencji'}.`,
    `Do omówienia: ${sorted.slice(-2).map(([k]) => k.toLowerCase()).join(', ') || '—'}.`,
    'Pytania: Które działania chcesz powtarzać? Jakie warunki pomogą w obszarach do rozwoju? Jakie kompetencje rozwijać w kolejnym okresie?',
  ].join('\n');
  try {
    const text = await llm(`Jesteś asystentem przełożonego w urzędzie przygotowującego rozmowę oceniającą. ${RULES} Przygotuj: 1) 2 mocne strony z przykładami, 2) 2 obszary do rozwoju, 3) 3 pytania otwarte do rozmowy.`,
      `Wyniki oceny (kompetencja / wskaźnik: poziom):\n${evalSummaryForAI(ev)}`);
    audit(u.id, 'ai_talk', ev.id); aiLog(ev.id, u.id, 'talk', evalSummaryForAI(ev), { text, source: 'ai' });
    send(res, 200, { text, source: 'ai', model: AI_MODEL });
  } catch {
    aiLog(ev.id, u.id, 'talk', evalSummaryForAI(ev), { text: fallback, source: 'rules' });
    send(res, 200, { text: fallback + '\n\n' + AI_RULE_NOTE, source: 'rules' });
  }
});
route('POST', '/api/ai/formal', async (req, res, u) => {
  const b = await readJson(req);
  const ev = ownEval(u, Number(b.evalId));
  if (!ev || ev.evaluator_id !== u.id) return fail(res, 403, 'Brak dostępu.');
  const miss = missingForSubmit(ev);
  const fallback = miss.length ? `Braki formalne (${miss.length}):\n- ${miss.slice(0, 10).join('\n- ')}` : 'Brak braków formalnych. Sprawdź jeszcze, czy uzasadnienia opisują zachowania, a nie cechy osoby.';
  try {
    const text = await llm(`Jesteś asystentem formalnym oceny okresowej w urzędzie. ${RULES} Sprawdź uzasadnienia i wskaż zdania oceniające osobę (np. „jest leniwy”) zamiast zachowania; zaproponuj przeformułowanie w języku obserwowalnych zachowań. Nie zmieniaj poziomów ocen.`,
      `Braki formalne: ${miss.join('; ') || 'brak'}\nUzasadnienia:\n${evalSummaryForAI(ev)}`);
    audit(u.id, 'ai_formal', ev.id); aiLog(ev.id, u.id, 'formal', evalSummaryForAI(ev), { text, source: 'ai' });
    send(res, 200, { text, source: 'ai', model: AI_MODEL });
  } catch {
    send(res, 200, { text: fallback + '\n\n' + AI_RULE_NOTE, source: 'rules' });
  }
});
route('POST', '/api/ai/development', async (req, res, u) => {
  const goals = db.prepare('SELECT s,m,a,r,t,done,progress FROM goals WHERE user_id=?').all(u.id);
  const ev = db.prepare("SELECT * FROM evals WHERE employee_id=? AND status='discussed' ORDER BY updated DESC LIMIT 1").get(u.id);
  const scores = ev ? scoreEval(ev) : {};
  const weak = Object.entries(scores).filter(([, v]) => v.avg !== null).sort((a, b) => a[1].avg - b[1].avg).slice(0, 2).map(([k]) => k.toLowerCase());
  const fallback = weak.length
    ? `Propozycja: rozwijaj ${weak.join(' i ')} – 2 godziny ćwiczeń tygodniowo przez 6 tygodni, z opiekunem.`
    : 'Dodaj cele SMART i poczekaj na omówioną ocenę, aby dostać propozycje rozwoju.';
  try {
    const text = await llm(`Jesteś doradcą rozwoju zawodowego pracownika urzędu. ${RULES} Zaproponuj 2–3 działania rozwojowe w formie SMART. Nie oceniaj osoby.`,
      `Obszary do rozwoju: ${weak.join(', ') || 'brak'}\nCele: ${goals.map(g => `${g.s} (postęp ${g.progress}%)`).join('; ') || 'brak'}`);
    audit(u.id, 'ai_development'); aiLog(null, u.id, 'development', weak.join(','), { text, source: 'ai' });
    send(res, 200, { text, source: 'ai', model: AI_MODEL });
  } catch {
    send(res, 200, { text: fallback + '\n\n' + AI_RULE_NOTE, source: 'rules' });
  }
});

// Asystent ogólny (czat): tylko system Kompas Kompetencji i procedury oceniania. Brak limitu zapytań.
// Odpowiada wyłącznie na podstawie FAKTS (zweryfikowane zasady z aplikacji), bez danych ocen i osób.
const CHAT_FACTS = `FAKTY O SYSTEMIE (jedyne źródło odpowiedzi):
- System ma moduły: Start, Oceny (kreator oceny krok po kroku), Miesiąc (rozmowa miesięczna bez punktacji), Informacje (obserwacje przy wskaźnikach), Zestawienie, Wyniki zespołu, Dziennik (kto i kiedy działał), Ustawienia modułów. Nie ma sekcji „zadania”.
- Role: przełożony (ocenia, widzi zespół) i pracownik (widzi swój profil, cele, informacje i swoje oceny po ich złożeniu).
- Rodzaje ocen: pierwsza ocena (arkusz pierwszej oceny) oraz okresowa ocena kierownicza (Arkusz B) lub pozostałych (Arkusz C).
- Kompetencje: 14 kompetencji, każda ma wskaźniki. Kryteria obowiązkowe są zawsze zaznaczone: dla B: zarządzanie ludźmi, podejmowanie decyzji, organizacja pracy, współpraca, komunikacja; dla C: wykorzystywanie wiedzy, rzetelność, organizacja pracy, współpraca, komunikacja. Pozostałe kryteria wybiera się dodatkowo, do 3.
- Punktacja wskaźnika: 1, 3, 5, 7 lub 9 punktów (B i C); przy pierwszej ocenie 3, 5 lub 7. Poziom ogólny z kryteriów: znacznie poniżej, poniżej, na poziomie, powyżej, znacznie powyżej oczekiwań.
- Cykl okresowej oceny: 24 miesiące od ostatniej oceny okresowej. System pilnuje minimalnego odstępu 6 miesięcy; wyjątek wymaga uzasadnienia i wpisu do dziennika.
- Zapoznanie: pracownik potwierdza zapoznanie z oceną. Od zapoznania ma 7 dni na złożenie sprzeciwu.
- Sprzeciw: przełożony rozpatruje go w ciągu 14 dni. Uwzględnienie oznacza, że ocena wraca do poprawy (zmiana albo ponowne sporządzenie) i zapisuje się wersję.
- Podpisy: podpis oceniającego i zapoznanie są zapisane z sumą kontrolną (SHA-256) i podpisem HMAC; weryfikacja pokazuje, czy treść się nie zmieniła.
- Dziennik zmian (audyt) jest łańcuchem skrótów; każdą wygenerowaną podpowiedź AI widać w dzienniku.
- Asystent AI nie ma dostępu do ocen konkretnych osób i nie podejmuje decyzji.`;
// Liczby z systemu dla czatu (tylko zagregowane, bez nazwisk i treści ocen).
// Przełożony: zakres jego zespołu i ocen, które sam sporządza. Pracownik: tylko jego własne oceny.
function chatData(u) {
  if (u.role === 'pracownik') {
    const evs = db.prepare("SELECT status, objection_at, objection_result FROM evals WHERE employee_id=?").all(u.id);
    const draft = evs.filter(e => e.status === 'draft').length;
    const discussed = evs.filter(e => e.status === 'discussed').length;
    const pending = evs.filter(e => e.status === 'submitted').length;
    return `DANE OSOBY (liczby): ocen w przygotowaniu: ${draft}; złożonych, czeka na zapoznanie lub omówienie: ${pending}; omówionych: ${discussed}.`;
  }
  const team = db.prepare("SELECT id FROM users WHERE manager_id=? AND role='pracownik'").all(u.id);
  const ids = team.map(t => t.id);
  const evs = ids.length ? db.prepare(`SELECT employee_id, status, objection_at, objection_result FROM evals WHERE evaluator_id=? AND employee_id IN (${ids.map(() => '?').join(',')})`).all(u.id, ...ids) : [];
  const withEval = new Set(evs.map(e => e.employee_id));
  const noEval = ids.filter(id => !withEval.has(id)).length;
  const draft = evs.filter(e => e.status === 'draft').length;
  const submitted = evs.filter(e => e.status === 'submitted').length;
  const discussed = evs.filter(e => e.status === 'discussed').length;
  const objections = evs.filter(e => e.objection_at && !e.objection_result).length;
  return `DANE PRZEŁOŻONEGO (liczby): pracowników w zespole: ${ids.length}; bez żadnej oceny: ${noEval}; oceny do przygotowania (szkic): ${draft}; złożone, do omówienia: ${submitted}; omówione: ${discussed}; sprzeciwy do rozpatrzenia: ${objections}.`;
}
const CHAT_SYSTEM = `Jesteś asystentem systemu Kompas Kompetencji w urzędzie. Pomagasz wyłącznie w: obsłudze tego systemu, pojęciach z oceny, terminach i procedurach oceniania oraz zasadach służby cywilnej.
ZASADY ODPOWIEDZI:
1. Odpowiadaj WYŁĄCZNIE na podstawie poniższych FAKTÓW. Nie wymyślaj modułów, sekcji, zadań, danych ani liczb.
2. Jeśli odpowiedzi nie ma w faktach, napisz: „Tego nie znajduję w systemie. Zapytaj dział kadr.”
3. Jeśli pytanie nie dotyczy systemu ani procedur oceniania, napisz tylko: „Mogę pomóc w sprawach systemu Kompas Kompetencji i procedur oceny.”
4. Nie oceniasz osób, nie pytasz o dane osobowe, nie podajesz wyniku ani poziomu dla konkretnej osoby.
5. Odpowiadaj po polsku, krótko (do 5 zdań), zwykłym tekstem bez nagłówków.
${CHAT_FACTS}`;
const CHAT_FALLBACK = [
  [/sprzeciw|odwo/i, 'Sprzeciw: pracownik ma 7 dni od zapoznania z oceną. Przełożony rozpatruje go w ciągu 14 dni. Uwzględnienie oznacza, że ocena wraca do poprawy.\nŹródło: ustawa o służbie cywilnej, art. 83.'],
  [/cykl|termin|kiedy.*ocen|24/i, 'Okresowa ocena jest co 24 miesiące od ostatniej oceny okresowej. Najkrótszy odstęp to 6 miesięcy.\nŹródło: ustawa o służbie cywilnej, art. 81.'],
  [/poziom|punkt|skal|wskaźnik/i, 'Wskaźniki są punktowane 1, 3, 5, 7 lub 9 (przy pierwszej ocenie 3, 5 lub 7). Poziom ogólny wynika ze średniej kryteriów.\nŹródło: rozporządzenie Prezesa Rady Ministrów z 4 kwietnia 2016 r. (arkusze oceny).'],
  [/obowiązk|obowiazk|kryteri/i, 'Kryteria obowiązkowe są zawsze zaznaczone. Dla kierowniczych (B): zarządzanie ludźmi, podejmowanie decyzji, organizacja pracy, współpraca, komunikacja. Dla pozostałych (C): wykorzystywanie wiedzy, rzetelność, organizacja pracy, współpraca, komunikacja.\nŹródło: rozporządzenie Prezesa Rady Ministrów z 4 kwietnia 2016 r. (załącznik – arkusze B i C).'],
  [/podpis|zapozn/i, 'Podpis oceniającego i zapoznanie pracownika są zapisane z sumą kontrolną. Weryfikacja pokazuje, czy treść oceny się nie zmieniła.'],
];
route('POST', '/api/ai/chat', async (req, res, u) => {
  const b = await readJson(req);
  const q = String(b.message || '').trim().slice(0, 1000);
  if (q.length < 2) return fail(res, 400, 'Wpisz pytanie.');
  // Historia: tylko ostatnie 6 wiadomości, tylko role user/assistant, przycięte
  const history = (Array.isArray(b.history) ? b.history : []).slice(-6)
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map(m => ({ role: m.role, content: m.content.slice(0, 1000) }));
  const data = chatData(u);
  try {
    const text = await llm(`${CHAT_SYSTEM}\n${data}\nNa pytania o liczby odpowiadaj WYŁĄCZNIE z tych DANYCH (podaj liczbę i krótko, co ona znaczy). Nie podawaj nazwisk.`, q, history);
    aiLog(null, u.id, 'chat', q, { text, source: 'ai' });
    send(res, 200, { text, source: 'ai', model: AI_MODEL });
  } catch {
    const hit = /ile|liczb|ocen.*(zrobi|do|przygot)|sprzeciw.*(ile|ma)/i.test(q) ? [null, data + ' Szczegóły w module Oceny.'] : CHAT_FALLBACK.find(([re]) => re.test(q));
    const text = (hit ? hit[1] : 'Nie mam tej informacji w bazie wiedzy, więc nie odpowiem, żeby nie podać niezweryfikowanej treści. Zapytaj dział kadr albo zadaj pytanie o sprzeciw, cykl oceny, skalę wskaźników, kryteria obowiązkowe lub podpisy.') + '\n\n' + AI_RULE_NOTE;
    aiLog(null, u.id, 'chat', q, { text, source: 'rules' });
    send(res, 200, { text, source: 'rules' });
  }
});

// Pytania do rozmowy miesięcznej: tylko nazwy wskaźników i liczby informacji (bez treści informacji i bez danych osoby).
// Asystent niczego nie zapisuje w ocenach, informacjach ani check-inach.
route('POST', '/api/ai/checkin', async (req, res, u) => {
  if (u.role !== 'przelozony') return fail(res, 403, 'Brak dostępu.');
  const b = await readJson(req);
  const emp = teamMember(u, b.employeeId);
  if (!emp) return fail(res, 404, 'Nie znaleziono pracownika w Twoim zespole.');
  const month = isMonth(b.month) ? b.month : today().slice(0, 7);
  const rows = db.prepare('SELECT indicator, COUNT(*) n FROM evidence WHERE employee_id=? AND date>=? AND date<=? GROUP BY indicator').all(emp.id, `${month}-01`, monthEnd(month));
  const lines = rows.map(r => `- ${INDICATORS.get(r.indicator)?.k.toLowerCase()} / ${INDICATORS.get(r.indicator)?.text.replace(/\n/g, ' ')}: ${r.n} dow.`).join('\n');
  const fallback = rows.length
    ? `Pytania do rozmowy (do 20 minut):\n- Co w ostatnim miesiącu poszło zgodnie z planem przy: ${rows.slice(0, 2).map(r => INDICATORS.get(r.indicator)?.k.toLowerCase()).join(', ')}?\n- Co utrudniało realizację zadań i czego potrzebujesz?\n- Jaki jeden cel ustalamy na kolejny miesiąc?`
    : 'Brak informacji w tym miesiącu. Pytania: Jakie zadania zamknąłeś(-aś)? Co wymaga uwagi? Jaki jeden cel na kolejny miesiąc?';
  try {
    const text = await llm(`Jesteś asystentem przełożonego w urzędzie przed krótką (do 20 minut) rozmową miesięczną. ${RULES} Zaproponuj 3 pytania otwarte o rezultaty zadań i potrzebne wsparcie. Nie pytaj o czas pracy, obecność, stan zdrowia ani cechy osobowości. Nie proponuj ocen ani punktów.`,
      `Wskaźniki z informacjami w miesiącu (liczba informacji):\n${lines || 'brak'}`);
    audit(u.id, 'ai_checkin', `${emp.id}:${month}`); aiLog(null, u.id, 'checkin', lines, { text, source: 'ai' });
    send(res, 200, { text, source: 'ai', model: AI_MODEL });
  } catch {
    aiLog(null, u.id, 'checkin', lines, { text: fallback, source: 'rules' });
    send(res, 200, { text: fallback + '\n\n' + AI_RULE_NOTE, source: 'rules' });
  }
});

// ---------- Metryki wsparcia przełożonego (tylko zbiorczo) ----------
// Mierzymy proces, nie osoby: wyniki pokazujemy dopiero, gdy dane pochodzą od co najmniej K_MIN przełożonych,
// bez podziału na osoby i bez rankingu. Mediany zamiast średnich. Brak pomiaru czasu pracy i aktywności (sesji, kliknięć).
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const monthsBetween = (from, to) => {
  const out = [], end = to.slice(0, 7);
  let [y, m] = from.slice(0, 7).split('-').map(Number);
  for (let k = from.slice(0, 7); k <= end && out.length < 61; k = `${y}-${String(m).padStart(2, '0')}`) { out.push(k); if (++m > 12) { m = 1; y++; } }
  return out;
};
const share = (n, d) => (d ? Math.round(n / d * 100) : null);
function supportMetrics() {
  const evals = db.prepare("SELECT * FROM evals WHERE status!='draft' AND typ IN ('B','C')").all();
  const managers = new Set(evals.map(e => e.evaluator_id)).size;
  const base = { kMin: K_MIN, managers, suppressed: managers < K_MIN };
  if (base.suppressed) return base;
  const submitAt = new Map(db.prepare("SELECT target, MIN(at) at FROM audit WHERE action='submit_eval' GROUP BY target").all().map(r => [r.target, r.at]));
  // 3. Ocenianie: w ilu miesiącach okresu jest co najmniej jedną informację (nie liczba informacji – nie zachęcamy do nadzoru)
  const coverage = [];
  for (const e of evals) {
    if (!isDate(e.period_from) || !isDate(e.period_to) || e.period_from > e.period_to) continue;
    const months = monthsBetween(e.period_from, e.period_to);
    const withEv = new Set(db.prepare('SELECT DISTINCT substr(date,1,7) m FROM evidence WHERE employee_id=? AND date>=? AND date<=?').all(e.employee_id, e.period_from, e.period_to).map(r => r.m));
    coverage.push(Math.round(withEv.size / months.length * 100));
  }
  // 5. Ocena na piśmie: dni od utworzenia szkicu do złożenia; poprawki po złożeniu (uwzględniony sprzeciw)
  const days = evals.map(e => submitAt.get(String(e.id)) && (Date.parse(submitAt.get(String(e.id))) - Date.parse(e.created)) / 86400000).filter(d => d >= 0);
  const revised = db.prepare("SELECT COUNT(DISTINCT eval_id) n FROM revisions").get().n;
  // 1–2. Rozmowa rozpoczynająca: w terminie 30 dni; czy kryteria dodatkowe zmieniły się między rozmową a oceną
  const kicks = db.prepare('SELECT * FROM kickoffs WHERE due IS NOT NULL').all();
  const withKick = evals.map(e => ({ e, k: JSON.parse(e.data || '{}').kickoff })).filter(x => x.k);
  const changed = withKick.filter(({ e, k }) => {
    const mand = mandKeysFor(e.typ), fin = (JSON.parse(e.data || '{}').criteria || []).filter(c => !mand.includes(c)).sort();
    return JSON.stringify(fin) !== JSON.stringify([...k.extraCriteria].sort());
  }).length;
  // 4. Rozmowa oceniająca: dobrowolna ankieta 1–5 bez identyfikatora osoby
  const ratings = db.prepare('SELECT rating FROM prep_survey').all().map(r => r.rating);
  return { ...base, evals: evals.length,
    coverage: { medianPct: median(coverage), n: coverage.length },
    submit: { medianDays: days.length ? Math.round(median(days) * 10) / 10 : null, n: days.length, revisedPct: share(revised, evals.length) },
    kickoff: { onTimePct: share(kicks.filter(k => k.date <= k.due).length, kicks.length), n: kicks.length, criteriaChangedPct: share(changed, withKick.length), withKickoff: withKick.length },
    prep: ratings.length >= K_MIN ? { n: ratings.length, distribution: Object.fromEntries([1, 2, 3, 4, 5].map(v => [v, ratings.filter(r => r === v).length])), median: median(ratings) } : { n: ratings.length, suppressed: true } };
}
route('GET', '/api/metrics', async (req, res, u) => {
  if (u.role !== 'przelozony') return fail(res, 403, 'Metryki są dla przełożonych.');
  send(res, 200, supportMetrics());
});
// Ankieta po złożeniu oceny: „Jak oceniasz przygotowanie do rozmowy oceniającej?” (1–5), raz na ocenę, dobrowolnie.
// Zapisujemy tylko wartość i miesiąc – bez osoby i bez oceny (anonimowo); ocena dostaje wyłącznie znacznik „ankieta wypełniona”.
route('POST', '/api/evals/:id/survey', async (req, res, u, p) => {
  const ev = ownEval(u, p.id);
  if (!ev || ev.evaluator_id !== u.id || u.role !== 'przelozony') return fail(res, 403, 'Brak dostępu.');
  if (ev.status === 'draft') return fail(res, 409, 'Ankieta jest po złożeniu oceny.');
  if (ev.survey_done) return fail(res, 409, 'Ankietę dla tej oceny już wypełniono.');
  const b = await readJson(req);
  const rating = Number(b.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return invalid(res, { rating: 'Wybierz wartość od 1 do 5.' });
  db.prepare('INSERT INTO prep_survey(rating, month) VALUES(?, ?)').run(rating, today().slice(0, 7));
  db.prepare('UPDATE evals SET survey_done=1 WHERE id=?').run(ev.id);
  send(res, 201, { ok: true });
});

// Dziennik zdarzeń – przegląd dla przełożonego (zgodność z RODO / audyt)
route('GET', '/api/audit', async (req, res, u) => {
  const rows = db.prepare('SELECT action,target,at,substr(prev_value,1,300) AS prev_value,substr(new_value,1,300) AS new_value FROM audit WHERE user_id=? ORDER BY id DESC LIMIT 100').all(u.id);
  // Weryfikacja: łańcuch skrótów (każdy wpis pasuje do poprzedniego) i pieczęć HMAC każdego wpisu (klucz spoza bazy).
  // Bez klucza nie da się przeliczyć pieczęci po zmianie wpisu ani usunąć wpisu bez śladu (przerwany łańcuch i numeracja).
  const all = db.prepare('SELECT * FROM audit ORDER BY id').all();
  let prev = '', broken = null, lastId = 0;
  for (const r of all) {
    const chainBad = r.hash && (r.prev_hash !== prev || auditHash(prev, r.user_id, r.action, r.target, r.at, r.prev_value, r.new_value) !== r.hash);
    const macBad = !r.mac || r.mac.length !== 64 || !crypto.timingSafeEqual(Buffer.from(r.mac), Buffer.from(auditMac(r)));
    if (chainBad || macBad || r.id !== lastId + 1) { broken = r.id; break; }
    if (r.hash) prev = r.hash;
    lastId = r.id;
  }
  const aiRows = db.prepare('SELECT eval_id,action,model,source,at,substr(output_text,1,400) AS output FROM ai_log WHERE user_id=? ORDER BY id DESC LIMIT 50').all(u.id);
  send(res, 200, { audit: rows, chainOk: broken === null, brokenAt: broken, ai: aiRows });
});

// ---------- Podpis systemu, zapoznanie i sprzeciw (art. 83 ustawy o służbie cywilnej) ----------
route('POST', '/api/evals/:id/sign', async (req, res, u, p) => {
  const ev = ownEval(u, p.id);
  if (!ev || ev.evaluator_id !== u.id || u.role !== 'przelozony') return fail(res, 403, 'Brak dostępu.');
  if (ev.status === 'draft') return fail(res, 409, 'Najpierw złóż ocenę.');
  const hash = docHash(ev), at = now();
  db.prepare('INSERT INTO signatures(eval_id,signer_id,role,signed_at,doc_sha256,sig_value,note) VALUES(?,?,?,?,?,?,?)')
    .run(ev.id, u.id, 'przelozony', at, hash, sigValue(hash, u.id, 'przelozony', at), SIG_NOTE);
  audit(u.id, 'sign_eval', ev.id);
  send(res, 201, { ok: true, signedAt: at, hash });
});
route('POST', '/api/evals/:id/acknowledge', async (req, res, u, p) => {
  const ev = ownEval(u, p.id);
  if (!ev || ev.employee_id !== u.id || u.role !== 'pracownik') return fail(res, 403, 'Brak dostępu.');
  if (ev.status === 'draft') return fail(res, 409, 'Ocena nie jest jeszcze złożona.');
  if (ev.ack_at) return fail(res, 409, 'Zapoznanie już zarejestrowano.');
  const hash = docHash(ev), at = now();
  db.prepare('UPDATE evals SET ack_at=? WHERE id=?').run(at, ev.id);
  db.prepare('INSERT INTO signatures(eval_id,signer_id,role,signed_at,doc_sha256,sig_value,note) VALUES(?,?,?,?,?,?,?)')
    .run(ev.id, u.id, 'pracownik', at, hash, sigValue(hash, u.id, 'pracownik', at), SIG_NOTE);
  audit(u.id, 'acknowledge_eval', ev.id);
  send(res, 201, { ok: true, ackAt: at, objectionDeadline: new Date(Date.parse(at) + 7 * 86400000).toISOString() });
});
route('POST', '/api/evals/:id/objection', async (req, res, u, p) => {
  const ev = ownEval(u, p.id);
  if (!ev || ev.employee_id !== u.id || u.role !== 'pracownik') return fail(res, 403, 'Brak dostępu.');
  if (!ev.ack_at) return fail(res, 409, 'Sprzeciw przysługuje po zapoznaniu się z oceną.');
  if (ev.objection_at) return fail(res, 409, 'Sprzeciw już złożono.');
  const deadline = Date.parse(ev.ack_at) + 7 * 86400000;
  if (Date.now() > deadline) return fail(res, 409, 'Termin 7 dni na sprzeciw minął.');
  const b = await readJson(req);
  const text = str(b.text, 3000);
  if (text.length < 10) return fail(res, 400, 'Opisz powód sprzeciwu (min. 10 znaków).');
  db.prepare('UPDATE evals SET objection_at=?, objection_text=?, updated=? WHERE id=?').run(now(), text, now(), ev.id);
  audit(u.id, 'objection_eval', ev.id);
  send(res, 201, { ok: true });
});
// Rozpatrzenie sprzeciwu przez przełożonego (art. 83 ust. 3: 14 dni). Uwzględnienie → ocena wraca do poprawy (art. 83 ust. 3, zmiana lub ponowne sporządzenie).
route('POST', '/api/evals/:id/objection-decision', async (req, res, u, p) => {
  const ev = ownEval(u, p.id);
  if (!ev || ev.evaluator_id !== u.id || u.role !== 'przelozony') return fail(res, 403, 'Brak dostępu.');
  if (!ev.objection_at || ev.objection_decided_at) return fail(res, 409, 'Brak sprzeciwu do rozpatrzenia.');
  const b = await readJson(req);
  const result = b.result === 'uwzglednione' ? 'uwzględniono' : b.result === 'nieuwzglednione' ? 'nieuwzględniono' : null;
  if (!result) return fail(res, 400, 'Wybierz: uwzględniono albo nieuwzględniono.');
  const note = str(b.note, 1000);
  const at = now();
  if (result === 'uwzględniono') {
    db.prepare('INSERT INTO revisions(eval_id,rev,data,status_before,reason,at) VALUES(?,?,?,?,?,?)').run(ev.id, ev.revision, ev.data, ev.status, `sprzeciw: ${ev.objection_text || ''}`, at);
    db.prepare("UPDATE evals SET status='draft', revision=revision+1, ack_at=NULL, objection_at=NULL, objection_text=NULL, objection_result=?, objection_decided_at=?, updated=? WHERE id=?").run(result, at, at, ev.id);
  } else {
    db.prepare('UPDATE evals SET objection_result=?, objection_decided_at=?, updated=? WHERE id=?').run(result, at, at, ev.id);
  }
  audit(u.id, 'objection_decision', `${ev.id}:${result}${note ? ': ' + note : ''}`);
  send(res, 200, { ok: true, result, reopened: result === 'uwzględniono' });
});
route('GET', '/api/evals/:id/signatures', async (req, res, u, p) => {
  const ev = ownEval(u, p.id);
  const can = ev && ((u.role === 'przelozony' && ev.evaluator_id === u.id) || (u.role === 'pracownik' && ev.employee_id === u.id && ev.status !== 'draft'));
  if (!can) return fail(res, 403, 'Brak dostępu.');
  const rows = db.prepare('SELECT s.id,s.signer_id,s.role,s.signed_at,s.doc_sha256,s.sig_value,u.name FROM signatures s JOIN users u ON u.id=s.signer_id WHERE s.eval_id=? ORDER BY s.id').all(ev.id);
  const current = docHash(ev);
  const signed = rows.map(r => ({ ...r, valid: r.sig_value === sigValue(r.doc_sha256, r.signer_id, r.role, r.signed_at), unchanged: r.doc_sha256 === current }));
  send(res, 200, { signatures: signed.map(({ sig_value, signer_id, ...x }) => x), ackAt: ev.ack_at, objectionAt: ev.objection_at, objectionText: ev.objection_text, objectionResult: ev.objection_result || null, decisionDeadline: ev.objection_at ? new Date(Date.parse(ev.objection_at) + 14 * 86400000).toISOString() : null, revision: ev.revision, objectionDeadline: ev.ack_at ? new Date(Date.parse(ev.ack_at) + 7 * 86400000).toISOString() : null });
});

// ---------- Serwer ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const SECURITY = {
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
  'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin', 'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'cross-origin-opener-policy': 'same-origin', 'cross-origin-resource-policy': 'same-origin',
  // HSTS tylko w trybie produkcyjnym (za HTTPS); lokalnie serwer działa po HTTP
  ...(PROD ? { 'strict-transport-security': 'max-age=31536000; includeSubDomains' } : {}),
};
const STATIC = new Set(['/', '/index.html', '/app/app.js', '/app/app.css', '/app/kompetencje.js', '/app/icons.js']);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith('/api/')) {
      const isAsset = /^\/app\/assets\/(faces\/|fonts\/)?[a-z0-9-]+\.(svg|png|jpg|woff2)$/.test(url.pathname);
      if (!STATIC.has(url.pathname) && !isAsset) {
        // Nieznany adres otwierany w przeglądarce: ładna strona 404 (HTML), dla reszty JSON
        if (req.method === 'GET' && String(req.headers.accept || '').includes('text/html')) {
          return res.writeHead(404, { 'content-type': 'text/html; charset=utf-8', ...SECURITY }) && res.end(fs.readFileSync(path.join(ROOT, 'app', '404.html')));
        }
        return send(res, 404, { error: 'not_found' }, SECURITY);
      }
      const file = path.join(ROOT, url.pathname === '/' ? 'index.html' : url.pathname);
      const data = fs.readFileSync(file);
      return res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', ...SECURITY }) && res.end(data);
    }
    // Ochrona CSRF dla zmian (wszystko poza GET):
    // 1) dokładnie application/json – przeglądarka nie wyśle go z innej strony bez preflight CORS (którego nie zezwalamy);
    //    dotyczy także pustych żądań (UI zawsze wysyła {}), więc nie ma obejścia przez content-length: 0;
    // 2) Origin i Sec-Fetch-Site, gdy przeglądarka je podaje, muszą wskazywać tę samą stronę.
    if (req.method !== 'GET') {
      const ctype = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (ctype !== 'application/json') return fail(res, 415, 'Wymagany JSON.');
      const origin = req.headers.origin, site = req.headers['sec-fetch-site'];
      if ((origin && origin !== appOrigin(req)) || (site && !['same-origin', 'none'].includes(site))) {
        // Do logu serwera, nie do dziennika (anonimowe żądania nie mogą zapełniać dziennika tylko do dopisywania)
        console.warn(`CSRF zablokowane: ${req.method} ${url.pathname} origin=${JSON.stringify(String(origin || '').slice(0, 100))} site=${JSON.stringify(String(site || '').slice(0, 30))}`);
        return fail(res, 403, 'Żądanie z innej strony zostało zablokowane.');
      }
    }
    const route_ = routes.find(r => {
      if (r.method !== req.method) return false;
      const pa = r.pattern.split('/'), ua = url.pathname.split('/');
      return pa.length === ua.length && pa.every((seg, i) => seg.startsWith(':') || seg === ua[i]);
    });
    if (!route_) return fail(res, 404, 'Nie ma takiej ścieżki.');
    const offMod = modeOffFor(url.pathname);
    if (offMod) return fail(res, 403, `Moduł wyłączony w ustawieniach: ${MODULES[offMod].label}.`);
    const pa = route_.pattern.split('/'), ua = url.pathname.split('/');
    const params = {};
    pa.forEach((seg, i) => { if (seg.startsWith(':')) params[seg.slice(1)] = Number(ua[i]); });
    const publicPaths = ['/api/session', '/api/login', '/api/logout', '/api/model', '/api/demo', '/api/activate'];
    let u = null;
    if (!publicPaths.includes(url.pathname) || url.pathname === '/api/session') {
      u = sessionUser(req);
      if (!u && url.pathname !== '/api/session') return fail(res, 401, 'Zaloguj się.');
      // Hasło nadane przez kogoś innego: do czasu zmiany dostępne są tylko dane konta i zmiana hasła
      if (u?.must_change && !['/api/me', '/api/session', '/api/password'].includes(url.pathname)) return fail(res, 403, 'Zmień hasło, aby kontynuować.', { code: 'password_change_required' });
    }
    await route_.handler(req, res, u, params);
  } catch (e) {
    const code = e.message === 'too_large' ? 413 : e.message === 'bad_json' ? 400 : 500;
    if (code === 500) console.error(e);
    fail(res, code, code === 500 ? 'Błąd serwera.' : 'Nieprawidłowe dane.');
  }
}).listen(PORT, '127.0.0.1', () => console.log(`Kompas Kompetencji: http://localhost:${server.address().port}  (AI: ${AI_URL}, model ${AI_MODEL})`));

// Wygaszanie sesji
setInterval(() => {
  const t = Date.now();
  for (const [k, s] of sessions) if (s.exp < t) sessions.delete(k);
  for (const [k] of loginFails) if (!recentFails(k).length) loginFails.delete(k);
}, 60000).unref();
