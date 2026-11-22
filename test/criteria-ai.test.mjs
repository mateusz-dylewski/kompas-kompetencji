// Dobór kryteriów dodatkowych (AI proponuje, serwer waliduje) i GET /api/session. Atrapa modelu, bez prawdziwych wywołań AI.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, asManager, asEmployee } from './helpers.mjs';

const prompts = [];
let reply = '', down = false;
let mock, srv, mgr, emp;
before(async () => {
  mock = http.createServer((req, res) => {
    let b = ''; req.on('data', c => { b += c; }); req.on('end', () => {
      if (down) { res.statusCode = 503; return res.end('{}'); }
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'qwen2.5:14b' }] }));
      prompts.push(JSON.parse(b));
      res.end(JSON.stringify({ message: { content: reply } }));
    });
  }).listen(0, '127.0.0.1');
  await new Promise(ok => mock.once('listening', ok));
  srv = await startServer({ KK_AI_URL: `http://127.0.0.1:${mock.address().port}` });
  mgr = await asManager(srv);
  emp = (await mgr.get('/api/dashboard')).body.team[0];
});
after(async () => { await srv.stop(); mock.close(); });
const MAND_C = ['WYKORZYSTYWANIE WIEDZY', 'RZETELNOŚĆ', 'ORGANIZACJA PRACY', 'WSPÓŁPRACA', 'KOMUNIKACJA'];

test('poprawna odpowiedź modelu → klucze z modelu, bez obowiązkowych, najwyżej 3', async () => {
  const model = (await mgr.get('/api/model')).body.model.map(c => c.k);
  reply = JSON.stringify({ propozycje: ['ORIENTACJA NA KLIENTA', 'NEGOCJOWANIE', 'MYŚLENIE ANALITYCZNE', 'KREATYWNOŚĆ'].map(k => ({ kryterium: k, uzasadnienie: 'Stanowisko obejmuje kontakt z klientami.' })) });
  const r = await mgr.post('/api/ai/criteria', { employeeId: emp.id, typ: 'C', duties: 'Obsługa klientów zewnętrznych' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.source, 'ai');
  assert.ok(r.body.propozycje.length >= 1 && r.body.propozycje.length <= 3);
  for (const p of r.body.propozycje) { assert.ok(model.includes(p.k)); assert.ok(!MAND_C.includes(p.k)); assert.ok(p.n && p.uzasadnienie); }
  assert.equal(r.body.odrzucone, 1);
});

test('wymyślone i obowiązkowe kryteria oraz duplikaty są odrzucane', async () => {
  reply = 'Oto JSON: ' + JSON.stringify({ propozycje: [
    { kryterium: 'Kreatywność kosmiczna', uzasadnienie: 'x' }, { kryterium: 'KOMUNIKACJA', uzasadnienie: 'obowiązkowe' },
    { kryterium: 'NEGOCJOWANIE', uzasadnienie: 'Prowadzi uzgodnienia z kontrahentami.' }, { kryterium: 'NEGOCJOWANIE', uzasadnienie: 'duplikat' }] });
  const r = await mgr.post('/api/ai/criteria', { employeeId: emp.id, typ: 'C' });
  assert.equal(r.body.source, 'ai');
  assert.deepEqual(r.body.propozycje.map(p => p.k), ['NEGOCJOWANIE']);
  assert.equal(r.body.odrzucone, 3);
  reply = JSON.stringify({ propozycje: [{ kryterium: 'Kreatywność kosmiczna', uzasadnienie: 'x' }] });
  const r2 = await mgr.post('/api/ai/criteria', { employeeId: emp.id, typ: 'C', duties: 'Obsługa klientów i interesantów' });
  assert.equal(r2.body.source, 'rules', 'nic nie zostało po walidacji → fallback');
  assert.ok(r2.body.propozycje.length >= 1);
});

test('model niedostępny lub nie-JSON → fallback regułowy z uzasadnieniem', async () => {
  down = true;
  const r = await mgr.post('/api/ai/criteria', { employeeId: emp.id, typ: 'C', duties: 'Obsługa klientów zewnętrznych, analiza danych' });
  down = false;
  assert.equal(r.status, 200);
  assert.equal(r.body.source, 'rules');
  assert.ok(r.body.propozycje.length >= 1 && r.body.propozycje.length <= 3);
  for (const p of r.body.propozycje) { assert.ok(p.uzasadnienie.length > 10); assert.ok(!MAND_C.includes(p.k)); }
  assert.ok(r.body.propozycje.some(p => p.k === 'ORIENTACJA NA KLIENTA'));
  reply = 'nie wiem, nie umiem JSON';
  assert.equal((await mgr.post('/api/ai/criteria', { employeeId: emp.id, typ: 'B' })).body.source, 'rules');
});

test('prompt bez imienia, nazwiska i e-maila; nic nie jest zapisywane poza ai_log', async () => {
  const snap = async () => JSON.stringify([(await mgr.get('/api/evals')).body, (await mgr.get('/api/kickoffs')).body]);
  const s1 = await snap();
  reply = JSON.stringify({ propozycje: [{ kryterium: 'NEGOCJOWANIE', uzasadnienie: 'ok' }] });
  prompts.length = 0;
  await mgr.post('/api/ai/criteria', { employeeId: emp.id, typ: 'C', duties: `Współpraca z ${emp.name}, kontakt pracownik1@demo.kk` });
  assert.equal(prompts.length, 1);
  const p = JSON.stringify(prompts[0]);
  for (const t of [...emp.name.split(' ').filter(x => x.length > 2), 'pracownik1@demo.kk']) assert.ok(!p.includes(t), `prompt zawiera: ${t}`);
  assert.equal(await snap(), s1);
  assert.ok((await mgr.get('/api/audit')).body.ai.some(x => x.action === 'criteria'));
});

test('pracownik → 403, osoba spoza zespołu → 404, zły typ → 422', async () => {
  assert.equal((await (await asEmployee(srv, 1)).post('/api/ai/criteria', { employeeId: emp.id, typ: 'C' })).status, 403);
  assert.equal((await mgr.post('/api/ai/criteria', { employeeId: 999999, typ: 'C' })).status, 404);
  assert.ok([400, 422].includes((await mgr.post('/api/ai/criteria', { employeeId: emp.id, typ: 'X' })).status));
});

test('GET /api/session: bez cookie 200 {user:null}, po zalogowaniu użytkownik', async () => {
  const anon = await srv.client().get('/api/session');
  assert.equal(anon.status, 200);
  assert.deepEqual(anon.body, { user: null });
  const r = await mgr.get('/api/session');
  assert.equal(r.status, 200);
  assert.equal(r.body.user.role, 'przelozony');
  assert.ok('ai' in r.body);
});
