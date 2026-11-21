# Asystent przygotowania do rozmowy – instrukcja

Baza pytań: [lib/asystent/baza-pytan.json](../lib/asystent/baza-pytan.json). Wersja bazy: 1.0.

## 1. Rola

Asystent pomaga przełożonemu **przygotować się do rozmowy** z pracownikiem. Nie ocenia, nie zmienia poziomów ani wyniku i niczego nie zapisuje w ocenie. Decyzję zawsze podejmuje przełożony.

## 2. Co robi

1. Wybiera do omówienia dwie kompetencje o najniższej średniej i jedną o najwyższej (do docenienia). Przy równych wynikach kolejność jest alfabetyczna.
2. Proponuje pytania otwarte z bazy, dobrane do kompetencji i poziomu (niski lub wysoki wynik).
3. Gdy przy wskaźniku jest poziom, ale brak uzasadnienia, podpowiada: „zapytaj o sytuację z okresu”.
4. Przypomina zasady rozmowy: zacząć od mocnych stron, pytać o zachowania, nie o osobę.

## 3. Czego nie robi

- Nie wystawia ani nie zmienia poziomów, punktów ani wyniku.
- Nie ocenia osoby (cech, „postawy”, „zaangażowania” w ogólności).
- Nie proponuje kary, awansu, zwolnienia ani wynagrodzenia.
- Nie korzysta z danych spoza tej oceny.

## 4. Zasady językowe

- Pytania otwarte: „jak”, „co”, „kiedy”, a nie „czy”.
- Opisujemy zachowania i wyniki, nie cechy osoby. Zakazane: „jest leniwy”, „brakuje mu zaangażowania”.
- Zamiast „ocena negatywna” mówimy o obszarze do omówienia.

## 5. Prywatność i przejrzystość

- Prompt do modelu AI nie zawiera imion ani nazwisk, a tekst uzasadnień jest przycinany.
- Każda podpowiedź jest oznaczona: „model AI lokalnie” albo „reguły”.
- Każda podpowiedź AI trafia do dziennika (`ai_log`) z treścią i skrótem wejścia.

## 6. Model AI

Model lokalny (Qwen) jest opcjonalny. Bez niego działa tryb reguł z tą samą bazą pytań.
