import * as fs from 'fs';
import * as path from 'path';
import { decodeFileBuffer } from '../src/utils/encoding.js';
import { anonymizeLocalText } from '../src/parser/parseLab.js';
import { parseCzechDateToIso } from '../src/parser/parseInput.js';

interface SubReport {
  header: string;
  type: string;
  content: string;
}

export function parseLabFileBlocks(filePath: string) {
  const fileName = path.basename(filePath);
  const buf = fs.readFileSync(filePath);
  const rawText = decodeFileBuffer(buf);

  // 1. Důsledná lokální anonymizace před dalším zpracováním
  const { anonymizedText, summary } = anonymizeLocalText(rawText);
  
  // Rozdělení podle "Výsledky z dd/mm/yy:" nebo "Výsledky z dd/mm/yyyy:"
  const blockRegex = /(?:^|\n)(Výsledky z \d{2}\/\d{2}\/\d{2,4}:[\s\S]*?)(?=(?:\nVýsledky z \d{2}\/\d{2}\/\d{2,4}:)|$)/g;
  
  const examinations: any[] = [];
  const labDataByDate: Record<string, { rawDate: string; isoDate: string; textLines: string[] }> = {};

  let match: RegExpExecArray | null;
  let examCounter = 1;

  while ((match = blockRegex.exec(anonymizedText)) !== null) {
    const blockText = match[1].trim();
    const firstLine = blockText.split('\n')[0].trim();
    const dateMatch = firstLine.match(/Výsledky z (\d{2}\/\d{2}\/\d{2,4}):/i);
    if (!dateMatch) continue;

    const rawDate = dateMatch[1];
    const isoDate = parseCzechDateToIso(rawDate) || '2026-01-01';

    const lines = blockText.split('\n');

    // Analýza podsekcí uvnitř bloku (rozlišení laboratoře od ne-laboratorních zpráv)
    let currentLabLines: string[] = [firstLine];
    let inNonLabSubreport = false;
    let nonLabHeader = '';
    let nonLabLines: string[] = [];

    const flushNonLabReport = () => {
      if (nonLabLines.length > 0) {
        const fullContent = nonLabLines.join('\n').trim();
        let reportType = 'Zobrazovací / Diagnostické vyšetření';
        const lower = fullContent.toLowerCase() + ' ' + nonLabHeader.toLowerCase();

        if (/biop|histol|patolog|hgsc|karcinom|p53|wt1|mib1/i.test(lower)) {
          reportType = 'Histologie / Biopsie';
        } else if (/ctvys|ct\s|somatom/i.test(lower)) {
          reportType = 'CT Vyšetření';
        } else if (/mrvys|mr\s|ingenia|magnetick/i.test(lower)) {
          reportType = 'MR / Magnetická rezonance';
        } else if (/rtgvys|rtg\s/i.test(lower)) {
          reportType = 'RTG Vyšetření';
        } else if (/mamovys|mamografie/i.test(lower)) {
          reportType = 'Mamografie / UZ prsů';
        } else if (/sonovys|sono\s|usg|echo\s|ultrazvuk|ultrasono/i.test(lower)) {
          reportType = 'Sonografie / UZ vyšetření';
        } else if (/mikrobio|mrut|bakteriol|kultiv|primokultura|escherichia/i.test(lower)) {
          reportType = 'Mikrobiologie / Kultivace';
        }

        // Hledání ošetřujícího / potvrzujícího lékaře
        let doctor: string | null = null;
        const docMatch = fullContent.match(/(?:Potvrzující lékař|Lékař|UVOLNIL):\s*([^:\r\n]+)/i);
        if (docMatch) {
          doctor = docMatch[1].trim();
        }

        examinations.push({
          id: `${fileName}-exam-${examCounter++}`,
          date: isoDate,
          rawDate,
          sourceFile: fileName,
          sourceType: 'lab',
          type: reportType,
          doctor,
          title: `${reportType} (${rawDate})`,
          content: fullContent
        });

        nonLabLines = [];
        inNonLabSubreport = false;
      }
    };

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Detekce začátku ne-laboratorní sekce (histologie, zobrazení, mikrobiologie, nálezy)
      const isNonLabHeader = /^(Nálezy:|REPT_[A-Z0-9_-]+_DTP:|REP_[A-Z0-9_-]+_DTP:|REPP_[A-Z0-9_-]+_DTP:|RTGVYS:|SONOVYS:|ECHO TT:|UZ\s|USG:|KULTIVACE)/i.test(trimmed);

      if (isNonLabHeader) {
        flushNonLabReport();
        inNonLabSubreport = true;
        nonLabHeader = trimmed;
        nonLabLines.push(`Výsledky z ${rawDate}:`);
        nonLabLines.push(line);
      } else if (inNonLabSubreport) {
        // Kontrola, zda nezačala opět nová laboratorní sekce (např. Minerály, Bílkoviny, Krevní obraz)
        const isLabHeaderReturn = /^\s*(Minerály\+Osmolalita|Dusíkové metabolity|Jaterní testy|Bílkoviny|Krevní obraz-perifer|Dif\.stroj\.|Moč chemicky|Moč - sediment|Krev-tumor\.markery|Koagulační vyšetření|Sérum spec\.vyšetření|Subpopulace LYMFO|Diabetický profil):/i.test(line);
        if (isLabHeaderReturn) {
          flushNonLabReport();
          currentLabLines.push(line);
        } else {
          nonLabLines.push(line);
        }
      } else {
        currentLabLines.push(line);
      }
    }

    flushNonLabReport();

    // Pokud zbyly laboratorní hodnoty z daného data
    const labContent = currentLabLines.join('\n').trim();
    if (labContent.length > firstLine.length + 10) {
      if (!labDataByDate[rawDate]) {
        labDataByDate[rawDate] = {
          rawDate,
          isoDate,
          textLines: []
        };
      }
      labDataByDate[rawDate].textLines.push(labContent);
    }
  }

  // Vytvoření samostatných JSON vyšetření pro sdružené laboratorní hodnoty podle data
  for (const rawDate of Object.keys(labDataByDate)) {
    const item = labDataByDate[rawDate];
    const fullLabText = item.textLines.join('\n\n');

    let doctor: string | null = null;
    const docMatch = fullLabText.match(/(?:Potvrzující lékař|Lékař|UVOLNIL):\s*([^:\r\n]+)/i);
    if (docMatch) doctor = docMatch[1].trim();

    examinations.push({
      id: `${fileName}-lab-group-${rawDate.replace(/\//g, '')}`,
      date: item.isoDate,
      rawDate,
      sourceFile: fileName,
      sourceType: 'lab',
      type: 'Laboratoř / Laboratorní panel',
      doctor,
      title: `Laboratorní výsledky (${rawDate})`,
      content: fullLabText
    });
  }

  // Seřazení chronologicky
  examinations.sort((a, b) => a.date.localeCompare(b.date));

  return { examinations, anonymizationSummary: summary };
}

// Test na vseh tri lab souborech
['vstup/ai-neumannova-lab.txt', 'vstup/ai-stankova-lab.txt', 'vstup/ai-wolf-lab.txt'].forEach(fp => {
  if (fs.existsSync(fp)) {
    const res = parseLabFileBlocks(fp);
    console.log(`\n=== RESULTS FOR ${fp} ===`);
    console.log(`Total examinations created: ${res.examinations.length}`);
    res.examinations.forEach(e => {
      console.log(` - [${e.date}] (${e.type}) ${e.title} [len: ${e.content.length}]`);
    });
  }
});
