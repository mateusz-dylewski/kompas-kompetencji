# Plan dalszych prac: UI, moduły, prezentacja (zarodek)

Status: notatki do następnej sesji. Priorytety mogą się zmienić po przeglądzie z zespołem.

## 1. Interfejs (do przebudowy w przyszłości)
- Kwadratowe, większe pola wyboru w stylu gov.pl (zrobione w pierwszej wersji, do oceny na Windowsie i macOS).
- Kryteria obowiązkowe: szare, nie do odznaczenia. Dodatkowe zaznaczone: niebieskie.
- Pełna przebudowa układu po zebraniu opinii użytkowników (przełożeni i pracownicy).
- Wersja mobilna poza zakresem.

## 2. Moduły spoza rozporządzenia (do włączania i wyłączania)
- Dowody przy wskaźnikach, rozmowy miesięczne, feedback, oceny kwartalne, asystent AI, widok dowodów dla pracownika.
- Ocena okresowa (Arkusz B i C), pierwsza ocena, zapoznanie i sprzeciw (art. 83), dziennik zdarzeń: zawsze włączone.
- Ustawienia są na stronie „Ustawienia” (tylko przełożony). Wyłączenie modułu blokuje też API.
- Dowody są opcjonalne. Zachęcamy do ich używania, bo wspierają przygotowanie oceny.

## 3. Asystent przy spotkaniu (mock regułowy, bez AI)
- Podpowiedzi: o co zapytać przy niższym wyniku, co docenić, jak dopytać o brakujący przykład.
- AI nie ocenia, nie podpowiada wyniku i nie zapisuje ocen. Podpowiedzi są do przemyślenia.
- Docelowo: prawdziwy model lokalny (Qwen) zamiast reguł; do tego czasu mock.

## 4. Terminy i kalendarz
- Strona główna przełożonego: terminy ocen okresowych z ostatniej oceny (24 miesiące, art. 81).
- TODO: zweryfikować regułę 6 miesięcy z poradnikiem i przepisami przed wdrożeniem (plik `lib/cycle.mjs`).
- TODO: przypomnienia o zapoznaniu i sprzeciwie (7 dni, art. 83).

## 5. Eksporty
- PDF i XML sprawdzać przy każdej zmianie w `lib/forms.mjs` i `lib/documents.mjs`.
- Testy: `npm test` (71 testów, w tym bez poziomów w szkicu).

## 6. Prezentacja i spot (30 s dla Ministerstwa Cyfryzacji)
- Problem: przełożony przed formularzem; pracownik nie wie, za co jest oceniany.
- Demo: kreator, asystent przed spotkaniem, terminy na stronie głównej, zapoznanie i sprzeciw.
- Przekaz: decyzję podejmuje człowiek, system pilnuje formalności i zostawia ślad.
- Format: animowana sekwencja, bez mowy lub z lektorem, z logotypami MC i Kompas Kompetencji 2027.
- Materiały: [docs/Narracja_przetarg.md](Narracja_przetarg.md).

## 7. Zgodność (do domknięcia)
- [docs/zgodnosc-regulacje.md](zgodnosc-regulacje.md), [docs/ai-act-ocena-ryzyka.md](ai-act-ocena-ryzyka.md), [docs/dpia-szkic.md](dpia-szkic.md), [docs/deklaracja-dostepnosci.md](deklaracja-dostepnosci.md).
- Podpis kwalifikowany i login.gov.pl: poza zakresem prototypu, do integracji.
