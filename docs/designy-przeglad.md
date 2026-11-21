# Przegląd designów z folderu Designyyy

Decyzja: co wdrażamy do Kompasu Kompetencji, a co odrzucamy. Kryteria: zakres projektu (ocena pierwsza i okresowa, rozmowa, rozwój, asystent), wymagania klienta (białe tło, ostre kształty, bez emoji, bez zbędnych danych, bez tekstu „służba cywilna” w logotypie) i zgodność z prawem (bez średniej i sugestii wyniku w zestawieniach).

## Wdrożone

| Design | Decyzja | Uwagi |
|---|---|---|
| Strona 404 | Wdrożone | Strona w `app/404.html`, zwracana dla nieznanych adresów otwieranych w przeglądarce. Biała, bez ciemnego panelu bocznego. |

## Do rozważenia (zgodne z projektem, wymagają osobnej decyzji)

| Design | Co zawiera | Dlaczego jeszcze nie |
|---|---|---|
| Panel asystenta z zakładkami „Asystent formalny / Asystent rozmowy” (Sluzbowa-AsystentPanel) | Dwie zakładki w panelu obok formularza | Pasuje do kreatora oceny. Wymaga przebudowy kreatora, więc to osobna zmiana. |
| Karta pracownika z przełączaniem „Widok przełożonego / Widok pracownika” (S5) | Ten sam ekran z dwoma widokami | Pomysł dobry, ale pokazuje ogólny poziom w pkt, a to kłóci się z zasadą projektu: w zestawieniach bez średniej i sugestii wyniku. |
| Mój kompas: pasek „obecny poziom vs wymagany” (App-Kompas) | Porównanie kompetencji z profilem stanowiska | Przydatne dla pracownika. Radar wymaga osobnego komponentu SVG. |
| Wizard z sześcioma krokami (S3A, S3B) | Inna struktura kroków niż nasz kreator | Zmiana struktury kreatora to duża zmiana i wymaga zgody klienta. |

## Odrzucone

| Design | Powód |
|---|---|
| Ciemny panel boczny we wszystkich wersjach | Klient nie chce ciemnego tła; zostajemy przy białym układzie. |
| Napis „Służba cywilna” pod logotypem | Klient wskazał, że nie jest potrzebny. Usunięto. |
| Pulpit, Baza wiedzy, Rozwój i szkolenia, Wnioski, Kalendarz, Mój zespół (App-*) | Poza zakresem projektu: wnioski, kalendarz, katalog szkoleń, baza wiedzy. |
| Asystent i agenci AI (App-AgentAI) | Kreator agentów z wyborem źródeł (ISAP, pliki) i „kto może korzystać”. Poza zakresem: nasz asystent nie tworzy agentów, odpowiada tylko o procedurach. |
| Panel HR administratora (S4) | Rola HR nie występuje w projekcie (tylko przełożony i pracownik). |
| Opcje czcionek (S0) | Zostajemy przy Open Sans i Montserrat, zgodnie z wymaganiem gov.pl i wcześniejszym ustaleniem. |
