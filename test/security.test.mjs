// Faza 6: konfiguracja haseł demo, limit prób logowania, rotacja sesji, cookie i nagłówki bezpieczeństwa
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, DEMO_PASS, PROD_ENV } from './helpers.mjs';
import { demoConfig } from '../lib/seed-config.mjs';

describe('konfiguracja seedu', () => {
  test('lokalnie: domyślne hasło; produkcja: brak domyślnego hasła i seedu', () => {
    assert.equal(demoConfig({}).password, DEMO_PASS);
    assert.equal(demoConfig({}).seed, true);
    assert.equal(demoConfig({ KK_DEMO_PASSWORD: 'Inne-haslo-123' }).hintPassword, null);
    const prod = demoConfig({ KK_MODE: 'production' });
    assert.equal(prod.seed, false);
    assert.equal(prod.password, '');
    assert.throws(() => demoConfig({ KK_MODE: 'production', KK_SEED_DEMO: '1' }), /KK_DEMO_PASSWORD/);
    assert.throws(() => demoConfig({ KK_DEMO_PASSWORD: 'krotkie' }), /10 znaków/);
  });
  test('hasło z KK_DEMO_PASSWORD działa, domyślne nie; /api/demo nie zdradza hasła', async () => {
    const srv = await startServer({ KK_DEMO_PASSWORD: 'Wlasne-haslo-demo-1' });
    try {
      const c = srv.client();
      assert.equal((await c.post('/api/login', { email: 'przelozony@demo.kk', password: DEMO_PASS })).status, 401);
      assert.equal((await c.post('/api/login', { email: 'przelozony@demo.kk', password: 'Wlasne-haslo-demo-1' })).status, 200);
      const d = (await c.get('/api/demo')).body;
      assert.equal(d.enabled, true);
      assert.equal(d.password, null);
    } finally { await srv.stop(); }
  });
  test('tryb produkcyjny: brak kont demo, /api/demo wyłączone, HSTS i Secure', async () => {
    const srv = await startServer(PROD_ENV);
    try {
      const c = srv.client();
      assert.equal((await c.get('/api/demo')).body.enabled, false);
      const r = await c.post('/api/login', { email: 'przelozony@demo.kk', password: DEMO_PASS });
      assert.equal(r.status, 401);
      assert.match(r.headers.get('strict-transport-security') || '', /max-age/);
      assert.match((await c.post('/api/logout')).headers.get('set-cookie'), /^__Host-kk_sid=;.*Secure/);
    } finally { await srv.stop(); }
  });
});

describe('sesje i nagłówki', () => {
  test('rotacja sesji po zalogowaniu; cookie HttpOnly i SameSite=Strict; nagłówki bezpieczeństwa w API', async () => {
    const srv = await startServer();
    try {
      const c = srv.client();
      const r1 = await c.post('/api/login', { email: 'przelozony@demo.kk', password: DEMO_PASS });
      const sc = r1.headers.get('set-cookie');
      assert.match(sc, /HttpOnly/);
      assert.match(sc, /SameSite=Strict/);
      const first = c.cookie;
      await c.post('/api/login', { email: 'przelozony@demo.kk', password: DEMO_PASS });
      assert.notEqual(c.cookie, first, 'nowy identyfikator sesji');
      const stale = srv.client(); stale.cookie = first;
      assert.equal((await stale.get('/api/me')).status, 401, 'poprzednia sesja unieważniona');
      const me = await c.get('/api/me');
      assert.equal(me.status, 200);
      for (const h of ['content-security-policy', 'x-content-type-options', 'x-frame-options', 'referrer-policy', 'permissions-policy', 'cross-origin-opener-policy']) assert.ok(me.headers.get(h), h);
      assert.equal(me.headers.get('strict-transport-security'), null, 'bez HSTS lokalnie (HTTP)');
      const page = await fetch(srv.base + '/');
      assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
    } finally { await srv.stop(); }
  });
});

describe('limit prób logowania', () => {
  test('5 nieudanych prób z jednego adresu dla konta → 429 z Retry-After (także dla poprawnego hasła)', async () => {
    const srv = await startServer();
    try {
      const c = srv.client();
      for (let i = 0; i < 5; i++) assert.equal((await c.post('/api/login', { email: 'pracownik2@demo.kk', password: 'zle-haslo' })).status, 401);
      const blocked = await c.post('/api/login', { email: 'pracownik2@demo.kk', password: DEMO_PASS });
      assert.equal(blocked.status, 429);
      assert.ok(Number(blocked.headers.get('retry-after')) > 0);
      // Blokada dotyczy pary adres + konto: inne konto z tego samego adresu loguje się normalnie (P0.3)
      assert.equal((await c.post('/api/login', { email: 'przelozony@demo.kk', password: DEMO_PASS })).status, 200);
    } finally { await srv.stop(); }
  });
});
