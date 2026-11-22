// Pełna ścieżka demo dla jury na poziomie API (atrapa modelu w stylu Ollama, bez prawdziwego AI):
// (a) dobór kryteriów i rozmowa rozpoczynająca, (b) rzetelna ocena, (c) rozmowa i plan rozwoju.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, asManager, asEmployee, todayStr } from './helpers.mjs';

const prompts = [];
let mock, srv, mgr, emp, empId, model, kickoff, evalId;
const ctx = { evIds: [] };

// Atrapa: odpowiedź zależy od roli opisanej w prompcie systemowym; kryteria dobiera z listy dozwolonych w prompcie użytkownika
const answer = (sys, user) => {
  if (/Dobierasz kryteria DODATKOWE/.test(sys)) {
    const keys = [...user.matchAll(/^- ([A-ZĄĆĘŁŃÓŚŹŻ ]+) \(/gm)].map(m => m[1]);
    return JSON.stringify({ propozycje: [
      { kryterium: keys[0], uzasadnienie: 'Obowiązki obejmują pracę wymagającą tego kryterium.' },
      { kryterium: 'KRYTERIUM SPOZA MODELU', uzasadnienie: 'Wymyślone.' },
    ] });
  }
  if (/asystentem formalnym/.test(sys)) return 'Uzasadnienia opisują zachowania. Nie wykryto zdań oceniających osobę.';
  if (/brief do rozmowy/.test(sys)) {
    const ids = ctx.evIds.map(i => `[I${i}]`);
    return `Tematy do omówienia:\n- współpraca\nPrzykłady z okresu:\n- Uzgodnił harmonogram z zespołem ${ids[0]}\n- Przygotował raport ${ids[1]}\nPytania otwarte:\n- Co pomogło?\nKryteria bez informacji:\n- brak`;
  }
  if (/przed rozmową z przełożonym/.test(sys)) return 'O co może zapytać przełożony:\n- Jak układała się współpraca?\nCo warto przygotować:\n- Przykłady sytuacji\nO co Ty możesz zapytać:\n- Jakie wsparcie jest możliwe?';
  return 'Odpowiedź atrapy.';
};

before(async () => {
  mock = http.createServer((req, res) => {
    let b = ''; req.on('data', c => { b += c; }); req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'qwen2.5:14b' }] }));
      const j = JSON.parse(b); prompts.push(j);
      res.end(JSON.stringify({ message: { content: answer(j.messages[0].content, j.messages[j.messages.length - 1].content) } }));
    });
  }).listen(0, '127.0.0.1');
  await new Promise(ok => mock.once('listening', ok));
  srv = await startServer({ KK_AI_URL: `http://127.0.0.1:${mock.address().port}` });
  mgr = await asManager(srv);
  model = (await mgr.get('/api/model')).body;
  // Pracownik bez rozmowy rozpoczynającej i bez wcześniejszych ocen okresowych, żeby ścieżka była czysta
  const team = (await mgr.get('/api/dashboard')).body.team;
  const kicks = (await mgr.get('/api/kickoffs')).body.kickoffs;
  const evals = (await mgr.get('/api/evals')).body.evals;
  const free = team.find(t => !kicks.some(k => k.employeeId === t.id) && !evals.some(e => e.employee_id === t.id || e.employeeId === t.id));
  empId = (free || team[team.length - 1]).id;
  // Id użytkowników demo: przełożony = 1, pracownik N = N + 1 (pracownikN@demo.kk)
  emp = await asEmployee(srv, empId - 1);
  assert.equal((await emp.get('/api/me')).body.user.id, empId);
});
after(async () => { await srv.stop(); mock.close(); });

test('(a) dobór kryteriów: propozycje tylko z modelu, ≤3, bez obowiązkowych; rozmowa rozpoczynająca i zapoznanie', async () => {
  const r = await mgr.post('/api/ai/criteria', { employeeId: empId, typ: 'C', duties: 'Obsługa wniosków, kontakt z interesantami i przygotowanie raportów.' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.source, 'ai');
  assert.ok(r.body.propozycje.length >= 1 && r.body.propozycje.length <= model.maxExtra);
  const keys = new Set(model.model.map(c => c.k));
  for (const p of r.body.propozycje) {
    assert.ok(keys.has(p.k), `kryterium spoza modelu: ${p.k}`);
    assert.ok(!model.mandC.some(m => p.k.startsWith(m)), `obowiązkowe wśród propozycji: ${p.k}`);
    assert.ok(p.uzasadnienie.length > 5);
  }
  assert.equal(r.body.odrzucone, 1, 'wymyślone kryterium odrzucone');
  const extra = r.body.propozycje.map(p => p.k);
  const k = await mgr.post('/api/kickoffs', { employeeId: empId, typ: 'C', date: todayStr(), extraCriteria: extra,
    duties: 'Obsługa wniosków, kontakt z interesantami i raporty.', expectations: 'Terminowość i rzetelność w obsłudze spraw.', goals: 'Skrócenie czasu obsługi wniosków.' });
  assert.equal(k.status, 201, k.text);
  kickoff = k.body.kickoff;
  assert.deepEqual(kickoff.extraCriteria, extra);
  const ack = await emp.post(`/api/kickoffs/${kickoff.id}/acknowledge`);
  assert.equal(ack.status, 201, ack.text);
});

test('(b) rzetelna ocena: informacje, wskaźniki, sprawdzenie języka, złożenie, wynik wyliczony, PDF', async () => {
  // dwie informacje przy wskaźnikach kryteriów obowiązkowych
  const ind = [`${model.mandC[3]}|0`, `${model.mandC[4]}|0`].map(p => { const c = model.model.find(x => x.k.startsWith(p.split('|')[0])); return `${c.k}|0`; });
  for (const [i, indicator] of ind.entries()) {
    const r = await mgr.post('/api/evidence', { employeeId: empId, date: todayStr(), indicator,
      situation: `Sytuacja ${i + 1}: uzgodnienie harmonogramu prac`, action: 'Zwołał spotkanie i spisał ustalenia', result: 'Zespół dotrzymał terminu' });
    assert.equal(r.status, 201, r.text);
    ctx.evIds.push(r.body.evidence.id);
  }
  const c = await mgr.post('/api/evals', { employeeId: empId, typ: 'C', periodTo: todayStr(),
    exception: { reason: 'Wyjątek na potrzeby ścieżki demo: nowy okres po rozmowie rozpoczynającej.' } });
  assert.equal(c.status, 201, c.text);
  evalId = c.body.id;
  assert.equal(c.body.kickoffId, kickoff.id);
  const d0 = (await mgr.get(`/api/evals/${evalId}`)).body.eval;
  assert.equal(d0.period_from ?? d0.periodFrom, todayStr(), 'początek okresu z rozmowy');
  const data = d0.data;
  assert.deepEqual(data.kickoff.extraCriteria, kickoff.extraCriteria);
  assert.ok(kickoff.extraCriteria.every(k => data.criteria.includes(k)));

  // oceny wskaźników: z informacją – poziom z uzasadnieniem, bez informacji – „brak podstaw do oceny”
  const ratings = {}, partials = {};
  for (const k of data.criteria) {
    const comp = model.model.find(x => x.k === k);
    comp.w.forEach((w, wi) => {
      const key = `${k}|${wi}`;
      ratings[key] = ind.includes(key) ? { lvl: 3, ex: 'Uzgodnił harmonogram i dotrzymał terminu (informacja z okresu).' } : { lvl: 'none', ex: '' };
    });
    partials[k] = { pts: 5 };
  }
  const put = await mgr.put(`/api/evals/${evalId}`, { data: { ...data, ratings, partials, uzasadnienie: 'Ocena oparta na zebranych informacjach z okresu.' } });
  assert.equal(put.status, 200, put.text);
  assert.deepEqual(put.body.missing, [], 'komplet przed złożeniem');

  const f = await mgr.post('/api/ai/formal', { evalId });
  assert.equal(f.status, 200, f.text);
  assert.equal(f.body.source, 'ai');
  assert.match(f.body.text, /zachowania/);

  const s = await mgr.post(`/api/evals/${evalId}/submit`);
  assert.equal(s.status, 200, s.text);
  const done = (await mgr.get(`/api/evals/${evalId}`)).body.eval;
  assert.equal(done.status, 'submitted');
  assert.equal(done.data.wynik, 'pozytywna');
  assert.equal(done.data.wynikSource, 'wyliczony');

  const pdf = await mgr.req('GET', `/api/evals/${evalId}/document?format=pdf`);
  assert.equal(pdf.status, 200);
  assert.match(pdf.headers.get('content-type'), /application\/pdf/);
  assert.ok(pdf.text.startsWith('%PDF'));
});

test('(c) brief z odnośnikami, rozmowa, plan rozwoju widoczny dla pracownika, przygotowanie pracownika, dziennik', async () => {
  const b = await mgr.post('/api/ai/brief', { employeeId: empId, from: todayStr(), to: todayStr() });
  assert.equal(b.status, 200, b.text);
  assert.equal(b.body.source, 'ai');
  const factIds = b.body.json.fakty.map(f => f.id);
  for (const i of ctx.evIds) assert.ok(factIds.includes(`I${i}`), `fakt I${i} w JSON`);
  for (const i of ctx.evIds) assert.ok(b.body.brief.includes(`[I${i}]`), `odnośnik I${i} w briefie`);
  assert.ok(!b.body.brief.includes('(bez źródła)'));

  const d = await mgr.post(`/api/evals/${evalId}/discuss`, { dev: 'Omówiono współpracę i dalszy rozwój.' });
  assert.equal(d.status, 200, d.text);

  const plan = 'Szkolenie z komunikacji w zespole oraz mentoring w kolejnym kwartale.';
  const p = await mgr.put('/api/devplan', { employeeId: empId, plan, message: 'Dziękuję za rzetelną pracę.' });
  assert.equal(p.status, 200, p.text);
  const seen = await emp.get('/api/devplan');
  assert.equal(seen.status, 200);
  assert.equal(seen.body.current.plan, plan);

  const prep = await emp.post('/api/ai/prep');
  assert.equal(prep.status, 200, prep.text);
  assert.equal(prep.body.source, 'ai');

  // prompty nie zawierają imion i nazwisk zespołu
  const all = JSON.stringify(prompts);
  for (const t of (await mgr.get('/api/dashboard')).body.team) for (const part of t.name.split(' ')) if (part.length > 3) assert.ok(!all.includes(part), `prompt zawiera: ${part}`);

  const a = (await mgr.get('/api/audit')).body;
  for (const act of ['create_kickoff', 'create_evidence', 'update_eval', 'submit_eval', 'update_devplan']) assert.ok(a.audit.some(x => x.action === act), `brak wpisu ${act}`);
  assert.equal(a.chainOk, true);
});
