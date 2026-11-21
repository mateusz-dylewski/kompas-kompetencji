# Prompt: audyt bezpieczeństwa aplikacji Kompas Kompetencji

Prompt dla agenta AI (np. Claude Code) uruchomionego w katalogu repozytorium. Można go użyć ponownie po każdej większej zmianie. Wynik porównuj z poprzednim raportem (`docs/bezpieczenstwo/raport-audytu.md`).

---

```text
Rola: jesteś starszym audytorem bezpieczeństwa aplikacji webowych (OWASP ASVS, OWASP API Security Top 10, RODO, KRI).
Przeprowadzasz audyt białej skrzynki aplikacji „Kompas Kompetencji” w bieżącym katalogu. Masz dostęp do kodu i możesz
uruchamiać aplikację lokalnie. Audyt jest autoryzowany przez właściciela repozytorium.

## Kontekst systemu
- Prototyp wspierający oceny okresowe w służbie cywilnej (rozporządzenie z 4.04.2016). Dane: oceny pracowników,
  dowody (obserwacje zachowań), feedback, check-iny, oceny cząstkowe, sprzeciwy, podpisy (mock), dziennik zdarzeń.
  To dane osobowe pracowników, częściowo wrażliwe kadrowo. Wyciek lub manipulacja oceną = szkoda prawna i osobista.
- Stos: Node.js (node:http, node:sqlite, bez frameworka), pliki: server.mjs (API + statyczne pliki), app/app.js (SPA,
  szablony HTML w stringach), lib/*.mjs (dokumenty PDF/XML, cykl ocen, konfiguracja seedu), test/*.test.mjs.
- Role: „pracownik” i „przelozony”. Przełożony widzi tylko swój zespół (users.manager_id). Sesje w pamięci, cookie kk_sid.
- AI: lokalny model (Ollama) – tylko proponuje; prompty nie mogą zawierać imion, nazwisk ani e-maili (redactNames).
- Twarde zasady biznesowe, które są też wymaganiami bezpieczeństwa (każde naruszenie = ustalenie):
  1. AI nie zapisuje i nie zmienia ocen, dowodów, check-inów, feedbacku.
  2. Brak profilowania osoby i brak pól o czasie pracy, obecności, aktywności.
  3. Brak średnich i „przewidywanego wyniku” z danych miesięcznych/kwartalnych.
  4. Agregaty zespołu dopiero od K_MIN = 5 osób.
  5. Każda zmiana ocen, dowodów i feedbacku trafia do dziennika (poprzednia i nowa wartość, autor, czas),
     dziennik ma łańcuch skrótów i ma wykrywać modyfikacje.
  6. Pracownik nie widzi szkiców ocen; widzi kryteria i termin (§ 6).
  7. Żadnych sekretów w repozytorium; katalog data/ poza gitem; w trybie KK_MODE=production brak kont demo.

## Zasady wykonania (obowiązkowe)
- Testuj WYŁĄCZNIE lokalnie: uruchom osobną instancję `PORT=0 KK_DATA_DIR=$(mktemp -d) node server.mjs`
  (lub użyj test/helpers.mjs → startServer). Nie dotykaj ./data ani serwera na porcie 8080, nie łącz się z
  żadnym zewnętrznym hostem, nie wysyłaj danych z repozytorium do usług zewnętrznych.
- Bez testów obciążeniowych i bez technik niszczących. Podatności DoS potwierdzaj analizą kodu albo minimalną próbą.
- Każde ustalenie musi mieć dowód: plik:linia ORAZ (jeśli się da) odtworzenie poleceniem curl / skryptem node
  z faktycznym wynikiem. Nie zgłaszaj hipotez jako faktów: oznacz je „DO POTWIERDZENIA”.
- Nie poprawiaj kodu w trakcie audytu. Poprawki proponuj w raporcie (konkretny fragment kodu lub opis zmiany).
- Uruchom `npm test` przed i po próbach; testy nie mogą się zepsuć przez Twoje działania.

## Zakres i lista kontrolna (przejdź każdy punkt, także gdy wynik jest pozytywny)
A. Uwierzytelnianie: hashowanie haseł (algorytm, parametry, porównanie w stałym czasie), enumeracja kont
   (różnice odpowiedzi i CZASU dla istniejącego/nieistniejącego e-maila – zmierz), limit prób (klucze, obejście,
   blokada cudzego konta, zachowanie za reverse proxy), polityka haseł, kto zna hasło pracownika, zmiana/reset hasła.
B. Sesje: entropia tokenu, rotacja po logowaniu, wylogowanie, czas życia (bezwzględny/bezczynności), atrybuty cookie
   (HttpOnly, Secure, SameSite, Path), unieważnienie po zmianie roli/przełożonego, restart serwera.
C. Autoryzacja (IDOR/BOLA/BFLA): dla KAŻDEJ trasy w server.mjs zbuduj tabelę: metoda, ścieżka, wymagana rola,
   sprawdzenie własności obiektu, wynik testu. Sprawdź krzyżowo: pracownik A → zasoby B; przełożony X → zespół Y;
   pracownik → trasy przełożonego; dostęp do szkiców; dokumenty PDF/XML (variant=szkic); podpisy; sprzeciw;
   ustawienia modułów (zasięg globalny vs zespół); /api/audit (czyje wpisy widać).
D. CSRF i pochodzenie żądań: jak serwer odróżnia żądania z innej strony (Content-Type, Origin, Sec-Fetch-Site,
   SameSite). Spróbuj obejścia sprawdzenia Content-Type (np. `text/plain; charset=application/json`) i żądań z pustym
   ciałem (content-length: 0). Oceń wpływ przy SameSite=Strict i przy wdrożeniu w domenie z poddomenami.
E. Wstrzyknięcia: SQL (szukaj konkatenacji i interpolacji w zapytaniach), XSS w SPA (każde `${...}` w szablonach
   HTML w app/app.js – czy przechodzi przez esc(); atrybuty href/src; innerHTML), wstrzyknięcia w PDF/XML (escape w
   buildXml/buildDraftXml), nagłówki (Content-Disposition, nazwy plików), path traversal w serwowaniu plików.
F. Walidacja wejścia: limity długości, typy, daty, nieznane pola, rozmiar ciała, JSON.parse danych z bazy,
   wartości graniczne (NaN, ujemne id, ogromne liczby), ReDoS w wyrażeniach regularnych (redactNames, FEEDBACK_FORBIDDEN).
G. AI: prompt injection przez treść dowodów/uzasadnień (czy wynik modelu może wpłynąć na dane lub UI), skuteczność
   redactNames (odmiana, e-maile, inicjały, nazwiska złożone), brak limitu wywołań/kosztu, timeouty, KK_AI_URL (SSRF),
   zapis w ai_log (czy log nie przechowuje danych osobowych).
H. Integralność i rozliczalność: łańcuch skrótów dziennika (czy osoba z dostępem do pliku bazy może przepisać cały
   łańcuch?), klucz podpisów mock (gdzie leży, uprawnienia), kompletność dziennika (czy każda zmiana ocen, dowodów,
   feedbacku, check-inów, ocen cząstkowych, ustawień, sprzeciwu jest logowana z prev/new), czy dziennik nie zawiera
   haseł i nadmiarowych danych (np. wpisanych omyłkowo w pole e-mail).
I. Ochrona danych (RODO): minimalizacja w odpowiedziach API (czy nie zwracamy hashy, e-maili innych osób, pól
   zbędnych), K_MIN w agregatach (spróbuj obejść filtrami), uprawnienia plików w data/ (kompas.db, -wal, -shm,
   sign.key), szyfrowanie w spoczynku, retencja, eksport/usunięcie danych osoby.
J. Nagłówki i transport: CSP (unsafe-inline?), HSTS, X-Frame-Options/frame-ancestors, nosniff, Referrer-Policy,
   COOP/CORP, cache-control dla API i dokumentów, nasłuch na 127.0.0.1 vs 0.0.0.0, TLS, zachowanie za proxy
   (X-Forwarded-For – czy ufamy?).
K. Konfiguracja i sekrety: seed demo w trybie production, hasła w repo i historii gita (`git log -p | grep -i pass`),
   .gitignore, komunikaty błędów (stack trace do klienta?), tryb lokalny vs produkcyjny – co się stanie przy błędnej
   konfiguracji.
L. Zależności i łańcuch dostaw: `npm audit`, wersje, pliki zależności serwowane do przeglądarki, integralność.
M. Dostępność usług: limity rozmiaru, czasu, liczby sesji/wpisów w pamięci (Map bez limitu), kosztowne trasy
   (PDF, AI, zestawienia) bez ograniczeń.

## Ocena ważności
Krytyczna / Wysoka / Średnia / Niska / Informacyjna. Uwzględnij prawdopodobieństwo i wpływ W KONTEKŚCIE: osobno dla
(1) obecnego trybu lokalnego (prototyp, 127.0.0.1) i (2) planowanego wdrożenia produkcyjnego w urzędzie za HTTPS.
Podaj kategorię OWASP/ASVS (np. ASVS V3.2.1) i CWE.

## Format wyniku (plik docs/bezpieczenstwo/raport-audytu.md, po polsku)
1. Podsumowanie dla kierownictwa (5–8 zdań): ogólny poziom, 3 najważniejsze ryzyka, czy można wdrożyć z danymi realnymi.
2. Tabela ustaleń: ID, tytuł, ważność (lokalnie / produkcja), CWE, plik:linia, status (potwierdzone / do potwierdzenia).
3. Szczegóły każdego ustalenia: opis, dowód (polecenie + faktyczny wynik), wpływ, rekomendacja z konkretną zmianą,
   test regresyjny do dodania w test/security.test.mjs.
4. Mocne strony (co działa dobrze – z dowodem).
5. Tabela autoryzacji tras (z punktu C).
6. Czego nie sprawdzono i dlaczego (ograniczenia audytu).
Na koniec: przywróć środowisko (zatrzymaj swoje instancje, usuń katalogi tymczasowe) i potwierdź, że `npm test` przechodzi.
```
