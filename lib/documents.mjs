// Generator dokumentów: arkusze oceny (pierwsza ocena, B, C) jako PDF i XML.
// Układ wg rozporządzenia Prezesa Rady Ministrów z 4.04.2016 (Dz. U. poz. 470) i wzoru arkusza pierwszej oceny.
// Uwaga: to wersja robocza do weryfikacji; nie zastępuje oficjalnego formularza urzędu.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FONT_REG = path.join(ROOT, 'node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf');
const FONT_BOLD = path.join(ROOT, 'node_modules/dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf');

// § 11 ust. 1 pkt 2 rozporządzenia: przedziały średniej arytmetycznej ocen cząstkowych (górna granica włącznie)
export const LEVEL_BANDS = [
  [2, 'znacznie poniżej oczekiwań'], [4, 'poniżej oczekiwań'], [6, 'na poziomie oczekiwań'],
  [8, 'powyżej oczekiwań'], [9, 'znacznie powyżej oczekiwań'],
];
export const LEVEL_NEG = new Set([LEVEL_BANDS[0][1], LEVEL_BANDS[1][1]]);
// Ocena okresowa (Arkusz B i C): skala ocen cząstkowych 1/3/5/7/9 (rozporządzenie z 4.04.2016, Dz. U. poz. 470)
export const PTS5 = [1, 3, 5, 7, 9];
// Pierwsza ocena: skala 3/5/7 – DO WERYFIKACJI z przepisami z 2015 r. (rozporządzenie w sprawie pierwszej oceny)
export const PTS3 = [3, 5, 7];
// Wersja kształtu danych oceny: 2 = oceny cząstkowe B/C przyznaje oceniający (data.partials), wynik wyliczany
export const EVAL_SCHEMA = 2;

export function levelFor(avg) {
  if (avg === null || avg === undefined || Number.isNaN(avg)) return '—';
  if (avg <= 2) return LEVEL_BANDS[0][1];
  return (LEVEL_BANDS.find(([max]) => avg <= max) || LEVEL_BANDS[4])[1];
}
const round1 = x => Math.round(x * 10) / 10;
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// Punkty wskaźnika: pierwsza ocena lvl 1–3 → 3/5/7; okresowa lvl 0–4 → 1/3/5/7/9; 'none' = brak podstaw
export const ptsFor = (typ, lvl) => (lvl === 'none' || lvl === undefined || lvl === null ? null
  : typ === 'pierwsza' ? (PTS3[lvl - 1] ?? null) : (PTS5[lvl] ?? null));
// Ocena dane w nowym kształcie (oceny cząstkowe wpisuje oceniający)?
export const isSchema2 = (typ, data) => typ !== 'pierwsza' && Number(data?.schema) >= EVAL_SCHEMA;

// Wynik oceny okresowej (B/C) wyliczany z ocen cząstkowych – nie wpisywany ręcznie.
// § 11 ust. 4: ocena negatywna, gdy ogólny poziom jest „poniżej” lub „znacznie poniżej oczekiwań”,
// a także gdy którakolwiek ocena cząstkowa jest „znacznie poniżej oczekiwań”.
export function periodicVerdict(partials, avg) {
  if (!partials.length || avg === null) return { wynik: null, reasons: [] };
  const reasons = [];
  const level = levelFor(avg);
  if (LEVEL_NEG.has(level)) reasons.push(`ogólny poziom spełnienia kryteriów: ${level} (§ 11 ust. 4)`);
  const low = partials.filter(p => levelFor(p) === LEVEL_BANDS[0][1]).length;
  if (low) reasons.push(`ocena cząstkowa „znacznie poniżej oczekiwań” w ${low} ${low === 1 ? 'kryterium' : 'kryteriach'} (§ 11 ust. 4)`);
  return { wynik: reasons.length ? 'negatywna' : 'pozytywna', reasons };
}

// Wyliczenia z danych oceny (ta sama logika co w UI)
export function computeResults(ev, model) {
  const data = ev.data || {};
  const s2 = isSchema2(ev.typ, data);
  const crit = (data.criteria || []).map(k => {
    const comp = model.find(c => c.k === k);
    const rows = comp.w.map((w, wi) => {
      const r = data.ratings?.[`${k}|${wi}`];
      const pts = r ? ptsFor(ev.typ, r.lvl) : null;
      return { text: w.w, pts, none: r?.lvl === 'none', ex: r?.ex || '', unrated: !r };
    });
    const indicatorAvg = mean(rows.filter(r => r.pts !== null).map(r => r.pts));
    let partial, source;
    if (s2) { // ocena cząstkowa przyznana przez oceniającego
      const p = Number(data.partials?.[k]?.pts);
      partial = PTS5.includes(p) ? p : null; source = partial === null ? null : 'oceniajacy';
    } else { // pierwsza ocena lub dane sprzed migracji: średnia wskaźników
      partial = indicatorAvg === null ? null : round1(indicatorAvg); source = partial === null ? null : 'wyliczona';
    }
    return { key: k, name: comp.n || k, rows, partial, source, indicatorAvg: indicatorAvg === null ? null : round1(indicatorAvg) };
  });
  const parts = crit.map(c => c.partial).filter(v => v !== null);
  const avg = mean(parts);
  const complete = crit.length > 0 && parts.length === crit.length;
  let wynik = null, reasons = [], wynikSource = null;
  if (ev.typ === 'pierwsza') { // pierwsza ocena: wynik wskazuje oceniający (zasady z 2015 r. do weryfikacji)
    wynik = data.wynik || null; wynikSource = wynik ? 'oceniajacy' : null;
  } else if (!s2 && data.wynik) { // ocena sprzed migracji: zachowujemy wynik zapisany przez oceniającego
    wynik = data.wynik; wynikSource = 'reczny_sprzed_migracji';
  } else if (complete) {
    ({ wynik, reasons } = periodicVerdict(parts, avg)); wynikSource = 'wyliczony';
  }
  return { crit, avg: avg === null ? null : round1(avg), avgExact: avg, level: levelFor(avg), complete, wynik, wynikReasons: reasons, wynikSource };
}

// ---------- Arkusze: teksty i kolejność ----------
const TITLES = {
  B: { t: 'ARKUSZ B', sub: 'OCENA OKRESOWA URZĘDNIKA SŁUŻBY CYWILNEJ LUB PRACOWNIKA SŁUŻBY CYWILNEJ', zal: 'Załącznik nr 3' },
  C: { t: 'ARKUSZ C', sub: 'OCENA OKRESOWA URZĘDNIKA SŁUŻBY CYWILNEJ LUB PRACOWNIKA SŁUŻBY CYWILNEJ', zal: 'Załącznik nr 4' },
  pierwsza: { t: 'ARKUSZ PIERWSZEJ OCENY', sub: 'PIERWSZA OCENA W SŁUŻBIE CYWILNEJ', zal: 'Załącznik nr 2 (wzór pakietu wyzwania)' },
};
const POUCZENIE = 'Na podstawie art. 83 ust. 1 ustawy z dnia 21 listopada 2008 r. o służbie cywilnej od oceny okresowej służy, w terminie 7 dni od dnia zapoznania się z oceną, sprzeciw do dyrektora generalnego urzędu.';
const FOOTER = 'Kompas Kompetencji';

// ---------- PDF: prosty silnik układu ----------
const A4 = [595.28, 841.89], M = 42, W = A4[0] - 2 * M;
const INK = rgb(0.09, 0.13, 0.2), MU = rgb(0.35, 0.4, 0.47), NAVY = rgb(0.11, 0.25, 0.45), SKY = rgb(0.91, 0.94, 0.99), LN = rgb(0.8, 0.84, 0.9);

function wrap(text, font, size, maxW) {
  const out = [];
  for (const para of String(text ?? '').split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const test = line ? line + ' ' + word : word;
      if (font.widthOfTextAtSize(test, size) <= maxW) line = test;
      else { if (line) out.push(line); line = word; while (font.widthOfTextAtSize(line, size) > maxW && line.length > 1) { let cut = line.length - 1; while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > maxW) cut--; out.push(line.slice(0, cut)); line = line.slice(cut); } }
    }
    out.push(line);
  }
  return out;
}

class Sheet {
  constructor(pdf, reg, bold) { this.pdf = pdf; this.reg = reg; this.bold = bold; this.pages = []; this.newPage(); }
  newPage() { this.pg = this.pdf.addPage(A4); this.pages.push(this.pg); this.y = A4[1] - M; }
  ensure(h) { if (this.y - h < 60) this.newPage(); }
  gap(h) { this.y -= h; }
  text(str, { size = 10, font = this.reg, color = INK, x = M, maxW = W, lh = 1.35 } = {}) {
    for (const line of wrap(str, font, size, maxW)) {
      this.ensure(size * lh);
      this.pg.drawText(line, { x, y: this.y - size, size, font, color });
      this.y -= size * lh;
    }
  }
  heading(str) {
    this.ensure(34); this.gap(6);
    this.pg.drawRectangle({ x: M, y: this.y - 22, width: W, height: 20, color: SKY });
    this.pg.drawText(str.toUpperCase(), { x: M + 8, y: this.y - 16, size: 9.5, font: this.bold, color: NAVY });
    this.y -= 30;
  }
  field(label, value) {
    this.text(label, { size: 7.5, color: MU, font: this.reg });
    this.text(value || '—', { size: 10, lh: 1.3 });
    this.gap(4);
  }
  // Tabela: headers + wiersze (tablice tekstów); widths w pkt, sumują się do W
  table(headers, rows, widths) {
    const pad = 4, size = 8.5, lh = 1.25;
    const drawRow = (cells, font, color, fill) => {
      const lines = cells.map((c, i) => wrap(c, font, size, widths[i] - 2 * pad));
      const h = Math.max(...lines.map(l => l.length)) * size * lh + 2 * pad;
      this.ensure(h);
      let x = M;
      cells.forEach((_, i) => {
        if (fill) this.pg.drawRectangle({ x, y: this.y - h, width: widths[i], height: h, color: fill });
        this.pg.drawRectangle({ x, y: this.y - h, width: widths[i], height: h, borderColor: LN, borderWidth: 0.6 });
        lines[i].forEach((ln, j) => this.pg.drawText(ln, { x: x + pad, y: this.y - pad - size - j * size * lh, size, font, color }));
        x += widths[i];
      });
      this.y -= h;
    };
    drawRow(headers, this.bold, NAVY, SKY);
    rows.forEach(r => drawRow(r, this.reg, INK));
    this.gap(6);
  }
  finish(footer) {
    const n = this.pages.length;
    this.pages.forEach((p, i) => {
      p.drawText(footer, { x: M, y: 24, size: 7.5, font: this.reg, color: MU });
      p.drawText(`${i + 1} / ${n}`, { x: A4[0] - M - 40, y: 24, size: 7.5, font: this.reg, color: MU });
    });
  }
}

export async function buildPdf(kind, ctx) {
  const { ev, emp, mgr, model, mandB, mandC, unit, res, statusLabel } = ctx;
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(`${TITLES[kind].t} – ${emp.name}`);
  pdf.setProducer('Kompas Kompetencji');
  const reg = await pdf.embedFont(fs.readFileSync(FONT_REG), { subset: true });
  const bold = await pdf.embedFont(fs.readFileSync(FONT_BOLD), { subset: true });
  const s = new Sheet(pdf, reg, bold);
  const data = ev.data || {};
  const t = TITLES[kind];
  const dateOr = (v) => v || '—';
  const mandList = kind === 'C' ? mandC : mandB;
  const isMand = k => kind !== 'pierwsza' && mandList.some(m => k.startsWith(m));

  s.text(`${t.zal} · Wzór ${t.t}`, { size: 8, color: MU });
  s.text(t.t, { size: 16, font: bold, color: NAVY, lh: 1.2 });
  s.text(t.sub, { size: 10, font: bold });
  s.text(`Status dokumentu: ${statusLabel}`, { size: 8.5, color: MU });
  s.gap(6);

  s.heading('Część I – dane');
  s.field('Nazwa urzędu', unit);
  s.field('Dane ocenianego', `${emp.name}${emp.position ? ' · ' + emp.position : ''}`);
  s.field('Dane oceniającego', `${mgr.name}${mgr.position ? ' · ' + mgr.position : ''}`);
  if (kind !== 'pierwsza') {
    s.heading('Kryteria oceny i termin sporządzenia');
    const extra = (data.criteria || []).filter(k => !isMand(k));
    const mand = (data.criteria || []).filter(k => isMand(k));
    s.field('Kryteria obowiązkowe', mand.map(k => model.find(c => c.k === k)?.n || k).join('; ') || '—');
    s.field(`Kryteria dodatkowe wybrane przez oceniającego (nie więcej niż 3)`, extra.map(k => model.find(c => c.k === k)?.n || k).join('; ') || '—');
    s.field('Termin sporządzenia oceny', dateOr(data.terminOceny || ev.updated?.slice(0, 10)));
  } else {
    s.heading('Okres i kompetencje');
    s.field('Okres oceny', `${dateOr(ev.period_from)} – ${dateOr(ev.period_to)}`);
    s.field('Kompetencje oceniane', (data.criteria || []).map(k => model.find(c => c.k === k)?.n || k).join('; ') || '—');
  }
  s.text('Potwierdzamy: przeprowadzenie rozmowy oceniającej i omówienie wszystkich wymaganych zagadnień oraz zapoznanie ocenianego z kryteriami oceny i terminem sporządzenia oceny.', { size: 8.5, color: MU });

  s.heading('Część II – ocena');
  s.field('Data przeprowadzenia rozmowy oceniającej', dateOr(data.rozmowa));
  s.field('Okres, w którym oceniany podlegał ocenie', `od ${dateOr(ev.period_from)} do ${dateOr(ev.period_to)}`);

  if (kind === 'pierwsza') {
    s.text('Ocena cząstkowa (zaznaczony poziom wskaźnika):', { size: 9, font: bold });
    const rows = res.crit.map(c => [c.name, ...[1, 2, 3].map(l => {
      const hit = c.rows.filter(r => r.pts !== null && [3, 5, 7][l - 1] === r.pts).length;
      return hit ? `X (${hit})` : '';
    }), c.partial === null ? '—' : String(c.partial)]);
    s.table(['Kompetencja', 'Poniżej oczekiwań (3 pkt)', 'Na poziomie (5 pkt)', 'Powyżej (7 pkt)', 'Średnia'], rows, [W * 0.4, W * 0.15, W * 0.15, W * 0.15, W * 0.15]);
  } else {
    s.text('Kryteria obowiązkowe i dodatkowe – ocena cząstkowa (średnia wskaźników):', { size: 9, font: bold });
    const rows = res.crit.map(c => [c.name + (isMand(c.key) ? ' (obowiązkowe)' : ' (dodatkowe)'), c.partial === null ? '—' : String(c.partial), `${c.rows.filter(r => r.pts !== null).length} / ${c.rows.length}`]);
    s.table(['Kryterium', 'Ocena cząstkowa (pkt)', 'Wskaźniki ocenione'], rows, [W * 0.6, W * 0.2, W * 0.2]);
    s.field('Średnia arytmetyczna z ocen cząstkowych', res.avg === null ? '—' : `${res.avg} pkt`);
    s.text('Przyznanie oceny:', { size: 9, font: bold });
    const lv = LEVEL_BANDS.map(([, l], i) => `${['od 1 do 2 pkt', 'powyżej 2 do 4 pkt', 'powyżej 4 do 6 pkt', 'powyżej 6 do 8 pkt', 'powyżej 8 do 9 pkt'][i]}: ${l}${res.level === l ? '  [X]' : ''}`);
    lv.forEach(l => s.text(l, { size: 9 }));
    s.field('Ogólny poziom spełnienia kryteriów', res.level);
    s.text(`Ocena okresowa w służbie cywilnej:  ${res.wynik === 'pozytywna' ? '[X] POZYTYWNA' : '[  ] POZYTYWNA'}     ${res.wynik === 'negatywna' ? '[X] NEGATYWNA' : '[  ] NEGATYWNA'}`, { size: 9.5, font: bold });
  }

  s.heading('Uzasadnienie przyznanej oceny okresowej');
  s.text(data.uzasadnienie || (kind !== 'pierwsza' ? 'Uzasadnienie obowiązkowe przy ocenie negatywnej; przy pozytywnej fakultatywne.' : '—'), { size: 9.5 });
  if (kind !== 'pierwsza') {
    s.text('Przykłady do poszczególnych wskaźników:', { size: 8.5, font: bold, color: MU });
    res.crit.forEach(c => c.rows.filter(r => r.ex).forEach(r => s.text(`• ${c.name} – ${r.text}: ${r.ex}`, { size: 8.5 })));
  }

  s.heading('Wnioski dotyczące indywidualnego programu rozwoju zawodowego');
  s.text(data.dev || '—', { size: 9.5 });

  if (kind !== 'pierwsza') {
    s.heading('Dane dotyczące poprzedniej oceny okresowej');
    s.text('Brak danych w systemie – uzupełnij ręcznie, jeśli dotyczy.', { size: 9 });
    s.heading('Wniosek o przyznanie kolejnego stopnia służbowego');
    s.text(kind === 'C' ? 'NIE DOTYCZY (oceniany jest pracownikiem służby cywilnej).' : 'Nie dotyczy tej wersji dokumentu (część III wypełnia się tylko przy wniosku o stopień).', { size: 9 });
  }

  s.heading('Dane oceniającego i podpisy');
  s.text(`${mgr.name} · ${mgr.position || ''} · ${unit}`, { size: 9.5 });
  s.text('………………………………     ………………………………', { size: 10 });
  s.text('miejscowość, data                    podpis oceniającego', { size: 7.5, color: MU });
  s.gap(6);
  s.text('Przeprowadzono ze mną rozmowę oceniającą oraz zapoznałem(-łam) się z oceną okresową i wnioskami dotyczącymi indywidualnego programu rozwoju zawodowego.', { size: 8.5 });
  s.text('………………………………     ………………………………', { size: 10 });
  s.text('data, podpis ocenianego', { size: 7.5, color: MU });
  if (kind !== 'pierwsza') { s.gap(6); s.text('Pouczenie: ' + POUCZENIE, { size: 8, color: MU }); }

  s.finish(FOOTER);
  return Buffer.from(await pdf.save());
}

// ---------- XML ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
export function buildXml(kind, ctx) {
  const { ev, emp, mgr, model, mandB, mandC, unit, res } = ctx;
  const data = ev.data || {};
  const mandList = kind === 'C' ? mandC : mandB;
  const isMand = k => kind !== 'pierwsza' && mandList.some(m => k.startsWith(m));
  const el = (n, v, attrs = '') => `<${n}${attrs}>${esc(v)}</${n}>`;
  const crit = res.crit.map(c => `    <Kryterium id="${esc(c.key)}" typ="${isMand(c.key) ? 'obowiazkowe' : 'dodatkowe'}">
      ${el('Nazwa', c.name)}
      ${el('OcenaCzastkowa', c.partial ?? '')}
${c.rows.map((r, i) => `      <Wskaznik nr="${i + 1}">${el('Opis', r.text)}${r.none ? '<Poziom>brak_podstaw</Poziom>' : r.pts === null ? '' : `<Punkty>${r.pts}</Punkty>`}${el('Przyklad', r.ex)}</Wskaznik>`).join('\n')}
    </Kryterium>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<ArkuszOceny xmlns="urn:kompas-kompetencji:arkusz:v1" typ="${esc(kind)}" wersja="1" wygenerowano="${new Date().toISOString()}">
  <CzescI>
    ${el('NazwaUrzedu', unit)}
    <DaneOcenianego>${el('Imie', emp.name.split(' ')[0])}${el('Nazwisko', emp.name.split(' ').slice(1).join(' '))}${el('StanowiskoPracy', emp.position)}</DaneOcenianego>
    <DaneOceniajacego>${el('Imie', mgr.name.split(' ')[0])}${el('Nazwisko', mgr.name.split(' ').slice(1).join(' '))}${el('StanowiskoPracy', mgr.position)}</DaneOceniajacego>
    ${el('TerminSporzadzeniaOceny', data.terminOceny || '')}
  </CzescI>
  <CzescII>
    ${el('DataRozmowyOceniajacej', data.rozmowa || '')}
    <OkresOceny od="${esc(ev.period_from)}" do="${esc(ev.period_to)}"/>
    <Kryteria>
${crit}
    </Kryteria>
    ${el('SredniaArytmetyczna', res.avg ?? '')}
    ${el('OgolnyPoziom', res.level)}
    ${el('OcenaOkresowa', res.wynik || '')}
    ${el('Uzasadnienie', data.uzasadnienie || '')}
    ${el('WnioskiRozwojowe', data.dev || '')}
    <Zapoznanie data="${esc(ctx.ack?.ackAt || '')}" terminSprzeciwu="${esc(ctx.ack?.deadline || '')}">${el('Sprzeciw', ctx.ack?.objectionText || '')}</Zapoznanie>
  </CzescII>
  <Podpisy>
${(ctx.signatures || []).map(g => `    <Podpis rola="${esc(g.role)}" czas="${esc(g.signed_at)}" sha256="${esc(g.doc_sha256)}" weryfikacja="${g.valid ? 'ok' : 'blad'}">${el('Imie', g.name)}</Podpis>`).join('\n')}
  </Podpisy>
</ArkuszOceny>
`;
}

// ---------- Szkic oceny z dowodów i check-inów (bez poziomów, ocen cząstkowych i wyniku) ----------
// Materiał roboczy dla oceniającego: oceniający uzupełnia ocenę w kreatorze i ją zatwierdza (składa).
const DRAFT_NOTE = 'SZKIC – materiał z dowodów i rozmów miesięcznych. Nie zawiera ocen ani wyniku: uzupełnia je i zatwierdza oceniający.';
const draftGroups = ctx => (ctx.ev.data?.criteria || []).map(k => {
  const comp = ctx.model.find(c => c.k === k);
  return { key: k, name: comp?.n || k, indicators: (comp?.w || []).map((w, wi) => ({ nr: wi + 1, text: w.w.replace(/\n/g, ' '),
    evidence: ctx.evidence.filter(e => e.indicator === `${k}|${wi}`), feedback: ctx.feedback.filter(f => f.indicator === `${k}|${wi}`) })) };
});
export async function buildDraftPdf(ctx) {
  const { ev, emp, mgr, unit } = ctx;
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(`Szkic oceny – ${emp.name}`);
  pdf.setProducer('Kompas Kompetencji');
  const reg = await pdf.embedFont(fs.readFileSync(FONT_REG), { subset: true });
  const bold = await pdf.embedFont(fs.readFileSync(FONT_BOLD), { subset: true });
  const s = new Sheet(pdf, reg, bold);
  s.text(`${TITLES[ev.typ]?.t || 'OCENA'} · szkic roboczy`, { size: 8, color: MU });
  s.text('SZKIC OCENY Z DOWODÓW', { size: 16, font: bold, color: NAVY, lh: 1.2 });
  s.text(DRAFT_NOTE, { size: 9, color: MU });
  s.gap(6);
  s.heading('Dane');
  s.field('Nazwa urzędu', unit);
  s.field('Oceniany', `${emp.name}${emp.position ? ' · ' + emp.position : ''}`);
  s.field('Oceniający', `${mgr.name}${mgr.position ? ' · ' + mgr.position : ''}`);
  s.field('Okres oceny', `${ev.period_from || '—'} – ${ev.period_to || '—'}`);
  for (const g of draftGroups(ctx)) {
    s.heading(g.name);
    s.text('Ocena cząstkowa: ……… (uzupełnia oceniający, skala 1/3/5/7/9)', { size: 9, font: bold });
    for (const i of g.indicators) {
      s.gap(2);
      s.text(`${i.nr}. ${i.text}`, { size: 9, font: bold });
      if (!i.evidence.length && !i.feedback.length) s.text('Brak dowodów w okresie – rozważ adnotację „brak podstaw do oceny”.', { size: 8.5, color: MU });
      i.evidence.forEach(e => s.text(`• ${e.date} – sytuacja: ${e.situation}; działanie: ${e.action}; rezultat: ${e.result}${e.taskRef ? ` [${e.taskRef}]` : ''}`, { size: 8.5 }));
      i.feedback.forEach(f => s.text(`• feedback ${f.date} (${f.relationLabel}) – ${f.source}: ${f.justification}`, { size: 8.5, color: MU }));
    }
  }
  s.heading('Rozmowy miesięczne w okresie');
  if (!ctx.checkins.length) s.text('Brak check-inów w okresie.', { size: 9 });
  ctx.checkins.forEach(c => s.text(`• ${c.month} (${c.status}${c.date ? ', ' + c.date : ''}): zrobiono – ${c.done || '—'}; uwaga – ${c.attention || '—'}; cel – ${c.goal || '—'}`, { size: 8.5 }));
  s.heading('Do uzupełnienia przez oceniającego');
  s.text('Oceny cząstkowe, uzasadnienie oceny i wnioski rozwojowe. Wynik oceny okresowej wylicza się z ocen cząstkowych (§ 11 rozporządzenia).', { size: 9 });
  s.finish('Kompas Kompetencji – szkic');
  return Buffer.from(await pdf.save());
}
export function buildDraftXml(ctx) {
  const { ev, emp, mgr, unit } = ctx;
  const el = (n, v) => `<${n}>${esc(v)}</${n}>`;
  const groups = draftGroups(ctx).map(g => `    <Kryterium id="${esc(g.key)}">
      ${el('Nazwa', g.name)}
      <OcenaCzastkowa uzupelnia="oceniajacy"/>
${g.indicators.map(i => `      <Wskaznik nr="${i.nr}">${el('Opis', i.text)}
${i.evidence.map(e => `        <Dowod id="${e.id}" data="${esc(e.date)}">${el('Sytuacja', e.situation)}${el('Dzialanie', e.action)}${el('Rezultat', e.result)}${el('Zadanie', e.taskRef || '')}${el('Link', e.link || '')}</Dowod>`).join('\n')}
${i.feedback.map(f => `        <Feedback id="${f.id}" data="${esc(f.date)}" relacja="${esc(f.relation)}">${el('Zrodlo', f.source)}${el('Uzasadnienie', f.justification)}</Feedback>`).join('\n')}
      </Wskaznik>`).join('\n')}
    </Kryterium>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<SzkicOceny xmlns="urn:kompas-kompetencji:szkic:v1" typ="${esc(ev.typ)}" ocena="${esc(ev.id)}" wygenerowano="${new Date().toISOString()}">
  ${el('Uwaga', DRAFT_NOTE)}
  ${el('NazwaUrzedu', unit)}
  ${el('Oceniany', emp.name)}
  ${el('Oceniajacy', mgr.name)}
  <OkresOceny od="${esc(ev.period_from)}" do="${esc(ev.period_to)}"/>
  <Kryteria>
${groups}
  </Kryteria>
  <RozmowyMiesieczne>
${ctx.checkins.map(c => `    <Checkin miesiac="${esc(c.month)}" status="${esc(c.status)}" data="${esc(c.date || '')}">${el('CoZrobiono', c.done)}${el('CoWymagaUwagi', c.attention)}${el('Cel', c.goal)}</Checkin>`).join('\n')}
  </RozmowyMiesieczne>
</SzkicOceny>
`;
}
