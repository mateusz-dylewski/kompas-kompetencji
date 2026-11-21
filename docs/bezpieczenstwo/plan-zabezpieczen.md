# Plan zabezpieczeń – Kompas Kompetencji

Plan wynika z [raportu z audytu](raport-audytu.md) z 2026-11-21. Jest ułożony etapami: **P0** to warunek wpuszczenia danych realnych, **P1** trzeba zrobić przed szerszym wdrożeniem w urzędzie, **P2** to dojrzałość. Przy każdym punkcie jest ID ustalenia z raportu.

## Założenia docelowe (jak ma być zabezpieczona)

1. **Tożsamość:** logowanie przez SSO urzędu (OIDC/SAML z AD/Entra ID) z MFA. Aplikacja nie zna haseł pracowników. Do czasu SSO działają konta lokalne z aktywacją jednorazowym linkiem.
2. **Rozliczalność:** zapoznanie z oceną, sprzeciw i podpis wykonuje wyłącznie osoba, której dotyczą (silne uwierzytelnienie, docelowo podpis zaufany lub kwalifikowany). Dziennik jest odporny na modyfikację także przez administratora bazy.
3. **Najmniejsze uprawnienia:** role `pracownik`, `przelozony`, `administrator`, `audytor` (tylko odczyt dziennika). Dostęp do danych przez jedną warstwę autoryzacji.
4. **Ochrona danych (RODO):** minimalizacja, szyfrowanie w spoczynku i w transmisji, retencja zgodna z przepisami o aktach osobowych, DPIA przed uruchomieniem, AI wyłącznie lokalnie i bez danych identyfikujących.
5. **Architektura wdrożenia:**
   ```
   przeglądarka ──HTTPS (TLS 1.2+/1.3, HSTS)──▶ reverse proxy (nginx/IIS, WAF, limit żądań)
                                                  │ http://127.0.0.1:8080, X-Forwarded-For/Proto od zaufanego proxy
                                                  ▼
                                     node server.mjs (użytkownik systemowy kk, bez powłoki)
                                       ├─ /var/lib/kompas (0700, szyfrowany wolumen): kompas.db
                                       ├─ sekrety z menedżera (KK_AUDIT_KEY, KK_SIGN_KEY) – poza DATA_DIR
                                       └─ Ollama na 127.0.0.1:11434 (bez dostępu do internetu)
   ```

## P0 – przed danymi realnymi (ok. 3–4 dni pracy)

| # | Zadanie | Ustalenie | Kryterium odbioru (test) |
|---|---|---|---|
| P0.1 | Konta pracowników bez hasła od przełożonego: jednorazowy link aktywacyjny (24 h, w bazie tylko hash tokenu) i wymuszona zmiana hasła; `/acknowledge` i `/objection` dopiero po aktywacji | S-01 | Przełożony nie może zalogować się na konto pracownika; test w `security.test.mjs` |
| P0.2 | Stały czas logowania (scrypt na fałszywym hashu, gdy konta brak) | S-02 | Różnica median czasu poniżej 50% |
| P0.3 | Limit prób bez blokowania cudzych kont: opóźnienie rosnące dla `ip+email`, twarda blokada tylko IP przy 50 próbach; zaufane proxy (`KK_TRUSTED_PROXY`) | S-03 | 5 złych prób z IP A nie blokuje IP B |
| P0.4 | CSRF: dokładny typ MIME, wymagany `Sec-Fetch-Site: same-origin` lub `Origin === KK_PUBLIC_ORIGIN` dla żądań innych niż GET | S-04 | Obie próby z raportu zwracają 403 |
| P0.5 | Uprawnienia plików: `umask 077`, `DATA_DIR` 0700; klucze z env lub menedżera sekretów poza `DATA_DIR` | S-06 | `stat` pokazuje 0600/0700; start w trybie produkcyjnym bez kluczy kończy się błędem |
| P0.6 | Tryb produkcyjny wymaga `KK_PUBLIC_ORIGIN=https://…`; cookie `__Host-kk_sid; Secure` | S-09 | Start z `http://` lub bez zmiennej kończy się błędem |
| P0.7 | HMAC w dzienniku (`KK_AUDIT_KEY`) i triggery blokujące UPDATE/DELETE na `audit`; migracja: stary łańcuch weryfikowany jak dotąd, nowe wpisy z polem `alg='hmac'` | S-05 | Zmiana wpisu i przeliczenie SHA-256 daje `chainOk=false` |
| P0.8 | DPIA i rejestr czynności przetwarzania; decyzja IOD o AI i retencji | – | Dokument zatwierdzony przez IOD |

## P1 – przed szerszym wdrożeniem (ok. 1–2 tygodnie)

| # | Zadanie | Ustalenie |
|---|---|---|
| P1.1 | SSO (OIDC) z MFA; mapowanie ról i przełożonego z katalogu kadrowego; konta lokalne tylko awaryjnie | S-01, S-12 |
| P1.2 | Rola `administrator` dla ustawień (lub ustawienia per jednostka); dziennik ustawień z prev/new | S-07 |
| P1.3 | Sesje w bazie (hash tokenu), wygasanie po 30 minutach bezczynności i 8 h bezwzględnie, unieważnianie po zmianie hasła lub roli, „wyloguj wszędzie”, maks. 5 sesji na osobę | S-10, S-15 |
| P1.4 | Limity: AI 10 na minutę i 1 równoległe wywołanie na osobę plus globalny semafor; PDF 30 na minutę; limit wielkości map w pamięci | S-08, S-15 |
| P1.5 | Jedna funkcja dostępu do ocen `loadEval(u, id, as)` zamiast `ownEval` z warunkami w trasach | S-14 |
| P1.6 | Dziennik nie przechowuje surowego loginu przy błędzie; retencja dziennika logowań 12 miesięcy | S-11 |
| P1.7 | Kopie zapasowe: szyfrowane, codziennie, kopia poza serwerem, kwartalny test odtworzenia; kotwiczenie ostatniego skrótu dziennika (EZD, WORM albo RFC 3161) | S-05, S-06 |
| P1.8 | Monitoring bezpieczeństwa: logi JSON do SIEM urzędu (logowania, 401/403/429, zmiany ustawień, pobrania dokumentów), alerty na serie nieudanych logowań i przerwanie łańcucha | – |
| P1.9 | Polityka haseł (lista popularnych haseł, zmiana hasła) i scrypt N=2^17 z migracją przy logowaniu – dla kont awaryjnych | S-12 |

## P2 – dojrzałość

- Usunięcie `'unsafe-inline'` ze `style-src` (S-13), nagłówek `Reporting-Endpoints` dla CSP.
- Separacja danych od instrukcji w promptach AI i testy wstrzyknięć (S-16).
- Eksport i usunięcie danych osoby (art. 15 i 17 RODO z wyjątkami dla akt osobowych), automatyczna retencja.
- Podpis zaufany lub kwalifikowany zamiast mocka (`SIG_NOTE`).
- Test penetracyjny zewnętrzny przed produkcją i co rok; zgodność z KRI (§ 20) i, jeśli dotyczy, z ustawą o KSC.
- Proces: `npm audit` i `node --test` w CI, zablokowany merge przy błędach, przegląd bezpieczeństwa (prompt z [prompt-audytu.md](prompt-audytu.md)) przy każdej większej zmianie, SBOM.

## Kolejność realizacji
1. P0.2, P0.4 i P0.5 (małe zmiany w `server.mjs` z testami) – 1 dzień.
2. P0.3 i P0.6 – 1 dzień.
3. P0.7 z migracją i opisem w README – 1 dzień.
4. P0.1 (aktywacja kont, zmiana hasła, UI) – 1–2 dni.
5. P0.8 równolegle (organizacyjnie, IOD).
6. P1 według priorytetu: P1.1 → P1.3 → P1.2 → P1.4 → reszta.
