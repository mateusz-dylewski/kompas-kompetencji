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
