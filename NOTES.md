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

## Decyzje do przejrzenia
- Zasada Janka (04:2x): żadnych prawdziwych wywołań API i żadnego użycia klucza z `.env`. Serwer deweloperski uruchamiany bez klucza, rubryka pkt 7 oceniana na atrapach (smoke testy z prawdziwym API pominięte).
- Playwright (`playwright`, devDependency, oficjalny rejestr npm) + przeglądarka Chromium przez `npx playwright install chromium` – do skryptów person (wymóg z ORCHESTRATOR.md).
- Persony używają własnej instancji serwera z atrapą modelu AI (nie prawdziwego API) i osobnej bazy w katalogu tymczasowym – nie dotykają `data/`.
- Kierunek designu: rubryka wymaga stylu gov.pl / mObywatel. Projekt „Kompas” z Claude Design (papier, mosiądz, serif) NIE jest wdrażany – wybrano styl rządowy z rubryki.

## Znane problemy
- (uzupełniane w trakcie)

## Dziennik cykli
