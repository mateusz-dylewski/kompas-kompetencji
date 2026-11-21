// Etap P0 planu zabezpieczeń (docs/bezpieczenstwo/plan-zabezpieczen.md):
// aktywacja kont i zmiana hasła, stały czas logowania, limity bez blokowania cudzych kont, CSRF,
// uprawnienia plików i klucze spoza bazy, tryb produkcyjny, dziennik z pieczęcią HMAC.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startServer, asManager, DEMO_PASS, PROD_ENV } from './helpers.mjs';
import { securityConfig, clientIp, passwordProblem } from '../lib/security.mjs';

const NEW_PASS = 'Nowe-haslo-pracownika-7';
const median = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

describe('konfiguracja bezpieczeństwa (lib/security.mjs)', () => {
  test('produkcja wymaga https:// i kluczy spoza bazy; klucze krótkie lub równe – błąd', () => {
    assert.throws(() => securityConfig({ KK_MODE: 'production' }), /KK_PUBLIC_ORIGIN/);
    assert.throws(() => securityConfig({ ...PROD_ENV, KK_PUBLIC_ORIGIN: 'http://kompas.test' }), /https/);
    assert.throws(() => securityConfig({ ...PROD_ENV, KK_AUDIT_KEY: '' }), /KK_AUDIT_KEY/);
    assert.throws(() => securityConfig({ ...PROD_ENV, KK_SIGN_KEY: 'krotki' }), /32 znaki/);
    assert.throws(() => securityConfig({ ...PROD_ENV, KK_SIGN_KEY: 'x'.repeat(40), KK_AUDIT_KEY: 'x'.repeat(40) }), /różne/);
    const p = securityConfig(PROD_ENV);
    assert.equal(p.cookieName, '__Host-kk_sid');
    assert.match(p.cookieFlags, /Secure/);
    assert.equal(p.auditMigrate, false);
    const l = securityConfig({});
    assert.equal(l.cookieName, 'kk_sid');
    assert.equal(l.signKey, null);
  });
  test('adres klienta: X-Forwarded-For tylko od zaufanego proxy, pierwszy niezaufany od prawej', () => {
    const t = new Set(['10.0.0.1']);
    assert.equal(clientIp('::ffff:192.0.2.5', '203.0.113.9', t), '192.0.2.5', 'od klienta – nagłówek ignorowany');
    assert.equal(clientIp('10.0.0.1', '203.0.113.9', t), '203.0.113.9');
    assert.equal(clientIp('10.0.0.1', '1.2.3.4, 203.0.113.9', t), '203.0.113.9', 'lewy wpis może podrobić klient');
    assert.equal(clientIp('10.0.0.1', '', t), '10.0.0.1');
  });
  test('polityka haseł', () => {
    assert.match(passwordProblem('krotkie', 'a@b.pl'), /12 znaków/);
    assert.match(passwordProblem('qwerty123456', 'a@b.pl'), /popularne/);
    assert.match(passwordProblem('jan.kowalski-2026', 'jan.kowalski@urzad.pl'), /nazwy konta/);
    assert.match(passwordProblem('abababababab', 'a@b.pl'), /5 różnych/);
    assert.equal(passwordProblem(NEW_PASS, 'pracownik1@demo.kk'), null);
  });
});

describe('aktywacja konta: hasło ustala pracownik (P0.1)', () => {
  let srv, mgr;
  before(async () => { srv = await startServer(); mgr = await asManager(srv); });
  after(() => srv.stop());

  test('przełożony nie podaje hasła; link jednorazowy, 24 h, w bazie tylko skrót; logowanie dopiero po aktywacji', async () => {
    const email = 'nowa.osoba@demo.kk';
    assert.equal((await mgr.post('/api/employees', { name: 'Nowa Osoba', email, password: 'Haslo-od-szefa-1' })).status, 400);
    const r = await mgr.post('/api/employees', { name: 'Nowa Osoba', email, position: 'Specjalista' });
    assert.equal(r.status, 201, r.text);
    const token = /#aktywacja=([a-f0-9]{64})$/.exec(r.body.activation.link)[1];
    assert.ok(Date.parse(r.body.activation.expires) - Date.now() > 23 * 3600e3);
    // Skrzynka nadawcza (symulacja e-maila do pracownika) i brak tokenu w bazie jawnym tekstem
    assert.match(fs.readFileSync(path.join(srv.dir, 'outbox', 'aktywacje.jsonl'), 'utf8'), new RegExp(`"to":"${email}".*${token}`));
    const db = new DatabaseSync(path.join(srv.dir, 'kompas.db'));
    assert.equal(db.prepare('SELECT COUNT(*) n FROM activation WHERE token_sha256=?').get(token).n, 0);
    db.close();
    const team = (await mgr.get('/api/dashboard')).body.team;
    assert.equal(team.find(t => t.id === r.body.id).pending, true);
    // Przed aktywacją nie da się zalogować żadnym hasłem
    const c = srv.client();
    assert.equal((await c.post('/api/login', { email, password: '' })).status, 401);
    assert.equal((await c.post('/api/activate', { token, password: 'qwerty123456' })).status, 400, 'słabe hasło');
    assert.equal((await c.post('/api/activate', { token, password: NEW_PASS })).status, 200);
    assert.equal((await c.post('/api/activate', { token, password: NEW_PASS + 'x' })).status, 400, 'link jednorazowy');
    assert.equal((await c.post('/api/login', { email, password: NEW_PASS })).status, 200);
    assert.equal((await mgr.post(`/api/employees/${r.body.id}/activation`)).status, 409, 'konto już aktywne');
    const log = (await mgr.get('/api/audit')).body.audit;
    assert.ok(log.some(a => a.action === 'activation_issued' && a.target === String(r.body.id)));
  });
  test('nowy link unieważnia poprzedni; obcy zespół – 404; zły token liczony do limitu', async () => {
    const r = await mgr.post('/api/employees', { name: 'Druga Osoba', email: 'druga.osoba@demo.kk' });
    const t1 = /=([a-f0-9]{64})$/.exec(r.body.activation.link)[1];
    const r2 = await mgr.post(`/api/employees/${r.body.id}/activation`);
    assert.equal(r2.status, 201);
    const c = srv.client();
    assert.equal((await c.post('/api/activate', { token: t1, password: NEW_PASS })).status, 400, 'stary link nie działa');
    const emp = await srv.client().login('pracownik1@demo.kk');
    assert.equal((await emp.post(`/api/employees/${r.body.id}/activation`)).status, 403);
    for (let i = 0; i < 4; i++) await c.post('/api/activate', { token: 'f'.repeat(64), password: NEW_PASS });
    assert.equal((await c.post('/api/activate', { token: 'f'.repeat(64), password: NEW_PASS })).status, 429);
  });
});

describe('wymuszona zmiana hasła nadanego przez przełożonego (migracja kont sprzed P0)', () => {
  test('do zmiany hasła: tylko /api/me i /api/password; po zmianie inne sesje unieważnione', async () => {
    const srv = await startServer();
    try {
      const db = new DatabaseSync(path.join(srv.dir, 'kompas.db'));
      db.prepare("UPDATE users SET must_change=1 WHERE email='pracownik5@demo.kk'").run();
      db.close();
      const other = await srv.client().login('pracownik5@demo.kk');
      const c = srv.client();
      const login = await c.post('/api/login', { email: 'pracownik5@demo.kk', password: DEMO_PASS });
      assert.equal(login.body.user.mustChange, true);
      assert.equal((await c.get('/api/me')).status, 200);
      const blocked = await c.get('/api/evals');
      assert.equal(blocked.status, 403);
      assert.equal(blocked.body.code, 'password_change_required');
      const ev = (await (await asManager(srv)).get('/api/evals')).body.evals.find(e => e.status !== 'draft');
      assert.equal((await c.post(`/api/evals/${ev.id}/acknowledge`)).status, 403, 'zapoznanie dopiero po zmianie hasła');
      assert.equal((await c.post('/api/password', { current: 'zle-haslo-123', next: NEW_PASS })).status, 400);
      assert.equal((await c.post('/api/password', { current: DEMO_PASS, next: DEMO_PASS })).status, 400);
      assert.equal((await c.post('/api/password', { current: DEMO_PASS, next: NEW_PASS })).status, 200);
      assert.equal((await c.get('/api/evals')).status, 200);
      assert.equal((await other.get('/api/me')).status, 401, 'inne sesje unieważnione');
      assert.equal((await srv.client().post('/api/login', { email: 'pracownik5@demo.kk', password: NEW_PASS })).status, 200);
    } finally { await srv.stop(); }
  });
});

describe('logowanie: stały czas i limity (P0.2, P0.3)', () => {
  test('czas odpowiedzi nie zdradza, czy konto istnieje', async () => {
    const srv = await startServer();
    try {
      const time = async email => { const t = performance.now(); await srv.client().req('POST', '/api/login', { email, password: 'x' }, { 'x-forwarded-for': '1' }); return performance.now() - t; };
      const real = [], fake = [];
      for (let i = 0; i < 4; i++) { real.push(await time(`pracownik${i + 1}@demo.kk`)); fake.push(await time(`brak${i}@demo.kk`)); }
      assert.ok(median(fake) > median(real) * 0.5, `istnieje ${median(real).toFixed(1)} ms, brak ${median(fake).toFixed(1)} ms`);
    } finally { await srv.stop(); }
  });
  test('za zaufanym proxy: blokada pary IP+konto nie blokuje tego konta z innego adresu', async () => {
    const srv = await startServer({ KK_TRUSTED_PROXY: '127.0.0.1' });
    try {
      const from = ip => ({ 'x-forwarded-for': ip });
      const c = srv.client();
      for (let i = 0; i < 5; i++) assert.equal((await c.req('POST', '/api/login', { email: 'pracownik3@demo.kk', password: 'zle' }, from('203.0.113.1'))).status, 401);
      assert.equal((await c.req('POST', '/api/login', { email: 'pracownik3@demo.kk', password: DEMO_PASS }, from('203.0.113.1'))).status, 429);
      assert.equal((await c.req('POST', '/api/login', { email: 'pracownik3@demo.kk', password: DEMO_PASS }, from('203.0.113.2'))).status, 200, 'ofiara z innego adresu');
    } finally { await srv.stop(); }
  });
  test('bez zaufanego proxy X-Forwarded-For jest ignorowany (nie da się obejść limitu)', async () => {
    const srv = await startServer();
    try {
      const c = srv.client();
      for (let i = 0; i < 5; i++) await c.req('POST', '/api/login', { email: 'pracownik3@demo.kk', password: 'zle' }, { 'x-forwarded-for': `198.51.100.${i}` });
      assert.equal((await c.req('POST', '/api/login', { email: 'pracownik3@demo.kk', password: DEMO_PASS }, { 'x-forwarded-for': '198.51.100.99' })).status, 429);
    } finally { await srv.stop(); }
  });
  test('ataki z wielu adresów na jedno konto: rosnące odstępy (krótkie), nie twarda blokada', async () => {
    const srv = await startServer({ KK_TRUSTED_PROXY: '127.0.0.1' });
    try {
      const c = srv.client();
      for (let i = 0; i < 10; i++) await c.req('POST', '/api/login', { email: 'pracownik4@demo.kk', password: 'zle' }, { 'x-forwarded-for': `192.0.2.${i}` });
      const r = await c.req('POST', '/api/login', { email: 'pracownik4@demo.kk', password: DEMO_PASS }, { 'x-forwarded-for': '192.0.2.200' });
      assert.equal(r.status, 429);
      assert.ok(Number(r.headers.get('retry-after')) <= 2, 'odstęp w sekundach, nie 10 minut');
      await new Promise(ok => setTimeout(ok, 1100));
      assert.equal((await c.req('POST', '/api/login', { email: 'pracownik4@demo.kk', password: DEMO_PASS }, { 'x-forwarded-for': '192.0.2.200' })).status, 200);
    } finally { await srv.stop(); }
  });
  test('dziennik nie zapisuje tekstu wpisanego w pole e-mail, gdy konta nie ma', async () => {
    const srv = await startServer();
    try {
      await srv.client().post('/api/login', { email: 'Moje-Tajne-Haslo-1', password: 'x' });
      const db = new DatabaseSync(path.join(srv.dir, 'kompas.db'));
      const all = JSON.stringify(db.prepare("SELECT target FROM audit WHERE action LIKE 'login%'").all());
      db.close();
      assert.ok(!all.toLowerCase().includes('moje-tajne-haslo'));
      assert.ok(all.includes('[nieznany login]'));
    } finally { await srv.stop(); }
  });
});

describe('CSRF (P0.4)', () => {
  let srv, mgr;
  before(async () => { srv = await startServer(); mgr = await asManager(srv); });
  after(() => srv.stop());
  const raw = (method, url, headers, body) => fetch(srv.base + url, { method, headers: { cookie: mgr.cookie, ...headers }, body });
  test('obejścia z audytu zablokowane', async () => {
    assert.equal((await raw('PUT', '/api/settings', { 'content-type': 'text/plain; charset=application/json' }, '{"modules":{}}')).status, 415);
    assert.equal((await raw('POST', '/api/logout', {})).status, 415, 'puste żądanie bez typu');
    assert.equal((await raw('PUT', '/api/settings', { 'content-type': 'application/json', origin: 'https://evil.example' }, '{"modules":{}}')).status, 403);
    assert.equal((await raw('PUT', '/api/settings', { 'content-type': 'application/json', 'sec-fetch-site': 'same-site' }, '{"modules":{}}')).status, 403);
    assert.equal((await mgr.get('/api/me')).status, 200, 'sesja nadal ważna');
  });
  test('żądania z tej samej strony działają', async () => {
    const host = new URL(srv.base).host;
    assert.equal((await raw('PUT', '/api/settings', { 'content-type': 'application/json; charset=utf-8', origin: `http://${host}`, 'sec-fetch-site': 'same-origin' }, '{"modules":{}}')).status, 200);
  });
});

describe('pliki danych, klucze i tryb produkcyjny (P0.5, P0.6)', () => {
  test('katalog danych 0700, pliki 0600; lokalnie klucze w plikach', async () => {
    const srv = await startServer();
    try {
      await asManager(srv);
      assert.equal(fs.statSync(srv.dir).mode & 0o777, 0o700);
      for (const f of fs.readdirSync(srv.dir).filter(f => !fs.statSync(path.join(srv.dir, f)).isDirectory())) {
        assert.equal(fs.statSync(path.join(srv.dir, f)).mode & 0o077, 0, `${f} dostępny dla innych`);
      }
      assert.ok(fs.existsSync(path.join(srv.dir, 'audit.key')));
    } finally { await srv.stop(); }
  });
  test('istniejące pliki z uprawnieniami 644 są poprawiane przy starcie', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kk-test-'));
    fs.chmodSync(dir, 0o755);
    fs.writeFileSync(path.join(dir, 'kompas.db'), ''); fs.chmodSync(path.join(dir, 'kompas.db'), 0o644);
    const srv = await startServer({}, { dir });
    try {
      assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
      assert.equal(fs.statSync(path.join(dir, 'kompas.db')).mode & 0o777, 0o600);
    } finally { await srv.stop(); }
  });
  test('produkcja bez KK_PUBLIC_ORIGIN lub kluczy nie startuje', async () => {
    await assert.rejects(startServer({ ...PROD_ENV, KK_PUBLIC_ORIGIN: '' }), /KK_PUBLIC_ORIGIN/);
    await assert.rejects(startServer({ ...PROD_ENV, KK_PUBLIC_ORIGIN: 'http://kompas.test' }), /https/);
    await assert.rejects(startServer({ ...PROD_ENV, KK_SIGN_KEY: '' }), /KK_SIGN_KEY/);
  });
  test('produkcja: klucze nie leżą w katalogu danych, link aktywacyjny nie trafia do przełożonego, origin z KK_PUBLIC_ORIGIN', async () => {
    const srv = await startServer({ ...PROD_ENV, KK_SEED_DEMO: '1', KK_DEMO_PASSWORD: 'Demo-produkcja-123' });
    try {
      assert.ok(!fs.existsSync(path.join(srv.dir, 'sign.key')) && !fs.existsSync(path.join(srv.dir, 'audit.key')));
      const mgr = await srv.client().login('przelozony@demo.kk', 'Demo-produkcja-123');
      assert.match(mgr.cookie, /^__Host-kk_sid=/);
      const r = await mgr.post('/api/employees', { name: 'Trzecia Osoba', email: 'trzecia.osoba@demo.kk' });
      assert.equal(r.status, 201);
      assert.equal(r.body.activation.link, undefined);
      assert.match(fs.readFileSync(path.join(srv.dir, 'outbox', 'aktywacje.jsonl'), 'utf8'), /https:\/\/kompas\.test\/#aktywacja=/);
      const host = new URL(srv.base).host;
      assert.equal((await mgr.req('PUT', '/api/settings', { modules: {} }, { origin: `http://${host}` })).status, 403, 'tylko KK_PUBLIC_ORIGIN');
      assert.equal((await mgr.req('PUT', '/api/settings', { modules: {} }, { origin: 'https://kompas.test' })).status, 200);
    } finally { await srv.stop(); }
  });
});

describe('dziennik zdarzeń: HMAC i tylko dopisywanie (P0.7)', () => {
  // Skrót łańcucha jak w server.mjs (bez klucza – to potrafi każdy, kto ma plik bazy)
  const chainHash = (prev, r) => crypto.createHash('sha256')
    .update([prev || '', r.user_id ?? '', r.action, r.target, r.at, ...(r.prev_value !== null || r.new_value !== null ? [r.prev_value ?? '', r.new_value ?? ''] : [])].join('|')).digest('hex');

  test('UPDATE i DELETE zablokowane w bazie; zmiana wpisu z przeliczonym łańcuchem SHA-256 jest wykrywana', async () => {
    const srv = await startServer();
    try {
      const mgr = await asManager(srv);
      assert.equal((await mgr.get('/api/audit')).body.chainOk, true);
      const db = new DatabaseSync(path.join(srv.dir, 'kompas.db'));
      assert.throws(() => db.prepare("UPDATE audit SET target='x' WHERE id=1").run(), /tylko dopisywanie/);
      assert.throws(() => db.prepare('DELETE FROM audit WHERE id=1').run(), /tylko dopisywanie/);
      // Atakujący z dostępem do pliku: usuwa trigger, zmienia wpis i przelicza cały łańcuch od nowa
      db.exec('DROP TRIGGER audit_no_update');
      const rows = db.prepare('SELECT * FROM audit ORDER BY id').all();
      const victim = rows.find(r => r.action === 'login');
      db.prepare("UPDATE audit SET target='zmienione' WHERE id=?").run(victim.id);
      let prev = '';
      for (const r of db.prepare('SELECT * FROM audit ORDER BY id').all()) {
        if (!r.hash) continue;
        const h = chainHash(prev, r);
        db.prepare('UPDATE audit SET prev_hash=?, hash=? WHERE id=?').run(prev, h, r.id);
        prev = h;
      }
      db.close();
      const a = (await mgr.get('/api/audit')).body;
      assert.equal(a.chainOk, false);
      assert.equal(a.brokenAt, victim.id);
    } finally { await srv.stop(); }
  });
  test('migracja: wpisy bez pieczęci – w produkcji naruszenie, z KK_AUDIT_MIGRATE=1 opieczętowane; lokalnie automatycznie', async () => {
    const pass = 'Demo-produkcja-123';
    const prodSeed = { ...PROD_ENV, KK_SEED_DEMO: '1', KK_DEMO_PASSWORD: pass };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kk-test-'));
    // Symulacja bazy sprzed P0: wpisy w dzienniku bez kolumny mac
    const strip = () => { const db = new DatabaseSync(path.join(dir, 'kompas.db')); db.exec('DROP TRIGGER IF EXISTS audit_no_update; UPDATE audit SET mac=NULL'); db.close(); };
    const run = async (env, fn, keep = true) => { const s = await startServer(env, { dir, keep }); try { return await fn(s); } finally { await s.stop(); } };
    const chainOk = async s => (await (await s.client().login('przelozony@demo.kk', pass)).get('/api/audit')).body.chainOk;
    await run(prodSeed, s => s.client().login('przelozony@demo.kk', pass));
    strip();
    assert.equal(await run(prodSeed, chainOk), false, 'produkcja bez migracji: brak pieczęci = naruszenie');
    assert.equal(await run({ ...prodSeed, KK_AUDIT_MIGRATE: '1' }, async s => { assert.match(s.log(), /opieczętowano HMAC/); return chainOk(s); }), true);
    strip();
    // Lokalnie (ten sam klucz z KK_AUDIT_KEY): migracja automatyczna
    assert.equal(await run({ KK_AUDIT_KEY: PROD_ENV.KK_AUDIT_KEY, KK_DEMO_PASSWORD: pass }, chainOk, false), true);
  });
});
