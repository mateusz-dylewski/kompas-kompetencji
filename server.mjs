// Kompas Kompetencji – serwer prototypu (Node.js >= 22.5, zero zależności)
// Uruchomienie: node server.mjs   → http://localhost:8080
// AI: lokalny Ollama z modelem Qwen (domyślnie http://127.0.0.1:11434). Zmienne: KK_AI_URL, KK_AI_MODEL.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { buildPdf, buildXml, computeResults } from './lib/documents.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8080;
const AI_URL = process.env.KK_AI_URL || 'http://127.0.0.1:11434';
const AI_MODEL = process.env.KK_AI_MODEL || 'qwen2.5:14b';
const K_MIN = 5; // minimalna liczba osób do pokazania agregatów zespołu
const SESSION_MS = 8 * 3600 * 1000;

// ---------- Baza danych ----------
fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
const db = new DatabaseSync(path.join(ROOT, 'data', 'kompas.db'));
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

// Model kompetencji (ten sam plik co w przeglądarce)
const MODEL = JSON.parse(fs.readFileSync(path.join(ROOT, 'app', 'kompetencje.js'), 'utf8')
  .replace(/^\s*window\.KK_MODEL\s*=\s*/, '').replace(/;\s*$/, ''));
const MODEL_KEYS = new Set(MODEL.map(c => c.k));
// Kryteria obowiązkowe wg rozporządzenia z 4.04.2016: Arkusz B (kierowanie) i Arkusz C (pozostałe stanowiska)
const MAND_B = ['ZARZĄDZANIE LUDŹMI', 'PODEJMOWANIE DECYZJI', 'ORGANIZACJA PRACY', 'WSPÓŁPRACA', 'KOMUNIKACJA'];
const MAND_C = ['WYKORZYSTYWANIE WIEDZY', 'RZETELNOŚĆ', 'ORGANIZACJA PRACY', 'WSPÓŁPRACA', 'KOMUNIKACJA'];
const mandFor = typ => (typ === 'C' ? MAND_C : typ === 'B' ? MAND_B : []);
const MAX_EXTRA = 3;
const PTS5 = [1, 3, 5, 7, 9];
const PTS3 = [3, 5, 7];

const now = () => new Date().toISOString();
const hashPass = (pw, salt = crypto.randomBytes(16).toString('hex')) =>
  `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
const checkPass = (pw, stored) => {
  const [salt, hash] = stored.split(':');
  const a = Buffer.from(crypto.scryptSync(pw, salt, 64).toString('hex'));
  const b = Buffer.from(hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const audit = (uid, action, target = '') =>
  db.prepare('INSERT INTO audit(user_id,action,target,at) VALUES(?,?,?,?)').run(uid, action, String(target), now());

// Dane demonstracyjne (tylko gdy baza jest pusta)
function seed() {
  if (db.prepare('SELECT COUNT(*) n FROM users').get().n) return;
  const demoPass = 'Demo-kompas-2026!';
  const ins = db.prepare('INSERT INTO users(email,name,role,position,unit,manager_id,pass,avatar) VALUES(?,?,?,?,?,?,?,?)');
  const mgr = ins.run('przelozony@demo.kk', 'Joanna Mazur', 'przelozony', 'Dyrektor Departamentu Cyfryzacji', 'Departament Cyfryzacji', null, hashPass(demoPass), '/app/assets/faces/f1.jpg').lastInsertRowid;
  // Dane przykładowe: imiona, nazwiska i stanowiska wymyślone; zdjęcia to darmowe placeholdery do podmiany
  const staff = [
    ['Katarzyna Wiśniewska', 'Specjalistka ds. analiz danych', 'f3'],
    ['Michał Zieliński', 'Główny specjalista ds. infrastruktury', 'f2'],
    ['Agnieszka Dąbrowska', 'Starszy referent ds. zamówień', 'f5'],
    ['Tomasz Nowak', 'Inspektor ds. bezpieczeństwa informacji', 'f4'],
    ['Magdalena Kaczmarek', 'Specjalistka ds. komunikacji', 'f7'],
    ['Piotr Lewandowski', 'Referent ds. dostępności cyfrowej', 'f6'],
  ];
  const emps = staff.map(([n, pos, av], i) => ins.run(`pracownik${i + 1}@demo.kk`, n, 'pracownik', pos, 'Departament Cyfryzacji', mgr, hashPass(demoPass), `/app/assets/faces/${av}.jpg`).lastInsertRowid);
  let seedN = 7;
  const rnd = () => ((seedN = (seedN * 9301 + 49297) % 233280) / 233280);
  const insE = db.prepare('INSERT INTO evals(employee_id,evaluator_id,typ,period_from,period_to,status,data,created,updated) VALUES(?,?,?,?,?,?,?,?,?)');
  emps.forEach((eid, i) => {
    const typ = i < 2 ? 'pierwsza' : 'B';
    const status = i === 0 ? 'discussed' : i < 5 ? 'submitted' : 'draft';
    const criteria = (typ === 'pierwsza' ? MODEL.slice(0, 6) : MODEL.filter(c => mandFor(typ).some(m => c.k.startsWith(m)))).map(c => c.k);
    const ratings = {};
    MODEL.filter(c => criteria.includes(c.k)).forEach(c => c.w.forEach((w, wi) => {
      const lvl = typ === 'pierwsza' ? 1 + Math.floor(rnd() * 3) : Math.floor(rnd() * 5);
      ratings[`${c.k}|${wi}`] = { lvl, ex: 'Przykład z okresu oceny (dane demonstracyjne).' };
    }));
    const data = { criteria, ratings, dev: 'Szkolenie z analizy danych do końca kwartału.' };
    insE.run(eid, mgr, typ, '2026-01-01', '2026-06-30', status, JSON.stringify(data), now(), now());
  });
  const insG = db.prepare('INSERT INTO goals(user_id,s,m,a,r,t,done,progress,created) VALUES(?,?,?,?,?,?,?,?,?)');
  emps.forEach((eid, i) => insG.run(eid, 'Obsługa narzędzia analitycznego', '2 raporty miesięcznie samodzielnie', '2 godziny szkolenia tygodniowo', 'Przejęcie raportowania zespołu', '2026-12-31', i % 3 === 0 ? 1 : 0, 20 + i * 12, now()));
}
seed();

// ---------- Sesje ----------
const sessions = new Map(); // token -> { uid, exp }
function sessionUser(req) {
  const m = /(?:^|;\s*)kk_sid=([a-f0-9]{64})/.exec(req.headers.cookie || '');
  if (!m) return null;
  const s = sessions.get(m[1]);
  if (!s || s.exp < Date.now()) { sessions.delete(m[1]); return null; }
  return db.prepare('SELECT id,email,name,role,position,unit,manager_id,avatar FROM users WHERE id=?').get(s.uid) || null;
}

// ---------- Pomocnicze ----------
const send = (res, code, obj, extra = {}) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra });
  res.end(JSON.stringify(obj));
};
const fail = (res, code, msg, extra) => send(res, code, { error: msg, ...(extra || {}) });
const readJson = req => new Promise((ok, bad) => {
  let b = '';
  req.on('data', c => { b += c; if (b.length > 1e6) { req.destroy(); bad(new Error('too_large')); } });
  req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch { bad(new Error('bad_json')); } });
});
const str = (x, max = 500) => (typeof x === 'string' ? x.trim().slice(0, max) : '');
const publicUser = u => u && ({ id: u.id, email: u.email, name: u.name, role: u.role, position: u.position, unit: u.unit, avatar: u.avatar || null });
const ptsFor = (typ, lvl) => (lvl === 'none' ? null : typ === 'pierwsza' ? PTS3[lvl - 1] : PTS5[lvl]);

// Oblicza średnie punktów per kompetencja z ocen
function scoreEval(ev) {
  const data = typeof ev.data === 'string' ? JSON.parse(ev.data || '{}') : (ev.data || {});
  const out = {};
  for (const k of data.criteria || []) {
    const comp = MODEL.find(c => c.k === k); if (!comp) continue;
    const pts = comp.w.map((_, wi) => data.ratings?.[`${k}|${wi}`]).filter(r => r && r.lvl !== 'none' && r.lvl !== undefined)
      .map(r => ptsFor(ev.typ, r.lvl));
    out[k] = { avg: pts.length ? pts.reduce((a, b) => a + b, 0) / pts.length : null, n: pts.length, total: comp.w.length };
  }
  return out;
}
const evalRow = ev => ({ ...ev, data: JSON.parse(ev.data || '{}') });

// Walidacja danych oceny z formularza
function sanitizeData(input, typ) {
  const criteria = (Array.isArray(input?.criteria) ? input.criteria : []).filter(k => MODEL_KEYS.has(k));
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
  const wynik = ['pozytywna', 'negatywna'].includes(input?.wynik) ? input.wynik : '';
  return { criteria, ratings, dev: str(input?.dev, 2000), rozmowa: date(input?.rozmowa), terminOceny: date(input?.terminOceny),
    uzasadnienie: str(input?.uzasadnienie, 4000), wynik };
}
// Walidacja do złożenia oceny
function missingForSubmit(ev) {
  const data = typeof ev.data === 'string' ? JSON.parse(ev.data || '{}') : (ev.data || {});
  const miss = [];
  for (const k of data.criteria || []) {
    const comp = MODEL.find(c => c.k === k);
    comp.w.forEach((w, wi) => {
      const r = data.ratings?.[`${k}|${wi}`];
      if (!r) miss.push(`${comp.k}: wskaźnik ${wi + 1} nieoceniony`);
      else if (r.lvl !== 'none' && !(r.ex || '').trim()) miss.push(`${comp.k}: wskaźnik ${wi + 1} bez uzasadnienia`);
    });
  }
  return miss;
}

// ---------- AI (lokalny Qwen przez Ollama) ----------
const AI_RULE_NOTE = 'Wygenerowano regułowo (lokalny model AI niedostępny).';
async function ollamaStatus() {
  try {
    const r = await fetch(`${AI_URL}/api/tags`, { signal: AbortSignal.timeout(2500) });
    if (!r.ok) return { ok: false, model: AI_MODEL };
    const j = await r.json();
    const has = (j.models || []).some(m => m.name === AI_MODEL || m.model === AI_MODEL);
    return { ok: true, model: AI_MODEL, modelInstalled: has, url: 'lokalnie' };
  } catch { return { ok: false, model: AI_MODEL }; }
}
async function llm(system, user) {
  const r = await fetch(`${AI_URL}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: AI_MODEL, stream: false, think: false, options: { temperature: 0.3, num_predict: 700 },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
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
const RULES = `Zasady: nie wystawiasz ocen i nie podejmujesz decyzji – to należy do przełożonego. Nie oceniasz osoby, tylko zachowania. Odpowiadasz po polsku, zwięźle, w punktach. Nie podajesz imion ani danych osobowych.`;

// ---------- Trasy API ----------
const routes = [];
const route = (method, pattern, handler) => routes.push({ method, pattern, handler });

route('POST', '/api/login', async (req, res) => {
  const b = await readJson(req);
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(str(b.email, 200).toLowerCase());
  if (!u || !checkPass(String(b.password || ''), u.pass)) {
    audit(null, 'login_fail', str(b.email, 200));
    return fail(res, 401, 'Nieprawidłowy e-mail lub hasło.');
  }
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { uid: u.id, exp: Date.now() + SESSION_MS });
  audit(u.id, 'login');
  send(res, 200, { user: publicUser(u) }, { 'set-cookie': `kk_sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}` });
});
route('POST', '/api/logout', async (req, res) => {
  const m = /kk_sid=([a-f0-9]{64})/.exec(req.headers.cookie || '');
  if (m) sessions.delete(m[1]);
  send(res, 200, { ok: true }, { 'set-cookie': 'kk_sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
});
route('GET', '/api/me', async (req, res, u) => send(res, 200, { user: publicUser(u), ai: await ollamaStatus() }));
route('GET', '/api/model', async (req, res) => send(res, 200, { model: MODEL, mandB: MAND_B, mandC: MAND_C, maxExtra: MAX_EXTRA, kMin: K_MIN }));

// Dashboard pracownika
route('GET', '/api/dashboard', async (req, res, u) => {
  if (u.role === 'pracownik') {
    const evals = db.prepare("SELECT * FROM evals WHERE employee_id=? AND status!='draft' ORDER BY updated DESC").all(u.id).map(evalRow);
    const latest = evals[0] || null;
    const goals = db.prepare('SELECT * FROM goals WHERE user_id=? ORDER BY id').all(u.id);
    const manager = u.manager_id ? db.prepare('SELECT name FROM users WHERE id=?').get(u.manager_id) : null;
    return send(res, 200, {
      role: u.role, manager: manager?.name || null,
      evals: evals.map(e => ({ id: e.id, typ: e.typ, status: e.status, periodFrom: e.period_from, periodTo: e.period_to, updated: e.updated })),
      latestScores: latest ? scoreEval(latest) : null,
      latestDev: latest?.data?.dev || '',
      goals,
    });
  }
  // Dashboard przełożonego
  const team = db.prepare('SELECT id,name,position,avatar FROM users WHERE manager_id=? ORDER BY name').all(u.id);
  const evals = db.prepare('SELECT * FROM evals WHERE evaluator_id=? ORDER BY updated DESC').all(u.id).map(evalRow);
  const byEmp = {};
  for (const e of evals) if (!byEmp[e.employee_id]) byEmp[e.employee_id] = e; // najnowsza ocena per pracownik
  const counts = { draft: 0, submitted: 0, discussed: 0, none: 0 };
  const teamRows = team.map(t => {
    const e = byEmp[t.id];
    const st = e ? e.status : 'none';
    counts[st]++;
    return { id: t.id, name: t.name, position: t.position, avatar: t.avatar || null, status: st, evalId: e?.id || null, typ: e?.typ || null, updated: e?.updated || null };
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
  send(res, 200, { role: u.role, team: teamRows, counts, evals: evals.map(e => ({ id: e.id, employeeId: e.employee_id, typ: e.typ, status: e.status, updated: e.updated })), aggregate: agg, goalsOpen });
});

route('POST', '/api/employees', async (req, res, u) => {
  if (u.role !== 'przelozony') return fail(res, 403, 'Tylko przełożony może dodawać pracowników.');
  const b = await readJson(req);
  const email = str(b.email, 200).toLowerCase(), name = str(b.name, 120), pw = String(b.password || '');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !name || pw.length < 10) return fail(res, 400, 'Podaj e-mail, imię i nazwisko oraz hasło (min. 10 znaków).');
  try {
    const id = db.prepare('INSERT INTO users(email,name,role,position,unit,manager_id,pass) VALUES(?,?,?,?,?,?,?)')
      .run(email, name, 'pracownik', str(b.position, 120), str(b.unit, 120), u.id, hashPass(pw)).lastInsertRowid;
    audit(u.id, 'create_employee', id);
    send(res, 201, { id });
  } catch { fail(res, 409, 'Konto z tym adresem już istnieje.'); }
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
  const data = sanitizeData({ criteria: MODEL.filter(c => mandFor(typ).some(m => c.k.startsWith(m))).map(c => c.k), ratings: {} }, typ);
  const id = db.prepare('INSERT INTO evals(employee_id,evaluator_id,typ,period_from,period_to,status,data,created,updated) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(emp.id, u.id, typ, str(b.periodFrom, 10), str(b.periodTo, 10), 'draft', JSON.stringify(data), now(), now()).lastInsertRowid;
  audit(u.id, 'create_eval', id);
  send(res, 201, { id });
});
const ownEval = (u, id) => db.prepare('SELECT * FROM evals WHERE id=?').get(id) || null;
route('GET', '/api/evals/:id/document', async (req, res, u, p) => {
  const ev = ownEval(u, p.id);
  if (!ev) return fail(res, 404, 'Nie znaleziono.');
  const canSee = (u.role === 'przelozony' && ev.evaluator_id === u.id) || (u.role === 'pracownik' && ev.employee_id === u.id && ev.status !== 'draft');
  if (!canSee) return fail(res, 403, 'Brak dostępu.');
  const url = new URL(req.url, 'http://x');
  const format = url.searchParams.get('format') === 'xml' ? 'xml' : 'pdf';
  const inline = url.searchParams.get('inline') === '1';
  const kind = ev.typ;
  const emp = db.prepare('SELECT name,position FROM users WHERE id=?').get(ev.employee_id);
  const mgr = db.prepare('SELECT name,position,unit FROM users WHERE id=?').get(ev.evaluator_id);
  const data = JSON.parse(ev.data || '{}');
  const model = MODEL;
  const ctx = { ev: { ...ev, data }, emp, mgr: { ...mgr }, model, mandB: MAND_B, mandC: MAND_C,
    unit: mgr.unit || process.env.KK_UNIT || 'Nazwa urzędu (uzupełnij)',
    statusLabel: { draft: 'szkic', submitted: 'złożona', discussed: 'omówiona' }[ev.status] };
  ctx.res = computeResults(ctx.ev, model);
  const base = `arkusz-${kind}-${ev.id}`;
  audit(u.id, 'download_doc', `${ev.id}:${format}`);
  if (format === 'xml') {
    const body = buildXml(kind, ctx);
    res.writeHead(200, { 'content-type': 'application/xml; charset=utf-8', 'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${base}.xml"`, 'cache-control': 'no-store', ...SECURITY });
    return res.end(body);
  }
  const pdfBytes = await buildPdf(kind, ctx);
  res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${base}.pdf"`, 'cache-control': 'no-store', ...SECURITY });
  res.end(Buffer.from(pdfBytes));
});
route('GET', '/api/evals/:id', async (req, res, u, p) => {
  const ev = ownEval(u, p.id);
  if (!ev) return fail(res, 404, 'Nie znaleziono.');
  const canSee = (u.role === 'przelozony' && ev.evaluator_id === u.id) || (u.role === 'pracownik' && ev.employee_id === u.id && ev.status !== 'draft');
  if (!canSee) return fail(res, 403, 'Brak dostępu.');
  const emp = db.prepare('SELECT name,position,avatar FROM users WHERE id=?').get(ev.employee_id);
  send(res, 200, { eval: evalRow(ev), employee: emp, missing: u.role === 'przelozony' ? missingForSubmit(ev) : [] });
});
route('PUT', '/api/evals/:id', async (req, res, u, p) => {
  const ev = ownEval(u, p.id);
  if (!ev || ev.evaluator_id !== u.id || u.role !== 'przelozony') return fail(res, 403, 'Brak dostępu.');
  if (ev.status !== 'draft') return fail(res, 409, 'Ocena jest już złożona i nie można jej edytować.');
  const b = await readJson(req);
  const data = sanitizeData(b.data, ev.typ);
  db.prepare('UPDATE evals SET data=?, period_from=?, period_to=?, updated=? WHERE id=?')
    .run(JSON.stringify(data), str(b.periodFrom, 10) || ev.period_from, str(b.periodTo, 10) || ev.period_to, now(), ev.id);
  send(res, 200, { ok: true, missing: missingForSubmit({ ...ev, data: JSON.stringify(data) }) });
});
route('POST', '/api/evals/:id/submit', async (req, res, u, p) => {
  const ev = ownEval(u, p.id);
  if (!ev || ev.evaluator_id !== u.id || u.role !== 'przelozony') return fail(res, 403, 'Brak dostępu.');
  if (ev.status !== 'draft') return fail(res, 409, 'Ocena już złożona.');
  const miss = missingForSubmit(ev);
  if (miss.length) return fail(res, 422, 'Ocena nie jest kompletna.', { missing: miss.slice(0, 50) });
  db.prepare("UPDATE evals SET status='submitted', updated=? WHERE id=?").run(now(), ev.id);
  audit(u.id, 'submit_eval', ev.id);
  send(res, 200, { ok: true });
});
route('POST', '/api/evals/:id/discuss', async (req, res, u, p) => {
  const ev = ownEval(u, p.id);
  if (!ev || ev.evaluator_id !== u.id || u.role !== 'przelozony') return fail(res, 403, 'Brak dostępu.');
  if (ev.status !== 'submitted') return fail(res, 409, 'Najpierw złóż ocenę.');
  const b = await readJson(req);
  const data = JSON.parse(ev.data); data.dev = str(b.dev, 2000) || data.dev;
  db.prepare("UPDATE evals SET status='discussed', data=?, updated=? WHERE id=?").run(JSON.stringify(data), now(), ev.id);
  audit(u.id, 'discuss_eval', ev.id);
  send(res, 200, { ok: true });
});

// Cele SMART (pracownik)
route('GET', '/api/goals', async (req, res, u) => send(res, 200, { goals: db.prepare('SELECT * FROM goals WHERE user_id=? ORDER BY id').all(u.id) }));
route('POST', '/api/goals', async (req, res, u) => {
  const b = await readJson(req);
  const g = ['s', 'm', 'a', 'r'].map(k => str(b[k], 200));
  const t = str(b.t, 10);
  if (g.some(x => !x) || !/^\d{4}-\d{2}-\d{2}$/.test(t)) return fail(res, 400, 'Uzupełnij wszystkie pola SMART.');
  const id = db.prepare('INSERT INTO goals(user_id,s,m,a,r,t,done,progress,created) VALUES(?,?,?,?,?,?,0,0,?)').run(u.id, ...g, t, now()).lastInsertRowid;
  send(res, 201, { id });
});
route('PATCH', '/api/goals/:id', async (req, res, u, p) => {
  const g = db.prepare('SELECT * FROM goals WHERE id=? AND user_id=?').get(p.id, u.id);
  if (!g) return fail(res, 404, 'Nie znaleziono celu.');
  const b = await readJson(req);
  const progress = Math.min(100, Math.max(0, Number(b.progress ?? g.progress) | 0));
  db.prepare('UPDATE goals SET done=?, progress=? WHERE id=?').run(b.done === undefined ? g.done : (b.done ? 1 : 0), progress, g.id);
  send(res, 200, { ok: true });
});

// AI – wspomaganie przełożonego i pracownika (człowiek zawsze decyduje)
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
    const text = await llm(`Jesteś asystentem przełożonego w służbie cywilnej przygotowującego rozmowę oceniającą. ${RULES} Przygotuj: 1) 2 mocne strony z przykładami, 2) 2 obszary do rozwoju, 3) 3 pytania otwarte do rozmowy.`,
      `Wyniki oceny (kompetencja / wskaźnik: poziom):\n${evalSummaryForAI(ev)}`);
    audit(u.id, 'ai_talk', ev.id);
    send(res, 200, { text, source: 'ai', model: AI_MODEL });
  } catch {
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
    const text = await llm(`Jesteś asystentem formalnym oceny okresowej w służbie cywilnej. ${RULES} Sprawdź uzasadnienia i wskaż zdania oceniające osobę (np. „jest leniwy”) zamiast zachowania; zaproponuj przeformułowanie w języku obserwowalnych zachowań. Nie zmieniaj poziomów ocen.`,
      `Braki formalne: ${miss.join('; ') || 'brak'}\nUzasadnienia:\n${evalSummaryForAI(ev)}`);
    audit(u.id, 'ai_formal', ev.id);
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
    const text = await llm(`Jesteś doradcą rozwoju zawodowego pracownika służby cywilnej. ${RULES} Zaproponuj 2–3 działania rozwojowe w formie SMART. Nie oceniaj osoby.`,
      `Obszary do rozwoju: ${weak.join(', ') || 'brak'}\nCele: ${goals.map(g => `${g.s} (postęp ${g.progress}%)`).join('; ') || 'brak'}`);
    audit(u.id, 'ai_development');
    send(res, 200, { text, source: 'ai', model: AI_MODEL });
  } catch {
    send(res, 200, { text: fallback + '\n\n' + AI_RULE_NOTE, source: 'rules' });
  }
});

// Dziennik zdarzeń – przegląd dla przełożonego (zgodność z RODO / audyt)
route('GET', '/api/audit', async (req, res, u) => {
  const rows = db.prepare('SELECT action,target,at FROM audit WHERE user_id=? ORDER BY id DESC LIMIT 100').all(u.id);
  send(res, 200, { audit: rows });
});

// ---------- Serwer ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const SECURITY = {
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin', 'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};
const STATIC = new Set(['/', '/index.html', '/app/app.js', '/app/app.css', '/app/kompetencje.js', '/app/icons.js']);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith('/api/')) {
      const isAsset = /^\/app\/assets\/(faces\/|fonts\/)?[a-z0-9-]+\.(svg|png|jpg|woff2)$/.test(url.pathname);
      if (!STATIC.has(url.pathname) && !isAsset) return send(res, 404, { error: 'not_found' }, SECURITY);
      const file = path.join(ROOT, url.pathname === '/' ? 'index.html' : url.pathname);
      const data = fs.readFileSync(file);
      return res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', ...SECURITY }) && res.end(data);
    }
    // Ochrona CSRF: zmiany tylko JSON (przeglądarka nie wysyła go cross-site bez CORS)
    if (req.method !== 'GET' && !String(req.headers['content-type'] || '').includes('application/json') && req.headers['content-length'] !== '0') {
      return fail(res, 415, 'Wymagany JSON.');
    }
    const route_ = routes.find(r => {
      if (r.method !== req.method) return false;
      const pa = r.pattern.split('/'), ua = url.pathname.split('/');
      return pa.length === ua.length && pa.every((seg, i) => seg.startsWith(':') || seg === ua[i]);
    });
    if (!route_) return fail(res, 404, 'Nie ma takiej ścieżki.');
    const pa = route_.pattern.split('/'), ua = url.pathname.split('/');
    const params = {};
    pa.forEach((seg, i) => { if (seg.startsWith(':')) params[seg.slice(1)] = Number(ua[i]); });
    const publicPaths = ['/api/login', '/api/logout', '/api/model'];
    let u = null;
    if (!publicPaths.includes(url.pathname)) {
      u = sessionUser(req);
      if (!u) return fail(res, 401, 'Zaloguj się.');
    }
    await route_.handler(req, res, u, params);
  } catch (e) {
    const code = e.message === 'too_large' ? 413 : e.message === 'bad_json' ? 400 : 500;
    if (code === 500) console.error(e);
    fail(res, code, code === 500 ? 'Błąd serwera.' : 'Nieprawidłowe dane.');
  }
}).listen(PORT, '127.0.0.1', () => console.log(`Kompas Kompetencji: http://localhost:${PORT}  (AI: ${AI_URL}, model ${AI_MODEL})`));

// Wygaszanie sesji
setInterval(() => { const t = Date.now(); for (const [k, s] of sessions) if (s.exp < t) sessions.delete(k); }, 60000).unref();
