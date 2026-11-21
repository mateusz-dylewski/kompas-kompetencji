# Kompas Kompetencji – prototyp

Wsparcie przełożonego w pierwszej i okresowej ocenie pracownika służby cywilnej (model kompetencyjny, formularze, asystent rozmowy, plan rozwoju). Widok pracownika i przełożonego.

## Uruchomienie

Wymagania: Node.js 22.5+ (zero zależności npm).

```bash
node server.mjs
```

Otwórz http://localhost:8080.

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

- **RODO:** minimalizacja danych. Prompt do modelu nie zawiera imion ani nazwisk, tylko kompetencje, poziomy i uzasadnienia. Dziennik zdarzeń pozwala sprawdzić dostęp i zmiany.
- **AI Act (UE 2024/1689):** wspieranie ocen pracowników w zatrudnieniu może zakwalifikować system jako wysokiego ryzyka (załącznik III). Dlatego AI tylko proponuje (pytania, przeformułowania, działania rozwojowe). Nie wystawia ocen, a decyzję zawsze podejmuje człowiek. Przed wdrożeniem wymagana jest analiza prawna.
- **Agregaty zespołu:** wyniki zbiorcze pokazywane dopiero od 5 złożonych ocen.
- **Dostępność:** cel WCAG 2.1 AA (dyrektywa (UE) 2019/882, ustawa o dostępności cyfrowej).
- **Przed wdrożeniem:** DPIA, umowa powierzenia (art. 28 RODO), polityka prywatności, uwierzytelnianie zgodne z wymogami resortu (np. profil zaufany / mObywatel jako IdP), audyt bezpieczeństwa.

## Styl graficzny

Kolory i zaokrąglenia są tokenami w `app/app.css` (`:root`). Publicznie dostępne materiały nie zawierają pełnej palety systemu designu Ministerstwa Cyfryzacji, więc prototyp używa ogólnego języka usług państwowych (granat, biel). Po otrzymaniu tokenów z systemu designu wystarczy podmienić wartości w `:root`.

## Struktura

- `server.mjs` – serwer HTTP, konta i sesje (scrypt, cookie HttpOnly), API, asystent AI, dziennik.
- `index.html`, `app/app.js`, `app/app.css` – interfejs (animacje, dashboardy, kreator oceny).
- `app/kompetencje.js` – model kompetencji (14 kompetencji, 49 wskaźników) z Arkusza/modelu.
- `data/kompas.db` – baza SQLite (tworzona automatycznie, nie commituj).

## Ograniczenia prototypu

- Brak HTTPS i rotacji sesji; sesje w pamięci serwera.
- Brak rejestracji kont przez system zewnętrzny; konta zakłada przełożony.
- Limit kryteriów dodatkowych (3) do potwierdzenia z rozporządzeniem.
- Mapowanie poziomów pierwszej oceny (3/5/7 pkt) na opisy modelu wymaga weryfikacji z Arkuszem A.

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
