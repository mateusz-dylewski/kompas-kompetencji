// Dane demo gotowe do pokazania: rozmowy rozpoczynające, plan rozwoju, ocena typu C, cele w różnych stanach.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, asManager, asEmployee } from './helpers.mjs';

let srv, mgr;
before(async () => { srv = await startServer(); mgr = await asManager(srv); });
after(() => srv.stop());

test('rozmowy rozpoczynające: zapoznane, czekające i jedno przypomnienie po terminie', async () => {
  const ks = (await mgr.get('/api/kickoffs')).body.kickoffs;
  assert.ok(ks.filter(k => k.ackAt).length >= 2, 'min. 2 zapoznane');
  assert.ok(ks.some(k => !k.ackAt), 'min. 1 czeka na zapoznanie');
  assert.ok(ks.every(k => k.duties.length >= 10 && k.extraCriteria.length <= 3));
  const { alerts } = (await mgr.get('/api/dashboard')).body;
  const kick = alerts.filter(a => a.kind.startsWith('kickoff'));
  assert.ok(kick.some(a => /minął/.test(a.text)), 'zostaje przypomnienie po terminie');
  assert.ok(kick.some(a => !/minął/.test(a.text)), 'nie wszystkie przypomnienia mówią „minął”');
});

test('plan rozwoju pracownika1, ocena C ze schematem 2 i cele w różnych stanach', async () => {
  const emp = await asEmployee(srv, 1);
  const dp = (await emp.get('/api/devplan')).body.current;
  assert.ok(dp && /\d{4}-\d{2}-\d{2}/.test(dp.plan) && dp.message.length > 10);
  const c = (await mgr.get('/api/evals')).body.evals.find(e => e.typ === 'C');
  assert.ok(c && c.data.partials && Object.keys(c.data.partials).length >= 5);
  const goals = (await emp.get('/api/goals')).body.goals;
  assert.ok(goals.length >= 2);
  const steps = goals.flatMap(g => g.steps);
  assert.ok(steps.some(s => s.confirmed_at) && steps.some(s => s.reported_at && !s.confirmed_at) && steps.some(s => !s.reported_at));
});

test('seed: brak identycznych informacji u jednej osoby; przykłady w ocenach bez tekstu „demonstracyjne”', async () => {
  const team = (await mgr.get('/api/dashboard')).body.team;
  for (const m of team) {
    const ev = (await mgr.get(`/api/evidence?employeeId=${m.id}`)).body.evidence;
    const keys = ev.map(e => [e.situation, e.action, e.result].join('|'));
    assert.equal(new Set(keys).size, keys.length, `duplikat informacji u osoby ${m.id}`);
  }
  const evals = (await mgr.get('/api/evals')).body.evals;
  let withEx = 0;
  for (const e of evals) for (const r of Object.values(e.data.ratings || {})) {
    assert.ok(!/demonstracyjne/i.test(r.ex || ''), 'ex z tekstem demo');
    if (r.ex) withEx++;
  }
  assert.ok(withEx > 0, 'część przykładów wynika z informacji');
});

test('każdy szkic oceny w demo da się wypełnić i złożyć (informacje z okresu przy każdym wskaźniku)', async () => {
  const drafts = (await mgr.get('/api/evals')).body.evals.filter(e => e.status === 'draft' && e.typ !== 'pierwsza');
  assert.ok(drafts.length >= 2, 'szkic B i szkic C');
  for (const d of drafts) {
    const ev = (await mgr.get(`/api/evidence?employeeId=${d.employee_id}&from=${d.period_from}&to=${d.period_to}`)).body.evidence;
    const have = new Set(ev.map(e => e.indicator));
    const data = d.data;
    for (const [k, r] of Object.entries(data.ratings)) {
      assert.ok(have.has(k), `szkic ${d.id}: wskaźnik ${k} bez informacji z okresu`);
      data.ratings[k] = { lvl: 3, ex: r.ex || 'Krótki przykład zachowania z okresu oceny.' };
    }
    for (const k of data.criteria) data.partials[k] = { pts: 5 };
    const put = await mgr.put(`/api/evals/${d.id}`, { data });
    assert.equal(put.status, 200, put.text);
    assert.deepEqual(put.body.missing, [], `szkic ${d.id}`);
    const sub = await mgr.post(`/api/evals/${d.id}/submit`);
    assert.equal(sub.status, 200, sub.text);
  }
});
