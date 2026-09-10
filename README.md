# Ibis - Onkologický víceagentní systém VFN

Systém **Ibis** je víceagentní platforma pro zpracování onkologické pacientské dokumentace z NIS Medea ve Všeobecné fakultní nemocnici (VFN).

## Architektura a moduly

- **Ibis A (`src/types/chronology.ts`)**: RTF Parser & Chronologický konvertor (Medea RTF -> `PatientChronology.json`).
- **Ibis B (`src/types/tumorBoard.ts`)**: Redukční a strukturovací agent pro indikační komisi / Tumor Board (`PatientChronology.json` -> `TumorBoardSummary.json`).
- **Ibis C**: Gemini 1.5 Pro / Flash Clinical Assistant s interaktivním týmovým rozhraním pro live chat nad případy pacientek.

## Vzorová data (Samples)

- [`samples/sample_chronology.json`](file:///c:/Users/dosta/Documents/prog/Ibis/samples/sample_chronology.json): Ukázkový časový JSON s vyšetřeními pacientky s ca prsu.
- [`samples/sample_tumor_board.json`](file:///c:/Users/dosta/Documents/prog/Ibis/samples/sample_tumor_board.json): Ukázka synoptického zápisu pro indikační komisi.

## Spuštění (Až bude připravena logika)

```bash
npm install
npm run build
npm start
```
