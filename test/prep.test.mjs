// Moduł przełożonego, etap 7: asystent pracownika – o co może zapytać przełożony. Bez poziomów, bez nazwisk w prompcie.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, asManager, asEmployee } from './helpers.mjs';

const prompts = [];
let mock, srv;
before(async () => {
  mock = http.createServer((req, res) => {
    let b = ''; req.on('data', c => { b += c; }); req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'qwen2.5:14b' }] }));
      prompts.push(JSON.parse(b));
      res.end(JSON.stringify({ message: { content: 'O co może zapytać przełożony:\n- Jak sprawdzasz wynik?' } }));
    });
  }).listen(0, '127.0.0.1');
  await new Promise(ok => mock.once('listening', ok));
  srv = await startServer({ KK_AI_URL: `http://127.0.0.1:${mock.address().port}` });
});
after(async () => { await srv.stop(); mock.close(); });

test('pracownik dostaje podpowiedzi; prompt z kryteriami i pytaniami z bazy, bez imion i e-maili', async () => {
  const mgr = await asManager(srv);
  const draft = (await mgr.get('/api/evals')).body.evals.find(e => e.status === 'draft');
  const team = (await mgr.get('/api/dashboard')).body.team;
  const n = team.findIndex(t => t.id === draft.employee_id);
  // Pracownik, dla którego przygotowywana jest ocena (szkic)
  let emp;
  for (let i = 1; i <= 6 && !emp; i++) { const c = await asEmployee(srv, i); if ((await c.get('/api/me')).body.user.id === draft.employee_id) emp = c; }
  prompts.length = 0;
  const r = await emp.post('/api/ai/prep');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.source, 'ai');
  const p = JSON.stringify(prompts[0]);
  assert.ok(n >= 0);
  for (const part of team[n].name.split(' ')) if (part.length > 3) assert.ok(!p.includes(part), `prompt zawiera: ${part}`);
  assert.ok(!/@demo\.kk/.test(p), 'prompt bez e-maili');
  assert.match(p, /pytania/);
});

test('bez modelu: odpowiedź regułowa bez poziomów i punktów; przełożony → 403', async () => {
  const s2 = await startServer();
  try {
    const emp = await asEmployee(s2, 1);
    const r = (await emp.post('/api/ai/prep')).body;
    assert.equal(r.source, 'rules');
    assert.match(r.text, /O co może zapytać przełożony:/);
    assert.ok(!/\b[13579] pkt\b|poziom|wynik/i.test(r.text.split('\n\n').slice(0, -1).join('\n')), 'bez poziomów i wyniku');
    assert.equal((await (await asManager(s2)).post('/api/ai/prep')).status, 403);
  } finally { await s2.stop(); }
});
