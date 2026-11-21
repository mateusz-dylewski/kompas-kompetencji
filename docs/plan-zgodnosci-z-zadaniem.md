# Plan: zgodność z zadaniem (brief Ministerstwa Cyfryzacji) i z repo

Źródło: opis wyzwania „Kompas Kompetencji” (przełożony, pierwsza i okresowa ocena, model kompetencyjny, formularze, pomoc formalna, przygotowanie do rozmowy, działania rozwojowe, przyszłe użycie przez inne instytucje) oraz schemat „Ścieżki oceny” z archiwum HackNation.

## Stan obecny (co jest, co brakuje)

| Element zadania / schematu | Stan | Uwagi |
|---|---|---|
| Pierwsza ocena (Arkusz pierwszej oceny) | Jest | Formularz i PDF wg wzoru; daty nawiązania i rozmowy wstępnej brakuje |
| Ocena okresowa B i C | Jest | Kryteria obowiązkowe, dodatkowe ≤ 3, przedziały poziomów |
| Model kompetencyjny | Jest | 14 kompetencji, 49 wskaźników |
| Wybór kryteriów | Jest | Ręczny; brak podpowiedzi z opisu stanowiska |
| **Analiza opisu stanowiska pracy** (krok 1 schematu okresowej) | **Brak** | Schemat wymaga tego kroku przed oceną |
| Ocena zachowań z przykładami (dowody) | Jest | Dowody opcjonalne, zgodnie z ustawieniami |
| **Asystent formalny** (procedura, braki, terminy) | Częściowo | Brak osobnego modułu z listą kontrolną per arkusz i terminem |
| Asystent rozmowy (przygotowanie) | Jest | Baza pytań + instrukcja; model AI nieprzetestowany na prawdziwym Qwen |
| Plan rozwoju / IPR | Częściowo | Pole tekstowe; brak działań SMART przypisanych w ocenie |
| Działania rozwojowe pracownika | Częściowo | Asystent rozwoju (AI); cele SMART w profilu, nie powiązane z oceną |
| Wyniki dla zespołu (praca z zespołem) | Jest | Zbiorczo od 5 osób; brak planu działań zespołowych |
| Zgodność prawna (art. 81–83, RODO, AI Act, dostępność) | Częściowo | Dokumenty szkicowe; weryfikacja prawna niezakończona |
| Logowanie (profil zaufany / mObywatel) | Mock | Decyzja: na razie lekko |
| Podpis dokumentów | Mock | Skrót SHA-256 + podpis systemowy; kwalifikowany poza zakresem |
| Użycie przez inne instytucje | Brak | Jedna nazwa urzędu przez zmienną; brak konfiguracji per instytucja |
| Prezentacja, logo, spot 30 s | Częściowo | Logotypy i notatki są; spotu i prezentacji nie ma |

## Proponowane kroki (kolejność)

1. **Krok 1 schematu – analiza opisu stanowiska.** Przełożony wkleja opis stanowiska, system proponuje kryteria (do zatwierdzenia), z uzasadnieniem z treści opisu. Bez punktacji.
2. **Asystent formalny jako moduł.** Lista kontrolna per arkusz: pola, terminy, podpisy, zapoznanie, sprzeciw, komplet dowodów. Wynik to lista braków, nie ocena.
3. **Plan rozwoju powiązany z oceną.** Z obszarów do rozwoju przełożony wybiera działania SMART, przypisane do oceny i do pracownika. Działania trafiają do celów pracownika i do przeglądu.
4. **Konfiguracja instytucji.** Nazwa urzędu, komórki, wzory dokumentów i moduły ustawiane per instytucja (pod przyszłe użycie przez inne urzędy).
5. **Prawdziwy model AI.** Uruchomić Qwen lokalnie na wybranym modelu instruct i zmierzyć jakość na przykładach z baz pytań (testy regułowe to za mało).
6. **Zgodność.** Pełny tekst rozporządzenia i ustawy (art. 81–83, § 11), potwierdzenie reguły 6 miesięcy i skali pierwszej oceny, przegląd DPIA i klauzul RODO, test dostępności z czytnikiem ekranu.
7. **Prezentacja.** Spot 30 s na podstawie scenariusza z `Narracja_przetarg.md` i `roadmap-ui.md`. Nagranie z działającej aplikacji, nie z mockupów.

## Co świadomie odkładamy
- Integracja z login.gov.pl i podpisem kwalifikowanym (do czasu decyzji o integracji).
- Wersja mobilna (zgodnie z ustaleniem).
- Przebudowa UI na podstawie testów z użytkownikami (po zebraniu opinii).

## Prace w repo
- Gałąź `main` jest aktualna (commit `477dbfe` i wcześniejsze). Gałęzi `feature/wdrozenie-innowacji` już scalono.
- Testy: 74, wszystkie przechodzą.
- Zaproszenia: Janek (`th6lalo`) i Anusia (`anusiaaa`) dostali dostęp zapisu; to, czy zaakceptowali, trzeba sprawdzić na GitHubie.
