# NOTES – nocna iteracja (pamięć orkiestratora)

## Czas
- Start: 2026-11-22 04:13:17 (epoch 1795317197)
- Twardy koniec pętli: 06:03:17 · podsumowanie do 06:13:17
- Gałąź: `nocna-iteracja` (z `main` @ d4c19cf). Nie pushować, nie dotykać main.

## Wykryte komendy i struktura
- Menedżer: npm. Bez frameworka (Node ≥ 22.13, `node:sqlite`).
- Dev server: `KK_AI_KEY= KK_AI_URL=http://127.0.0.1:9 node server.mjs` → http://localhost:8080 – BEZ klucza (zasada Janka: zero prawdziwych wywołań API; AI w trybie regułowym, testy i persony z atrapą).
- Testy: `npm test` (node:test, 121 testów na starcie, wszystkie zielone).
- Persony: `node e2e/personas/run.mjs <persona>` (Playwright, własny serwer na losowym porcie, osobny katalog danych, atrapa AI) → `e2e/personas/out/<persona>/`.
- UI: `index.html`, `app/app.js` (SPA, szablony w stringach), `app/app.css`. Serwer: `server.mjs`, `lib/*.mjs` (PDF/XML, cykl, bezpieczeństwo).
- AI: `llm()` w server.mjs. Klucz `KK_AI_KEY` z `.env` (ustawiony – sprawdzono tylko obecność). Model: `KK_AI_MODEL` (PLLuM-70B). Trasy: `/api/ai/talk|formal|development|chat|checkin|brief|prep`.
- Konta demo: `przelozony@demo.kk`, `pracownik1..6@demo.kk`, hasło `Demo-kompas-2026!` (tylko lokalnie).

## MUST (ścieżki do demo dla jury)
- (a) **Dobór kryteriów:** rozmowa rozpoczynająca (Start → „Zapisz rozmowę”: arkusz B/C, obowiązkowe automatycznie, maks. 3 dodatkowe) + kreator oceny krok „Kryteria”. Brak podpowiedzi AI przy doborze kryteriów dodatkowych → do oceny.
- (b) **Rzetelna ocena:** Informacje (obserwacje S-D-R przy wskaźnikach), kreator oceny (wskaźniki → oceny cząstkowe → wynik wyliczony z § 11), walidacja przed złożeniem, „Sprawdź język uzasadnień” (AI), Zestawienie bez średnich, PDF arkusza.
- (c) **Rozmowa i rozwój:** brief do rozmowy (AI + JSON faktów), pytania do rozmowy (AI), cele z krokami, plan rozwoju i komunikat od przełożonego, Mój profil pracownika (plan, trendy), „Przygotuj się do rozmowy” (AI pracownika).
- Ekran logowania i pierwsze 30 s (wartość produktu jasna), dane demo gotowe, stany ładowania/błędu AI.

## EXTRA (dopiero gdy każdy punkt rubryki ≥ 9)
- Metryki wsparcia, ankieta, dziennik, ustawienia modułów, podpis mock, sprzeciw, aktywacja kont, rola HR, Arkusz A, IPRZ, czat asystenta ogólnego, eksport XML.

## Wynik startowy (cykl 0, 04:30) – pomiary person (atrapa AI)
- Testy: 121/121. Persony desktop: wszystkie kroki przechodzą; mobile: krystyna 8/13, michal 7/8, ewa 6/8, juror 6/9 (zawieszone kliknięcia – dolne menu z 9 pozycjami nie mieści się na 390 px).
- Konsola: 1 błąd na każdym przebiegu (401 z `/api/me` przed zalogowaniem). 5xx: 0. Start strony ~0,56 s; najdłuższy krok desktop 1,7 s.
- a11y: 5 ukrytych natywnych `<select>` bez etykiety (komponent własnej listy), brak widocznego h1 na telefonie.

## Tabela wyników cykli
| Cykl | Godzina | 1 Ścieżki | 2 Konsola/stany | 3 Testy | 4 Wydajność | 5 WCAG | 6 Design gov | 7 AI | 8 Jury | Średnia | Persony |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 (start) | 04:30 | 6 | 6 | 7 | 8 | 6 | 5 | 7 | 6 | 6,4 | (persony haiku od cyklu 1) |
| 1 | 04:37 | 6 | 8 | 8 | 8 | 7 | 5 | 8 | 6 | 7,0 | skrypty: desktop wszystkie kroki OK, mobile nadal pada (menu poza ekranem) |
| 2 | 04:47 | 7 | 6 | 9 | 8 | 7 | 7 | 8 | 6 | 7,3 | juror 6, Krystyna 5, klawiatura 6 |

## Decyzje do przejrzenia
- Zasada Janka (04:2x): żadnych prawdziwych wywołań API i żadnego użycia klucza z `.env`. Serwer deweloperski uruchamiany bez klucza, rubryka pkt 7 oceniana na atrapach (smoke testy z prawdziwym API pominięte).
- Playwright (`playwright`, devDependency, oficjalny rejestr npm) + przeglądarka Chromium przez `npx playwright install chromium` – do skryptów person (wymóg z ORCHESTRATOR.md).
- Persony używają własnej instancji serwera z atrapą modelu AI (nie prawdziwego API) i osobnej bazy w katalogu tymczasowym – nie dotykają `data/`.
- Kierunek designu: rubryka wymaga stylu gov.pl / mObywatel. Projekt „Kompas” z Claude Design (papier, mosiądz, serif) NIE jest wdrażany – wybrano styl rządowy z rubryki.

## Specyfikacja designu gov.pl / mObywatel (research 04:30, do cyklu 2)
Źródła: księgi znaku instytucji rządowych (Open Sans jako krój podstawowy w materiałach elektronicznych – fundusze UE, CeZ), opis redesignu mObywatela (tokeny, grupowanie usług), kopia kodu mObywatela (codeberg.org/fajfer/mObywatel). Oficjalnej dokumentacji komponentów gov.pl w wynikach brak – styl przenoszony z obserwowalnych cech, BEZ godła i logotypów.
- Krój: Open Sans (już w projekcie, self-hosted), nagłówki Open Sans 700 (zamiast Montserrat), tekst 16 px, interlinia 1.5, bez wersalików w treści.
- Kolory: tło strony #F5F6F7, karty #FFFFFF z obramowaniem #DDE1E6, główny #0052A5 (hover #003F7D), tekst #1B1B1B, pomocniczy #5C6370, sukces #1E7A3C/#E7F4EC, ostrzeżenie #8A5300/#FFF4DB, błąd #B3261E/#FDECEA, fokus: 3 px #FFB703 + 1 px ciemny pierścień.
- Komponenty: karty z zaokrągleniem 8 px (styl mObywatela), przyciski 4 px, wysokość ≥ 44 px, główny wypełniony niebieski, drugi obramowany; jeden główny przycisk na sekcję; tytuł strony ciemny (nie wyblakły niebieski).
- Język: prosty, zdania zamiast żargonu, nazwy kompetencji zwykłą pisownią (bez WIELKICH LITER), daty dd.mm.rrrr lub słownie.

## Znane problemy
- (uzupełniane w trakcie)

## Dziennik cykli

### Cykl 1 (04:28–04:37)
- Zmiany: `/api/session` (start bez 401 – konsola 0 błędów u person), `POST /api/ai/criteria` (ścieżka a: propozycje tylko z modelu, walidacja, fallback regułowy, 6 testów z atrapą), menu mobilne 4 + „Więcej”, h1 na telefonie, etykiety list wyboru, persony: tryb awarii AI (`PERSONA_AI=down|slow`), persona `awaria`, pomiar `interactiveMs`.
- Dowody: `npm test` 127/127; persona awaria (AI down): komunikat regułowy widoczny dla briefu i pytań do rozmowy; desktop: żaden ekran > 2 s (maks. 1,5 s), konsola 0.
- Znaleziony błąd: na 390 px `nav.bottom` (fixed) leży poza ekranem (top≈1283) – przodek z transformacją; przekazane frontendowi w cyklu 2.
- Następne: design gov.pl + przycisk AI kryteriów w UI + logowanie (frontend, w toku), dane demo dla jury (backend, w toku), potem persony haiku (juror + krystyna + klawiatura).
- Retro: równoległe zadania o rozłącznych plikach działają; agent bez dostępu do skryptu e2e zgadywał przyczynę – na przyszłość qa-perf od razu dostaje zadanie diagnozy UI razem z poprawką skryptu.

### Cykl 2 (04:37–04:47)
- Zmiany: design gov.pl/mObywatel (tokeny, Open Sans, karty 8 px, ciemny tytuł, fokus), „Zaproponuj kryteria (AI)” w rozmowie rozpoczynającej, logowanie z wartością produktu (a/b/c), naprawa menu mobilnego (`.sr` rozpychał układ do 627 px), dane demo dla jury (rozmowy rozpoczynające, plan rozwoju, ocena C, cele w 3 stanach).
- Dowody: `npm test` 129/129; krystyna mobile 13/13 (wcześniej 8/13); konsola 0 u wszystkich person.
- Persony: juror 6 (błąd JS w toaście na profilu pracownika, brief „0 s” wygląda na zawieszony, mobile bez wylogowania, pusty Start w trakcie animacji), Krystyna 5 (żargon: check-iny, feedback, artefakt, arkusz B; brak wskazania pierwszego kroku; „Zamknij” w kreatorze), klawiatura 6 (identyczne nazwy przycisków w wierszach; skrypt błędnie raportował pola bez nazwy – fałszywy alarm).
- Pkt 2 obniżony do 6: surowy błąd JS widoczny dla użytkownika (toast). 
- Retro: backend zrobił `git stash` w trakcie pracy frontendu – dopisano zakaz w rolach. Persony haiku dają konkretne, użyteczne uwagi; log fokusu w skrypcie trzeba poprawić (nazwa dostępna zamiast textContent).
- Następne (cykl 3): frontend – błąd JS, animacje wejścia, przewodnik „3 kroki” na Start, prosty język, nazwy przycisków w wierszach, wylogowanie na mobile, opis briefu; qa – log nazwy dostępnej, skip link, oczekiwanie na AI, wylogowanie w skrypcie.

