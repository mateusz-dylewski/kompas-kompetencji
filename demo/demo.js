(() => {
const I = (n, c) => window.KK_ICON(n, c), CI = (k, c) => window.KK_COMP_ICON(k, c);
const $ = (s, r = document) => r.querySelector(s);
const main = $("#main"), spot = $("#spot"), tip = $("#tip"), cur = $("#cursor"), blk = $("#blocker"), ov = $("#overlay");
let auto = true, idx = 0, RUN = 0, timer = null;
const CANCEL = {};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const NAV = [["dash","home","Pulpit"],["oceny","file","Oceny"],["notes","edit","Notatki"],["team","users","Zespół"],["ai","spark","Asystent AI"]];
const SCR_NAV = {dash:"dash",path:"oceny",osp:"oceny",crit:"oceny",notes:"notes",wiz:"oceny",result:"oceny",formal:"oceny",talk:"ai",plan:"ai",sign:"oceny",team:"team"};
const toast = t => { const e = $("#toast"); e.innerHTML = I("check") + t; e.classList.add("on"); setTimeout(() => e.classList.remove("on"), 2600); };

const SCREENS = {
dash: () => `<div class="page-h"><div><p class="crumb">Pulpit przełożonego</p><h1>Dzień dobry, Ewo</h1><p class="muted">Wydział Analiz i Sprawozdawczości · listopad 2026</p></div></div>
<div class="kpis stg" id="kpis">${[["users","6","osób w zespole"],["file","2","oceny do przygotowania"],["alert","23 dni","do najbliższego terminu","warn"],["target","4","aktywne plany rozwoju"]].map((k,i)=>`<div class="kpi ${k[3]||""}" style="--i:${i}"><span class="kic">${I(k[0])}</span><div><b>${k[1]}</b><span>${k[2]}</span></div></div>`).join("")}</div>
<div class="grid2"><section class="card"><div class="card-h"><h2>${I("users")}Mój zespół</h2></div><div class="stg">
${[["AN","an","Anna Nowak","Specjalistka ds. analiz","Okresowa · arkusz C","termin 15.12.2026",`<button class="btn sm" id="startAnna">${I("arrow")}Rozpocznij ocenę</button>`],
["PZ","pz","Piotr Zając","Referent, w urzędzie od 06.2026","Pierwsza ocena","termin 30.01.2027",'<span class="chip c-nv">notatki: 3</span>'],
["MD","md","Marta Dąbrowska","Kierowniczka referatu","Okresowa · arkusz B","złożona",'<span class="chip c-ok">złożona</span>'],
["KL","kl","Kamil Lewandowski","Starszy specjalista","Okresowa · arkusz C","omówiona",'<span class="chip c-ok">omówiona</span>'],
["JM","jm","Julia Mazur","Specjalistka","Okresowa · arkusz C","termin 03.2027",'<span class="chip c-gr">w toku okresu</span>']].map((r,i)=>`<div class="team-row" style="--i:${i}" id="row${r[0]}"><div class="who"><span class="av av-${r[1]}">${r[0]}</span><div><b>${r[2]}</b><small>${r[3]}</small></div></div><div class="typ">${r[4]}<small>${r[5]}</small></div><div class="stat"></div>${r[6]}</div>`).join("")}</div></section>
<aside class="card" id="todo"><div class="card-h"><h2>${I("shield")}Asystent formalny</h2></div><div class="todo stg">
<div class="todo-i warn" style="--i:0">${I("alert")}<div><b>Ocena okresowa: Anna Nowak</b><span>Kolejna ocena co 24 miesiące. Termin za <span class="days">23 dni</span>.</span></div></div>
<div class="todo-i" style="--i:1">${I("user")}<div><b>Pierwsza ocena: Piotr Zając</b><span>Arkusz pierwszej oceny. Termin 30.01.2027.</span></div></div>
<div class="todo-i" style="--i:2">${I("target")}<div><b>Przegląd planów rozwoju</b><span>2 cele z krokami czekają na omówienie.</span></div></div></div></aside></div>`,

path: () => `<div class="page-h"><div><p class="crumb">Oceny › <b>Nowa ocena</b></p><h1>Anna Nowak · wybór ścieżki</h1></div></div>
<div class="paths"><div class="path first dim" id="pFirst"><h2>${I("star")}Pierwsza ocena</h2><p class="why">Nie dotyczy: Anna pracuje w urzędzie od 2019 r.</p>
<div class="tiles"><div class="tile t-g">${I("arrow")}Rozpocznij ocenę</div><div class="tile t-r">${I("check")}Zakończ z modelem kompetencji</div><div class="tile t-v">${I("file")}Asystent formalny</div><div class="tile t-v">${I("msg")}Asystent rozmowy</div></div></div>
<div class="path periodic" id="pPer"><span class="chip c-vio rec">${I("spark")}wskazane przez system</span><h2>${I("chart")}Ocena okresowa</h2><p class="why">Ostatnia ocena: 15.12.2024. Ocena okresowa co 24 miesiące (art. 81 ust. 1 ustawy).</p>
<div class="psteps stg"><div class="pstep" style="--i:0"><span class="n">1</span><div><b>Analiza opisu stanowiska pracy</b><small>asystent proponuje kryteria z treści opisu</small></div></div><div class="pstep" style="--i:1"><span class="n">2</span><div><b>Ocena okresowa: formularz B lub C</b><small>z zastosowaniem modelu kompetencji</small></div></div></div></div></div>`,

osp: () => `<div class="page-h"><div><p class="crumb">Ocena okresowa › <b>Krok 1: analiza opisu stanowiska</b></p><h1>Opis stanowiska: specjalista ds. analiz</h1></div></div>
<div class="grid2 even"><section class="card osp"><div class="osp-meta"><span class="chip c-nv">Wydział Analiz i Sprawozdawczości</span><span class="chip c-gr">wersja z 02.2025</span></div><div class="osp-doc" id="ospDoc"><div class="scan" id="scan"></div>
<p><b>Cel stanowiska:</b> zapewnienie <mark class="k-n">rzetelnych analiz i zestawień danych</mark> na potrzeby sprawozdawczości wydziału.</p><ol>
<li>Przygotowuje analizy do sprawozdań kwartalnych, <mark class="k-n">zgodnie z obowiązującymi procedurami</mark>.</li>
<li><mark class="k-v">Weryfikuje kompletność i poprawność danych</mark> przekazywanych przez komórki urzędu.</li>
<li><mark class="k-v">Udziela wyjaśnień interesantom</mark> w zakresie publikowanych danych.</li>
<li><mark class="k-c">Współpracuje z zespołem IT</mark> przy rozwoju narzędzi raportowych.</li>
<li><mark class="k-c">Prezentuje wyniki analiz</mark> kierownictwu wydziału.</li></ol>
<p><mark>Nie kieruje pracą innych osób.</mark></p></div><button class="btn" id="analyze">${I("spark")}Analizuj opis stanowiska</button></section>
<section class="card" id="ospRes"><div class="card-h"><h2>${I("spark")}Propozycje asystenta</h2><span class="ai-tag">${I("lock")}AI tylko proponuje</span></div><div id="resBody"><div class="res-empty">${I("spark")}Asystent wskaże kryteria pasujące do zadań na stanowisku.</div></div></section></div>`,

crit: () => `<div class="page-h"><div><p class="crumb">Ocena okresowa › <b>Kryteria · arkusz C</b></p><h1>Kryteria oceny: Anna Nowak</h1></div></div>
<div class="grid2 even"><section class="card" id="mand"><div class="card-h"><h2>${I("lock")}Obowiązkowe dla arkusza C</h2></div><div class="crit-list stg">
${["WYKORZYSTYWANIE WIEDZY","RZETELNOŚĆ","ORGANIZACJA PRACY","WSPÓŁPRACA","KOMUNIKACJA"].map((k,i)=>`<div class="crit lock" style="--i:${i}">${CI(k)}<div><b>${k}</b><small>rozporządzenie z 4.04.2016</small></div><span class="end">${I("lock")}</span></div>`).join("")}</div></section>
<section class="card" id="extra"><div class="card-h"><h2>${I("plus")}Dodatkowe: wybierasz Ty</h2></div><div class="crit-list stg">
${[["MYŚLENIE ANALITYCZNE","z opisu: zadania 1–2"],["ORIENTACJA NA KLIENTA","z opisu: zadanie 3"],["WYSTĄPIENIA PUBLICZNE","z opisu: zadanie 5, do rozważenia"]].map((k,i)=>`<div class="crit" id="ex${i}" style="--i:${i}"><span class="box"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3"><path d="M5 12l5 5 9-10"/></svg></span>${CI(k[0])}<div><b>${k[0]}</b><small>${k[1]}</small></div><span class="end ai-tag">${I("spark")}propozycja</span></div>`).join("")}</div>
<div class="sumline"><span class="chip c-nv" id="critCount">5 kryteriów</span><span class="muted">model: 14 kompetencji, 49 wskaźników</span><button class="btn" id="approve" style="margin-left:auto">${I("check")}Zatwierdź i przekaż</button></div></section></div>`,

notes: () => `<div class="page-h"><div><p class="crumb">Notatki › <b>Anna Nowak</b></p><h1>Przykłady z całego okresu, nie z pamięci</h1></div></div>
<div class="grid2"><section class="card"><div class="tl stg" id="tl">
${[["14.03.2026","RZETELNOŚĆ","Zestawienie do sprawozdania za IV kwartał przekazane z kontrolą sum, bez poprawek odbiorcy."],["22.05.2026","ORIENTACJA NA KLIENTA","Wyjaśnienia dla interesanta w 2 dni, odpowiedź bez dalszych pytań."],["03.07.2026","KOMUNIKACJA","Prezentacja wyników dla kierownictwa: część danych bez kontekstu, pytania o źródła."],["18.09.2026","WSPÓŁPRACA","Uzgodniła z IT zakres raportu, podział zadań zapisany w notatce."]].map((n,i)=>`<div class="tl-i" style="--i:${i}"><div class="meta">${n[0]} · <span class="chip c-nv">${n[1]}</span></div><p>${n[2]}</p></div>`).join("")}</div></section>
<aside class="card quick" id="quick"><div class="card-h"><h2>${I("edit")}Szybka notatka</h2></div><textarea id="qText" readonly placeholder="Co się wydarzyło? Opisz zachowanie i efekt."></textarea><div class="row"><span id="qTag"></span><button class="btn" id="addNote">${I("plus")}Dodaj notatkę</button></div></aside></div>`,

wiz: () => { const M = window.KK_DEMO_R; return `<div class="page-h"><div><p class="crumb">Ocena okresowa › <b>Kreator</b></p><h1>Jedna kompetencja na ekranie</h1></div></div>
<div class="stepper" id="stepper">${["WYKORZYSTYWANIE WIEDZY","RZETELNOŚĆ","ORGANIZACJA PRACY","WSPÓŁPRACA","KOMUNIKACJA","MYŚLENIE ANALITYCZNE","ORIENTACJA NA KLIENTA"].map((k,i)=>`<span class="stp ${i===0?"done":i===1?"cur":""}">${CI(k)}${i+1}. ${k.split(" ")[0]}</span>`).join("")}</div>
<section class="card"><div class="wiz-h">${CI("RZETELNOŚĆ")}<div><h2 style="font-size:20px">RZETELNOŚĆ</h2><span class="muted">Opisy zachowań z modelu kompetencji. Wybierz ten, który pasuje do przykładów.</span></div></div>
${M.map((w,wi)=>`<div class="ind" id="ind${wi}"><h3>${w.w.replace(/\n/g," ")}</h3><div class="anchors">${w.p.map((p,pi)=>`<button class="anc" id="a${wi}${pi}"><span class="pts">${[1,3,5,7,9][pi]} pkt<span>${["znacznie poniżej","poniżej","na poziomie","powyżej","znacznie powyżej"][pi]}</span></span>${p}</button>`).join("")}</div>
<div class="evid" id="ev${wi}">${I("clip")}<div><b>Dowód z notatek, ${wi?"19.10.2026":"14.03.2026"}:</b> ${wi?"Sprawozdanie za III kwartał oddane 2 dni przed terminem, ryzyko opóźnienia zgłoszone tydzień wcześniej.":"Zestawienie przekazane z kontrolą sum, bez poprawek odbiorcy."}</div></div></div>`).join("")}
<div class="ind" id="partialBox"><h3>Ocena cząstkowa kryterium<small>Podpowiedź z wskaźników to tylko podpowiedź. Ocenę przyznajesz Ty.</small></h3><div class="partial"><div class="pbtns">${[1,3,5,7,9].map(v=>`<button class="pb" id="pb${v}">${v}</button>`).join("")}</div><span class="hint" id="pHint">Średnia wskaźników: <b>—</b></span></div></div></section>`; },

result: () => `<div class="page-h"><div><p class="crumb">Ocena okresowa › <b>Wynik</b></p><h1>Wynik liczy się sam, zgodnie z § 11</h1></div></div>
<div class="grid2"><section class="card"><div class="bars" id="bars">${RES.map(r=>`<div class="bar"><span class="lbl">${CI(r[0])}<span>${r[0]}</span></span><span class="track"><i class="fill ${r[1]<6?"lo":""}" data-v="${r[1]}"></i></span><span class="v">${r[1]}</span></div>`).join("")}</div></section>
<aside class="card" id="verd"><span class="muted">Średnia ocen cząstkowych</span><div class="big" id="avg">0,0</div><div class="scale"><div class="seg"><i></i><i></i><i></i><i></i><i></i></div><div class="lb"><span>znacznie poniżej</span><span>poniżej</span><span>na poziomie</span><span>powyżej</span><span>znacznie powyżej</span></div><i class="mk" id="mk"></i></div>
<div class="verdict" id="vd" style="opacity:0">${I("check")}<div>Ocena pozytywna · powyżej oczekiwań<small>Żadna ocena cząstkowa nie jest „znacznie poniżej oczekiwań”.</small></div></div></aside></div>`,

formal: () => `<div class="page-h"><div><p class="crumb">Ocena okresowa › <b>Asystent formalny</b></p><h1>Zero braków przed złożeniem</h1></div></div>
<div class="grid2"><section class="card"><div class="chk" id="chk">${CHK.map((c,i)=>`<div class="chk-i" id="c${i}"><span class="st">${I("check")}</span><div><b>${c[0]}</b><small>${c[1]}</small></div><span class="end"></span></div>`).join("")}</div></section>
<aside class="card"><div class="gauge"><svg class="ring" viewBox="0 0 110 110"><circle class="bg" cx="55" cy="55" r="45"/><circle class="fg" id="rg" cx="55" cy="55" r="45" stroke-dasharray="283" stroke-dashoffset="283"/><text x="55" y="63" text-anchor="middle" id="rgT">0%</text></svg><div><b>Kompletność arkusza</b><p class="muted">Procedura, formularz, terminy i podpisy sprawdzane automatycznie.</p></div></div></aside></div>`,

talk: () => `<div class="page-h"><div><p class="crumb">Asystent AI › <b>Przygotowanie do rozmowy</b></p><h1>Rozmowa o rozwoju, nie o wyroku</h1></div><span class="ai-tag">${I("lock")}imiona usuwane przed wysłaniem do AI</span></div>
<div id="topicsWrap"></div><div class="rules" style="margin-top:16px" id="rules">${["Zacznij od mocnych stron","Pytaj o zachowania, nie o osobę","Pytania otwarte: jak, co, kiedy","Decyzja należy do Ciebie"].map(r=>`<span class="rule">${I("check")}${r}</span>`).join("")}</div>`,

plan: () => `<div class="page-h"><div><p class="crumb">Asystent AI › <b>Plan rozwoju</b></p><h1>Z obszarów do rozwoju powstaje plan</h1></div></div>
<div class="grid2 even"><section class="card"><div class="card-h"><h2>${I("bulb")}Propozycje działań</h2></div><div class="sugg">
${PLAN.map((p,i)=>`<div class="sg" id="sg${i}"><span class="kic">${I(p[0])}</span><div><b>${p[1]}</b><small>${p[2]}</small></div><button class="btn sm ghost" id="add${i}">${I("plus")}Dodaj</button></div>`).join("")}</div></section>
<section class="card" id="planBox"><div class="card-h"><h2>${I("target")}Plan rozwoju: Anna Nowak</h2></div><div id="goals"><div class="plan-empty">Wybierz działania z listy.</div></div></section></div>`,

sign: () => `<div class="page-h"><div><p class="crumb">Ocena okresowa › <b>Złożenie</b></p><h1>Arkusz gotowy: PDF, XML i dziennik</h1></div></div>
<div class="grid2"><section><div class="sheet" id="sheet"><div class="stamp" id="stamp">ZŁOŻONA</div><div class="sh-t">ARKUSZ OCENY OKRESOWEJ (C)</div><div class="sh-s">wzór wg rozporządzenia z 4.04.2016</div>
<div class="fld"><span>Oceniany</span><em>Anna Nowak, specjalista ds. analiz</em></div><div class="fld"><span>Oceniający</span><em>Ewa Zielińska, naczelniczka wydziału</em></div><div class="fld"><span>Okres oceny</span><em>15.12.2024 – 15.12.2026</em></div>
<table><tr><th>Kryterium</th><th>Ocena</th></tr>${RES.map(r=>`<tr><td>${r[0]}</td><td class="n">${r[1]}</td></tr>`).join("")}<tr><th>Wynik</th><th>pozytywna (6,4)</th></tr></table><div class="hash" id="hash"></div></div></section>
<aside class="card"><button class="btn" id="submit" style="width:100%;justify-content:center">${I("check")}Złóż ocenę</button><div class="flow" style="margin-top:20px" id="flow">${["Złożona i podpisana","Przekazana pracownikowi","Rozmowa oceniająca 08.12.2026","Zapoznanie potwierdzone w aplikacji","Wpis w dzienniku zdarzeń"].map(f=>`<div class="fl"><span class="st">${I("check")}</span><div><b>${f}</b></div></div>`).join("")}</div></aside></div>`,

team: () => `<div class="page-h"><div><p class="crumb">Zespół › <b>Wyniki zbiorcze</b></p><h1>Gdzie zespół może urosnąć razem</h1></div></div>
<div class="grid2"><section class="card heat" id="heat"><div class="bars">${[["WSPÓŁPRACA",7.2],["RZETELNOŚĆ",6.8],["WYKORZYSTYWANIE WIEDZY",6.6],["ORGANIZACJA PRACY",6.4],["KOMUNIKACJA",5.4]].map(r=>`<div class="bar"><span class="lbl">${CI(r[0])}<span>${r[0]}</span></span><span class="track"><i class="fill ${r[1]<6?"lo":""}" data-v="${r[1]}"></i></span><span class="v">${String(r[1]).replace(".",",")}</span></div>`).join("")}</div>
<div class="privacy">${I("shield")}Tylko zbiorczo, od 5 osób. Bez wskazywania pojedynczych pracowników.</div></section>
<aside class="rec-card" id="teamRec"><h3>${I("spark")}Propozycja dla zespołu</h3><p>Najczęstszy obszar do rozwoju: <b>komunikacja wyników</b>. Warsztat zespołowy w I kwartale 2027 r.</p><button class="btn sm">${I("plus")}Dodaj do planu wydziału</button></aside></div>`,
};
const RES = [["WYKORZYSTYWANIE WIEDZY",7],["RZETELNOŚĆ",7],["ORGANIZACJA PRACY",7],["WSPÓŁPRACA",7],["KOMUNIKACJA",5],["MYŚLENIE ANALITYCZNE",7],["ORIENTACJA NA KLIENTA",5]];
const CHK = [["Arkusz zgodny ze stanowiskiem","arkusz C: stanowisko bez kierowania zespołem"],["5 kryteriów obowiązkowych ocenionych","plus 2 dodatkowe z opisu stanowiska"],["Oceny cząstkowe w skali 1, 3, 5, 7, 9","§ 11 rozporządzenia"],["Przykłady zachowań przy ocenach","14 z 14 wskaźników z dowodem"],["Data rozmowy oceniającej","wymagana przed przekazaniem"],["Termin oceny","15.12.2026, zapas 23 dni"]];
const PLAN = [["users","Mentoring: 3 sesje z doświadczoną analityczką","Komunikacja · do 30.04.2027"],["book","Warsztat: prezentacja danych dla kierownictwa","Komunikacja · 2 dni · do 31.03.2027"],["target","Dzień w punkcie obsługi interesantów","Orientacja na klienta · do 28.02.2027"]];

const ch = (k, n) => ({ch:k, n});
const STEPS = [
{screen:"dash",target:"#kpis",ch:"Pulpit",title:"Cały zespół w jednym miejscu",text:"Przełożona widzi od razu, kogo trzeba ocenić, jakie są terminy i ile planów rozwoju jest w toku."},
{screen:"dash",target:"#todo",ch:"Pulpit",title:"Asystent formalny pilnuje terminów",text:"Ocena okresowa co 24 miesiące, pierwsza ocena po wejściu do urzędu. System przypomina, zanim termin minie.",law:"art. 81 ust. 1 ustawy: ocena okresowa co 24 miesiące"},
{screen:"dash",target:"#startAnna",click:true,ch:"Pulpit",title:"Zaczynamy ocenę Anny",text:"Jedno kliknięcie i Kompas prowadzi dalej.",go:"path"},
{screen:"path",target:"#pPer",click:true,ch:"Ścieżka",title:"System sam wskazuje ścieżkę",text:"Jak w schemacie zadania: pierwsza ocena albo ocena okresowa. Tu ocena okresowa, bo minęły 24 miesiące.",fx:async w=>{$("#pPer").classList.add("sel");await w(1600);},go:"osp"},
{screen:"osp",target:"#analyze",click:true,ch:"Krok 1: opis stanowiska",title:"(a) Dobór kryteriów z opisu stanowiska",text:"Asystent czyta opis stanowiska i dopasowuje zadania do modelu kompetencji. Każda propozycja ma cytat z opisu.",fx:async w=>{
  $("#resBody").innerHTML=`<div class="think"><span class="dots"><i></i><i></i><i></i></span>Asystent czyta opis stanowiska…</div>`;$("#scan").classList.add("go");
  for(const m of document.querySelectorAll("#ospDoc mark")){await w(220);m.classList.add("lit");}
  await w(400);
  $("#resBody").innerHTML=`<div class="res stg">${[["RZETELNOŚĆ","zgodnie z obowiązującymi procedurami","obowiązkowe"],["MYŚLENIE ANALITYCZNE","weryfikuje kompletność i poprawność danych","propozycja"],["ORIENTACJA NA KLIENTA","udziela wyjaśnień interesantom","propozycja"],["KOMUNIKACJA","prezentuje wyniki analiz","obowiązkowe"]].map((r,i)=>`<div class="res-i" style="--i:${i}">${CI(r[0])}<div><b>${r[0]}</b><q>${r[1]}</q></div><span class="chip ${r[2]=="propozycja"?"c-vio":"c-gr"}">${r[2]}</span></div>`).join("")}</div>
  <div style="margin-top:16px"><b>Rodzaj arkusza</b><div class="forms"><button class="form-o"><b><span class="radio"></span>Arkusz B</b><small>osoby kierujące zespołem</small></button><button class="form-o rec" id="pickC"><b><span class="radio"></span>Arkusz C</b><small>„Nie kieruje pracą innych osób”</small></button></div></div>`;await w(900);}},
{screen:"osp",target:"#pickC",click:true,ch:"Krok 1: opis stanowiska",title:"Właściwy formularz: arkusz C",text:"W opisie: „Nie kieruje pracą innych osób”. Dlatego arkusz C. Przełożona zatwierdza wybór.",fx:async w=>{$("#pickC").classList.add("sel");await w(1000);},go:"crit"},
{screen:"crit",target:"#mand",ch:"Kryteria",title:"Kryteria obowiązkowe są pewne",text:"Arkusz C ma 5 kryteriów obowiązkowych z rozporządzenia. Nie da się ich pominąć.",law:"rozporządzenie Prezesa Rady Ministrów z 4.04.2016 (Dz. U. poz. 470)"},
{screen:"crit",target:"#approve",click:true,ch:"Kryteria",title:"Dodatkowe wybiera człowiek",text:"Asystent proponuje kryteria dodatkowe z opisu stanowiska. Przełożona zaznacza dwa i przekazuje pracownikowi.",fx:async w=>{for(const i of [0,1]){$("#ex"+i).classList.add("on");$("#critCount").textContent=(6+i)+" kryteriów";await w(500);}toast("Kryteria przekazane. Anna widzi je w swoim profilu.");await w(1200);},go:"notes"},
{screen:"notes",target:"#quick",click:true,clickSel:"#addNote",ch:"Notatki",title:"(b) Ocena oparta na przykładach",text:"Przez cały okres przełożona zapisuje krótkie notatki. Asystent sam przypisuje je do kompetencji i wskaźnika.",fx:async w=>{
  const t="Sprawozdanie za III kwartał oddane 2 dni przed terminem. Ryzyko opóźnienia danych zgłosiła tydzień wcześniej.",q=$("#qText");
  for(let i=0;i<=t.length;i+=3){q.value=t.slice(0,i);await w(18);}q.value=t;
  $("#qTag").innerHTML=`<span class="ai-tag pop">${I("spark")}RZETELNOŚĆ · dotrzymywanie zobowiązań</span>`;await w(900);
  $("#tl").insertAdjacentHTML("afterbegin",`<div class="tl-i new slide-in"><div class="meta">19.10.2026 · <span class="chip c-nv">RZETELNOŚĆ</span></div><p>${t}</p></div>`);await w(1300);},go:"wiz"},
{screen:"wiz",target:"#stepper",ch:"Kreator oceny",title:"Jedna kompetencja na ekranie",text:"Zamiast długiego formularza: krok po kroku przez 7 kryteriów. Pierwsze już gotowe."},
{screen:"wiz",target:"#a03",click:true,ch:"Kreator oceny",title:"Opisy zachowań zamiast ogólników",text:"Każdy poziom ma opis zachowania z modelu kompetencji. Przykład z notatek dołącza się sam.",fx:async w=>{$("#a03").classList.add("sel");await w(400);$("#ev0").classList.add("show");await w(1200);}},
{screen:"wiz",target:"#a12",click:true,ch:"Kreator oceny",title:"Notatka z października wraca jako dowód",text:"Ta sama notatka, którą dodaliśmy przed chwilą, uzasadnia ocenę wskaźnika.",fx:async w=>{$("#a12").classList.add("sel");await w(400);$("#ev1").classList.add("show");$("#pHint").innerHTML="Średnia wskaźników: <b>6,0</b> · podpowiedź";await w(1200);}},
{screen:"wiz",target:"#partialBox",click:true,clickSel:"#pb7",ch:"Kreator oceny",title:"Decyzja zostaje u przełożonej",text:"System podpowiada średnią, ale ocenę cząstkową w skali 1–9 przyznaje człowiek.",fx:async w=>{$("#pb7").classList.add("sel");await w(1100);},go:"result"},
{screen:"result",target:"#verd",ch:"Wynik",title:"Wynik wyliczony zgodnie z przepisami",text:"Średnia ocen cząstkowych, poziom i ocena pozytywna albo negatywna wg § 11. Bez ręcznego liczenia i bez pomyłek.",law:"§ 11 ust. 4: negatywna przy „poniżej” albo cząstkowej „znacznie poniżej oczekiwań”",enter:async w=>{
  await w(300);document.querySelectorAll("#bars .fill").forEach(f=>f.style.width=(f.dataset.v/9*100)+"%");
  for(let v=0;v<=6.43;v+=0.13){$("#avg").textContent=v.toFixed(1).replace(".",",");await w(25);}$("#avg").textContent="6,4";
  $("#mk").style.left=(6.43/9*100)+"%";await w(900);$("#vd").style.opacity=1;$("#vd").classList.add("pop");}},
{screen:"formal",target:"#chk",ch:"Asystent formalny",title:"Asystent formalny sprawdza arkusz",text:"Procedura, formularz i terminy. Znalazł jeden brak: datę rozmowy oceniającej.",enter:async w=>{
  for(let i=0;i<CHK.length;i++){const c=$("#c"+i),s=c.querySelector(".st");s.classList.add("spin");s.innerHTML="";await w(330);s.classList.remove("spin");
   if(i===4){c.classList.add("bad");s.innerHTML=I("alert");c.querySelector(".end").innerHTML=`<button class="btn sm" id="fixDate">Uzupełnij</button>`;}else{c.classList.add("ok");s.innerHTML=I("check");}
   const p=Math.round((i+1-(i>=4?1:0))/CHK.length*100);$("#rg").style.strokeDashoffset=283-283*p/100;$("#rgT").textContent=p+"%";}}},
{screen:"formal",target:"#c4",click:true,clickSel:"#fixDate",ch:"Asystent formalny",title:"Jeden klik i brak znika",text:"Data rozmowy uzupełniona. Arkusz jest kompletny i gotowy do złożenia.",fx:async w=>{const c=$("#c4");c.querySelector(".end").innerHTML=`<span class="date-in">08.12.2026</span>`;await w(500);c.classList.remove("bad");c.classList.add("ok");c.querySelector(".st").innerHTML=I("check");$("#rg").style.strokeDashoffset=0;$("#rgT").textContent="100%";await w(1200);},go:"talk"},
{screen:"talk",target:"#topicsWrap",ch:"Asystent rozmowy",title:"(c) Przygotowanie do rozmowy",text:"Asystent wybiera kompetencję do docenienia i dwie do omówienia, a do każdej podsuwa pytania otwarte. Nie ocenia osoby.",enter:async w=>{
  $("#topicsWrap").innerHTML=`<div class="think"><span class="dots"><i></i><i></i><i></i></span>Asystent przygotowuje rozmowę…</div>`;await w(1300);
  const T=[["good","Do docenienia","RZETELNOŚĆ","Która kontrola jakości w zestawieniach zadziałała najlepiej i gdzie jeszcze możesz ją zastosować?"],["dev","Do omówienia","KOMUNIKACJA","Jak przygotowujesz prezentację, gdy odbiorcy nie znają źródeł danych?"],["dev","Do omówienia","ORIENTACJA NA KLIENTA","Jak ustalasz, czego interesant naprawdę potrzebuje, zanim przygotujesz odpowiedź?"]];
  $("#topicsWrap").innerHTML=`<div class="topics stg">${T.map((t,i)=>`<div class="topic ${t[0]}" style="--i:${i}"><span class="chip ${t[0]=="good"?"c-ok":"c-wr"}">${t[1]}</span><h3>${CI(t[2])}${t[2]}</h3><div class="q" id="q${i}"></div></div>`).join("")}</div>`;
  for(let i=0;i<3;i++){const s=T[i][3];for(let j=0;j<=s.length;j+=4){$("#q"+i).textContent=s.slice(0,j);await w(14);}$("#q"+i).textContent=s;}}},
{screen:"plan",target:"#add0",click:true,ch:"Plan rozwoju",title:"Obszary do rozwoju zamieniają się w plan",text:"Mentoring, coaching, warsztat. Każde działanie ma termin i kroki, a cel trafia do profilu pracownika.",fx:async w=>{
  const g=$("#goals");g.innerHTML="";for(const i of [0,1]){$("#sg"+i).classList.add("used");const p=PLAN[i];
  g.insertAdjacentHTML("beforeend",`<div class="goal slide-in"><b>${p[1]}</b><div class="smart"><span class="chip c-nv">konkretny</span><span class="chip c-nv">mierzalny</span><span class="chip c-nv">${p[2].split("· ").pop()}</span></div><ul class="steps"><li>Ustalenie terminów z mentorem</li><li>Przegląd postępów za 3 miesiące</li></ul></div>`);await w(800);}
  toast("Plan rozwoju zapisany w profilu Anny.");await w(1200);},go:"sign"},
{screen:"sign",target:"#submit",click:true,ch:"Złożenie",title:"Złożenie, podpis i ślad audytowy",text:"Arkusz wg wzoru z rozporządzenia, podpis z sumą kontrolną SHA-256, przekazanie pracownikowi i wpis w dzienniku.",fx:async w=>{
  $("#stamp").classList.add("go");await w(500);const h="SHA-256: 4f1c9a07e2b84d3fa96c0e5b71d2c8a3f05e9b6d4c27a18e3b9f60d5c1a7e2b4";for(let i=0;i<=h.length;i+=4){$("#hash").textContent=h.slice(0,i);await w(12);}
  for(const f of document.querySelectorAll("#flow .fl")){f.classList.add("on");await w(380);}await w(800);},go:"team"},
{screen:"team",target:"#heat",ch:"Zespół",title:"Rozwój całego zespołu",text:"Wyniki zbiorcze pokazują wspólny obszar do rozwoju. Tylko od 5 osób, bez wskazywania pojedynczych pracowników.",enter:async w=>{await w(300);document.querySelectorAll("#heat .fill").forEach(f=>f.style.width=(f.dataset.v/9*100)+"%");await w(800);}},
{screen:"team",target:"#teamRec",ch:"Zespół",title:"Z oceny do działania",text:"Kompas proponuje warsztat zespołowy. Ocena kończy się planem, nie szufladą.",last:true},
];

// ---------- silnik ----------
const CH = [...new Set(STEPS.map(s => s.ch))];
function renderChapters() { $("#chapters").innerHTML = CH.map((c, i) => { const first = STEPS.findIndex(s => s.ch === c), curI = CH.indexOf(STEPS[idx]?.ch); return `<button data-j="${first}" class="${i < curI ? "done" : i === curI ? "on" : ""}"><i></i><span>${c}</span></button>`; }).join(""); }
function setNav(scr) { $("#sideNav").innerHTML = NAV.map(n => `<a class="${SCR_NAV[scr] === n[0] ? "on" : ""}">${I(n[1])}${n[2]}${n[0] === "oceny" ? '<span class="badge">2</span>' : ""}</a>`).join(""); }
let curScreen = null;
function show(scr) { curScreen = scr; setNav(scr); main.innerHTML = `<div class="screen">${SCREENS[scr]()}</div>`; main.scrollTop = 0; }
const mkWait = (run, fast) => async ms => { if (!fast) await sleep(ms); if (run !== RUN) throw CANCEL; };
function rect(sel) { const e = $(sel); return e ? e.getBoundingClientRect() : null; }
function place() {
  const s = STEPS[idx]; if (!s || ov.classList.contains("on")) return;
  const r = rect(s.target); if (!r) return;
  const p = 8; Object.assign(spot.style, { top: r.top - p + "px", left: r.left - p + "px", width: r.width + 2 * p + "px", height: r.height + 2 * p + "px" });
  if (innerWidth <= 640) return;
  const tw = tip.offsetWidth, th = tip.offsetHeight; let x = r.right + 20, y = r.top;
  if (x + tw > innerWidth - 12) x = r.left - tw - 20;
  if (x < 12) { x = Math.min(Math.max(12, r.left), innerWidth - tw - 12); y = r.bottom + 18; if (y + th > innerHeight - 12) y = r.top - th - 18; }
  y = Math.min(Math.max(y, 76), innerHeight - th - 12);
  tip.style.left = x + "px"; tip.style.top = y + "px";
}
(function loop() { place(); requestAnimationFrame(loop); })();

function tipHtml(s) {
  return `<div class="t-ch"><span>${s.ch}</span><span>${idx + 1} / ${STEPS.length}</span></div><h3 id="tipTitle">${s.title}</h3><p>${s.text}</p>${s.law ? `<div class="law">${I("book")}${s.law}</div>` : ""}
  <div class="t-ft">${s.click && !auto ? `<span class="t-do">${I("arrow")}Kliknij podświetlony element</span>` : ""}<div class="t-btns"><button id="tBack" ${idx ? "" : "disabled"}>Wstecz</button><button class="pri" id="tNext">${s.last ? "Podsumowanie" : "Dalej"}</button></div></div>${auto ? '<div class="t-timer"><i id="tTimer"></i></div>' : ""}`;
}
async function go(i) {
  clearTimeout(timer); const run = ++RUN; idx = Math.max(0, Math.min(i, STEPS.length - 1)); const s = STEPS[idx];
  ov.classList.remove("on"); renderChapters(); $("#progBar").style.width = ((idx + 1) / STEPS.length * 100) + "%";
  tip.classList.remove("on"); spot.classList.remove("on"); cur.classList.remove("on");
  try {
    let j = idx; while (j > 0 && STEPS[j - 1].screen === s.screen && !STEPS[j - 1].go) j--;
    if (curScreen !== s.screen || j < idx || true) { show(s.screen); const fw = mkWait(run, true); for (let k = j; k < idx; k++) { if (STEPS[k].enter) await STEPS[k].enter(fw); if (STEPS[k].fx) await STEPS[k].fx(fw); } }
    const w = mkWait(run, false); await w(350);
    $(s.target)?.scrollIntoView({ block: "center", behavior: "smooth" }); await w(450);
    blk.classList.add("on"); spot.classList.add("on"); spot.classList.toggle("click", !!s.click);
    tip.innerHTML = tipHtml(s); tip.classList.add("on");
    $("#tBack").onclick = () => go(idx - 1); $("#tNext").onclick = () => act();
    if (s.enter) await s.enter(w);
    if (auto) {
      const read = Math.min(7000, 2600 + s.text.length * 28); const tt = $("#tTimer");
      if (tt) { tt.style.transition = `width ${read}ms linear`; requestAnimationFrame(() => tt.style.width = "100%"); }
      await w(read); act(true);
    }
  } catch (e) { if (e !== CANCEL) console.error(e); }
}
async function act(fromAuto) {
  const s = STEPS[idx], run = RUN, w = mkWait(run, false);
  try {
    if (s.click) {
      const el = $(s.clickSel || s.target);
      if (el && (fromAuto || auto)) { const r = el.getBoundingClientRect(); cur.classList.add("on"); cur.style.left = r.left + r.width / 2 + "px"; cur.style.top = r.top + r.height / 2 + "px"; await w(850); cur.classList.add("tap"); await w(200); cur.classList.remove("tap"); }
      tip.classList.remove("on"); if (s.fx) await s.fx(w);
    }
    if (s.last) return outro();
    go(idx + 1);
  } catch (e) { if (e !== CANCEL) console.error(e); }
}
blk.addEventListener("click", e => { const s = STEPS[idx]; if (!s?.click) return; const r = rect(s.target); if (r && e.clientX >= r.left - 8 && e.clientX <= r.right + 8 && e.clientY >= r.top - 8 && e.clientY <= r.bottom + 8) act(); });
document.addEventListener("keydown", e => { if (ov.classList.contains("on")) return; if (e.key === "ArrowRight" || e.key === "Enter") act(); if (e.key === "ArrowLeft") go(idx - 1); });
$("#chapters").addEventListener("click", e => { const b = e.target.closest("button"); if (b) go(+b.dataset.j); });
function setMode(a) { auto = a; $("#btnMode").innerHTML = a ? `${I("chart")}<span class="lbl">Odtwarza samo</span>` : `${I("user")}<span class="lbl">Klikam sam</span>`; $("#btnMode").setAttribute("aria-pressed", a); }
$("#btnMode").onclick = () => { setMode(!auto); if (!ov.classList.contains("on")) go(idx); };
$("#btnRestart").innerHTML = I("back"); $("#btnRestart").onclick = intro;

function intro() {
  RUN++; show("dash"); blk.classList.remove("on"); spot.classList.remove("on"); tip.classList.remove("on"); idx = 0; renderChapters(); $("#progBar").style.width = "0";
  ov.innerHTML = `<div class="hero"><img class="logo" src="assets/icon-kk.png" alt=""><div><span class="kick">${I("spark")}Pokaz dla jury · 2 minuty · dane fikcyjne</span></div>
  <h1>Ocena pracownika, która <em>prowadzi przełożonego</em> krok po kroku</h1>
  <p class="lead">Od opisu stanowiska, przez ocenę opartą na przykładach, po rozmowę i plan rozwoju. AI podpowiada, człowiek decyduje.</p>
  <div class="hero-cta"><button class="btn" id="goAuto">${I("arrow")}Pokaż mi (odtwarza samo)</button><button class="btn ghost" id="goMan">${I("user")}Przeprowadź mnie (klikam sam)</button></div>
  <div class="feats">${[["signpost","(a) Dobór kryteriów","z opisu stanowiska, z cytatem"],["scale","(b) Rzetelna ocena","opisy zachowań i dowody z notatek"],["msg","(c) Rozmowa i rozwój","pytania otwarte, plan z terminami"],["shield","Zgodność","arkusze B i C, § 11, terminy, dziennik"]].map(f=>`<div class="feat">${I(f[0])}<b>${f[1]}</b><span>${f[2]}</span></div>`).join("")}</div>
  <p class="note">Sterowanie: <span class="kbd">→</span> dalej, <span class="kbd">←</span> wstecz. Model kompetencji: 14 kompetencji, 49 wskaźników. Rozporządzenie z 4.04.2016.</p></div>`;
  ov.classList.add("on"); $("#goAuto").onclick = () => { setMode(true); go(0); }; $("#goMan").onclick = () => { setMode(false); go(0); };
}
async function outro() {
  const run = ++RUN; blk.classList.remove("on"); spot.classList.remove("on"); tip.classList.remove("on"); cur.classList.remove("on"); $("#progBar").style.width = "100%";
  const it = (t, s) => `<div class="mi">${t}<small>${s}</small><span class="ok">${I("check")}</span></div>`;
  ov.innerHTML = `<div class="hero"><span class="kick">${I("check")}Cały proces przełożonego w 2 minuty</span><h1>Wszystko ze <em>schematu zadania</em></h1>
  <div class="map"><div class="map-col"><h3>${I("star")}Pierwsza ocena</h3>${it("Rozpocznij ocenę","arkusz pierwszej oceny")}${it("Zakończ z modelem kompetencji","ten sam kreator")}${it("Asystent formalny","terminy, braki")}${it("Asystent rozmowy","pytania i plan rozwoju")}</div>
  <div class="map-col per"><h3>${I("chart")}Ocena okresowa</h3>${it("1. Analiza opisu stanowiska","kryteria z cytatem")}<div class="mi-row">${it("Formularz B","osoby kierujące")}${it("Formularz C","pozostałe stanowiska")}</div>${it("Zakończ z modelem kompetencji","wynik wg § 11")}${it("Asystent formalny i asystent rozmowy","feedback, mentoring, coaching")}</div></div>
  <div class="princ"><div><b>${I("user")}Człowiek decyduje</b>AI tylko proponuje</div><div><b>${I("lock")}Prywatność</b>bez nazwisk w AI, zbiorczo od 5 osób</div><div><b>${I("shield")}Ślad audytowy</b>dziennik i SHA-256</div><div><b>${I("eye")}Dostępność</b>cel: WCAG 2.1 AA</div></div>
  <div class="hero-cta" style="margin-top:26px"><button class="btn" id="again">${I("back")}Obejrzyj ponownie</button><a class="btn ghost" href="https://github.com/mateusz-dylewski/kompas-kompetencji" target="_blank" rel="noopener">${I("file")}Kod na GitHub</a></div></div>`;
  ov.classList.add("on"); $("#again").onclick = intro;
  for (const m of ov.querySelectorAll(".mi")) { await sleep(260); if (run !== RUN) return; m.classList.add("on"); }
}
setMode(true); intro();
})();
