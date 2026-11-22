# Kompas Kompetencji – instrukcje dla Claude

Pełny opis nocnej iteracji: `ORCHESTRATOR.md`. Pamięć pracy: `NOTES.md`. Projekt, twarde zasady produktu i komendy: `README.md`.

## Cel
Inicjator: Biuro Dyrektora Generalnego, Ministerstwo Cyfryzacji, kampania „Kompas Kompetencji”. Problem: przełożeni w służbie cywilnej mają trudność z doborem kryteriów, rzetelną oceną kompetencji i rozmową o wynikach pracy, a w procedurach i formularzach ginie najważniejszy cel, czyli wsparcie rozwoju pracownika. Produkt ma pokazać, jak technologia (w tym AI) ułatwia:
 (a) dobór odpowiednich kryteriów oceny,
 (b) obiektywną, rzetelną ocenę kompetencji,
 (c) rozmowę o osiągnięciach, obszarach do poprawy i kolejnych krokach zawodowych.
MUST = wszystko, co potrzebne, żeby (a), (b) i (c) dało się pokazać jury w płynnym demo od początku do końca. Wszystko inne to EXTRA. EXTRA nie ruszaj, dopóki każdy punkt rubryki nie ma co najmniej 9.

## Rubryka (każdy punkt 0–10, wynik cyklu = średnia; 10 tylko z dowodem: wynik testu, zrzut ekranu, pomiar)
1. Ścieżki (a), (b), (c) przechodzą bez pomocy u każdej persony.
2. Zero błędów w konsoli i nieobsłużonych wyjątków. Są sensowne stany ładowania, pustki i błędu, także gdy API AI nie odpowiada.
3. Testy przechodzą, a ścieżki MUST mają testy.
4. Wydajność: główne ekrany interaktywne lokalnie w mniej niż 2 s, odpowiedzi AI z widocznym postępem lub streamingiem.
5. Dostępność WCAG 2.1 AA: kontrast, obsługa klawiaturą, widoczny focus, etykiety pól, alt, semantyczne nagłówki.
6. Znajomy design w stylu gov.pl / mObywatel (typografia, kolory, odstępy, komponenty, prosty język). NIE używaj godła, logo gov.pl ani logo mObywatela.
7. Funkcje AI działają z kluczem z env. Odpowiedzi AI są po polsku, uzasadnione i nie wymyślają kryteriów.
8. Prezencja przed jury: pierwsze 30 sekund robi wrażenie, wartość produktu jest jasno komunikowana, dane demo są gotowe.

## Zasady
- Po każdej zmianie uruchamiaj testy (`npm test`). Przy czerwonych testach nie ma commita. Commituj małymi krokami, z opisami po polsku, na `nocna-iteracja`.
- Nie oszukuj benchmarku: nie usuwaj i nie wyłączaj testów, nie obniżaj progów, nie zawyżaj ocen.
- Prawdziwe wywołania API AI kosztują. W testach i skryptach person używaj mocków. Prawdziwe API: max 3 wywołania na cykl, jako smoke test.
- Nie przepisuj działających rzeczy bez powodu wynikającego z rubryki. Nie dodawaj ciężkich zależności bez potrzeby.
- Mateusz pracuje na main – nie dotykaj main. Nigdy nie commituj na main, nie pushuj, bez `reset --hard`, `push --force`, `clean -fd`.
- Twarde zasady produktu z README obowiązują dalej (AI tylko proponuje, brak profilowania, bez średnich z danych miesięcznych, prompty bez nazwisk, K_MIN = 5, dziennik zmian, rozporządzenie z 4.04.2016, dane demo fikcyjne).
- Nie instaluj żadnych skili, pluginów, serwerów MCP ani rozszerzeń Claude Code. Używaj tylko tego, co już jest zainstalowane.
- Nowe paczki npm tylko z oficjalnego rejestru, tylko gdy są konieczne (np. Playwright) i każdą wpisz do „Decyzje do przejrzenia” w NOTES.md. Żadnych skryptów z curl | bash.
- Nie zmieniaj ustawień konta, modelu ani logowania. Jeśli pojawi się prośba o klucz API lub płatność, przerwij pracę i zapisz to w NOTES.md.
- Nigdy nie wypisuj wartości klucza API (`.env`, `KK_AI_KEY`).

## Zasada o API AI (od Janka, 04:2x – nadpisuje wcześniejsze o prawdziwych wywołaniach)
- Nie używaj klucza API z pliku .env ani z kodu, także nie uruchamiaj aplikacji z tym kluczem.
- Funkcje AI testuj wyłącznie mockami. Nie wykonuj żadnych prawdziwych wywołań API.
- Jeśli kod wymaga klucza do przejścia testu, zapisz to w NOTES.md w sekcji „Znane problemy” i pomiń ten test. Nie próbuj go naprawiać przez zmianę klucza.
- Nie zmieniaj wartości klucza ani pliku .env. Nie commituj żadnych kluczy.

## Zasada o limicie (od Janka)
- Jeśli pojawi się komunikat o limicie, wyczerpaniu tokenów albo przerwie z powodu limitu, natychmiast przerwij pracę.
- Przed przerwaniem: zrób commit tylko z działającymi testami na nocna-iteracja. Jeśli testy są czerwone, zapisz zmiany do osobnego pliku WIP.md zamiast commitować.
- Dopisz do NOTES.md wpis „PRZERWANE – limit”, z godziną, ostatnim wykonanym krokiem i listą tego, co zostało.
- Nie próbuj obchodzić limitu ani przełączać modelu.
