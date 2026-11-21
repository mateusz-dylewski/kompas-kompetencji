/* Kompas Kompetencji – interfejs. Strony, kroki Dalej/Wstecz, dane i AI obsługuje server.mjs. */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pretty = s => s.toLowerCase().replace(/(^|\s)\S/g, m => m.toUpperCase());
  const nameOf = k => (MODEL.find(c => c.k === k) || {}).n || pretty(k);
  const avatar = (src, name, cls = "av") => src
    ? `<img class="${cls}" src="${esc(src)}" alt="" width="40" height="40" loading="lazy">`
    : `<span class="${cls} av-ph" aria-hidden="true">${esc(String(name || "?").split(" ").map(x => x[0]).slice(0, 2).join(""))}</span>`;
  const compIc = k => KK_COMP_ICON(k, "ic-svg comp-ic");
  const fmt = n => (n === null || n === undefined ? "—" : Number(n).toFixed(1));
  const MODEL = window.KK_MODEL || [];
  const TYP = { pierwsza: "Pierwsza ocena", B: "Okresowa – kierownicza (Arkusz B)", C: "Okresowa – pozostałe stanowiska (Arkusz C)" };
  const STATUS = { draft: ["Szkic", "wr"], submitted: ["Złożona", "info"], discussed: ["Omówiona", "ok"], none: ["Brak oceny", ""] };
  const LEVELS5 = ["Znacznie poniżej", "Poniżej", "Na poziomie", "Powyżej", "Znacznie powyżej"];
  const PTS5 = [1, 3, 5, 7, 9];
  const PTS3 = [3, 5, 7];
  const LEVELS3 = ["Poniżej", "Na poziomie", "Powyżej"];

  // Ekrany rozumiane przez użytkownika: każdy ma tytuł i jedno zdanie „po co”
  const PAGES = {
    pracownik: [
      ["home", "Start", "home", "Co dziś warto zrobić"],
      ["profile", "Mój profil", "user", "Jak widzisz swoje kompetencje"],
      ["goals", "Cele", "flag", "Dokąd chcesz dojść"],
      ["evals", "Oceny", "file", "Oceny złożone przez przełożonego"],
    ],
    przelozony: [
      ["home", "Start", "home", "Kto czeka na ocenę"],
      ["evals", "Oceny", "clip", "Przygotuj ocenę krok po kroku"],
      ["results", "Wyniki", "chart", "Obraz zespołu bez ocen indywidualnych"],
      ["log", "Dziennik", "lock", "Kto i kiedy działał w systemie"],
    ],
  };
  const SUB = {
    pracownik: "Pracownik",
    przelozony: "Przełożony",
  };

  const S = { user: null, ai: { ok: false }, dash: null, evals: [], goals: [], view: "home", cur: null, readEval: null, mandB: [], mandC: [], maxExtra: 3 };

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
  function scoreLocal(c) {
    const out = {};
    MODEL.filter(m => c.criteria.includes(m.k)).forEach(m => {
      const pts = m.w.map((_, wi) => c.ratings[m.k + "|" + wi]).filter(r => r && r.lvl !== "none" && r.lvl !== undefined)
        .map(r => c.typ === "pierwsza" ? PTS3[r.lvl - 1] : PTS5[r.lvl]);
      out[m.k] = { avg: pts.length ? pts.reduce((a, b) => a + b, 0) / pts.length : null, n: pts.length, total: m.w.length };
    });
    return out;
  }
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
        <aside class="side" aria-label="Menu główne">
          <div class="brand"><div class="brandmark" aria-hidden="true">K</div><div><b>Kompas Kompetencji</b><br><small>${SUB[u.role]}</small></div></div>
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
        <td style="text-align:right"><button class="btn sm g" data-act="${edit ? "openEval" : "readEval"}" data-id="${e.id}">${edit ? "Dokończ" : "Podgląd"}</button></td></tr>`;
    }).join("");
    return `<div class="card"><div style="overflow-x:auto"><table class="table"><thead><tr><th>Rodzaj</th>${isMgr ? "<th>Pracownik</th>" : ""}<th>Okres</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
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
            ? `<button class="btn sm" data-act="newEval" data-emp="${t.id}">Utwórz ocenę</button>`
            : `<button class="btn sm g" data-act="openEval" data-id="${t.evalId}">${t.status === "draft" ? "Dokończ" : t.status === "submitted" ? "Omów" : "Otwórz"}</button>`}</td></tr>`).join("");
      return `
        <section class="next card anim"><div class="next-ic" aria-hidden="true">${KK_ICON("arrow")}</div>
          <div><h2>${esc(next)}</h2><p class="muted">Zacznij od oceny, która ma najbliższy termin. Kreator poprowadzi Cię krok po kroku.</p></div>
          <button class="btn" data-nav="evals">Przejdź do ocen</button></section>
        <div class="kpis">
          <div class="kpi"><b data-to="${d.team.length}">0</b><span>Pracownicy w zespole</span></div>
          <div class="kpi"><b data-to="${c.none + c.draft}">0</b><span>Do przygotowania</span></div>
          <div class="kpi"><b data-to="${c.submitted}">0</b><span>Złożone</span></div>
          <div class="kpi"><b data-to="${c.discussed}">0</b><span>Omówione</span></div>
        </div>
        <div class="card"><div class="row"><h2>Zespół</h2><button class="btn sm" data-act="addEmp">+ Dodaj pracownika</button></div>
          <div style="overflow-x:auto"><table class="table"><thead><tr><th>Pracownik</th><th>Ocena</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
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
    return evalsList(true);
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
      <div class="wiz-progress"><div class="progress"><i style="width:${pct}%"></i></div><small>Krok ${idx + 1} z ${steps.length} · ${esc(st.label)}</small></div></div>`;
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
    return { html: head + body + nav, title: "Ocena", sub: st.id === "crit" ? "Wybierz, co będziemy oceniać" : st.id === "sum" ? "Sprawdź i złóż ocenę" : st.id === "talk" ? "Przygotuj rozmowę" : "Opisz zachowania, nie osobę", opts: { hidePageHead: true } };
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
          <textarea id="${exId}" data-ex="${esc(id)}" placeholder="Sytuacja, działanie, rezultat">${esc(r.ex || "")}</textarea></div>`;
      }).join("")}`;
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
      <fieldset style="border:0;padding:0;margin:12px 0 0"><legend class="f">Ocena okresowa</legend>
        <label class="choice"><input type="radio" name="wynik" value="pozytywna" data-field="wynik" ${d.wynik === "pozytywna" ? "checked" : ""} ${ro}><span><b>Pozytywna</b></span></label>
        <label class="choice"><input type="radio" name="wynik" value="negatywna" data-field="wynik" ${d.wynik === "negatywna" ? "checked" : ""} ${ro}><span><b>Negatywna</b></span></label>
      </fieldset></div>
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
    ${c.status === "discussed" ? `<div class="note">Ocena omówiona. Wnioski rozwojowe: ${esc(c.data.dev || "—")}</div>` : ""}`;
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
    const scores = scoreLocal({ criteria: e.data.criteria, ratings: e.data.ratings, typ: e.typ });
    const items = MODEL.filter(m => e.data.criteria.includes(m.k)).map(m => `
      <div class="card"><h3 class="h-comp">${compIc(m.k)}${esc(nameOf(m.k))}</h3>${m.w.map((w, wi) => { const r = e.data.ratings[m.k + "|" + wi]; return `<div class="ind"><b>${esc(w.w)}</b><div class="muted">${!r ? "nieocenione" : r.lvl === "none" ? "brak podstaw do oceny" : `${e.typ === "pierwsza" ? PTS3[r.lvl - 1] : PTS5[r.lvl]} pkt`}</div>${r?.ex ? `<div>${esc(r.ex)}</div>` : ""}</div>`; }).join("")}</div>`).join("");
    return `<div class="card"><div class="row"><h2>${esc(TYP[e.typ])}</h2>${pill(e.status)}</div>
      <p class="muted">Okres ${esc(e.period_from || "")} – ${esc(e.period_to || "")}</p>
      <div class="grid two"><div>${radar(scores)}</div><div>${scoreBars(scores)}</div></div></div>
      ${items}
      ${e.data.dev ? `<div class="card"><h2>Wnioski rozwojowe</h2><p>${esc(e.data.dev)}</p></div>` : ""}
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
    S.cur = { id: e.id, typ: e.typ, status: e.status, periodFrom: e.period_from, periodTo: e.period_to,
      empName: r.employee?.name || "", empAvatar: r.employee?.avatar || null, data: e.data, criteria: e.data.criteria || [], ratings: e.data.ratings || {},
      step: 0, missing: r.missing || [], aiText: "", aiSource: "" };
    S.maxExtra = 3;
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
  async function loadLog() {
    const b = $("#logBody"); if (!b) return;
    try {
      const r = await api("GET", "/api/audit");
      b.innerHTML = r.audit.length ? `<div style="overflow-x:auto"><table class="table"><thead><tr><th>Zdarzenie</th><th>Cel</th><th>Kiedy</th></tr></thead><tbody>${r.audit.map(a => `<tr><td>${esc(a.action)}</td><td>${esc(a.target || "")}</td><td>${esc(a.at)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">Brak wpisów.</p>`;
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
  };
  function act(name, el) {
    if (!actions[name]) return;
    Promise.resolve(actions[name](el)).catch(e => toast(e.message));
  }
  function openModal(html, bind) {
    closeModal();
    const m = document.createElement("div"); m.className = "modal"; m.id = "modal"; m.setAttribute("role", "dialog"); m.setAttribute("aria-modal", "true");
    m.innerHTML = `<div class="card">${html}</div>`;
    m.addEventListener("click", e => { if (e.target === m) closeModal(); });
    document.body.appendChild(m); bind && bind();
    m.querySelector("input")?.focus();
  }
  function closeModal() { document.getElementById("modal")?.remove(); }

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
