// Faza 5: szkic dokumentu z dowodów i check-inów, blokada zbyt wczesnej oceny z wyjątkiem w dzienniku, wgląd w kryteria (§ 6)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, asManager } from './helpers.mjs';

let srv, mgr;
before(async () => { srv = await startServer(); mgr = await asManager(srv); });
after(() => srv.stop());
// Pracownik z oceną B złożoną za I półrocze 2026 (dane demo: pracownik3)
const empWithPeriodic = async () => {
  const evals = (await mgr.get('/api/evals')).body.evals;
  return evals.find(e => e.typ === 'B' && e.status === 'submitted').employee_id;
};

test('zbyt wczesna ocena okresowa → 409 z najwcześniejszym terminem', async () => {
  const emp = await empWithPeriodic();
  const r = await mgr.post('/api/evals', { employeeId: emp, typ: 'B', periodFrom: '2026-07-01', periodTo: '2026-11-30' });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'too_early');
  assert.equal(r.body.earliest, '2026-12-30');
  assert.match(r.body.error, /6 miesięcy/);
  const short = await mgr.post('/api/evals', { employeeId: emp, typ: 'B', periodTo: '2026-11-30', exception: { reason: 'krótko' } });
  assert.equal(short.status, 409);
});
test('wyjątek z uzasadnieniem → 201 i wpis w dzienniku', async () => {
  const emp = await empWithPeriodic();
  const r = await mgr.post('/api/evals', { employeeId: emp, typ: 'B', periodFrom: '2026-07-01', periodTo: '2026-11-30', exception: { reason: 'Zmiana stanowiska – ocena na wniosek dyrektora generalnego.' } });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.body.earlyException, true);
  const a = (await mgr.get('/api/audit')).body.audit.find(x => x.action === 'eval_early_exception' && x.target === String(r.body.id));
  assert.match(a.new_value, /Zmiana stanowiska/);
  const ev = (await mgr.get(`/api/evals/${r.body.id}`)).body;
  assert.equal(ev.timing.ok, false);
  assert.ok(ev.timing.exception.reason);
});
test('ocena po 6 miesiącach przechodzi; zła data → 400; pierwsza ocena poza regułą', async () => {
  const emp = await empWithPeriodic();
  assert.equal((await mgr.post('/api/evals', { employeeId: emp, typ: 'C', periodFrom: '2026-07-01', periodTo: '2027-01-15' })).status, 201);
  assert.equal((await mgr.post('/api/evals', { employeeId: emp, typ: 'C', periodTo: '2027-13-01' })).status, 400);
  assert.equal((await mgr.post('/api/evals', { employeeId: emp, typ: 'pierwsza', periodTo: '2026-08-01' })).status, 201);
});
test('wyjątek dla istniejącego szkicu', async () => {
  const emp = await empWithPeriodic();
  const id = (await mgr.post('/api/evals', { employeeId: emp, typ: 'C', periodFrom: '2026-07-01', periodTo: '2027-02-01' })).body.id;
  const draft = (await mgr.get(`/api/evals/${id}`)).body.eval;
  assert.equal((await mgr.put(`/api/evals/${id}`, { data: draft.data, periodTo: '2026-09-30' })).status, 200);
  assert.equal((await mgr.get(`/api/evals/${id}`)).body.timing.ok, false);
  assert.equal((await mgr.post(`/api/evals/${id}/early-exception`, { reason: '' })).status, 400);
  assert.equal((await mgr.post(`/api/evals/${id}/early-exception`, { reason: 'Powrót z urlopu – ocena przed zmianą przełożonego.' })).status, 200);
  assert.ok((await mgr.get(`/api/evals/${id}`)).body.timing.exception);
});
test('model zawiera cykl 24 mies. i regułę 6 mies.; dashboard pokazuje termin kolejnej oceny', async () => {
  assert.deepEqual((await mgr.get('/api/model')).body.cycle, { cycleMonths: 24, minGapMonths: 6, reevalMonths: 6, kickoffDays: 30 });
  const emp = await empWithPeriodic();
  const row = (await mgr.get('/api/dashboard')).body.team.find(t => t.id === emp);
  assert.equal(row.nextDue, '2028-06-30');
  assert.equal(row.earliestNext, '2026-12-30');
});
test('szkic z dowodów i check-inów: PDF/XML bez poziomów, ocen cząstkowych i wyniku', async () => {
  const draft = (await mgr.get('/api/evals')).body.evals.find(e => e.status === 'draft' && e.typ === 'B' && Object.keys(e.data.ratings || {}).length);
  const xml = await mgr.get(`/api/evals/${draft.id}/document?variant=szkic&format=xml`);
  assert.equal(xml.status, 200);
  assert.match(xml.text, /<SzkicOceny/);
  assert.match(xml.text, /<Dowod id="\d+"/);
  assert.match(xml.text, /<OcenaCzastkowa uzupelnia="oceniajacy"\/>/);
  for (const t of ['<Punkty>', 'OcenaOkresowa', 'Srednia', 'OgolnyPoziom', 'pozytywna', 'negatywna']) assert.ok(!xml.text.includes(t), `szkic zawiera ${t}`);
  const pdf = await mgr.get(`/api/evals/${draft.id}/document?variant=szkic&format=pdf`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  const emp = await srv.client().login('pracownik6@demo.kk');
  assert.equal((await emp.get(`/api/evals/${draft.id}/document?variant=szkic&format=xml`)).status, 403);
});
test('§ 6: pracownik widzi kryteria i termin szkicu oceny, bez poziomów', async () => {
  const emp = await srv.client().login('pracownik6@demo.kk');
  const d = (await emp.get('/api/dashboard')).body;
  assert.ok(d.upcoming.length >= 1);
  const u = d.upcoming[0];
  assert.ok(u.criteria.length >= 5);
  assert.ok('terminOceny' in u);
  assert.ok(!('ratings' in u) && !('partials' in u) && !('data' in u));
});
