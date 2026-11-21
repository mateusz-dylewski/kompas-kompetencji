// Pomocnicze do testów API: serwer na losowym porcie, osobny katalog danych (nie dotyka ./data)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL_DEMO_PASSWORD } from '../lib/seed-config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEMO_PASS = LOCAL_DEMO_PASSWORD; // lokalna wartość domyślna z konfiguracji seedu (tylko tryb lokalny)

export async function startServer(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kk-test-'));
  const child = spawn(process.execPath, ['--no-warnings', 'server.mjs'], {
    cwd: ROOT,
    // AI kierujemy na zamknięty port: testy idą ścieżką reguł, bez czekania na model
    // Tryb lokalny z domyślnym hasłem demo, niezależnie od zmiennych w powłoce
    env: { ...process.env, PORT: '0', KK_DATA_DIR: dir, KK_AI_URL: 'http://127.0.0.1:9', KK_MODE: 'local', KK_DEMO_PASSWORD: '', KK_SEED_DEMO: '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  const base = await new Promise((ok, bad) => {
    const t = setTimeout(() => bad(new Error('Serwer nie wystartował:\n' + log)), 10000);
    child.stdout.on('data', d => { log += d; const m = /http:\/\/localhost:(\d+)/.exec(log); if (m) { clearTimeout(t); ok(`http://127.0.0.1:${m[1]}`); } });
    child.stderr.on('data', d => { log += d; });
    child.on('exit', c => { clearTimeout(t); bad(new Error(`Serwer zakończył się (${c}):\n${log}`)); });
  });
  const stop = () => new Promise(ok => { child.once('exit', () => { fs.rmSync(dir, { recursive: true, force: true }); ok(); }); child.kill(); });
  return { base, dir, stop, log: () => log, client: () => new Client(base) };
}

export class Client {
  constructor(base) { this.base = base; this.cookie = ''; }
  async req(method, url, body, headers = {}) {
    const opt = { method, headers: { ...headers } };
    if (this.cookie) opt.headers.cookie = this.cookie;
    if (body !== undefined) { opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(body); }
    const r = await fetch(this.base + url, opt);
    const sc = r.headers.get('set-cookie');
    if (sc) { const m = /kk_sid=([^;]*)/.exec(sc); this.cookie = m && m[1] ? `kk_sid=${m[1]}` : ''; }
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { /* nie JSON */ }
    return { status: r.status, body: json, text, headers: r.headers };
  }
  get(url) { return this.req('GET', url); }
  post(url, body = {}) { return this.req('POST', url, body); }
  put(url, body = {}) { return this.req('PUT', url, body); }
  async login(email, password = DEMO_PASS) {
    const r = await this.post('/api/login', { email, password });
    if (r.status !== 200) throw new Error(`Logowanie ${email}: ${r.status} ${r.text}`);
    return this;
  }
}

// Logowanie jako przełożony / pracownik z danych demo
export const asManager = srv => srv.client().login('przelozony@demo.kk');
export const asEmployee = (srv, n = 1) => srv.client().login(`pracownik${n}@demo.kk`);
// Dzisiejsza data i miesiąc (UTC, jak na serwerze)
export const todayStr = () => new Date().toISOString().slice(0, 10);
export const monthStr = () => new Date().toISOString().slice(0, 7);
