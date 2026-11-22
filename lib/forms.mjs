// PDF wypełnionego arkusza na podstawie struktury oficjalnych wzorów (docx z pakietu wyzwania).
// Struktura (kolejność bloków, tabele, etykiety, wiersze kryteriów) pochodzi z lib/templates/*.json,
// wyekstrahowanych z: Arkusz oceny B/C (2).docx oraz Arkusz pierwszej oceny (2).docx.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { levelFor, computeResults } from './documents.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const FONT_REG = path.join(ROOT, 'node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf');
const FONT_BOLD = path.join(ROOT, 'node_modules/dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf');
const tpl = k => JSON.parse(fs.readFileSync(path.join(HERE, 'templates', `${k}.json`), 'utf8'));

const A4 = [595.28, 841.89], M = 40, W = A4[0] - 2 * M;
const INK = rgb(0.1, 0.1, 0.1), MU = rgb(0.4, 0.4, 0.4), LN = rgb(0.25, 0.25, 0.25), HEAD = rgb(0.92, 0.92, 0.92);
const TITLE = { B: 'Załącznik nr 3 · WZÓR · ARKUSZ B', C: 'Załącznik nr 4 · WZÓR · ARKUSZ C', pierwsza: 'Załącznik nr 2 · WZÓR · ARKUSZ PIERWSZEJ OCENY' };
const FOOT = 'Wygenerowano w systemie Kompas Kompetencji';

// Czyszczenie znaczników przypisów z wzoru (przy wyciąganiu z .docx indeks górny „1)” stał się zwykłym tekstem):
// usuwamy każdy „)” bez pary „(” razem z numerem przypisu tuż przed nim – „OCENA CZĄSTKOWA8)” → „OCENA CZĄSTKOWA”,
// „(nie więcej niż 3))” → „(nie więcej niż 3)”, „OD):” → „OD:”. Nawiasy z parą, np. „(dd.mm.rrrr)”, zostają.
const clean = s => {
  const t = String(s ?? '').trim();
  let out = '', depth = 0;
  for (const ch of t) {
    if (ch === '(') { depth++; out += ch; continue; }
    if (ch === ')') {
      if (depth > 0) { depth--; out += ch; continue; }
      out = out.replace(/(?<=[\p{L}.”"])\d{1,2}$/u, '');
      continue;
    }
    out += ch;
  }
  return out.replace(/\s+([:.,])/g, '$1').replace(/\s+/g, ' ').trim();
};
// Daty we wzorze: dd.mm.rrrr
const plDate = v => (/^\d{4}-\d{2}-\d{2}/.test(String(v || '')) ? String(v).slice(0, 10).split('-').reverse().join('.') : String(v || ''));
const isHeading = t => /^CZĘŚĆ|^DANE |^KRYTERIA OCENY|^PRZYZNANIE|^UZASADNIENIE|^WNIOSKI|^DATA PRZEPROWADZENIA|^ROZMOWA|^OCENA POSTAWY|^PIERWSZA OCENA|^POUCZENIE|^CZY DO OCENY|^DANE DOTYCZĄCE|^ELEMENTY|^OCENA ŁĄCZNA|^OCENIANY ZALICZYŁ|^SPRAWOZDANIE|^POTWIERDZENIE|^OKRES|^Potwierdzamy|^Przeprowadzono|^Zapoznałam|^ARKUSZ|^OCENA OKRESOWA W SŁUŻBIE|^OCENA OKRESOWA$|^URZĘDNIKA|^OCENA OKRESOWA URZĘDNIKA|^WNIOSEK/.test(t) && t === t.toUpperCase();

function wrap(text, font, size, maxW) {
  const out = [];
  for (const para of String(text ?? '').split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const test = line ? line + ' ' + word : word;
      if (font.widthOfTextAtSize(test, size) <= maxW) line = test;
      else { if (line) out.push(line); line = word; }
    }
    out.push(line);
  }
  return out;
}

class Sheet {
  constructor(pdf, reg, bold) { this.pdf = pdf; this.reg = reg; this.bold = bold; this.pages = []; this.newPage(); }
  newPage() { this.pg = this.pdf.addPage(A4); this.pages.push(this.pg); this.y = A4[1] - M; }
  ensure(h) { if (this.y - h < 50) this.newPage(); }
  para(str, { size = 9, bold = false, color = INK, indent = 0, align = 'left' } = {}) {
    const font = bold ? this.bold : this.reg;
    for (const line of wrap(str, font, size, W - indent)) {
      this.ensure(size * 1.35);
      const lw = font.widthOfTextAtSize(line, size);
      const x = align === 'right' ? M + W - lw : align === 'center' ? M + (W - lw) / 2 : M + indent;
      this.pg.drawText(line, { x, y: this.y - size, size, font, color });
      this.y -= size * 1.35;
    }
  }
  heading(str) {
    const lines = wrap(str, this.bold, 8.5, W - 12);
    const h = lines.length * 11 + 8;
    this.ensure(h + 8); this.y -= 6;
    this.pg.drawRectangle({ x: M, y: this.y - h, width: W, height: h, color: HEAD, borderColor: LN, borderWidth: 0.5 });
    lines.forEach((ln, i) => this.pg.drawText(ln, { x: M + 6, y: this.y - 11 - i * 11, size: 8.5, font: this.bold, color: INK }));
    this.y -= h + 6;
  }
  // Tabela w układzie wzoru: każda komórka z obramowaniem; widths w proporcjach (tablica albo funkcja liczby komórek w wierszu).
  // Komórki scalone w pionie we wzorze (.docx) wyciągnięte jako powtórzony tekst – np. „KRYTERIA OBOWIĄZKOWE” w trzech
  // wierszach – rysujemy jako jedną komórkę na wysokość wszystkich tych wierszy.
  table(rows, widths, { header = false } = {}) {
    const size = 8, pad = 3, lh = 1.25;
    const wOf = n => (typeof widths === 'function' ? widths(n) : widths).map(w => w * W);
    const fullN = typeof widths === 'function' ? 0 : widths.length;
    // Geometria wierszy: x i szerokość każdej komórki (ostatnia komórka krótszego wiersza zajmuje resztę)
    const geo = rows.map(cells => {
      const tw = wOf(fullN || cells.length);
      let x = M;
      return cells.map((c, i) => { const w = cells.length < tw.length && i === cells.length - 1 ? tw.slice(i).reduce((a, b) => a + b, 0) : tw[i]; const g = { x, w }; x += w; return g; });
    });
    const fontFor = (ri, i, c, cells) => ((header && ri === 0) || (i === 0 && cells.length > 1 && isHeadingCell(c)) ? this.bold : this.reg);
    // Pola do wypełnienia (kropki, „X”, wszystko z „dd.mm”/„rrrr”) nie scalają się same – tylko razem z etykietą obok
    const mergeable = c => c.length > 1 && !/^[.…]+$/.test(c) && c !== 'X' && !/dd\.mm|rrrr/.test(c);
    // cont[ri][i] = true: komórka jest kontynuacją komórki z wiersza powyżej (ta sama pozycja i treść)
    // Pole „(dd.mm.rrrr)” scalamy tylko razem z etykietą po jego lewej (np. „Termin sporządzenia oceny”)
    const same = (ri, i, c) => rows[ri - 1].some((p, k) => p === c && Math.abs(geo[ri - 1][k].x - geo[ri][i].x) < 0.5 && Math.abs(geo[ri - 1][k].w - geo[ri][i].w) < 0.5);
    const cont = [];
    rows.forEach((cells, ri) => { cont[ri] = []; cells.forEach((c, i) => { cont[ri][i] = ri > 0 && (mergeable(c) || (i > 0 && cont[ri][i - 1] && c !== '')) && same(ri, i, c); }); });
    const heights = rows.map((cells, ri) => {
      const lines = cells.map((c, i) => (cont[ri][i] ? [] : wrap(c, fontFor(ri, i, c, cells), size, geo[ri][i].w - 2 * pad)));
      return Math.max(18, Math.max(1, ...lines.map(l => l.length)) * size * lh + 2 * pad);
    });
    // Długość scalenia w dół od komórki (ri, i)
    const spanLen = (ri, i) => { let n = 1; while (ri + n < rows.length) { const k = rows[ri + n].findIndex((c, kk) => cont[ri + n][kk] && c === rows[ri][i] && Math.abs(geo[ri + n][kk].x - geo[ri][i].x) < 0.5); if (k < 0) break; n++; } return n; };
    rows.forEach((cells, ri) => {
      const spans = cells.map((c, i) => (cont[ri][i] ? 0 : spanLen(ri, i)));
      const need = Math.max(...spans.map(n => heights.slice(ri, ri + Math.max(1, n)).reduce((a, b) => a + b, 0)));
      if (!cells.some((c, i) => cont[ri][i])) this.ensure(need);
      cells.forEach((c, i) => {
        if (cont[ri][i]) return;
        const { x, w } = geo[ri][i];
        const h = heights.slice(ri, ri + spans[i]).reduce((a, b) => a + b, 0);
        const isHead = header && ri === 0;
        const fill = isHead || isHeadingCell(c) ? HEAD : undefined;
        this.pg.drawRectangle({ x, y: this.y - h, width: w, height: h, borderColor: LN, borderWidth: 0.6, ...(fill ? { color: fill } : {}) });
        const font = fontFor(ri, i, c, cells);
        wrap(c, font, size, w - 2 * pad).forEach((ln, j) => {
          const mark = ln === 'X';
          const tx = mark ? x + (w - font.widthOfTextAtSize('X', 10)) / 2 : x + pad;
          this.pg.drawText(ln, { x: tx, y: this.y - pad - size - j * size * lh, size: mark ? 10 : size, font: mark ? this.bold : font, color: INK });
        });
      });
      this.y -= heights[ri];
    });
    this.y -= 6;
  }
  finish() {
    const n = this.pages.length;
    this.pages.forEach((p, i) => {
      p.drawText(FOOT, { x: M, y: 22, size: 7, font: this.reg, color: MU });
      p.drawText(`${i + 1}/${n}`, { x: A4[0] - M - 25, y: 22, size: 7, font: this.reg, color: MU });
    });
  }
}
const isHeadingCell = c => c.length > 2 && c === c.toUpperCase() && /[A-ZĄĆĘŁŃÓŚŹŻ]/.test(c) && !/^X/.test(c);

function colWidths(n, first) {
  if (n === 1) return [1];
  if (n === 2) return [0.36, 0.64];
  if (first) return [first, ...Array(n - 1).fill((1 - first) / (n - 1))];
  return Array(n).fill(1 / n);
}

// ---------- Wypełnianie wzoru ----------
export async function buildFormPdf(kind, ctx) {
  const { ev, emp, mgr, model, unit, res } = ctx;
  const data = ev.data || {};
  const blocks = tpl(kind === 'pierwsza' ? 'pierwsza' : kind);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(`${TITLE[kind]} – ${emp.name}`);
  pdf.setProducer('Kompas Kompetencji');
  const reg = await pdf.embedFont(fs.readFileSync(FONT_REG), { subset: true });
  const bold = await pdf.embedFont(fs.readFileSync(FONT_BOLD), { subset: true });
  const s = new Sheet(pdf, reg, bold);

  const split = n => { const p = String(n || '').trim().split(/\s+/); return { first: p[0] || '', last: p.slice(1).join(' ') }; };
  const E = { ...split(emp.name), dept: emp.unit || '', pos: emp.position || '' };
  const M_ = { ...split(mgr.name), dept: mgr.unit || '', pos: mgr.position || '' };
  const dash = v => (v && String(v).trim() ? String(v) : '');
  const selected = data.criteria || [];
  const mandList = kind === 'pierwsza' ? [] : kind === 'C' ? ['WYKORZYSTYWANIE WIEDZY', 'RZETELNOŚĆ', 'ORGANIZACJA PRACY', 'WSPÓŁPRACA', 'KOMUNIKACJA'] : ['ZARZĄDZANIE LUDŹMI', 'PODEJMOWANIE DECYZJI', 'ORGANIZACJA PRACY', 'WSPÓŁPRACA', 'KOMUNIKACJA'];
  const nameOfKey = k => model.find(c => c.k === k)?.n || k;
  const compByName = name => model.find(c => (c.n || c.k) === name || c.k === name || name.startsWith(c.k.slice(0, 18)) || (c.n || '').startsWith(name.slice(0, 18)));
  const extras = selected.filter(k => !mandList.some(m => k.startsWith(m)));
  const ratingFor = k => res.crit.find(c => c.key === k);
  const levelIndexBySpec = (avg, typ) => (typ === 'pierwsza'
    ? (avg === null ? -1 : [3, 5, 7].reduce((b, v, i) => (Math.abs(avg - v) < Math.abs(avg - [3, 5, 7][b]) ? i : b), 0))
    : (avg === null ? -1 : [1, 3, 5, 7, 9].reduce((b, v, i) => (Math.abs(avg - v) < Math.abs(avg - [1, 3, 5, 7, 9][b]) ? i : b), 0)));

  // Kolejność wierszy kryteriów i ocen
  let rateTableSeen = 0;
  let prevHeading = '';
  let skipPart3 = false;

  for (const b of blocks) {
    if (b.p !== undefined) {
      const t = clean(b.p);
      if (/^CZĘŚĆ III/.test(t)) skipPart3 = true;
      // Nagłówek wzoru jak w rozporządzeniu: załącznik i „WZÓR” do prawej, tytuł arkusza wyśrodkowany
      if (/^Załącznik/.test(t)) { s.para(t, { size: 8, align: 'right' }); continue; }
      if (/^WZÓR/.test(t)) { s.para(t, { size: 8, align: 'right' }); s.y -= 10; continue; }
      if (/^ARKUSZ|^OCENA OKRESOWA$|^URZĘDNIKA|^PIERWSZA OCENA$/.test(t)) { s.para(t, { size: /^ARKUSZ/.test(t) ? 12 : 10, bold: true, align: 'center' }); if (/^URZĘDNIKA|^PRACOWNIKA/.test(t)) s.y -= 10; continue; }
      if (skipPart3) continue;
      if (/^Wniosek jest wypełniany/.test(t)) { skipPart3 = true; continue; }
      if (/^DANE OCENIANEGO|DANE BEZPOŚREDNIEGO|DANE KIERUJĄCEGO|DANE OCENIAJĄCEGO|CZĘŚĆ|ROZMOWA|PRZYZNANIE|UZASADNIENIE|WNIOSKI|DANE DOTYCZĄCE|CZY DO OCENY|PIERWSZA OCENA|OCENA POSTAWY|KRYTERIA OCENY|CZĘŚĆ OGÓLNA|ELEMENTY/.test(t) && t === t.toUpperCase()) {
        s.heading(t); prevHeading = t;
      } else s.para(t, { size: 8.5 });
      continue;
    }
    if (skipPart3) continue;
    // Tabele – kopia wzoru z wypełnieniem
    const rows = b.rows.map(r => r.map(c => clean(c)));
    const hdr = rows[0]?.[0] || '';
    const ctxIs = (x) => prevHeading.includes(x) || hdr.includes(x);
    const isEmpTable = ctxIs('OCENIANEGO');
    const isMgrTable = ctxIs('OCENIAJĄCEGO') || ctxIs('PRZEŁOŻONEGO') || ctxIs('KIERUJĄCEGO');
    const label = (r) => (r[0] || '').toLowerCase();

    // 1. Pola „Imię / Nazwisko / Komórka / Stanowisko” oraz nazwa urzędu
    if (rows.length && rows.every(r => r.length <= 3) && rows.some(r => /^(Imię|Nazwisko|Komórka|Stanowisko|NAZWA URZĘDU)/i.test(r[0] || ''))) {
      const src = isMgrTable && !isEmpTable ? M_ : E;
      rows.forEach(r => {
        const l = (r[0] || '').toLowerCase();
        if (l.startsWith('nazwa urzędu')) r[1] = unit;
        else if (l.startsWith('imię')) r[1] = src.first;
        else if (l.startsWith('nazwisko')) r[1] = src.last;
        else if (l.startsWith('komórka')) r[1] = src.dept;
        else if (l.startsWith('stanowisko')) r[1] = src.pos;
        else if (l.startsWith('data nawiązania')) r[1] = '';
      });
      // Wiersz daty rozmowy / okresu
      s.table(rows.map(r => r.map(c => c)), colWidths(Math.max(...rows.map(r => r.length)), 0), {});
      continue;
    }
    // 2. Termin sporządzenia oraz data rozmowy i okres
    if (rows.some(r => r.some(c => /DATA PRZEPROWADZENIA ROZMOWY|OKRES, W KTÓRYM|Data przeprowadzenia rozmowy|Termin wyznaczony/i.test(c)))) {
      const out = rows.map(r => r.map(c => {
        if (/DATA PRZEPROWADZENIA ROZMOWY|Data przeprowadzenia rozmowy/i.test(c)) return c;
        return c;
      }));
      out.forEach(r => {
        const lab = (r[0] || '').toLowerCase();
        if (lab.startsWith('okres')) {
          r.forEach((c, ci) => {
            const prev = (r[ci - 1] || '').toUpperCase();
            if (c === '(dd.mm.rrrr)' && prev.startsWith('OD')) r[ci] = plDate(ev.period_from) || c;
            if (c === '(dd.mm.rrrr)' && prev.startsWith('DO')) r[ci] = plDate(ev.period_to) || c;
          });
        } else {
          r.forEach((c, ci) => {
            if (c !== '(dd.mm.rrrr)') return;
            if (lab.includes('rozmow')) r[ci] = plDate(data.rozmowa) || c;
            else if (lab.includes('termin')) r[ci] = plDate(data.terminOceny) || c;
          });
        }
      });
      s.table(out, colWidths(Math.max(...out.map(r => r.length)), 0.4));
      continue;
    }
    // 3. Lista kryteriów (B/C: obowiązkowe + dodatkowe) – wiersze wzoru
    if (rows.some(r => /Zarządzanie ludźmi|Wykorzystywanie wiedzy|Rzetelność/.test(r[0] || '')) && /Kryteria obowiązkowe/i.test(rows[0][0] || '') && !rows.some(r => /ELEMENTY OCENY|OCENA CZĄSTKOWA/.test(r.join('|')))) {
      const out = rows.map(r => r.slice());
      out.forEach((r, ri) => {
        if (ri === 0) return;
        const c0 = r[0] || '';
        if (c0 && mandList.some(m => c0.toUpperCase().startsWith(m))) r[0] = '☒ ' + c0;
        // „Termin sporządzenia oceny | (dd.mm.rrrr)” – wpisz termin z oceny (komórka scalona w pionie we wzorze)
        r.forEach((c, ci) => { if (c === '(dd.mm.rrrr)' && /Termin/i.test(r[ci - 1] || '')) r[ci] = plDate(data.terminOceny) || c; });
      });
      const extraRows = extras.map(k => [nameOfKey(k), '']);
      const rowsNew = [out[0], ...out.slice(1).filter(r => !(r[0] === '' && r.length === 2 && false)), ...extraRows];
      // Dodatkowe kryteria: wypełnij puste wiersze wzoru w kolumnie dodatkowych
      let ei = 0;
      rowsNew.forEach(r => { if (r.length >= 2 && r[1] === '' && r[0] === '' && ei < extras.length) { r[1] = nameOfKey(extras[ei++]); } });
      rowsNew.forEach(r => { if (r.length === 3 && r[1] === '' && r[2] === '') { /* puste */ } });
      if (ei === 0 && extras.length) { /* brak miejsc – dopisane niżej */ }
      s.table(rowsNew, colWidths(Math.max(...rowsNew.map(r => r.length)), 0.4), { header: true });
      continue;
    }
    // 4. Tabela ocen cząstkowych (B/C: 6 kolumn; pierwsza: 5 kolumn)
    const isRating = rows.some(r => /ELEMENTY OCENY|KRYTERIA OBOWIĄZKOWE|OCENA CZĄSTKOWA/.test(r.join('|'))) && rows.some(r => /(Rzetelność|Zarządzanie ludźmi|Komunikacja|Wykorzystywanie)/.test(r[0] || ''));
    if (isRating) {
      rateTableSeen++;
      const cols = Math.max(...rows.map(r => r.length));
      const levelCols = kind === 'pierwsza' ? [1, 2, 3] : [1, 2, 3, 4, 5];
      const out = rows.map(r => r.slice());
      let extraIdx = 0; let inExtra = false;
      const matched = new Set();
      out.forEach((r, ri) => {
        const c0 = r[0] || '';
        if (/KRYTERIA DODATKOWE|DODATKOWE WYBRANE/.test(c0)) inExtra = true;
        const isCrit = c0 && !/ELEMENTY|KRYTERIA|PUNKT|punkt|OCENA|Znacznie|Poniżej|Na poziomie|Powyżej|Rzetelność[^]*$/.test('') && ri > 1;
        let key = null;
        if (ri > 1 && c0 && !/^KRYTERIA|^ELEMENTY|^OCENA ŁĄCZNA|^Średnia/.test(c0)) {
          const hit = model.find(m => (m.n || m.k).toUpperCase().startsWith(c0.toUpperCase().slice(0, 14)) || m.k.startsWith(c0.toUpperCase().slice(0, 14)) || c0.toUpperCase().startsWith(m.k.slice(0, 14)));
          key = hit ? hit.k : null;
        }
        if (!c0 && inExtra && ri > 1 && extraIdx < extras.length) {
          key = extras[extraIdx++];
          r[0] = nameOfKey(key);
        }
        if (key && selected.includes(key)) {
          matched.add(key);
          const rt = ratingFor(key);
          const li = levelIndexBySpec(rt ? rt.partial : null, kind);
          // Rozłóż: znacznik w kolumnie poziomu oraz średnia cząstkowa
          for (let ci = 1; ci < cols; ci++) if (levelCols.includes(ci)) r[ci] = '';
          if (li >= 0 && levelCols[li] !== undefined) r[levelCols[li]] = 'X';
          if (kind !== 'pierwsza') {
            // kolumna „ocena cząstkowa” jest w wzorze poza siatką poziomów – wpisana w nazwie
          }
        }
        if (/^OCENA ŁĄCZNA|^Średnia/.test(c0)) r[1] = dash(res.avg !== null ? res.avg.toFixed(1).replace('.', ',') + ' pkt' : '');
      });
      // Dopisz kryteria dodatkowe, których zabrakło w wzorze
      const notInTemplate = selected.filter(k => !matched.has(k) && !(kind !== 'pierwsza' && mandList.some(m => k.startsWith(m))) && !extras.slice(0, extraIdx).includes(k));
      for (const k of notInTemplate) {
        const rt = ratingFor(k);
        const li = levelIndexBySpec(rt ? rt.partial : null, kind);
        const row = Array(cols).fill('');
        row[0] = nameOfKey(k);
        if (li >= 0) row[levelCols[li]] = 'X';
        out.push(row);
      }
      s.table(out, colWidths(cols, 0.34), { header: true });
      continue;
    }
    // 5. Przyznanie oceny (B/C) – poziomy i wynik
    if (rows.some(r => /Ogólny poziom|Liczba punktów/.test(r.join(' ')))) {
      const out = rows.map(r => r.slice());
      out.forEach((r, ri) => {
        if (ri === 0) return;
        const txt = (r[1] || '') + ' ' + (r[2] || '');
        const lvlMatch = res.level && (r[2] || '').trim().toLowerCase() === res.level;
        if (lvlMatch) r[0] = 'X';
        if (/POZYTYWNA/i.test(r[0] || '') || /POZYTYWNA/i.test(r[1] || '')) { const ix = r.findIndex((c, i) => i > 0 && c === '' && /POZYTYWNA/i.test(r[i - 1] || '')); if (ix > 0) r[ix] = res.wynik === 'pozytywna' ? 'X' : ''; }
        if (/NEGATYWNA/i.test(r[0] || '') || /NEGATYWNA/i.test(r[1] || '') || /NEGATYWNA/i.test(r[2] || '') || /NEGATYWNA/i.test(r[3] || '')) { const ix = r.findIndex((c, i) => i > 0 && c === '' && /NEGATYWNA/i.test(r[i - 1] || '')); if (ix > 0) r[ix] = res.wynik === 'negatywna' ? 'X' : ''; }
        void txt;
      });
      // Kolumny jak we wzorze: wąska kolumna na „X”, przedziały punktów, poziom; wiersz wyniku ma 5 komórek
      s.table(out, n => (n >= 5 ? [0.34, 0.16, 0.17, 0.16, 0.17] : [0.34, 0.33, 0.33]), { header: true });
      continue;
    }
    // 6. Pojedyncze pola tekstowe: uzasadnienie / wnioski
    if (rows.length && rows.every(r => r.length === 1 || (r.length === 1 && r[0] === ''))) {
      const first = rows[0][0] || '';
      const needText = rows.findIndex(r => r[0] === '');
      if (/UZASADNIENIE|WNIOSKI/.test(first) || /UZASADNIENIE|WNIOSKI/.test(prevHeading)) {
        const text = /UZASADNIENIE/.test(first + prevHeading) ? (data.uzasadnienie || '—') : (data.dev || '—');
        const out = rows.map(r => r.slice());
        if (needText >= 0) out[needText][0] = text;
        else out.push([text]);
        s.table(out, [1], { header: !!first });
        continue;
      }
      if (/POUCZENIE/i.test(first) || /Zgodnie|Na podstawie/.test(first)) { s.table(rows, [1]); continue; }
      s.table(rows, [1]);
      continue;
    }
    // 7. TAK / NIE (poprzednia ocena, kolejny stopień, zaliczenie, sprawozdanie)
    if (rows.some(r => r.includes('TAK') || r.includes('NIE'))) {
      const out = rows.map(r => r.slice());
      out.forEach(r => {
        const i = r.indexOf('NIE DOTYCZY');
        if (i >= 0 && kind === 'C') r[i + 1] = 'X';
        if (kind !== 'C') {
          const ni = r.indexOf('NIE');
          if (ni >= 0 && (r[ni] === 'NIE')) r[ni + 1] = 'X';
        }
      });
      s.table(out, colWidths(Math.max(...out.map(r => r.length)), 0));
      continue;
    }
    // 8. Pozostałe tabele (podpisy, pouczenie, potwierdzenia): wzór bez zmian
    s.table(rows, colWidths(Math.max(...rows.map(r => r.length)), 0), {});
  }

  // Blok podpisów i zapoznania (podpis symulowany – mock do czasu integracji z podpisem kwalifikowanym).
  // Nie jest częścią wzoru – osobna strona, wyraźnie oznaczona.
  s.newPage();
  s.para('Załącznik systemowy – nie jest częścią wzoru arkusza', { size: 8, color: MU });
  s.heading('Podpisy elektroniczne i zapoznanie z oceną');
  const sigs = ctx.signatures || [];
  if (!sigs.length) s.para('Brak podpisów elektronicznych dla tej oceny.', { size: 8.5 });
  sigs.forEach(g => {
    s.para(`${g.role === 'przelozony' ? 'Podpis oceniającego' : 'Zapoznanie ocenianego'}: ${g.name} · ${plDate(g.signed_at)} ${g.signed_at.slice(11, 16)} · ${g.valid ? 'weryfikacja OK' : 'BRAK ZGODNOŚCI'}`, { size: 8.5, bold: true });
    s.para(`SHA-256 dokumentu: ${g.doc_sha256}`, { size: 7.5, color: MU });
  });
  const ack = ctx.ack || {};
  s.para(`Zapoznanie ocenianego: ${ack.ackAt ? plDate(ack.ackAt) : 'brak'}   ·   Termin na sprzeciw (7 dni, art. 83 ust. 1): ${ack.deadline ? plDate(ack.deadline) : '—'}   ·   Sprzeciw: ${ack.objectionAt ? plDate(ack.objectionAt) + ' – ' + (ack.objectionText || '') : 'nie złożono'}`, { size: 8.5 });
  s.para('Weryfikacja: skrót SHA-256 treści oceny i podpis systemowy. Podpis kwalifikowany lub zaufany wymaga odrębnego procesu.', { size: 7.5, color: MU });

  s.finish();
  return Buffer.from(await pdf.save());
}
