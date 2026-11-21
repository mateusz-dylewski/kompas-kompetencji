# Kompas Kompetencji – prototyp

Wsparcie przełożonego w pierwszej i okresowej ocenie pracownika służby cywilnej (model kompetencyjny, formularze, asystent rozmowy, plan rozwoju). Widok pracownika i przełożonego.

## Uruchomienie

Wymagania: Node.js 22.13+ (wbudowany `node:sqlite` bez flagi). Serwer nie ma zależności npm. Generator PDF używa `pdf-lib` i fontów z `package.json` (`npm install`).

```bash
npm install
node server.mjs
```

Otwórz http://localhost:8080.

Zmienne: `PORT` (domyślnie 8080), `KK_DATA_DIR` (katalog bazy i klucza podpisu, domyślnie `./data`).

## Testy

```bash
npm test
```

Testy używają wbudowanego `node:test`, bez dodatkowych zależności. `test/documents.test.mjs` sprawdza obliczenia oceny: skalę 1/3/5/7/9, średnią, przedziały z § 11 ust. 1 pkt 2, ocenę negatywną z § 11 ust. 4 i brak danych.

## Konta demonstracyjne

| Rola | E-mail | Hasło |
|---|---|---|
| Przełożony | przelozony@demo.kk | Demo-kompas-2026! |
| Pracownik | pracownik1@demo.kk … pracownik6@demo.kk | Demo-kompas-2026! |

Dane demo tworzą się przy pierwszym uruchomieniu (`data/kompas.db`). Aby zresetować: zatrzymaj serwer i usuń folder `data/`.
Hasła demo są tylko do testów lokalnych. Nie używaj ich nigdzie poza tym prototypem.

## AI (lokalny Qwen)

Asystent działa przez Ollama na `http://127.0.0.1:11434`. Dane nie opuszczają komputera.

```bash
ollama pull qwen2.5:14b          # lub inny model instruct Qwen dopasowany do sprzętu
KK_AI_MODEL=qwen2.5:14b node server.mjs
```

Jeśli Ollama nie działa, aplikacja przełącza się na tryb reguł. Oznacza to, że asystent podpowiada na podstawie samej oceny, bez modelu, i zawsze pokazuje źródło odpowiedzi.

Lokalnie masz model `orcarouter/Qwen3.8-27B-Uncensored:iq2_m`. Nie jest on domyślny: wersja „uncensored” z kwantyzacją iq2 nie nadaje się do narzędzia dla administracji publicznej. Do produkcji wybierz standardowy model instruct.

## Zasady projektowe (zgodność z prawem)

- **RODO:** minimalizacja danych. Prompt do modelu nie zawiera imion ani nazwisk, tylko kompetencje, poziomy i uzasadnienia. Imiona, nazwiska i e-maile wpisane w tekst są zastępowane znacznikiem `[osoba]`. Dziennik zdarzeń pozwala sprawdzić dostęp i zmiany.
- **Bez sugerowanego wyniku:** dane miesięczne i kwartalne pokazujemy jako zestawienie (liczby, daty, rozkład poziomów), bez średniej i bez „przewidywanej oceny”.
- **AI Act (UE 2024/1689):** wspieranie ocen pracowników w zatrudnieniu może zakwalifikować system jako wysokiego ryzyka (załącznik III). Dlatego AI tylko proponuje (pytania, przeformułowania, działania rozwojowe). Nie wystawia ocen, a decyzję zawsze podejmuje człowiek. Przed wdrożeniem wymagana jest analiza prawna.
- **Agregaty zespołu:** wyniki zbiorcze pokazywane dopiero od 5 złożonych ocen.
- **Dziennik zmian:** każda zmiana oceny, dowodu i feedbacku zapisuje autora, czas oraz poprzednią i nową wartość (`audit.prev_value`, `audit.new_value`, w łańcuchu skrótów SHA-256).
- **Brak profilowania i monitoringu:** system nie wnioskuje o osobowości, stanie psychicznym ani motywacji, nie przewiduje ścieżki rozwoju i nie zbiera danych o czasie pracy, obecności ani aktywności. Feedback dotyczy rezultatu zadania.
- **Ocena oparta na dowodach:** oceniany wskaźnik bez dowodu z okresu oceny wymaga jawnej adnotacji „brak podstaw do oceny”.
- **Dostępność:** cel WCAG 2.1 AA (dyrektywa (UE) 2019/882, ustawa o dostępności cyfrowej).
- **Przed wdrożeniem:** DPIA, umowa powierzenia (art. 28 RODO), polityka prywatności, uwierzytelnianie zgodne z wymogami resortu (np. profil zaufany / mObywatel jako IdP), audyt bezpieczeństwa.

## Styl graficzny

Kolory i zaokrąglenia są tokenami w `app/app.css` (`:root`). Publicznie dostępne materiały nie zawierają pełnej palety systemu designu Ministerstwa Cyfryzacji, więc prototyp używa ogólnego języka usług państwowych (granat, biel). Po otrzymaniu tokenów z systemu designu wystarczy podmienić wartości w `:root`.

## Struktura

- `server.mjs` – serwer HTTP, konta i sesje (scrypt, cookie HttpOnly), API, asystent AI, dziennik.
- `index.html`, `app/app.js`, `app/app.css` – interfejs (animacje, dashboardy, kreator oceny).
- `app/kompetencje.js` – model kompetencji (14 kompetencji, 49 wskaźników) z Arkusza/modelu.
- `data/kompas.db` – baza SQLite (tworzona automatycznie, nie commituj).

## Obliczenia oceny okresowej (Arkusz B i C)

- **Oceny cząstkowe** za każde kryterium przyznaje oceniający w skali 1/3/5/7/9 (pole `data.partials`). Poziomy wskaźników i przykłady są materiałem pomocniczym. System nie wylicza z nich oceny cząstkowej i nie podpowiada jej.
- **Średnia i poziom:** średnia arytmetyczna ocen cząstkowych oraz przedziały z § 11 ust. 1 pkt 2 (do 2 pkt włącznie: znacznie poniżej; >2–4: poniżej; >4–6: na poziomie; >6–8: powyżej; >8–9: znacznie powyżej).
- **Wynik jest wyliczany, a nie wpisywany:** ocena jest negatywna, gdy poziom ogólny to „poniżej” lub „znacznie poniżej oczekiwań”, a także gdy którakolwiek ocena cząstkowa to „znacznie poniżej oczekiwań” (§ 11 ust. 4). Przy złożeniu oceny wynik zapisuje się w `data.wynik` z `data.wynikSource = "wyliczony"`. Przy ocenie negatywnej uzasadnienie jest obowiązkowe.
- **Pierwsza ocena:** skala 3/5/7 i ręczny wybór wyniku zostają bez zmian. Są oznaczone jako **„do weryfikacji z przepisami z 2015 r.”**.

### Migracja danych: schemat oceny 2

Przy starcie serwer przenosi **szkice** ocen B/C bez pola `schema` do `schema: 2`: dodaje puste `partials` i usuwa ręcznie wpisany `wynik`. Oceniający musi wtedy przyznać oceny cząstkowe. Każdy taki szkic dostaje wpis `migrate_eval_schema2` w dzienniku. **Ocen złożonych nie zmieniamy**, bo ich treść jest podpisana skrótem. Ich oceny cząstkowe pozostają średnimi wskaźników, a wynik to ten wpisany przez oceniającego (`wynikSource: reczny_sprzed_migracji`).

## Dowody (ekran „Dowody”)

Dowód to jedna obserwacja przy jednym wskaźniku z `app/kompetencje.js` (klucz `KOMPETENCJA|nr`, ten sam co w ocenie). Składa się z daty, opisu sytuacji, działania i rezultatu, opcjonalnego linku do artefaktu (http/https) i ID zadania. Na tym etapie (MVP) dowody dodaje i edytuje przełożony. Pracownik widzi swoje dowody tylko do odczytu.

| Metoda | Ścieżka | Opis |
|---|---|---|
| GET | `/api/evidence?employeeId=&indicator=&competency=&from=&to=&month=` | Lista z filtrami. Przełożony widzi swój zespół, pracownik tylko siebie. |
| POST | `/api/evidence` | Dodanie dowodu (tylko przełożony, tylko dla swojego zespołu) |
| PUT | `/api/evidence/:id` | Edycja dowodu (tylko pola przesłane w żądaniu) |

Kody błędów: `400` nieprawidłowe dane (`fields`: pole → komunikat, także nieznane pola), `403` brak uprawnień, `404` brak zasobu lub osoba spoza zespołu, `409` konflikt stanu, `422` ocena niekompletna. Dodanie i edycja dowodu trafiają do dziennika z poprzednią i nową wartością.

**Walidacja przed złożeniem oceny okresowej:** każdy oceniany wskaźnik potrzebuje co najmniej jednego dowodu z okresu oceny albo jawnej adnotacji „brak podstaw do oceny”. W kreatorze przy każdym wskaźniku widać dowody z okresu i przycisk „+ Dowód”.

## Rytm miesięczny, feedback i oceny cząstkowe kwartalne

**Ekran „Miesiąc” (przełożony):** wybierasz pracownika i miesiąc. Widzisz:

- **Check-in** (tabela `checkins`, jeden na osobę i miesiąc): trzy pola (co zrobiono, co wymaga uwagi, jeden cel), data i status (`planowany` / `odbyty`). Rozmowa ma trwać do 20 minut. Formularz nie ma punktacji, a pola typu `level`/`ocena` serwer odrzuca. Odbyty check-in wymaga daty i trzech pól.
- **Dowody z miesiąca według wskaźników.** Wskaźniki bez nowych dowodów w miesiącu są ukryte, żeby nie generować pustych ocen.
- **Feedback** (tabela `feedback`): wskaźnik, źródło zdarzenia (zadanie, sprawa, artefakt), opcjonalny poziom 1/3/5/7/9, wymagane uzasadnienie, autor i relacja autora do rezultatu. Feedback dotyczy rezultatu zadania, a nie osoby. Serwer odrzuca pola o czasie pracy, obecności i aktywności (np. `czasPracy`, `obecnosc`, `aktywnosc`, `hours`, `attendance`).
- **Oceny cząstkowe kwartalne** (tabela `partial_ratings`): przypisane do kwartału (`RRRR-Qn`), a nie do miesiąca. Przyznaje je oceniający w skali 1/3/5/7/9, z uzasadnieniem i co najmniej jednym dowodem tej osoby z danego kryterium i kwartału. W kreatorze oceny okresowej widać je jako listę przy ocenie cząstkowej kryterium, bez średniej.

**Widok pracownika „Dowody i feedback”:** pracownik widzi swoje dowody, feedback, check-iny i kwartalne oceny cząstkowe (tylko do odczytu).

| Metoda | Ścieżka | Opis |
|---|---|---|
| GET/POST | `/api/checkins`, PUT `/api/checkins/:id` | Check-iny (`employeeId`, `month`) |
| GET | `/api/month?employeeId=&month=` | Przegląd miesiąca: check-in, dowody według wskaźników, feedback |
| GET/POST | `/api/feedback`, PUT `/api/feedback/:id` | Feedback (edytuje autor) |
| GET/POST | `/api/partials`, PUT `/api/partials/:id` | Oceny cząstkowe kwartalne |

Każde utworzenie i każda zmiana trafiają do dziennika z poprzednią i nową wartością.

## Zestawienia zamiast wyników (ekran „Zestawienie”)

`GET /api/summary?employeeId=&from=&to=` (domyślnie ostatnie 12 miesięcy) pokazuje fakty dla każdego wskaźnika: liczbę dowodów, daty pierwszego i ostatniego, liczbę odbytych check-inów z dowodami i liczbę feedbacku z rozkładem poziomów. Do tego rozkład poziomów z kwartalnych ocen cząstkowych dla każdego kryterium oraz listę check-inów. **Bez średniej miesięcznej i bez sugerowanego wyniku**, a test sprawdza, że w odpowiedzi nie ma takich pól. Zestawienia zespołowe (ekran „Wyniki”) działają jak dotąd: od `K_MIN` = 5 złożonych ocen.

**Asystent AI** (`/api/ai/talk`, `/api/ai/formal`, `/api/ai/development`, nowy `/api/ai/checkin`) przeformułowuje teksty i proponuje pytania do rozmowy. Nie zmienia i nie zapisuje ocen, dowodów ani check-inów. Testy porównują stan danych przed i po wywołaniach. `/api/ai/checkin` wysyła do modelu tylko nazwy wskaźników i liczby dowodów. Przed każdym wywołaniem modelu serwer zastępuje znacznikiem `[osoba]` imiona, nazwiska (z odmianą) i adresy e-mail wszystkich kont, także te wpisane ręcznie w uzasadnienia. Test przechwytuje prompty atrapą Ollama.

## Proces i dokumenty: szkic z dowodów, terminy

- **Szkic z dowodów i check-inów:** w ostatnim kroku kreatora („Podsumowanie”) są przyciski „Podgląd szkicu PDF” i „Szkic XML” (`GET /api/evals/:id/document?variant=szkic&format=pdf|xml`). Szkic zawiera dowody, feedback i check-iny z okresu oceny, pogrupowane według kryteriów i wskaźników. **Nie zawiera poziomów, ocen cząstkowych ani wyniku**: oceniający uzupełnia je w kreatorze i zatwierdza ocenę, składając ją. Przycisk „Wstaw przykłady z dowodów” wypełnia tylko puste pola „Przykład z okresu” i nie ustawia poziomów. Format XML szkicu: `urn:kompas-kompetencji:szkic:v1` (własny).
- **Terminy** (`lib/cycle.mjs`, `GET /api/model` → `cycle`): cykl ocen okresowych 24 miesiące (`CYCLE_MONTHS`) i reguła 6 miesięcy między ocenami (`MIN_GAP_MONTHS`) zgodnie z poradnikiem (art. 81 ust. 8 ustawy, **do weryfikacji prawnej**). Datą odniesienia jest termin sporządzenia oceny, a gdy go brak, koniec okresu. Utworzenie lub złożenie zbyt wczesnej oceny B/C zwraca `409` z `code: "too_early"` i najwcześniejszym terminem. Wyjątek wymaga uzasadnienia (pole `exception.reason` przy tworzeniu albo `POST /api/evals/:id/early-exception`). Zapisuje się w kolumnie `evals.early_exception` i w dzienniku (`eval_early_exception`). Dashboard przełożonego pokazuje termin kolejnej oceny.
- **§ 6 – wgląd pracownika:** na ekranie startowym pracownik widzi kryteria i termin sporządzenia przygotowywanej oceny jeszcze przed jej złożeniem, bez poziomów.

## Ograniczenia prototypu

- Brak HTTPS i rotacji sesji; sesje w pamięci serwera.
- Brak rejestracji kont przez system zewnętrzny; konta zakłada przełożony.
- Limit kryteriów dodatkowych (3) do potwierdzenia z rozporządzeniem.
- Mapowanie poziomów pierwszej oceny (3/5/7 pkt) na opisy modelu wymaga weryfikacji z Arkuszem A. Skala 3/5/7 jest oznaczona w kodzie jako „do weryfikacji z przepisami z 2015 r.”.

## Dokumenty: arkusze PDF i XML

Po wypełnieniu oceny (krok „Rozmowa i wynik”) można pobrać lub podejrzeć:

- **PDF:** układ odtwarza oficjalne wzory z pakietu wyzwania (Arkusz pierwszej oceny, Arkusz B, Arkusz C). Struktura bloków i tabel jest w `lib/templates/*.json`, wyekstrahowana z plików .docx. Renderer: `lib/forms.mjs`.
- **XML:** własny schemat `urn:kompas-kompetencji:arkusz:v1`. Oficjalnego XSD nie znaleziono, więc format trzeba uzgodnić z zamawiającym.

Dane do dokumentu: kryteria obowiązkowe (B i C mają różne listy), dodatkowe (maks. 3), oceny cząstkowe i średnia, poziom wg przedziałów z rozporządzenia, wynik pozytywny/negatywny, uzasadnienie, wnioski rozwojowe.

Wymagane zależności (instalacja jednorazowa):

```bash
npm install
```

Nazwa urzędu w nagłówku: ustaw zmienną `KK_UNIT`, np. `KK_UNIT="Ministerstwo Cyfryzacji" node server.mjs`. Bez niej dokument używa nazwy działu przełożonego.

Ograniczenia: arkusz pierwszej oceny nie zawiera jeszcze daty nawiązania stosunku pracy ani rozmowy wstępnej. Ustalenia poziomów dla pierwszej oceny (3/5/7 pkt) wymagają weryfikacji z przepisami 2015.

## Zgodność, dostępność, AI Act (stan prototypu)

- Macierz wymagań: [docs/zgodnosc-regulacje.md](docs/zgodnosc-regulacje.md). Ocena ryzyka AI: [docs/ai-act-ocena-ryzyka.md](docs/ai-act-ocena-ryzyka.md). Szkic DPIA: [docs/dpia-szkic.md](docs/dpia-szkic.md). Deklaracja dostępności (szkic): [docs/deklaracja-dostepnosci.md](docs/deklaracja-dostepnosci.md).
- **Podpis (mock):** przełożony podpisuje złożoną ocenę, pracownik rejestruje zapoznanie. Podpis to SHA-256 treści oceny i HMAC z kluczem w `data/sign.key` (nie w repo). Weryfikacja w API i w PDF/XML. Nie jest to podpis kwalifikowany.
- **Sprzeciw:** pracownik może złożyć sprzeciw w 7 dni od zapoznania (art. 83 ust. 1). Po terminie serwer go odrzuca. Przełożony widzi alert.
- **Dziennik:** każdy wpis ma skrót SHA-256 poprzedniego. Widok dziennika pokazuje, czy łańcuch jest zgodny.
- **AI:** każda podpowiedź jest zapisana w tabeli `ai_log` (skrót wejścia, treść wyjścia, źródło). Podpowiedzi nie zmieniają ocen.
