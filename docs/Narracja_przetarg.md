# Kompas Kompetencji – narracja i przekaz dla przetargu

## 1. Problem, który rozwiązujemy (własnymi słowami ludzi, nie przepisów)

- **Przełożony** dostaje raz na rok (albo po okresie próbnym) formularz, który trzeba wypełnić poprawnie formalnie i jednocześnie uczciwie ocenić człowieka. Często robi to w ostatniej chwili, z pamięci, i wpisuje ogólniki („dobrze pracuje”).
- **Pracownik** nie wie, za co dostaje ocenę, rzadko widzi skalę i przykłady, a rozmowa oceniająca bywa jednorazowym „zaliczeniem” zamiast początkiem rozwoju.
- **Urząd** ma niespójne oceny między komórkami, błędy formalne i brak planu rozwoju powiązanego z wynikiem oceny.

Źródło: Arkusze pierwszej oceny, B i C oraz model kompetencyjny z pakietu wyzwania. Kompas nie zmienia przepisów. Zmienia sposób, w jaki się je przechodzi.

## 2. Jedno zdanie

**Kompas prowadzi przełożonego krok po kroku przez ocenę opartą na zachowaniach i przykładach, a pracownikowi pokazuje, za co jest oceniany i dokąd może się rozwinąć.**

## 3. Co dostaje każdy uczestnik procesu

| Kto | Zanim | Z Kompasem |
|---|---|---|
| Przełożony | Formularz i pamięć, ostatnia chwila | Kreator: jedna kompetencja na stronie, przykład przy każdej ocenie, pytania do rozmowy, walidacja przed złożeniem |
| Pracownik | „Dostałem ocenę, nie wiem dlaczego” | Oś czasu procesu, profil kompetencji, cele SMART, plan rozwoju i prawo do wglądu |
| Urząd (MC, kierownictwo) | Niespójne oceny, braki formalne | Standard procesu, dziennik zdarzeń, dane w urzędzie, produkt do ponownego użycia przez inne instytucje |

## 4. Dlaczego to ma sens dla Ministerstwa

1. **Standard, nie tylko formularz.** Ten sam model kompetencji i ten sam tok w każdej komórce.
2. **Dane zostają w urzędzie.** AI działa lokalnie (model na serwerze urzędu), bez wysyłania treści do zewnętrznych usług.
3. **Człowiek decyduje.** AI tylko proponuje pytania, przeformułowania i działania rozwojowe. Nie wystawia ocen.
4. **Ślad audytowy.** Każde logowanie, utworzenie, złożenie i omówienie ma wpis w dzienniku.
5. **Dostępność.** Projekt celuje w WCAG 2.1 AA i sposób, w jaki korzysta się z usług państwowych (czytelność, kroki, jeden cel na ekranie).

## 5. Dowód wartości (do zmierzenia w pilocie, nie do obiecania)

Te liczby zobowiązujemy się zmierzyć, a nie przyjmujemy ich jako prawdę:

- czas przygotowania jednej oceny (przed / po),
- odsetek ocen złożonych bez braków formalnych przy pierwszym złożeniu,
- odsetek rozmów oceniających zakończonych planem rozwoju z celem SMART,
- ocena użyteczności przez przełożonych i pracowników (krótka ankieta po pilocie).

## 6. Ryzyka i odpowiedzi (przygotuj je przed przetargiem)

- **AI Act, zatrudnienie jako obszar wysokiego ryzyka.** Odpowiedź: AI nie ocenia, nie klasyfikuje i nie decyduje. Rozważamy wprost wymogi dla systemów wysokiego ryzyka, a przed wdrożeniem wykonujemy analizę prawną.
- **„Maszyna będzie oceniać ludzi”.** Odpowiedź: system pokazuje dane i proponuje, a odpowiedzialność zostaje u przełożonego i jest zapisana w dzienniku.
- **Uznaniowość i jednolitość.** Odpowiedź: kryteria i wskaźniki są stałe, każdy poziom ma opis zachowania, a przykład jest obowiązkowy.
- **Prywatność.** Odpowiedź: minimalizacja danych, brak treści w zewnętrznych usługach, DPIA i umowa powierzenia przed wdrożeniem.

## 7. Przekaz w 60 sekund (do pitchu)

> Ocena w służbie cywilnej nie powinna być egzaminem z formularza. Kompas Kompetencji prowadzi przełożonego krok po kroku: wybieramy kompetencje, oceniamy konkretne zachowania z przykładami, przygotowujemy rozmowę i zapisujemy plan rozwoju. Pracownik widzi, za co jest oceniany i dokąd może się rozwinąć. Dane zostają w urzędzie, a AI tylko podpowiada. Człowiek decyduje, system pilnuje formalności i zostawia ślad.

## 8. Scenariusz wideo (90 sekund)

1. (0–10 s) Przełożony przed formularzem. Pytanie: „Co mam napisać, skoro pamiętam tylko ostatni miesiąc?”
2. (10–35 s) Kreator: wybór kryteriów, jedna kompetencja na ekran, przykład przy każdej ocenie, „Dalej”.
3. (35–55 s) Asystent rozmowy: „Zacznij od tego, co się udało”, pytania przygotowane na podstawie oceny.
4. (55–75 s) Widok pracownika: oś czasu, profil kompetencji, cel SMART z postępem.
5. (75–90 s) Ekran zakończenia: „Decyzję podejmuje człowiek. System pilnuje formalności i zostawia ślad.” Logo MC i Kompas Kompetencji 2027.

## 9. Co jeszcze trzeba domknąć przed złożeniem oferty

- **Paleta i typografia** z systemu designu MC (obecnie tokeny w `app/app.css`).
- **Potwierdzenie przepisów:** limit kryteriów dodatkowych (3), mapowanie poziomów pierwszej oceny, zgodność Arkusza C.
- **Testy użyteczności:** 5 przełożonych i 5 pracowników, nagrane sesje, poprawki przed filmem.
- **Pilot:** jedna komórka, metryki z sekcji 5, raport z wynikami.
- **Bezpieczeństwo:** HTTPS, trwałe sesje, polityka haseł, przegląd kodu i testy penetracyjne przed produkcją.
- **Model AI:** wybór standardowego modelu Qwen (instruct), nie wersji uncensored; test jakości odpowiedzi na przykładach z urzędu.
