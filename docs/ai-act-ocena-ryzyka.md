# AI Act – ocena ryzyka i wymogi (szkic)

**System:** Kompas Kompetencji, moduł podpowiedzi AI (asystent rozmowy, formalny i rozwoju).
**Model:** lokalny model językowy (Qwen przez Ollama), bez wysyłania danych poza urządzenie.

## 1. Klasyfikacja
- Zatrudnienie i ocena pracowników to obszar wysokiego ryzyka (AI Act, załącznik III pkt 4). Ocena systemu dotyczy tylko modułu podpowiedzi, nie wystawiania ocen.
- Aplikacja **nie ocenia** pracowników automatycznie: wynik ocen wpisuje przełożony. AI nie zmienia poziomów ani punktów.
- Wniosek: system traktujemy jako **wysokie ryzyko** do czasu pisemnej analizy prawnej. Wymogi poniżej stosujemy od teraz.

## 2. Wymogi dla systemów wysokiego ryzyka (art. 9–15) i ich realizacja
| Wymóg | Realizacja | Status |
|---|---|---|
| Zarządzanie ryzykiem (art. 9) | Ten dokument, lista ryzyk poniżej | szkic |
| Dane i zarządzanie danymi (art. 10) | Dane demo, brak danych treningowych; model nie jest trenowany lokalnie | wdrożone |
| Dokumentacja techniczna (art. 11) | README, lib/, ten dokument | częściowo |
| Rejestrowanie zdarzeń (art. 12) | Tabela `ai_log`: rodzaj, model, skrót wejścia (SHA-256), treść wyjścia, źródło, czas | wdrożone |
| Przejrzystość (art. 13) | Każda podpowiedź ma etykietę „AI lokalnie” lub „reguły”; instrukcja: podpowiedź do przemyślenia | wdrożone |
| Nadzór człowieka (art. 14) | AI nie zapisuje ocen; przełożony zatwierdza każdy wpis; przycisk „Wróć” zawsze działa | wdrożone |
| Dokładność i odporność (art. 15) | Testy na przykładach z urzędu | do zrobienia |

## 3. Obowiązki wobec osób (art. 26 dla wdrażającego, art. 50 dla przejrzystości)
- Pracownik musi wiedzieć, że przy ocenie używano AI. Komunikat w aplikacji i w klauzuli informacyjnej.
- Pracownik ma prawo do wyjaśnienia decyzji przez człowieka (procedura: sprzeciw w 7 dni, art. 83).

## 4. Ryzyka i środki
| Ryzyko | Środek |
|---|---|
| Halucynacje i nieprawdziwe stwierdzenia o pracowniku | Podpowiedzi tylko z danych w ocenie; człowiek weryfikuje; log wyjść |
| Dyskryminacja lub stronniczość językowa | Prompt zakazuje ocen osoby; przegląd próbek przez zespół; do zrobienia testy |
| Ocena osoby zamiast zachowania | Asystent formalny przeformułowuje na zachowania, bez zmiany poziomów |
| Wyciek danych | Model lokalny, brak zewnętrznych API, skróty wejść zamiast treści |
| Nadmierne zaufanie do AI | Etykiety, instrukcja, brak automatycznych zapisów |

## 5. Otwarte kwestie
- Pisemna analiza prawna klasyfikacji.
- Rejestracja w bazie systemów AI (jeśli wymagana dla organu).
- Procedura zgłaszania incydentów AI.
