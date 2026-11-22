// Moduł przełożonego, etap 6: brief do rozmowy + JSON „kto co robił”.
// JSON buduje serwer z wpisów ludzi; prompt bez nazwisk; odnośniki tylko do istniejących faktów; bez poziomów i wyniku; nic nie zapisuje.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, asManager, asEmployee } from './helpers.mjs';

const prompts = [];
let reply = 'Tematy do omówienia:\n- współpraca\nPrzykłady z okresu:\n- Uzgodnił harmonogram z zespołem [I999]\n- Przygotował raport [REAL]\nPytania otwarte:\n- Co pomogło?\nKryteria bez informacji:\n- brak';
let mock, srv, mgr;
before(async () => {
  mock = http.createServer((req, res) => {
    let b = ''; req.on('data', c => { b += c; }); req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'qwen2.5:14b' }] }));
      prompts.push(JSON.parse(b));
      res.end(JSON.stringify({ message: { content: reply } }));
    });
  }).listen(0, '127.0.0.1');
  await new Promise(ok => mock.once('listening', ok));
  srv = await startServer({ KK_AI_URL: `http://127.0.0.1:${mock.address().port}` });
  mgr = await asManager(srv);
});
after(async () => { await srv.stop(); mock.close(); });
const keysDeep = (o, out = []) => { if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { out.push(k); keysDeep(v, out); } return out; };

test('JSON tylko z faktów tej osoby i okresu; „kto” to rola; bez poziomów i wyniku', async () => {
  const team = (await mgr.get('/api/dashboard')).body.team;
  const emp = team[0];
  const r = await mgr.post('/api/ai/brief', { employeeId: emp.id, from: '2026-01-01', to: '2026-12-31' });
  assert.equal(r.status, 200, r.text);
  const j = r.body.json;
  assert.deepEqual(j.okres, { od: '2026-01-01', do: '2026-12-31' });
  assert.ok(j.fakty.length > 0);
  const evIds = new Set((await mgr.get(`/api/evidence?employeeId=${emp.id}`)).body.evidence.map(e => `I${e.id}`));
  for (const f of j.fakty) {
    assert.ok(f.data >= '2026-01-01' && f.data <= '2026-12-31', f.id);
    if (f.rodzaj === 'informacja') assert.ok(evIds.has(f.id), `obcy fakt ${f.id}`);
  }
  const all = JSON.stringify(j);
  for (const t of team) for (const part of t.name.split(' ')) if (part.length > 3) assert.ok(!all.includes(part), `JSON zawiera nazwisko: ${part}`);
  assert.deepEqual(keysDeep(j).filter(k => /level|poziom|pts|punkt|wynik|score|avg|średn/i.test(k)), []);
  assert.ok(Array.isArray(j.pokrycie) && Array.isArray(j.braki));
});

test('prompt bez imion i e-maili; odnośnik do nieistniejącego faktu usunięty, zdanie oznaczone „bez źródła”', async () => {
  const emp = (await mgr.get('/api/dashboard')).body.team[1];
  const ev = (await mgr.get(`/api/evidence?employeeId=${emp.id}`)).body.evidence[0];
  // Nazwisko wpisane w treść informacji musi zniknąć z promptu
  await mgr.put(`/api/evidence/${ev.id}`, { situation: `Raport przygotowany razem z ${emp.name}, kontakt pracownik6@demo.kk` });
  reply = reply.replace('[REAL]', `[I${ev.id}]`);
  prompts.length = 0;
  const r = (await mgr.post('/api/ai/brief', { employeeId: emp.id, from: '2020-01-01' })).body;
  assert.equal(r.source, 'ai');
  assert.equal(prompts.length, 1);
  const p = JSON.stringify(prompts[0]);
  for (const t of [...emp.name.split(' '), 'pracownik6@demo.kk']) assert.ok(!p.includes(t), `prompt zawiera: ${t}`);
  assert.ok(!r.brief.includes('[I999]'), 'fałszywy odnośnik usunięty');
  assert.match(r.brief, /harmonogram z zespołem\s*\(bez źródła\)/);
  assert.ok(r.brief.includes(`[I${ev.id}]`), 'prawdziwy odnośnik zostaje');
});

test('nic się nie zapisuje poza ai_log; pracownik i osoba spoza zespołu → 403/404', async () => {
  const emp = (await mgr.get('/api/dashboard')).body.team[2];
  const snap = async () => JSON.stringify([(await mgr.get('/api/evidence')).body, (await mgr.get('/api/feedback')).body, (await mgr.get('/api/checkins')).body, (await mgr.get('/api/goals')).body, (await mgr.get('/api/evals')).body]);
  const before1 = await snap();
  await mgr.post('/api/ai/brief', { employeeId: emp.id });
  assert.equal(await snap(), before1);
  assert.ok((await mgr.get('/api/audit')).body.ai.some(x => x.action === 'brief'));
  assert.equal((await (await asEmployee(srv, 1)).post('/api/ai/brief', { employeeId: emp.id })).status, 403);
  assert.equal((await mgr.post('/api/ai/brief', { employeeId: 99999 })).status, 404);
  assert.equal((await mgr.post('/api/ai/brief', { employeeId: emp.id, from: '2026-12-01', to: '2026-01-01' })).status, 400);
});
