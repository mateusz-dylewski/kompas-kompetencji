# Projekt: moduł przełożonego

22 lis 2026 · projekt: Claude Opus · wdrożenie: Claude Sonnet (Claude Code)

Specyfikacja do wdrożenia briefu „Moduł przełożonego w Kompasie Kompetencji”. Opisuje stan obecny, decyzje i zmiany w kodzie (baza, API, UI, testy), podzielone na etapy. Każdy etap to osobny commit z testami.

## 0. Zasady, których wdrożenie nie może złamać

Obowiązują twarde zasady projektu (README, „Zasady projektowe”). Przy tym briefie szczególnie:

1. **AI tylko proponuje.** Brief i odpowiedzi asystenta niczego nie zapisują w ocenach, informacjach, feedbacku, check-inach ani celach. Nie podają poziomu, punktów ani wyniku dla osoby.
2. **Brak profilowania.** JSON „kto co robił” to wyciąg z wpisów zrobionych przez ludzi, nie wnioski modelu o osobie. Nie porównujemy pracowników między sobą.
3. **Bez średnich i prognoz** z danych miesięcznych i kwartalnych. Trendy pokazują postęp celów i zmianę między formalnymi ocenami okresowymi, nigdy linię z ocen kwartalnych ani „przewidywaną ocenę”.
4. **Prompty bez imion, nazwisk i e-maili:** wszystko przez `redactNames()` (`server.mjs`). Osoby inne niż pracownik występują tylko jako rola („współpracownik”, „odbiorca rezultatu”).
5. **Agregaty zespołu od K_MIN = 5.**
6. **Dziennik:** każda zmiana celów, kroków, planu rozwoju i informacji trafia do `audit()` z poprzednią i nową wartością.
7. **Bez nowych zależności.** RAG to wyszukiwanie w SQLite (filtr po osobie, okresie i kryterium), bez bazy wektorowej.

## 1. Decyzje (potwierdzone 22.11.2026)

| Temat | Decyzja |
|---|---|
| Kroki celów | Pracownik **zgłasza** wykonanie kroku, przełożony **potwierdza**. Postęp na kafelku liczy tylko potwierdzone kroki. |
| Nazwa „Dowody” | **„Informacje”** – tylko etykiety w UI i dokumentach PDF. API (`/api/evidence`), tabele i XML bez zmian. |
| Trendy | **Postęp celów między rozmowami** i **zmiana ocen cząstkowych między kolejnymi ocenami okresowymi**. Bez linii z ocen kwartalnych i bez prognozy. |
| Rola HR | **Później**, osobnym etapem. Teraz informacje i feedback zapisuje wyłącznie przełożony (tak już jest). |

## 2. Stan obecny a brief

| Punkt briefu | Stan w kodzie | Co zrobić |
|---|---|---|
| Przełożony widzi tylko swoich podopiecznych | Jest: `teamMember()`, `scopedWhere()`, `evaluator_id` w ocenach | Etap 2: test krzyżowy wszystkich tras z drugim przełożonym i zespołem |
| Cele wyznacza przełożony | Cele tworzy pracownik (`POST /api/goals`) | Etap 3 |
| Cele jako kafelki z postępem | Lista z paskiem segmentowym, postęp z kroków | Etap 3: siatka kafelków |
| Awans między spotkaniami / w 2 lata, trendy | Brak | Etap 5 |
| Plan rozwoju i komunikację pisze przełożony | Są tylko wnioski rozwojowe w ocenie (`data.dev`) | Etap 4 |
| Asystent rozwoju bez zmian | `POST /api/ai/development` | Bez zmian |
| Informacje i feedback – zadanie przełożonego | Zapis tylko przez przełożonego; pracownik ma podgląd | Bez zmian; rola HR później |
| „Dowody” → „Informacje” | Etykiety „Dowody”, „dowód” w UI (ok. 40 miejsc) i PDF szkicu | Etap 1 |
| Menu przełożonego | Start, Oceny, Miesiąc, Dowody, Zestawienie, Wyniki, Dziennik, Asystent AI, Ustawienia | Etap 1: tylko zmiana nazwy pozycji |
| Zestawienie bez średniej i sugestii | Jest (test `summary-ai.test.mjs` pilnuje kluczy) | Bez zmian |
| AI: brief do rozmowy + JSON „kto co robił” | Są pytania do rozmowy (`/api/ai/talk`, `/api/ai/checkin`), bez JSON | Etap 6 |
| AI pracownika: o co zapyta przełożony | Brak | Etap 7 |

## 3. Etapy wdrożenia

### Etap 1 – nazwa „Informacje”
- `app/app.js`: pozycja menu przełożonego `["evidence", "Informacje", …]`, pracownika `"Informacje i feedback"`. Wszystkie teksty: „dowód” → „informacja”, „dowody” → „informacje”, z poprawną odmianą („Nowa informacja”, „Brak informacji”, „Wstaw przykłady z informacji”, „Informacje z okresu oceny”).
- `lib/documents.mjs` (PDF szkicu): etykiety „Dowód” → „Informacja”. **XML bez zmian** (`<Dowod>` to kontrakt formatu `urn:kompas-kompetencji:szkic:v1`).
- README: jedno zdanie, że w UI to „Informacje”, a w API nadal `evidence`.
- Test: `grep` w teście nie jest potrzebny; wystarczy, że istniejące testy przechodzą (nie zależą od etykiet).

### Etap 2 – widoczność tylko własnego zespołu
- Nowy `test/visibility.test.mjs`: w bazie testowej dodać drugiego przełożonego z jednym pracownikiem (INSERT do `users`, hasło przez `/api/activate` albo hash z helpera). Dla **każdej** trasy z identyfikatorem osoby lub obiektu (`/api/evals/:id*`, `/api/evidence*`, `/api/checkins*`, `/api/feedback*`, `/api/partials*`, `/api/kickoffs*`, `/api/goals*`, `/api/summary`, `/api/month`, `/api/ai/*`, `/api/employees/:id/activation`, nowe trasy z etapów 3–7) sprawdzić, że drugi przełożony dostaje 403/404, a listy (`GET`) nie zawierają cudzych rekordów.
- Jeśli test wykryje wyciek – poprawić w tym samym etapie.
- Znane świadome zachowanie (opisać w README, nie zmieniać): oceny są widoczne dla **autora** (`evaluator_id`), więc po zmianie przełożonego stare oceny widzi dotychczasowy oceniający, a nowy przełożony ich nie widzi. Przekazanie ocen to osobny temat („zastępca / pośredni przełożony”).

### Etap 3 – cele wyznacza przełożony, kroki z potwierdzeniem, kafelki
**Baza (migracja automatyczna):**
- `goals.created_by INTEGER` (NULL = cel sprzed zmiany, utworzony przez pracownika).
- Krok w `goals.steps` (JSON): `{ t, reported_at, confirmed_at, confirmed_by }`. Migracja: kroki z `done: true` → `confirmed_at = reported_at = created` celu, `confirmed_by = null` (oznaczenie „migracja”); `done: false` → oba pola `null`.
- `progress` = potwierdzone / wszystkie × 100; `done` = wszystkie kroki potwierdzone. Cele bez kroków jak dotąd.

**API:**
- `POST /api/goals` – tylko przełożony, wymagane `employeeId` z zespołu (`teamMember`), reszta jak teraz (S/M/A/R, termin, 1–8 kroków). Pracownik → `403` „Cele wyznacza przełożony.” **Zmiana kontraktu** – opisać w README.
- `GET /api/goals` – pracownik: własne; przełożony: cele zespołu, filtr `?employeeId=`.
- `PATCH /api/goals/:id`:
  - pracownik (właściciel): `{ step, reported: true|false }` – zgłasza albo cofa zgłoszenie; nie może cofnąć kroku już potwierdzonego;
  - przełożony (cel osoby z zespołu): `{ step, confirmed: true|false }` – potwierdza (także bez zgłoszenia) albo cofa potwierdzenie; `{ addStep }`; edycja treści S/M/A/R i terminu;
  - każda zmiana → `audit(uid, 'goal_step_report' | 'goal_step_confirm' | 'update_goal', 'goal:<id>', prev, next)`.
- `GET /api/dashboard` (przełożony): `goalsToConfirm` – liczba zgłoszonych, niepotwierdzonych kroków na osobę; alert „Kroki celów do potwierdzenia”.

**UI:**
- Pracownik, „Cele”: siatka kafelków (`grid-template-columns: repeat(auto-fill, minmax(260px, 1fr))`). Kafelek: tytuł (S), termin DD.MM.RRRR, pierścień albo pasek segmentowy (potwierdzone pełne, zgłoszone kreskowane), „3 z 5 kroków potwierdzonych”, przycisk „Szczegóły” rozwijający kroki z przyciskiem „Zgłoś wykonanie” / „Cofnij zgłoszenie”. Bez przycisku „Nowy cel” (zamiast niego: „Cele ustala przełożony. Swoje propozycje zgłoś na rozmowie miesięcznej.”).
- Przełożony: kafelki celów pracownika na stronie **Miesiąc** (po wyborze osoby) i w oknie „Cele” z wiersza zespołu na Start. Tam: „Nowy cel” (obecny formularz z maską daty), potwierdzanie zgłoszonych kroków, dopisywanie kroków.
- „Cel z tego obszaru” w planie rozwoju pracownika zmienia się w „Zaproponuj na rozmowie” (bez tworzenia celu).

**Testy** (`test/goals.test.mjs`, przepisać): pracownik nie tworzy celu; przełożony tworzy tylko w zespole; zgłoszenie nie zmienia postępu, potwierdzenie zmienia; pracownik nie cofa potwierdzonego; obcy przełożony → 404; dziennik ma prev/new; migracja `done: true` → potwierdzone.

### Etap 4 – plan rozwoju i komunikat pisze przełożony
**Baza:** `dev_plans(id, employee_id, author_id, plan TEXT, message TEXT, created TEXT)` – każda zmiana to nowy wiersz (historia wersji), bieżący = najnowszy.

**API:**
- `GET /api/devplan?employeeId=` – przełożony (zespół) i pracownik (własny): bieżący plan i historia (data, autor jako rola).
- `PUT /api/devplan` – tylko przełożony, `{ employeeId, plan, message }`, `plan` 10–3000 znaków, `message` 0–1000; `audit(..., 'update_devplan', 'devplan:<emp>', prev, next)`.

**UI:**
- Przełożony: sekcja „Plan rozwoju i komunikat” w oknie „Cele” (etap 3) – dwa pola, przycisk „Zapisz”, informacja „Pracownik zobaczy to w swoim profilu”.
- Pracownik, „Mój profil” → „Plan rozwoju”: najpierw plan i komunikat od przełożonego (z datą), pod spodem wnioski z oceny (jak teraz). Asystent rozwoju bez zmian.

**Testy:** pracownik nie zapisuje planu; historia wersji; dziennik; obcy przełożony → 404.

### Etap 5 – trendy (bez średnich i prognoz)
**Między spotkaniami (cele):**
- `GET /api/goals/trend?employeeId=` – dla każdego celu: liczba potwierdzonych kroków narastająco na koniec każdego miesiąca od utworzenia celu (z `confirmed_at`), plus znaczniki miesięcy, w których odbył się check-in (`checkins.status='odbyty'`).
- UI: mały wykres schodkowy (SVG inline, bez bibliotek) na kafelku celu; oś X – miesiące, kropki – rozmowy miesięczne. Podpis: „Postęp: +2 kroki od ostatniej rozmowy”.

**Na przestrzeni dwóch lat (oceny okresowe):**
- `GET /api/evals/compare?employeeId=` – dwie ostatnie złożone oceny okresowe B/C (nie szkice). Dla każdej kompetencji obecnej w obu: punkty cząstkowe poprzednio i teraz oraz kierunek (`wzrost` / `bez zmian` / `spadek`). **Bez średniej, bez wyniku łącznego, bez prognozy.** Brak dwóch ocen → `{ available: false }`.
- UI: tabela „Zmiana między ocenami okresowymi” (kompetencja, poprzednio, teraz, strzałka). Przełożony: w Zestawieniu po wyborze osoby. Pracownik: w „Mój profil” (tylko własna).
- Test: klucze odpowiedzi bez `avg|mean|średn|predict|forecast|wynik` (jak w `summary-ai.test.mjs`); oceny kwartalne nie wchodzą do porównania.

### Etap 6 – AI przełożonego: brief do rozmowy + JSON „kto co robił”
`POST /api/ai/brief` `{ employeeId, from?, to? }` – tylko przełożony, osoba z zespołu; domyślny okres: od początku bieżącej oceny (lub rozmowy rozpoczynającej) do dziś.

1. **Wyszukiwanie (serwer, deterministycznie)** – informacje (`evidence`), feedback, check-iny, cele z krokami z okresu. Każdy fakt dostaje identyfikator (`I12`, `F3`, `C5`, `G2`).
2. **JSON „kto co robił”** budowany przez serwer, nie przez model, więc niczego nie zmyśla:
   ```json
   { "okres": { "od": "2026-01-01", "do": "2026-11-22" },
     "fakty": [ { "id": "I12", "rodzaj": "informacja", "data": "2026-03-04", "kryterium": "WSPÓŁPRACA",
                  "wskaznik": "…", "kto_zapisal": "przełożony", "zrodlo": "przełożony bezpośredni",
                  "sytuacja": "…", "dzialanie": "…", "rezultat": "…" } ],
     "pokrycie": [ { "kryterium": "KOMUNIKACJA", "fakty": 3, "miesiace": 2 } ],
     "braki": [ "RZETELNOŚĆ" ] }
   ```
   Pole „kto” to wyłącznie rola (przełożony, współpracownik, odbiorca rezultatu, pracownik – przy krokach celu). Bez imion i bez innych osób z zespołu.
3. **Brief od modelu** – do `llm()` trafia JSON po `redactNames()`. Prompt systemowy (z `RULES`):
   - sekcje: „Tematy do omówienia”, „Przykłady z okresu” (każde zdanie z odnośnikiem `[I12]`), „Pytania otwarte”, „Kryteria bez informacji”;
   - zakaz: poziomów, punktów, wyniku, oceniania osoby, wniosków spoza faktów.
4. **Kontrola po modelu:** usunąć odnośniki do nieistniejących identyfikatorów i oznaczyć zdania bez odnośnika jako „(bez źródła)”. Bez modelu – brief regułowy z samego JSON (tematy = kryteria z największą liczbą faktów, braki = kryteria bez faktów).
5. **Zapis:** tylko `ai_log` (wejście jako SHA-256). Odpowiedź: `{ brief, json, source }`.

**UI:** w kreatorze oceny (krok „Rozmowa”) i na stronie Miesiąc – przycisk „Przygotuj brief do rozmowy”, wynik w dwóch zakładkach: „Brief” (tekst z klikalnymi odnośnikami, które przewijają do faktu) i „Fakty (JSON)” (podgląd i „Pobierz JSON”).

**Testy:** JSON tylko z faktów tej osoby i okresu; brak imion i e-maili w prompcie (atrapa modelu jak w `summary-ai.test.mjs`); odnośnik do nieistniejącego `[I999]` usunięty; brak kluczy z wynikiem; nic się nie zapisuje poza `ai_log`; pracownik i obcy przełożony → 403/404.

### Etap 7 – AI pracownika: o co może zapytać przełożony
`POST /api/ai/prep` – tylko pracownik, własne dane.
- Wejście: kryteria bieżącej oceny lub rozmowy rozpoczynającej, pytania z bazy asystenta (`lib/asystent/baza-pytan.json`) dla tych kryteriów, własne cele i kroki. Informacje z okresu tylko wtedy, gdy włączony jest moduł `mod_employee_evidence`, i tylko jako liczby na kryterium.
- Wynik: „O co może zapytać przełożony” (pytania z bazy dopasowane do kryteriów), „Co warto przygotować” (np. przykłady sytuacji z własnych celów), „O co Ty możesz zapytać”. Bez poziomów i bez oceniania.
- Bez modelu: lista pytań z bazy dla kryteriów.
- UI: pracownik, Start (gdy jest przygotowywana ocena albo rozmowa rozpoczynająca) – karta „Przygotuj się do rozmowy” z przyciskiem.
- Testy: przełożony → 403; prompt bez imion; brak poziomów i punktów w odpowiedzi regułowej.

## 4. Kolejność i zakres commitów
1. Etap 1 (nazwa) – mały, bez ryzyka.
2. Etap 2 (test widoczności) – zabezpiecza kolejne etapy; nowe trasy z etapów 3–7 dopisywać do tego testu.
3. Etap 3 → 4 → 5 (cele, plan, trendy) – zależne od siebie.
4. Etap 6 → 7 (AI).

Po każdym etapie: `npm test` (wszystkie zielone), README (sekcja „Moduł przełożonego”, migracja, zmiany kontraktu API), osobny commit z opisem po polsku.

## 5. Poza zakresem
- Rola HR (kadry) – osobny etap: uprawnienia zapisu informacji i feedbacku dla jednostki, bez dostępu do ocen.
- Przekazanie ocen zastępcy lub pośredniemu przełożonemu.
- Arkusz A, dokument IPRZ.

## 6. Prompt dla Claude Sonnet (wdrożenie)

```text
Wdrażasz moduł przełożonego w repozytorium Kompas Kompetencji według specyfikacji docs/projekt-modul-przelozonego.md.
Przeczytaj ją w całości, potem README (twarde zasady) i odpowiednie fragmenty server.mjs, app/app.js i test/*.
Realizuj etapy po kolei (1→7). Po każdym etapie: npm test musi przejść w całości, zaktualizuj README,
zrób osobny commit z opisem po polsku. Nie łam zasad z sekcji 0 specyfikacji. Nie dodawaj zależności.
Nie zmieniaj API poza opisanymi zmianami kontraktu. Migracje mają działać na istniejącej bazie data/.
Jeśli coś w specyfikacji jest niejasne albo sprzeczne z kodem, zatrzymaj się i zapytaj, zamiast zgadywać.
Nie wypychaj na zdalne repozytorium bez prośby. Na koniec podaj raport: co zrobione w każdym etapie, wynik testów,
czego nie sprawdzono (np. wyglądu w przeglądarce).
```
