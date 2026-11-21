// Terminy ocen okresowych (ustawa o służbie cywilnej, art. 81; poradnik oceny okresowej KPRM, 2016).
// CYCLE_MONTHS: ocena okresowa co 24 miesiące.
// REEVAL_MONTHS: po ocenie negatywnej ponowna ocena po 6 miesiącach (art. 81 ustawy) – DO WERYFIKACJI prawnej.
// MIN_GAP_MONTHS: najwcześniejszy termin kolejnej oceny – 6 miesięcy od poprzedniej (poradnik) – DO WERYFIKACJI prawnej.
// KICKOFF_DAYS: rozmowa rozpoczynająca okres oceny – w ciągu 30 dni od poprzedniej oceny (poradnik, rozdz. 6.2).
export const CYCLE_MONTHS = 24;
export const REEVAL_MONTHS = 6;
export const MIN_GAP_MONTHS = 6;
export const KICKOFF_DAYS = 30;

const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

// Dodaje miesiące; przy krótszym miesiącu docelowym wybiera jego ostatni dzień (31.08 + 6 mies. → 28/29.02)
export function addMonths(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}
export const addDays = (date, n) => new Date(Date.parse(date + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

const dataOf = ev => (typeof ev.data === 'string' ? JSON.parse(ev.data || '{}') : (ev.data || {}));

// Data odniesienia oceny: termin sporządzenia, a gdy go brak – koniec okresu, a dalej data złożenia
export const refDate = ev => {
  const data = dataOf(ev);
  return [data.terminOceny, ev.period_to, String(ev.updated || '').slice(0, 10)].find(isDate) || null;
};
export const isNegative = ev => dataOf(ev).wynik === 'negatywna';

// Ostatnia ocena okresowa (B/C), która nie jest szkicem; pierwsza ocena nie wchodzi do cyklu ocen okresowych
export function lastPeriodic(evals, excludeId = null) {
  return evals.filter(e => ['B', 'C'].includes(e.typ) && e.status !== 'draft' && e.id !== excludeId && refDate(e))
    .sort((a, b) => (refDate(a) < refDate(b) ? 1 : -1))[0] || null;
}

// Termin kolejnej oceny po ocenie `prev`: 6 miesięcy po negatywnej, w pozostałych przypadkach 24 miesiące
export function nextDueAfter(prev) {
  if (!prev || !refDate(prev)) return { nextDue: null, dueReason: null };
  const neg = isNegative(prev);
  return { nextDue: addMonths(refDate(prev), neg ? REEVAL_MONTHS : CYCLE_MONTHS), dueReason: neg ? 'ponowna_po_negatywnej' : 'cykl_24' };
}

// Sprawdza, czy nowa ocena (data odniesienia `date`) nie jest zbyt wczesna względem poprzedniej
export function timingCheck(evals, date, excludeId = null) {
  const prev = lastPeriodic(evals, excludeId);
  const due = nextDueAfter(prev);
  if (!prev || !isDate(date)) return { ok: true, prevId: prev?.id ?? null, earliest: null, ...due };
  const earliest = addMonths(refDate(prev), MIN_GAP_MONTHS);
  return { ok: date >= earliest, prevId: prev.id, prevDate: refDate(prev), earliest, ...due };
}

// Termin rozmowy rozpoczynającej kolejny okres: 30 dni od poprzedniej oceny (null, gdy brak poprzedniej)
export const kickoffDue = prev => (prev && refDate(prev) ? addDays(refDate(prev), KICKOFF_DAYS) : null);
