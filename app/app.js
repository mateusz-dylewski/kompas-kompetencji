/* Kompas Kompetencji – interfejs. Strony, kroki Dalej/Wstecz, dane i AI obsługuje server.mjs. */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pretty = s => s.toLowerCase().replace(/(^|\s)\S/g, m => m.toUpperCase());
  // Zwykła pisownia: pierwsza litera wielka, reszta małe; skróty (np. IPRZ) i samodzielne „i/oraz” zostają
  const ACR = new Set(["IPRZ", "KPA", "RODO", "BHP", "UE", "AI", "PDF"]);
  const sentence = s => { const t = String(s ?? ""); if (!/[A-ZĄĆĘŁŃÓŚŹŻ]{2,}/.test(t)) return t; const r = t.split(/(\s+|\/)/).map(x => ACR.has(x) ? x : x.toLowerCase()).join(""); return r.charAt(0).toUpperCase() + r.slice(1); };
  const nameOf = k => sentence((MODEL.find(c => c.k === k) || {}).n || pretty(k));
  const avatar = (src, name, cls = "av") => src
    ? `<img class="${cls}" src="${esc(src)}" alt="" width="40" height="40" loading="lazy">`
    : `<span class="${cls} av-ph" aria-hidden="true">${esc(String(name || "?").split(" ").map(x => x[0]).slice(0, 2).join(""))}</span>`;
  const actBtn = (icon, label, attrs, cls = "g") => `<button class="btn sm ${cls} act-btn" ${attrs}>${KK_ICON(icon)}<span>${label}</span></button>`;
  const compIc = k => KK_COMP_ICON(k, "ic-svg comp-ic");
  const fmt = n => (n === null || n === undefined ? "—" : Number(n).toFixed(1).replace(".", ","));  // przecinek dziesiętny (jak w arkuszu PDF)
  const MODEL = window.KK_MODEL || [];
  const TYP = { pierwsza: "Pierwsza ocena", B: "Okresowa – Arkusz B (osoby kierujące zespołem)", C: "Okresowa – Arkusz C (pozostałe stanowiska)" };
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
      ["evidence", "Informacje i opinie", "book", "Obserwacje, informacja zwrotna i rozmowy miesięczne – Twój wgląd"],
      ["evals", "Oceny", "file", "Oceny złożone przez przełożonego"],
      ["ai", "Asystent AI", "spark", "Pytania o obsługę systemu i zasady oceny"],
    ],
    przelozony: [
      ["home", "Start", "home", "Kto czeka na ocenę"],
      ["evals", "Oceny", "clip", "Przygotuj ocenę krok po kroku"],
      ["month", "Miesiąc", "msg", "Krótka rozmowa miesięczna i informacje z miesiąca – bez punktacji"],
      ["evidence", "Informacje", "book", "Obserwacje przy wskaźnikach: sytuacja, działanie, rezultat"],
      ["summary", "Zestawienie", "scale", "Liczby informacji, daty i rozkład poziomów – bez średniej i bez sugestii wyniku"],
      ["results", "Wyniki", "chart", "Obraz zespołu bez ocen indywidualnych"],
      ["log", "Dziennik", "lock", "Kto i kiedy działał w systemie"],
      ["ai", "Asystent AI", "spark", "Pytania o obsługę systemu i zasady oceny"],
      ["settings", "Ustawienia", "gear", "Moduły spoza rozporządzenia – włącz lub wyłącz"],
    ],
  };
  // Strony, które znikają z menu po wyłączeniu modułu (moduły spoza rozporządzenia)
  const MODULE_OF = { evidence: "mod_evidence", summary: "mod_evidence", month: "mod_checkins", ai: "mod_ai" };
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
    if (r.status === 401 && url !== "/api/login" && url !== "/api/password") { S.user = null; renderLogin(); throw Object.assign(new Error("Sesja wygasła. Zaloguj się ponownie."), { status: 401 }); }
    if (r.status === 403 && j.code === "password_change_required") { renderPasswordChange(); throw Object.assign(new Error(j.error), { status: 403 }); }
    if (!r.ok) { const e = new Error(j.error || "Wystąpił błąd."); e.data = j; e.status = r.status; throw e; }
    return j;
  }
  const toast = msg => {
    document.querySelectorAll(".toast").forEach(t => t.remove());
    const t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); t.textContent = msg;
    document.body.appendChild(t); setTimeout(() => t.remove(), 2800);
  };
  // Komunikaty z API (mają status/data) pokazujemy wprost; błędy kodu – tylko w konsoli, użytkownik widzi prosty komunikat
  const errMsg = e => {
    if (e && (e.status !== undefined || e.data)) return e.message;
    console.warn(e);
    return "Coś poszło nie tak. Odśwież stronę i spróbuj ponownie.";
  };
  // Link aktywacyjny: bez podłączonej poczty urzędu pokazujemy go przełożonemu; z pocztą trafia tylko na e-mail pracownika
  const activationInfo = a => openModal(`
      <h2>Link aktywacyjny</h2>
      ${a.link ? `<p>Przekaż pracownikowi ten link aktywacyjny. Po podłączeniu poczty urzędu system wysyła go automatycznie wyłącznie na e-mail pracownika.</p>
        <label class="f" for="actLink">Link (ważny do ${esc(a.expires.slice(0, 16).replace("T", " "))} UTC)</label><input id="actLink" readonly value="${esc(a.link)}">`
        : `<p>Link wysłano na adres e-mail pracownika. Jest ważny do ${esc(a.expires.slice(0, 16).replace("T", " "))} UTC.</p>`}
      <div class="btns"><button type="button" class="btn" data-act="closeModal">Zamknij</button></div>`, () => { const i = $("#actLink"); if (i) i.select(); });
  // Rozmowa rozpoczynająca: arkusz, data, kryteria dodatkowe (maks. S.maxExtra, bez obowiązkowych), obowiązki, oczekiwania, cele
  async function kickoffModal(empId) {
    const emp = (S.dash.team || []).find(t => t.id === empId);
    const fromSteps = !!(document.activeElement && document.activeElement.closest && document.activeElement.closest(".steps3"));
    const list = (await api("GET", `/api/kickoffs?employeeId=${empId}`)).kickoffs;
    const cur = list[0] && !list[0].ackAt ? list[0] : null;
    const v = cur || { typ: "", date: new Date().toISOString().slice(0, 10), extraCriteria: [], duties: "", expectations: "", goals: "" };
    const extras = typ => !typ ? `<p class="muted">Najpierw wybierz arkusz – wtedy pokażemy kryteria dodatkowe.</p>` : MODEL.filter(m => !isMand(m.k, typ)).map(m => `<label class="choice"><input type="checkbox" data-extra="${esc(m.k)}" ${v.extraCriteria.includes(m.k) ? "checked" : ""}><span>${esc(nameOf(m.k))}</span></label>`).join("");
    openModal(`
      <h2 id="kTitle">Rozmowa rozpoczynająca – ${first(emp ? emp.name : "")}</h2>
      <p>Ustal z pracownikiem obowiązki, oczekiwania i cele na ten okres. Pracownik potwierdzi zapoznanie w swoim panelu.</p>
      ${list[0] && list[0].ackAt ? `<p class="muted">Ostatnia rozmowa: ${esc(isoToPl(list[0].date))} (zapoznano).</p>` : ""}
      <details class="adv"><summary>Podstawa prawna</summary><p class="muted">Rozmowę rozpoczynającą przeprowadza się w terminie 30 dni od poprzedniej oceny. Pracownik potwierdza zapoznanie (część I arkusza) – od tego dnia liczy się okres oceny. Rozporządzenie Prezesa Rady Ministrów z 4 kwietnia 2016 r. w sprawie przeprowadzania ocen okresowych członków korpusu służby cywilnej.</p></details>
      <form id="kForm" novalidate>
        <fieldset class="plain"><legend class="f">Rodzaj arkusza oceny</legend>
          <label class="choice"><input type="radio" name="kTyp" value="B" ${v.typ === "B" ? "checked" : ""}><span>Arkusz B – osoby kierujące zespołem</span></label>
          <label class="choice"><input type="radio" name="kTyp" value="C" ${v.typ === "C" ? "checked" : ""}><span>Arkusz C – pozostałe stanowiska</span></label>
          <p class="muted" id="kTypHelp">Arkusz B dotyczy osób kierujących zespołem, arkusz C – pozostałych stanowisk. Od arkusza zależą kryteria obowiązkowe, dlatego wybierasz go świadomie – bez ustawienia domyślnego.</p></fieldset>
        <label class="f" for="kDate">Data rozmowy</label>${dateFieldHtml("kDate", v.date, "required")}
        <fieldset class="plain"><legend class="f">Kryteria dodatkowe (maks. ${S.maxExtra}; obowiązkowe są wybrane automatycznie)</legend><div id="kExtras">${extras(v.typ)}</div><p class="muted mand-note">Kryteria obowiązkowe wg rozporządzenia Prezesa Rady Ministrów z 4 kwietnia 2016 r. (załącznik – arkusz B/C).</p>
          <div class="ai-crit"><button type="button" class="btn" id="kAiBtn">${KK_ICON("star")}<span>Zaproponuj kryteria (AI)</span></button>
            <div class="ai-crit-out" id="kAiOut" aria-live="polite"></div>
            <p class="muted">AI proponuje tylko kryteria z rozporządzenia. Decyzja należy do Ciebie.</p></div></fieldset>
        <label class="f" for="kDuties">Obowiązki na stanowisku</label><textarea id="kDuties" required minlength="10" maxlength="2000">${esc(v.duties)}</textarea>
        <label class="f" for="kExp">Oczekiwania wobec realizacji kryteriów</label><textarea id="kExp" required minlength="10" maxlength="2000">${esc(v.expectations)}</textarea>
        <label class="f" for="kGoals">Cele na okres oceny</label><textarea id="kGoals" required minlength="10" maxlength="2000">${esc(v.goals)}</textarea>
        <div class="err" id="kErr" role="alert"></div>
        <div class="btns"><button type="button" class="btn g" data-act="closeModal">Anuluj</button><button class="btn" type="submit">Zapisz</button></div>
      </form>`, () => {
      document.querySelectorAll('[name="kTyp"]').forEach(r => r.addEventListener("change", () => { v.typ = r.value; v.extraCriteria = []; $("#kExtras").innerHTML = extras(r.value); }));
      $("#kAiBtn").addEventListener("click", async () => {
        const b = $("#kAiBtn"), out = $("#kAiOut");
        if (!document.querySelector('[name="kTyp"]:checked')) { out.innerHTML = `<div class="err" role="alert">Najpierw wybierz arkusz (B albo C).</div>`; return; }
        b.disabled = true;
        out.innerHTML = thinkingHtml(`Model AI ${aiWhere()} dobiera kryteria…`); const stop = startThinking(out);
        try {
          const r = await api("POST", "/api/ai/criteria", { employeeId: empId, typ: document.querySelector('[name="kTyp"]:checked').value, duties: $("#kDuties").value });
          const pr = r.propozycje || [];
          out.innerHTML = pr.length ? `<ul class="ai-props">${pr.map(p => `<li class="ai-prop"><b>${esc(nameOf(p.k))}</b><span>${esc(p.uzasadnienie || "")}</span></li>`).join("")}</ul>
            <p class="ai-crit-src">Źródło: ${r.source === "ai" ? "model AI" : "reguły systemu (asystent AI był niedostępny)"}.</p>
            <button type="button" class="btn" id="kAiApply">Zaznacz te kryteria</button>` : `<p class="muted">Brak propozycji dla podanych obowiązków. Wybierz kryteria samodzielnie.</p>`;
          const ap = $("#kAiApply");
          if (ap) ap.addEventListener("click", () => {
            document.querySelectorAll("[data-extra]").forEach(x => { x.checked = false; });
            pr.slice(0, S.maxExtra).forEach(p => { const x = document.querySelector(`[data-extra="${CSS.escape(p.k)}"]`); if (x) x.checked = true; });
            out.insertAdjacentHTML("beforeend", `<p class="muted" role="status">Zaznaczono. Możesz to zmienić przed zapisem.</p>`); ap.disabled = true;
          });
        } catch (ex) { out.innerHTML = `<div class="err" role="alert">Nie udało się pobrać podpowiedzi: ${esc(errMsg(ex))} Wybierz kryteria samodzielnie.</div>`; }
        finally { stop(); b.disabled = false; }
      });
      const kd = bindDate("kDate");
      $("#kForm").addEventListener("submit", async e => {
        e.preventDefault();
        const kIso = kd.iso(); if (!kIso) { $("#kDate").focus(); return; }
        if (!document.querySelector('[name="kTyp"]:checked')) { $("#kErr").textContent = "Wybierz arkusz: B (osoby kierujące zespołem) albo C (pozostałe stanowiska)."; document.querySelector('[name="kTyp"]').focus(); return; }
        const extra = [...document.querySelectorAll("[data-extra]:checked")].map(x => x.dataset.extra);
        if (extra.length > S.maxExtra) { $("#kErr").textContent = `Najwyżej ${S.maxExtra} kryteria dodatkowe.`; return; }
        const body = { typ: document.querySelector('[name="kTyp"]:checked').value, date: kIso, extraCriteria: extra, duties: $("#kDuties").value, expectations: $("#kExp").value, goals: $("#kGoals").value };
        try {
          if (cur) await api("PUT", `/api/kickoffs/${cur.id}`, body); else await api("POST", "/api/kickoffs", { employeeId: empId, ...body });
          closeModal(); toast("Zapisano rozmowę rozpoczynającą. Pracownik potwierdzi zapoznanie w swoim panelu."); await refreshData(); render();
          // powrót fokusu na przycisk, z którego otwarto okno (po odświeżeniu widoku stary przycisk już nie istnieje)
          (fromSteps ? document.querySelector('.steps3 [data-act="kickoff"]') : document.querySelector(`[data-act="kickoff"][data-emp="${empId}"]`) || document.querySelector('.steps3 [data-act="kickoff"]'))?.focus();
        } catch (ex) { $("#kErr").textContent = ex.data?.fields ? Object.values(ex.data.fields).join(" ") : ex.message; }
      });
    }, "kTitle");
  }
  // Potwierdzenie w oknie systemu (zamiast okienka przeglądarki „localhost mówi…”); true po „Potwierdź”
  function askConfirm({ title, text, ok = "Potwierdź", cancel = "Anuluj" }) {
    return new Promise(resolve => {
      openModal(`<h2 id="acTitle">${esc(title)}</h2><p>${esc(text)}</p>
        <div class="btns"><button type="button" class="btn g" data-act="closeModal">${esc(cancel)}</button><button type="button" class="btn" id="acYes">${esc(ok)}</button></div>`, () => {
        $("#acYes").focus();
        $("#acYes").addEventListener("click", () => { closeModal(); resolve(true); });
      }, "acTitle");
    });
  }
  // Krótkie pole tekstowe w oknie systemu (zamiast okienka przeglądarki); zwraca tekst albo nic po „Anuluj”
  function askText({ title, label, hint = "", min = 1, max = 1000, ok = "Zapisz", multiline = false }) {
    return new Promise(resolve => {
      const field = multiline ? `<textarea id="atIn" minlength="${min}" maxlength="${max}" aria-describedby="atHint atErr"></textarea>` : `<input id="atIn" type="text" minlength="${min}" maxlength="${max}" autocomplete="off" aria-describedby="atHint atErr">`;
      openModal(`<h2 id="atTitle">${esc(title)}</h2><form id="atForm" novalidate>
        <label class="f" for="atIn">${esc(label)}</label>${field}<p class="muted" id="atHint">${esc(hint)}</p><div class="err" id="atErr" role="alert"></div>
        <div class="btns"><button type="button" class="btn g" data-act="closeModal">Anuluj</button><button class="btn" type="submit">${esc(ok)}</button></div></form>`, () => {
        $("#atIn").focus();
        $("#atForm").addEventListener("submit", e => {
          e.preventDefault(); const v = $("#atIn").value.trim();
          if (v.length < min) { $("#atErr").textContent = min > 1 ? `Wpisz co najmniej ${min} znaków.` : "Uzupełnij pole."; $("#atIn").focus(); return; }
          closeModal(); resolve(v);
        });
      }, "atTitle");
    });
  }
  // Nowa ocena: okno w stylu systemu (zamiast okienek przeglądarki). Podpowiedzi z rozmowy rozpoczynającej,
  // okres DD.MM.RRRR, reguła 6 miesięcy z wyjątkiem i uzasadnieniem (trafia do dziennika).
  function newEvalModal(empId) {
    const team = S.dash.team || [];
    const addMonths = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };
    const todayIso = new Date().toISOString().slice(0, 10);
    const suggest = t => {
      const k = t && t.kickoff && t.kickoff.ackAt && !t.kickoff.evalId ? t.kickoff : null;
      const from = k ? k.ackAt.slice(0, 10) : todayIso;
      const to = t && t.nextDue && t.nextDue > from ? t.nextDue : addMonths(from, 12);
      return { typ: k ? k.typ : "", from, to, k };
    };
    const emp0 = team.find(t => t.id === empId) || null;
    const sg = suggest(emp0);
    const info = t => {
      if (!t) return `<p class="muted">Wybierz pracownika.</p>`;
      if (t.status === "draft") return `<div class="note warn">${first(t.name)} ma już szkic oceny. Dokończ go zamiast tworzyć nowy. <button type="button" class="btn sm" data-ne-open="${t.evalId}">Dokończ szkic</button></div>`;
      const k = suggest(t).k;
      return k ? `<p class="muted">Rozmowa rozpoczynająca z ${esc(isoToPl(k.date))}, zapoznanie ${esc(isoToPl(k.ackAt.slice(0, 10)))}: arkusz ${esc(k.typ)} i kryteria dodatkowe przejdą do oceny, okres liczy się od dnia zapoznania.</p>`
        : `<p class="muted">Brak zapoznanej rozmowy rozpoczynającej – kryteria dodatkowe możesz dodać w kreatorze.</p>`;
    };
    openModal(`
      <h2 id="neTitle">Nowa ocena</h2>
      <p>Utworzymy szkic oceny i otworzymy kreator. Szkic możesz zapisać i wrócić do niego później.</p>
      <form id="neForm" novalidate>
        <label class="f" for="neEmp">Pracownik</label>
        <select id="neEmp" required><option value="">Wybierz pracownika</option>${team.map(t => `<option value="${t.id}"${emp0 && t.id === emp0.id ? " selected" : ""}>${esc(t.name)}</option>`).join("")}</select>
        <div id="neInfo" aria-live="polite">${info(emp0)}</div>
        <fieldset class="plain"><legend class="f">Rodzaj oceny</legend>
          <label class="choice"><input type="radio" name="neTyp" value="pierwsza"${sg.typ === "pierwsza" ? " checked" : ""}><span>Pierwsza ocena (nowy pracownik)</span></label>
          <label class="choice"><input type="radio" name="neTyp" value="B"${sg.typ === "B" ? " checked" : ""}><span>Ocena okresowa – arkusz B (osoby kierujące zespołem)</span></label>
          <label class="choice"><input type="radio" name="neTyp" value="C"${sg.typ === "C" ? " checked" : ""}><span>Ocena okresowa – arkusz C (pozostałe stanowiska)</span></label></fieldset>
        <div class="grid two">
          <div><label class="f" for="neFrom">Okres oceny od</label>${dateFieldHtml("neFrom", sg.from, "required")}</div>
          <div><label class="f" for="neTo">Okres oceny do</label>${dateFieldHtml("neTo", sg.to, "required")}</div>
        </div>
        <div id="neExc" hidden>
          <div class="note warn" id="neExcMsg"></div>
          <label class="f" for="neReason">Uzasadnienie wyjątku (min. 10 znaków, trafi do dziennika)</label>
          <textarea id="neReason" minlength="10" maxlength="1000"></textarea>
        </div>
        <div class="err" id="neErr" role="alert"></div>
        <div class="btns"><button type="button" class="btn g" data-act="closeModal">Anuluj</button><button class="btn" type="submit" id="neSubmit">Utwórz szkic i otwórz kreator</button></div>
      </form>`, () => {
      const hF = bindDate("neFrom"), hT = bindDate("neTo");
      const bindOpen = () => document.querySelectorAll("[data-ne-open]").forEach(b => b.addEventListener("click", async () => { closeModal(); await openWizard(+b.dataset.neOpen); }));
      bindOpen();
      $("#neEmp").addEventListener("change", e => {
        const t = team.find(x => x.id === +e.target.value) || null, g = suggest(t);
        $("#neInfo").innerHTML = info(t); bindOpen();
        document.querySelectorAll('[name="neTyp"]').forEach(r => { r.checked = r.value === g.typ; });
        $("#neFrom").value = isoToPl(g.from); $("#neTo").value = isoToPl(g.to);
        $("#neExc").hidden = true; $("#neErr").textContent = "";
      });
      $("#neForm").addEventListener("submit", async e => {
        e.preventDefault(); $("#neErr").textContent = "";
        const t = team.find(x => x.id === +$("#neEmp").value);
        if (!t) { $("#neErr").textContent = "Wybierz pracownika."; $("#neEmp").focus(); return; }
        if (t.status === "draft") { $("#neErr").textContent = "Ta osoba ma już szkic oceny – użyj przycisku „Dokończ szkic”."; return; }
        const typ = document.querySelector('[name="neTyp"]:checked')?.value;
        if (!typ) { $("#neErr").textContent = "Wybierz rodzaj oceny."; document.querySelector('[name="neTyp"]').focus(); return; }
        const from = hF.iso(); if (!from) { $("#neFrom").focus(); return; }
        const to = hT.iso(); if (!to) { $("#neTo").focus(); return; }
        if (from > to) { $("#neErr").textContent = "Koniec okresu nie może być przed początkiem."; $("#neTo").focus(); return; }
        const body = { employeeId: t.id, typ, periodFrom: from, periodTo: to };
        if (!$("#neExc").hidden) {
          const reason = $("#neReason").value.trim();
          if (reason.length < 10) { $("#neErr").textContent = "Uzasadnij wyjątek (min. 10 znaków)."; $("#neReason").focus(); return; }
          body.exception = { reason };
        }
        $("#neSubmit").disabled = true;
        try {
          const r = await api("POST", "/api/evals", body);
          closeModal(); await refreshData();
          toast(r.earlyException ? "Utworzono szkic oceny (wyjątek od reguły 6 miesięcy zapisany w dzienniku)." : "Utworzono szkic oceny.");
          await openWizard(r.id);
        } catch (ex) {
          if (ex.data?.code === "too_early") {
            $("#neExc").hidden = false;
            $("#neExcMsg").textContent = `Od poprzedniej oceny okresowej (${isoToPl(ex.data.prevDate || "")}) musi upłynąć 6 miesięcy – najwcześniej ${isoToPl(ex.data.earliest || "")}. Zmień okres albo zapisz wyjątek z uzasadnieniem.`;
            $("#neReason").focus();
          } else $("#neErr").textContent = ex.data?.fields ? Object.values(ex.data.fields).join(" ") : errMsg(ex);
        } finally { const b = $("#neSubmit"); if (b) b.disabled = false; }
      });
    }, "neTitle");
  }
  // Dobrowolna ankieta po złożeniu oceny: zapisywana anonimowo (tylko wartość i miesiąc), do metryk zbiorczych
  const surveyModal = evalId => openModal(`
      <p class="ok-banner" role="status">${KK_ICON("check")}<span>Ocena złożona. Pracownik zobaczy ją w swoim panelu.</span></p>
      <h2>Jedno pytanie – dobrowolne, możesz pominąć</h2>
      <p>Jak oceniasz swoje przygotowanie do rozmowy oceniającej z pomocą aplikacji?</p>
      <form id="svForm"><fieldset class="plain"><legend class="sr">Ocena od 1 do 5</legend>
        ${[1, 2, 3, 4, 5].map(n => `<label class="choice"><input type="radio" name="sv" value="${n}"><span>${n}${n === 1 ? " – słabo" : n === 5 ? " – bardzo dobrze" : ""}</span></label>`).join("")}</fieldset>
        <p class="muted">Odpowiedź jest anonimowa: zapisujemy tylko wartość i miesiąc, bez Twoich danych i bez oceny. Wyniki widać zbiorczo, od 5 przełożonych.</p>
        <div class="btns"><button type="button" class="btn g" data-act="closeModal">Pomiń i zamknij</button><button class="btn" type="submit">Wyślij odpowiedź</button></div></form>`, () => {
      $("#svForm").addEventListener("submit", async e => {
        e.preventDefault();
        const r = document.querySelector('[name="sv"]:checked'); if (!r) return toast("Wybierz wartość albo pomiń.");
        try { await api("POST", `/api/evals/${evalId}/survey`, { rating: +r.value }); closeModal(); toast("Dziękujemy."); } catch (ex) { toast(errMsg(ex)); }
      });
    });
  async function loadMetrics() {
    const box = $("#metricsCard"); if (!box) return;
    let m; try { m = await api("GET", "/api/metrics"); } catch (ex) { box.querySelector("p").textContent = ex.message; return; }
    const pct = v => (v === null || v === undefined ? "—" : `${v}%`);
    box.innerHTML = `<h2>Czy aplikacja pomaga w ocenie? (metryki zbiorcze)</h2>` + (m.suppressed
      ? `<div class="note warn">Metryki wsparcia przełożonych pokazujemy od ${m.kMin} przełożonych – obecnie ${m.managers}. To dane o korzystaniu z aplikacji, nie o pojedynczych osobach.</div>`
      : `<ul class="c">
          <li>Ocenianie: miesiące okresu z co najmniej jedną informacją – mediana <b>${pct(m.coverage.medianPct)}</b> (${m.coverage.n} ocen)</li>
          <li>Ocena na piśmie: od szkicu do złożenia – mediana <b>${m.submit.medianDays ?? "—"} dni</b>; poprawki po złożeniu: <b>${pct(m.submit.revisedPct)}</b></li>
          <li>Rozmowa rozpoczynająca w terminie 30 dni: <b>${pct(m.kickoff.onTimePct)}</b> (${m.kickoff.n}); zmiana kryteriów dodatkowych po rozmowie: <b>${pct(m.kickoff.criteriaChangedPct)}</b></li>
          <li>Przygotowanie do rozmowy (ankieta 1–5): ${m.prep.suppressed ? `za mało odpowiedzi (${m.prep.n})` : `mediana <b>${m.prep.median}</b> z ${m.prep.n} odpowiedzi`}</li></ul>
        <p class="muted">Mediany i odsetki z ${m.evals} ocen ${m.managers} przełożonych. Bez danych o osobach, czasie pracy i aktywności. Czas przygotowania „z aplikacją i bez” oraz dokumenty poza systemem wymagają badania pilotażowego.</p>`);
  }
  // ---------- Data DD.MM.RRRR: same cyfry, kropki wstawiane automatycznie, niemożliwe cyfry odrzucane ----------
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  // Miesiąc „2026-10” → „październik 2026”
  const MIES = ["styczeń", "luty", "marzec", "kwiecień", "maj", "czerwiec", "lipiec", "sierpień", "wrzesień", "październik", "listopad", "grudzień"];
  const monthPl = ym => { const m = /^(\d{4})-(\d{2})$/.exec(ym || ""); return m ? `${MIES[+m[2] - 1]} ${m[1]}` : ym || ""; };
  const isoToPl = iso => (/^\d{4}-\d{2}-\d{2}$/.test(iso || "") ? iso.split("-").reverse().join(".") : iso || "");
  // Data z godziną: „dd.mm.rrrr gg:mm”; sama data: „dd.mm.rrrr”
  const plDT = at => { const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(at || ""); return m ? `${m[3]}.${m[2]}.${m[1]}${m[4] ? ` ${m[4]}:${m[5]}` : ""}` : at || ""; };
  // Przyjmuje kolejne cyfry: dzień 01–31, miesiąc 01–12; „5” w dniu → „05.”, „2” w miesiącu → „02.”
  function maskDigits(raw) {
    let out = "";
    for (const ch of raw.replace(/\D/g, "")) {
      const n = out.length, d = +ch;
      if (n === 0) out += d > 3 ? "0" + ch : ch;
      else if (n === 1) { if ((out[0] === "3" && d > 1) || (out[0] === "0" && d === 0)) continue; out += ch; }
      else if (n === 2) out += d > 1 ? "0" + ch : ch;
      else if (n === 3) { if ((out[2] === "1" && d > 2) || (out[2] === "0" && d === 0)) continue; out += ch; }
      else if (n === 4) { if (d !== 2) continue; out += ch; } // rok 2xxx
      else if (n < 8) out += ch;
    }
    return out;
  }
  const fmtDigits = (dg, trailing) => {
    let v = dg.slice(0, 2);
    if (dg.length > 2 || (trailing && dg.length === 2)) v += ".";
    v += dg.slice(2, 4);
    if (dg.length > 4 || (trailing && dg.length === 4)) v += ".";
    return v + dg.slice(4, 8);
  };
  function dateMask(input, errEl, opt = {}) {
    const check = dg => {
      if (dg.length < 8) return dg.length ? "Uzupełnij datę: DD.MM.RRRR." : "Podaj termin.";
      const d = +dg.slice(0, 2), m = +dg.slice(2, 4), y = +dg.slice(4);
      if (d > daysIn(y, m)) return `Ten miesiąc ma ${daysIn(y, m)} dni.`;
      const iso = `${y}-${dg.slice(2, 4)}-${dg.slice(0, 2)}`;
      if (opt.min && iso < opt.min) return "Termin nie może być w przeszłości.";
      if (opt.maxYears && y > new Date().getUTCFullYear() + opt.maxYears) return `Termin najpóźniej za ${opt.maxYears} lat.`;
      return "";
    };
    const show = (msg, force) => { const bad = !!msg && (force || input.value.replace(/\D/g, "").length >= 8); input.setAttribute("aria-invalid", bad ? "true" : "false"); errEl.textContent = bad ? msg : ""; };
    input.addEventListener("input", e => {
      let dg = maskDigits(input.value);
      // Kasowanie kropki kasuje też cyfrę przed nią
      if (e.inputType === "deleteContentBackward" && /[.]$/.test(fmtDigits(dg, true)) && input.value.length < fmtDigits(dg, true).length) dg = dg.slice(0, -1);
      input.value = fmtDigits(dg, e.inputType !== "deleteContentBackward");
      show(check(dg));
    });
    input.addEventListener("paste", e => {
      const t = (e.clipboardData || window.clipboardData).getData("text").trim();
      const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
      if (iso) { e.preventDefault(); input.value = fmtDigits(maskDigits(iso[3] + iso[2] + iso[1]), false); show(check(maskDigits(input.value))); }
    });
    input.addEventListener("blur", () => { const dg = maskDigits(input.value); if (dg.length) show(check(dg), true); });
    return { iso: () => { const dg = maskDigits(input.value), msg = check(dg); show(msg, true); return msg ? "" : `${dg.slice(4)}-${dg.slice(2, 4)}-${dg.slice(0, 2)}`; } };
  }
  // Pole daty jako tekst DD.MM.RRRR (maska dateMask); wartość początkowa z ISO, odczyt zwraca RRRR-MM-DD
  const dateFieldHtml = (id, iso, extra = "") => `<input id="${id}" type="text" inputmode="numeric" autocomplete="off" maxlength="10" placeholder="DD.MM.RRRR" aria-describedby="${id}Err" value="${esc(isoToPl(iso || ""))}" ${extra}><div class="err" id="${id}Err" role="alert"></div>`;
  const bindDate = (id, opt) => { const el = $("#" + id); return el ? dateMask(el, $("#" + id + "Err"), opt) : null; };
  // Odczyt: pusta wartość -> "" (pole opcjonalne), błędna -> null (komunikat przy polu)
  const readDate = (h, id) => { const el = $("#" + id); if (!el || !el.value.trim()) return ""; const r = h.iso(); return r || null; };
  // ---------- Cele: kafelki (wyznacza przełożony; pracownik zgłasza krok, przełożony potwierdza) ----------
  const goalStepState = x => (x.confirmed_at ? "confirmed" : x.reported_at ? "reported" : "open");
  function goalTile(g, mode) {
    const n = g.steps.length, k = g.stepsConfirmed, rep = g.stepsReported;
    const state = g.done ? '<span class="tag ok">zrealizowany</span>' : rep ? `<span class="tag wr">${rep} do potwierdzenia</span>` : '<span class="tag info">w toku</span>';
    const stepBtn = (x, i) => {
      const st = goalStepState(x);
      if (mode === "emp") return st === "confirmed" ? "" // data potwierdzenia jest w opisie stanu kroku
        : `<button class="btn sm g" data-act="goalReport" data-goal="${g.id}" data-step="${i}" data-val="${st === "reported" ? 0 : 1}" aria-label="${st === "reported" ? "Cofnij zgłoszenie" : "Zgłoś wykonanie"} kroku „${esc(x.t)}” – ${esc(g.s)}">${st === "reported" ? "Cofnij zgłoszenie" : "Zgłoś wykonanie"}</button>`;
      return `<button class="btn sm ${st === "reported" ? "" : "g"}" data-act="goalConfirm" data-goal="${g.id}" data-step="${i}" data-val="${st === "confirmed" ? 0 : 1}" aria-label="${st === "confirmed" ? "Cofnij potwierdzenie" : "Potwierdź"} krok „${esc(x.t)}” – ${esc(g.s)}">${st === "confirmed" ? "Cofnij potwierdzenie" : "Potwierdź"}</button>`;
    };
    const label = { confirmed: "potwierdzony", reported: "zgłoszony – czeka na potwierdzenie", open: "do zrobienia" };
    const body = n ? `
        <div class="seg" role="img" aria-label="Potwierdzone kroki: ${k} z ${n}${rep ? `, zgłoszone: ${rep}` : ""}">${g.steps.map(x => `<i class="${{ confirmed: "on", reported: "rep", open: "" }[goalStepState(x)]}"></i>`).join("")}</div>
        <div class="muted"><b>${k} z ${n}</b> kroków potwierdzonych</div>
        <div class="trend" data-trend-goal="${g.id}"></div>
        <details class="goal-steps"${n <= 5 ? " open" : ""}><summary>Kroki</summary>
          <ul class="steps">${g.steps.map((x, i) => `<li class="st-${goalStepState(x)}"><span class="st-t"><b>${esc(x.t)}</b><br><span class="st-meta">${label[goalStepState(x)]}${x.confirmed_at ? ` ${esc(isoToPl(x.confirmed_at.slice(0, 10)))}` : ""}</span></span>${stepBtn(x, i)}</li>`).join("")}</ul>
          ${mode === "mgr" && n < 8 ? `<button class="btn sm g" data-act="addStep" data-id="${g.id}">${KK_ICON("plus")}<span>Dodaj krok</span></button>` : ""}
        </details>`
      : `<p class="muted">Cel sprzed zmian – bez kroków.</p><button class="btn sm g" data-act="toggleGoal" data-id="${g.id}" data-done="${g.done ? 0 : 1}">${g.done ? "Cofnij" : "Oznacz jako zrealizowany"}</button>`;
    return `<div class="goal-tile ${g.done ? "is-done" : ""}">
        <div class="row"><b class="goal-t">${esc(g.s)}</b>${state}</div>
        <div class="muted">Miara: ${esc(g.m)}<br>Termin: ${esc(isoToPl(g.t))}${g.legacy ? " · cel założony przez pracownika" : ""}</div>${body}
      </div>`;
  }
  const goalTiles = (goals, mode) => goals.length ? `<div class="goal-tiles">${goals.map(g => goalTile(g, mode)).join("")}</div>`
    : `<p class="muted">${mode === "emp" ? "Nie masz jeszcze celów. Cele ustala przełożony – swoje propozycje zgłoś na rozmowie miesięcznej." : "Brak celów. Dodaj pierwszy cel z krokami."}</p>`;
  // Trend celu między spotkaniami: schody potwierdzonych kroków w kolejnych miesiącach, kropki = odbyte rozmowy miesięczne
  function trendSvg(t) {
    const W = 240, H = 46, n = t.series.length, x = i => (n < 2 ? W / 2 : 4 + i * (W - 8) / (n - 1)), y = v => H - 12 - (t.total ? v / t.total : 0) * (H - 18);
    let d = "";
    t.series.forEach((p, i) => { d += i ? ` H${x(i).toFixed(1)} V${y(p.confirmed).toFixed(1)}` : `M${x(0).toFixed(1)} ${y(p.confirmed).toFixed(1)}`; });
    const dots = t.series.map((p, i) => (t.talks.includes(p.month) ? `<circle cx="${x(i).toFixed(1)}" cy="${H - 4}" r="3"/>` : "")).join("");
    const label = `Potwierdzone kroki w kolejnych miesiącach: ${t.series.map(p => `${monthPl(p.month)} – ${p.confirmed}`).join(", ")}. Kropki: rozmowy miesięczne.`;
    return `<svg class="trend-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}"><path d="${d}"/>${dots}</svg>`;
  }
  async function fillTrends(empId) {
    const boxes = document.querySelectorAll("[data-trend-goal]"); if (!boxes.length) return;
    let r; try { r = await api("GET", "/api/goals/trend" + (empId ? `?employeeId=${empId}` : "")); } catch (_) { return; }
    const byId = Object.fromEntries(r.goals.map(g => [g.id, g]));
    boxes.forEach(b => {
      const t = byId[b.dataset.trendGoal]; if (!t || t.series.length < 2) return;
      b.innerHTML = trendSvg(t) + (t.sinceLastTalk !== null ? `<small class="muted">${t.sinceLastTalk > 0 ? `+${t.sinceLastTalk} ${t.sinceLastTalk === 1 ? "krok" : t.sinceLastTalk < 5 ? "kroki" : "kroków"} od ostatniej rozmowy` : "Bez nowych potwierdzeń od ostatniej rozmowy"}</small>` : "");
    });
  }
  // Zmiana między dwiema ostatnimi ocenami okresowymi (bez średniej i prognozy)
  async function loadCompare(empId) {
    const box = $("#cmpBox"); if (!box) return;
    let r; try { r = await api("GET", "/api/evals/compare" + (empId ? `?employeeId=${empId}` : "")); } catch (ex) { if (!box.isConnected) return; box.innerHTML = `<h2>Zmiana między ocenami okresowymi</h2><p class="muted">${esc(errMsg(ex))}</p>`; return; }
    if (!box.isConnected) return;
    const arrow = { wzrost: "▲ wzrost", spadek: "▼ spadek", "bez zmian": "= bez zmian" };
    box.innerHTML = `<h2>Zmiana między ocenami okresowymi</h2>` + (!r.available
      ? `<p class="muted">Porównanie pojawi się, gdy będą dwie złożone oceny okresowe (B lub C).</p>`
      : `<p class="muted">Ocena z ${esc(isoToPl(r.previousEval.date))} i z ${esc(isoToPl(r.currentEval.date))}. Tylko oceny cząstkowe z formalnych ocen okresowych – bez średniej i bez prognozy.</p>
        <div style="overflow-x:auto"><table class="table"><thead><tr><th scope="col">Kryterium</th><th scope="col">Poprzednio</th><th scope="col">Teraz</th><th scope="col">Zmiana</th></tr></thead><tbody>
        ${r.competencies.map(c => `<tr><td>${esc(c.name)}</td><td>${c.previous} pkt</td><td>${c.current} pkt</td><td><span class="tag ${c.direction === "wzrost" ? "ok" : c.direction === "spadek" ? "wr" : ""}">${arrow[c.direction]}</span></td></tr>`).join("") || `<tr><td colspan="4" class="muted">Brak wspólnych kryteriów w obu ocenach.</td></tr>`}</tbody></table></div>`);
  }
  // Terminy i sprawy: wpisy tej samej osoby w jednym wierszu (zdanie prostym językiem + przyciski akcji)
  function alertsCard(alerts) {
    if (!alerts || !alerts.length) return "";
    const plural = n => n === 1 ? "krok celu czeka" : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)) ? "kroki celu czekają" : "kroków celu czeka";
    const sentence = x => {
      let m;
      if (x.kind === "goals" && (m = /(\d+)\s*$/.exec(x.text))) return `${m[1]} ${plural(+m[1])} na Twoje potwierdzenie`;
      if (x.kind === "kickoff" && (m = /(\d{4}-\d{2}-\d{2})/.exec(x.text))) return /minął/.test(x.text) ? `Termin rozmowy rozpoczynającej minął ${isoToPl(m[1])}` : `Rozmowa rozpoczynająca do ${isoToPl(m[1])}`;
      if (x.kind === "kickoff_ack" && (m = /(\d{4}-\d{2}-\d{2})/.exec(x.text))) return `Rozmowa rozpoczynająca z ${isoToPl(m[1])} czeka na zapoznanie pracownika`;
      return x.text;
    };
    const btn = x => x.kind === "goals" ? `<button class="btn g" data-act="mgrGoals" data-emp="${x.employeeId}" aria-label="Cele pracownika – ${first(x.name)}">Cele pracownika</button>`
      : x.kind === "kickoff" || x.kind === "kickoff_ack" ? `<button class="btn g" data-act="kickoff" data-emp="${x.employeeId}" aria-label="Rozmowa rozpoczynająca – ${first(x.name)}">Rozmowa rozpoczynająca</button>`
      : `<button class="btn g" data-act="openEval" data-id="${x.evalId}" aria-label="Otwórz ocenę – ${first(x.name)}">Otwórz</button>`;
    const groups = [];
    alerts.forEach(x => { let g = groups.find(y => y.name === x.name); if (!g) groups.push(g = { name: x.name, items: [] }); g.items.push(x); });
    return `<div class="card" role="region" aria-label="Terminy i sprawy do załatwienia"><h2>Terminy i sprawy do załatwienia</h2><ul class="todo">${groups.map(g => `<li class="todo-row"><div class="todo-t"><b>${first(g.name)}</b>${g.items.map(x => /minął|po terminie/i.test(x.text || "") ? `<span class="overdue"><span class="tag bad">${KK_ICON("alert")}<span>po terminie</span></span> ${esc(sentence(x))}</span>` : `<span>${esc(sentence(x))}</span>`).join("")}</div><div class="todo-a">${g.items.map(btn).join("")}</div></li>`).join("")}</ul></div>`;
  }
  // Brief do rozmowy: tekst z odnośnikami do faktów + fakty (JSON „kto co robił”) zbudowane przez serwer
  const factLine = f => `<li id="fact-${esc(f.id.replace(/\./g, "-"))}"><b>[${esc(f.id)}]</b> <span class="muted">${esc(isoToPl(f.data))} · ${esc(f.rodzaj)}${f.kryterium ? " · " + esc(nameOf(f.kryterium)) : ""} · ${esc(f.kto_zapisal || f.kto || "")}${f.zrodlo ? " · źródło: " + esc(f.zrodlo) : ""}</span><br>${esc([f.sytuacja, f.dzialanie, f.rezultat, f.opis, f.co_zrobiono, f.co_wymaga_uwagi, f.krok ? `${f.cel}: ${f.krok}` : ""].filter(Boolean).join(" · "))}</li>`;
  // Opis linku „źródło”: rodzaj i data faktu (z S.briefJson.fakty), np. „Źródło: informacja z 22.09.2026”
  const srcTitle = id => {
    const f = ((S.briefJson && S.briefJson.fakty) || []).find(x => x.id === id);
    const kind = { I: "informacja", C: "rozmowa miesięczna", F: "informacja zwrotna", G: "krok celu" }[id[0]] || "fakt";
    return f && f.data ? `Źródło: ${kind} z ${isoToPl(f.data)}` : `Źródło: ${kind} ${id}`;
  };
  const briefInline = t => esc(t).replace(/\s*\[([IFCG][0-9.]+)\]/g, (m, id) => ` <a class="src-link" href="#fact-${id.replace(/\./g, "-")}" data-fact="${id}" aria-label="${esc(srcTitle(id))}" title="${esc(srcTitle(id))}">źródło</a>`);
  // Tekst wielowierszowy (brief, odpowiedzi AI, plan rozwoju): „Nagłówek:” -> h3, „- …” -> lista punktowana, „1. …” -> lista numerowana, reszta -> akapit
  function briefHtml(text, plain) {
    let out = "", open = "";
    const close = () => { if (open) { out += `</${open}>`; open = ""; } };
    const start = tag => { if (open !== tag) { close(); out += `<${tag} class="c">`; open = tag; } };
    String(text).replace(/\r/g, "").split("\n").forEach(raw => {
      const l = raw.trim().replace(/^#{1,4}\s+/, "").replace(/\*\*/g, ""); if (!l) return;
      let m;
      if ((m = /^[-*•]\s+(.*)$/.exec(l))) { start("ul"); out += `<li>${briefInline(m[1])}</li>`; return; }
      if ((m = /^\d+[.)]\s+(.*)$/.exec(l))) { start("ol"); out += `<li>${briefInline(m[1])}</li>`; return; }
      close();
      if (/^[^.!?]{2,70}:$/.test(l)) out += `<h3>${esc(l.replace(/:$/, ""))}</h3>`; else out += `<p${plain ? "" : ' class="muted"'}>${briefInline(l)}</p>`;
    });
    close(); return out;
  }
  const aiRich = t => `<div class="ai-out brief-text">${briefHtml(t, true)}</div>`;
  async function briefModal(empId) {
    const emp = (S.dash.team || []).find(t => t.id === empId);
    openModal(`<h2 id="brTitle">Brief do rozmowy – ${first(emp ? emp.name : "")}</h2><p class="muted">Tematy, przykłady z zebranych informacji z odnośnikami do faktów, pytania otwarte. Bez ocen i punktów. Zwykle 10–30 s.</p><div id="brBody">${thinkingHtml(`Model AI ${aiWhere()} przygotowuje brief z zebranych informacji…`)}</div>`, null, "brTitle");
    const body = $("#brBody");
    const stop = startThinking(body);
    let r; try { r = await api("POST", "/api/ai/brief", { employeeId: empId }); } catch (ex) { stop(); if (body.isConnected) body.innerHTML = `<p class="muted">${esc(errMsg(ex))}</p>`; return; }
    stop(); if (!body.isConnected) return; S.briefJson = r.json;
    const j = r.json;
    body.innerHTML = `<p class="muted">Okres ${esc(isoToPl(j.okres.od))} – ${esc(isoToPl(j.okres.do))} · ${j.fakty.length} faktów · ${r.source === "ai" ? "Przygotował asystent AI" : "Przygotowano bez modelu AI (reguły)"}. Brief to propozycja – nie zawiera ocen ani wyniku.</p>
      <div class="ai-out brief-text">${briefHtml(String(r.brief).replace(/Kryteria bez informacji:\s*\n\s*[-*•]\s*brak\.?\s*$/i, "Wszystkie kryteria mają zebrane informacje."))}</div>
      <h3 id="brFacts" class="br-facts-h">Fakty, na które powołuje się brief</h3><p class="muted">Każdy link „źródło” w briefie prowadzi do jednego z faktów poniżej: zapisanej informacji, rozmowy miesięcznej, informacji zwrotnej albo kroku celu.</p>${j.fakty.length ? `<ul class="ev-list">${j.fakty.map(factLine).join("")}</ul>` : `<p class="muted">Brak wpisów w okresie.</p>`}
      <details class="adv"><summary>Dla zaawansowanych: dane w formacie JSON</summary><pre class="json-out" tabindex="0" aria-label="Dane w formacie JSON">${esc(JSON.stringify(j, null, 2))}</pre><button class="btn sm" data-act="briefDownload">Pobierz JSON</button></details>
      <div class="btns"><button type="button" class="btn g" data-act="closeModal">Zamknij</button></div>`;
    bindActs(body);
  }
  // Przełożony: okno z celami pracownika (dodawanie, potwierdzanie kroków)
  async function goalsModal(empId) {
    const emp = (S.dash.team || []).find(t => t.id === empId);
    const [goals, dp] = await Promise.all([api("GET", `/api/goals?employeeId=${empId}`).then(r => r.goals), api("GET", `/api/devplan?employeeId=${empId}`)]);
    S.goalsCtx = { empId, where: "modal" };
    openModal(`<h2 id="gmTitle">Cele i plan rozwoju – ${first(emp ? emp.name : "")}</h2>
      <p class="muted">Pracownik zgłasza wykonanie kroku, Ty potwierdzasz. Postęp liczy tylko potwierdzone kroki.</p>
      <div class="btns" style="justify-content:flex-start;margin-top:0;border:0;padding-top:0"><button class="btn" data-act="newGoalFor" data-emp="${empId}">${KK_ICON("plus")}<span>Nowy cel</span></button></div>
      ${goalTiles(goals, "mgr")}
      <h3>Plan rozwoju i komunikat</h3>
      <p class="muted">Pracownik zobaczy to w swoim profilu („Plan rozwoju”). Każda zmiana zostaje w historii i w dzienniku.${dp.current ? ` Ostatnia zmiana: ${esc(isoToPl(dp.current.created.slice(0, 10)))}.` : ""}</p>
      <form id="dpForm" novalidate>
        <label class="f" for="dpPlan">Plan rozwoju (działania, szkolenia, terminy)</label><textarea id="dpPlan" required minlength="10" maxlength="3000">${esc(dp.current?.plan || "")}</textarea>
        <label class="f" for="dpMsg">Komunikat do pracownika (opcjonalnie)</label><textarea id="dpMsg" maxlength="1000">${esc(dp.current?.message || "")}</textarea>
        <div class="field-err" id="dpErr" role="alert"></div>
        <div class="btns"><button type="button" class="btn g" data-act="closeModal">Zamknij</button><button class="btn" type="submit">Zapisz plan</button></div>
      </form>`, () => {
      $("#dpForm").addEventListener("submit", async e => {
        e.preventDefault();
        try { const r = await api("PUT", "/api/devplan", { employeeId: empId, plan: $("#dpPlan").value, message: $("#dpMsg").value }); $("#dpErr").textContent = ""; toast(r.changed ? "Zapisano plan rozwoju." : "Bez zmian."); }
        catch (ex) { $("#dpErr").textContent = ex.message; }
      });
    }, "gmTitle");
    fillTrends(empId);
  }
  async function loadMonthGoals() {
    const box = $("#monthGoals"); if (!box || !S.month.employeeId) return;
    try { const goals = (await api("GET", `/api/goals?employeeId=${S.month.employeeId}`)).goals; box.innerHTML = `<div class="row"><h2>Cele</h2><button class="btn sm" data-act="newGoalFor" data-emp="${esc(S.month.employeeId)}">${KK_ICON("plus")}<span>Nowy cel</span></button></div>${goalTiles(goals, "mgr")}`; fillTrends(S.month.employeeId); }
    catch (ex) { box.innerHTML = `<p class="muted">${esc(errMsg(ex))}</p>`; }
  }
  // Po zmianie celu odśwież miejsce, w którym pracuje użytkownik
  async function refreshGoals() {
    if (S.user.role === "pracownik") { await refreshData(); return render(); }
    if ($("#modal") && S.goalsCtx?.where === "modal") return goalsModal(S.goalsCtx.empId);
    if (S.view === "month") return loadMonthGoals();
    await refreshData(); render();
  }
  // ---------- Plan rozwoju: wnioski z oceny + obszary + przejście do celów ----------
  function devPlan(d, items) {
    const mp = d.devPlan ? `<div class="note"><b>Od przełożonego</b> · ${esc(isoToPl(d.devPlan.created.slice(0, 10)))}<div class="plan-text">${briefHtml(d.devPlan.plan, true)}</div>${d.devPlan.message ? `<p style="margin:8px 0 0"><b>Komunikat:</b> ${esc(d.devPlan.message)}</p>` : ""}</div>` : "";
    return mp + devPlanFromEval(d, items, !!d.devPlan);
  }
  function devPlanFromEval(d, items, hasPlan) {
    const weak = items.filter(([, x]) => x.avg < 5).slice(0, 3).map(([k]) => k); // tylko poniżej poziomu oczekiwań (5 pkt)
    const areas = weak.length ? `<h3>Obszary poniżej poziomu oczekiwań</h3><ul class="c">${weak.map(k => `<li>${esc(nameOf(k))}</li>`).join("")}</ul><p class="muted">Cele ustala przełożony – zaproponuj cel z tych obszarów na rozmowie miesięcznej.</p>` : "";
    if (d.latestDev) {
      const e = d.latestDevEval;
      return `<h3>Wnioski rozwojowe z oceny</h3><p class="muted">Zapisał przełożony${e ? ` w ocenie „${esc(TYP[e.typ])}” za okres ${esc(isoToPl(e.periodFrom || ""))} – ${esc(isoToPl(e.periodTo || ""))}` : ""}.</p>
        <div class="plan-text">${briefHtml(d.latestDev, true)}</div>${areas}
        <div class="btns" style="justify-content:flex-start">${e ? `<button class="btn sm g" data-act="readEval" data-id="${e.id}">${KK_ICON("eye")}<span>Zobacz ocenę</span></button>` : ""}<button class="btn sm" data-nav="goals">${KK_ICON("flag")}<span>Przejdź do celów</span></button></div>`;
    }
    if (hasPlan) return areas;
    const last = d.evals[0];
    const why = !last ? "Nie masz jeszcze złożonej oceny." : last.status === "submitted" ? "Ocena jest złożona – wnioski przełożony zapisze po rozmowie oceniającej." : "Przełożony nie zapisał wniosków rozwojowych w ostatniej ocenie.";
    return `<p class="muted">${why} Cele ustala przełożony – swoje propozycje zgłoś na rozmowie miesięcznej.</p>${areas}
      <div class="btns" style="justify-content:flex-start"><button class="btn sm" data-nav="goals">${KK_ICON("flag")}<span>Przejdź do celów</span></button></div>`;
  }
  // Informacje z okresu oceny pogrupowane według kompetencji (pracownik: własne, jeśli moduł jest włączony)
  async function loadEvalEvidence(e) {
    const boxes = document.querySelectorAll("[data-comp-ev]"); if (!boxes.length) return;
    const q = new URLSearchParams();
    if (/^\d{4}-\d{2}-\d{2}$/.test(e.period_from || "")) q.set("from", e.period_from);
    if (/^\d{4}-\d{2}-\d{2}$/.test(e.period_to || "")) q.set("to", e.period_to);
    if (S.user.role === "przelozony") q.set("employeeId", e.employee_id);
    let list = [];
    try { list = (await api("GET", `/api/evidence?${q}`)).evidence; } catch (_) { list = null; }
    boxes.forEach(box => {
      const mine = (list || []).filter(x => x.competency === box.dataset.compEv);
      box.innerHTML = list === null ? `<p class="muted">Informacje są niedostępne (moduł wyłączony w ustawieniach).</p>`
        : !mine.length ? `<p class="muted">Brak zapisanych informacji przy tej kompetencji w okresie oceny.</p>`
        : `<ul class="ev-list">${mine.map(x => `<li><span class="muted">${esc(isoToPl(x.date))} · ${esc(x.indicatorText)}</span><br><b>Sytuacja:</b> ${esc(x.situation)} · <b>Działanie:</b> ${esc(x.action)} · <b>Rezultat:</b> ${esc(x.result)} ${safeLink(x.link)}</li>`).join("")}</ul>`;
    });
  }
  // Gdzie działa model AI: lokalnie (Ollama) albo na serwerze zewnętrznym (tryb zgodny z OpenAI, KK_AI_KEY)
  const aiWhere = () => (S.ai && S.ai.remote ? "zewnętrzny" : "lokalnie");
  const normEvals = list => list.map(e => ({ id: e.id, typ: e.typ, status: e.status, periodFrom: e.period_from, periodTo: e.period_to, employeeId: e.employee_id, ackAt: e.ack_at || null }));

  // ---------- Elementy wspólne ----------
  const pill = st => `<span class="tag ${STATUS[st][1]}">${STATUS[st][0]}</span>`;
  const bar = (v, max = 9) => `<div class="bar" style="--w:${v === null || v === undefined ? 0 : Math.min(100, v / max * 100).toFixed(0)}%"><i></i></div>`;
  const isMand = (k, typ) => { const L = (typ || (S.cur && S.cur.typ)) === "C" ? S.mandC : S.mandB; return L.some(m => k.startsWith(m)); };
  const first = name => esc(String(name || "").replace(/ \(demo\)/, ""));
  function countUp(el) {
    const to = parseFloat(el.dataset.to); if (isNaN(to)) return;
    const dec = el.dataset.dec ? +el.dataset.dec : 0; const t0 = performance.now(); const dur = 400;
    const step = t => { const p = Math.min(1, (t - t0) / dur); el.textContent = (to * (1 - Math.pow(1 - p, 3))).toFixed(dec).replace(".", ","); if (p < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
  // Tabele na telefonie jako karty: każda komórka dostaje etykietę z nagłówka kolumny (CSS: td::before)
  function labelTables() {
    document.querySelectorAll("table.table").forEach(t => {
      if (t.dataset.labelled === String(t.rows.length)) return;
      const hs = [...t.querySelectorAll("thead th")].map(h => h.textContent.trim());
      t.querySelectorAll("tbody tr").forEach(tr => [...tr.children].forEach((td, i) => { if (td.tagName === "TD" && hs[i] && !td.hasAttribute("data-label") && td.colSpan === 1) td.setAttribute("data-label", hs[i]); }));
      t.dataset.labelled = String(t.rows.length);
    });
  }
  { let tm = 0; new MutationObserver(() => { clearTimeout(tm); tm = setTimeout(labelTables, 30); }).observe(document.documentElement, { childList: true, subtree: true }); }
  function animateIn(root = document) {
    requestAnimationFrame(() => {
      root.querySelectorAll(".bar").forEach(b => b.classList.add("on"));
      root.querySelectorAll(".radar .poly").forEach(p => p.classList.add("on"));
      root.querySelectorAll(".timeline .line").forEach(l => l.classList.add("on"));
      root.querySelectorAll("[data-to]").forEach(countUp);
    });
  }
  const SHORT = { "WYKORZYSTYWANIE WIEDZY": "Wykorzystywanie wiedzy", "ORGANIZACJA PRACY": "Organizacja pracy", "ORIENTACJA NA KLIENTA": "Orientacja na klienta", "RADZENIE SOBIE W SYTUACJIACH KR": "Sytuacje kryzysowe", "PODEJMOWANIE DECYZJI I ODPOWIED": "Podejmowanie decyzji", "ZARZĄDZANIE STRATEGICZNE": "Zarządzanie strategiczne" };
  const shortName = k => SHORT[k] || nameOf(k);
  function radar(scores, withList) {
    const items = Object.entries(scores).filter(([, v]) => v.avg !== null);
    if (items.length < 3) return `<p class="muted">Wykres pojawi się, gdy ocenionych będzie co najmniej 3 kompetencje.</p>`;
    const N = items.length, C = 230, CY = 180, R = 95;
    const pt = (i, r) => { const a = -Math.PI / 2 + i * 2 * Math.PI / N; return [C + r * Math.cos(a), CY + r * Math.sin(a)]; };
    const rings = [0.33, 0.66, 1].map(f => `<polygon points="${items.map((_, i) => pt(i, R * f).join(",")).join(" ")}" fill="none" stroke="var(--ln)"/>`).join("");
    const axes = items.map((_, i) => { const [x, y] = pt(i, R); return `<line x1="${C}" y1="${CY}" x2="${x}" y2="${y}" stroke="var(--ln)"/>`; }).join("");
    const poly = items.map(([, v], i) => pt(i, R * v.avg / 9).join(",")).join(" ");
    // Etykiety w dwóch wierszach (do 16 znaków każdy); pełna nazwa zawsze w <title>
    const wrap = full => { const w = full.split(" "), L = [""]; w.forEach(x => { const l = L[L.length - 1]; if (l && (l + " " + x).length > 15 && L.length < 2) L.push(x); else L[L.length - 1] = l ? l + " " + x : x; }); return L.map((l, i) => (l.length > 17 && (i === L.length - 1)) ? l.slice(0, 16).trim() + "…" : l); };
    const labels = items.map(([k], i) => { const [x, y] = pt(i, R + 14), full = nameOf(k), ls = wrap(shortName(k)), anc = x < C - 8 ? "end" : x > C + 8 ? "start" : "middle", y0 = y + (y < CY - 5 ? -(ls.length - 1) * 16 : 5);
      return `<text x="${x.toFixed(1)}" y="${y0.toFixed(1)}" font-size="15" text-anchor="${anc}" fill="var(--tx)"><title>${esc(full)}</title>${ls.map((l, n) => `<tspan x="${x.toFixed(1)}" dy="${n ? 16 : 0}">${esc(l)}</tspan>`).join("")}</text>`; }).join("");
    const svg = `<svg class="radar" viewBox="0 0 460 360" role="img" aria-label="Profil kompetencji, skala 1 do 9 punktów, 5 punktów to poziom oczekiwań">${rings}${axes}${[3, 6, 9].map(p => `<text x="${C + 5}" y="${(CY - R * p / 9 + 12).toFixed(1)}" font-size="12" font-weight="700" fill="var(--mu)" stroke="var(--card,#fff)" stroke-width="4" paint-order="stroke" stroke-linejoin="round">${p}</text>`).join("")}<polygon class="poly" points="${poly}" fill="rgba(44,111,209,.22)" stroke="var(--blue)" stroke-width="2"/>${labels}</svg><p class="muted radar-scale">Skala 1–9 pkt, 5 pkt = na poziomie oczekiwań. Cyfry na wykresie to pierścienie: 3, 6 i 9 pkt.</p>`;
    return withList ? `<div class="radar-box"><div class="radar-desk">${svg}</div><div class="radar-mob">${scoreBars(Object.fromEntries(Object.entries(scores).sort((a, b) => (a[1].avg ?? 99) - (b[1].avg ?? 99))))}<p class="muted radar-scale">Skala 1–9 pkt, 5 pkt = na poziomie oczekiwań.</p></div></div>` : svg;
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
    lastPageKey = ""; window.scrollTo(0, 0);
    $("#root").innerHTML = `
      <div class="login"><div class="login-main"><div class="login-grid">
      <div class="login-card">
        <div class="brand"><div class="brandmark" aria-hidden="true">K</div><div><h1>Kompas Kompetencji</h1><div class="muted">System wspierający ocenę okresową w służbie cywilnej</div></div></div>
        <div class="demo-row" role="group" aria-label="Szybkie logowanie na konto prezentacyjne">
          <button type="button" class="demo-btn" data-demo="przelozony" title="Wypełnij dane logowania przełożonego"><span aria-hidden="true">${KK_ICON("star")}</span><span>Wejdź jako przełożony</span></button>
          <button type="button" class="demo-btn" data-demo="pracownik" title="Wypełnij dane logowania pracownika"><span aria-hidden="true">${KK_ICON("user")}</span><span>Wejdź jako pracownik</span></button>
        </div>
        <form id="loginForm" novalidate>
          <label class="f" for="lEmail">Adres e-mail</label>
          <input id="lEmail" type="email" autocomplete="username" required>
          <label class="f" for="lPass">Hasło</label>
          <input id="lPass" type="password" autocomplete="current-password" required>
          <button class="btn w" style="margin-top:16px" type="submit">Zaloguj się</button>
          ${err ? `<div class="err" role="alert">${esc(err)}</div>` : ""}
        </form>
        <p class="note">Rozwiązanie gotowe do wdrożenia w urzędzie: logowanie przez system tożsamości urzędu (SSO) włączane przy instalacji. Prezentacja działa na przykładowych danych.</p>
      </div></div></div>${footer("foot-login")}</div>`;
    // Konta demo z konfiguracji serwera (GET /api/demo); hasło tylko, gdy to publiczna wartość lokalna
    const demoRow = $(".demo-row");
    fetch("/api/demo").then(r => r.json()).then(d => {
      if (!d.enabled) { demoRow.hidden = true; return; }
      const DEMO = { przelozony: d.manager, pracownik: d.employee };
      document.querySelectorAll("[data-demo]").forEach(b => b.addEventListener("click", () => {
        $("#lEmail").value = DEMO[b.dataset.demo]; if (d.password) $("#lPass").value = d.password; $("#lPass").focus();
      }));
    }).catch(() => { demoRow.hidden = true; });
    $("#loginForm").addEventListener("submit", async e => {
      e.preventDefault();
      try {
        const j = await api("POST", "/api/login", { email: $("#lEmail").value, password: $("#lPass").value });
        S.user = j.user; S.view = "home";
        if (j.user.mustChange) return renderPasswordChange();
        await load(); render();
      } catch (ex) { const em = $("#lEmail").value; renderLogin(ex.message); $("#lEmail").value = em; $("#lPass").focus(); }
    });
  }

  // ---------- Aktywacja konta i zmiana hasła ----------
  // Karta jak przy logowaniu; formularz z dwoma polami nowego hasła (min. 12 znaków, sprawdza też serwer)
  const PASS_HINT = "Co najmniej 12 znaków, bez nazwy konta i popularnych haseł.";
  const authCard = (title, sub, body) => `
      <div class="login"><div class="login-main"><div class="login-grid">
      <div class="login-card">
        <div class="brand"><div class="brandmark" aria-hidden="true">K</div><div><h1>${esc(title)}</h1><div class="muted">${esc(sub)}</div></div></div>
        ${body}
      </div></div>${footer("foot-login")}</div>`;
  const newPassFields = `
          <label class="f" for="pNew">Nowe hasło</label>
          <input id="pNew" type="password" autocomplete="new-password" minlength="12" maxlength="200" required aria-describedby="pHint">
          <small id="pHint" class="muted">${PASS_HINT}</small>
          <label class="f" for="pNew2">Powtórz nowe hasło</label>
          <input id="pNew2" type="password" autocomplete="new-password" minlength="12" maxlength="200" required>`;
  const passErr = () => ($("#pNew").value.length < 12 ? "Hasło musi mieć co najmniej 12 znaków." : $("#pNew").value !== $("#pNew2").value ? "Hasła nie są takie same." : "");
  const showErr = msg => { $("#pErr").textContent = msg; if (msg) $("#pNew").focus(); };
  function renderActivation(token) {
    $("#root").innerHTML = authCard("Aktywacja konta", "Ustal hasło do Kompasu Kompetencji", `
        <form id="actForm" novalidate>${newPassFields}
          <button class="btn w" style="margin-top:16px" type="submit">Aktywuj konto</button>
          <div class="err" id="pErr" role="alert"></div>
        </form>
        <p class="note">Hasło znasz tylko Ty – przełożony go nie widzi. Link działa jednorazowo przez 24 godziny.</p>`);
    $("#pNew").focus();
    $("#actForm").addEventListener("submit", async e => {
      e.preventDefault();
      const bad = passErr(); if (bad) return showErr(bad);
      try {
        const r = await api("POST", "/api/activate", { token, password: $("#pNew").value });
        history.replaceState(null, "", location.pathname);
        renderLogin(); $("#lEmail").value = r.email; $("#lPass").focus(); toast("Konto aktywne. Zaloguj się nowym hasłem.");
      } catch (ex) { showErr(ex.message); }
    });
  }
  function renderPasswordChange() {
    $("#root").innerHTML = authCard("Zmień hasło", "Hasło nadała inna osoba – ustal własne, aby kontynuować", `
        <form id="pwForm" novalidate>
          <label class="f" for="pCur">Obecne hasło</label>
          <input id="pCur" type="password" autocomplete="current-password" required>${newPassFields}
          <button class="btn w" style="margin-top:16px" type="submit">Zmień hasło</button>
          <div class="err" id="pErr" role="alert"></div>
        </form>
        <p class="note">Po zmianie hasła pozostałe sesje na tym koncie zostaną wylogowane.</p>
        <button class="btn g w" type="button" id="pwLogout">Wyloguj</button>`);
    $("#pCur").focus();
    $("#pwLogout").addEventListener("click", async () => { await api("POST", "/api/logout").catch(() => {}); S.user = null; renderLogin(); });
    $("#pwForm").addEventListener("submit", async e => {
      e.preventDefault();
      const bad = passErr(); if (bad) return showErr(bad);
      try {
        await api("POST", "/api/password", { current: $("#pCur").value, next: $("#pNew").value });
        toast("Hasło zmienione."); S.view = "home"; await load(); render();
      } catch (ex) { showErr(ex.message); }
    });
  }
  function footer(extra = "") {
    return `<footer class="foot-gov ${extra}">
      <div class="foot-t"><b>Kompas Kompetencji</b><small>Wsparcie oceny okresowej w służbie cywilnej · zgodnie z rozporządzeniem Prezesa Rady Ministrów z 4 kwietnia 2016 r.</small></div>
    </footer>`;
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
    S.assistant = await api("GET", "/api/assistant");
    const st = await api("GET", "/api/settings"); S.modules = Object.fromEntries(st.modules.map(x => [x.key, x.on])); S.moduleList = st.modules;
    const m = await fetch("/api/model").then(r => r.json()); S.mandB = m.mandB || []; S.mandC = m.mandC || []; S.maxExtra = m.maxExtra || 3;
    await refreshData();
  }

  // ---------- Powłoka: sticky menu boczne (desktop) + dolna nawigacja (mobile) ----------
  function shell(content, navView, title, sub, opts = {}) {
    const u = S.user, pages = PAGES[u.role];
    const aiPill = S.ai.ok ? `<span class="pill on" title="${S.ai.remote ? "Model na serwerze zewnętrznym" : "Model lokalny"}: ${esc(S.ai.model)}">Asystent AI: dostępny</span>` : `<span class="pill off" title="Model AI jest niedostępny – asystent podpowiada na podstawie reguł">Asystent AI: tryb podpowiedzi bez modelu</span>`;
    const navItems = pages.filter(([v]) => !MODULE_OF[v] || (S.modules || {})[MODULE_OF[v]] !== false);
    const mkBtn = ([v, t, i]) => `<button data-nav="${v}" ${navView === v ? 'aria-current="page"' : ""}><span class="ic" aria-hidden="true">${KK_ICON(i)}</span><span class="lbl">${t}</span></button>`;
    const navBtns = navItems.map(mkBtn).join("");
    const needMore = true;
    const MOB = u.role === "pracownik" ? ["home", "goals", "evals", "profile"] : ["home", "evals", "month", "evidence"];
    const ordered = [...MOB.map(v => navItems.find(n => n[0] === v)).filter(Boolean), ...navItems.filter(n => !MOB.includes(n[0]))];
    const mainItems = ordered.slice(0, 4), moreItems = ordered.slice(4);
    const moreActive = moreItems.some(([v]) => v === navView);
    const bottomNav = `<nav class="bottom" aria-label="Nawigacja mobilna" style="grid-template-columns:repeat(${mainItems.length + (needMore ? 1 : 0)},1fr)">${mainItems.map(mkBtn).join("")}${needMore ? `<button type="button" class="more-btn" id="moreBtn" aria-haspopup="true" aria-expanded="false" aria-controls="morePanel" ${moreActive ? 'aria-current="true"' : ""}><span class="ic" aria-hidden="true">⋯</span><span class="lbl">Więcej</span></button>` : ""}${needMore ? `<div class="more-panel" id="morePanel" role="group" aria-label="Pozostałe pozycje menu" hidden><div class="more-ai">${aiPill}</div>${moreItems.map(mkBtn).join("")}<button type="button" data-act="logout"><span class="ic" aria-hidden="true">⎋</span><span class="lbl">Wyloguj</span></button></div>` : ""}</nav>`;
    return `
      <div class="app">
        <a class="skip" href="#view">Przejdź do treści</a>
        <aside class="side" aria-label="Menu główne">
          <div class="brand"><span class="kk-brand"><img class="kk-mark" src="app/assets/icon-kk.png" alt="" width="44" height="44"><img class="side-logo" src="app/assets/logo-kk.svg" alt="Kompas Kompetencji 2027" width="200" height="37"></span></div>
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
            <span class="spacer"></span><span class="hdr-ai">${aiPill}</span>
            <button class="btn sm g hdr-logout${needMore ? " hdr-logout-more" : ""}" data-act="logout" ><span aria-hidden="true">⎋</span> Wyloguj</button>
          </header>
          <main class="view" id="view" tabindex="-1">
            ${opts.hidePageHead ? "" : `<div class="page-h"><h1 tabindex="-1">${esc(title)}</h1><p class="why">${esc(sub)}</p></div>`}
            ${content}
          </main>
          ${footer()}
          ${bottomNav}
        </div>
      </div>`;
  }

  let lastPageKey = "";
  // ---------- Listy wyboru w stylu systemu (zamiast natywnej listy przeglądarki) ----------
  // Natywny <select> zostaje w DOM (ukryty, czytany przez resztę kodu i wysyłany w formularzach);
  // obok powstaje przycisk i lista zgodna z polami formularza. Klawiatura: strzałki, Home/End, Enter, Spacja, Esc.
  let selSeq = 0, selObserving = false;
  function selSync(sel) {
    const w = sel.parentNode; const btn = w.querySelector(".kk-sel-btn"); const list = w.querySelector(".kk-sel-list");
    const opt = sel.options[sel.selectedIndex];
    btn.textContent = opt ? opt.textContent : "";
    btn.disabled = sel.disabled;
    [...list.children].forEach((li, i) => li.setAttribute("aria-selected", String(i === sel.selectedIndex)));
  }
  function selClose(w, focusBtn) {
    const btn = w.querySelector(".kk-sel-btn"), list = w.querySelector(".kk-sel-list");
    list.hidden = true; btn.setAttribute("aria-expanded", "false");
    if (focusBtn) btn.focus();
  }
  function selOpen(w, sel) {
    document.querySelectorAll(".kk-sel").forEach(o => { if (o !== w) selClose(o, false); });
    const btn = w.querySelector(".kk-sel-btn"), list = w.querySelector(".kk-sel-list");
    selSync(sel); list.hidden = false; btn.setAttribute("aria-expanded", "true");
    selActive(w, sel.selectedIndex < 0 ? 0 : sel.selectedIndex);
    list.focus({ preventScroll: true });
  }
  function selActive(w, i) {
    const list = w.querySelector(".kk-sel-list"); const items = [...list.children];
    if (!items.length) return;
    i = Math.max(0, Math.min(items.length - 1, i));
    items.forEach((li, j) => li.classList.toggle("kk-on", j === i));
    list.setAttribute("aria-activedescendant", items[i].id);
    items[i].scrollIntoView({ block: "nearest" });
    w.dataset.active = String(i);
  }
  function selPick(w, sel, i) {
    if (sel.selectedIndex !== i) { sel.selectedIndex = i; sel.dispatchEvent(new Event("change", { bubbles: true })); }
    selSync(sel); selClose(w, true);
  }
  function enhanceSelects(root) {
    root.querySelectorAll("select:not([data-kk])").forEach(sel => {
      sel.dataset.kk = "1"; sel.classList.add("kk-native"); sel.tabIndex = -1; sel.setAttribute("aria-hidden", "true");
      const w = document.createElement("div"); w.className = "kk-sel";
      sel.parentNode.insertBefore(w, sel); w.appendChild(sel);
      const id = "kks" + (++selSeq);
      const btn = document.createElement("button"); btn.type = "button"; btn.className = "kk-sel-btn"; btn.id = id + "-btn";
      btn.setAttribute("aria-haspopup", "listbox"); btn.setAttribute("aria-expanded", "false"); btn.setAttribute("aria-controls", id + "-list");
      const list = document.createElement("ul"); list.className = "kk-sel-list"; list.id = id + "-list"; list.setAttribute("role", "listbox"); list.tabIndex = -1; list.hidden = true;
      [...sel.options].forEach((o, i) => {
        const li = document.createElement("li"); li.id = id + "-o" + i; li.setAttribute("role", "option"); li.textContent = o.textContent;
        li.addEventListener("mousedown", e => e.preventDefault());
        li.addEventListener("click", () => selPick(w, sel, i));
        list.appendChild(li);
      });
      w.appendChild(btn); w.appendChild(list);
      // etykieta wskazuje na przycisk (klik i czytnik ekranu trafiają w widoczny element)
      if (sel.id) root.querySelectorAll(`label[for="${sel.id}"]`).forEach(l => { l.htmlFor = btn.id; if (!l.id) l.id = id + "-lbl"; btn.setAttribute("aria-labelledby", l.id); sel.setAttribute("aria-label", l.textContent.trim()); });
      if (!btn.hasAttribute("aria-labelledby") && sel.getAttribute("aria-label")) btn.setAttribute("aria-label", sel.getAttribute("aria-label"));
      list.setAttribute("aria-label", sel.getAttribute("aria-label") || "Lista wyboru");
      btn.addEventListener("click", () => (list.hidden ? selOpen(w, sel) : selClose(w, true)));
      btn.addEventListener("keydown", e => {
        if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) { e.preventDefault(); selOpen(w, sel); }
        else if (e.key.length === 1 && /\S/.test(e.key)) { // skok do opcji zaczynającej się na wpisaną literę
          const k = [...sel.options].findIndex(o => o.textContent.toLowerCase().startsWith(e.key.toLowerCase()));
          if (k >= 0) { sel.selectedIndex = k; selSync(sel); sel.dispatchEvent(new Event("change", { bubbles: true })); }
        }
      });
      list.addEventListener("keydown", e => {
        const i = Number(w.dataset.active || 0);
        if (e.key === "ArrowDown") { e.preventDefault(); selActive(w, i + 1); }
        else if (e.key === "ArrowUp") { e.preventDefault(); selActive(w, i - 1); }
        else if (e.key === "Home") { e.preventDefault(); selActive(w, 0); }
        else if (e.key === "End") { e.preventDefault(); selActive(w, list.children.length - 1); }
        else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selPick(w, sel, i); }
        else if (e.key === "Escape") { e.preventDefault(); selClose(w, true); }
        else if (e.key === "Tab") { selClose(w, false); }
      });
      selSync(sel);
    });
  }
  function initSelects() {
    // Obserwujemy całe body: okna modalne (np. „Nowy feedback”) są dokładane poza #root
    enhanceSelects(document.body);
    if (selObserving) return;
    selObserving = true;
    new MutationObserver(() => enhanceSelects(document.body)).observe(document.body, { childList: true, subtree: true });
    document.addEventListener("mousedown", e => { document.querySelectorAll(".kk-sel").forEach(w => { if (!w.contains(e.target)) selClose(w, false); }); });
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
      html = S.view === "ai" ? aiPage() : u.role === "pracownik" ? empPage(S.view) : mgrPage(S.view);
    }
    // Fokus: przy zmianie strony/kroku przenosimy go na treść (czytnik ogłasza nowy widok);
    // przy odświeżeniu tej samej strony (np. wybór poziomu) wracamy do tego samego pola
    const pageKey = S.view + (S.view === "wizard" && S.cur ? ":" + S.cur.step : "");
    const a = document.activeElement;
    const sel = a && a !== document.body && root.contains(a) ? (a.id ? "#" + CSS.escape(a.id)
      : a.name ? `[name="${CSS.escape(a.name)}"][value="${CSS.escape(a.value)}"]`
      : a.dataset.act ? `[data-act="${CSS.escape(a.dataset.act)}"]${a.dataset.id ? `[data-id="${CSS.escape(a.dataset.id)}"]` : ""}`
      : a.dataset.nav ? `.side-nav [data-nav="${CSS.escape(a.dataset.nav)}"]` : a.dataset.wiz ? `[data-wiz="${CSS.escape(a.dataset.wiz)}"]` : null) : null;
    const pageChanged = pageKey !== lastPageKey; lastPageKey = pageKey;
    root.innerHTML = shell(html, navView, title, sub, opts);
    if (pageChanged) window.scrollTo(0, 0);
    if (pageChanged && sel) { const vw = $("#view"); const h = vw && (vw.querySelector("h1") || vw.querySelector("h2")); if (h) { if (!h.hasAttribute("tabindex")) h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true }); } else if (vw) vw.focus({ preventScroll: true }); }
    else if (sel) document.querySelector(sel)?.focus({ preventScroll: true });
    bindShell();
    initSelects();
    animateIn(root);
    if (S.view === "log") loadLog();
    if (S.view === "evidence") { bindEvidencePage(); loadEvidence(); if (u.role === "pracownik") loadEmployeeExtras(); }
    if (S.view === "month") { bindMonthPage(); loadMonth(); S.goalsCtx = { empId: +S.month.employeeId, where: "month" }; loadMonthGoals(); }
    if (S.view === "summary") { bindSummaryPage(); loadSummary(); }
    if (S.view === "results") loadMetrics();
    if (S.view === "goals" && u.role === "pracownik") fillTrends(null);
    if (S.view === "profile" && u.role === "pracownik") loadCompare(null);
    if (S.view === "evalView" && S.readEval) { loadSigs(S.readEval.id, S.readEval.status); loadEvalEvidence(S.readEval); }
    if (S.view === "wizard" && S.cur && S.cur.status !== "draft") loadSigs(S.cur.id, S.cur.status);
    if (S.view === "wizard") bindWizard();
  }
  function go(view) {
    S.view = view;
    if (view === "wizard" || view === "evalView") return render();
    refreshData().then(render).catch(e => toast(errMsg(e)));
    window.scrollTo(0, 0);
  }
  function bindShell() {
    document.querySelectorAll("[data-nav]").forEach(b => b.addEventListener("click", () => go(b.dataset.nav)));
    const mb = document.getElementById("moreBtn"), mp = document.getElementById("morePanel");
    if (mb && mp) {
      const closeMore = focus => { mp.hidden = true; mb.setAttribute("aria-expanded", "false"); if (focus) mb.focus(); };
      mb.addEventListener("click", () => { if (mp.hidden) { mp.hidden = false; mb.setAttribute("aria-expanded", "true"); mp.querySelector("button")?.focus(); } else closeMore(true); });
      mp.addEventListener("keydown", e => {
        if (e.key === "Escape") { e.stopPropagation(); closeMore(true); }
        else if (e.key === "Tab") { const b = [...mp.querySelectorAll("button")]; if (e.shiftKey && document.activeElement === b[0]) { e.preventDefault(); closeMore(true); } else if (!e.shiftKey && document.activeElement === b[b.length - 1]) closeMore(false); }
      });
      document.addEventListener("click", e => { if (!mp.hidden && !mp.contains(e.target) && !mb.contains(e.target)) closeMore(false); });
    }
    document.querySelectorAll("[data-act]").forEach(b => b.addEventListener("click", e => act(b.dataset.act, b, e)));
    document.querySelectorAll("[data-go-eval]").forEach(b => b.addEventListener("click", () => openWizard(+b.dataset.goEval).catch(e => toast(errMsg(e)))));
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
      else if (last && last.status === "discussed" && d.latestDev) next = { t: "Rozmowa za Tobą – zajrzyj do planu rozwoju", s: "Przełożony zapisał wnioski rozwojowe. Zobacz plan i zaproponuj cele na rozmowie miesięcznej.", btn: "Plan rozwoju", go: "profile" };
      else if (last && last.status === "discussed") next = { t: "Ocena omówiona – ustal cele na kolejny okres", s: "Przełożony nie zapisał wniosków rozwojowych. Zaproponuj cel, który omówicie.", btn: "Otwórz cele", go: "goals" };
      else next = { t: "Sprawdź swoje cele", s: "Zaktualizuj postęp, zanim przyjdzie czas na ocenę.", btn: "Otwórz cele", go: "goals" };
      return `
        <section class="next card anim">
          <div><h2>${esc(next.t)}</h2><p class="muted">${esc(next.s)}</p></div>
          <button class="btn btn-next" data-nav="${next.go}"><span>${esc(next.btn)}</span>${KK_ICON("arrow")}</button></section>
        <section class="card" aria-labelledby="prepH"><h2 id="prepH">Przygotuj się do rozmowy</h2>
          <p class="muted">Przygotowanie do rozmowy miesięcznej lub oceniającej: asystent podpowie, o co może zapytać przełożony, co warto przygotować i o co Ty możesz zapytać. Nie ocenia i niczego nie zapisuje.</p>
          ${(S.modules || {}).mod_ai !== false ? `<button class="btn" data-act="aiPrep">${KK_ICON("spark")}<span>Podpowiedz pytania</span></button>` : `<p class="muted">Asystent AI jest wyłączony w ustawieniach.</p>`}
          <div id="aiPrepOut" aria-live="polite"></div></section>
        <div class="kpis">
          <div class="kpi"><b data-to="${d.evals.length}" data-dec="0">0</b><span>Złożone oceny</span></div>
          <div class="kpi"><b data-to="${openGoals}" data-dec="0">0</b><span>Cele w toku</span></div>
          <div class="kpi"><b>${last ? pill(last.status) : "—"}</b><span>Status ostatniej oceny</span></div>
        </div>
        ${d.kickoff && !d.kickoff.evalId ? `<div class="card"><h2>Rozmowa rozpoczynająca okres oceny (${esc(isoToPl(d.kickoff.date))})</h2>
          <p class="muted">${esc(TYP[d.kickoff.typ])}. Ustalenia z rozmowy z przełożonym – na ich podstawie będzie sporządzona ocena.</p>
          <h3>Kryteria</h3><ul class="c">${d.kickoff.criteria.map(c => `<li>${esc(c.n)}${c.mandatory ? "" : " (dodatkowe)"}</li>`).join("")}</ul>
          <h3>Obowiązki</h3><p>${esc(d.kickoff.duties)}</p><h3>Oczekiwania</h3><p>${esc(d.kickoff.expectations)}</p><h3>Cele</h3><p>${esc(d.kickoff.goals)}</p>
          ${d.kickoff.ackAt ? `<p class="muted">Zapoznanie potwierdzone ${esc(plDT(d.kickoff.ackAt.slice(0, 10)))}. Od tego dnia liczy się okres oceny.</p>`
            : `<p class="muted">Potwierdzenie odpowiada podpisowi części I arkusza. Od dnia zapoznania liczy się okres oceny.</p><button class="btn" data-act="ackKickoff" data-id="${d.kickoff.id}">Potwierdzam zapoznanie</button>`}</div>` : ""}
        ${(d.upcoming || []).map(u2 => `<div class="card"><h2>Przygotowywana ocena: kryteria i termin</h2>
          <p class="muted">${esc(TYP[u2.typ])} · okres ${esc(u2.periodFrom ? isoToPl(u2.periodFrom) : "—")} – ${esc(u2.periodTo ? isoToPl(u2.periodTo) : "—")} · termin sporządzenia: <b>${esc(u2.terminOceny ? isoToPl(u2.terminOceny) : "nie ustalono")}</b></p>
          <ul class="c">${u2.criteria.map(n => `<li>${esc(n)}</li>`).join("")}</ul>
          <p class="muted">Masz wgląd w kryteria i termin przed złożeniem oceny (§ 6 rozporządzenia). Poziomy zobaczysz po złożeniu.</p></div>`).join("")}
        <div class="card"><h2>Gdzie jesteś w procesie</h2>${last ? timeline(last.status) : `<p class="muted">Gdy przełożony przygotuje ocenę, zobaczysz tu jej postęp.</p>`}
          <p class="muted">Ocena opisuje zachowania z okresu, a nie Twoją osobę. Masz prawo zapoznać się z nią przed rozmową.</p></div>`;
    }
    if (v === "profile") {
      const sc = d.latestScores || {};
      const items = Object.entries(sc).filter(([, x]) => x.avg !== null).sort((a, b) => a[1].avg - b[1].avg);
      return `
        <div class="grid two prof-grid">
          <div class="card prof-plan"><h2>Plan rozwoju</h2>${devPlan(d, items)}</div>
          <div class="card prof-areas"><h2>Obszary do rozwoju</h2>${(() => { const below = items.filter(([, x]) => x.avg < 5);
            return `<p class="muted">${below.length ? "Kryteria poniżej poziomu oczekiwań (5 pkt), od najniższej oceny." : "Wszystkie kryteria są na poziomie oczekiwań lub wyżej. Poniżej trzy z najniższą oceną."}</p>`; })()}${items.length ? scoreBars(Object.fromEntries((items.filter(([, x]) => x.avg < 5).length ? items.filter(([, x]) => x.avg < 5) : items.slice(0, 3)).slice(0, 5)))
            + `<p class="muted" style="margin:12px 0 8px">Omów to z przełożonym na rozmowie miesięcznej.</p><div class="btns" style="justify-content:flex-start;margin-top:0"><button class="btn" data-act="aiDev">${KK_ICON("spark")}<span>Zaplanuj działania z asystentem</span></button><button class="btn sm g" data-act="readEval" data-id="${d.latestEvalId}">${KK_ICON("eye")}<span>Szczegóły w ocenie</span></button></div>` : `<p class="muted">Brak danych. Pojawią się po złożeniu oceny.</p>`}</div>
          <div class="card prof-comp"><h2>Profil kompetencji</h2><p class="muted">Średnie z ostatniej złożonej oceny. Im wyższy wynik, tym mocniejsza kompetencja.</p>${radar(sc, true)}</div>
          <div class="card prof-asst"><h2>Asystent rozwoju</h2>
            <p class="muted">Propozycje działań SMART na podstawie Twoich celów i obszarów do rozwoju. Decyzję podejmujesz Ty i przełożony.</p>
            <button class="btn" data-act="aiDev" id="aiDevBtn">Zapytaj asystenta</button>
            <div id="aiDevOut" aria-live="polite"></div></div>
        </div>
        <div class="card" id="cmpBox"><h2>Zmiana między ocenami okresowymi</h2><p class="muted">Wczytywanie…</p></div>`;
    }
    if (v === "goals") {
      return `<p class="muted" style="margin:0 0 12px">Cele ustala przełożony. Gdy wykonasz krok, zgłoś to – przełożony potwierdzi. Postęp liczy tylko potwierdzone kroki.</p>
        ${goalTiles(S.goals, "emp")}`;
    }
    if (v === "evidence") return evidencePage(false);
    // evals
    return evalsList(false);
  }
  function evalsList(isMgr) {
    const names = Object.fromEntries((S.dash.team || []).map(t => [t.id, t.name]));
    const newBtn = isMgr ? `<div class="row evals-head"><p class="muted">Szkic możesz zapisać i wrócić do niego później. Złożoną ocenę pracownik zobaczy w swoim panelu.</p><button class="btn" data-act="newEval">${KK_ICON("plus")}<span>Nowa ocena</span></button></div>` : "";
    if (!S.evals.length) return `<div class="card">${newBtn}<p class="muted">Brak ocen do wyświetlenia.</p></div>`;
    const rows = S.evals.map(e => {
      const edit = isMgr && e.status === "draft";
      return `<tr><td>${esc(TYP[e.typ])}</td>${isMgr ? `<td>${first(names[e.employeeId])}</td>` : ""}
        <td>${esc(isoToPl(e.periodFrom || ""))} – ${esc(isoToPl(e.periodTo || ""))}</td><td>${pill(e.status)}</td>
        ${isMgr ? `<td>${e.status === "draft" ? "—" : e.ackAt ? `zapoznano ${esc(plDT(e.ackAt).slice(0, 10))}` : "pracownik jeszcze nie potwierdził"}</td>` : ""}
        <td style="text-align:right">${edit ? actBtn("edit", "Dokończ", `data-act="openEval" data-id="${e.id}"`) : actBtn("eye", "Podgląd", `data-act="readEval" data-id="${e.id}" aria-label="Podgląd oceny – ${first(isMgr ? names[e.employeeId] : S.user.name)}"`)}</td></tr>`;
    }).join("");
    return `<div class="card">${newBtn}<div style="overflow-x:auto"><table class="table"><thead><tr><th scope="col">Rodzaj</th>${isMgr ? "<th>Pracownik</th>" : ""}<th>Okres</th><th>Status</th>${isMgr ? "<th>Zapoznanie</th>" : ""}<th></th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  }

  // ---------- Przełożony ----------
  function mgrPage(v) {
    if (v === "settings") return settingsPage();
    // Dziennik zdarzeń: kto, kiedy i co zmienił (z poprzednią i nową wartością) – wypełnia loadLog()
    if (v === "log") return `<div class="card"><h2>Dziennik zdarzeń</h2><p class="muted">Każda zmiana ocen, informacji, informacji zwrotnej, celów i planów rozwoju – z autorem, czasem oraz poprzednią i nową wartością. Integralność chroni łańcuch skrótów.</p><div id="logBody" aria-live="polite"><p class="muted">Wczytywanie…</p></div></div>`;
    const d = S.dash, c = d.counts;
    if (v === "home") {
      const todo = d.team.filter(t => t.status === "none" || t.status === "draft");
      const toDiscuss = d.team.filter(t => t.status === "submitted");
      const status = todo.length ? `Ocen do przygotowania: ${todo.length}` : toDiscuss.length ? `Ocen do omówienia z pracownikami: ${toDiscuss.length}` : "Wszystkie oceny są przygotowane";
      // „Ocena w 3 krokach”: krok 1 dla pierwszej osoby bez zapisanej rozmowy rozpoczynającej, krok 3 dla pierwszej z oceną do omówienia
      const kickEmp = d.team.find(t => !t.kickoff) || d.team[0] || null;
      const briefEmp = toDiscuss[0] || d.team.find(t => t.status !== "none") || d.team[0] || null;
      // Zespół: w kolumnie osoby tylko informacje, wszystkie działania w jednej kolumnie (główne + kryteria + cele)
      const rows = d.team.map(t => {
        const main = t.status === "none"
          ? actBtn("plus", "Utwórz ocenę", `data-act="newEval" data-emp="${t.id}" aria-label="Utwórz ocenę – ${first(t.name)}"`, "")
          : t.status === "draft" ? actBtn("edit", "Dokończ ocenę", `data-act="openEval" data-id="${t.evalId}" aria-label="Dokończ ocenę – ${first(t.name)}"`, "")
          : t.status === "submitted" ? actBtn("msg", "Omów ocenę", `data-act="openEval" data-id="${t.evalId}" aria-label="Omów ocenę – ${first(t.name)}"`)
          : actBtn("eye", "Otwórz ocenę", `data-act="openEval" data-id="${t.evalId}" aria-label="Otwórz ocenę – ${first(t.name)}"`);
        const kickLbl = !t.kickoff ? "Ustal kryteria" : t.kickoff.ackAt ? "Kryteria" : "Edytuj kryteria";
        const kick = actBtn("star", kickLbl, `data-act="kickoff" data-emp="${t.id}" aria-label="${kickLbl} – rozmowa rozpoczynająca – ${first(t.name)}"`);
        const goals = actBtn("flag", t.goalsToConfirm ? `Cele (${t.goalsToConfirm} do potw.)` : "Cele", `data-act="mgrGoals" data-emp="${t.id}" aria-label="Cele – ${first(t.name)}${t.goalsToConfirm ? `, ${t.goalsToConfirm} do potwierdzenia` : ""}"`);
        const kickTxt = t.kickoff ? `Rozmowa rozpoczynająca ${esc(isoToPl(t.kickoff.date))} · ${t.kickoff.ackAt ? "zapoznano" : "czeka na zapoznanie"}` : "Brak rozmowy rozpoczynającej";
        return `
        <tr><td><div class="who-row">${avatar(t.avatar, t.name)}<div><b>${first(t.name)}</b><div class="muted">${esc(t.position || "")}</div>
          ${t.pending ? `<div class="team-pend"><span class="tag wr">konto nieaktywne</span> <button class="btn sm g" data-act="resendActivation" data-emp="${t.id}">Nowy link aktywacyjny</button></div>` : ""}
          <div class="muted team-kick">${kickTxt}</div></div></div></td>
          <td>${t.typ ? esc(TYP[t.typ]) : "—"}</td><td style="white-space:nowrap">${pill(t.status)}</td><td style="white-space:nowrap">${t.nextDue ? esc(isoToPl(t.nextDue)) : "—"}${t.earliestNext ? `<div class="muted">najwcześniej ${esc(isoToPl(t.earliestNext))}</div>` : ""}</td>
          <td><div class="team-acts">${main}${kick}${goals}</div></td></tr>`;
      }).join("");
      return `
        <section class="card steps3" aria-labelledby="s3H"><h2 id="s3H">Ocena w 3 krokach</h2><p class="muted">${esc(status)} · zacznij od kroku 1, potem przejdź do kolejnych.</p>
          <ol class="s3-list">
            <li><span class="vn" aria-hidden="true">1</span><div><b>Ustal kryteria</b><span class="t">Rozmowa rozpoczynająca z pracownikiem. Asystent AI podpowie kryteria dla jego stanowiska.</span>
              ${kickEmp ? `<button class="btn" data-act="kickoff" data-emp="${kickEmp.id}" aria-label="Ustal kryteria – rozmowa rozpoczynająca – ${first(kickEmp.name)}">${KK_ICON("star")}<span>Ustal kryteria</span></button>` : ""}</div></li>
            <li><span class="vn" aria-hidden="true">2</span><div><b>Zbierz informacje i oceń</b><span class="t">Zapisuj fakty z pracy i wypełnij ocenę krok po kroku. Kreator pilnuje, żeby nic nie pominąć.</span>
              <button class="btn" data-nav="evals"><span>Zbierz informacje i oceń</span>${KK_ICON("arrow")}</button></div></li>
            <li><span class="vn" aria-hidden="true">3</span><div><b>Przygotuj rozmowę</b><span class="t">Brief z zebranych faktów: tematy i pytania otwarte, bez ocen i punktów.</span>
              ${briefEmp ? `<button class="btn" data-act="aiBrief" data-emp="${briefEmp.id}" aria-label="Przygotuj rozmowę – brief – ${first(briefEmp.name)}">${KK_ICON("msg")}<span>Przygotuj rozmowę</span></button>` : ""}</div></li>
          </ol></section>
        ${alertsCard(d.alerts)}
        <div class="kpis">
          <div class="kpi"><b data-to="${d.team.length}">0</b><span>Pracownicy w zespole<small>Osoby przypisane do Ciebie.</small></span></div>
          <div class="kpi"><b data-to="${c.none + c.draft}">0</b><span>Do przygotowania<small>Oceny bez szkicu lub niedokończone.</small></span></div>
          <div class="kpi"><b data-to="${c.submitted}">0</b><span>Złożone<small>Oceny gotowe do rozmowy.</small></span></div>
          <div class="kpi"><b data-to="${c.discussed}">0</b><span>Omówione<small>Oceny po rozmowie z pracownikiem.</small></span></div>
        </div>
        ${d.deadlines && d.deadlines.length ? (() => { const urgent = d.deadlines.filter(x => x.days !== null && x.days <= 60).length; const next = d.deadlines.filter(x => x.due).map(x => x.due).sort()[0];
          return `<details class="card dl-card"${urgent ? " open" : ""}><summary><h2>Terminy ocen okresowych</h2><span class="muted">${urgent ? `${urgent} ${urgent === 1 ? "termin wymaga" : "terminy wymagają"} uwagi` : next ? `najbliższy termin: ${esc(isoToPl(next))}` : "brak terminów"}</span></summary><p class="muted">Termin liczony z ostatniej oceny okresowej: 24 miesiące (art. 81 ustawy). Osoby po pierwszej ocenie dostają termin po pierwszej ocenie okresowej.</p>
          <div style="overflow-x:auto"><table class="table"><thead><tr><th scope="col">Pracownik</th><th scope="col">Ostatnia ocena</th><th scope="col">Termin</th><th scope="col">Status</th></tr></thead><tbody>${d.deadlines.map(x => `<tr><td>${first(x.name)}</td><td>${x.lastEval ? esc(isoToPl(x.lastEval)) : "—"}</td><td>${x.due ? esc(isoToPl(x.due)) : "—"}</td><td><span class="tag ${x.days === null ? "" : x.days < 0 ? "bad" : x.days <= 60 ? "wr" : "info"}">${x.days === null ? "brak oceny okresowej" : x.days < 0 ? "termin minął" : `za ${x.days} dni`}</span></td></tr>`).join("")}</tbody></table></div></details>`; })() : ""}
        <div class="card"><div class="row"><h2>Zespół</h2><button class="btn sm" data-act="addEmp">+ Dodaj pracownika</button></div>
          <div style="overflow-x:auto"><table class="table team-table"><thead><tr><th scope="col">Pracownik</th><th scope="col">Ocena</th><th scope="col">Status</th><th scope="col">Kolejna ocena (cykl 24 mies.)</th><th scope="col"><span class="sr">Akcje</span></th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
    }
    if (v === "results") {
      const agg = d.aggregate;
      const body = agg.suppressed
        ? `<div class="note warn">Wyniki zespołu pokazujemy od ${agg.kMin} złożonych ocen (ochrona prywatności) – obecnie ${agg.n}.</div>`
        : `<p class="muted">Średnie z ${agg.n} ocen. Widok zbiorczy: nie pokazuje wyników pojedynczych osób.</p>${agg.competencies.map(x => `<div class="sb"><div class="row"><span class="sb-l">${compIc(x.k)}${esc(nameOf(x.k))}</span><span class="muted">${fmt(x.avg)} pkt</span></div>${bar(x.avg)}</div>`).join("")}`;
      return `<div class="grid two">
        <div class="card"><h2>Wyniki zespołu</h2><p class="muted">Wyniki zespołu pokazujemy od ${agg.kMin} złożonych ocen (ochrona prywatności). Metryki wsparcia przełożonych – od ${agg.kMin} przełożonych.</p>${body}</div>
        <div class="card" id="metricsCard"><h2>Czy aplikacja pomaga w ocenie? (metryki zbiorcze)</h2><p class="muted">Wczytywanie…</p></div>
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

  // ---------- Informacje: obserwacje przy wskaźnikach (sytuacja – działanie – rezultat) ----------
  const IND = MODEL.flatMap(c => c.w.map((w, wi) => ({ key: c.k + "|" + wi, k: c.k, wi, text: w.w.replace(/\n/g, " ") })));
  const indLabel = key => { const i = IND.find(x => x.key === key); return i ? `${nameOf(i.k)} – ${i.wi + 1}. ${i.text}` : key; };
  const indOptions = (sel, onlyK) => MODEL.filter(c => !onlyK || c.k === onlyK).map(c => `<optgroup label="${esc(nameOf(c.k))}">${c.w.map((w, wi) => {
    const key = c.k + "|" + wi; return `<option value="${esc(key)}" ${sel === key ? "selected" : ""}>${wi + 1}. ${esc(w.w.replace(/\n/g, " ").slice(0, 90))}</option>`; }).join("")}</optgroup>`).join("");
  const compOptions = sel => MODEL.map(c => `<option value="${esc(c.k)}" ${sel === c.k ? "selected" : ""}>${esc(nameOf(c.k))}</option>`).join("");
  const empOptions = sel => ((S.dash && S.dash.team) || []).map(t => `<option value="${t.id}" ${+sel === t.id ? "selected" : ""}>${first(t.name)}</option>`).join("");
  const empName = id => first(((S.dash && S.dash.team) || []).find(t => t.id === +id)?.name || "");
  const safeLink = u => (/^https?:\/\//i.test(u || "") ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">link<span class="sr"> (otwiera się w nowej karcie)</span></a>` : "");
  function evidenceTable(list, { editable, showEmp }) {
    if (!list.length) return `<p class="muted">Brak informacji dla wybranych filtrów.</p>`;
    return `<div style="overflow-x:auto"><table class="table"><caption class="sr">Informacje (${list.length})</caption><thead><tr><th scope="col">Data</th>${showEmp ? `<th scope="col">Pracownik</th>` : ""}<th scope="col">Wskaźnik</th><th scope="col">Sytuacja · działanie · rezultat</th><th scope="col">Nr zadania i link do dokumentu</th>${editable ? `<th scope="col"><span class="sr">Akcje</span></th>` : ""}</tr></thead><tbody>
      ${list.map(e => `<tr><td style="white-space:nowrap">${esc(isoToPl(e.date))}</td>${showEmp ? `<td>${empName(e.employeeId)}</td>` : ""}<td>${esc(indLabel(e.indicator))}</td>
        <td><b>Sytuacja:</b> ${esc(e.situation)}<br><b>Działanie:</b> ${esc(e.action)}<br><b>Rezultat:</b> ${esc(e.result)}</td>
        <td>${esc(e.taskRef || "")} ${safeLink(e.link)}</td>${editable ? `<td style="text-align:right">${actBtn("edit", "Edytuj", `data-act="editEvidence" data-id="${e.id}" aria-label="Edytuj informację z ${esc(isoToPl(e.date))} – ${esc(indShort(e.indicator))}"`)}</td>` : ""}</tr>`).join("")}
      </tbody></table></div>`;
  }
  function evidencePage(isMgr) {
    const f = S.evFilter;
    return `<div class="card"><h2 id="evFiltH">Filtry</h2>
      <form id="evFilter" class="grid two" aria-labelledby="evFiltH" novalidate>
        ${isMgr ? `<div><label class="f" for="fEmp">Pracownik</label><select id="fEmp" name="employeeId"><option value="">Cały zespół</option>${empOptions(f.employeeId)}</select></div>` : ""}
        <div><label class="f" for="fComp">Kompetencja</label><select id="fComp" name="competency"><option value="">Wszystkie</option>${compOptions(f.competency)}</select></div>
        <div><label class="f" for="fInd">Wskaźnik</label><select id="fInd" name="indicator"><option value="">Wszystkie</option>${indOptions(f.indicator, f.competency)}</select></div>
        <div><label class="f" for="fFrom">Od</label>${dateFieldHtml("fFrom", f.from)}</div>
        <div><label class="f" for="fTo">Do</label>${dateFieldHtml("fTo", f.to)}</div>
        <div class="btns" style="justify-content:flex-start;align-self:end"><button class="btn" type="submit">Pokaż</button>
          ${isMgr ? `<button class="btn g" type="button" data-act="addEvidence">+ Dodaj informację</button>` : ""}</div>
      </form></div>
      <div class="card"><h2>Informacje</h2><p class="muted">${isMgr ? "Opisz obserwowalne działanie i jego rezultat. Nie opisuj cech osoby." : "Obserwacje zapisane przez przełożonego. Masz do nich wgląd w każdej chwili."}</p>
        <div id="evList" aria-live="polite"><p class="muted">Ładowanie…</p></div></div>
      ${isMgr ? "" : `<div class="card"><h2>Informacja zwrotna o rezultatach zadań</h2><div id="fbMine"><p class="muted">Ładowanie…</p></div></div>
        <div class="card"><h2>Rozmowy miesięczne</h2><div id="ciMine"><p class="muted">Ładowanie…</p></div></div>
        <div class="card"><h2>Oceny cząstkowe kwartalne</h2><p class="muted">Przyznaje przełożony, z uzasadnieniem i wskazaniem informacji.</p><div id="pqMine"><p class="muted">Ładowanie…</p></div></div>`}`;
  }
  const lvlTxt = l => (l ? `${l} pkt` : "bez poziomu");
  function feedbackList(list, editable) {
    if (!list.length) return `<p class="muted">Brak informacji zwrotnej.</p>`;
    return `<ul class="c">${list.map(f => `<li><span class="muted">${esc(isoToPl(f.date))} · ${esc(indLabel(f.indicator))} · ${esc(f.relationLabel)} · ${esc(lvlTxt(f.level))}</span><br>
      <b>Źródło:</b> ${esc(f.source)}<br>${esc(f.justification)}${editable ? ` ${actBtn("edit", "Edytuj", `data-act="editFeedback" data-id="${f.id}" aria-label="Edytuj informację zwrotną z ${esc(isoToPl(f.date))}"`)}` : ""}</li>`).join("")}</ul>`;
  }
  const checkinText = c => `<b>${esc(monthPl(c.month))}</b> · ${c.status === "odbyty" ? `rozmowa ${esc(isoToPl(c.date || ""))}` : "planowana"}${c.done ? `<br><b>Co zrobiono:</b> ${esc(c.done)}` : ""}${c.attention ? `<br><b>Co wymaga uwagi:</b> ${esc(c.attention)}` : ""}${c.goal ? `<br><b>Cel:</b> ${esc(c.goal)}` : ""}`;
  const partialText = p => `<b>${esc(quarterPl(p.quarter))}</b> · ${esc(nameOf(p.competency))}: <b>${p.pts} pkt</b> – ${esc(p.justification)} <span class="muted">(informacje: ${p.evidenceIds.length})</span>`;
  async function loadEmployeeExtras() {
    const put = (id, html) => { const el = $("#" + id); if (el) el.innerHTML = html; };
    try {
      const [fb, ci, pq] = await Promise.all([api("GET", "/api/feedback"), api("GET", "/api/checkins"), api("GET", "/api/partials")]);
      put("fbMine", feedbackList(fb.feedback, false));
      put("ciMine", ci.checkins.length ? `<ul class="c">${ci.checkins.map(c => `<li>${checkinText(c)}</li>`).join("")}</ul>` : `<p class="muted">Brak rozmów.</p>`);
      put("pqMine", pq.partials.length ? `<ul class="c">${pq.partials.map(p => `<li>${partialText(p)}</li>`).join("")}</ul>` : `<p class="muted">Brak ocen cząstkowych.</p>`);
    } catch (e) { put("fbMine", `<p class="muted">${esc(errMsg(e))}</p>`); }
  }

  // ---------- Przegląd miesiąca (przełożony): check-in, informacje według wskaźników, feedback ----------
  // Lista miesięcy po polsku (24 ostatnie) zamiast natywnego pola, którego język zależy od przeglądarki
  const monthOptions = sel => { const d = new Date(), out = []; for (let i = 0; i < 24; i++) { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); out.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`); }
    if (sel && !out.includes(sel)) out.push(sel);
    return out.map(v => `<option value="${v}"${v === sel ? " selected" : ""}>${esc(monthPl(v))}</option>`).join(""); };
  // „2026-Q4” → „IV kwartał 2026”
  const quarterPl = q => { const m = /^(\d{4})-Q([1-4])$/.exec(q || ""); return m ? `${["I", "II", "III", "IV"][+m[2] - 1]} kwartał ${m[1]}` : q || ""; };
  const quarterOf = m => `${m.slice(0, 4)}-Q${Math.floor((+m.slice(5, 7) - 1) / 3) + 1}`;
  function monthPage() {
    const m = S.month;
    if (!m.employeeId && S.dash.team.length) m.employeeId = String(S.dash.team[0].id);
    return `<div class="card"><form id="monthForm" class="grid two" aria-label="Wybór pracownika i miesiąca" novalidate>
        <div><label class="f" for="mEmp">Pracownik</label><select id="mEmp" name="employeeId">${empOptions(m.employeeId)}</select></div>
        <div><label class="f" for="mMonth">Miesiąc</label><select id="mMonth" name="month">${monthOptions(m.month)}</select></div>
        <div class="btns" style="justify-content:flex-start"><button class="btn" type="submit">Pokaż</button></div>
      </form></div>
      <div id="monthBody" aria-live="polite"><p class="muted">Ładowanie…</p></div>
      <div class="card" id="monthGoals" aria-live="polite"><p class="muted">Ładowanie celów…</p></div>`;
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
      box.innerHTML = `<div class="card"><h2 id="ciH">Rozmowa miesięczna</h2>
          <p class="muted">Do 20 minut. Trzy pola i informacje z miesiąca. Bez punktacji i bez oceny osoby.</p>
          <form id="ciForm" aria-labelledby="ciH" novalidate>
            <label class="f" for="ciDone">Co zrobiono</label><textarea id="ciDone" maxlength="600" ${ro}>${esc(c.done)}</textarea>
            <label class="f" for="ciAtt">Co wymaga uwagi</label><textarea id="ciAtt" maxlength="600" ${ro}>${esc(c.attention)}</textarea>
            <label class="f" for="ciGoal">Jeden cel na kolejny miesiąc</label><input id="ciGoal" maxlength="600" value="${esc(c.goal)}" ${ro}>
            <div class="grid two"><div><label class="f" for="ciDate">Data rozmowy</label>${dateFieldHtml("ciDate", c.date || "")}</div>
              <div><span class="f" id="ciStL">Status</span><label class="choice"><input type="checkbox" id="ciStatus" aria-describedby="ciStL" ${c.status === "odbyty" ? "checked" : ""}><span>Rozmowa odbyta</span></label></div></div>
            <div id="ciErr" role="alert" class="err"></div>
            <div class="btns" style="justify-content:flex-start"><button class="btn" type="submit">${d.checkin ? "Zapisz zmiany" : "Zapisz rozmowę miesięczną"}</button>
              <button class="btn g" type="button" data-act="aiCheckin">Zaproponuj pytania do rozmowy (AI)</button>
              <button class="btn g" type="button" data-act="aiBrief" data-emp="${esc(m.employeeId)}">Przygotuj brief do rozmowy</button></div>
          </form><div id="aiCkOut" aria-live="polite"></div>
          <p class="note">Asystent widzi tylko nazwy wskaźników i liczbę informacji. Nie zapisuje niczego i nie proponuje ocen.</p></div>
        <div class="card"><div class="row"><h2>Informacje z miesiąca (${d.evidenceCount})</h2>${actBtn("plus", "Informacja", `data-act="addEvidence" data-emp="${esc(m.employeeId)}" data-after="month"`, "")}</div>
          <p class="muted">Pokazujemy tylko wskaźniki z nowymi informacjami w tym miesiącu. Pozostałe są ukryte, żeby nie generować pustych ocen.</p>
          ${d.groups.length ? d.groups.map(g => `<div class="ind"><h3 class="h-comp">${compIc(g.competency)}${esc(nameOf(g.competency))}</h3><p class="muted">${esc(g.text.replace(/\n/g, " "))}</p>
            <ul class="c">${g.evidence.map(e => `<li><span class="muted">${esc(isoToPl(e.date))}</span> <b>Sytuacja:</b> ${esc(e.situation)} · <b>Działanie:</b> ${esc(e.action)} · <b>Rezultat:</b> ${esc(e.result)} ${safeLink(e.link)}
              ${actBtn("edit", "Edytuj", `data-act="editEvidence" data-id="${e.id}" data-after="month" aria-label="Edytuj informację z ${esc(isoToPl(e.date))} – ${esc(indShort(e.indicator))}"`)}</li>`).join("")}</ul></div>`).join("") : `<p class="muted">Brak informacji w tym miesiącu.</p>`}</div>
        <div class="card"><div class="row"><h2>Informacja zwrotna z miesiąca</h2>${actBtn("plus", "Informacja zwrotna", `data-act="addFeedback"`, "")}</div>
          <p class="muted">Informacja zwrotna dotyczy rezultatu zadania, nie osoby. Nie zapisujemy czasu pracy, obecności ani aktywności.</p>${feedbackList(d.feedback, true)}</div>
        <div class="card"><div class="row"><h2>Oceny cząstkowe – ${esc(quarterPl(quarterOf(m.month)))}</h2>${actBtn("plus", "Ocena cząstkowa", `data-act="addPartial"`, "")}</div>
          <p class="muted">Przypisane do kwartału, nie do miesiąca. Przyznajesz je Ty, z uzasadnieniem i wskazaniem informacji.</p>
          ${pq.partials.length ? `<ul class="c">${pq.partials.map(p => `<li>${partialText(p)} ${actBtn("edit", "Edytuj", `data-act="editPartial" data-id="${p.id}" aria-label="Edytuj ocenę cząstkową: ${esc(nameOf(p.competency))}"`)}</li>`).join("")}</ul>` : `<p class="muted">Brak ocen cząstkowych w tym kwartale.</p>`}</div>`;
      bindActs(box);
      const cd = bindDate("ciDate");
      $("#ciForm").addEventListener("submit", async e => {
        e.preventDefault();
        const ciIso = readDate(cd, "ciDate"); if (ciIso === null) { $("#ciDate").focus(); return; }
        const body = { done: $("#ciDone").value, attention: $("#ciAtt").value, goal: $("#ciGoal").value, date: ciIso, status: $("#ciStatus").checked ? "odbyty" : "planowany" };
        try {
          if (d.checkin) await api("PUT", `/api/checkins/${d.checkin.id}`, body);
          else await api("POST", "/api/checkins", { ...body, employeeId: +m.employeeId, month: m.month });
          toast("Zapisano rozmowę miesięczną."); loadMonth();
        } catch (ex) { $("#ciErr").textContent = fieldErrors(ex); }
      });
    } catch (e) { box.innerHTML = `<div class="card"><p class="muted">${esc(errMsg(e))}</p></div>`; }
  }
  function bindMonthPage() {
    const fm = $("#monthForm"); if (!fm) return;
    fm.addEventListener("submit", e => { e.preventDefault(); S.month.employeeId = $("#mEmp").value; S.month.month = $("#mMonth").value || S.month.month; S.goalsCtx = { empId: +S.month.employeeId, where: "month" }; loadMonth(); loadMonthGoals(); });
  }
  const RELATIONS = { przelozony: "przełożony bezpośredni", wspolpracownik: "współpracownik (przekazane przełożonemu)", odbiorca: "odbiorca rezultatu (przekazane przełożonemu)" };
  function feedbackModal(fb) {
    const v = fb || { indicator: "", source: "", level: null, justification: "", relation: "przelozony", date: new Date().toISOString().slice(0, 10) };
    openModal(`<h2 id="fbTitle">${fb ? "Edytuj informację zwrotną" : "Nowa informacja zwrotna"}</h2>
      <p class="muted">Opisz rezultat konkretnego zadania. Nie oceniaj osoby. Nie zapisuj czasu pracy, obecności ani aktywności.</p>
      <form id="fbForm" novalidate>
        <label class="f" for="fbInd">Wskaźnik</label><select id="fbInd" required><option value="">Wybierz…</option>${indOptions(v.indicator)}</select>
        <label class="f" for="fbSrc">Źródło zdarzenia (zadanie, sprawa, dokument)</label><input id="fbSrc" required maxlength="300" value="${esc(v.source)}">
        <label class="f" for="fbJust">Uzasadnienie (wymagane)</label><textarea id="fbJust" required minlength="10" maxlength="2000">${esc(v.justification)}</textarea>
        <label class="f" for="fbRel">Relacja autora do rezultatu</label><select id="fbRel">${Object.entries(RELATIONS).map(([k, l]) => `<option value="${k}" ${v.relation === k ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>
        <label class="f" for="fbLvl">Poziom (opcjonalnie)</label><select id="fbLvl"><option value="">bez poziomu</option>${PTS5.map((p, i) => `<option value="${p}" ${v.level === p ? "selected" : ""}>${p} pkt – ${LEVELS5[i]}</option>`).join("")}</select>
        <label class="f" for="fbDate">Data zdarzenia</label>${dateFieldHtml("fbDate", v.date, "required")}
        <div id="fbErr" role="alert" class="err"></div>
        <div class="btns"><button type="button" class="btn g" data-act="closeModal">Anuluj</button><button class="btn" type="submit">Zapisz</button></div>
      </form>`, () => {
      const fd = bindDate("fbDate");
      $("#fbForm").addEventListener("submit", async e => {
        e.preventDefault();
        const fbIso = fd.iso(); if (!fbIso) { $("#fbDate").focus(); return; }
        const body = { indicator: $("#fbInd").value, source: $("#fbSrc").value, justification: $("#fbJust").value, relation: $("#fbRel").value, level: $("#fbLvl").value ? +$("#fbLvl").value : null, date: fbIso };
        try {
          if (fb) await api("PUT", `/api/feedback/${fb.id}`, body); else await api("POST", "/api/feedback", { ...body, employeeId: +S.month.employeeId });
          closeModal(); toast("Zapisano informację zwrotną."); loadMonth();
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
    const evBoxes = k => { const list = evs.filter(e => e.competency === k); return list.length ? list.map(e => `<label class="choice"><input type="checkbox" name="pqEv" value="${e.id}" ${v.evidenceIds.includes(e.id) ? "checked" : ""}><span><span class="muted">${esc(isoToPl(e.date))}</span> ${esc(e.action)} → ${esc(e.result)}</span></label>`).join("") : `<p class="muted">Brak informacji z tego kryterium w kwartale. Najpierw dodaj informację.</p>`; };
    openModal(`<h2 id="pqTitle">${pr ? "Edytuj ocenę cząstkową" : "Ocena cząstkowa"} – ${esc(quarterPl(q))}</h2>
      <p class="muted">Ocenę przyznajesz Ty w skali 1/3/5/7/9. System jej nie podpowiada. Wymagane są uzasadnienie i co najmniej jedną informację z kwartału.</p>
      <form id="pqForm" novalidate>
        <label class="f" for="pqComp">Kryterium</label><select id="pqComp" required ${pr ? "disabled" : ""}><option value="">Wybierz…</option>${compOptions(v.competency)}</select>
        <fieldset class="plain"><legend class="f">Ocena cząstkowa</legend><div class="lv" role="radiogroup" aria-label="Ocena cząstkowa">
          ${PTS5.map((p, i) => `<label><input type="radio" name="pqPts" value="${p}" ${v.pts === p ? "checked" : ""}><span><b>${p} pkt</b> ${LEVELS5[i]}</span></label>`).join("")}</div></fieldset>
        <label class="f" for="pqJust">Uzasadnienie</label><textarea id="pqJust" required minlength="10" maxlength="2000">${esc(v.justification)}</textarea>
        <fieldset class="plain"><legend class="f">Informacje z kwartału</legend><div id="pqEvs">${v.competency ? evBoxes(v.competency) : `<p class="muted">Wybierz kryterium.</p>`}</div></fieldset>
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
    catch (e) { box.innerHTML = `<p class="muted">${esc(errMsg(e))}</p>`; }
  }
  function bindEvidencePage() {
    const fm = $("#evFilter"); if (!fm) return;
    const hF = bindDate("fFrom"), hT = bindDate("fTo");
    fm.addEventListener("submit", e => { e.preventDefault(); const fd = new FormData(fm);
      const from = readDate(hF, "fFrom"), to = readDate(hT, "fTo");
      if (from === null) { $("#fFrom").focus(); return; } if (to === null) { $("#fTo").focus(); return; }
      Object.keys(S.evFilter).forEach(k => { S.evFilter[k] = fd.get(k) || ""; }); S.evFilter.from = from; S.evFilter.to = to; loadEvidence(); });
    $("#fComp")?.addEventListener("change", e => { $("#fInd").innerHTML = `<option value="">Wszystkie</option>${indOptions("", e.target.value)}`; });
  }
  const fieldErrors = ex => (ex.data && ex.data.fields ? Object.values(ex.data.fields).join(" ") : ex.message);
  // Formularz informacji (dodanie / edycja). preset: { employeeId, indicator, date }, after: wywołanie po zapisie
  function evidenceModal(ev, preset = {}, after) {
    const v = ev || { employeeId: preset.employeeId || S.evFilter.employeeId || "", indicator: preset.indicator || "", date: preset.date || new Date().toISOString().slice(0, 10), situation: "", action: "", result: "", link: "", taskRef: "" };
    const fixedEmp = !!ev || !!preset.employeeId;
    openModal(`<h2 id="mTitle">${ev ? "Edytuj informację" : "Nowa informacja"}</h2>
      <p class="muted">Jedna obserwacja przy jednym wskaźniku: sytuacja, działanie, rezultat. Zmiana trafia do dziennika.</p>
      <form id="evForm" novalidate>
        ${fixedEmp ? `<p><b>Pracownik:</b> ${empName(v.employeeId) || esc(S.cur?.empName || "")}</p>` : `<label class="f" for="eEmp">Pracownik</label><select id="eEmp" required><option value="">Wybierz…</option>${empOptions(v.employeeId)}</select>`}
        <label class="f" for="eDate">Data zdarzenia</label>${dateFieldHtml("eDate", v.date, "required")}
        <label class="f" for="eInd">Wskaźnik</label><select id="eInd" required><option value="">Wybierz…</option>${indOptions(v.indicator)}</select>
        <label class="f" for="eSit">Sytuacja</label><textarea id="eSit" required maxlength="1000">${esc(v.situation)}</textarea>
        <label class="f" for="eAct">Działanie</label><textarea id="eAct" required maxlength="1000">${esc(v.action)}</textarea>
        <label class="f" for="eRes">Rezultat</label><textarea id="eRes" required maxlength="1000">${esc(v.result)}</textarea>
        <label class="f" for="eLink">Link do dokumentu (opcjonalnie)</label><input id="eLink" type="url" maxlength="500" value="${esc(v.link || "")}" placeholder="https://">
        <label class="f" for="eTask">Nr zadania lub link do dokumentu (opcjonalnie)</label><input id="eTask" maxlength="100" value="${esc(v.taskRef || "")}">
        <div id="evErr" role="alert" class="err"></div>
        <div class="btns"><button type="button" class="btn g" data-act="closeModal">Anuluj</button><button class="btn" type="submit">Zapisz</button></div>
      </form>`, () => {
      const ed = bindDate("eDate");
      $("#evForm").addEventListener("submit", async e => {
        e.preventDefault();
        const eIso = ed.iso(); if (!eIso) { $("#eDate").focus(); return; }
        const body = { date: eIso, indicator: $("#eInd").value, situation: $("#eSit").value, action: $("#eAct").value, result: $("#eRes").value, link: $("#eLink").value.trim(), taskRef: $("#eTask").value };
        try {
          if (ev) await api("PUT", `/api/evidence/${ev.id}`, body);
          else await api("POST", "/api/evidence", { ...body, employeeId: +(fixedEmp ? v.employeeId : $("#eEmp").value) });
          closeModal(); toast(ev ? "Zapisano zmiany informacji." : "Dodano informację.");
          if (after) await after(); else loadEvidence();
        } catch (ex) { $("#evErr").textContent = fieldErrors(ex); }
      });
    }, "mTitle");
  }
  // Informacje przy wskaźniku w kreatorze oceny (okres oceny)
  const indShort = k => { const [ck, wi] = String(k).split("|"); const m = MODEL.find(x => x.k === ck); return (m && m.w[+wi] ? m.w[+wi].w : k).slice(0, 80); };
  function evidenceMini(indKey) {
    const c = S.cur, list = (c.evidence || []).filter(e => e.indicator === indKey);
    const add = c.status === "draft" ? `<button type="button" class="btn sm g" data-act="addEvidence" data-ind="${esc(indKey)}" aria-label="Dodaj informację – ${esc(indShort(indKey))}">+ Informacja</button>` : "";
    return `<div class="ev-mini"><div class="row"><span class="muted">Informacje z okresu oceny: <b>${list.length}</b></span>${add}</div>
      ${list.length ? `<ul class="c">${list.slice(0, 5).map(e => `<li><span class="muted">${esc(isoToPl(e.date))}</span> ${esc(e.action)} → ${esc(e.result)}</li>`).join("")}${list.length > 5 ? `<li class="muted">…i ${list.length - 5} więcej</li>` : ""}</ul>` : c.typ !== "pierwsza" ? `<p class="muted">Brak informacji. Przed złożeniem dodaj informację albo zaznacz „Brak podstaw do oceny”.</p>` : ""}</div>`;
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
        <div><label class="f" for="sFrom">Od (domyślnie 12 miesięcy wstecz)</label>${dateFieldHtml("sFrom", f.from)}</div>
        <div><label class="f" for="sTo">Do</label>${dateFieldHtml("sTo", f.to)}</div>
        <div class="btns" style="justify-content:flex-start;align-self:end"><button class="btn" type="submit">Pokaż</button></div>
      </form></div>
      <div id="sumBody" aria-live="polite"><p class="muted">Ładowanie…</p></div>
      <div class="card" id="cmpBox"><h2>Zmiana między ocenami okresowymi</h2><p class="muted">Wczytywanie…</p></div>`;
  }
  function bindSummaryPage() {
    const fm = $("#sumForm"); if (!fm) return;
    const hF = bindDate("sFrom"), hT = bindDate("sTo");
    fm.addEventListener("submit", e => { e.preventDefault();
      const from = readDate(hF, "sFrom"), to = readDate(hT, "sTo");
      if (from === null) { $("#sFrom").focus(); return; } if (to === null) { $("#sTo").focus(); return; }
      Object.assign(S.sum, { employeeId: $("#sEmp").value, from, to }); loadSummary(); });
  }
  const distChips = d => `<span class="dist">${PTS5.map(p => `<span title="${p} pkt">${p} pkt: <b>${d[p] || 0}</b></span>`).join("")}</span>`;
  async function loadSummary() {
    const box = $("#sumBody"); if (!box) return;
    const f = S.sum, q = new URLSearchParams({ employeeId: f.employeeId, ...(f.from ? { from: f.from } : {}), ...(f.to ? { to: f.to } : {}) });
    loadCompare(f.employeeId);
    try {
      const s = await api("GET", "/api/summary?" + q);
      box.innerHTML = `<div class="kpis">
          <div class="kpi"><b>${s.evidenceTotal}</b><span>Informacje w okresie<small>Ile opisanych sytuacji, działań i rezultatów zapisano.</small></span></div>
          <div class="kpi"><b>${s.checkins.done} / ${s.checkins.total}</b><span>Rozmowy miesięczne odbyte / zapisane<small>Ile rozmów się odbyło z ilu zapisanych w okresie.</small></span></div>
          <div class="kpi"><b>${s.feedbackTotal}</b><span>Informacja zwrotna<small>Ile wpisów informacji zwrotnej zebrano w okresie.</small></span></div>
          <div class="kpi"><b>${s.indicatorsWithoutEvidence}</b><span>Wskaźniki bez zapisanych informacji w okresie<small>Warto uzupełnić przed oceną.</small></span></div></div>
        <div class="card"><h2>Wskaźniki z informacjami lub informacją zwrotną</h2>
          <p class="muted">Okres ${esc(isoToPl(s.from))} – ${esc(isoToPl(s.to))}. To zestawienie faktów. Nie ma w nim średniej ani sugerowanego wyniku. Ocenę przyznajesz Ty.</p>
          ${s.indicators.length ? `<div style="overflow-x:auto"><table class="table"><caption class="sr">Zestawienie wskaźników</caption><thead><tr><th scope="col">Wskaźnik</th><th scope="col">Informacje</th><th scope="col">Pierwszy – ostatni</th><th scope="col">Rozmowy miesięczne z informacjami</th><th scope="col">Informacja zwrotna (poziomy)</th></tr></thead><tbody>
            ${s.indicators.map(i => `<tr><td>${esc(indLabel(i.indicator))}</td><td>${i.evidenceCount}</td><td style="white-space:nowrap">${i.firstDate ? `${esc(isoToPl(i.firstDate))} – ${esc(isoToPl(i.lastDate))}` : "—"}</td><td>${i.checkinsWithEvidence}</td><td>${i.feedbackCount}${i.feedbackCount ? ` ${distChips(i.feedbackLevels)}` : ""}</td></tr>`).join("")}
            </tbody></table></div>` : `<p class="muted">Brak informacji i informacji zwrotnej w okresie.</p>`}</div>
        <div class="card"><h2>Rozkład poziomów z ocen cząstkowych kwartalnych</h2>
          ${s.competencies.length ? s.competencies.map(c => `<div class="ind"><h3 class="h-comp">${compIc(c.competency)}${esc(nameOf(c.competency))}</h3>${distChips(c.distribution)}
            <p class="muted">${c.partials.map(p => `${esc(quarterPl(p.quarter))}: ${p.pts} pkt`).join(" · ")}</p></div>`).join("") : `<p class="muted">Brak ocen cząstkowych kwartalnych w okresie.</p>`}</div>
        <div class="card"><h2>Rozmowy miesięczne</h2>${s.checkins.months.length ? `<p>${s.checkins.months.map(m => `${esc(monthPl(m.month))} (${esc(m.status)})`).join(" · ")}</p>` : `<p class="muted">Brak rozmów miesięcznych w okresie.</p>`}</div>`;
    } catch (e) { box.innerHTML = `<div class="card"><p class="muted">${esc(errMsg(e))}</p></div>`; }
  }

  const modState = on => on ? `${KK_ICON("check")}<span>Włączony</span>` : `<svg class="ic-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8.5"/><path d="M8 12h8"/></svg><span>Wyłączony</span>`;
  function settingsPage() {
    const mods = S.moduleList || [];
    return `<div class="card"><h2>Moduły spoza rozporządzenia</h2>
      <p class="muted">Informacje, rozmowy miesięczne, informacja zwrotna, oceny kwartalne i asystent AI nie wynikają wprost z rozporządzenia. Każdy można wyłączyć. Informacje są opcjonalne, ale zachęcamy do ich używania: wspierają przygotowanie oceny.</p>
      <form id="setForm">${mods.map(m => `<label class="choice mod-row"><input type="checkbox" data-mod="${esc(m.key)}" ${m.on ? "checked" : ""}><span><b>${esc(m.label)}</b></span><span class="mod-state ${m.on ? "on" : "off"}" data-mod-state="${esc(m.key)}">${modState(m.on)}</span></label>`).join("")}
      <div class="btns" style="justify-content:flex-start"><button class="btn" type="button" data-act="saveSettings">Zapisz ustawienia</button></div></form></div>
      <div class="card"><h2>Zawsze włączone</h2><p class="muted">Ocena okresowa (Arkusz B – osoby kierujące zespołem, Arkusz C – pozostałe stanowiska), pierwsza ocena, zapoznanie i sprzeciw (art. 83), dziennik zdarzeń.</p></div>`;
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
      <div class="row"><div class="who-row">${avatar(c.empAvatar, c.empName, "av av-lg")}<div><h2>${esc(TYP[c.typ])}</h2><div class="muted">${first(c.empName)} · okres ${esc(isoToPl(c.periodFrom || ""))} – ${esc(isoToPl(c.periodTo || ""))}</div></div></div>
        <div class="row">${pill(c.status)}<span class="saved" id="saved"></span></div></div>
      <div class="wiz-progress"><div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Postęp kreatora oceny"><i style="width:${pct}%"></i></div><small>Część ${idx + 1} z ${steps.length} · ${esc(st.label)}</small></div></div>`;
    let body;
    if (st.id === "crit") body = critStep();
    else if (st.id === "talk") body = talkStep();
    else if (st.id === "sum") body = sumStep();
    else body = rateOne(st.comp);
    const prevLabel = idx === 0 ? `<span class="l-long">Zapisz i wróć później</span><span class="l-short">Zapisz</span>` : "Wstecz";
    const last = idx === steps.length - 1;
    const canNext = !(st.id === "crit" && !c.criteria.length);
    const nav = `<nav class="wiz-nav" aria-label="Nawigacja kreatora">
      <button class="btn g" data-wiz="${idx === 0 ? "close" : "prev"}"${idx === 0 ? ' aria-label="Zapisz i wróć później"' : ""}>${KK_ICON("back")}<span>${prevLabel}</span></button>
      <span class="muted wiz-count">${idx + 1} / ${steps.length}</span>
      ${last ? (c.status === "draft" ? `<button class="btn submit" data-act="submitEval" ${(c.missing || []).length === 0 && c.criteria.length > 0 ? "" : "disabled"}>${KK_ICON("check")}<span>Złóż ocenę</span></button>` : "") : `<button class="btn" data-wiz="next" ${canNext ? "" : "disabled"}><span>Dalej</span>${KK_ICON("arrow")}</button>`}</nav>`;
    return { html: `<h1 class="sr">Kreator oceny</h1>` + head + body + nav, title: "Ocena", sub: st.id === "crit" ? "Wybierz, co będziemy oceniać" : st.id === "sum" ? "Sprawdź i złóż ocenę" : st.id === "talk" ? "Przygotuj rozmowę" : "Opisz zachowania, nie osobę", opts: { hidePageHead: true } };
  }
  function bindWizard() {
    document.querySelectorAll("[data-wiz]").forEach(b => b.addEventListener("click", () => {
      const a = b.dataset.wiz;
      if (a === "close") { S.cur = null; return go("evals"); }
      S.cur.step += a === "next" ? 1 : -1;
      render(); window.scrollTo(0, 0);
    }));
    document.querySelectorAll("[data-datef]").forEach(inp => {
      const h = dateMask(inp, $("#" + inp.id + "Err"));
      inp.addEventListener("change", () => {
        if (!S.cur || inp.disabled) return;
        const iso = inp.value.trim() ? h.iso() : "";
        if (inp.value.trim() && !iso) return; // niepełna data: komunikat przy polu, nie zapisujemy
        S.cur.data[inp.dataset.datef] = iso; queueSave();
      });
    });
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
        return `<label class="choice${dis ? " is-mand" : ""}"><input type="checkbox" data-crit="${esc(m.k)}" ${c.criteria.includes(m.k) ? "checked" : ""} ${dis ? "disabled" : ""}>
          <span class="crit-h">${compIc(m.k)}<span><b>${esc(nameOf(m.k))}</b>${dis ? ` <span class="tag mand">${KK_ICON("lock")}<span>Obowiązkowe – zawsze w ocenie</span></span>` : ""}<br><span class="muted">${m.w.length} wskaźników</span></span></span></label>`;
      }).join("")}</div><p class="muted mand-note">Kryteria obowiązkowe wg rozporządzenia Prezesa Rady Ministrów z 4 kwietnia 2016 r. (załącznik – arkusz B/C).</p></div>`;
  }
  function rateOne(comp) {
    const c = S.cur, isFirst = c.typ === "pierwsza";
    const L = isFirst ? LEVELS3.map((l, i) => [l, PTS3[i], i + 1]) : LEVELS5.map((l, i) => [l, PTS5[i], i]);
    const done = comp.w.filter((_, wi) => { const r = c.ratings[comp.k + "|" + wi]; return r && r.lvl !== undefined; }).length;
    return `<div class="card"><div class="row"><h2 class="h-comp">${compIc(comp.k)}${esc(nameOf(comp.k))}</h2><span class="tag info">${done}/${comp.w.length} ocenione</span></div>
      <p class="note scale-hint"><b>Punkt wyjścia to 5 pkt – na poziomie oczekiwań.</b> Wyżej lub niżej tylko na podstawie zapisanych informacji.</p>
      <p class="muted">Wybierz poziom, który najlepiej opisuje to, co faktycznie obserwowałeś/aś. Dodaj jeden konkretny przykład: sytuacja, działanie, rezultat.</p>
      ${c.status === "draft" && (c.evidence || []).some(e => e.competency === comp.k) ? `<div class="btns" style="justify-content:flex-start"><button type="button" class="btn sm g" data-act="fillFromEvidence" data-comp="${esc(comp.k)}">Uzupełnij przykłady z zapisanych informacji</button></div>` : ""}</div>
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
  // Podpowiedzi do przemyślenia przed spotkaniem: reguły z ocen, bez decyzji i bez oceny osoby
  // Podpowiedzi do przemyślenia przed spotkaniem: pytania z bazy (lib/asystent/baza-pytan.json), bez decyzji
  const bankFor = k => (S.assistant?.kompetencje || []).find(x => String(k).toUpperCase().startsWith(x.match.slice(0, 12)));
  function prepPanel(c) {
    const sc = scoreLocal(c);
    const ranked = Object.entries(sc).filter(([, v]) => v.avg !== null).sort((a, b) => a[1].avg - b[1].avg || (a[0] < b[0] ? -1 : 1));
    if (!ranked.length) return `<p class="muted">Podpowiedzi pojawią się po ocenieniu wskaźników.</p>`;
    const low = ranked.slice(0, 2), high = ranked.slice(-1);
    const weakInd = k => (MODEL.find(m => m.k === k)?.w || []).map((w, wi) => ({ w: w.w, r: c.ratings[k + "|" + wi] })).filter(o => o.r && o.r.lvl !== "none" && o.r.lvl !== undefined && o.r.lvl <= 1);
    const qs = (list, n = 1) => (list || []).slice(0, n);
    const gen = (S.assistant?.ogolne || []).slice(0, 2);
    return `<ul class="c">
      ${low.map(([k, v]) => { const b = bankFor(k); return `<li><b>${esc(nameOf(k))}</b> (średnio ${fmt(v.avg)} pkt) – zapytaj: ${qs(b?.niski).map(q => `„${esc(q)}”`).join(" ")}${weakInd(k).length ? ` Do omówienia: ${weakInd(k).slice(0, 2).map(o => `„${esc(o.w.slice(0, 60))}”`).join(", ")}.` : ""}</li>`; }).join("")}
      ${high.map(([k]) => { const b = bankFor(k); return `<li><b>${esc(nameOf(k))}</b> – warto docenić i zapytać: ${qs(b?.wysoki).map(q => `„${esc(q)}”`).join(" ")}</li>`; }).join("")}
      ${gen.map(q => `<li>Ogólnie: „${esc(q)}”</li>`).join("")}
      <li>Jeśli przy wskaźniku nie ma przykładu, zapytaj o sytuację z okresu zamiast zakładać brak działania.</li>
    </ul>
    <p class="note">To podpowiedzi do przemyślenia, nie ocena. Decyzję podejmujesz Ty. Pytania pochodzą z jawnej bazy: zobacz instrukcję asystenta.</p>`;
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
        ${(S.modules || {}).mod_ai !== false ? `<button class="btn" data-act="aiTalk">Pytania do rozmowy (AI ${aiWhere()})</button>
            <button class="btn g" data-act="aiBrief" data-emp="${c.employeeId}">Przygotuj brief do rozmowy</button>
        <button class="btn g" data-act="aiFormal">Sprawdź język uzasadnień</button>` : `<p class="muted">Asystent AI jest wyłączony w ustawieniach.</p>`}</div>
      <h3 style="margin-top:14px">Przygotowanie do spotkania</h3>${prepPanel(c)}
      <div id="aiOut">${c.aiText ? `${aiRich(c.aiText)}<p class="muted">Źródło: ${c.aiSource === "ai" ? "model AI" : "reguły systemu (asystent AI był niedostępny)"}</p>` : ""}</div>
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
        <div><label class="f" for="fRozm">Data rozmowy oceniającej</label><input id="fRozm" type="text" inputmode="numeric" autocomplete="off" maxlength="10" placeholder="DD.MM.RRRR" data-datef="rozmowa" aria-describedby="fRozmErr" value="${esc(isoToPl(d.rozmowa || ""))}" ${ro}><div class="err" id="fRozmErr" role="alert"></div></div>
        <div><label class="f" for="fTerm">Termin sporządzenia oceny</label><input id="fTerm" type="text" inputmode="numeric" autocomplete="off" maxlength="10" placeholder="DD.MM.RRRR" data-datef="terminOceny" aria-describedby="fTermErr" value="${esc(isoToPl(d.terminOceny || ""))}" ${ro}><div class="err" id="fTermErr" role="alert"></div></div>
      </div>
      <label class="f" for="fUzas">Uzasadnienie oceny (obowiązkowe przy ocenie negatywnej)</label>
      <textarea id="fUzas" data-field="uzasadnienie" ${ro}>${esc(d.uzasadnienie || "")}</textarea>
      ${isS2(c.typ, d) ? verdictBox(scores) : `<fieldset style="border:0;padding:0;margin:12px 0 0"><legend class="f">${c.typ === "pierwsza" ? "Wynik pierwszej oceny" : "Ocena okresowa"}</legend>
        <label class="choice"><input type="radio" name="wynik" value="pozytywna" data-field="wynik" ${d.wynik === "pozytywna" ? "checked" : ""} ${ro}><span><b>Pozytywna</b></span></label>
        <label class="choice"><input type="radio" name="wynik" value="negatywna" data-field="wynik" ${d.wynik === "negatywna" ? "checked" : ""} ${ro}><span><b>Negatywna</b></span></label>
      </fieldset>`}</div>
      ${timingNote(c)}
      ${docLinks(c.id, c.status === "draft" ? draftLinks(c.id) : "")}`;
    return form + `<div class="card"><h2>Podsumowanie</h2>
      <p>Średnia: <b data-to="${overall ?? 0}" data-dec="1">${overall === null ? "—" : fmt(overall)}</b> pkt</p>
      ${scoreBars(scores)}
      ${c.status === "draft" ? (miss.length
        ? `<div class="note warn"><b>Do uzupełnienia przed złożeniem (${miss.length}):</b><ul class="c">${miss.slice(0, 8).map(m => `<li>${esc(m)}</li>`).join("")}${miss.length > 8 ? `<li>…i ${miss.length - 8} więcej</li>` : ""}</ul></div>`
        : `<p><span class="tag ok">Kompletna – możesz złożyć</span></p>`) : ""}
      ${c.status === "draft" && !canSubmit ? `<p class="muted">Przycisk „Złóż ocenę” w dolnym pasku będzie aktywny po uzupełnieniu brakujących elementów.</p>` : ""}
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
  // Termin: reguła 6 miesięcy między ocenami okresowymi i cykl 24 miesięcy
  function timingNote(c) {
    const t = c.timing; if (!t) return "";
    if (t.exception) return `<div class="note">Wyjątek od reguły ${t.earliest ? `6 miesięcy (najwcześniej ${esc(isoToPl(t.earliest))})` : "6 miesięcy"} zapisany ${esc(isoToPl(String(t.exception.at).slice(0, 10)))}: ${esc(t.exception.reason)}</div>`;
    if (!t.ok) return `<div class="note warn" role="alert"><b>Zbyt wczesna ocena.</b> Poprzednia ocena okresowa: ${esc(isoToPl(t.prevDate))}. Najwcześniejszy termin: ${esc(isoToPl(t.earliest))}. Złożenie będzie zablokowane bez wyjątku.
      ${c.status === "draft" ? `<div class="btns" style="justify-content:flex-start"><button type="button" class="btn sm g" data-act="earlyException">Zapisz wyjątek z uzasadnieniem</button></div>` : ""}</div>`;
    return t.nextDue ? `<p class="muted">Termin cyklu (24 miesiące od poprzedniej oceny): ${esc(isoToPl(t.nextDue))}.</p>` : "";
  }
  function draftLinks(id) {
    const base = `/api/evals/${id}/document?variant=szkic`;
    return `<a class="btn g" href="${base}&format=pdf&inline=1" target="_blank" rel="noopener">${KK_ICON("file")}<span>Podgląd szkicu PDF</span><span class="sr"> (nowa karta)</span></a>
        <a class="btn g" href="${base}&format=xml" download>${KK_ICON("file")}<span>Szkic XML</span></a>`;
  }
  function docLinks(id, extra = "") {
    const base = `/api/evals/${id}/document`;
    return `<div class="docs"><h3>Dokumenty</h3><p class="muted">Arkusz generowany z danych tej oceny.</p>
      <div class="btns" style="justify-content:flex-start">
        <a class="btn" href="${base}?format=pdf&inline=1" target="_blank" rel="noopener">${KK_ICON("file")}<span>Podgląd PDF arkusza</span><span class="sr"> (nowa karta)</span></a>
        <a class="btn g" href="${base}?format=pdf" download>${KK_ICON("file")}<span>Pobierz PDF</span></a>
      </div>
      <details class="adv"><summary>Dokumenty i formaty (dla zaawansowanych)</summary>
        <div class="btns" style="justify-content:flex-start">
        <a class="btn g" href="${base}?format=xml" download>${KK_ICON("file")}<span>Pobierz XML</span></a>
        ${extra}</div></details></div>`;
  }
  function evalReadPage() {
    const e = S.readEval; if (!e) return `<p class="muted">Ładowanie…</p>`;
    const scores = scoreLocal({ criteria: e.data.criteria, ratings: e.data.ratings, typ: e.typ, data: e.data });
    // Kompetencja = rozwijane „Szczegóły”: wskaźniki z punktami i przykładami oraz informacje z okresu oceny
    const items = `<h2 style="margin:8px 0 12px">Kryteria – szczegóły</h2>` + MODEL.filter(m => e.data.criteria.includes(m.k)).map(m => {
      const sc = scores[m.k]?.avg;
      return `
      <details class="comp" id="comp-${esc(m.k.replace(/[^A-ZĄĆĘŁŃÓŚŹŻ]/g, ""))}" ${S.readFocus === m.k ? "open" : ""}>
        <summary><h3 class="h-comp">${compIc(m.k)}${esc(nameOf(m.k))}</h3><span class="muted">${sc === null || sc === undefined ? "brak oceny" : `${fmt(sc)} pkt`}</span><span class="more">Szczegóły</span></summary>
        <div class="comp-body">
          <h4>Wskaźniki</h4>${m.w.map((w, wi) => { const r = e.data.ratings[m.k + "|" + wi]; return `<div class="ind"><b>${esc(w.w)}</b><div class="muted">${!r ? "nieocenione" : r.lvl === "none" ? "brak podstaw do oceny" : `${e.typ === "pierwsza" ? PTS3[r.lvl - 1] : PTS5[r.lvl]} pkt`}</div>${r?.ex ? `<div>${esc(r.ex)}</div>` : ""}</div>`; }).join("")}
          <h4>Informacje z okresu oceny</h4><div data-comp-ev="${esc(m.k)}"><p class="muted">Wczytywanie…</p></div>
        </div>
      </details>`;
    }).join("");
    const m = S.readMeta || {};
    const who = `<dl class="meta"><dt>Oceniany</dt><dd>${first(m.employee?.name)}${m.employee?.position ? ", " + esc(m.employee.position) : ""}</dd>
      <dt>Oceniający</dt><dd>${first(m.evaluator?.name)}${m.evaluator?.position ? ", " + esc(m.evaluator.position) : ""}</dd>
      <dt>Utworzono</dt><dd>${esc(plDT(e.created))}</dd>
      <dt>Ostatnia zmiana</dt><dd>${esc(plDT(e.updated))}</dd>
      <dt>Zapoznanie ocenianego</dt><dd>${e.ack_at ? esc(plDT(e.ack_at)) : "jeszcze nie"}</dd>
      <dt>Sprzeciw</dt><dd>${e.objection_at ? esc(plDT(e.objection_at)) + (e.objection_result ? " – " + esc(e.objection_result) : " – do rozpatrzenia") : "brak"}</dd></dl>`;
    return `<div class="card">${who}<div class="row"><h2>${esc(TYP[e.typ])}</h2>${pill(e.status)}</div>
      <p class="muted">Okres ${esc(isoToPl(e.period_from || ""))} – ${esc(isoToPl(e.period_to || ""))}${e.data.wynik ? ` · Ocena: <b>${esc(e.data.wynik)}</b>${e.data.wynikSource === "wyliczony" ? " (wyliczona wg § 11 rozporządzenia Prezesa Rady Ministrów z 4 kwietnia 2016 r.)" : ""}` : ""}</p>
      <div class="eval-chart">${radar(scores, true)}</div></div>
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
    const c = S.cur; if (!c) return;
    const sv = $("#saved"); if (sv) sv.textContent = "Zapisywanie…";
    saveTimer = setTimeout(async () => {
      try {
        const r = await api("PUT", `/api/evals/${c.id}`, { data: c.data, periodFrom: c.periodFrom, periodTo: c.periodTo });
        c.missing = r.missing; const s2 = $("#saved"); if (s2) s2.textContent = "Zapisano";
      } catch (e) { const s2 = $("#saved"); if (s2) s2.textContent = "Nie zapisano"; toast(errMsg(e)); }
    }, 500);
  }
  async function openWizard(id) {
    const r = await api("GET", `/api/evals/${id}`);
    const e = r.eval;
    S.cur = { id: e.id, typ: e.typ, status: e.status, periodFrom: e.period_from, periodTo: e.period_to, employeeId: e.employee_id, evidence: [],
      empName: r.employee?.name || "", empAvatar: r.employee?.avatar || null, data: e.data, criteria: [...new Set([...MODEL.map(m => m.k).filter(k => e.typ !== "pierwsza" && isMand(k, e.typ)), ...(e.data.criteria || [])])], ratings: e.data.ratings || {},
      step: 0, missing: r.missing || [], aiText: "", aiSource: "", timing: r.timing || null };
    S.maxExtra = 3;
    await refreshWizardEvidence();
    try { S.cur.quarterly = (await api("GET", `/api/partials?employeeId=${e.employee_id}${e.period_from ? `&from=${e.period_from}` : ""}${e.period_to ? `&to=${e.period_to}` : ""}`)).partials; } catch (_) { S.cur.quarterly = []; }
    S.view = "wizard"; render(); window.scrollTo(0, 0);
  }
  async function refreshMissing() { const r = await api("GET", `/api/evals/${S.cur.id}`); S.cur.missing = r.missing || []; S.cur.timing = r.timing || null; }
  document.addEventListener("submit", e => { if (e.target?.id === "aiForm") e.preventDefault(); });
  document.addEventListener("keydown", e => { if (e.key === "Enter" && e.target?.id === "aiQ") { e.preventDefault(); document.querySelector('[data-act="aiChat"]')?.click(); } });
  // Widoczny stan „model myśli”: animowane kropki i licznik sekund (aria-live dla czytników ekranu)
  function thinkingHtml(what) {
    return `<div class="ai-think" role="status" aria-live="polite"><span class="ai-dots" aria-hidden="true"><i></i><i></i><i></i></span><span>${esc(what)} <b class="ai-sec">0 s</b></span></div>`;
  }
  function startThinking(root) {
    const t0 = Date.now();
    const id = setInterval(() => {
      const el = root?.querySelector(".ai-sec");
      if (!el || !el.isConnected) return clearInterval(id);
      el.textContent = Math.floor((Date.now() - t0) / 1000) + " s";
    }, 500);
    return () => clearInterval(id);
  }
  async function runAi(kind) {
    const out = $("#aiOut");
    const stop = out ? (out.innerHTML = thinkingHtml(`Model AI ${aiWhere()} przygotowuje podpowiedzi…`), startThinking(out)) : () => {};
    try {
      const r = await api("POST", kind === "talk" ? "/api/ai/talk" : "/api/ai/formal", { evalId: S.cur.id });
      stop(); S.cur.aiText = r.text; S.cur.aiSource = r.source; render();
    } catch (e) { stop(); toast(errMsg(e)); }
  }
  // Podpisy i zapoznanie z oceną – stan z serwera
  async function loadSigs(id, status) {
    const box = $("#sigBox"); if (!box) return;
    try {
      const r = await api("GET", `/api/evals/${id}/signatures`);
      const rows = r.signatures.map(g => `<tr><td>${g.role === "przelozony" ? "Podpis oceniającego" : "Zapoznanie ocenianego"}</td><td>${esc(g.name)}</td><td>${esc(plDT(g.signed_at))}</td><td><span class="tag ${g.valid && g.unchanged ? "ok" : "bad"}">${g.valid ? (g.unchanged ? "weryfikacja OK" : "treść zmieniona") : "błąd podpisu"}</span></td></tr>`).join("");
      const isMgr = S.user.role === "przelozony";
      const hasMgrSig = r.signatures.some(g => g.role === "przelozony");
      const ackDone = !!r.ackAt;
      const deadlinePassed = r.objectionDeadline && Date.now() > Date.parse(r.objectionDeadline);
      box.innerHTML = `<h2>Podpisy i zapoznanie</h2>
        <p class="muted">Podpis potwierdza integralność treści oceny (skrót SHA-256).</p>
        ${rows ? `<div style="overflow-x:auto"><table class="table"><thead><tr><th scope="col">Rodzaj</th><th scope="col">Osoba</th><th scope="col">Czas</th><th scope="col">Weryfikacja</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="muted">Brak podpisów.</p>`}
        ${isMgr && r.objectionAt && !r.objectionResult ? `<div class="note warn"><b>Sprzeciw pracownika</b> z ${esc(plDT((r.objectionAt).slice(0, 10)))}: ${esc(r.objectionText || "")}<br><b>Rozpatrz do:</b> ${esc(plDT((r.decisionDeadline || "").slice(0, 10)))} (14 dni, art. 83 ust. 3).
          <div class="btns" style="justify-content:flex-start"><button class="btn" data-act="decideObjection" data-id="${id}" data-result="uwzglednione">Uwzględnij – popraw ocenę</button><button class="btn g" data-act="decideObjection" data-id="${id}" data-result="nieuwzglednione">Nie uwzględniaj</button></div></div>` : ""}
        ${isMgr && r.objectionResult ? `<p class="muted">Sprzeciw rozpatrzony: <b>${esc(r.objectionResult)}</b>${r.revision ? ` · wersja oceny: ${r.revision + 1}` : ""}</p>` : ""}
        ${isMgr && status !== "draft" && !hasMgrSig ? `<div class="btns" style="justify-content:flex-start"><button class="btn" data-act="signEval" data-id="${id}">Podpisz ocenę</button></div>` : ""}
        ${!isMgr ? `<p><b>Zapoznanie:</b> ${ackDone ? esc(plDT((r.ackAt).slice(0, 10))) : "jeszcze nie"}${r.objectionDeadline ? ` · <b>Termin na sprzeciw:</b> ${esc(plDT((r.objectionDeadline).slice(0, 10)))}` : ""}${r.objectionAt ? ` · <b>Sprzeciw złożono:</b> ${esc(plDT((r.objectionAt).slice(0, 10)))}` : ""}</p>
          ${!ackDone ? `<div class="btns" style="justify-content:flex-start"><button class="btn" data-act="ackEval" data-id="${id}">Zapoznałem(-łam) się z oceną</button></div>` : ""}
          ${ackDone && !r.objectionAt && !deadlinePassed ? `<div class="btns" style="justify-content:flex-start"><button class="btn g" data-act="objectionEval" data-id="${id}">Złóż sprzeciw</button></div>` : ""}
          ${r.objectionAt ? `<p class="note warn">Sprzeciw został złożony. Przełożony rozpatrzy go zgodnie z procedurą.</p>` : ""}` : ""}`;
      box.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', e => act(b.dataset.act, b, e)));
      animateIn(box);
    } catch (e) { box.innerHTML = `<h2>Podpisy i zapoznanie</h2><p class="muted">${esc(errMsg(e))}</p>`; }
  }
  const EVT = { login: "Logowanie", login_fail: "Nieudane logowanie", login_blocked: "Logowanie zablokowane", password_change: "Zmiana hasła", password_change_fail: "Nieudana zmiana hasła", account_activated: "Aktywacja konta", activation_issued: "Wydanie linku aktywacyjnego", create_employee: "Dodanie pracownika",
    create_eval: "Utworzenie oceny", update_eval: "Zmiana oceny", submit_eval: "Złożenie oceny", eval_early_exception: "Wyjątek od reguły 6 miesięcy", discuss_eval: "Omówienie oceny", sign_eval: "Podpis oceniającego", acknowledge_eval: "Zapoznanie z oceną", objection_eval: "Sprzeciw", objection_decision: "Rozpatrzenie sprzeciwu",
    download_doc: "Pobranie dokumentu", download_draft: "Pobranie szkicu", create_evidence: "Dodanie informacji", update_evidence: "Zmiana informacji", create_kickoff: "Rozmowa rozpoczynająca", update_kickoff: "Zmiana rozmowy rozpoczynającej", acknowledge_kickoff: "Zapoznanie z rozmową rozpoczynającą",
    create_goal: "Nowy cel", update_goal: "Zmiana celu", goal_step_confirm: "Potwierdzenie kroku celu", goal_step_report: "Zgłoszenie wykonania kroku celu", update_devplan: "Plan rozwoju pracownika", create_checkin: "Rozmowa miesięczna", update_checkin: "Zmiana rozmowy miesięcznej",
    create_feedback: "Informacja zwrotna", update_feedback: "Zmiana informacji zwrotnej", create_partial: "Ocena cząstkowa", update_partial: "Zmiana oceny cząstkowej", view_summary: "Podgląd zestawienia", view_month: "Podgląd miesiąca", setting: "Zmiana ustawień",
    ai_talk: "Podpowiedź AI: pytania do rozmowy", ai_formal: "Podpowiedź AI: uzasadnienie formalne", ai_development: "Podpowiedź AI: działania rozwojowe", ai_checkin: "Podpowiedź AI: rozmowa miesięczna", ai_brief: "Podpowiedź AI: brief do rozmowy", ai_prep: "Podpowiedź AI: przygotowanie do rozmowy", ai_criteria: "Podpowiedź AI: dobór kryteriów" };
  const evtName = a => EVT[a] || (a ? String(a).replace(/_/g, " ").replace(/^./, c => c.toUpperCase()) : "");
  // Czytelny cel wpisu dziennika (np. „5:pdf” → „Ocena nr 5 – PDF”)
  // Treść podpowiedzi AI w dzienniku: propozycje kryteriów (JSON) jako „Nazwa – uzasadnienie”, tekst bez zmian
  const aiOutText = out => { try { const j = JSON.parse(out); if (Array.isArray(j)) return j.map(p => `${nameOf(p.k) || p.n || p.k}${p.uzasadnienie ? ` – ${p.uzasadnienie}` : ""}`).join("; ") || "brak propozycji"; } catch (_) {} return String(out || ""); };
  // Osoby z zespołu po numerze (przełożony widzi swój zespół), ocena po numerze → osoba
  const empById = id => (S.dash?.team || []).find(t => String(t.id) === String(id))?.name || null;
  const evalWho = id => { const e = (S.evals || []).find(x => String(x.id) === String(id)); return e ? empById(e.employeeId) : null; };
  function targetLabel(a) {
    const t = String(a.target || ""), act = a.action || "";
    let m;
    if ((m = /^(evidence|goal|kickoff|devplan|checkin|feedback|partial):(\d+)$/.exec(t))) return { evidence: `Informacja nr ${m[2]}`, goal: `Cel nr ${m[2]}`, kickoff: `Rozmowa rozpoczynająca nr ${m[2]}`, devplan: `Plan rozwoju pracownika nr ${m[2]}`, checkin: `Rozmowa miesięczna nr ${m[2]}`, feedback: `Informacja zwrotna nr ${m[2]}`, partial: `Ocena cząstkowa nr ${m[2]}` }[m[1]];
    if ((m = /^(\d+):(pdf|xml)$/i.exec(t))) return `Ocena nr ${m[1]}${evalWho(m[1]) ? ` (${evalWho(m[1])})` : ""} – ${m[2].toUpperCase()}`;
    if ((m = /^(\d+):(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/.exec(t))) return `${empById(m[1]) || `Pracownik nr ${m[1]}`}, okres ${isoToPl(m[2])} – ${isoToPl(m[3])}`;
    if ((m = /^(\d+):(\d{4})-(\d{2})$/.exec(t))) return `${empById(m[1]) || `Pracownik nr ${m[1]}`}, ${monthPl(`${m[2]}-${m[3]}`)}`;
    if ((m = /^(\d+):(\w+)(?:: (.*))?$/.exec(t)) && act === "objection_decision") return `Ocena nr ${m[1]} – ${m[2]}${m[3] ? ": " + m[3] : ""}`;
    if ((m = /^(\w+)=([01])$/.exec(t)) && act === "setting") return `${m[1]}: ${m[2] === "1" ? "włączony" : "wyłączony"}`;
    if (t === "session_rotated") return "Nowa sesja";
    if (!t) return /login|logout|session/.test(act) ? "Własne konto" : "—";
    if (/^\d+$/.test(t)) return /eval|download|^ai_(talk|formal)$/.test(act) ? `Ocena nr ${t}${evalWho(t) ? ` (${evalWho(t)})` : ""}` : /employee|activat|password/.test(act) ? `Konto: ${empById(t) || `nr ${t}`}` : `Nr ${t}`;
    return t;
  }
  const plTime = at => { const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(at || ""); return m ? `${m[3]}.${m[2]}.${m[1]} ${m[4]}:${m[5]}` : at || ""; };
  // Dziennik: „pole: przed → po” z pól prev_value / new_value (JSON); długi opis trafia do <details>
  function auditChange(a) {
    const parse = t => { if (t === null || t === undefined || t === "") return undefined; try { return JSON.parse(t); } catch { return String(t); } };
    const val = v => v === undefined || v === null ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v);
    const pv = parse(a.prev_value), nv = parse(a.new_value), isO = v => v && typeof v === "object" && !Array.isArray(v);
    let lines = [];
    if (isO(pv) || isO(nv)) {
      const o = isO(pv) ? pv : {}, n = isO(nv) ? nv : {};
      [...new Set([...Object.keys(o), ...Object.keys(n)])].forEach(k => { if (JSON.stringify(o[k]) !== JSON.stringify(n[k])) lines.push(`${k}: ${val(o[k])} → ${val(n[k])}`); });
    } else if (pv !== undefined || nv !== undefined) lines.push(`${val(pv)} → ${val(nv)}`);
    if (!lines.length) return `<span class="muted">—</span>`;
    const full = lines.join("\n"), short = full.length > 120 ? full.slice(0, 117).replace(/\s+\S*$/, "") + "…" : full;
    return full.length > 120 ? `<span class="chg">${esc(short)}</span><details class="chg-more"><summary>Pokaż całość</summary><pre class="chg-full">${esc(full)}</pre></details>` : `<span class="chg">${esc(full).replace(/\n/g, "<br>")}</span>`;
  }
  async function loadLog() {
    const b = $("#logBody"); if (!b) return;
    try {
      const r = await api("GET", "/api/audit");
      b.innerHTML = `<p>Integralność dziennika (łańcuch skrótów SHA-256 i pieczęć HMAC): <span class="tag ${r.chainOk ? "ok" : "bad"}">${r.chainOk ? "zgodny" : "naruszony od wpisu " + r.brokenAt}</span></p>`
        + (r.audit.length ? `<div style="overflow-x:auto"><table class="table"><thead><tr><th scope="col">Zdarzenie</th><th scope="col">Czego dotyczy</th><th scope="col">Kiedy</th><th scope="col">Zmiana</th></tr></thead><tbody>${r.audit.map(a => `<tr><td data-label="Zdarzenie">${esc(evtName(a.action))}</td><td data-label="Czego dotyczy">${esc(targetLabel(a))}</td><td data-label="Kiedy">${esc(plTime(a.at))}</td><td data-label="Zmiana">${auditChange(a)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">Brak wpisów.</p>`)
        + `<h2 style="margin-top:18px">Podpowiedzi AI (przejrzystość i nadzór)</h2><p class="muted">Każda podpowiedź AI jest zapisana i oznaczona. Nie zmienia ocen bez decyzji człowieka.</p>`
        + (r.ai.length ? `<div style="overflow-x:auto"><table class="table"><thead><tr><th scope="col">Rodzaj</th><th scope="col">Model</th><th scope="col">Źródło</th><th scope="col">Kiedy</th><th scope="col">Treść</th></tr></thead><tbody>${r.ai.map(x => `<tr><td>${esc(({ talk: "Pytania do rozmowy", formal: "Uzasadnienie formalne", development: "Działania rozwojowe", checkin: "Rozmowa miesięczna", brief: "Brief do rozmowy", prep: "Przygotowanie do rozmowy", criteria: "Dobór kryteriów" })[x.action] || String(x.action || "").replace(/_/g, " "))}</td><td>${x.source === "ai" ? esc(x.model || "") : "—"}</td><td>${x.source === "ai" ? `AI ${aiWhere()}` : "reguły systemu (asystent AI był niedostępny)"}</td><td>${esc(plTime(x.at))}</td><td>${esc(aiOutText(x.output))}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">Brak podpowiedzi AI.</p>`);
    } catch (e) { b.innerHTML = `<p class="muted">${esc(errMsg(e))}</p>`; }
  }
  // Strona Asystent AI: czat jak w komunikatorze. Odpowiada tylko o systemie i procedurach oceny.
  function chatBubble(m) {
    const who = m.role === "user" ? "Ty" : "Asystent";
    const src = m.role === "assistant" ? `<div class="chat-src">${m.source === "ai" ? `model AI ${aiWhere()}` : "odpowiedź z reguł systemu"}</div>` : "";
    return `<div class="chat-row ${m.role}"><div class="chat-bub"><span class="chat-who">${who}</span>${m.role === "assistant" ? `<div class="chat-txt">${briefHtml(m.text, true)}</div>` : esc(m.text)}${src}</div></div>`;
  }
  // Przewijanie czatu na dół; przy oczekiwaniu uruchamia licznik sekund
  function scrollChat(thinking) {
    const log = $("#aiChatOut"); if (!log) return;
    log.scrollTop = log.scrollHeight;
    if (thinking) { const el = log.querySelector(".ai-think"); if (el) startThinking(el); }
  }
  function aiPage() {
    const msgs = (S.aiChat || []).map(chatBubble).join("") + (S.aiPending ? `<div class="chat-row assistant"><div class="chat-bub chat-typing">${thinkingHtml("Asystent układa odpowiedź…")}</div></div>` : "");
    const EXQ = S.user?.role === "pracownik"
      ? ["Ile mam czasu na złożenie sprzeciwu?", "Jak przygotować się do rozmowy oceniającej?", "Co oznacza 5 pkt w ocenie?"]
      : ["Które kryteria są obowiązkowe w arkuszu C?", "Jak opisać przykład zachowania w ocenie?", "Kiedy trzeba przeprowadzić rozmowę rozpoczynającą?"];
    const empty = `<div class="chat-hello">Cześć! Pytaj o obsługę systemu, terminy, sprzeciw, wskaźniki i kryteria obowiązkowe. Nie oceniam osób i nie podejmuję decyzji.
      <div class="chat-ex" role="group" aria-label="Przykładowe pytania">${EXQ.map(q => `<button type="button" class="btn sm g" data-act="aiAsk" data-q="${esc(q)}">${esc(q)}</button>`).join("")}</div></div>`;
    return `<section class="chat" aria-labelledby="aiH">
      <h2 id="aiH" class="sr">Asystent AI</h2>
      <div class="chat-log" id="aiChatOut" role="log" aria-live="polite" aria-label="Rozmowa z asystentem">${msgs || empty}</div>
      <form class="chat-bar" id="aiForm">
        <label class="sr" for="aiQ">Napisz wiadomość</label>
        <input id="aiQ" type="text" maxlength="1000" autocomplete="off" placeholder="Napisz pytanie…">
        <button class="btn" type="button" data-act="aiChat">Wyślij</button>
        <button class="btn g" type="button" data-act="aiClear">Nowa rozmowa</button>
      </form></section>`;
  }
  const actions = {
    logout: async () => { await api("POST", "/api/logout").catch(() => {}); S.user = null; S.view = "home"; renderLogin(); },
    newEval: b => newEvalModal(b.dataset.emp ? +b.dataset.emp : null),
    openEval: b => openWizard(+b.dataset.id),
    readEval: async b => { const r = await api("GET", `/api/evals/${b.dataset.id}`); S.readEval = r.eval; S.readMeta = r; S.readFocus = b.dataset.comp || null; S.view = "evalView"; render(); window.scrollTo(0, 0); },
    submitEval: async () => {
      if (!(await askConfirm({ title: "Złożyć ocenę?", text: "Po złożeniu oceny nie można już edytować. Pracownik zobaczy ją w swoim panelu i potwierdzi zapoznanie.", ok: "Złóż ocenę" }))) return;
      try { await api("POST", `/api/evals/${S.cur.id}/submit`); S.cur.status = "submitted"; render(); surveyModal(S.cur.id); }
      catch (e) { toast(errMsg(e)); if (e.data?.missing) { S.cur.missing = e.data.missing; render(); } }
    },
    discussEval: async () => {
      const dev = $("#devN")?.value || "";
      try { await api("POST", `/api/evals/${S.cur.id}/discuss`, { dev }); S.cur.status = "discussed"; S.cur.data.dev = dev; toast("Oznaczono jako omówioną."); render(); }
      catch (e) { toast(errMsg(e)); }
    },
    aiAsk: b => { const inp = $("#aiQ"); if (!inp) return; inp.value = b.dataset.q || ""; document.querySelector('[data-act="aiChat"]')?.click(); },
    aiChat: async b => {
      const inp = $("#aiQ"); const q = (inp?.value || "").trim();
      if (q.length < 2) return toast("Napisz pytanie.");
      const history = (S.aiChat || []).slice(-6).map(m => ({ role: m.role, content: m.text }));
      S.aiChat = [...(S.aiChat || []), { role: "user", text: q }];
      S.aiPending = true; render(); $("#aiQ")?.focus(); scrollChat(true);
      try {
        const r = await api("POST", "/api/ai/chat", { message: q, history });
        S.aiChat = [...S.aiChat, { role: "assistant", text: r.text, source: r.source }];
      } catch (e) { S.aiChat = [...S.aiChat, { role: "assistant", text: "Nie udało się uzyskać odpowiedzi. " + errMsg(e), source: "rules" }]; }
      S.aiPending = false; render(); $("#aiQ")?.focus(); scrollChat();
    },
    aiClear: () => { S.aiChat = []; render(); $("#aiQ")?.focus(); },
    aiTalk: () => runAi("talk"),
    aiFormal: () => runAi("formal"),
    aiDev: async () => {
      const btn = $("#aiDevBtn"); btn.disabled = true; btn.textContent = "Model myśli…";
      const outEl = $("#aiDevOut"); outEl.innerHTML = thinkingHtml(`Model AI ${aiWhere()} układa działania rozwojowe…`); const stop = startThinking(outEl);
      outEl.scrollIntoView({ block: "nearest" });
      try { const r = await api("POST", "/api/ai/development", {}); stop(); outEl.innerHTML = `${aiRich(r.text)}<p class="muted">Źródło: ${r.source === "ai" ? `model AI ${aiWhere()}` : "reguły systemu (asystent AI był niedostępny)"}</p>`; }
      catch (e) { stop(); outEl.innerHTML = ""; toast(errMsg(e)); }
      btn.disabled = false; btn.textContent = "Zapytaj asystenta";
    },
    toggleGoal: async b => { try { await api("PATCH", `/api/goals/${b.dataset.id}`, { done: b.dataset.done === "1" }); await refreshGoals(); } catch (ex) { toast(errMsg(ex)); } },
    addStep: async b => {
      const t = await askText({ title: "Nowy krok celu", label: "Krok", hint: "Coś, co da się sprawdzić, np. „Wysłany raport do akceptacji”.", min: 3, max: 200, ok: "Dodaj krok" });
      if (!t) return;
      try { await api("PATCH", `/api/goals/${b.dataset.id}`, { addStep: t }); await refreshGoals(); toast("Dodano krok."); } catch (ex) { toast(errMsg(ex)); }
    },
    goalReport: async b => {
      try { await api("PATCH", `/api/goals/${b.dataset.goal}`, { step: +b.dataset.step, reported: b.dataset.val === "1" }); toast(b.dataset.val === "1" ? "Zgłoszono wykonanie kroku. Przełożony je potwierdzi." : "Cofnięto zgłoszenie."); await refreshGoals(); }
      catch (ex) { toast(errMsg(ex)); }
    },
    goalConfirm: async b => {
      try { await api("PATCH", `/api/goals/${b.dataset.goal}`, { step: +b.dataset.step, confirmed: b.dataset.val === "1" }); await refreshGoals(); }
      catch (ex) { toast(errMsg(ex)); }
    },
    mgrGoals: b => goalsModal(+b.dataset.emp).catch(ex => toast(errMsg(ex))),
    aiBrief: b => briefModal(+b.dataset.emp),
    aiPrep: async b => {
      const out = $("#aiPrepOut"); b.disabled = true; out.innerHTML = thinkingHtml(`Model AI ${aiWhere()} układa pytania…`); const stop = startThinking(out);
      try { const r = await api("POST", "/api/ai/prep", {}); stop(); out.innerHTML = `${aiRich(r.text)}<p class="muted">Źródło: ${r.source === "ai" ? `model AI ${aiWhere()}` : "reguły systemu (asystent AI był niedostępny)"} · propozycja do przemyślenia</p>`; }
      catch (ex) { stop(); out.innerHTML = `<p class="muted">${esc(errMsg(ex))}</p>`; }
      b.disabled = false;
    },
    briefTab: b => { document.querySelectorAll("[data-brief-pane]").forEach(p => { p.hidden = p.dataset.briefPane !== b.dataset.tab; }); document.querySelectorAll('[data-act="briefTab"]').forEach(t => t.setAttribute("aria-selected", t === b ? "true" : "false")); },
    briefDownload: () => {
      if (!S.briefJson) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([JSON.stringify(S.briefJson, null, 2)], { type: "application/json" }));
      a.download = `fakty-do-rozmowy-${S.briefJson.okres.od}_${S.briefJson.okres.do}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
    newGoalFor: b => act("addGoal", b),
    addGoal: b => openModal(`
      <h2>Nowy cel SMART</h2>
      <form id="goalForm" novalidate>
        <label class="f" for="gS">Konkretnie (Specific)</label><input id="gS" maxlength="200" required>
        <label class="f" for="gM">Mierzalnie (Measurable)</label><input id="gM" maxlength="200" required>
        <label class="f" for="gA">Osiągalnie (Achievable)</label><input id="gA" maxlength="200" required>
        <label class="f" for="gR">Istotnie (Relevant)</label><input id="gR" maxlength="200" required>
        <label class="f" for="gT">Termin (Time-bound)</label>
        <input id="gT" class="date-in" inputmode="numeric" autocomplete="off" placeholder="DD.MM.RRRR" maxlength="10" required aria-describedby="gTHint gTErr">
        <small id="gTHint" class="muted">Wpisz same cyfry – kropki dodają się same, np. 31122026.</small>
        <div class="field-err" id="gTErr" role="alert"></div>
        <fieldset class="plain"><legend class="f">Kroki (1–8) – po nich widać postęp</legend>
          <p class="muted">Każdy krok da się sprawdzić: wykonany albo nie. Np. „Ukończone szkolenie”, „Pierwszy raport wysłany”.</p>
          <div class="step-rows" id="gSteps">${[0, 1, 2].map(i => `<div class="step-row"><input data-step-in maxlength="150" aria-label="Krok ${i + 1}" placeholder="Krok ${i + 1}"></div>`).join("")}</div>
          <button type="button" class="btn sm g" id="gAddStep" style="margin-top:8px">${KK_ICON("plus")}<span>Dodaj krok</span></button>
        </fieldset>
        <div class="field-err" id="gErr" role="alert"></div>
        <div class="btns"><button type="button" class="btn g" data-act="closeModal">Anuluj</button><button class="btn" type="submit">Dodaj cel</button></div>
      </form>`, () => {
      const date = dateMask($("#gT"), $("#gTErr"), { min: todayISO(), maxYears: 5 });
      $("#gAddStep").addEventListener("click", () => {
        const n = document.querySelectorAll("[data-step-in]").length;
        if (n >= 8) return toast("Najwyżej 8 kroków.");
        $("#gSteps").insertAdjacentHTML("beforeend", `<div class="step-row"><input data-step-in maxlength="150" aria-label="Krok ${n + 1}" placeholder="Krok ${n + 1}"></div>`);
        document.querySelectorAll("[data-step-in]")[n].focus();
      });
      $("#goalForm").addEventListener("submit", async e => {
        e.preventDefault();
        const v = id => $("#" + id).value.trim();
        const t = date.iso();
        if (!t) { $("#gT").focus(); return; }
        const steps = [...document.querySelectorAll("[data-step-in]")].map(x => x.value.trim()).filter(Boolean);
        if (!steps.length) { $("#gErr").textContent = "Dodaj co najmniej jeden krok – po nim widać postęp."; document.querySelector("[data-step-in]").focus(); return; }
        const employeeId = +b.dataset.emp;
        try { await api("POST", "/api/goals", { employeeId, s: v("gS"), m: v("gM"), a: v("gA"), r: v("gR"), t, steps }); closeModal(); toast("Dodano cel. Pracownik zobaczy go w swoich celach."); if (S.goalsCtx?.where === "modal" && S.view !== "month") goalsModal(employeeId); else await refreshGoals(); }
        catch (ex) { $("#gErr").textContent = ex.message; }
      });
    }),
    addEmp: () => openModal(`
      <h2>Nowy pracownik</h2><p class="muted">Hasło ustala pracownik – dostanie link aktywacyjny ważny 24 godziny.</p>
      <form id="empForm" novalidate>
        <label class="f" for="eName">Imię i nazwisko</label><input id="eName" required maxlength="120">
        <label class="f" for="eMail">E-mail służbowy</label><input id="eMail" type="email" required maxlength="200">
        <label class="f" for="ePos">Stanowisko</label><input id="ePos" maxlength="120">
        <div class="btns"><button type="button" class="btn g" data-act="closeModal">Anuluj</button><button class="btn" type="submit">Dodaj</button></div>
      </form>`, () => {
      $("#empForm").addEventListener("submit", async e => {
        e.preventDefault();
        try {
          const r = await api("POST", "/api/employees", { name: $("#eName").value, email: $("#eMail").value, position: $("#ePos").value });
          closeModal(); await refreshData(); render(); activationInfo(r.activation);
        } catch (ex) { toast(errMsg(ex)); }
      });
    }),
    resendActivation: async b => {
      try { const r = await api("POST", `/api/employees/${b.dataset.emp}/activation`); activationInfo(r.activation); }
      catch (ex) { toast(errMsg(ex)); }
    },
    kickoff: b => kickoffModal(+b.dataset.emp),
    ackKickoff: async b => {
      if (!(await askConfirm({ title: "Potwierdzić zapoznanie?", text: "Potwierdzasz, że znasz obowiązki, kryteria i cele ustalone na ten okres oceny. Od dziś liczy się okres oceny.", ok: "Potwierdzam zapoznanie" }))) return;
      try { await api("POST", `/api/kickoffs/${b.dataset.id}/acknowledge`); toast("Zapisano zapoznanie."); await refreshData(); render(); }
      catch (ex) { toast(errMsg(ex)); }
    },
    closeModal: () => closeModal(),
    addEvidence: b => {
      if (S.view === "wizard" && S.cur) return evidenceModal(null, { employeeId: S.cur.employeeId, indicator: b.dataset.ind || "", date: S.cur.periodTo && S.cur.periodTo < new Date().toISOString().slice(0, 10) ? S.cur.periodTo : undefined },
        async () => { await refreshWizardEvidence(); await refreshMissing(); render(); });
      return evidenceModal(null, { employeeId: b.dataset.emp || "", indicator: b.dataset.ind || "" }, b.dataset.after === "month" ? () => loadMonth() : undefined);
    },
    addFeedback: () => feedbackModal(null),
    // Uzupełnia puste pola „Przykład z okresu” treścią informacji – nie ustawia poziomów (decyduje oceniający)
    fillFromEvidence: b => {
      const c = S.cur, k = b.dataset.comp, comp = MODEL.find(m => m.k === k); let n = 0;
      comp.w.forEach((_, wi) => {
        const id = k + "|" + wi, list = (c.evidence || []).filter(e => e.indicator === id);
        if (!list.length || (c.ratings[id] && (c.ratings[id].ex || "").trim())) return;
        c.ratings[id] = { ...(c.ratings[id] || {}), ex: list.slice(0, 2).map(e => `${isoToPl(e.date)}: ${e.situation} – ${e.action} → ${e.result}`).join("\n") }; n++;
      });
      c.data.ratings = c.ratings; queueSave(); render(); toast(n ? `Wstawiono przykłady przy ${n} wskaźnikach. Poziomy wybierasz Ty.` : "Brak pustych pól z informacjami.");
    },
    earlyException: async () => {
      const reason = await askText({ title: "Wyjątek od reguły 6 miesięcy", label: "Uzasadnienie wyjątku", hint: "Minimum 10 znaków. Wpis trafi do dziennika zdarzeń.", min: 10, ok: "Zapisz wyjątek", multiline: true });
      if (!reason) return;
      try { await api("POST", `/api/evals/${S.cur.id}/early-exception`, { reason }); await refreshMissing(); toast("Zapisano wyjątek."); render(); } catch (ex) { toast(errMsg(ex)); }
    },
    aiCheckin: async b => {
      const out = $("#aiCkOut"); b.disabled = true; out.innerHTML = thinkingHtml(`Model AI ${aiWhere()} układa pytania do rozmowy…`); const stop = startThinking(out);
      try { const r = await api("POST", "/api/ai/checkin", { employeeId: +S.month.employeeId, month: S.month.month }); stop(); out.innerHTML = `${aiRich(r.text)}<p class="muted">Źródło: ${r.source === "ai" ? `model AI ${aiWhere()}` : "reguły systemu (asystent AI był niedostępny)"} · propozycja do przemyślenia</p>`; }
      catch (e) { stop(); out.innerHTML = ""; toast(errMsg(e)); }
      b.disabled = false;
    },
    editFeedback: b => { const f = (S.monthFeedback || []).find(x => x.id === +b.dataset.id); if (f) feedbackModal(f); },
    addPartial: () => partialModal(null),
    editPartial: b => { const p = (S.monthPartials || []).find(x => x.id === +b.dataset.id); if (p) return partialModal(p); },
    editEvidence: b => { const ev = (S.evidence || []).find(x => x.id === +b.dataset.id); if (ev) evidenceModal(ev, {}, b.dataset.after === "month" ? () => loadMonth() : undefined); },
    decideObjection: async b => {
      const result = b.dataset.result;
      if (!(await askConfirm(result === "uwzglednione" ? { title: "Uwzględnić sprzeciw?", text: "Ocena wróci do poprawy, a poprzednia wersja zostanie zapisana.", ok: "Uwzględnij sprzeciw" } : { title: "Nie uwzględniać sprzeciwu?", text: "Pracownik zobaczy decyzję w swoim panelu.", ok: "Nie uwzględniaj" }))) return;
      try {
        const r = await api("POST", `/api/evals/${b.dataset.id}/objection-decision`, { result });
        toast(r.reopened ? "Ocena wróciła do poprawy." : "Zapisano decyzję.");
        if (r.reopened) return openWizard(+b.dataset.id);
        loadSigs(+b.dataset.id, S.cur?.status || S.readEval?.status);
      } catch (e) { toast(errMsg(e)); }
    },
    saveSettings: async () => {
      const modules = Object.fromEntries([...document.querySelectorAll("[data-mod]")].map(cb => [cb.dataset.mod, cb.checked]));
      try { await api("PUT", "/api/settings", { modules }); await load(); toast("Zapisano ustawienia."); render(); }
      catch (e) { toast(errMsg(e)); }
    },
    signEval: async b => {
      try { const r = await api("POST", `/api/evals/${b.dataset.id}/sign`); toast("Podpisano."); loadSigs(+b.dataset.id, S.cur?.status || S.readEval?.status); void r; }
      catch (e) { toast(errMsg(e)); }
    },
    ackEval: async b => {
      try { await api("POST", `/api/evals/${b.dataset.id}/acknowledge`); toast("Zapoznanie zarejestrowane."); loadSigs(+b.dataset.id, S.readEval?.status); }
      catch (e) { toast(errMsg(e)); }
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
        catch (ex) { toast(errMsg(ex)); }
      });
    }),
  };
  function act(name, el) {
    if (!actions[name]) return;
    Promise.resolve(actions[name](el)).catch(e => toast(errMsg(e)));
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
      const f = [...m.querySelectorAll("button,input,select,textarea,a[href],summary")].filter(x => !x.disabled);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    });
    document.body.appendChild(m); bindActs(m); bind && bind();
    m.querySelector("input,select,textarea")?.focus();
    const card = m.firstElementChild, hint = () => card.classList.toggle("more-below", card.scrollHeight - card.clientHeight - card.scrollTop > 6);
    card.addEventListener("scroll", hint); hint(); setTimeout(hint, 150); window.addEventListener("resize", hint);
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
    if (e.target.dataset && e.target.dataset.mod) { const st = document.querySelector(`[data-mod-state="${CSS.escape(e.target.dataset.mod)}"]`); if (st) { st.innerHTML = modState(e.target.checked); st.className = "mod-state " + (e.target.checked ? "on" : "off"); } }
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

  });
  document.addEventListener("input", e => {
    const t = e.target;
    if (t.dataset.field && t.tagName === "TEXTAREA" && S.cur) { S.cur.data[t.dataset.field] = t.value; queueSave(); return; }
    if (t.dataset.ex && S.cur) { S.cur.ratings[t.dataset.ex] = { ...(S.cur.ratings[t.dataset.ex] || {}), ex: t.value }; S.cur.data.ratings = S.cur.ratings; queueSave(); }
  });

  // ---------- Start ----------
  (async () => {
    const act = /^#aktywacja=([a-f0-9]{64})$/.exec(location.hash);
    if (act) return renderActivation(act[1]);
    try {
      const me = await fetch("/api/session", { credentials: "same-origin" }).then(r => r.json()).catch(() => ({ user: null }));
      if (!me.user) return renderLogin();
      S.user = me.user; S.ai = me.ai;
      if (me.user.mustChange) return renderPasswordChange();
      await load(); render();
    } catch (e) { renderLogin(e.status === 0 ? e.message : ""); }
  })();
})();
