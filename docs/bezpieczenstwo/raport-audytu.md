# Raport z audytu bezpieczeństwa – Kompas Kompetencji

- Data: 2026-11-21
- Wersja kodu: `main` @ `7653c7f`
- Metoda: przegląd białej skrzynki (`server.mjs`, `app/app.js`, `lib/*`) oraz próby na lokalnej instancji (127.0.0.1, osobny katalog danych). Lista kontrolna według [prompt-audytu.md](prompt-audytu.md) (OWASP ASVS 4.0 L2, OWASP API Top 10).
- Ograniczenia: bez testów obciążeniowych, bez skanerów automatycznych i bez testów infrastruktury produkcyjnej (jeszcze nie istnieje). Wdrożenie za reverse proxy oceniono tylko na podstawie analizy kodu.

## 1. Podsumowanie

Jak na prototyp, aplikacja jest zabezpieczona solidnie:
- zapytania SQL są w pełni parametryzowane;
- wszystkie dane w szablonach HTML przechodzą przez `esc()`;
- każda trasa konsekwentnie sprawdza właściciela obiektu;
- hasła są hashowane przez scrypt z porównaniem w stałym czasie;
- cookie ma flagi HttpOnly i SameSite=Strict, a sesja jest rotowana po zalogowaniu;
- CSP nie pozwala na skrypty inline;
- `npm audit` zgłasza 0 podatności.

Nie znalazłem błędu, który pozwalałby obcej osobie odczytać lub zmienić cudzą ocenę.

Trzy najważniejsze ryzyka przed wdrożeniem z prawdziwymi danymi:
1. **Kto zna hasło pracownika.** Przełożony nadaje je przy zakładaniu konta, więc może zalogować się jako pracownik i „zapoznać się” z oceną albo wycofać sprzeciw w jego imieniu. To podważa rozliczalność procedury z art. 83.
2. **Logowanie można nadużyć.** Konta da się wyliczyć po czasie odpowiedzi (35 ms dla istniejącego konta, 1 ms dla nieistniejącego). Każde konto da się też zablokować pięcioma złymi hasłami. Za reverse proxy blokada po adresie IP objęłaby wszystkich użytkowników naraz.
3. **Integralność danych w spoczynku.** Baza i klucz podpisów leżą obok siebie, a pliki bazy można odczytać (uprawnienia 644). Łańcuch skrótów dziennika nie ma sekretu, więc ktoś z dostępem do pliku przeliczy go od nowa po zmianie wpisów.

**Werdykt:** w trybie lokalnym na danych fikcyjnych ryzyko jest akceptowalne. Przed użyciem z danymi realnymi trzeba wykonać etap P0 z [plan-zabezpieczen.md](plan-zabezpieczen.md).

## 2. Tabela ustaleń

| ID | Tytuł | Lokalnie | Produkcja | CWE | Miejsce | Status |
|---|---|---|---|---|---|---|
| S-01 | Przełożony zna hasło pracownika (zapoznanie i sprzeciw w imieniu pracownika) | Niska | **Wysoka** | CWE-287, CWE-308 | `server.mjs:578-590` | potwierdzone (kod) |
| S-02 | Enumeracja kont po czasie odpowiedzi logowania | Niska | **Średnia** | CWE-208 | `server.mjs:466` | potwierdzone (pomiar) |
| S-03 | Blokada cudzego konta i całego biura przez limit prób | Niska | **Wysoka** | CWE-645, CWE-400 | `server.mjs:448-472` | potwierdzone (próba) |
| S-04 | Słaba ochrona CSRF: obejście sprawdzenia Content-Type, brak kontroli Origin | Niska | Średnia | CWE-352 | `server.mjs:1301-1304` | potwierdzone (próba) |
| S-05 | Dziennik zdarzeń bez sekretu: można przepisać cały łańcuch | Niska | Średnia | CWE-354 | `server.mjs:128-138` | potwierdzone (kod) |
| S-06 | Baza danych czytelna dla innych użytkowników systemu, bez szyfrowania; klucz podpisów obok bazy | Niska | Średnia | CWE-732, CWE-311 | `server.mjs:30-32, 87-89` | potwierdzone (`ls -la data/`) |
| S-07 | Ustawienia modułów są globalne: każdy przełożony zmienia je wszystkim | Informacyjna | Średnia | CWE-285 | `server.mjs:492-501` | potwierdzone (kod) |
| S-08 | Brak limitu wywołań AI i generowania PDF | Niska | Średnia | CWE-770 | `server.mjs:1122-1200, 641` | potwierdzone (kod) |
| S-09 | Bezpieczeństwo transportu zależy od jednej zmiennej `KK_MODE` | Informacyjna | Średnia | CWE-319, CWE-614 | `server.mjs:24, 455, 1290` | potwierdzone (kod) |
| S-10 | Sesje: brak limitu bezczynności, unieważnienia po zmianie roli i przełożonego, „wyloguj wszędzie” | Niska | Niska | CWE-613 | `server.mjs:243-251` | potwierdzone (kod) |
| S-11 | Dziennik zapisuje surową wartość pola e-mail przy nieudanym logowaniu | Niska | Niska | CWE-532 | `server.mjs:469` | potwierdzone (kod) |
| S-12 | Brak zmiany i resetu hasła; minimalna polityka haseł | Niska | Niska | CWE-521, CWE-620 | – | potwierdzone (kod) |
| S-13 | CSP: `style-src 'unsafe-inline'` | Informacyjna | Niska | CWE-1021 | `server.mjs:1286` | potwierdzone |
| S-14 | `ownEval()` nie sprawdza właściciela; autoryzacja zależy od każdego wywołującego | Informacyjna | Niska | CWE-639 | `server.mjs:626` | ryzyko utrzymaniowe |
| S-15 | Struktury w pamięci (sesje, nieudane logowania) bez górnego limitu | Informacyjna | Niska | CWE-770 | `server.mjs:243, 448` | potwierdzone (kod) |
| S-16 | Prompt injection przez treść dowodów i uzasadnień do modelu AI | Informacyjna | Niska | CWE-1427 | `server.mjs:389-400` | do potwierdzenia |

## 3. Szczegóły ustaleń

### S-01. Przełożony zna hasło pracownika
**Opis.** Konto pracownika zakłada przełożony (`POST /api/employees`) i to on podaje hasło. Nie ma zmiany hasła ani wymuszenia jej przy pierwszym logowaniu. Przełożony może więc zalogować się jako pracownik i:
- zarejestrować zapoznanie z oceną (`/acknowledge`), co uruchamia 7-dniowy termin na sprzeciw;
- „podpisać” zapoznanie (podpis mock);
- odczytać cele i dane pracownika.

**Wpływ.** Podważa rozliczalność procedury z art. 83 (zapoznanie i sprzeciw) oraz sens podpisu. To główne ryzyko prawne.

**Rekomendacja.**
- Konto zakładać bez hasła i z jednorazowym linkiem aktywacyjnym (token ważny 24 h, w bazie tylko jego hash) albo przez SSO urzędu (OIDC/SAML).
- Do czasu wdrożenia SSO wymuszać zmianę hasła przy pierwszym logowaniu (`must_change_password`).
- Zapoznanie i sprzeciw wiązać z silnym uwierzytelnieniem (docelowo podpis zaufany lub kwalifikowany, co już przewiduje `SIG_NOTE`).

**Test regresyjny.** Konto utworzone przez przełożonego nie może wykonać `/acknowledge`, dopóki nie zmieni hasła.

### S-02. Enumeracja kont po czasie odpowiedzi
**Dowód** (lokalnie, `/api/login` ze złym hasłem):
```
pracownik3@demo.kk   0.035 s  0.035 s  0.035 s
nieistnieje@demo.kk  0.001 s  0.001 s  0.001 s
```
**Przyczyna.** `if (!u || !checkPass(...))`: gdy konto nie istnieje, scrypt w ogóle się nie wykonuje. Treść odpowiedzi jest wprawdzie identyczna, ale czas zdradza istnienie konta.

**Rekomendacja.** Gdy konta brak, liczyć scrypt na stałym, fałszywym hashu:
```js
const DUMMY = hashPass(crypto.randomBytes(16).toString('hex'));
const ok = checkPass(String(b.password || ''), u ? u.pass : DUMMY);
if (!u || !ok) { ... }
```
**Test.** Mediana czasu dla obu przypadków różni się o mniej niż 50% (10 prób).

### S-03. Blokada cudzego konta i całego biura
**Dowód.** 5 złych haseł dla `pracownik4@demo.kk` z jednej sesji. Potem nowa sesja z poprawnym hasłem dostaje `429`, czyli prawowity użytkownik jest zablokowany na 10 minut. Podczas tego audytu blokada objęła też adres 127.0.0.1, więc lokalny serwer trzeba było zrestartować.

**Przyczyna.** Są dwa klucze limitu:
- `email:` – każdy może zablokować dowolne konto, znając tylko e-mail (a e-maile da się wyliczyć, S-02);
- `ip:` z `req.socket.remoteAddress` – za reverse proxy wszyscy mają ten sam adres, więc 5 pomyłek blokuje cały urząd.

**Rekomendacja.**
- Zamiast twardej blokady konta stosować rosnące opóźnienie (np. 1 s, 2 s, 4 s…) albo CAPTCHA po N próbach.
- Twardą blokadę zostawić tylko dla pary `ip+email` i dla bardzo dużej liczby prób z jednego IP (np. 50 na 10 min).
- Adres klienta brać z `X-Forwarded-For` tylko wtedy, gdy połączenie przychodzi z zaufanego proxy (`KK_TRUSTED_PROXY`).
- Po zalogowaniu informować użytkownika o nieudanych próbach.

**Test.** 5 złych prób z IP A nie blokuje logowania tego samego konta z IP B.

### S-04. Słaba ochrona CSRF
**Dowód.** Zalogowana sesja z obcym nagłówkiem `Origin`:
```
PUT /api/settings  content-type: text/plain; charset=application/json  Origin: https://evil.example  → 200 {"ok":true}
POST /api/logout   content-length: 0, bez content-type                   Origin: https://evil.example  → 200
```
**Przyczyna.** Warunek `content-type.includes('application/json')` przepuszcza typ `text/plain`, który przeglądarka wyśle cross-site bez preflightu. Puste POST-y (`/submit`, `/sign`, `/acknowledge`, `/logout`) w ogóle omijają kontrolę.

**Dlaczego to jeszcze nie jest atak.** Przeglądarka nie dołączy cookie z flagą `SameSite=Strict` do żądania z obcej strony. Ochrona nie działa jednak wobec ataku z tej samej strony (*same-site*), czyli z poddomeny tej samej domeny urzędu (np. przejętej lub z XSS), a urzędy zwykle mają wiele poddomen.

**Rekomendacja.**
- Sprawdzać typ MIME dokładnie: `ct.split(';')[0].trim() === 'application/json'`.
- Dla każdego żądania innego niż GET wymagać `Sec-Fetch-Site: same-origin` (albo `Origin` równego `KK_PUBLIC_ORIGIN`) i odrzucać brak obu nagłówków.
- Wymagać nagłówka `X-Requested-With: kk` (UI wysyła go w `api()`), bo wymusza preflight.

**Test.** Oba żądania z dowodu zwracają 403.

### S-05. Dziennik zdarzeń bez sekretu
**Opis.** `auditHash` to zwykły SHA-256 z poprzedniego skrótu i treści wpisu. Ktoś z prawem zapisu do `kompas.db` może zmienić wpis i przeliczyć wszystkie kolejne skróty, a `chainOk` nadal pokaże `true`. Łańcuch wykrywa więc tylko przypadkowe lub nieudolne zmiany.

**Rekomendacja.**
- HMAC z kluczem spoza bazy (`KK_AUDIT_KEY` z menedżera sekretów).
- Okresowe kotwiczenie ostatniego skrótu poza systemem: codzienny wpis do systemu EZD, kopia WORM albo znacznik czasu RFC 3161.
- Tabela `audit` z triggerem `BEFORE UPDATE/DELETE → RAISE(ABORT)`.

### S-06. Dane w spoczynku
**Dowód.** `ls -la data/`: `kompas.db`, `kompas.db-wal`, `kompas.db-shm` mają uprawnienia `-rw-r--r--`, czyli każdy użytkownik systemu może je czytać. `sign.key` ma `-rw-------`, ale leży w tym samym katalogu.

**Rekomendacja.**
- `fs.mkdirSync(DATA_DIR, { mode: 0o700 })` i `process.umask(0o077)` przed otwarciem bazy.
- W produkcji szyfrowanie dysku lub wolumenu; kopie zapasowe szyfrowane z testem odtworzenia.
- Klucz podpisów i klucz dziennika poza `DATA_DIR`, ze zmiennych środowiska lub menedżera sekretów, z możliwością rotacji.

### S-07. Ustawienia modułów są globalne
`PUT /api/settings` zmienia tabelę `settings` dla całej instancji. Dziś jest jeden przełożony, więc to nie problem. Przy wielu zespołach jeden kierownik może wyłączyć moduły (np. AI albo dowody) wszystkim innym.

**Rekomendacja.** Osobna rola `administrator` albo ustawienia per jednostka lub zespół. Zmiany ustawień zapisywać w dzienniku z prev/new (dziś zapis to tylko `key=1`).

### S-08. Brak limitu kosztownych operacji
`/api/ai/*` czeka na model do 120 s i nie ma limitu wywołań. `/api/evals/:id/document` generuje PDF przy każdym żądaniu. Jeden użytkownik może zająć cały lokalny model AI.

**Rekomendacja.**
- Limit na użytkownika: AI 10 na minutę i maksymalnie 1 równoległe wywołanie; PDF 30 na minutę.
- Globalny semafor dla modelu AI.
- Odpowiedź 429 z nagłówkiem `Retry-After`.

### S-09. Transport zależy od `KK_MODE`
Flaga `Secure` cookie i nagłówek HSTS włączają się tylko przy `KK_MODE=production`. Pomyłka w konfiguracji oznacza cookie sesji wysyłane także po HTTP.

**Rekomendacja.**
- Przy starcie w trybie produkcyjnym wymagać `KK_PUBLIC_ORIGIN=https://…`, a bez niej kończyć z błędem.
- Włączać `Secure`, gdy proxy zgłasza HTTPS przez `X-Forwarded-Proto` z zaufanego adresu.
- Użyć prefiksu `__Host-kk_sid`.

### S-10. Sesje
Sesja ma stały czas życia 8 godzin i nie wygasa przy bezczynności. Nie znika po zmianie roli lub przełożonego (rola jest wprawdzie odczytywana przy każdym żądaniu, co ogranicza skutki). Nie ma funkcji „wyloguj na wszystkich urządzeniach”. Restart serwera wylogowuje wszystkich, co jest bezpieczne, ale uciążliwe.

**Rekomendacja.**
- Wygasanie po 30 minutach bezczynności (przesuwane przy aktywności) i limit bezwzględny 8 h.
- Sesje w bazie, przechowywane jako hash tokenu.
- Unieważnianie przy zmianie hasła lub roli.

### S-11. Dziennik zapisuje pole e-mail
`audit(null, 'login_fail', email)` zapisuje dosłownie to, co wpisano w pole e-mail. Jeśli ktoś wpisze tam omyłkowo hasło, trafi ono do dziennika, który jest niezmienialny z założenia.

**Rekomendacja.** Zapisywać wartość tylko wtedy, gdy wygląda na adres e-mail i istnieje takie konto; w przeciwnym razie `[nieznany login]` albo skrót HMAC.

### S-12. Hasła
Polityka to tylko minimalna długość 10 znaków, i to wyłącznie przy zakładaniu konta. Nie ma zmiany ani resetu hasła ani sprawdzania haseł z wycieków. scrypt działa z domyślnymi parametrami (N=16384); OWASP zaleca N≥2^17 albo argon2id.

**Rekomendacja.** Docelowo SSO urzędu. Do tego czasu:
- zmiana hasła z podaniem starego;
- lista najczęstszych haseł;
- `scryptSync(pw, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 256*1024*1024 })` z zapisem parametrów w hashu i migracją przy kolejnym logowaniu.

### S-13 – S-16. Krótko
- **S-13.** Przenieść style inline z szablonów do klas CSS i usunąć `'unsafe-inline'` z `style-src`.
- **S-14.** Wbudować sprawdzenie dostępu w funkcję, np. `loadEval(u, id, { as: 'evaluator' | 'employee' | 'either' })`, zamiast powtarzać warunek przy każdej trasie. Obecnie wszystkie 14 wywołań sprawdza dostęp poprawnie, ale nowa trasa łatwo o tym zapomni.
- **S-15.** Ograniczyć wielkość `loginFails` (np. 10 000 kluczy, najstarsze usuwane) i liczbę sesji na użytkownika (np. 5).
- **S-16.** Treść dowodów trafia do modelu, a wynik jest wyświetlany przez `esc()` i niczego nie zapisuje, więc wpływ ogranicza się do treści podpowiedzi. Warto oddzielić dane od instrukcji (np. blok `<dane>…</dane>` plus reguła w promptcie systemowym) i dopisać do testów przypadek z wstrzyknięciem.

## 4. Mocne strony (z dowodem)
- **SQL:** wszystkie zapytania są przygotowane z parametrami. Dynamiczne są tylko fragmenty `WHERE` złożone ze stałych (`evidenceQuery`, `scopedWhere`).
- **XSS:** `esc()` jest używane w szablonach `app/app.js`. Linki przechodzą przez `safeLink`, który dopuszcza tylko http(s), a serwer waliduje protokół linku dowodu. Wynik AI jest renderowany przez `esc()` (`app.js:797, 992, 1053`).
- **XML:** `esc()` w `lib/documents.mjs:262` koduje `& < > " '`.
- **Autoryzacja:** wszystkie trasy ocen sprawdzają `evaluator_id` lub `employee_id`. Dowody, check-iny, feedback i oceny cząstkowe sprawdzają przynależność do zespołu (`teamMember`, `scopedWhere`), a szkice są niewidoczne dla pracownika.
- **Sesje:** token z 256 bitami losowości, rotacja przy logowaniu, cookie HttpOnly z SameSite=Strict, wylogowanie usuwa sesję. Testy w `test/security.test.mjs`.
- **Nagłówki:** CSP (`script-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`), nosniff, DENY, COOP i CORP, `no-store` dla API i dokumentów.
- **Konfiguracja:** w trybie produkcyjnym nie ma domyślnego hasła ani kont demo. Katalog `data/` i pliki `*.db` są w `.gitignore`. Serwer nasłuchuje tylko na 127.0.0.1.
- **Statyczne pliki:** lista dozwolonych ścieżek i ścisły regex dla zasobów, więc brak path traversal.
- **Zależności:** `npm audit --omit=dev` zgłasza 0 podatności.
- **RODO w AI:** `redactNames` z odmianą, a test sprawdza brak nazwisk w promptach.

## 5. Autoryzacja tras (skrót)

| Trasa | Rola | Kontrola obiektu |
|---|---|---|
| `POST /api/login`, `/logout`, `GET /api/model`, `/api/demo` | publiczne | – |
| `GET/PUT /api/settings` | zalogowany / przełożony | globalne (S-07) |
| `POST /api/employees` | przełożony | `manager_id = u.id` |
| `GET /api/evals` | oba | evaluator / employee bez szkiców |
| `POST /api/evals` | przełożony | pracownik z zespołu |
| `GET /api/evals/:id`, `/document`, `/signatures` | oba | evaluator albo employee (nie szkic); `variant=szkic` tylko evaluator |
| `PUT`, `/submit`, `/discuss`, `/sign`, `/early-exception`, `/objection-decision` | przełożony | `evaluator_id = u.id` |
| `/acknowledge`, `/objection` | pracownik | `employee_id = u.id` |
| `/api/evidence`, `/checkins`, `/partials` (zapis) | przełożony | `teamMember` |
| `/api/feedback` (PUT) | autor | `author_id = u.id` |
| `GET` dowody, check-iny, feedback, oceny cząstkowe | oba | `scopedWhere` (pracownik: tylko swoje) |
| `/api/month`, `/api/summary`, `/api/ai/checkin` | przełożony | `teamMember` |
| `/api/ai/talk`, `/api/ai/formal` | przełożony | `evaluator_id = u.id` |
| `/api/ai/development`, `/api/goals*` | zalogowany | `user_id = u.id` |
| `/api/audit` | zalogowany | tylko własne wpisy |

## 6. Czego nie sprawdzono
- Infrastruktury produkcyjnej (proxy, TLS, kopie zapasowe, monitoring), bo jeszcze nie istnieje.
- Odporności na DoS pod obciążeniem; oceniono tylko kod.
- Ręcznego testu XSS w przeglądarce. Sprawdzono statycznie użycie `esc()` we wszystkich miejscach z danymi użytkownika, które znalazłem; 21 użyć `innerHTML` nie było weryfikowanych linia po linii.
- Treści generowanych PDF pod kątem wstrzyknięć (pdf-lib rysuje tekst, nie interpretuje go).
- Historii gita: są w niej wyłącznie hasła kont demo (dane fikcyjne), bez innych sekretów.
