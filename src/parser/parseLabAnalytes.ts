import * as fs from 'fs';
import * as path from 'path';
import { decodeFileBuffer } from '../utils/encoding.js';
import { LabAggregatedDataset, LabMeasurement, LabTestGroup, LabDateGroup } from '../types/chronology.js';
import { anonymizeLocalText } from './parseLab.js';

/**
 * Převod českého formátu data v labu (DD/MM/YY nebo DD/MM/YYYY) na ISO YYYY-MM-DD
 */
export function parseLabDateToIso(rawDate: string): string {
  const parts = rawDate.split(/[\/\.]/);
  if (parts.length < 3) return '1970-01-01';
  const day = parts[0].padStart(2, '0');
  const month = parts[1].padStart(2, '0');
  let year = parts[2].trim();
  if (year.length === 2) {
    year = '20' + year;
  }
  return `${year}-${month}-${day}`;
}

/**
 * Extrahování všech analytů z laboratorních souborů a sdružení podle vyšetření i podle data
 */
export function extractLabAnalytesFromText(text: string): LabAggregatedDataset {
  const { anonymizedText } = anonymizeLocalText(text);

  const byTest: Record<string, LabTestGroup> = {};
  const byDate: Record<string, LabDateGroup> = {};

  // Rozdělení podle "Výsledky z dd/mm/yy:" nebo "Výsledky z dd/mm/yyyy:"
  const blockRegex = /(?:^|\n)(Výsledky z \d{2}\/\d{2}\/\d{2,4}:[\s\S]*?)(?=(?:\nVýsledky z \d{2}\/\d{2}\/\d{2,4}:)|$)/gi;
  let match: RegExpExecArray | null;

  while ((match = blockRegex.exec(anonymizedText)) !== null) {
    const blockText = match[1].trim();
    const lines = blockText.split(/\r?\n/);
    const dateMatch = lines[0].match(/Výsledky z (\d{2}\/\d{2}\/\d{2,4}):/i);
    if (!dateMatch) continue;

    const rawDate = dateMatch[1];
    const isoDate = parseLabDateToIso(rawDate);

    let inNonLabSection = false;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];

      // Detekce ne-laboratorních sekcí
      if (/Nálezy:|REPT_|REP_|REPP_|RTGVYS:|SONOVYS:|MAMOVYS:|ECHO TT:|KULTIVACE|Histologické vyšetření|Klinická diagnóza:|SOMATOM|Injektor/i.test(line)) {
        inNonLabSection = true;
        continue;
      }

      if (inNonLabSection && /Minerály|Dusíkové|Jaterní|Bílkoviny|Krevní obraz|Moč|Koagulace|Sérum|Subpopulace/i.test(line)) {
        inNonLabSection = false;
      }

      if (inNonLabSection) continue;

      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;

      const testName = line.substring(0, colonIdx).trim();
      const valStr = line.substring(colonIdx + 1).trim();

      // Ignorujeme nadpisy sekcí s prázdnou hodnotou a systémové zprávy
      if (testName && valStr && valStr.length > 0 && !testName.includes('Výsledky z') && !testName.includes('Datum a doba')) {
        // Převedení číselné hodnoty
        const numMatch = valStr.match(/^([-0-9,<>\.]+)/);
        const rawVal = numMatch ? numMatch[1] : valStr;
        const numVal = parseFloat(rawVal.replace(',', '.'));
        const numericValue = isNaN(numVal) ? null : numVal;

        const measurement: LabMeasurement = {
          date: isoDate,
          rawDate,
          value: valStr,
          numericValue
        };

        // 1. Sdružení podle vyšetření (byTest)
        if (!byTest[testName]) {
          byTest[testName] = {
            testName,
            totalMeasurements: 0,
            measurements: []
          };
        }
        byTest[testName].measurements.push(measurement);

        // 2. Sdružení podle data odběru (byDate)
        if (!byDate[isoDate]) {
          byDate[isoDate] = {
            date: isoDate,
            rawDate,
            totalTests: 0,
            results: {}
          };
        }
        byDate[isoDate].results[testName] = valStr;
      }
    }
  }

  // Doprostrčení metadat pro byTest
  Object.keys(byTest).forEach(testName => {
    const group = byTest[testName];
    group.measurements.sort((a, b) => a.date.localeCompare(b.date));
    group.totalMeasurements = group.measurements.length;
    if (group.measurements.length > 0) {
      group.firstDate = group.measurements[0].date;
      group.lastDate = group.measurements[group.measurements.length - 1].date;
    }
  });

  // Seřazení byDate metadat
  Object.keys(byDate).forEach(isoDate => {
    const group = byDate[isoDate];
    group.totalTests = Object.keys(group.results).length;
  });

  return {
    byTest,
    byDate,
    totalUniqueTests: Object.keys(byTest).length,
    totalUniqueDates: Object.keys(byDate).length
  };
}

/**
 * Zpracuje všechny laboratorní soubory v adresáři a vrátí agregované výsledky
 */
export function aggregateLabAnalytesFromDir(vstupDir: string): LabAggregatedDataset {
  const allFiles = fs.readdirSync(vstupDir);
  const labFiles = allFiles.filter(f => f.includes('lab') && f.endsWith('.txt') && !f.includes('_anonymized'));

  let combinedText = '';

  labFiles.forEach(file => {
    const filePath = path.join(vstupDir, file);
    const buf = fs.readFileSync(filePath);
    const text = decodeFileBuffer(buf);
    combinedText += text + '\n';
  });

  return extractLabAnalytesFromText(combinedText);
}
