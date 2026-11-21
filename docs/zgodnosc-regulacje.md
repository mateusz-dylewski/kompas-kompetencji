# Zgodność z regulacjami – macierz wymagań

Status: **wdrożone** (w prototypie), **mock** (działa, ale nie spełnia wymogu prawnego do czasu integracji), **do zrobienia**.

| Obszar | Wymóg / podstawa | Realizacja w prototypie | Status |
|---|---|---|---|
| Ocena okresowa | Rozporządzenie PRM z 4.04.2016 (Dz. U. poz. 470), arkusze A/B/C | Kryteria obowiązkowe B i C, max 3 dodatkowe, skala 1/3/5/7/9, przedziały poziomu, PDF odtwarzający wzory | wdrożone |
| Pierwsza ocena | Rozporządzenie z 2015, arkusz pierwszej oceny | Skala 3/5/7, PDF wg wzoru | wdrożone (brak daty nawiązania stosunku pracy i rozmowy wstępnej) |
| Zapoznanie i sprzeciw | Art. 83 ust. 1 ustawy o służbie cywilnej: 7 dni na sprzeciw | Rejestr zapoznania, termin = zapoznanie + 7 dni, sprzeciw tylko w terminie, alert dla przełożonego | wdrożone |
| Podpis dokumentów | eIDAS (UE 910/2014), ustawa o usługach zaufania | Podpis symulowany: SHA-256 dokumentu + HMAC z kluczem serwera, weryfikacja | **mock** |
| Tożsamość | Profil zaufany / mObywatel (login.gov.pl) | Konta lokalne demo | **mock** (decyzja: na razie lekkie) |
| Dostępność | Ustawa o dostępności cyfrowej, dyrektywa (UE) 2019/882, WCAG 2.1 AA | Skip link, etykiety, role, komunikaty dla czytników, kontrast, klawiatura; audyt axe-core | wdrożone, do pełnego audytu ręcznego |
| Dostępność – deklaracja | Art. 8 ustawy o dostępności cyfrowej | docs/deklaracja-dostepnosci.md | szkic |
| RODO – minimalizacja | Art. 5 ust. 1 lit. c | Prompt AI bez imion; dane demo; dane lokalne | wdrożone (prototyp) |
| RODO – podstawa, informacja | Art. 6, 13 RODO | Klauzula informacyjna do przygotowania | do zrobienia |
| RODO – DPIA | Art. 35 RODO | docs/dpia-szkic.md | szkic |
| RODO – prawa osób | Art. 15–21 RODO | Podgląd własnej oceny; brak procedury usunięcia | częściowo |
| RODO – retencja | Art. 5 ust. 1 lit. e | Brak automatycznego usuwania | do zrobienia |
| Automatyczne decyzje | Art. 22 RODO | AI nie zmienia ocen; decyzję podejmuje człowiek | wdrożone |
| Audyt | Rozliczalność (art. 5 ust. 2 RODO) | Dziennik z łańcuchem SHA-256, weryfikacja integralności | wdrożone |
| AI Act | UE 2024/1689, art. 6 i zał. III pkt 4 (zatrudnienie) | docs/ai-act-ocena-ryzyka.md; oznaczanie treści AI, log podpowiedzi, nadzór człowieka | szkic + wdrożone elementy |
