/* Kompas Kompetencji – interfejs. Strony, kroki Dalej/Wstecz, dane i AI obsługuje server.mjs. */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pretty = s => s.toLowerCase().replace(/(^|\s)\S/g, m => m.toUpperCase());
  const nameOf = k => (MODEL.find(c => c.k === k) || {}).n || pretty(k);
  const avatar = (src, name, cls = "av") => src
    ? `<img class="${cls}" src="${esc(src)}" alt="" width="40" height="40" loading="lazy">`
    : `<span class="${cls} av-ph" aria-hidden="true">${esc(String(name || "?").split(" ").map(x => x[0]).slice(0, 2).join(""))}</span>`;
  const actBtn = (icon, label, attrs, cls = "g") => `<button class="btn sm ${cls} act-btn" ${attrs}>${KK_ICON(icon)}<span>${label}</span></button>`;
  const compIc = k => KK_COMP_ICON(k, "ic-svg comp-ic");
  const fmt = n => (n === null || n === undefined ? "—" : Number(n).toFixed(1));
  const MODEL = window.KK_MODEL || [];
  const TYP = { pierwsza: "Pierwsza ocena", B: "Okresowa – kierownicza (Arkusz B)", C: "Okresowa – pozostałe stanowiska (Arkusz C)" };
  const STATUS = { draft: ["Szkic", "wr"], submitted: ["Złożona", "info"], discussed: ["Omówiona", "ok"], none: ["Brak oceny", ""] };
  const LEVELS5 = ["Znacznie poniżej", "Poniżej", "Na poziomie", "Powyżej", "Znacznie powyżej"];
  const PTS5 = [1, 3, 5, 7, 9];
  const PTS3 = [3, 5, 7]; // pierwsza ocena – skala do weryfikacji z przepisami z 2015 r.
  const LEVELS3 = ["Poniżej", "Na poziomie", "Powyżej"];
  // Te same reguły co lib/documents.mjs (§ 11 rozporządzenia z 4.04.2016): przedziały średniej i ocena negatywna
  const BANDS = [[2, "znacznie poniżej oczekiwań"], [4, "poniżej oczekiwań"], [6, "na poziomie oczekiwań"], [8, "powyżej oczekiwań"], [9, "znacznie powyżej oczekiwań"]];
  const levelFor = a => (a === null || a === undefined ? "—" : a <= 2 ? BANDS[0][1] : (BANDS.find(([m]) => a <= m) || BANDS[4])[1]);
  const isS2 = (typ, data) => typ !== "pierwsza" && Number(data && data.schema) >= 2;

  // Ekrany rozumiane przez użytkownika: każdy ma tytuł i jedno zdanie „po co”
  const PAGES = {
    pracownik: [
      ["home", "Start", "home", "Co dziś warto zrobić"],
      ["profile", "Mój profil", "user", "Jak widzisz swoje kompetencje"],
      ["goals", "Cele", "flag", "Dokąd chcesz dojść"],
      ["evidence", "Dowody i feedback", "book", "Obserwacje, feedback i rozmowy miesięczne – Twój wgląd"],
      ["evals", "Oceny", "file", "Oceny złożone przez przełożonego"],
    ],
    przelozony: [
      ["home", "Start", "home", "Kto czeka na ocenę"],
      ["evals", "Oceny", "clip", "Przygotuj ocenę krok po kroku"],
      ["month", "Miesiąc", "msg", "Krótka rozmowa miesięczna i dowody z miesiąca – bez punktacji"],
      ["evidence", "Dowody", "book", "Obserwacje przy wskaźnikach: sytuacja, działanie, rezultat"],
      ["summary", "Zestawienie", "scale", "Liczby dowodów, daty i rozkład poziomów – bez średniej i bez sugestii wyniku"],
      ["results", "Wyniki", "chart", "Obraz zespołu bez ocen indywidualnych"],
      ["log", "Dziennik", "lock", "Kto i kiedy działał w systemie"],
    ],
  };
  const SUB = {
    pracownik: "Pracownik",
    przelozony: "Przełożony",
  };

  const S = { user: null, ai: { ok: false }, dash: null, evals: [], goals: [], view: "home", cur: null, readEval: null, mandB: [], mandC: [], maxExtra: 3,
    evFilter: { employeeId: "", competency: "", indicator: "", from: "", to: "" }, evidence: [],
    month: { employeeId: "", month: new Date().toISOString().slice(0, 7) }, monthData: null,
    sum: { employeeId: "", from: "", to: "" } };

  // ---------- API ----------
  async function api(method, url, body) {
    const opt = { method, credentials: "same-origin", headers: {} };
    if (method !== "GET") { opt.headers["content-type"] = "application/json"; opt.body = JSON.stringify(body ?? {}); }
    let r;
    try { r = await fetch(url, opt); }
    catch (_) { const e = new Error("Brak połączenia z serwerem. Uruchom w terminalu: node server.mjs i otwórz http://localhost:8080"); e.status = 0; throw e; }
    let j = {}; try { j = await r.json(); } catch (_) {}
    if (r.status === 401 && url !== "/api/login") { S.user = null; renderLogin(); throw new Error("Sesja wygasła. Zaloguj się ponownie."); }
    if (!r.ok) { const e = new Error(j.error || "Wystąpił błąd."); e.data = j; e.status = r.status; throw e; }
    return j;
  }
  const toast = msg => {
    document.querySelectorAll(".toast").forEach(t => t.remove());
    const t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); t.textContent = msg;
    document.body.appendChild(t); setTimeout(() => t.remove(), 2800);
  };
  const normEvals = list => list.map(e => ({ id: e.id, typ: e.typ, status: e.status, periodFrom: e.period_from, periodTo: e.period_to, employeeId: e.employee_id }));

  // ---------- Elementy wspólne ----------
  const pill = st => `<span class="tag ${STATUS[st][1]}">${STATUS[st][0]}</span>`;
  const bar = (v, max = 9) => `<div class="bar" style="--w:${v === null || v === undefined ? 0 : Math.min(100, v / max * 100).toFixed(0)}%"><i></i></div>`;
  const isMand = (k, typ) => { const L = (typ || (S.cur && S.cur.typ)) === "C" ? S.mandC : S.mandB; return L.some(m => k.startsWith(m)); };
  const first = name => esc(String(name || "").replace(/ \(demo\)/, ""));
  function countUp(el) {
    const to = parseFloat(el.dataset.to); if (isNaN(to)) return;
    const dec = el.dataset.dec ? +el.dataset.dec : 0; const t0 = performance.now(); const dur = 800;
    const step = t => { const p = Math.min(1, (t - t0) / dur); el.textContent = (to * (1 - Math.pow(1 - p, 3))).toFixed(dec); if (p < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
  function animateIn(root = document) {
    requestAnimationFrame(() => {
      root.querySelectorAll(".bar").forEach(b => b.classList.add("on"));
      root.querySelectorAll(".radar .poly").forEach(p => p.classList.add("on"));
      root.querySelectorAll(".timeline .line").forEach(l => l.classList.add("on"));
      root.querySelectorAll("[data-to]").forEach(countUp);
    });
  }
  function radar(scores) {
    const items = Object.entries(scores).filter(([, v]) => v.avg !== null);
    if (items.length < 3) return `<p class="muted">Wykres pojawi się, gdy ocenionych będzie co najmniej 3 kompetencje.</p>`;
    const N = items.length, C = 150, R = 105;
    const pt = (i, r) => { const a = -Math.PI / 2 + i * 2 * Math.PI / N; return [C + r * Math.cos(a), C + r * Math.sin(a)]; };
    const rings = [0.33, 0.66, 1].map(f => `<polygon points="${items.map((_, i) => pt(i, R * f).join(",")).join(" ")}" fill="none" stroke="var(--ln)"/>`).join("");
    const axes = items.map((_, i) => { const [x, y] = pt(i, R); return `<line x1="${C}" y1="${C}" x2="${x}" y2="${y}" stroke="var(--ln)"/>`; }).join("");
    const poly = items.map(([, v], i) => pt(i, R * v.avg / 9).join(",")).join(" ");
    const labels = items.map(([k], i) => { const [x, y] = pt(i, R + 22); return `<text x="${x}" y="${y}" font-size="10" text-anchor="middle" fill="var(--mu)">${esc(nameOf(k).slice(0, 16))}</text>`; }).join("");
    return `<svg class="radar" viewBox="0 0 300 300" role="img" aria-label="Profil kompetencji">${rings}${axes}<polygon class="poly" points="${poly}" fill="rgba(44,111,209,.22)" stroke="var(--blue)" stroke-width="2"/>${labels}</svg>`;
  }
  const scoreBars = scores => Object.entries(scores).map(([k, v]) => `
    <div class="sb"><div class="row"><span class="sb-l">${compIc(k)}${esc(nameOf(k))}</span><span class="muted">${v.avg === null ? "brak" : fmt(v.avg) + " pkt"}</span></div>${bar(v.avg)}</div>`).join("");
  // Ocena cząstkowa per kompetencja: B/C – przyznana przez oceniającego (data.partials); pierwsza ocena – średnia wskaźników
  function scoreLocal(c) {
    const out = {}, s2 = isS2(c.typ, c.data);
    MODEL.filter(m => c.criteria.includes(m.k)).forEach(m => {
      const pts = m.w.map((_, wi) => c.ratings[m.k + "|" + wi]).filter(r => r && r.lvl !== "none" && r.lvl !== undefined)
        .map(r => c.typ === "pierwsza" ? PTS3[r.lvl - 1] : PTS5[r.lvl]);
      const ind = pts.length ? pts.reduce((a, b) => a + b, 0) / pts.length : null;
      const p = Number(c.data && c.data.partials && c.data.partials[m.k] && c.data.partials[m.k].pts);
      out[m.k] = { avg: s2 ? (PTS5.includes(p) ? p : null) : ind, n: pts.length, total: m.w.length, dist: pts };
    });
    return out;
  }
  // Wynik oceny okresowej wyliczany z ocen cząstkowych (§ 11 ust. 4) – nie wybiera się go ręcznie
  function verdictLocal(scores) {
    const vals = Object.values(scores);
    if (!vals.length || vals.some(v => v.avg === null)) return { wynik: null, reasons: [] };
    const avg = vals.reduce((a, v) => a + v.avg, 0) / vals.length, reasons = [];
    if (avg <= 4) reasons.push(`ogólny poziom: ${levelFor(avg)}`);
    const low = vals.filter(v => v.avg <= 2).length;
    if (low) reasons.push(`ocena cząstkowa „znacznie poniżej oczekiwań” w ${low} kryt.`);
    return { wynik: reasons.length ? "negatywna" : "pozytywna", reasons, avg };
  }
  const distText = pts => { const n = {}; pts.forEach(p => { n[p] = (n[p] || 0) + 1; }); return Object.keys(n).sort((a, b) => a - b).map(p => `${n[p]}× ${p} pkt`).join(", ") || "brak ocenionych wskaźników"; };
  const timeline = st => {
    const s2 = st === "submitted" || st === "discussed", s3 = st === "discussed";
    const seg = (on, label) => `<div class="tl-seg"><div class="dot ${on ? "on" : ""}"></div><small>${label}</small></div>`;
    return `<div class="timeline">${seg(true, "Przygotowana")}<div class="line ${s2 ? "on" : ""}"><i></i></div>${seg(s2, "Złożona")}<div class="line ${s3 ? "on" : ""}"><i></i></div>${seg(s3, "Omówiona")}</div>`;
  };

  // ---------- Logowanie ----------
  function renderLogin(err = "") {
    $("#root").innerHTML = `
      <div class="login"><div class="login-main"><div class="login-card">
        <div class="brand"><div class="brandmark" aria-hidden="true">K</div><div><h1>Kompas Kompetencji</h1><div class="muted">Zaloguj się, aby przejść do panelu</div></div></div>
        <div class="demo-row" role="group" aria-label="Konta demonstracyjne">
          <button type="button" class="demo-btn" data-demo="przelozony" title="Wypełnij danymi przełożonego (demo)"><span aria-hidden="true">${KK_ICON("star")}</span><span>Demo: przełożony</span></button>
          <button type="button" class="demo-btn" data-demo="pracownik" title="Wypełnij danymi pracownika (demo)"><span aria-hidden="true">${KK_ICON("user")}</span><span>Demo: pracownik</span></button>
        </div>
        <form id="loginForm" novalidate>
          <label class="f" for="lEmail">Adres e-mail</label>
          <input id="lEmail" type="email" autocomplete="username" required>
          <label class="f" for="lPass">Hasło</label>
          <input id="lPass" type="password" autocomplete="current-password" required>
          <button class="btn w" style="margin-top:16px" type="submit">Zaloguj się</button>
          ${err ? `<div class="err" role="alert">${esc(err)}</div>` : ""}
        </form>
        <p class="note">Konta demonstracyjne są opisane w README. Nie używaj prawdziwych danych osobowych w wersji testowej.</p>
      </div></div>${footer("foot-login")}</div>`;
    const DEMO = { przelozony: "przelozony@demo.kk", pracownik: "pracownik1@demo.kk" };
    document.querySelectorAll("[data-demo]").forEach(b => b.addEventListener("click", () => {
      $("#lEmail").value = DEMO[b.dataset.demo]; $("#lPass").value = "Demo-kompas-2026!"; $("#lPass").focus();
    }));
    $("#loginForm").addEventListener("submit", async e => {
      e.preventDefault();
      try {
        const j = await api("POST", "/api/login", { email: $("#lEmail").value, password: $("#lPass").value });
        S.user = j.user; S.view = "home"; await load(); render();
      } catch (ex) { renderLogin(ex.message); }
    });
  }
  function footer(extra = "") {
    return `<footer class="foot-gov ${extra}"><div class="logos">
      <img src="app/assets/logo-mc.png" alt="Ministerstwo Cyfryzacji">
      <img src="app/assets/logo-kk.svg" alt="Kompas Kompetencji 2027"></div>
      <small>Prototyp · Kompas Kompetencji 2027</small></footer>`;
  }

  // ---------- Dane ----------
  async function refreshData() {
    S.dash = await api("GET", "/api/dashboard");
    if (S.user.role === "pracownik") S.goals = S.dash.goals || [];
    S.evals = normEvals((await api("GET", "/api/evals")).evals);
  }
  async function load() {
    const me = await api("GET", "/api/me");
    S.user = me.user; S.ai = me.ai;
    const m = await fetch("/api/model").then(r => r.json()); S.mandB = m.mandB || []; S.mandC = m.mandC || []; S.maxExtra = m.maxExtra || 3;
    await refreshData();
  }

  // ---------- Powłoka: sticky menu boczne (desktop) + dolna nawigacja (mobile) ----------
  function shell(content, navView, title, sub, opts = {}) {
    const u = S.user, pages = PAGES[u.role];
    const aiPill = S.ai.ok ? `<span class="pill on" title="Model lokalny: ${esc(S.ai.model)}">AI lokalnie</span>` : `<span class="pill off" title="Uruchom Ollama, aby włączyć AI">Tryb reguł</span>`;
    const navBtns = pages.map(([v, t, i]) => `<button data-nav="${v}" ${navView === v ? 'aria-current="page"' : ""}><span class="ic" aria-hidden="true">${KK_ICON(i)}</span><span class="lbl">${t}</span></button>`).join("");
    return `
      <div class="app">
        <a class="skip" href="#view">Przejdź do treści</a>
        <aside class="side" aria-label="Menu główne">
          <div class="brand"><img class="side-logo" src="app/assets/logo-kk.svg" alt="Kompas Kompetencji 2027" width="200" height="37"></div>
          <nav class="side-nav">${navBtns}</nav>
          <div class="foot">
            <div class="who-row">${avatar(u.avatar, u.name)}<div class="who"><b>${first(u.name)}</b><br><small class="muted">${esc(u.position || "")}</small></div></div>
            ${aiPill}
            <button class="btn sm g" data-act="logout">Wyloguj</button>
          </div>
        </aside>
        <div class="col">
          <header class="top">
            <div class="brandmark" aria-hidden="true">K</div>
            <div class="top-t"><div class="ttl">${esc(title)}</div><div class="sub">${esc(sub)}</div></div>
            <span class="spacer"></span>${aiPill}
            <button class="btn sm g hdr-logout" data-act="logout" aria-label="Wyloguj">⎋</button>
          </header>
          <main class="view" id="view">
            ${opts.hidePageHead ? "" : `<div class="page-h"><h1>${esc(title)}</h1><p class="why">${esc(sub)}</p></div>`}
            ${content}
          </main>
          ${footer()}
          <nav class="bottom" aria-label="Nawigacja mobilna" style="grid-template-columns:repeat(${pages.length},1fr)">${navBtns}</nav>
        </div>
      </div>`;
  }

  function render() {
    if (!S.user) return renderLogin();
    const root = $("#root");
    const u = S.user;
    let html = "", navView = S.view, title = "", sub = "", opts = {};
    if (S.view === "wizard") { navView = "evals"; ({ html, title, sub, opts } = wizardPage()); }
    else if (S.view === "evalView") { navView = "evals"; title = "Podgląd oceny"; sub = "Tylko do odczytu"; html = evalReadPage(); }
    else {
      const p = PAGES[u.role].find(x => x[0] === S.view) || PAGES[u.role][0];
      navView = p[0]; title = p[1]; sub = p[3];
      html = u.role === "pracownik" ? empPage(S.view) : mgrPage(S.view);
    }
    root.innerHTML = shell(html, navView, title, sub, opts);
    bindShell();
    animateIn(root);
    if (S.view === "log") loadLog();
    if (S.view === "evidence") { bindEvidencePage(); loadEvidence(); if (u.role === "pracownik") loadEmployeeExtras(); }
    if (S.view === "month") { bindMonthPage(); loadMonth(); }
    if (S.view === "summary") { bindSummaryPage(); loadSummary(); }
    if (S.view === "evalView" && S.readEval) loadSigs(S.readEval.id, S.readEval.status);
    if (S.view === "wizard" && S.cur && S.cur.status !== "draft") loadSigs(S.cur.id, S.cur.status);
    if (S.view === "wizard") bindWizard();
  }
  function go(view) {
    S.view = view;
    if (view === "wizard" || view === "evalView") return render();
    refreshData().then(render).catch(e => toast(e.message));
    window.scrollTo(0, 0);
  }
  function bindShell() {
    document.querySelectorAll("[data-nav]").forEach(b => b.addEventListener("click", () => go(b.dataset.nav)));
    document.querySelectorAll("[data-act]").forEach(b => b.addEventListener("click", e => act(b.dataset.act, b, e)));
    document.querySelectorAll("[data-go-eval]").forEach(b => b.addEventListener("click", () => openWizard(+b.dataset.goEval).catch(e => toast(e.message))));
  }

  // ---------- Pracownik ----------
  function empPage(v) {
    const d = S.dash;
    if (v === "home") {
      const goals = S.goals, openGoals = goals.filter(g => !g.done).length;
      const last = d.evals[0];
      let next;
      if (!goals.length) next = { t: "Dodaj pierwszy cel SMART", s: "Cel pomoże Ci i przełożonemu zobaczyć, dokąd chcesz dojść.", btn: "Dodaj cel", go: "goals" };
      else if (last && last.status === "submitted") next = { t: "Twoja ocena jest złożona", s: "Przejrzyj ją przed rozmową z przełożonym.", btn: "Zobacz ocenę", go: "evals" };
      else if (last && last.status === "discussed") next = { t: "Rozmowa za Tobą – zajrzyj do planu rozwoju", s: "Wnioski rozwojowe są w profilu.", btn: "Mój profil", go: "profile" };
      else next = { t: "Sprawdź swoje cele", s: "Zaktualizuj postęp, zanim przyjdzie czas na ocenę.", btn: "Otwórz cele", go: "goals" };
      return `
        <section class="next card anim"><div class="next-ic" aria-hidden="true">${KK_ICON("arrow")}</div>
          <div><h2>${esc(next.t)}</h2><p class="muted">${esc(next.s)}</p></div>
          <button class="btn" data-nav="${next.go}">${esc(next.btn)}</button></section>
        <div class="kpis">
          <div class="kpi"><b data-to="${d.evals.length}" data-dec="0">0</b><span>Złożone oceny</span></div>
          <div class="kpi"><b data-to="${openGoals}" data-dec="0">0</b><span>Cele w toku</span></div>
          <div class="kpi"><b>${last ? pill(last.status) : "—"}</b><span>Status ostatniej oceny</span></div>
        </div>
        <div class="card"><h2>Gdzie jesteś w procesie</h2>${last ? timeline(last.status) : `<p class="muted">Gdy przełożony przygotuje ocenę, zobaczysz tu jej postęp.</p>`}
          <p class="muted">Ocena opisuje zachowania z okresu, a nie Twoją osobę. Masz prawo zapoznać się z nią przed rozmową.</p></div>`;
    }
    if (v === "profile") {
      const sc = d.latestScores || {};
      const items = Object.entries(sc).filter(([, x]) => x.avg !== null).sort((a, b) => a[1].avg - b[1].avg);
      return `
        <div class="grid two">
          <div class="card"><h2>Profil kompetencji</h2><p class="muted">Średnie z ostatniej złożonej oceny. Im dalej od środka, tym mocniejsza kompetencja.</p>${radar(sc)}</div>
          <div class="card"><h2>Obszary do rozwoju</h2>${items.length ? scoreBars(Object.fromEntries(items.slice(0, 5))) : `<p class="muted">Brak danych. Pojawią się po złożeniu oceny.</p>`}</div>
        </div>
        <div class="grid two">
          <div class="card"><h2>Plan rozwoju z oceny</h2><p>${d.latestDev ? esc(d.latestDev) : `<span class="muted">Plan pojawi się po omówieniu oceny.</span>`}</p></div>
          <div class="card"><h2>Asystent rozwoju</h2>
            <p class="muted">Propozycje działań SMART na podstawie Twoich celów i obszarów do rozwoju. Decyzję podejmujesz Ty i przełożony.</p>
            <button class="btn" data-act="aiDev" id="aiDevBtn">Zapytaj asystenta</button>
            <div id="aiDevOut"></div></div>
        </div>`;
    }
    if (v === "goals") {
      const list = S.goals.map(g => `
        <div class="goal ${g.done ? "is-done" : ""}">
          <div class="row"><b>${esc(g.s)}</b>${g.done ? '<span class="tag ok">zrealizowany</span>' : '<span class="tag info">w toku</span>'}</div>
          <div class="muted">Miara: ${esc(g.m)} · Termin: ${esc(g.t)}</div>
          <div class="row" style="margin-top:8px"><label class="muted" for="p${g.id}">Postęp <b id="pv${g.id}">${g.progress}</b>%</label>
            <input id="p${g.id}" type="range" min="0" max="100" step="5" value="${g.progress}" data-goal="${g.id}" class="range"></div>
          ${bar(g.progress, 100)}
          <button class="btn sm g" data-act="toggleGoal" data-id="${g.id}" data-done="${g.done ? 0 : 1}">${g.done ? "Cofnij" : "Oznacz jako zrealizowany"}</button>
        </div>`).join("") || `<p class="muted">Nie masz jeszcze celów. Dodaj pierwszy – najlepiej taki, który da się zmierzyć.</p>`;
      return `<div class="row" style="margin-bottom:12px"><span class="muted">Cele SMART: konkretny, mierzalny, osiągalny, istotny, z terminem.</span>
        <button class="btn" data-act="addGoal">+ Nowy cel</button></div>
        <div class="card">${list}</div>`;
    }
    if (v === "evidence") return evidencePage(false);
    // evals
    return evalsList(false);
  }
  function evalsList(isMgr) {
    const names = Object.fromEntries((S.dash.team || []).map(t => [t.id, t.name]));
    if (!S.evals.length) return `<div class="card"><p class="muted">Brak ocen do wyświetlenia.</p></div>`;
    const rows = S.evals.map(e => {
      const edit = isMgr && e.status === "draft";
      return `<tr><td>${esc(TYP[e.typ])}</td>${isMgr ? `<td>${first(names[e.employeeId])}</td>` : ""}
        <td>${esc(e.periodFrom || "")} – ${esc(e.periodTo || "")}</td><td>${pill(e.status)}</td>
        <td style="text-align:right">${edit ? actBtn("edit", "Dokończ", `data-act="openEval" data-id="${e.id}"`) : actBtn("eye", "Podgląd", `data-act="readEval" data-id="${e.id}"`)}</td></tr>`;
    }).join("");
    return `<div class="card"><div style="overflow-x:auto"><table class="table"><thead><tr><th scope="col">Rodzaj</th>${isMgr ? "<th>Pracownik</th>" : ""}<th>Okres</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  }

  // ---------- Przełożony ----------
  function mgrPage(v) {
    const d = S.dash, c = d.counts;
    if (v === "home") {
      const todo = d.team.filter(t => t.status === "none" || t.status === "draft");
      const toDiscuss = d.team.filter(t => t.status === "submitted");
      const next = todo.length ? `Do przygotowania: ${todo.length}` : toDiscuss.length ? `Do omówienia: ${toDiscuss.length}` : "Wszystkie oceny są w porządku";
      const rows = d.team.map(t => `
        <tr><td><div class="who-row">${avatar(t.avatar, t.name)}<div><b>${first(t.name)}</b><div class="muted">${esc(t.position || "")}</div></div></div></td>
          <td>${t.typ ? esc(TYP[t.typ]) : "—"}</td><td style="white-space:nowrap">${pill(t.status)}</td>
          <td style="text-align:right">${t.status === "none"
            ? actBtn("plus", "Utwórz ocenę", `data-act="newEval" data-emp="${t.id}"`, "")
            : t.status === "draft" ? actBtn("edit", "Dokończ", `data-act="openEval" data-id="${t.evalId}"`)
            : t.status === "submitted" ? actBtn("msg", "Omów", `data-act="openEval" data-id="${t.evalId}"`)
            : actBtn("eye", "Otwórz", `data-act="openEval" data-id="${t.evalId}"`)}</td></tr>`).join("");
      return `
        <section class="next card anim"><div class="next-ic" aria-hidden="true">${KK_ICON("arrow")}</div>
          <div><h2>${esc(next)}</h2><p class="muted">Zacznij od oceny, która ma najbliższy termin. Kreator poprowadzi Cię krok po kroku.</p></div>
          <button class="btn" data-nav="evals">Przejdź do ocen</button></section>
        ${d.alerts && d.alerts.length ? `<div class="card" role="region" aria-label="Terminy i sprawy do załatwienia"><h2>Terminy i sprawy do załatwienia</h2><ul class="c">${d.alerts.map(x => `<li><b>${first(x.name)}</b> – ${esc(x.text)} <button class="btn sm g" data-act="openEval" data-id="${x.evalId}">Otwórz</button></li>`).join("")}</ul></div>` : ""}
        <div class="kpis">
          <div class="kpi"><b data-to="${d.team.length}">0</b><span>Pracownicy w zespole</span></div>
          <div class="kpi"><b data-to="${c.none + c.draft}">0</b><span>Do przygotowania</span></div>
          <div class="kpi"><b data-to="${c.submitted}">0</b><span>Złożone</span></div>
          <div class="kpi"><b data-to="${c.discussed}">0</b><span>Omówione</span></div>
        </div>
        <div class="card"><div class="row"><h2>Zespół</h2><button class="btn sm" data-act="addEmp">+ Dodaj pracownika</button></div>
          <div style="overflow-x:auto"><table class="table"><thead><tr><th scope="col">Pracownik</th><th>Ocena</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
    }
    if (v === "results") {
      const agg = d.aggregate;
      const body = agg.suppressed
        ? `<div class="note warn">Wyniki zbiorcze pokazujemy od ${agg.kMin} złożonych ocen (obecnie ${agg.n}). To chroni prywatność pracowników.</div>`
        : `<p class="muted">Średnie z ${agg.n} ocen. Widok zbiorczy: nie pokazuje wyników pojedynczych osób.</p>${agg.competencies.map(x => `<div class="sb"><div class="row"><span class="sb-l">${compIc(x.k)}${esc(nameOf(x.k))}</span><span class="muted">${fmt(x.avg)} pkt</span></div>${bar(x.avg)}</div>`).join("")}`;
      return `<div class="grid two">
        <div class="card"><h2>Wyniki zespołu</h2>${body}</div>
        <div class="card"><h2>Jak czytać ten widok</h2>
          <ul class="c"><li>Kompetencje posortowane od najsłabszej. To punkt startowy do rozmów, nie wyrok.</li>
          <li>Zbiorcze wyniki służą do planowania szkoleń i mentoringu.</li>
          <li>Decyzje dotyczące pojedynczej osoby podejmuje przełożony, w rozmowie z tą osobą.</li></ul></div></div>`;
    }
    if (v === "evidence") return evidencePage(true);
    if (v === "month") return monthPage();
    if (v === "summary") return summaryPage();
    return evalsList(true);
  }

  // ---------- Dowody: obserwacje przy wskaźnikach (sytuacja – działanie – rezultat) ----------
  const IND = MODEL.flatMap(c => c.w.map((w, wi) => ({ key: c.k + "|" + wi, k: c.k, wi, text: w.w.replace(/\n/g, " ") })));
  const indLabel = key => { const i = IND.find(x => x.key === key); return i ? `${nameOf(i.k)} – ${i.wi + 1}. ${i.text}` : key; };
  const indOptions = (sel, onlyK) => MODEL.filter(c => !onlyK || c.k === onlyK).map(c => `<optgroup label="${esc(nameOf(c.k))}">${c.w.map((w, wi) => {
    const key = c.k + "|" + wi; return `<option value="${esc(key)}" ${sel === key ? "selected" : ""}>${wi + 1}. ${esc(w.w.replace(/\n/g, " ").slice(0, 90))}</option>`; }).join("")}</optgroup>`).join("");
  const compOptions = sel => MODEL.map(c => `<option value="${esc(c.k)}" ${sel === c.k ? "selected" : ""}>${esc(nameOf(c.k))}</option>`).join("");
  const empOptions = sel => ((S.dash && S.dash.team) || []).map(t => `<option value="${t.id}" ${+sel === t.id ? "selected" : ""}>${first(t.name)}</option>`).join("");
  const empName = id => first(((S.dash && S.dash.team) || []).find(t => t.id === +id)?.name || "");
  const safeLink = u => (/^https?:\/\//i.test(u || "") ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">link<span class="sr"> (otwiera się w nowej karcie)</span></a>` : "");
  function evidenceTable(list, { editable, showEmp }) {
    if (!list.length) return `<p class="muted">Brak dowodów dla wybranych filtrów.</p>`;
    return `<div style="overflow-x:auto"><table class="table"><caption class="sr">Dowody (${list.length})</caption><thead><tr><th scope="col">Data</th>${showEmp ? `<th scope="col">Pracownik</th>` : ""}<th scope="col">Wskaźnik</th><th scope="col">Sytuacja · działanie · rezultat</th><th scope="col">Artefakt</th>${editable ? `<th scope="col"><span class="sr">Akcje</span></th>` : ""}</tr></thead><tbody>
      ${list.map(e => `<tr><td style="white-space:nowrap">${esc(e.date)}</td>${showEmp ? `<td>${empName(e.employeeId)}</td>` : ""}<td>${esc(indLabel(e.indicator))}</td>
        <td><b>Sytuacja:</b> ${esc(e.situation)}<br><b>Działanie:</b> ${esc(e.action)}<br><b>Rezultat:</b> ${esc(e.result)}</td>
        <td>${esc(e.taskRef || "")} ${safeLink(e.link)}</td>${editable ? `<td style="text-align:right">${actBtn("edit", "Edytuj", `data-act="editEvidence" data-id="${e.id}" aria-label="Edytuj dowód z ${esc(e.date)}"`)}</td>` : ""}</tr>`).join("")}
      </tbody></table></div>`;
  }
  function evidencePage(isMgr) {
    const f = S.evFilter;
    return `<div class="card"><h2 id="evFiltH">Filtry</h2>
      <form id="evFilter" class="grid two" aria-labelledby="evFiltH" novalidate>
        ${isMgr ? `<div><label class="f" for="fEmp">Pracownik</label><select id="fEmp" name="employeeId"><option value="">Cały zespół</option>${empOptions(f.employeeId)}</select></div>` : ""}
        <div><label class="f" for="fComp">Kompetencja</label><select id="fComp" name="competency"><option value="">Wszystkie</option>${compOptions(f.competency)}</select></div>
        <div><label class="f" for="fInd">Wskaźnik</label><select id="fInd" name="indicator"><option value="">Wszystkie</option>${indOptions(f.indicator, f.competency)}</select></div>
        <div><label class="f" for="fFrom">Od</label><input id="fFrom" name="from" type="date" value="${esc(f.from)}"></div>
        <div><label class="f" for="fTo">Do</label><input id="fTo" name="to" type="date" value="${esc(f.to)}"></div>
        <div class="btns" style="justify-content:flex-start;align-self:end"><button class="btn" type="submit">Pokaż</button>
          ${isMgr ? `<button class="btn g" type="button" data-act="addEvidence">+ Dodaj dowód</button>` : ""}</div>
      </form></div>
      <div class="card"><h2>Dowody</h2><p class="muted">${isMgr ? "Opisz obserwowalne działanie i jego rezultat. Nie opisuj cech osoby." : "Obserwacje zapisane przez przełożonego. Masz do nich wgląd w każdej chwili."}</p>
        <div id="evList" aria-live="polite"><p class="muted">Ładowanie…</p></div></div>
      ${isMgr ? "" : `<div class="card"><h2>Feedback o rezultatach zadań</h2><div id="fbMine"><p class="muted">Ładowanie…</p></div></div>
        <div class="card"><h2>Rozmowy miesięczne</h2><div id="ciMine"><p class="muted">Ładowanie…</p></div></div>
        <div class="card"><h2>Oceny cząstkowe kwartalne</h2><p class="muted">Przyznaje przełożony, z uzasadnieniem i wskazaniem dowodów.</p><div id="pqMine"><p class="muted">Ładowanie…</p></div></div>`}`;
  }
  const lvlTxt = l => (l ? `${l} pkt` : "bez poziomu");
  function feedbackList(list, editable) {
    if (!list.length) return `<p class="muted">Brak feedbacku.</p>`;
    return `<ul class="c">${list.map(f => `<li><span class="muted">${esc(f.date)} · ${esc(indLabel(f.indicator))} · ${esc(f.relationLabel)} · ${esc(lvlTxt(f.level))}</span><br>
      <b>Źródło:</b> ${esc(f.source)}<br>${esc(f.justification)}${editable ? ` ${actBtn("edit", "Edytuj", `data-act="editFeedback" data-id="${f.id}" aria-label="Edytuj feedback z ${esc(f.date)}"`)}` : ""}</li>`).join("")}</ul>`;
  }
  const checkinText = c => `<b>${esc(c.month)}</b> · ${c.status === "odbyty" ? `rozmowa ${esc(c.date || "")}` : "planowana"}${c.done ? `<br><b>Co zrobiono:</b> ${esc(c.done)}` : ""}${c.attention ? `<br><b>Co wymaga uwagi:</b> ${esc(c.attention)}` : ""}${c.goal ? `<br><b>Cel:</b> ${esc(c.goal)}` : ""}`;
  const partialText = p => `<b>${esc(p.quarter)}</b> · ${esc(nameOf(p.competency))}: <b>${p.pts} pkt</b> – ${esc(p.justification)} <span class="muted">(dowody: ${p.evidenceIds.length})</span>`;
  async function loadEmployeeExtras() {
    const put = (id, html) => { const el = $("#" + id); if (el) el.innerHTML = html; };
    try {
      const [fb, ci, pq] = await Promise.all([api("GET", "/api/feedback"), api("GET", "/api/checkins"), api("GET", "/api/partials")]);
      put("fbMine", feedbackList(fb.feedback, false));
      put("ciMine", ci.checkins.length ? `<ul class="c">${ci.checkins.map(c => `<li>${checkinText(c)}</li>`).join("")}</ul>` : `<p class="muted">Brak rozmów.</p>`);
      put("pqMine", pq.partials.length ? `<ul class="c">${pq.partials.map(p => `<li>${partialText(p)}</li>`).join("")}</ul>` : `<p class="muted">Brak ocen cząstkowych.</p>`);
    } catch (e) { put("fbMine", `<p class="muted">${esc(e.message)}</p>`); }
  }

  // ---------- Przegląd miesiąca (przełożony): check-in, dowody według wskaźników, feedback ----------
  const quarterOf = m => `${m.slice(0, 4)}-Q${Math.floor((+m.slice(5, 7) - 1) / 3) + 1}`;
  function monthPage() {
    const m = S.month;
    if (!m.employeeId && S.dash.team.length) m.employeeId = String(S.dash.team[0].id);
    return `<div class="card"><form id="monthForm" class="grid two" aria-label="Wybór pracownika i miesiąca" novalidate>
        <div><label class="f" for="mEmp">Pracownik</label><select id="mEmp" name="employeeId">${empOptions(m.employeeId)}</select></div>
        <div><label class="f" for="mMonth">Miesiąc</label><input id="mMonth" name="month" type="month" value="${esc(m.month)}" max="${new Date().toISOString().slice(0, 7)}"></div>
        <div class="btns" style="justify-content:flex-start"><button class="btn" type="submit">Pokaż</button></div>
      </form></div>
      <div id="monthBody" aria-live="polite"><p class="muted">Ładowanie…</p></div>`;
  }
  async function loadMonth() {
    const box = $("#monthBody"); if (!box) return;
    const m = S.month;
    try {
      const [d, pq] = await Promise.all([
        api("GET", `/api/month?employeeId=${encodeURIComponent(m.employeeId)}&month=${encodeURIComponent(m.month)}`),
        api("GET", `/api/partials?employeeId=${encodeURIComponent(m.employeeId)}&quarter=${quarterOf(m.month)}`)]);
      S.monthData = d; S.evidence = d.groups.flatMap(g => g.evidence); S.monthFeedback = d.feedback; S.monthPartials = pq.partials;
      const c = d.checkin || { done: "", attention: "", goal: "", date: "", status: "planowany" };
      const ro = "";
      box.innerHTML = `<div class="card"><h2 id="ciH">Rozmowa miesięczna (check-in)</h2>
          <p class="muted">Do 20 minut. Trzy pola i dowody z miesiąca. Bez punktacji i bez oceny osoby.</p>
          <form id="ciForm" aria-labelledby="ciH" novalidate>
            <label class="f" for="ciDone">Co zrobiono</label><textarea id="ciDone" maxlength="600" ${ro}>${esc(c.done)}</textarea>
            <label class="f" for="ciAtt">Co wymaga uwagi</label><textarea id="ciAtt" maxlength="600" ${ro}>${esc(c.attention)}</textarea>
            <label class="f" for="ciGoal">Jeden cel na kolejny miesiąc</label><input id="ciGoal" maxlength="600" value="${esc(c.goal)}" ${ro}>
            <div class="grid two"><div><label class="f" for="ciDate">Data rozmowy</label><input id="ciDate" type="date" value="${esc(c.date || "")}" max="${new Date().toISOString().slice(0, 10)}"></div>
              <div><span class="f" id="ciStL">Status</span><label class="choice"><input type="checkbox" id="ciStatus" aria-describedby="ciStL" ${c.status === "odbyty" ? "checked" : ""}><span>Rozmowa odbyta</span></label></div></div>
            <div id="ciErr" role="alert" class="err"></div>
            <div class="btns" style="justify-content:flex-start"><button class="btn" type="submit">${d.checkin ? "Zapisz zmiany" : "Zapisz check-in"}</button>
              <button class="btn g" type="button" data-act="aiCheckin">Zaproponuj pytania do rozmowy (AI)</button></div>
          </form><div id="aiCkOut" aria-live="polite"></div>
          <p class="note">Asystent widzi tylko nazwy wskaźników i liczbę dowodów. Nie zapisuje niczego i nie proponuje ocen.</p></div>
        <div class="card"><div class="row"><h2>Dowody z miesiąca (${d.evidenceCount})</h2>${actBtn("plus", "Dowód", `data-act="addEvidence" data-emp="${esc(m.employeeId)}" data-after="month"`, "")}</div>
          <p class="muted">Pokazujemy tylko wskaźniki z nowymi dowodami w tym miesiącu. Pozostałe są ukryte, żeby nie generować pustych ocen.</p>
          ${d.groups.length ? d.groups.map(g => `<div class="ind"><h3 class="h-comp">${compIc(g.competency)}${esc(nameOf(g.competency))}</h3><p class="muted">${esc(g.text.replace(/\n/g, " "))}</p>
            <ul class="c">${g.evidence.map(e => `<li><span class="muted">${esc(e.date)}</span> <b>Sytuacja:</b> ${esc(e.situation)} · <b>Działanie:</b> ${esc(e.action)} · <b>Rezultat:</b> ${esc(e.result)} ${safeLink(e.link)}
              ${actBtn("edit", "Edytuj", `data-act="editEvidence" data-id="${e.id}" data-after="month" aria-label="Edytuj dowód z ${esc(e.date)}"`)}</li>`).join("")}</ul></div>`).join("") : `<p class="muted">Brak dowodów w tym miesiącu.</p>`}</div>
        <div class="card"><div class="row"><h2>Feedback z miesiąca</h2>${actBtn("plus", "Feedback", `data-act="addFeedback"`, "")}</div>
          <p class="muted">Feedback dotyczy rezultatu zadania, nie osoby. Nie zapisujemy czasu pracy, obecności ani aktywności.</p>${feedbackList(d.feedback, true)}</div>
        <div class="card"><div class="row"><h2>Oceny cząstkowe – ${esc(quarterOf(m.month))}</h2>${actBtn("plus", "Ocena cząstkowa", `data-act="addPartial"`, "")}</div>
          <p class="muted">Przypisane do kwartału, nie do miesiąca. Przyznajesz je Ty, z uzasadnieniem i wskazaniem dowodów.</p>
          ${pq.partials.length ? `<ul class="c">${pq.partials.map(p => `<li>${partialText(p)} ${actBtn("edit", "Edytuj", `data-act="editPartial" data-id="${p.id}" aria-label="Edytuj ocenę cząstkową: ${esc(nameOf(p.competency))}"`)}</li>`).join("")}</ul>` : `<p class="muted">Brak ocen cząstkowych w tym kwartale.</p>`}</div>`;
      bindActs(box);
      $("#ciForm").addEventListener("submit", async e => {
        e.preventDefault();
        const body = { done: $("#ciDone").value, attention: $("#ciAtt").value, goal: $("#ciGoal").value, date: $("#ciDate").value, status: $("#ciStatus").checked ? "odbyty" : "planowany" };
        try {
          if (d.checkin) await api("PUT", `/api/checkins/${d.checkin.id}`, body);
          else await api("POST", "/api/checkins", { ...body, employeeId: +m.employeeId, month: m.month });
          toast("Zapisano check-in."); loadMonth();
        } catch (ex) { $("#ciErr").textContent = fieldErrors(ex); }
      });
    } catch (e) { box.innerHTML = `<div class="card"><p class="muted">${esc(e.message)}</p></div>`; }
  }
  function bindMonthPage() {
    const fm = $("#monthForm"); if (!fm) return;
    fm.addEventListener("submit", e => { e.preventDefault(); S.month.employeeId = $("#mEmp").value; S.month.month = $("#mMonth").value || S.month.month; loadMonth(); });
  }
  const RELATIONS = { przelozony: "przełożony bezpośredni", wspolpracownik: "współpracownik (przekazane przełożonemu)", odbiorca: "odbiorca rezultatu (przekazane przełożonemu)" };
  function feedbackModal(fb) {
    const v = fb || { indicator: "", source: "", level: null, justification: "", relation: "przelozony", date: new Date().toISOString().slice(0, 10) };
    openModal(`<h2 id="fbTitle">${fb ? "Edytuj feedback" : "Nowy feedback"}</h2>
      <p class="muted">Opisz rezultat konkretnego zadania. Nie oceniaj osoby. Nie zapisuj czasu pracy, obecności ani aktywności.</p>
      <form id="fbForm" novalidate>
        <label class="f" for="fbInd">Wskaźnik</label><select id="fbInd" required><option value="">Wybierz…</option>${indOptions(v.indicator)}</select>
        <label class="f" for="fbSrc">Źródło zdarzenia (zadanie, sprawa, artefakt)</label><input id="fbSrc" required maxlength="300" value="${esc(v.source)}">
        <label class="f" for="fbJust">Uzasadnienie (wymagane)</label><textarea id="fbJust" required minlength="10" maxlength="2000">${esc(v.justification)}</textarea>
        <label class="f" for="fbRel">Relacja autora do rezultatu</label><select id="fbRel">${Object.entries(RELATIONS).map(([k, l]) => `<option value="${k}" ${v.relation === k ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>
        <label class="f" for="fbLvl">Poziom (opcjonalnie)</label><select id="fbLvl"><option value="">bez poziomu</option>${PTS5.map((p, i) => `<option value="${p}" ${v.level === p ? "selected" : ""}>${p} pkt – ${LEVELS5[i]}</option>`).join("")}</select>
        <label class="f" for="fbDate">Data zdarzenia</label><input id="fbDate" type="date" required value="${esc(v.date)}">
        <div id="fbErr" role="alert" class="err"></div>
        <div class="btns"><button type="button" class="btn g" data-act="closeModal">Anuluj</button><button class="btn" type="submit">Zapisz</button></div>
      </form>`, () => {
      $("#fbForm").addEventListener("submit", async e => {
        e.preventDefault();
        const body = { indicator: $("#fbInd").value, source: $("#fbSrc").value, justification: $("#fbJust").value, relation: $("#fbRel").value, level: $("#fbLvl").value ? +$("#fbLvl").value : null, date: $("#fbDate").value };
        try {
          if (fb) await api("PUT", `/api/feedback/${fb.id}`, body); else await api("POST", "/api/feedback", { ...body, employeeId: +S.month.employeeId });
          closeModal(); toast("Zapisano feedback."); loadMonth();
        } catch (ex) { $("#fbErr").textContent = fieldErrors(ex); }
      });
    }, "fbTitle");
  }
  async function partialModal(pr) {
    const q = pr ? pr.quarter : quarterOf(S.month.month), y = +q.slice(0, 4), n = +q.slice(6);
    const from = `${y}-${String(n * 3 - 2).padStart(2, "0")}-01`, to = new Date(Date.UTC(y, n * 3, 0)).toISOString().slice(0, 10);
    const emp = pr ? pr.employeeId : S.month.employeeId;
    const evs = (await api("GET", `/api/evidence?employeeId=${encodeURIComponent(emp)}&from=${from}&to=${to}`)).evidence;
    const v = pr || { competency: "", pts: null, justification: "", evidenceIds: [] };
    const evBoxes = k => { const list = evs.filter(e => e.competency === k); return list.length ? list.map(e => `<label class="choice"><input type="checkbox" name="pqEv" value="${e.id}" ${v.evidenceIds.includes(e.id) ? "checked" : ""}><span><span class="muted">${esc(e.date)}</span> ${esc(e.action)} → ${esc(e.result)}</span></label>`).join("") : `<p class="muted">Brak dowodów z tego kryterium w kwartale. Najpierw dodaj dowód.</p>`; };
    openModal(`<h2 id="pqTitle">${pr ? "Edytuj ocenę cząstkową" : "Ocena cząstkowa za kwartał"} ${esc(q)}</h2>
      <p class="muted">Ocenę przyznajesz Ty w skali 1/3/5/7/9. System jej nie podpowiada. Wymagane są uzasadnienie i co najmniej jeden dowód z kwartału.</p>
      <form id="pqForm" novalidate>
        <label class="f" for="pqComp">Kryterium</label><select id="pqComp" required ${pr ? "disabled" : ""}><option value="">Wybierz…</option>${compOptions(v.competency)}</select>
        <fieldset class="plain"><legend class="f">Ocena cząstkowa</legend><div class="lv" role="radiogroup" aria-label="Ocena cząstkowa">
          ${PTS5.map((p, i) => `<label><input type="radio" name="pqPts" value="${p}" ${v.pts === p ? "checked" : ""}><span><b>${p} pkt</b> ${LEVELS5[i]}</span></label>`).join("")}</div></fieldset>
        <label class="f" for="pqJust">Uzasadnienie</label><textarea id="pqJust" required minlength="10" maxlength="2000">${esc(v.justification)}</textarea>
        <fieldset class="plain"><legend class="f">Dowody z kwartału</legend><div id="pqEvs">${v.competency ? evBoxes(v.competency) : `<p class="muted">Wybierz kryterium.</p>`}</div></fieldset>
        <div id="pqErr" role="alert" class="err"></div>
        <div class="btns"><button type="button" class="btn g" data-act="closeModal">Anuluj</button><button class="btn" type="submit">Zapisz</button></div>
      </form>`, () => {
      $("#pqComp").addEventListener("change", e => { $("#pqEvs").innerHTML = evBoxes(e.target.value); });
      $("#pqForm").addEventListener("submit", async e => {
        e.preventDefault();
        const pts = +(document.querySelector('input[name="pqPts"]:checked')?.value || 0);
        const body = { pts, justification: $("#pqJust").value, evidenceIds: [...document.querySelectorAll('input[name="pqEv"]:checked')].map(x => +x.value) };
        try {
          if (pr) await api("PUT", `/api/partials/${pr.id}`, body);
          else await api("POST", "/api/partials", { ...body, employeeId: +emp, quarter: q, competency: $("#pqComp").value });
          closeModal(); toast("Zapisano ocenę cząstkową."); loadMonth();
        } catch (ex) { $("#pqErr").textContent = fieldErrors(ex); }
      });
    }, "pqTitle");
  }
  async function loadEvidence() {
    const box = $("#evList"); if (!box) return;
    const q = new URLSearchParams(Object.entries(S.evFilter).filter(([, v]) => v)).toString();
    try { S.evidence = (await api("GET", "/api/evidence" + (q ? "?" + q : ""))).evidence; box.innerHTML = evidenceTable(S.evidence, { editable: S.user.role === "przelozony", showEmp: S.user.role === "przelozony" }); bindActs(box); }
    catch (e) { box.innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
  }
  function bindEvidencePage() {
    const fm = $("#evFilter"); if (!fm) return;
    fm.addEventListener("submit", e => { e.preventDefault(); const fd = new FormData(fm); Object.keys(S.evFilter).forEach(k => { S.evFilter[k] = fd.get(k) || ""; }); loadEvidence(); });
    $("#fComp")?.addEventListener("change", e => { $("#fInd").innerHTML = `<option value="">Wszystkie</option>${indOptions("", e.target.value)}`; });
  }
  const fieldErrors = ex => (ex.data && ex.data.fields ? Object.values(ex.data.fields).join(" ") : ex.message);
  // Formularz dowodu (dodanie / edycja). preset: { employeeId, indicator, date }, after: wywołanie po zapisie
  function evidenceModal(ev, preset = {}, after) {
    const v = ev || { employeeId: preset.employeeId || S.evFilter.employeeId || "", indicator: preset.indicator || "", date: preset.date || new Date().toISOString().slice(0, 10), situation: "", action: "", result: "", link: "", taskRef: "" };
    const fixedEmp = !!ev || !!preset.employeeId;
    openModal(`<h2 id="mTitle">${ev ? "Edytuj dowód" : "Nowy dowód"}</h2>
      <p class="muted">Jedna obserwacja przy jednym wskaźniku: sytuacja, działanie, rezultat. Zmiana trafia do dziennika.</p>
      <form id="evForm" novalidate>
        ${fixedEmp ? `<p><b>Pracownik:</b> ${empName(v.employeeId) || esc(S.cur?.empName || "")}</p>` : `<label class="f" for="eEmp">Pracownik</label><select id="eEmp" required><option value="">Wybierz…</option>${empOptions(v.employeeId)}</select>`}
        <label class="f" for="eDate">Data zdarzenia</label><input id="eDate" type="date" required value="${esc(v.date)}">
        <label class="f" for="eInd">Wskaźnik</label><select id="eInd" required><option value="">Wybierz…</option>${indOptions(v.indicator)}</select>
        <label class="f" for="eSit">Sytuacja</label><textarea id="eSit" required maxlength="1000">${esc(v.situation)}</textarea>
        <label class="f" for="eAct">Działanie</label><textarea id="eAct" required maxlength="1000">${esc(v.action)}</textarea>
        <label class="f" for="eRes">Rezultat</label><textarea id="eRes" required maxlength="1000">${esc(v.result)}</textarea>
        <label class="f" for="eLink">Link do artefaktu (opcjonalnie)</label><input id="eLink" type="url" maxlength="500" value="${esc(v.link || "")}" placeholder="https://">
        <label class="f" for="eTask">ID zadania lub artefaktu (opcjonalnie)</label><input id="eTask" maxlength="100" value="${esc(v.taskRef || "")}">
        <div id="evErr" role="alert" class="err"></div>
        <div class="btns"><button type="button" class="btn g" data-act="closeModal">Anuluj</button><button class="btn" type="submit">Zapisz</button></div>
      </form>`, () => {
      $("#evForm").addEventListener("submit", async e => {
        e.preventDefault();
        const body = { date: $("#eDate").value, indicator: $("#eInd").value, situation: $("#eSit").value, action: $("#eAct").value, result: $("#eRes").value, link: $("#eLink").value.trim(), taskRef: $("#eTask").value };
        try {
          if (ev) await api("PUT", `/api/evidence/${ev.id}`, body);
          else await api("POST", "/api/evidence", { ...body, employeeId: +(fixedEmp ? v.employeeId : $("#eEmp").value) });
          closeModal(); toast(ev ? "Zapisano zmiany dowodu." : "Dodano dowód.");
          if (after) await after(); else loadEvidence();
        } catch (ex) { $("#evErr").textContent = fieldErrors(ex); }
      });
    }, "mTitle");
  }
  // Dowody przy wskaźniku w kreatorze oceny (okres oceny)
  function evidenceMini(indKey) {
    const c = S.cur, list = (c.evidence || []).filter(e => e.indicator === indKey);
    const add = c.status === "draft" ? `<button type="button" class="btn sm g" data-act="addEvidence" data-ind="${esc(indKey)}">+ Dowód</button>` : "";
    return `<div class="ev-mini"><div class="row"><span class="muted">Dowody z okresu oceny: <b>${list.length}</b></span>${add}</div>
      ${list.length ? `<ul class="c">${list.slice(0, 5).map(e => `<li><span class="muted">${esc(e.date)}</span> ${esc(e.action)} → ${esc(e.result)}</li>`).join("")}${list.length > 5 ? `<li class="muted">…i ${list.length - 5} więcej</li>` : ""}</ul>` : c.typ !== "pierwsza" ? `<p class="muted">Brak dowodu. Przed złożeniem dodaj dowód albo zaznacz „Brak podstaw do oceny”.</p>` : ""}</div>`;
  }
  async function refreshWizardEvidence() {
    const c = S.cur; if (!c) return;
    const q = new URLSearchParams({ employeeId: c.employeeId, ...(c.periodFrom ? { from: c.periodFrom } : {}), ...(c.periodTo ? { to: c.periodTo } : {}) });
    try { c.evidence = (await api("GET", "/api/evidence?" + q)).evidence; } catch (_) { c.evidence = []; }
  }

  // ---------- Zestawienie (przełożony): liczby, daty, rozkład poziomów – bez średniej i bez sugestii wyniku ----------
  function summaryPage() {
    const f = S.sum;
    if (!f.employeeId && S.dash.team.length) f.employeeId = String(S.dash.team[0].id);
    return `<div class="card"><form id="sumForm" class="grid two" aria-label="Wybór pracownika i okresu" novalidate>
        <div><label class="f" for="sEmp">Pracownik</label><select id="sEmp">${empOptions(f.employeeId)}</select></div>
        <div><label class="f" for="sFrom">Od (domyślnie 12 miesięcy wstecz)</label><input id="sFrom" type="date" value="${esc(f.from)}"></div>
        <div><label class="f" for="sTo">Do</label><input id="sTo" type="date" value="${esc(f.to)}"></div>
        <div class="btns" style="justify-content:flex-start;align-self:end"><button class="btn" type="submit">Pokaż</button></div>
      </form></div>
      <div id="sumBody" aria-live="polite"><p class="muted">Ładowanie…</p></div>`;
  }
  function bindSummaryPage() {
    const fm = $("#sumForm"); if (!fm) return;
    fm.addEventListener("submit", e => { e.preventDefault(); Object.assign(S.sum, { employeeId: $("#sEmp").value, from: $("#sFrom").value, to: $("#sTo").value }); loadSummary(); });
  }
  const distChips = d => `<span class="dist">${PTS5.map(p => `<span title="${p} pkt">${p} pkt: <b>${d[p] || 0}</b></span>`).join("")}</span>`;
  async function loadSummary() {
    const box = $("#sumBody"); if (!box) return;
    const f = S.sum, q = new URLSearchParams({ employeeId: f.employeeId, ...(f.from ? { from: f.from } : {}), ...(f.to ? { to: f.to } : {}) });
    try {
      const s = await api("GET", "/api/summary?" + q);
      box.innerHTML = `<div class="kpis">
          <div class="kpi"><b>${s.evidenceTotal}</b><span>Dowody w okresie</span></div>
          <div class="kpi"><b>${s.checkins.done} / ${s.checkins.total}</b><span>Check-iny odbyte / zapisane</span></div>
          <div class="kpi"><b>${s.feedbackTotal}</b><span>Feedback</span></div>
          <div class="kpi"><b>${s.indicatorsWithoutEvidence}</b><span>Wskaźniki bez dowodów</span></div></div>
        <div class="card"><h2>Wskaźniki z dowodami lub feedbackiem</h2>
          <p class="muted">Okres ${esc(s.from)} – ${esc(s.to)}. To zestawienie faktów. Nie ma w nim średniej ani sugerowanego wyniku. Ocenę przyznajesz Ty.</p>
          ${s.indicators.length ? `<div style="overflow-x:auto"><table class="table"><caption class="sr">Zestawienie wskaźników</caption><thead><tr><th scope="col">Wskaźnik</th><th scope="col">Dowody</th><th scope="col">Pierwszy – ostatni</th><th scope="col">Check-iny z dowodami</th><th scope="col">Feedback (poziomy)</th></tr></thead><tbody>
            ${s.indicators.map(i => `<tr><td>${esc(indLabel(i.indicator))}</td><td>${i.evidenceCount}</td><td style="white-space:nowrap">${i.firstDate ? `${esc(i.firstDate)} – ${esc(i.lastDate)}` : "—"}</td><td>${i.checkinsWithEvidence}</td><td>${i.feedbackCount}${i.feedbackCount ? ` ${distChips(i.feedbackLevels)}` : ""}</td></tr>`).join("")}
            </tbody></table></div>` : `<p class="muted">Brak dowodów i feedbacku w okresie.</p>`}</div>
        <div class="card"><h2>Rozkład poziomów z ocen cząstkowych kwartalnych</h2>
          ${s.competencies.length ? s.competencies.map(c => `<div class="ind"><h3 class="h-comp">${compIc(c.competency)}${esc(nameOf(c.competency))}</h3>${distChips(c.distribution)}
            <p class="muted">${c.partials.map(p => `${esc(p.quarter)}: ${p.pts} pkt`).join(" · ")}</p></div>`).join("") : `<p class="muted">Brak ocen cząstkowych kwartalnych w okresie.</p>`}</div>
        <div class="card"><h2>Check-iny</h2>${s.checkins.months.length ? `<p>${s.checkins.months.map(m => `${esc(m.month)} (${m.status})`).join(" · ")}</p>` : `<p class="muted">Brak check-inów w okresie.</p>`}</div>`;
    } catch (e) { box.innerHTML = `<div class="card"><p class="muted">${esc(e.message)}</p></div>`; }
  }

  // ---------- Kreator oceny: strony Dalej/Wstecz ----------
  function wizSteps() {
    const c = S.cur;
    const comps = MODEL.filter(m => c.criteria.includes(m.k));
    return [{ id: "crit", label: "Kryteria" }, ...comps.map(m => ({ id: "c:" + m.k, label: nameOf(m.k), comp: m })), { id: "talk", label: "Rozmowa" }, { id: "sum", label: "Podsumowanie" }];
  }
  function wizardPage() {
    const c = S.cur; if (!c) return { html: `<p class="muted">Brak oceny.</p>`, title: "Ocena", sub: "" };
    const steps = wizSteps();
    const idx = Math.min(c.step, steps.length - 1); c.step = idx;
    const st = steps[idx];
    const pct = Math.round(idx / (steps.length - 1) * 100);
    const head = `<div class="card wiz-head">
      <div class="row"><div class="who-row">${avatar(c.empAvatar, c.empName, "av av-lg")}<div><h2>${esc(TYP[c.typ])}</h2><div class="muted">${first(c.empName)} · ${esc(c.periodFrom || "")} – ${esc(c.periodTo || "")}</div></div></div>
        <div class="row">${pill(c.status)}<span class="saved" id="saved"></span></div></div>
      <div class="wiz-progress"><div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Postęp kreatora oceny"><i style="width:${pct}%"></i></div><small>Krok ${idx + 1} z ${steps.length} · ${esc(st.label)}</small></div></div>`;
    let body;
    if (st.id === "crit") body = critStep();
    else if (st.id === "talk") body = talkStep();
    else if (st.id === "sum") body = sumStep();
    else body = rateOne(st.comp);
    const prevLabel = idx === 0 ? "Zamknij" : "Wstecz";
    const last = idx === steps.length - 1;
    const canNext = !(st.id === "crit" && !c.criteria.length);
    const nav = `<nav class="wiz-nav" aria-label="Nawigacja kreatora">
      <button class="btn g" data-wiz="${idx === 0 ? "close" : "prev"}">${KK_ICON("back")}<span>${prevLabel}</span></button>
      <span class="muted wiz-count">${idx + 1} / ${steps.length}</span>
      ${last ? "" : `<button class="btn" data-wiz="next" ${canNext ? "" : "disabled"}><span>Dalej</span>${KK_ICON("arrow")}</button>`}</nav>`;
    return { html: `<h1 class="sr">Kreator oceny</h1>` + head + body + nav, title: "Ocena", sub: st.id === "crit" ? "Wybierz, co będziemy oceniać" : st.id === "sum" ? "Sprawdź i złóż ocenę" : st.id === "talk" ? "Przygotuj rozmowę" : "Opisz zachowania, nie osobę", opts: { hidePageHead: true } };
  }
  function bindWizard() {
    document.querySelectorAll("[data-wiz]").forEach(b => b.addEventListener("click", () => {
      const a = b.dataset.wiz;
      if (a === "close") { S.cur = null; return go("evals"); }
      S.cur.step += a === "next" ? 1 : -1;
      render(); window.scrollTo(0, 0);
    }));
    document.removeEventListener("keydown", wizKeys);
    document.addEventListener("keydown", wizKeys);
  }
  function wizKeys(e) {
    if (S.view !== "wizard" || !S.cur) return document.removeEventListener("keydown", wizKeys);
    if (e.target.matches("input,textarea,select")) return;
    if (e.key === "ArrowRight") document.querySelector('[data-wiz="next"]')?.click();
    if (e.key === "ArrowLeft") document.querySelector('[data-wiz="prev"]')?.click();
  }
  function critStep() {
    const c = S.cur, isFirst = c.typ === "pierwsza";
    const extra = c.criteria.filter(k => !isMand(k, S.cur && S.cur.typ)).length;
    return `<div class="card"><h2>Które kompetencje oceniamy?</h2>
      <p class="muted">${isFirst ? "Wybierz kompetencje istotne dla stanowiska. Każdą ocenisz na osobnym kroku." : `Kryteria obowiązkowe są już zaznaczone. Dodatkowe możesz wybrać: ${extra} z ${S.maxExtra}.`}</p>
      <div class="crit-grid">${MODEL.map(m => {
        const dis = !isFirst && isMand(m.k, S.cur && S.cur.typ);
        return `<label class="choice"><input type="checkbox" data-crit="${esc(m.k)}" ${c.criteria.includes(m.k) ? "checked" : ""} ${dis ? "disabled" : ""}>
          <span class="crit-h">${compIc(m.k)}<span><b>${esc(nameOf(m.k))}</b>${!isFirst && isMand(m.k, S.cur && S.cur.typ) ? ' <span class="tag ok">obowiązkowe</span>' : ""}<br><span class="muted">${m.w.length} wskaźników</span></span></span></label>`;
      }).join("")}</div></div>`;
  }
  function rateOne(comp) {
    const c = S.cur, isFirst = c.typ === "pierwsza";
    const L = isFirst ? LEVELS3.map((l, i) => [l, PTS3[i], i + 1]) : LEVELS5.map((l, i) => [l, PTS5[i], i]);
    const done = comp.w.filter((_, wi) => c.ratings[comp.k + "|" + wi]).length;
    return `<div class="card"><div class="row"><h2 class="h-comp">${compIc(comp.k)}${esc(nameOf(comp.k))}</h2><span class="tag info">${done}/${comp.w.length} ocenione</span></div>
      <p class="muted">Wybierz poziom, który najlepiej opisuje to, co faktycznie obserwowałeś/aś. Dodaj jeden konkretny przykład: sytuacja, działanie, rezultat.</p></div>
      ${comp.w.map((w, wi) => {
        const id = comp.k + "|" + wi, r = c.ratings[id] || {};
        const exId = "ex" + comp.k.length + "_" + wi;
        return `<div class="card ind-card"><b>${wi + 1}. ${esc(w.w)}</b>
          <div class="lv" role="radiogroup" aria-label="${esc(w.w)}">
          ${L.map(([lab, pts, val]) => `<label><input type="radio" name="${esc(id)}" value="${val}" ${r.lvl === val ? "checked" : ""} data-rate="${esc(id)}"><span><b>${pts} pkt</b> ${lab}<br><span class="desc">${esc(w.p[isFirst ? val : val] || "")}</span></span></label>`).join("")}
          <label><input type="radio" name="${esc(id)}" value="none" ${r.lvl === "none" ? "checked" : ""} data-rate="${esc(id)}"><span>Brak podstaw do oceny</span></label>
          </div>
          <label class="f" for="${exId}">Przykład z okresu</label>
          <textarea id="${exId}" data-ex="${esc(id)}" placeholder="Sytuacja, działanie, rezultat">${esc(r.ex || "")}</textarea>
          ${evidenceMini(id)}</div>`;
      }).join("")}${isS2(c.typ, c.data) ? partialCard(comp) : ""}`;
  }
  // Ocena cząstkowa za kryterium – przyznaje oceniający (skala 1/3/5/7/9), system jej nie podpowiada
  function partialCard(comp) {
    const c = S.cur, sc = scoreLocal(c)[comp.k] || { dist: [] };
    const cur = Number(c.data.partials && c.data.partials[comp.k] && c.data.partials[comp.k].pts);
    const ro = c.status !== "draft" ? "disabled" : "";
    return `<div class="card ind-card"><h3 id="pc-${esc(comp.k.length)}">Ocena cząstkowa: ${esc(nameOf(comp.k))}</h3>
      <p class="muted">Ocenę cząstkową za kryterium przyznajesz Ty. Dla orientacji: poziomy wskaźników – ${esc(distText(sc.dist))}.</p>
      <div class="lv" role="radiogroup" aria-label="Ocena cząstkowa: ${esc(nameOf(comp.k))}">
      ${LEVELS5.map((lab, i) => `<label><input type="radio" name="partial-${esc(comp.k)}" value="${PTS5[i]}" data-partial="${esc(comp.k)}" ${cur === PTS5[i] ? "checked" : ""} ${ro}><span><b>${PTS5[i]} pkt</b> ${lab}</span></label>`).join("")}
      </div>${quarterlyHistory(comp.k)}</div>`;
  }
  // Kwartalne oceny cząstkowe z okresu oceny: tylko lista (bez średniej i bez podpowiedzi wyniku)
  function quarterlyHistory(k) {
    const list = (S.cur.quarterly || []).filter(p => p.competency === k);
    return list.length ? `<div class="ev-mini"><span class="muted">Oceny cząstkowe kwartalne w okresie oceny:</span><ul class="c">${list.map(p => `<li>${partialText(p)}</li>`).join("")}</ul></div>` : "";
  }
  function talkStep() {
    const c = S.cur;
    const sc = scoreLocal(c);
    const ranked = Object.entries(sc).filter(([, v]) => v.avg !== null).sort((a, b) => b[1].avg - a[1].avg);
    const top = ranked.slice(0, 2).map(([k]) => nameOf(k)).join(", ") || "—";
    const low = ranked.slice(-2).map(([k]) => nameOf(k)).join(", ") || "—";
    return `<div class="card"><h2>Przygotowanie do rozmowy</h2>
      <p class="muted">Rozmowa jest ważniejsza niż ocena. Zacznij od tego, co się udało, potem omów obszary do rozwoju.</p>
      <div class="grid two"><div class="note"><b>Zacznij od</b><br>${esc(top)}</div><div class="note warn"><b>Omów</b><br>${esc(low)}</div></div>
      <div class="btns" style="justify-content:flex-start;margin-top:14px">
        <button class="btn" data-act="aiTalk">Pytania do rozmowy (AI lokalnie)</button>
        <button class="btn g" data-act="aiFormal">Sprawdź język uzasadnień</button></div>
      <div id="aiOut">${c.aiText ? `<div class="ai-out">${esc(c.aiText)}</div><p class="muted">Źródło: ${c.aiSource === "ai" ? "model AI" : "reguły"}</p>` : ""}</div>
      <p class="note">Model działa na Twoim komputerze, dane nie opuszczają urządzenia. To propozycja do przemyślenia. Ocenę wystawiasz Ty.</p></div>`;
  }
  function sumStep() {
    const c = S.cur;
    const scores = scoreLocal(c);
    const rated = Object.values(scores).filter(v => v.avg !== null);
    // średnia ocen cząstkowych (§ 11 ust. 1) – wyświetlana w podsumowaniu oceny okresowej
    const overall = rated.length ? rated.reduce((a, v) => a + v.avg, 0) / rated.length : null;
    const miss = c.missing || [];
    const canSubmit = c.status === "draft" && miss.length === 0 && c.criteria.length > 0;
    const d = c.data, ro = c.status !== "draft" ? "disabled" : "";
    const form = `<div class="card"><h2>Rozmowa i wynik oceny</h2>
      <div class="grid two">
        <div><label class="f" for="fRozm">Data rozmowy oceniającej</label><input id="fRozm" type="date" data-field="rozmowa" value="${esc(d.rozmowa || "")}" ${ro}></div>
        <div><label class="f" for="fTerm">Termin sporządzenia oceny</label><input id="fTerm" type="date" data-field="terminOceny" value="${esc(d.terminOceny || "")}" ${ro}></div>
      </div>
      <label class="f" for="fUzas">Uzasadnienie oceny (obowiązkowe przy ocenie negatywnej)</label>
      <textarea id="fUzas" data-field="uzasadnienie" ${ro}>${esc(d.uzasadnienie || "")}</textarea>
      ${isS2(c.typ, d) ? verdictBox(scores) : `<fieldset style="border:0;padding:0;margin:12px 0 0"><legend class="f">${c.typ === "pierwsza" ? "Wynik pierwszej oceny" : "Ocena okresowa"}</legend>
        <label class="choice"><input type="radio" name="wynik" value="pozytywna" data-field="wynik" ${d.wynik === "pozytywna" ? "checked" : ""} ${ro}><span><b>Pozytywna</b></span></label>
        <label class="choice"><input type="radio" name="wynik" value="negatywna" data-field="wynik" ${d.wynik === "negatywna" ? "checked" : ""} ${ro}><span><b>Negatywna</b></span></label>
      </fieldset>`}</div>
      ${docLinks(c.id)}`;
    return form + `<div class="card"><h2>Podsumowanie</h2>
      <p>Średnia: <b data-to="${overall ?? 0}" data-dec="1">${overall === null ? "—" : fmt(overall)}</b> pkt</p>
      ${scoreBars(scores)}
      ${c.status === "draft" ? (miss.length
        ? `<div class="note warn"><b>Do uzupełnienia przed złożeniem (${miss.length}):</b><ul class="c">${miss.slice(0, 8).map(m => `<li>${esc(m)}</li>`).join("")}${miss.length > 8 ? `<li>…i ${miss.length - 8} więcej</li>` : ""}</ul></div>`
        : `<p><span class="tag ok">Kompletna – możesz złożyć</span></p>`) : ""}
      ${c.status === "draft" ? `<div class="btns" style="justify-content:flex-start"><button class="btn" data-act="submitEval" ${canSubmit ? "" : "disabled"}>Złóż ocenę</button></div>` : ""}
    </div>
    ${c.status === "submitted" ? `<div class="card"><h2>Po rozmowie</h2><p class="muted">Zapisz wnioski rozwojowe i oznacz ocenę jako omówioną.</p>
      <label class="f" for="devN">Wnioski rozwojowe</label><textarea id="devN">${esc(c.data.dev || "")}</textarea>
      <button class="btn" style="margin-top:12px" data-act="discussEval">Oznacz jako omówioną</button></div>` : ""}
    ${c.status !== "draft" ? `<div class="card" id="sigBox"><h2>Podpisy i zapoznanie</h2><p class="muted">Ładowanie…</p></div>` : ""}
    ${c.status === "discussed" ? `<div class="note">Ocena omówiona. Wnioski rozwojowe: ${esc(c.data.dev || "—")}</div>` : ""}`;
  }
  function verdictBox(scores) {
    const v = verdictLocal(scores);
    if (!v.wynik) return `<div class="note" role="status"><b>Ocena okresowa:</b> zostanie wyliczona po przyznaniu ocen cząstkowych we wszystkich kryteriach (§ 11 rozporządzenia).</div>`;
    return `<div class="note ${v.wynik === "negatywna" ? "warn" : ""}" role="status"><b>Ocena okresowa (wyliczona wg § 11): ${v.wynik.toUpperCase()}</b>
      <br>Średnia ocen cząstkowych ${fmt(v.avg)} pkt – ${esc(levelFor(v.avg))}.${v.reasons.length ? `<br>Podstawa oceny negatywnej (§ 11 ust. 4): ${esc(v.reasons.join("; "))}. Uzasadnienie jest obowiązkowe.` : ""}</div>`;
  }
  function docLinks(id) {
    const base = `/api/evals/${id}/document`;
    return `<div class="docs"><h3>Dokumenty</h3><p class="muted">Arkusz generowany z danych tej oceny. Podgląd i pobieranie w PDF lub XML.</p>
      <div class="btns" style="justify-content:flex-start">
        <a class="btn g" href="${base}?format=pdf&inline=1" target="_blank" rel="noopener">${KK_ICON("file")}<span>Podgląd PDF</span></a>
        <a class="btn g" href="${base}?format=pdf" download>${KK_ICON("file")}<span>Pobierz PDF</span></a>
        <a class="btn g" href="${base}?format=xml" download>${KK_ICON("file")}<span>Pobierz XML</span></a>
      </div></div>`;
  }
  function evalReadPage() {
    const e = S.readEval; if (!e) return `<p class="muted">Ładowanie…</p>`;
    const scores = scoreLocal({ criteria: e.data.criteria, ratings: e.data.ratings, typ: e.typ, data: e.data });
    const items = MODEL.filter(m => e.data.criteria.includes(m.k)).map(m => `
      <div class="card"><h3 class="h-comp">${compIc(m.k)}${esc(nameOf(m.k))}</h3>${m.w.map((w, wi) => { const r = e.data.ratings[m.k + "|" + wi]; return `<div class="ind"><b>${esc(w.w)}</b><div class="muted">${!r ? "nieocenione" : r.lvl === "none" ? "brak podstaw do oceny" : `${e.typ === "pierwsza" ? PTS3[r.lvl - 1] : PTS5[r.lvl]} pkt`}</div>${r?.ex ? `<div>${esc(r.ex)}</div>` : ""}</div>`; }).join("")}</div>`).join("");
    return `<div class="card"><div class="row"><h2>${esc(TYP[e.typ])}</h2>${pill(e.status)}</div>
      <p class="muted">Okres ${esc(e.period_from || "")} – ${esc(e.period_to || "")}${e.data.wynik ? ` · Ocena: <b>${esc(e.data.wynik)}</b>${e.data.wynikSource === "wyliczony" ? " (wyliczona wg § 11)" : ""}` : ""}</p>
      <div class="grid two"><div>${radar(scores)}</div><div>${scoreBars(scores)}</div></div></div>
      ${items}
      ${e.data.dev ? `<div class="card"><h2>Wnioski rozwojowe</h2><p>${esc(e.data.dev)}</p></div>` : ""}
      <div class="card" id="sigBox"><h2>Podpisy i zapoznanie</h2><p class="muted">Ładowanie…</p></div>
      <div class="card">${docLinks(e.id)}</div>
      <div class="btns"><button class="btn g" data-nav="evals">${KK_ICON("back")}<span>Wróć do listy</span></button></div>`;
  }

  // ---------- Zapis, AI, akcje ----------
  let saveTimer = null;
  function queueSave() {
    clearTimeout(saveTimer);
    const sv = $("#saved"); if (sv) sv.textContent = "Zapisywanie…";
    saveTimer = setTimeout(async () => {
      try {
        const c = S.cur;
        const r = await api("PUT", `/api/evals/${c.id}`, { data: c.data, periodFrom: c.periodFrom, periodTo: c.periodTo });
        c.missing = r.missing; const s2 = $("#saved"); if (s2) s2.textContent = "Zapisano";
      } catch (e) { const s2 = $("#saved"); if (s2) s2.textContent = "Nie zapisano"; toast(e.message); }
    }, 500);
  }
  async function openWizard(id) {
    const r = await api("GET", `/api/evals/${id}`);
    const e = r.eval;
    S.cur = { id: e.id, typ: e.typ, status: e.status, periodFrom: e.period_from, periodTo: e.period_to, employeeId: e.employee_id, evidence: [],
      empName: r.employee?.name || "", empAvatar: r.employee?.avatar || null, data: e.data, criteria: e.data.criteria || [], ratings: e.data.ratings || {},
      step: 0, missing: r.missing || [], aiText: "", aiSource: "" };
    S.maxExtra = 3;
    await refreshWizardEvidence();
    try { S.cur.quarterly = (await api("GET", `/api/partials?employeeId=${e.employee_id}${e.period_from ? `&from=${e.period_from}` : ""}${e.period_to ? `&to=${e.period_to}` : ""}`)).partials; } catch (_) { S.cur.quarterly = []; }
    S.view = "wizard"; render(); window.scrollTo(0, 0);
  }
  async function refreshMissing() { const r = await api("GET", `/api/evals/${S.cur.id}`); S.cur.missing = r.missing || []; }
  async function runAi(kind) {
    const out = $("#aiOut"); if (out) out.innerHTML = `<div class="ai-out">Model przygotowuje odpowiedź…</div>`;
    try {
      const r = await api("POST", kind === "talk" ? "/api/ai/talk" : "/api/ai/formal", { evalId: S.cur.id });
      S.cur.aiText = r.text; S.cur.aiSource = r.source; render();
    } catch (e) { toast(e.message); }
  }
  // Podpisy (mock) i zapoznanie z oceną – stan z serwera
  async function loadSigs(id, status) {
    const box = $("#sigBox"); if (!box) return;
    try {
      const r = await api("GET", `/api/evals/${id}/signatures`);
      const rows = r.signatures.map(g => `<tr><td>${g.role === "przelozony" ? "Podpis oceniającego" : "Zapoznanie ocenianego"}</td><td>${esc(g.name)}</td><td>${esc(g.signed_at.slice(0, 16).replace("T", " "))}</td><td><span class="tag ${g.valid && g.unchanged ? "ok" : "bad"}">${g.valid ? (g.unchanged ? "weryfikacja OK" : "treść zmieniona") : "błąd podpisu"}</span></td></tr>`).join("");
      const isMgr = S.user.role === "przelozony";
      const hasMgrSig = r.signatures.some(g => g.role === "przelozony");
      const ackDone = !!r.ackAt;
      const deadlinePassed = r.objectionDeadline && Date.now() > Date.parse(r.objectionDeadline);
      box.innerHTML = `<h2>Podpisy i zapoznanie</h2>
        <p class="muted">Podpis symulowany (mock) do czasu integracji z podpisem kwalifikowanym lub zaufanym.</p>
        ${rows ? `<div style="overflow-x:auto"><table class="table"><thead><tr><th scope="col">Rodzaj</th><th scope="col">Osoba</th><th scope="col">Czas</th><th scope="col">Weryfikacja</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="muted">Brak podpisów.</p>`}
        ${isMgr && status !== "draft" && !hasMgrSig ? `<div class="btns" style="justify-content:flex-start"><button class="btn" data-act="signEval" data-id="${id}">Podpisz ocenę (symulacja)</button></div>` : ""}
        ${!isMgr ? `<p><b>Zapoznanie:</b> ${ackDone ? esc(r.ackAt.slice(0, 10)) : "jeszcze nie"}${r.objectionDeadline ? ` · <b>Termin na sprzeciw:</b> ${esc(r.objectionDeadline.slice(0, 10))}` : ""}${r.objectionAt ? ` · <b>Sprzeciw złożono:</b> ${esc(r.objectionAt.slice(0, 10))}` : ""}</p>
          ${!ackDone ? `<div class="btns" style="justify-content:flex-start"><button class="btn" data-act="ackEval" data-id="${id}">Zapoznałem(-łam) się z oceną</button></div>` : ""}
          ${ackDone && !r.objectionAt && !deadlinePassed ? `<div class="btns" style="justify-content:flex-start"><button class="btn g" data-act="objectionEval" data-id="${id}">Złóż sprzeciw</button></div>` : ""}
          ${r.objectionAt ? `<p class="note warn">Sprzeciw został złożony. Przełożony rozpatrzy go zgodnie z procedurą.</p>` : ""}` : ""}`;
      box.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', e => act(b.dataset.act, b, e)));
      animateIn(box);
    } catch (e) { box.innerHTML = `<h2>Podpisy i zapoznanie</h2><p class="muted">${esc(e.message)}</p>`; }
  }
  async function loadLog() {
    const b = $("#logBody"); if (!b) return;
    try {
      const r = await api("GET", "/api/audit");
      b.innerHTML = `<p>Integralność dziennika (łańcuch skrótów SHA-256): <span class="tag ${r.chainOk ? "ok" : "bad"}">${r.chainOk ? "zgodny" : "naruszony od wpisu " + r.brokenAt}</span></p>`
        + (r.audit.length ? `<div style="overflow-x:auto"><table class="table"><thead><tr><th scope="col">Zdarzenie</th><th scope="col">Cel</th><th scope="col">Kiedy</th></tr></thead><tbody>${r.audit.map(a => `<tr><td>${esc(a.action)}</td><td>${esc(a.target || "")}</td><td>${esc(a.at)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">Brak wpisów.</p>`)
        + `<h2 style="margin-top:18px">Podpowiedzi AI (przejrzystość i nadzór)</h2><p class="muted">Każda podpowiedź AI jest zapisana i oznaczona. Nie zmienia ocen bez decyzji człowieka.</p>`
        + (r.ai.length ? `<div style="overflow-x:auto"><table class="table"><thead><tr><th scope="col">Rodzaj</th><th scope="col">Model</th><th scope="col">Źródło</th><th scope="col">Kiedy</th><th scope="col">Treść</th></tr></thead><tbody>${r.ai.map(x => `<tr><td>${esc(x.action)}</td><td>${esc(x.model || "")}</td><td>${x.source === "ai" ? "AI lokalnie" : "reguły"}</td><td>${esc(x.at)}</td><td>${esc(x.output || "")}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">Brak podpowiedzi AI.</p>`);
    } catch (e) { b.innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
  }
  const actions = {
    logout: async () => { await api("POST", "/api/logout").catch(() => {}); S.user = null; S.view = "home"; renderLogin(); },
    newEval: async (b) => {
      const emp = (S.dash.team || []).find(t => t.id === +b.dataset.emp);
      const typ = prompt("Rodzaj oceny: pierwsza, B lub C", "B");
      if (!typ || !["pierwsza", "B", "C"].includes(typ.trim())) return toast("Nieprawidłowy rodzaj oceny.");
      const from = prompt("Okres od (RRRR-MM-DD)", "2026-01-01"), to = prompt("Okres do (RRRR-MM-DD)", "2026-06-30");
      const r = await api("POST", "/api/evals", { employeeId: emp.id, typ: typ.trim(), periodFrom: from, periodTo: to });
      toast("Utworzono szkic oceny."); await openWizard(r.id);
    },
    openEval: b => openWizard(+b.dataset.id),
    readEval: async b => { const r = await api("GET", `/api/evals/${b.dataset.id}`); S.readEval = r.eval; S.view = "evalView"; render(); window.scrollTo(0, 0); },
    submitEval: async () => {
      if (!confirm("Złożyć ocenę? Po złożeniu nie będzie można jej edytować.")) return;
      try { await api("POST", `/api/evals/${S.cur.id}/submit`); S.cur.status = "submitted"; toast("Ocena złożona."); render(); }
      catch (e) { toast(e.message); if (e.data?.missing) { S.cur.missing = e.data.missing; render(); } }
    },
    discussEval: async () => {
      const dev = $("#devN")?.value || "";
      try { await api("POST", `/api/evals/${S.cur.id}/discuss`, { dev }); S.cur.status = "discussed"; S.cur.data.dev = dev; toast("Oznaczono jako omówioną."); render(); }
      catch (e) { toast(e.message); }
    },
    aiTalk: () => runAi("talk"),
    aiFormal: () => runAi("formal"),
    aiDev: async () => {
      const btn = $("#aiDevBtn"); btn.disabled = true; btn.textContent = "Myślę…";
      try { const r = await api("POST", "/api/ai/development", {}); $("#aiDevOut").innerHTML = `<div class="ai-out">${esc(r.text)}</div><p class="muted">Źródło: ${r.source === "ai" ? "model AI lokalnie" : "reguły"}</p>`; }
      catch (e) { toast(e.message); }
      btn.disabled = false; btn.textContent = "Zapytaj asystenta";
    },
    toggleGoal: async b => { await api("PATCH", `/api/goals/${b.dataset.id}`, { done: b.dataset.done === "1" }); await refreshData(); render(); },
    addGoal: () => openModal(`
      <h2>Nowy cel SMART</h2>
      <form id="goalForm" novalidate>
        <label class="f" for="gS">Konkretnie (Specific)</label><input id="gS" maxlength="200" required>
        <label class="f" for="gM">Mierzalnie (Measurable)</label><input id="gM" maxlength="200" required>
        <label class="f" for="gA">Osiągalnie (Achievable)</label><input id="gA" maxlength="200" required>
        <label class="f" for="gR">Istotnie (Relevant)</label><input id="gR" maxlength="200" required>
        <label class="f" for="gT">Termin (Time-bound)</label><input id="gT" type="date" required>
        <div class="btns"><button type="button" class="btn g" data-act="closeModal">Anuluj</button><button class="btn" type="submit">Dodaj cel</button></div>
      </form>`, () => {
      $("#goalForm").addEventListener("submit", async e => {
        e.preventDefault();
        const v = id => $("#" + id).value.trim();
        try { await api("POST", "/api/goals", { s: v("gS"), m: v("gM"), a: v("gA"), r: v("gR"), t: v("gT") }); closeModal(); toast("Dodano cel."); await refreshData(); render(); }
        catch (ex) { toast(ex.message); }
      });
    }),
    addEmp: () => openModal(`
      <h2>Nowy pracownik</h2><p class="muted">Konto zakłada przełożony. Hasło przekaż bezpiecznym kanałem.</p>
      <form id="empForm" novalidate>
        <label class="f" for="eName">Imię i nazwisko</label><input id="eName" required maxlength="120">
        <label class="f" for="eMail">E-mail służbowy</label><input id="eMail" type="email" required maxlength="200">
        <label class="f" for="ePos">Stanowisko</label><input id="ePos" maxlength="120">
        <label class="f" for="ePass">Hasło początkowe (min. 10 znaków)</label><input id="ePass" type="password" minlength="10" required autocomplete="new-password">
        <div class="btns"><button type="button" class="btn g" data-act="closeModal">Anuluj</button><button class="btn" type="submit">Dodaj</button></div>
      </form>`, () => {
      $("#empForm").addEventListener("submit", async e => {
        e.preventDefault();
        try { await api("POST", "/api/employees", { name: $("#eName").value, email: $("#eMail").value, position: $("#ePos").value, password: $("#ePass").value }); closeModal(); toast("Dodano pracownika."); await refreshData(); render(); }
        catch (ex) { toast(ex.message); }
      });
    }),
    closeModal: () => closeModal(),
    addEvidence: b => {
      if (S.view === "wizard" && S.cur) return evidenceModal(null, { employeeId: S.cur.employeeId, indicator: b.dataset.ind || "", date: S.cur.periodTo && S.cur.periodTo < new Date().toISOString().slice(0, 10) ? S.cur.periodTo : undefined },
        async () => { await refreshWizardEvidence(); await refreshMissing(); render(); });
      return evidenceModal(null, { employeeId: b.dataset.emp || "", indicator: b.dataset.ind || "" }, b.dataset.after === "month" ? () => loadMonth() : undefined);
    },
    addFeedback: () => feedbackModal(null),
    aiCheckin: async b => {
      const out = $("#aiCkOut"); b.disabled = true; out.innerHTML = `<div class="ai-out">Asystent przygotowuje pytania…</div>`;
      try { const r = await api("POST", "/api/ai/checkin", { employeeId: +S.month.employeeId, month: S.month.month }); out.innerHTML = `<div class="ai-out">${esc(r.text)}</div><p class="muted">Źródło: ${r.source === "ai" ? "model AI lokalnie" : "reguły"} · propozycja do przemyślenia</p>`; }
      catch (e) { out.innerHTML = ""; toast(e.message); }
      b.disabled = false;
    },
    editFeedback: b => { const f = (S.monthFeedback || []).find(x => x.id === +b.dataset.id); if (f) feedbackModal(f); },
    addPartial: () => partialModal(null),
    editPartial: b => { const p = (S.monthPartials || []).find(x => x.id === +b.dataset.id); if (p) return partialModal(p); },
    editEvidence: b => { const ev = (S.evidence || []).find(x => x.id === +b.dataset.id); if (ev) evidenceModal(ev, {}, b.dataset.after === "month" ? () => loadMonth() : undefined); },
    signEval: async b => {
      try { const r = await api("POST", `/api/evals/${b.dataset.id}/sign`); toast("Podpisano (symulacja)."); loadSigs(+b.dataset.id, S.cur?.status || S.readEval?.status); void r; }
      catch (e) { toast(e.message); }
    },
    ackEval: async b => {
      try { await api("POST", `/api/evals/${b.dataset.id}/acknowledge`); toast("Zapoznanie zarejestrowane."); loadSigs(+b.dataset.id, S.readEval?.status); }
      catch (e) { toast(e.message); }
    },
    objectionEval: b => openModal(`
      <h2>Sprzeciw wobec oceny</h2>
      <p class="muted">Sprzeciw można złożyć w terminie 7 dni od zapoznania się z oceną (art. 83 ust. 1 ustawy o służbie cywilnej). Opisz powód.</p>
      <form id="objForm" novalidate>
        <label class="f" for="objText">Uzasadnienie sprzeciwu</label>
        <textarea id="objText" required minlength="10" maxlength="3000"></textarea>
        <div class="btns"><button type="button" class="btn g" data-act="closeModal">Anuluj</button><button class="btn" type="submit">Złóż sprzeciw</button></div>
      </form>`, () => {
      $("#objForm").addEventListener("submit", async e => {
        e.preventDefault();
        try { await api("POST", `/api/evals/${b.dataset.id}/objection`, { text: $("#objText").value }); closeModal(); toast("Sprzeciw złożony."); loadSigs(+b.dataset.id, S.readEval?.status); }
        catch (ex) { toast(ex.message); }
      });
    }),
  };
  function act(name, el) {
    if (!actions[name]) return;
    Promise.resolve(actions[name](el)).catch(e => toast(e.message));
  }
  const bindActs = root => root.querySelectorAll("[data-act]").forEach(b => b.addEventListener("click", e => act(b.dataset.act, b, e)));
  let modalReturn = null;
  function openModal(html, bind, labelledBy) {
    const back = document.activeElement;
    closeModal();
    modalReturn = back;
    const m = document.createElement("div"); m.className = "modal"; m.id = "modal"; m.setAttribute("role", "dialog"); m.setAttribute("aria-modal", "true");
    m.innerHTML = `<div class="card">${html}</div>`;
    const h = labelledBy ? m.querySelector("#" + labelledBy) : m.querySelector("h2");
    if (h) { h.id = h.id || "modalTitle"; m.setAttribute("aria-labelledby", h.id); }
    m.addEventListener("click", e => { if (e.target === m) closeModal(); });
    // Pułapka fokusu: Tab nie wychodzi poza okno dialogowe
    m.addEventListener("keydown", e => {
      if (e.key !== "Tab") return;
      const f = [...m.querySelectorAll("button,input,select,textarea,a[href]")].filter(x => !x.disabled);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    });
    document.body.appendChild(m); bindActs(m); bind && bind();
    m.querySelector("input,select,textarea")?.focus();
  }
  function closeModal() {
    const m = document.getElementById("modal"); if (!m) return;
    m.remove();
    if (modalReturn && document.body.contains(modalReturn)) modalReturn.focus();
    modalReturn = null;
  }
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });

  // Zdarzenia formularzy w kreatorze i celach
  document.addEventListener("change", async e => {
    const t = e.target;
    if (t.dataset.crit && S.cur) {
      const k = t.dataset.crit;
      if (t.checked) {
        if (S.cur.typ !== "pierwsza" && S.cur.criteria.filter(x => !isMand(x, S.cur && S.cur.typ)).length >= S.maxExtra) { t.checked = false; return toast(`Maksymalnie ${S.maxExtra} kryteria dodatkowe.`); }
        S.cur.criteria = [...S.cur.criteria, k];
      } else S.cur.criteria = S.cur.criteria.filter(x => x !== k);
      S.cur.data.criteria = S.cur.criteria; queueSave(); render(); return;
    }
    if (t.dataset.partial && S.cur) {
      S.cur.data.partials = { ...(S.cur.data.partials || {}), [t.dataset.partial]: { pts: +t.value } };
      queueSave(); render(); return;
    }
    if (t.dataset.rate && S.cur) {
      const v = t.value === "none" ? "none" : +t.value;
      S.cur.ratings[t.dataset.rate] = { ...(S.cur.ratings[t.dataset.rate] || {}), lvl: v };
      S.cur.data.ratings = S.cur.ratings; queueSave(); render(); return;
    }
    if (t.dataset.field && S.cur) {
      S.cur.data[t.dataset.field] = t.value; queueSave(); return;
    }
    if (t.dataset.goal) {
      $("#pv" + t.dataset.goal).textContent = t.value;
      try { await api("PATCH", `/api/goals/${t.dataset.goal}`, { progress: +t.value }); await refreshData(); } catch (_) {}
    }
  });
  document.addEventListener("input", e => {
    const t = e.target;
    if (t.dataset.field && t.tagName === "TEXTAREA" && S.cur) { S.cur.data[t.dataset.field] = t.value; queueSave(); return; }
    if (t.dataset.ex && S.cur) { S.cur.ratings[t.dataset.ex] = { ...(S.cur.ratings[t.dataset.ex] || {}), ex: t.value }; S.cur.data.ratings = S.cur.ratings; queueSave(); }
  });

  // ---------- Start ----------
  (async () => {
    try {
      const me = await api("GET", "/api/me");
      S.user = me.user; S.ai = me.ai;
      await load(); render();
    } catch (e) { renderLogin(e.status === 0 ? e.message : ""); }
  })();
})();
