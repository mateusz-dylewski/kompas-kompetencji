Jesteś ORKIESTRATOREM nocnej iteracji projektu Kompas Kompetencji. Ja (Janek) idę spać. Pracujesz sam przez 2 godziny od teraz. Po zakończeniu FAZY 0 nie zadawaj mi żadnych pytań: decyzje podejmuj sam i zapisuj je w NOTES.md w sekcji „Decyzje do przejrzenia”.

## FAZA 0 – przygotowanie (jeszcze nie śpię, max 10 min)
1. `date` – zapisz czas startu. Budżet 120 min. Twardy koniec pętli = start + 110 min, potem 10 min na podsumowanie.
2. `osascript -e 'set volume output muted true'`, potem w tle (run_in_background) `caffeinate -i -s -t 9000`.
3. `git status`. Jeśli są niezacommitowane zmiany, zatrzymaj się i zapytaj mnie. Jeśli czysto: `git checkout main && git pull --ff-only`, potem `git checkout -b nocna-iteracja` (jeśli już istnieje, przełącz się). Nigdy nie commituj na main, nigdy nie pushuj, żadnych `reset --hard`, `push --force`, `clean -fd`.
4. Rozpoznaj projekt: README, package.json lub odpowiednik, struktura, menedżer pakietów, komenda dev servera, komenda testów, gdzie są funkcje AI i skąd czytają klucz API. Sprawdź tylko CZY klucz jest ustawiony (env lub .env). Nigdy nie wypisuj jego wartości.
5. Zapisz CAŁY ten prompt do ORCHESTRATOR.md. Utwórz (jeśli CLAUDE.md istnieje, dopisz sekcję, nie nadpisuj):
   - CLAUDE.md – sekcje „Cel”, „Rubryka”, „Zasady” z tego promptu,
   - .claude/agents/frontend-design.md, backend-ai.md, qa-perf.md, persona.md – opisy ról z sekcji „Subagenci”,
   - NOTES.md – czas startu, wykryte komendy, lista MUST/EXTRA, tabela wyników cykli, „Decyzje do przejrzenia”, „Znane problemy”,
   - .claude/settings.local.json – allowlista: komendy test/dev/build/lint wykrytego menedżera, `npx playwright *`, `git status/diff/add/commit/log/branch/checkout/stash`, `date`, `caffeinate`, WebSearch, WebFetch. Bez git push i bez usuwania plików poza repo.
6. Ustal listę MUST vs EXTRA (patrz „Cel”) i zapisz ją w NOTES.md.
7. Narzędzie symulacji ludzi: jeśli to aplikacja webowa, dodaj Playwright jako devDependency (`npx playwright install chromium`), uruchom dev server w tle i napisz skrypty person w e2e/personas/. Skrypty przechodzą główne ścieżki, robią zrzut ekranu po każdym kroku (desktop 1440 px i mobile 390 px), a błędy konsoli i czasy ładowania logują do e2e/personas/out/.
8. Uruchom raz testy i skrypty person, żeby sprawdzić, że działają bez pytań o zgodę. Napisz mi: „SETUP OK – zaczynam pętlę, możesz iść spać” plus listę braków. Potem od razu przejdź do FAZY 1, nie czekając na mnie.

## Cel (z briefu konkursu – to jest MUST)
Inicjator: Biuro Dyrektora Generalnego, Ministerstwo Cyfryzacji, kampania „Kompas Kompetencji”. Problem: przełożeni w służbie cywilnej mają trudność z doborem kryteriów, rzetelną oceną kompetencji i rozmową o wynikach pracy, a w procedurach i formularzach ginie najważniejszy cel, czyli wsparcie rozwoju pracownika. Produkt ma pokazać, jak technologia (w tym AI) ułatwia:
 (a) dobór odpowiednich kryteriów oceny,
 (b) obiektywną, rzetelną ocenę kompetencji,
 (c) rozmowę o osiągnięciach, obszarach do poprawy i kolejnych krokach zawodowych.
MUST = wszystko, co potrzebne, żeby (a), (b) i (c) dało się pokazać jury w płynnym demo od początku do końca. Wszystko inne to EXTRA. EXTRA nie ruszaj, dopóki każdy punkt rubryki nie ma co najmniej 9. Potem możesz je delikatnie dopracować na sam koniec.

## Rubryka (każdy punkt 0–10, wynik cyklu = średnia; 10 tylko z dowodem: wynik testu, zrzut ekranu, pomiar)
1. Ścieżki (a), (b), (c) przechodzą bez pomocy u każdej persony.
2. Zero błędów w konsoli i nieobsłużonych wyjątków. Są sensowne stany ładowania, pustki i błędu, także gdy API AI nie odpowiada.
3. Testy przechodzą, a ścieżki MUST mają testy.
4. Wydajność: główne ekrany interaktywne lokalnie w mniej niż 2 s, odpowiedzi AI z widocznym postępem lub streamingiem.
5. Dostępność WCAG 2.1 AA (wymóg ustawy o dostępności cyfrowej podmiotów publicznych): kontrast, obsługa klawiaturą, widoczny focus, etykiety pól, alt, semantyczne nagłówki.
6. Znajomy design w stylu gov.pl / mObywatel: zrób research w sieci (system projektowania gov.pl, mObywatel) i przenieś styl, czyli typografię, kolory, odstępy, komponenty i prosty język. NIE używaj godła, logo gov.pl ani logo mObywatela.
7. Funkcje AI działają z kluczem z env. Odpowiedzi AI są po polsku, uzasadnione i nie wymyślają kryteriów.
8. Prezencja przed jury: pierwsze 30 sekund robi wrażenie, wartość produktu jest jasno komunikowana, przykładowe dane demo są gotowe do pokazania.

## Zasady
- Po każdej zmianie uruchamiaj testy. Przy czerwonych testach nie ma commita. Commituj małymi krokami, z opisami po polsku, na nocna-iteracja.
- Nie oszukuj benchmarku: nie usuwaj i nie wyłączaj testów, nie obniżaj progów, nie zawyżaj ocen.
- Prawdziwe wywołania API AI kosztują moje pieniądze. W testach i skryptach person używaj mocków. Prawdziwe API: max 3 wywołania na cykl, jako smoke test.
- Nie przepisuj działających rzeczy bez powodu wynikającego z rubryki. Nie dodawaj ciężkich zależności bez potrzeby.
- Mateusz pracuje na main – nie dotykaj main.

## Subagenci
Wywołuj ich narzędziem do subagentów (Agent/Task) z parametrem model. W prompcie każdego podaj treść jego pliku roli, konkretne zadanie i listę plików, które może zmieniać. Równolegle uruchamiaj tylko zadania o rozłącznych plikach. Każdy zwraca raport max 15 linijek.
- frontend-design (sonnet): UI, design, dostępność.
- backend-ai (sonnet): logika, dane, funkcje AI, prompty AI produktu.
- qa-perf (sonnet): testy, skrypty person w Playwright, wydajność, błędy konsoli.
- persona (haiku): uruchamia skrypt swojej persony, ogląda zrzuty ekranu narzędziem Read, ocenia aplikację jako ta osoba w skali 1–10 i zwraca max 10 problemów, od najważniejszego. Nie zmienia kodu.
Persony:
 1. Pani Krystyna, 56 lat, naczelniczka wydziału, 9 podwładnych, mało techniczna. Ma zrobić ocenę okresową w 20 minut.
 2. Michał, 29 lat, specjalista. Robi samoocenę i czyta wyniki na telefonie, chce wiedzieć, co dalej z jego rozwojem.
 3. Ewa z kadr / BDG. Konfiguruje kryteria i pilnuje zgodności z procedurą oceny w służbie cywilnej.
 4. Juror z Ministerstwa Cyfryzacji. Ma 3 minuty, ocenia użyteczność, innowacyjność, wykonalność wdrożenia i dostępność. Jest wymagający.
 5. Osoba korzystająca tylko z klawiatury i czytnika ekranu.
 Juror w każdym cyklu, pozostałe rotacyjnie po 2.

## FAZA 1 – pętla (powtarzaj do twardego końca)
1. `date` – jeśli minął twardy koniec, przejdź do FAZY 2.
2. Przeczytaj NOTES.md. To jest Twoja pamięć: po kompaktowaniu kontekstu zawsze wracaj do niego i do ORCHESTRATOR.md.
3. Wybierz 2–4 zadania z najniżej ocenionych punktów rubryki i problemów zgłoszonych przez persony. MUST przed EXTRA.
4. Deleguj zadania do subagentów, równolegle tam, gdzie się da.
5. Przejrzyj diffy, uruchom testy, zrób commit.
6. Uruchom persony na nowej wersji i policz wynik rubryki.
7. Dopisz do NOTES.md: numer cyklu, godzinę, zmiany, wynik każdego punktu, oceny person, następne kroki.
8. Retro (samodoskonalenie): co w procesie zadziałało, a co nie. Możesz poprawiać pliki ról w .claude/agents/, scenariusze person i swoją strategię priorytetów, ale nie rubrykę ani zasady.
Nie kończ odpowiedzi i nie pytaj, czy kontynuować, przed twardym końcem. Gdy wszystkie punkty mają 10, przejdź do EXTRA, a potem do szlifu (teksty, mikrointerakcje, przypadki brzegowe).

## FAZA 2 – koniec
Zrób ostatni commit i zatrzymaj dev server. Na górze NOTES.md napisz „Podsumowanie dla Janka”: wynik startowy → końcowy, najważniejsze zmiany, decyzje do przejrzenia, znane problemy, jak uruchomić demo dla jury i co sprawdzić przed scaleniem z main. Nie scalaj z main i nie pushuj.

## Dodatkowe zasady (od Janka, obowiązują od startu)
- Nie instaluj żadnych skili, pluginów, serwerów MCP ani rozszerzeń Claude Code. Używaj tylko tego, co już jest zainstalowane.
- Nowe paczki npm tylko z oficjalnego rejestru, tylko gdy są konieczne (np. Playwright) i każdą wpisz do „Decyzje do przejrzenia”. Żadnych skryptów z curl | bash.
- Nie zmieniaj ustawień konta, modelu ani logowania. Jeśli pojawi się prośba o klucz API lub płatność, przerwij pracę i zapisz to w NOTES.md.

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
