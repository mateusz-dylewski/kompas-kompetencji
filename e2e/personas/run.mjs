// Skrypty person (symulacja użytkowników) – Playwright.
// Uruchomienie: node e2e/personas/run.mjs <persona|all>   persony: krystyna, michal, ewa, juror, klawiatura, awaria; PERSONA_AI=down|slow|ok
// Każda persona dostaje własny serwer (losowy port, osobny katalog danych, atrapa modelu AI – bez prawdziwego API),
// przechodzi swoją ścieżkę w dwóch rozmiarach (desktop 1440 px, mobile 390 px), robi zrzut po każdym kroku
// i zapisuje do e2e/personas/out/<persona>/: *.png oraz log.json (kroki, czasy, błędy konsoli, problemy a11y).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startServer } from '../../test/helpers.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PASS = 'Demo-kompas-2026!';
const VIEWPORTS = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844, isMobile: true, hasTouch: true } };

// Atrapa modelu AI (API Ollama): odpowiada po polsku po 800 ms, żeby widać było stan „model myśli”
// Tryb awarii: PERSONA_AI=ok (domyślnie) | down (500 na wszystko) | slow (odpowiedź po 6 s)
const AI_MODE = ['down', 'slow'].includes(process.env.PERSONA_AI) ? process.env.PERSONA_AI : 'ok';
function startMockAI() {
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', c => { b += c; }); req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (AI_MODE === 'down') { res.statusCode = 500; return res.end(JSON.stringify({ error: 'AI niedostępne (atrapa: down)' })); }
      if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'qwen2.5:14b' }] }));
      // Atrapa cytuje prawdziwe identyfikatory faktów z promptu (jak dobry model), żeby brief wyglądał jak w demo
      let ids = [];
      try { ids = [...new Set((JSON.parse(b).messages || []).map(m => m.content).join(' ').match(/"id":"[IFCG][0-9.]+"/g) || [])].map(x => x.slice(6, -1)).slice(0, 2); } catch { /* nie JSON */ }
      const ex = ids.length ? ids.map((id, i) => `- ${i ? 'Przygotowanie wersji roboczej i zebranie uwag przed terminem' : 'Uzgodnienie harmonogramu z wykonawcą'} [${id}]`).join('\n') : '- Uzgodnienie harmonogramu z wykonawcą.';
      const content = `Tematy do omówienia:\n- współpraca w zespole\n\nPrzykłady z okresu:\n${ex}\n\nPytania otwarte:\n- Co pomogło w osiągnięciu rezultatu?\n- Czego potrzebujesz w kolejnym okresie?`;
      setTimeout(() => res.end(JSON.stringify({ message: { content } })), AI_MODE === 'slow' ? 6000 : 800);
    });
  }).listen(0, '127.0.0.1');
  return new Promise(ok => srv.once('listening', () => ok(srv)));
}

// Wspólne kroki
const login = email => async p => {
  await p.fill('#lEmail', email); await p.fill('#lPass', PASS);
  await p.click('#loginForm button[type=submit]');
  await p.waitForSelector('#view, main', { timeout: 8000 });
};
const nav = view => async (p, vp) => {
  const sel = vp === 'mobile' ? `.bottom [data-nav="${view}"]` : `.side [data-nav="${view}"]`;
  const loc = p.locator(sel);
  if (vp === 'mobile' && !(await loc.first().isVisible().catch(() => false)) && await p.locator('#moreBtn').count()) {
    if ((await p.locator('#moreBtn').getAttribute('aria-expanded')) !== 'true') await p.locator('#moreBtn').click();
    await p.locator(sel).first().click();
  } else if (await loc.count()) await loc.first().click(); else await p.locator(`[data-nav="${view}"]`).first().click();
  await p.waitForTimeout(400);
};
const clickAct = (act, opts = {}) => async p => { await p.locator(`[data-act="${act}"]${opts.id ? `[data-id="${opts.id}"]` : ''}`).first().click(); await p.waitForTimeout(opts.wait ?? 500); };
const closeModal = async p => {
  if (!(await p.locator('#modal').count())) return;
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  if (await p.locator('#modal').count()) {
    const b = p.locator('#modal [data-act="closeModal"]'); if (await b.count()) await b.first().click();
    await p.waitForSelector('#modal', { state: 'detached', timeout: 3000 }).catch(() => {});
  }
  return { modalClosed: !(await p.locator('#modal').count()) };
};
const waitAI = async p => { await p.waitForFunction(() => !document.querySelector('.ai-think'), null, { timeout: 15000 }).catch(() => {}); await p.waitForTimeout(300); };

// Czy w widoku/modalu jest czytelny komunikat zamiast pustki lub wiszącego ładowania
const aiFallbackCheck = async p => {
  await p.waitForFunction(() => !document.querySelector('.ai-think'), null, { timeout: 12000 }).catch(() => {});
  await p.waitForTimeout(500);
  return p.evaluate(() => {
    const txt = (document.querySelector('#modal') || document.querySelector('#view') || document.body).innerText || '';
    return { aiFallbackVisible: /reguł|niedostępn|niedostepn/i.test(txt) && !/Ładowanie|Wczytywanie|myśli/i.test(txt), aiText: txt.replace(/\s+/g, ' ').slice(0, 160) };
  });
};


// ---- Pomoce dla persony „klawiatura”: wyłącznie klawisze, bez myszy ----
const KB_MAX_TABS = 80;
const kbState = p => p.evaluate(() => {
  const a = document.activeElement;
  if (!a || a === document.body) return { name: 'body', focusVisible: false, id: '' };
  const nm = el => { const al = el.getAttribute('aria-label'); if (al) return al.trim(); if (el.labels?.length) return [...el.labels].map(l => l.textContent).join(' ').replace(/\s+/g, ' ').trim(); return ((el.textContent || '').replace(/\s+/g, ' ').trim() || el.title || el.getAttribute('placeholder') || el.id || '').slice(0, 60); };
  const vis = el => { if (!el) return false; const c = getComputedStyle(el); return (c.outlineStyle !== 'none' && parseFloat(c.outlineWidth) > 0) || (c.boxShadow && c.boxShadow !== 'none'); };
  // dla pól wyboru wskaźnik bywa na etykiecie/sąsiednim elemencie
  const fv = vis(a) || (/^(radio|checkbox)$/.test(a.type || '') && (vis(a.closest('label')) || vis(a.nextElementSibling) || vis(a.parentElement)));
  return { name: nm(a), focusVisible: !!fv, id: a.id || a.dataset.act || a.dataset.nav || a.dataset.wiz || '' };
});
// Naciska Tab (maks. 80 razy), aż fokus trafi w widoczny element pasujący do selektora
const tabTo = async (p, sel) => {
  const hit = () => p.evaluate(s => { const a = document.activeElement; return !!(a && a !== document.body && a.matches(s) && (a.offsetWidth || a.offsetHeight || a.getClientRects().length)); }, sel);
  const passed = [];
  for (let n = 0; n <= KB_MAX_TABS; n++) {
    if (await hit()) return { found: true, tabs: n, passed, ...(await kbState(p)) };
    if (n === KB_MAX_TABS) break;
    await p.keyboard.press('Tab');
    passed.push((await kbState(p)).id);
  }
  return { found: false, tabs: KB_MAX_TABS, passed, ...(await kbState(p)) };
};
// Krok klawiaturowy: [selektor, klawisz po dojściu]; składa wynik z kilku podkroków
const kbStep = async (p, parts) => {
  let tabs = 0, last = {}, trap = false; const trace = [];
  for (const [sel, key, wait] of parts) {
    const r = await tabTo(p, sel); tabs += r.tabs; last = r; trace.push(`${sel}:${r.found ? r.tabs : 'BRAK'}`);
    if (!r.found) { trap = true; break; }
    if (key) { await p.keyboard.press(key); await p.waitForTimeout(wait ?? 500); }
  }
  const st = await kbState(p);
  return { tabs, focus: last.name || st.name, focusVisible: last.focusVisible ?? st.focusVisible, keyboardTrap: trap, kbTrace: trace, passed: last.passed, kbCtx: { activeAfter: st.name } };
};
// Przejście do widoku klawiaturą (na mobile: przez „Więcej”, jeśli pozycji nie ma w dolnym pasku)
const kbNav = view => async (p, vp) => {
  const sel = `[data-nav="${view}"]`;
  let r = await kbStep(p, [[sel, 'Enter', 600]]);
  if (r.keyboardTrap && vp === 'mobile' && await p.locator('#moreBtn').count()) {
    const r1 = await kbStep(p, [['#moreBtn', 'Enter', 400], [sel, 'Enter', 600]]);
    r1.tabs += r.tabs; return r1;
  }
  return r;
};

// Scenariusze person: lista [nazwa kroku, funkcja]
const SCENARIOS = {
  // Awaria AI (uruchamiać z PERSONA_AI=down): czy użytkownik widzi komunikat zamiast pustki
  awaria: [
    ['logowanie', login('przelozony@demo.kk')],
    ['miesiac', nav('month')],
    ['brief-ai-awaria', async p => { await clickAct('aiBrief', { wait: 300 })(p); return aiFallbackCheck(p); }],
    ['zamknij-brief', closeModal],
    ['oceny', nav('evals')],
    ['kreator-otworz', async p => { await p.locator('[data-act="openEval"]').first().click(); await p.waitForTimeout(800); }],
    ['pytania-do-rozmowy-ai-awaria', async p => {
      for (let i = 0; i < 6 && !(await p.locator('[data-act="aiTalk"]').count()); i++) {
        const n = p.locator('[data-wiz="next"]'); if (!(await n.count())) break;
        await n.first().click(); await p.waitForTimeout(400);
      }
      if (!(await p.locator('[data-act="aiTalk"]').count())) return { aiFallbackVisible: null, aiText: 'brak przycisku aiTalk w kreatorze (krok pominięty)' };
      await p.locator('[data-act="aiTalk"]').first().click();
      return aiFallbackCheck(p);
    }],
  ],
  // Pani Krystyna – naczelniczka, ocena okresowa w 20 minut (a) kryteria, (b) ocena, (c) rozmowa
  krystyna: [
    ['logowanie-ekran', async () => {}],
    ['logowanie', login('przelozony@demo.kk')],
    ['start', async () => {}],
    ['a-kryteria-rozmowa-rozpoczynajaca', clickAct('kickoff', { wait: 800 })],
    ['a-zamknij', closeModal],
    ['b-oceny', nav('evals')],
    ['b-kreator-otworz', async p => { await p.locator('[data-act="openEval"]').first().click(); await p.waitForTimeout(800); }],
    ['b-kreator-krok-2', async p => { await p.locator('[data-wiz="next"]').first().click(); await p.waitForTimeout(500); }],
    ['b-kreator-krok-3', async p => { await p.locator('[data-wiz="next"]').first().click(); await p.waitForTimeout(500); }],
    ['b-informacje', nav('evidence')],
    ['b-zestawienie', nav('summary')],
    ['c-miesiac', nav('month')],
    ['c-brief-rozmowy', async p => { await clickAct('aiBrief', { wait: 300 })(p); await waitAI(p); }],
  ],
  // Michał – specjalista, telefon: wyniki i rozwój (c)
  michal: [
    ['logowanie', login('pracownik1@demo.kk')],
    ['start', async () => {}],
    ['c-przygotuj-sie-do-rozmowy', async p => { if (await p.locator('[data-act="aiPrep"]').count()) { await clickAct('aiPrep', { wait: 300 })(p); await waitAI(p); } }],
    ['c-cele', nav('goals')],
    ['c-profil-plan-rozwoju', nav('profile')],
    ['b-oceny', nav('evals')],
    ['b-podglad-oceny', async p => { if (await p.locator('[data-act="readEval"]').count()) { await p.locator('[data-act="readEval"]').first().click(); await p.waitForTimeout(800); } }],
    ['b-szczegoly-kryterium', async p => { const d = p.locator('details.comp summary').first(); if (await d.count()) { await d.click(); await p.waitForTimeout(500); } }],
  ],
  // Ewa z kadr / BDG – kryteria i zgodność z procedurą (a), (b)
  ewa: [
    ['logowanie', login('przelozony@demo.kk')],
    ['a-rozmowa-rozpoczynajaca-kryteria', clickAct('kickoff', { wait: 800 })],
    ['a-zamknij', closeModal],
    ['b-oceny', nav('evals')],
    ['b-kreator-kryteria', async p => { await p.locator('[data-act="openEval"]').first().click(); await p.waitForTimeout(800); }],
    ['b-dziennik-zdarzen', nav('log')],
    ['ustawienia-modulow', nav('settings')],
    ['b-wyniki-zespolu', nav('results')],
  ],
  // Juror – 3 minuty: pierwsze wrażenie, przełożony, pracownik
  juror: [
    ['pierwsze-wrazenie-logowanie', async () => {}],
    ['przelozony-start', login('przelozony@demo.kk')],
    ['a-kryteria', clickAct('kickoff', { wait: 800 })],
    ['a-zamknij', closeModal],
    ['b-kreator-oceny', async (p, vp) => { await nav('evals')(p, vp); await p.locator('[data-act="openEval"]').first().click(); await p.waitForTimeout(800); }],
    ['c-brief', async (p, vp) => { await nav('month')(p, vp); await clickAct('aiBrief', { wait: 300 })(p); await waitAI(p); }],
    ['c-zamknij', closeModal],
    ['pracownik-start', async p => { const lo = p.locator('[data-act="logout"]:visible'); if (!(await lo.count()) && await p.locator('#moreBtn').count()) { if ((await p.locator('#moreBtn').getAttribute('aria-expanded')) !== 'true') await p.locator('#moreBtn').click(); await p.waitForTimeout(300); } await lo.first().click(); await p.waitForTimeout(600); await login('pracownik1@demo.kk')(p); }],
    ['c-pracownik-profil', nav('profile')],
  ],
  // Tylko klawiatura (i czytnik ekranu): logowanie i nawigacja bez myszy
  klawiatura: [
    ['logowanie-tab', async p => { await p.keyboard.press('Tab'); await p.keyboard.press('Tab'); await p.keyboard.press('Tab'); }],
    ['logowanie-klawiatura', async p => { await p.focus('#lEmail'); await p.keyboard.type('przelozony@demo.kk'); await p.keyboard.press('Tab'); await p.keyboard.type(PASS); await p.keyboard.press('Enter'); await p.waitForSelector('#view, main', { timeout: 8000 }); }],
    ['start-tab-x8', async p => { for (let i = 0; i < 8; i++) await p.keyboard.press('Tab'); }],
    ['enter-na-fokusie', async p => { await p.keyboard.press('Enter'); await p.waitForTimeout(600); }],
    ['escape', async p => { await p.keyboard.press('Escape'); await p.waitForTimeout(300); }],
    ['tab-x6', async p => { for (let i = 0; i < 6; i++) await p.keyboard.press('Tab'); }],
    // (a) kryteria – tylko klawiatura
    ['a-start-klawiatura', async (p, vp) => { await p.keyboard.press('Escape'); return kbNav('home')(p, vp); }],
    ['a-ustal-kryteria-klawiatura', p => kbStep(p, [['[data-act="kickoff"]', 'Enter', 900]])],
    ['a-modal-kryteria-spacja', async p => {
      let pre = null;
      // jeśli arkusz nie jest jeszcze wybrany, kryteria dodatkowe się nie pokazują – wybierz arkusz Spacją
      if (!(await p.locator('#modal [data-extra]').count())) { pre = await kbStep(p, [['#modal input[name="kTyp"]', 'Space', 400]]); }
      const r = await kbStep(p, [['#modal [data-extra]', 'Space', 300]]);
      if (pre) { r.tabs += pre.tabs; r.kbTrace = [...pre.kbTrace, ...r.kbTrace]; r.keyboardTrap = r.keyboardTrap || pre.keyboardTrap; r.passed = [...(pre.passed || []), ...(r.passed || [])]; }
      r.aiButtonOnTabPath = (r.passed || []).includes('kAiBtn');
      r.checkboxChecked = await p.evaluate(() => !!document.activeElement?.checked);
      r.modalOpen = !!(await p.locator('#modal').count());
      return r;
    }],
    ['a-escape-zamyka-okno', async p => {
      await p.keyboard.press('Escape'); await p.waitForTimeout(400);
      const s = await kbState(p);
      return { tabs: 0, focus: s.name, focusVisible: s.focusVisible, modalClosed: !(await p.locator('#modal').count()), focusReturned: s.name !== 'body' };
    }],
    // (b) ocena – tylko klawiatura
    ['b-oceny-klawiatura', kbNav('evals')],
    ['b-otworz-szkic-klawiatura', p => kbStep(p, [['[data-act="openEval"]', 'Enter', 900]])],
    ['b-dalej-1-klawiatura', p => kbStep(p, [['[data-wiz="next"]', 'Enter', 600]])],
    ['b-dalej-2-klawiatura', p => kbStep(p, [['[data-wiz="next"]', 'Enter', 600]])],
    ['b-poziom-strzalki', async p => {
      const r = await kbStep(p, [['input[type="radio"][data-rate], input[type="radio"][data-partial]', null]]);
      if (r.keyboardTrap) return r;
      const before = await p.evaluate(() => document.activeElement.value);
      await p.keyboard.press('ArrowDown'); await p.waitForTimeout(300);
      const after = await p.evaluate(() => ({ v: document.activeElement.value, ok: document.activeElement.checked }));
      r.radioBefore = before; r.radioAfter = after.v; r.radioChecked = after.ok; r.arrowWorks = after.v !== before && after.ok;
      return r;
    }],
    // (c) miesiąc i brief – tylko klawiatura
    ['c-miesiac-klawiatura', kbNav('month')],
    ['c-brief-klawiatura', async p => { const r = await kbStep(p, [['[data-act="aiBrief"]', 'Enter', 300]]); await waitAI(p); return r; }],
    ['c-escape-brief', async p => {
      await p.keyboard.press('Escape'); await p.waitForTimeout(400);
      const s = await kbState(p);
      return { tabs: 0, focus: s.name, focusVisible: s.focusVisible, modalClosed: !(await p.locator('#modal').count()), focusReturned: s.name !== 'body' };
    }],
  ],
};

// Proste kontrole dostępności na bieżącym ekranie
const a11yCheck = p => p.evaluate(() => {
  const out = [];
  const vis = el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const accName = el => {
    const al = el.getAttribute('aria-label'); if (al && al.trim()) return al.trim();
    const lb = el.getAttribute('aria-labelledby');
    if (lb) { const t = lb.split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ').trim(); if (t) return t; }
    if (el.labels?.length) { const t = [...el.labels].map(l => l.textContent).join(' ').trim(); if (t) return t; }
    const tc = (el.textContent || '').replace(/\s+/g, ' ').trim(); if (tc) return tc;
    return (el.title || el.getAttribute('placeholder') || '').trim();
  };
  document.querySelectorAll('img').forEach(i => { if (!i.hasAttribute('alt')) out.push(`img bez alt: ${i.src.slice(-40)}`); });
  document.querySelectorAll('input, select, textarea').forEach(i => {
    if (i.type === 'hidden' || !vis(i)) return;
    const named = i.labels?.length || i.getAttribute('aria-label') || i.getAttribute('aria-labelledby') || i.title;
    if (!named) out.push(`pole bez etykiety: ${i.outerHTML.slice(0, 80)}`);
  });
  document.querySelectorAll('button, a[href]').forEach(b => { if (vis(b) && !accName(b)) out.push(`przycisk/link bez nazwy: ${b.outerHTML.slice(0, 80)}`); });
  const h1 = [...document.querySelectorAll('h1')].filter(vis).length;
  if (h1 !== 1) out.push(`liczba widocznych h1: ${h1}`);
  // (a) skip link – tylko na ekranach po zalogowaniu
  const loggedIn = !!document.querySelector('#view');
  const skipLinkMissing = loggedIn && !document.querySelector('a.skip, a[href="#view"]');
  if (skipLinkMissing) out.push('brak linku „Przejdź do treści”');
  // (b) powtórzone nazwy przycisków
  const counts = {};
  document.querySelectorAll('button, [role="button"]').forEach(b => { if (!vis(b)) return; const n = accName(b).slice(0, 50); if (n) counts[n] = (counts[n] || 0) + 1; });
  const dups = Object.entries(counts).filter(([, c]) => c > 2).map(([n, c]) => `${n}×${c}`);
  if (dups.length) out.push(`powtórzone nazwy przycisków: ${dups.join(', ')}`);
  // (c) kontrast
  const parse = s => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1 }; };
  const lum = c => { const f = x => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const blend = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
  const bgOf = el => {
    const layers = [];
    for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; } }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i--) base = blend(layers[i], base);
    return base;
  };
  const hex = c => '#' + [c.r, c.g, c.b].map(x => Math.round(x).toString(16).padStart(2, '0')).join('');
  const sel = el => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
  const contrast = [];
  let n = 0;
  for (const el of document.querySelectorAll('p, span, a, button, td, label, small, li')) {
    if (n >= 300) break;
    if (!vis(el)) continue;
    const own = [...el.childNodes].filter(x => x.nodeType === 3).map(x => x.textContent).join('').trim();
    if (!own) continue;
    n++;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || +cs.opacity === 0) continue;
    const fg0 = parse(cs.color); if (!fg0) continue;
    const bg = bgOf(el);
    const fg = blend({ ...fg0, a: fg0.a * (+cs.opacity || 1) }, bg);
    const l1 = lum(fg), l2 = lum(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const px = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700;
    const need = (px >= 24 || (px >= 18.66 && bold)) ? 3 : 4.5;
    if (ratio < need) contrast.push({ sel: sel(el), text: own.slice(0, 30), fg: hex(fg), bg: hex(bg), ratio: Math.round(ratio * 100) / 100, need });
  }
  contrast.slice(0, 10).forEach(c => out.push(`kontrast ${c.ratio}:1 (<${c.need}) ${c.sel} „${c.text}” ${c.fg} na ${c.bg}`));
  const a = document.activeElement;
  const focus = a && a !== document.body ? `${a.tagName.toLowerCase()} „${accName(a).slice(0, 40)}” outline=${getComputedStyle(a).outlineStyle}/${getComputedStyle(a).outlineWidth}` : 'body';
  return { issues: out, focus, contrastFails: contrast.length, contrastSamples: contrast.slice(0, 10), duplicateNames: dups, skipLinkMissing };
});

async function runPersona(name) {
  const steps = SCENARIOS[name];
  if (!steps) throw new Error(`Nieznana persona: ${name}`);
  const outDir = path.join(HERE, 'out', name);
  fs.rmSync(outDir, { recursive: true, force: true }); fs.mkdirSync(outDir, { recursive: true });
  const mock = await startMockAI();
  const srv = await startServer({ KK_AI_URL: `http://127.0.0.1:${mock.address().port}` });
  const browser = await chromium.launch();
  const log = { persona: name, aiMode: AI_MODE, started: new Date().toISOString(), runs: {} };
  try {
    for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.isMobile, hasTouch: !!vp.hasTouch, locale: 'pl-PL' });
      const p = await ctx.newPage();
      p.setDefaultTimeout(8000);
      const run = { consoleErrors: [], pageErrors: [], failedRequests: [], steps: [] };
      p.on('console', m => { if (m.type() === 'error') run.consoleErrors.push(m.text().slice(0, 300)); });
      p.on('pageerror', e => run.pageErrors.push(String(e).slice(0, 300)));
      p.on('response', r => { if (r.status() >= 500) run.failedRequests.push(`${r.status()} ${r.url().replace(srv.base, '')}`); });
      const t0 = Date.now();
      await p.goto(srv.base, { waitUntil: 'networkidle' });
      run.initialLoadMs = Date.now() - t0;
      let i = 0;
      for (const [stepName, fn] of steps) {
        i++;
        const st = { step: stepName, ok: true };
        const t = Date.now();
        const isAI = /brief|przygotuj|pytania|ai-/i.test(stepName);
        try {
          const r = await fn(p, vpName); if (r && typeof r === 'object') Object.assign(st, r);
          await p.waitForFunction(() => { const v = document.querySelector('#view'); return !v || !/Ładowanie|Wczytywanie/.test(v.innerText); }, null, { timeout: 8000 }).catch(() => {});
          await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
          st.interactiveMs = Date.now() - t; st.ai = isAI;
        }
        catch (e) { st.ok = false; st.error = String(e.message || e).split('\n')[0].slice(0, 200); }
        st.ms = Date.now() - t;
        await p.waitForTimeout(250);
        await p.waitForFunction(() => document.getAnimations().every(a => a.playState !== 'running'), null, { timeout: 1500 }).catch(() => {});
        const file = `${String(i).padStart(2, '0')}-${stepName}-${vpName}.png`;
        await p.screenshot({ path: path.join(outDir, file), fullPage: vpName === 'desktop' ? false : false }).catch(() => {});
        st.screenshot = file;
        const a = await a11yCheck(p).catch(() => ({ issues: ['a11y: nie udało się sprawdzić'], focus: '' }));
        st.a11y = a.issues; st.a11yFocus = a.focus; st.focus = st.focus || a.focus;
        st.contrastFails = a.contrastFails || 0; st.contrastSamples = a.contrastSamples || []; st.duplicateNames = a.duplicateNames || []; st.skipLinkMissing = !!a.skipLinkMissing;
        run.steps.push(st);
      }
      log.runs[vpName] = run;
      await ctx.close();
    }
  } finally {
    await browser.close(); await srv.stop(); mock.close();
  }
  const sum = Object.fromEntries(Object.entries(log.runs).map(([k, r]) => [k, {
    stepsOk: `${r.steps.filter(s => s.ok).length}/${r.steps.length}`, failed: r.steps.filter(s => !s.ok).map(s => `${s.step}: ${s.error}`),
    consoleErrors: r.consoleErrors.length + r.pageErrors.length, http5xx: r.failedRequests.length, initialLoadMs: r.initialLoadMs,
    slowestStep: r.steps.reduce((a, s) => (s.ms > (a?.ms || 0) ? s : a), null)?.step, maxStepMs: Math.max(...r.steps.map(s => s.ms)),
    screensOver2s: r.steps.filter(s => !s.ai && s.interactiveMs > 2000).map(s => `${s.step}: ${s.interactiveMs} ms`),
    aiFallbackVisible: r.steps.filter(s => 'aiFallbackVisible' in s).map(s => `${s.step}: ${s.aiFallbackVisible}`),
    contrastFails: r.steps.reduce((a, s) => a + (s.contrastFails || 0), 0),
    duplicateNames: r.steps.filter(s => s.duplicateNames?.length).map(s => `${s.step}: ${s.duplicateNames.join(', ')}`),
    skipLinkMissing: r.steps.filter(s => s.skipLinkMissing).length,
    ...(name === 'klawiatura' ? {
      keyboardTraps: r.steps.filter(s => s.keyboardTrap).map(s => `${s.step}: ${s.kbTrace?.join(' > ')}`),
      invisibleFocus: r.steps.filter(s => 'focusVisible' in s && !s.focusVisible).length,
      invisibleFocusSteps: r.steps.filter(s => 'focusVisible' in s && !s.focusVisible).map(s => s.step),
      tabsPerPath: Object.fromEntries(['a', 'b', 'c'].map(k => [k, r.steps.filter(s => s.step.startsWith(k + '-') && s.tabs != null).reduce((x, s) => x + s.tabs, 0)])),
    } : {}),
    a11yIssues: [...new Set(r.steps.flatMap(s => s.a11y))].slice(0, 15),
  }]));
  log.summary = sum; log.aiMode = AI_MODE;
  fs.writeFileSync(path.join(outDir, 'log.json'), JSON.stringify(log, null, 2));
  return sum;
}

const arg = process.argv[2] || 'all';
const names = arg === 'all' ? Object.keys(SCENARIOS) : [arg];
for (const n of names) {
  const s = await runPersona(n);
  console.log(`== ${n}`); console.log(JSON.stringify(s, null, 1));
}
