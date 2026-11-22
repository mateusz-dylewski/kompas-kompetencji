# Kompas Kompetencji: ocena okresowa i pomiar wsparcia przełożonego

22 lis 2026 · Jan (wersja poprawiona i powiązana z aplikacją)

Ten dokument opisuje, z jakich kroków składa się ocena okresowa w służbie cywilnej i jak zmierzyć, czy aplikacja realnie ułatwia pracę przełożonemu. Przy każdym kroku zaznaczono, co robi aplikacja.

## Kto i kiedy ocenia

Ocenę wystawia bezpośredni przełożony. Gdy go nie ma (np. przy długiej nieobecności), ocenę robi pośredni przełożony albo osoba zastępująca. *Aplikacja: oceniającym jest bezpośredni przełożony; przekazanie oceny pośredniemu przełożonemu lub zastępcy nie jest jeszcze obsługiwane.*

- **Częstotliwość:** co 24 miesiące od zakończenia poprzedniej oceny albo od zatrudnienia na czas nieokreślony. *Aplikacja: termin kolejnej oceny liczony od poprzedniej oceny okresowej (24 miesiące).*
- **Okres podlegający ocenie** zaczyna się od zapoznania pracownika z kryteriami, a kończy w dniu sporządzenia oceny na piśmie. Realnie to często ok. 23 miesiące. *Aplikacja: początek okresu w nowej ocenie to dzień, w którym pracownik potwierdził zapoznanie z ustaleniami rozmowy rozpoczynającej.*
- **Po ocenie negatywnej** pracownik podlega ponownej ocenie po 6 miesiącach. *Aplikacja: po ocenie negatywnej termin kolejnej oceny to 6 miesięcy, z opisem „ponowna ocena po ocenie negatywnej”. Do weryfikacji z art. 81 ustawy, czy to termin najwcześniejszy, czy dokładny.*

## Etapy procesu oceny

Proces ma **pięć etapów**. Pierwszy i dwa ostatnie mają terminy lub formalne wymagania, środkowe są ciągłe. Wybór kryteriów dodatkowych jest częścią etapu 1.

1. **Rozmowa rozpoczynająca** (w ciągu 30 dni od poprzedniej oceny). Omówienie obowiązków, kryteriów, oczekiwań i celów. W jej ramach przełożony wybiera kryteria dodatkowe (opcjonalnie, maks. 3 spośród kryteriów, które nie są obowiązkowe dla danego arkusza). Pracownik podpisuje część I arkusza. *Aplikacja: przełożony zapisuje rozmowę (arkusz, data, kryteria dodatkowe, obowiązki, oczekiwania, cele); pracownik potwierdza zapoznanie w swoim panelu (odpowiednik podpisu części I, mock). Pulpit przypomina o terminie 30 dni. Nowa ocena przejmuje kryteria i początek okresu.*
2. **Ocenianie** (cały okres). Obserwacja, informacje zwrotne i gromadzenie faktów, zapisywanych na bieżąco. *Aplikacja: dowody przy wskaźnikach, rozmowy miesięczne, feedback, zestawienie z rozkładem w czasie.*
3. **Rozmowa oceniająca** przed oceną na piśmie. Omówienie realizacji kryteriów, celów i kierunków rozwoju. Ma być dialogiem, nie monologiem. *Aplikacja: szkic z dowodów, pytania do rozmowy od asystenta AI (tylko propozycje).*
4. **Ocena na piśmie** (część II arkusza). Oceny cząstkowe w skali 1, 3, 5, 7, 9, średnia, ogólny poziom, ocena pozytywna albo negatywna, wnioski do IPRZ. Ocena negatywna wymaga uzasadnienia. *Aplikacja: kreator oceny, wynik wyliczany z ocen cząstkowych, uzasadnienie wymuszane przy ocenie negatywnej, PDF/XML arkusza.*
5. **Zakończenie.** Podpisy, oryginał do akt osobowych, kopia dla pracownika. *Aplikacja: podpisy systemu (do integracji z podpisem kwalifikowanym), zapoznanie, sprzeciw (7 dni) i jego rozpatrzenie (14 dni). Osobnego dokumentu IPRZ jeszcze nie ma – są wnioski rozwojowe w arkuszu.*

## Kryteria oceny

Ocenia się według kryteriów obowiązkowych (zależnych od arkusza A, B lub C) oraz do 3 kryteriów dodatkowych wybranych przez przełożonego spośród pozostałych kryteriów.

Wykaz kryteriów (załącznik nr 1 do rozporządzenia): komunikacja; kreatywność; negocjowanie; organizacja pracy i orientacja na osiąganie celów; orientacja na klienta/interesanta; podejmowanie decyzji i odpowiedzialność; radzenie sobie w sytuacjach kryzysowych; rzetelność; myślenie analityczne; wykorzystywanie wiedzy i doskonalenie zawodowe; współpraca; wystąpienia publiczne; zarządzanie ludźmi (obowiązkowe dla arkusza B); zarządzanie strategiczne (obowiązkowe dla arkusza A). *Aplikacja: wszystkie 14 kryteriów są w modelu. Obsługiwane arkusze: B, C i pierwsza ocena. **Arkusz A (wyższe stanowiska) nie jest jeszcze obsługiwany** – wymaga potwierdzenia listy kryteriów obowiązkowych z rozporządzeniem i oficjalnego wzoru arkusza.*

Punktem wyjścia każdej oceny cząstkowej jest 5 pkt (na poziomie oczekiwań). Ocena musi wynikać z rzeczywistych zachowań, a nie z ogólnego wrażenia.

## Jak mierzyć wsparcie przełożonego

Zasada: **mierzymy proces, nie osoby.** Przełożony też jest osobą, a projekt nie profiluje osób. Dlatego:
- metryki są wyłącznie zbiorcze i pokazujemy je dopiero od 5 przełożonych (ten sam próg K_MIN co dla zespołów), bez rankingu i bez wyników pojedynczej osoby;
- używamy median i odsetków;
- nie mierzymy czasu pracy, sesji ani kliknięć.

| Etap | Pytanie o wsparcie | Metryka | Źródło w aplikacji |
|---|---|---|---|
| 1. Rozmowa rozpoczynająca | Czy aplikacja pomaga przygotować obowiązki, oczekiwania i cele? | Odsetek rozmów w terminie 30 dni. Czas przygotowania z aplikacją i bez | Automatycznie (rozmowy rozpoczynające). Czas przygotowania: badanie pilotażowe |
| 1. Wybór kryteriów | Czy dobieranie kryteriów jest trafniejsze? | Odsetek ocen, w których kryteria dodatkowe zmieniły się po rozmowie | Automatycznie (porównanie rozmowy z oceną) |
| 2. Ocenianie | Czy fakty są zbierane w całym okresie, a nie tylko z ostatnich tygodni? | Mediana odsetka miesięcy okresu z co najmniej jednym dowodem. Nie liczba dowodów, która zachęcałaby do nadzoru | Automatycznie (dowody) |
| 3. Rozmowa oceniająca | Czy przed rozmową przełożony ma gotowe dane? | Ocena przygotowania 1–5 | Dobrowolna, anonimowa ankieta po złożeniu oceny (zapisujemy tylko wartość i miesiąc) |
| 4. Ocena na piśmie | Czy wypełnienie arkusza jest szybsze i bez błędów? | Mediana dni od szkicu do złożenia. Odsetek ocen poprawianych po złożeniu | Automatycznie (dziennik zdarzeń, wersje oceny) |
| 5. Zakończenie | Czy aplikacja porządkuje dokumenty i wnioski do IPRZ? | Liczba dokumentów poza systemem | Badanie pilotażowe |

Metryki widać na ekranie „Wyniki” (karta „Czy aplikacja pomaga w ocenie?”) i w `GET /api/metrics`.

**Ogólna miara sukcesu:** przełożony oddaje ocenę szybciej, z mniejszą liczbą poprawek, a ocena opiera się na faktach zebranych w całym okresie.

## Źródła

- Poradnik „Oceny okresowe w służbie cywilnej”, Kancelaria Prezesa Rady Ministrów, wrzesień 2016. Przeczytane: rozdziały 1, 3, 4, 6.2 (etapy) i 6.2.2 (kryteria).
- Rozporządzenie o ocenach okresowych z 2016 r. Nie przeczytane bezpośrednio, poradnik się na nie powołuje. **Do sprawdzenia w nim:** zakres arkusza A i jego kryteria obowiązkowe oraz termin ponownej oceny po ocenie negatywnej (w aplikacji oznaczone jako „DO WERYFIKACJI”).
- Arkusze oceny B i C oraz `Model_kompetencji.xlsx`: kryteria w aplikacji zgadzają się z wykazem 14 kryteriów; listy kryteriów obowiązkowych B i C są w `server.mjs` (`MAND_B`, `MAND_C`).
