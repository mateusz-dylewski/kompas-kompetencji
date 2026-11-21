// Terminy ocen okresowych (ustawa o służbie cywilnej, art. 81; poradnik oceny okresowej).
// CYCLE_MONTHS: ocena okresowa co 24 miesiące.
// MIN_GAP_MONTHS: reguła 6 miesięcy między ocenami wg poradnika (art. 81 ust. 8 ustawy) – DO WERYFIKACJI prawnej.
export const CYCLE_MONTHS = 24;
export const MIN_GAP_MONTHS = 6;

const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

// Dodaje miesiące; przy krótszym miesiącu docelowym wybiera jego ostatni dzień (31.08 + 6 mies. → 28/29.02)
export function addMonths(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}

// Data odniesienia oceny: termin sporządzenia, a gdy go brak – koniec okresu, a dalej data złożenia
export const refDate = ev => {
  const data = typeof ev.data === 'string' ? JSON.parse(ev.data || '{}') : (ev.data || {});
  return [data.terminOceny, ev.period_to, String(ev.updated || '').slice(0, 10)].find(isDate) || null;
};

// Ostatnia ocena okresowa (B/C), która nie jest szkicem; pierwsza ocena nie wchodzi do cyklu ocen okresowych
export function lastPeriodic(evals, excludeId = null) {
  return evals.filter(e => ['B', 'C'].includes(e.typ) && e.status !== 'draft' && e.id !== excludeId && refDate(e))
    .sort((a, b) => (refDate(a) < refDate(b) ? 1 : -1))[0] || null;
}

// Sprawdza, czy nowa ocena (data odniesienia `date`) nie jest zbyt wczesna względem poprzedniej
export function timingCheck(evals, date, excludeId = null) {
  const prev = lastPeriodic(evals, excludeId);
  if (!prev || !isDate(date)) return { ok: true, prevId: prev?.id ?? null, earliest: null, nextDue: prev ? addMonths(refDate(prev), CYCLE_MONTHS) : null };
  const earliest = addMonths(refDate(prev), MIN_GAP_MONTHS);
  return { ok: date >= earliest, prevId: prev.id, prevDate: refDate(prev), earliest, nextDue: addMonths(refDate(prev), CYCLE_MONTHS) };
}
