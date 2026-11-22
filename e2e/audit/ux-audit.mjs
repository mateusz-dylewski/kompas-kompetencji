// Audyt UX: każdy ekran i okno w obu rolach, desktop 1440 i telefon 390.
// Wykrywa: poziome przewijanie strony, elementy wystające poza ekran, przycięty tekst (overflow), błędy konsoli.
// Uruchomienie: node e2e/audit/ux-audit.mjs  → e2e/audit/out/*.png + report.json (atrapa AI, osobna baza, bez sieci)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startServer } from '../../test/helpers.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
const PASS = 'Demo-kompas-2026!';
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });

const mock = http.createServer((req, res) => {
  let b = ''; req.on('data', c => { b += c; }); req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'qwen2.5:14b' }] }));
    const sys = (() => { try { return JSON.parse(b).messages[0].content; } catch { return ''; } })();
    const content = /JSON .*propozycje|kryteri.*WYŁĄCZNIE z podanej listy/i.test(sys)
      ? '{"propozycje":[]}'
      : 'Tematy do omówienia:\n- Współpraca w zespole\n- Terminowość\n\nPrzykłady z okresu:\n- Uzgodnienie harmonogramu z wykonawcą.\n\nPytania otwarte:\n- Co pomogło w osiągnięciu rezultatu?\n- Czego potrzebujesz w kolejnym okresie?';
    setTimeout(() => res.end(JSON.stringify({ message: { content } })), 300);
  });
}).listen(0, '127.0.0.1');
await new Promise(ok => mock.once('listening', ok));
const srv = await startServer({ KK_AI_URL: `http://127.0.0.1:${mock.address().port}` });

// Kontrola układu na bieżącym ekranie
const layoutCheck = p => p.evaluate(() => {
  const W = innerWidth, issues = [];
  if (document.documentElement.scrollWidth > W + 1) issues.push(`poziome przewijanie strony: ${document.documentElement.scrollWidth}px > ${W}px`);
  const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.05; };
  const inScrollBox = el => { for (let a = el.parentElement; a; a = a.parentElement) { const s = getComputedStyle(a); if (/(auto|scroll)/.test(s.overflowX) && a.scrollWidth > a.clientWidth) return true; } return false; };
  const label = el => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''} „${(el.innerText || el.value || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 40)}”`;
  const seen = new Set();
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el) || el.closest('.sr, .sr-only, [aria-hidden="true"], svg')) continue;
    // Elementy celowo ukryte wizualnie (np. nagłówki tabel na telefonie, 1 px) – dostępne dla czytnika, niewidoczne
    let hiddenBox = false; for (let a = el; a; a = a.parentElement) { const q = a.getBoundingClientRect(); if (q.width <= 1 || q.height <= 1) { hiddenBox = true; break; } }
    if (hiddenBox) continue;
    const r = el.getBoundingClientRect();
    if ((r.right > W + 1 || r.left < -1) && !inScrollBox(el) && getComputedStyle(el).position !== 'fixed') {
      const k = 'out:' + label(el); if (!seen.has(k)) { seen.add(k); issues.push(`wystaje poza ekran (${Math.round(r.left)}–${Math.round(r.right)}px): ${label(el)}`); }
    }
    const s = getComputedStyle(el);
    const textEl = el.children.length === 0 && (el.innerText || '').trim().length > 0;
    if (textEl && /(hidden|clip)/.test(s.overflowX + s.overflow) && el.scrollWidth > el.clientWidth + 2) {
      const k = 'clip:' + label(el); if (!seen.has(k)) { seen.add(k); issues.push(`przycięty tekst: ${label(el)}`); }
    }
  }
  // Treść: daty tylko DD.MM.RRRR, bez słownictwa roboczego
  const txt = document.body.innerText;
  const iso = [...new Set(txt.match(/\b20\d\d-\d\d(-\d\d)?\b/g) || [])];
  if (iso.length) issues.push(`data w formacie ISO: ${iso.slice(0, 3).join(', ')}`);
  const words = [...new Set((txt.match(/\b(demo|mock|prototyp\w*|testow\w*|lorem|TODO|undefined|null|NaN)\b/gi) || []))];
  if (words.length) issues.push(`słownictwo robocze: ${words.join(', ')}`);
  return issues.slice(0, 25);
});

const report = [];
async function run(role, vpName, vp, plan) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: vp, isMobile: vp.width < 600, hasTouch: vp.width < 600, locale: 'pl-PL' });
  const p = await ctx.newPage();
  p.setDefaultTimeout(6000);
  p.on('dialog', d => d.accept());
  const errors = [];
  p.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  p.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  await p.goto(srv.base, { waitUntil: 'networkidle' });
  for (const [name, fn] of plan) {
    let err = null;
    try { await fn(p, vpName); await p.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {}); await p.waitForTimeout(450); }
    catch (e) { err = String(e.message || e).split('\n')[0].slice(0, 160); }
    const file = `${role}-${name}-${vpName}.png`;
    await p.screenshot({ path: path.join(OUT, file), fullPage: true }).catch(() => {});
    const issues = await layoutCheck(p).catch(e => [`kontrola nieudana: ${e.message}`]);
    report.push({ role, vp: vpName, screen: name, error: err, issues, file });
  }
  report.push({ role, vp: vpName, screen: '(konsola)', issues: errors });
  await browser.close();
}

const login = email => async p => { await p.fill('#lEmail', email); await p.fill('#lPass', PASS); await p.click('#loginForm button[type=submit]'); await p.waitForSelector('#view'); };
const nav = v => async (p, vp) => {
  const loc = p.locator(`[data-nav="${v}"]:visible`);
  if (!(await loc.count()) && vp === 'mobile') await p.locator('#moreBtn').click();
  await p.locator(`[data-nav="${v}"]:visible`).first().click();
};
const act = (a, extra = '') => async p => { await p.locator(`[data-act="${a}"]${extra}:visible`).first().click(); await p.waitForTimeout(700); };
// Krok opcjonalny: stan mógł zostać zmieniony w poprzednim przebiegu (ta sama baza dla desktopu i telefonu)
const actIf = a => async p => { const b = p.locator(`[data-act="${a}"]:visible`); if (await b.count()) { await b.first().click(); await p.waitForTimeout(700); } };
const close = async p => { await p.keyboard.press('Escape'); await p.waitForTimeout(250); };

const MGR = [
  ['logowanie', async () => {}],
  ['start', login('przelozony@demo.kk')],
  ['okno-rozmowa-rozpoczynajaca', act('kickoff')],
  ['okno-rozmowa-arkusz-C', async p => { await p.locator('input[name="kTyp"][value="C"]').check(); await p.waitForTimeout(200); }],
  ['okno-rozmowa-propozycje-AI', async p => { const b = p.locator('#modal button', { hasText: 'Zaproponuj' }); if (await b.count()) { await b.first().click(); await p.waitForTimeout(1500); } }],
  ['zamknij-1', close],
  ['okno-cele-i-plan', act('mgrGoals')],
  ['zamknij-2', close],
  ['okno-nowy-pracownik', act('addEmp')],
  ['zamknij-3', close],
  ['oceny', nav('evals')],
  ['kreator-krok-1', act('openEval')],
  ...[2, 3, 4, 5, 6, 7, 8].map(n => [`kreator-krok-${n}`, async p => { const b = p.locator('[data-wiz="next"]:visible'); if (await b.count()) await b.first().click(); }]),
  ['oceny-po-zlozeniu', nav('evals')],
  ['podglad-oceny-z-podpisami', act('readEval')],
  ['podpisz-ocene', actIf('signEval')],
  ['miesiac', nav('month')],
  ['okno-brief', act('aiBrief')],
  ['zamknij-4', close],
  ['informacje', nav('evidence')],
  ['okno-nowa-informacja', act('addEvidence')],
  ['zamknij-5', close],
  ['zestawienie', nav('summary')],
  ['wyniki', nav('results')],
  ['dziennik', nav('log')],
  ['asystent-ai', nav('ai')],
  ['ustawienia', nav('settings')],
];
const EMP = [
  ['start', login('pracownik1@demo.kk')],
  ['przygotuj-sie', act('aiPrep')],
  ['cele', nav('goals')],
  ['profil', nav('profile')],
  ['informacje-i-opinie', nav('evidence')],
  ['oceny', nav('evals')],
  ['podglad-oceny', act('readEval')],
  ['zapoznanie-z-ocena', actIf('ackEval')],
  ['asystent-ai', nav('ai')],
];

for (const [vpName, vp] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
  await run('przelozony', vpName, vp, MGR);
  await run('pracownik', vpName, vp, EMP);
}
await srv.stop(); mock.close();
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
const bad = report.filter(r => r.error || r.issues.length);
console.log(`ekrany: ${report.filter(r => r.screen !== '(konsola)').length}, z problemami: ${bad.length}`);
for (const r of bad) console.log(`- [${r.role}/${r.vp}] ${r.screen}${r.error ? ' BŁĄD: ' + r.error : ''}${r.issues.length ? '\n    ' + r.issues.slice(0, 6).join('\n    ') : ''}`);
