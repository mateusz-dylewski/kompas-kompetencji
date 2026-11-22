# NOTES – nocna iteracja (pamięć orkiestratora)

## PRZERWANE – przekazanie (04:55)
Pętla zatrzymana na polecenie Janka w trakcie cyklu 3. Ostatni wykonany krok: commit 6b4525c (brief w 4 stałych sekcjach, 133/133 testów), potem commit WIP z niedokończonym front-endem.

**Gotowe (w commitach, testy zielone – 133/133):**
- Przygotowanie: ORCHESTRATOR.md, CLAUDE.md (z zasadami o API i limicie), role w .claude/agents/, Playwright + skrypty person (e2e/personas/run.mjs: krystyna, michal, ewa, juror, klawiatura, awaria; tryb PERSONA_AI=down|slow; kontrast, nazwy dostępne, skip link, interactiveMs).
- Cykl 1: /api/session (start bez 401), POST /api/ai/criteria (ścieżka a, walidacja + fallback regułowy), menu mobilne 4 + „Więcej”, h1 na telefonie, etykiety list wyboru.
- Cykl 2: design gov.pl/mObywatel (tokeny, Open Sans, karty 8 px, fokus), „Zaproponuj kryteria (AI)” w rozmowie rozpoczynającej, logowanie z wartością produktu (a/b/c), naprawa menu mobilnego poza ekranem, dane demo dla jury.
- Cykl 3 (częściowo): test pełnej ścieżki demo (test/demo-flow.test.mjs), brief w 4 stałych sekcjach bez Markdown.
- Wyniki rubryki: start 6,4 → cykl 1: 7,0 → cykl 2: 7,3. Persony (cykl 2): juror 6, Krystyna 5, klawiatura 6. Cyklu 3 nie oceniono.

**Niegotowe:**
- Commit WIP z front-endem cyklu 3 (app/app.js, app/app.css) – NIESPRAWDZONY (bez node --check, testów i person). Zakres w opisie commita: błąd JS na profilu pracownika, animacje wejścia, karta „Ocena w 3 krokach”, prosty język, aria-label z nazwiskiem, wylogowanie na telefonie, opis briefu, radar, okno rozmowy na telefonie.
- Nieocenione personami po cyklu 3: Michał i Ewa nie były uruchamiane jako persony haiku.
- `stash@0` (z cyklu 2, stara wersja app/app.css) pozostawiony na polecenie – jego treść jest już scalona.
- Faza 2 (podsumowanie dla Janka) nie wykonana w pełnej formie – ten wpis ją zastępuje.

## Czas
- WZNOWIENIE: 2026-11-22 06:51:39 · twardy koniec pętli 08:41:39 · podsumowanie do 08:51:39
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
| 3 | 07:05 | 7 | 8 | 9 | 9 | 7 | 7 | 8 | 6 | 7,6 | juror 5, Michał 6, Ewa 6, Krystyna 6, klawiatura 6 |
| 4 | 07:15 | 8 | 9 | 9 | 9 | 8 | 7 | 8 | 6 | 8,0 | juror 6, Michał 6, Ewa 6 |
| 5 | 07:27 | 9 | 9 | 9 | 9 | 8 | 7 | 8 | 7 | 8,3 | juror 7, Krystyna 6, klawiatura 7 |

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

### Cykl 3 (wznowienie 06:51–07:05)
- Naprawa commita WIP b97e900: uszkodzona zamiana wycięła fragment od strony startowej pracownika do początku mgrPage, a karta przełożonego trafiła do strony pracownika (ReferenceError `kickEmp` blokował logowanie). Plik odtworzony z 6b4525c + 41/42 poprawnych fragmentów WIP; karta „Ocena w 3 krokach” wstawiona do mgrPage. Commit d45f8b3.
- Błąd sprzed nocy: strona „Dziennik” nie rysowała `#logBody` (pokazywała listę ocen) – naprawione.
- Dowody: `npm test` 133/133; skrypty person: juror 9/9 desktop i mobile (wcześniej mobile 6/9), michal 8/8, krystyna 13/13, ewa 8/8, klawiatura 6/6; konsola 0, kontrast 0, skip link na każdym ekranie, żaden ekran > 2 s.
- Persony: juror 5 (brief: „(bez źródła)” i zdublowane fakty I41/I43 z seedu; AI w doborze kryteriów słabo widoczne; brief jako surowy tekst; sticky pasek kreatora zasłania treść; kryteria obowiązkowe wyglądają na wyłączone), Michał 6 (karta „Przygotuj się do rozmowy” niewidoczna bez oceny w przygotowaniu; na telefonie „Oceny” pod „Więcej”, ucięte tytuły przez znacznik AI, tabele ucięte; skala punktów bez opisu), Ewa 6 (dziennik – naprawione; brak domyślnego wyboru arkusza wymusza decyzję – teraz domyślnie C; przełączniki ustawień nieczytelne; powtórzone „Podgląd”), Krystyna 6 (żargon, skala 1–9 bez wskazówki, pole „Przykład z okresu” wypełnione tekstem demo z seedu, kreator otwiera inną osobę niż oczekiwała, JSON w briefie), klawiatura 6 (przyciski „Potwierdź” bez nazwy, fokus na main bez obrysu, tabela zespołu ucięta na telefonie).
- Retro: agent front-endu zatrzymany w trakcie zostawił uszkodzony plik – na przyszłość po każdym zadaniu front-endu od razu `node --check` + persona juror przed commitem (orkiestrator robi to sam, nie ufa raportowi).

### Cykl 4 (07:01–07:15)
- Zmiany: front-end według uwag person (karta „Przygotuj się do rozmowy” zawsze, menu mobilne z Ocenami, tabele jako karty < 640 px, wskazówka 5 pkt, brief w sekcjach ze „źródło”, JSON w details, arkusz bez domyślnego wyboru, aria-label w powtarzanych przyciskach, dziennik po polsku, radar ze skalą, ustawienia „Włączony/Wyłączony”); dane demo bez tekstu „demo” w przykładach i bez zdublowanych informacji; brief scala identyczne fakty; klawiatura przechodzi (a)(b)(c) wyłącznie klawiaturą; atrapa AI person cytuje prawdziwe id faktów.
- Dowody: `npm test` 135/135; wszystkie 5 person – komplet kroków desktop i mobile, konsola 0, kontrast 0, powtórzone nazwy 0, pułapki klawiaturowe 0, niewidoczny fokus 0; Tabów na ścieżkę (desktop) a=33, b=34, c=38.
- Persony: juror 6 (żółta ramka fokusu wokół całego main wygląda jak błąd; pasek kreatora zasłania ostatni wiersz; radar ucięty; plan rozwoju jako akapit; niespójna skala 0–9/1–9; logowanie na telefonie – formularz pod zgięciem; brak informacji o SSO), Michał 6 (Start na telefonie otwiera się przewinięty; odpowiedź AI jako tekst, nie lista; brak drogi od „Obszarów do rozwoju” do działania; kroki celu schowane), Ewa 6 (dwa progi K_MIN – oceny vs przełożeni – mylą; dziennik bez kolumn „przed/po”; brak odniesienia do rozporządzenia przy kryteriach obowiązkowych; „Arkusz” bez legendy).
- Następne (cykl 5): front-end – fokus na h1 zamiast ramki main, przewinięcie na górę, logowanie mobilne (formularz najpierw, notka o SSO), pasek kreatora, plan rozwoju jako lista, spójna skala 1–9, radar → lista na telefonie, odpowiedź AI w sekcjach, obszary rozwoju → działanie, kroki celu rozwinięte, legenda arkusza z podstawą prawną, dziennik z „przed/po”, opis progów K_MIN; qa – kroki oceny i złożenia w skryptach Ewy/Krystyny, zapoznanie u Michała.
- Retro: weryfikacja przez orkiestratora (node --check + 5 skryptów) przed commitem wyłapała by błąd WIP – działa. Persony haiku w 3. rundzie powtarzają część uwag już naprawionych (np. „5 pkt”) – w promptach person dodawać listę zmian z ostatniego cyklu.

### Cykl 5 (07:12–07:27)
- Zmiany: fokus na h1 zamiast ramki main, przewinięcie na górę, logowanie mobilne z formularzem najpierw i notką o SSO, „Terminy i sprawy” pogrupowane per osoba prostym językiem, plan rozwoju jako lista, spójna skala 1–9, radar z krótkimi etykietami (lista na telefonie), odpowiedzi AI w sekcjach, dziennik z „przed → po”, legenda arkusza z podstawą prawną; dane demo – informacje przy każdym wskaźniku szkiców (ocenę da się złożyć); skrypty: Krystyna składa ocenę, Ewa pobiera PDF, Michał potwierdza zapoznanie.
- Dowody: `npm test` 136/136; persony: komplet kroków desktop/mobile (krystyna 21/21 z submitOk, ewa 10/10 z pdfOk, michal 9/9 z ackOk, klawiatura 18/18), konsola 0, kontrast 0, powtórzone nazwy 0, pułapki 0.
- Uwaga orkiestratora: backend osłabił asercję dziennika w test/evidence.test.mjs – przywrócona pełna (odczyt pełnej wartości z bazy testowej).
- Persony: juror 7 (pola dat mm/dd/yyyy – natywne pole zależy od języka systemu; powtarzające się zdania w faktach demo; brak wyróżnienia spraw po terminie; radar drobny), Krystyna 6 (żargon prawny w oknie kryteriów; szkic demo z losowymi poziomami, np. „1 pkt” – wygląda jak zaniżona ocena; „Złóż ocenę” niewidoczne w stopce; XML w podsumowaniu; ankieta zasłania komunikat o złożeniu), klawiatura 7 (dużo Tabów do celu; etykieta „Ustal kryteria – …” bez nazwiska po zamknięciu okna; przewijanie w oknach bez wskazówki; ta sama ikona Asystenta i Ustawień).
- Następne (cykl 6): front-end – maska daty DD.MM.RRRR w oknach, wyróżnienie spraw po terminie, podstawa prawna w zwijanej sekcji, „Złóż ocenę” w stopce ostatniego kroku, XML do „Dla zaawansowanych”, komunikat sukcesu w oknie ankiety, ikona Ustawień, wskazówka przewijania w oknach, etykieta bez nazwiska; backend – szkice demo z realistycznymi poziomami wokół 5 pkt, różnorodne treści informacji.

