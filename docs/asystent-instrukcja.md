# Asystent przygotowania do rozmowy – instrukcja sposobu działania

Dokument dla zamawiającego (Ministerstwo Cyfryzacji), zespołu i osób wdrażających. Opisuje, co asystent robi, jak myśli i czego nie robi. Baza pytań: [lib/asystent/baza-pytan.json](../lib/asystent/baza-pytan.json). Wersja bazy: 1.0.

## 1. Rola asystenta

Asystent pomaga przełożonemu **przygotować się do rozmowy** z pracownikiem. Nie ocenia, nie ustala wyniku i nie zapisuje niczego w ocenie. Przełożony zawsze decyduje sam.

Przykład: przy wskaźniku ocenionym nisko asystent podpowiada, o co dopytać, zanim przełożony uzna wynik za ostateczny. Może wtedy usłyszeć wyjaśnienie, którego w ocenie nie było.

## 2. Co asystent robi

1. **Wybiera obszary do rozmowy** z ocen cząstkowych: kompetencje z najniższymi i najwyższymi średnimi.
2. **Proponuje pytania otwarte** z bazy pytań, dobrane do kompetencji i poziomu (niski lub wysoki wynik).
3. **Wskazuje brakujące przykłady.** Gdy przy wskaźniku nie ma opisu sytuacji, sugeruje zapytać o przykład zamiast zakładać brak działania.
4. **Przypomina zasady rozmowy:** zaczynać od mocnych stron, pytać o zachowania, nie o osobę.
5. **Opcjonalnie (moduł AI):** przeformułowuje uzasadnienia tak, by opisywały zachowania (sprawdzenie języka, nie zmiana poziomu).

## 3. Czego asystent nie robi

- Nie wystawia ani nie zmienia poziomów, punktów ani wyniku pozytywnego/negatywnego.
- Nie ocenia osoby (cech, „postawy”, „zaangażowania” w ogólności).
- Nie proponuje kary, awansu, zwolnienia ani wynagrodzenia.
- Nie podejmuje decyzji i nie zapisuje odpowiedzi pracownika bez człowieka.
- Nie korzysta z danych poza tą oceną (brak innych systemów, historii, danych z internetu).

## 4. Jak asystent myśli (kroki)

Dla każdej oceny asystent wykonuje tę samą sekwencję:

1. **Odczyt wyników** – średnia cząstkowa każdej kompetencji, bez wyniku ogólnego.
2. **Wybór obszarów** – dwie najniższe kompetencje (do omówienia) i jedna najwyższa (do docenienia). Przy równych wynikach kolejność jest alfabetyczna, żeby była powtarzalna.
3. **Dobór pytań** – z bazy: dla niskiego wyniku pytania o warunki, przeszkody i wsparcie; dla wysokiego pytania o utrzymanie działań i docenienie.
4. **Sprawdzenie przykładów** – jeśli wskaźnik ma poziom, ale brak uzasadnienia, asystent dodaje: „zapytaj o sytuację z okresu”.
5. **Zestawienie podpowiedzi** – krótka lista, z zastrzeżeniem, że to nie jest ocena.

Te same zasady są w promptach modelu AI (lokalny Qwen) jako instrukcja systemowa: pytania, bez oceny, bez danych osobowych w prompcie.

## 5. Zasady językowe

- Pytania otwarte: „jak”, „co”, „kiedy”, nie „czy” (chyba że pytamy o fakt).
- Opisujemy zachowania i wyniki, nie cechy osoby. Zakazane przykłady: „jest leniwy”, „brakuje mu zaangażowania”.
- Nie używamy języka wyroku. Zamiast „ocena negatywna” mówimy o obszarze do omówienia.
- Krótko: jedna myśl na punkt.

## 6. Prywatność i przejrzystość

- Prompt do modelu nie zawiera imion ani nazwisk. Tekst uzasadnień jest przycinany.
- Każda podpowiedź jest oznaczona: „model AI lokalnie” lub „reguły”.
- Każda podpowiedź AI trafia do dziennika (`ai_log`), z treścią i skrótem wejścia.
- Pracownik może się dowiedzieć, że przy ocenie używano asystenta (informacja w klauzuli, do uzupełnienia).

## 7. Kontrola jakości

- Przed każdą zmianą bazy pytań przegląd przez dwóch niezależnych członków zespołu (merytoryka i język).
- Testy automatyczne sprawdzają, że asystent nie zmienia ocen i nie zapisuje ich (`npm test`).
- Co kwartał przegląd próbek podpowiedzi pod kątem stronniczości i języka oceniającego.
- Zgłoszenia pytań, które wydają się oceniające, zapisuje się w dzienniku zmian bazy (wersja pliku).

## 8. Jak to pokazać w prezentacji (3 zdania)

> Asystent nie ocenia. Pokazuje przełożonemu, o co warto zapytać, zanim podejmie decyzję. Każde jego pytanie pochodzi z jawnej, sprawdzalnej bazy i jest zapisane w dzienniku.

## 9. Zakres i ograniczenia

- Baza ma 14 kompetencji i 56 pytań w wersji 1.0. Nie obejmuje jeszcze wszystkich sytuacji w służbie cywilnej.
- Model AI (Qwen) jest opcjonalny. Bez niego działa tryb reguł z tą samą bazą pytań.
- Rozszerzenie bazy wymaga zmiany wersji i przeglądu, jak w pkt 7.
