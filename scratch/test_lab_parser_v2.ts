import * as fs from 'fs';
import * as path from 'path';
import { decodeFileBuffer } from '../src/utils/encoding.js';
import { anonymizeLocalText } from '../src/parser/parseLab.js';
import { parseCzechDateToIso } from '../src/parser/parseInput.js';

export function parseLabFileToExaminationsV2(filePath: string) {
  const fileName = path.basename(filePath);
  const buf = fs.readFileSync(filePath);
  const rawText = decodeFileBuffer(buf);

  // 1. Důsledná lokální anonymizace před jakýmkoliv zpracováním
  const { anonymizedText, summary } = anonymizeLocalText(rawText);
  const anonymizedPath = filePath.replace('.txt', '_anonymized.txt');
  fs.writeFileSync(anonymizedPath, anonymizedText, 'utf8');

  // Rozdělení podle "Výsledky z dd/mm/yy:" nebo "Výsledky z dd/mm/yyyy:"
  const blockRegex = /(?:^|\n)(Výsledky z \d{2}\/\d{2}\/\d{2,4}:[\s\S]*?)(?=(?:\nVýsledky z \d{2}\/\d{2}\/\d{2,4}:)|$)/gi;
  
  const examinations: any[] = [];
  const labLinesByDate: Record<string, { rawDate: string; isoDate: string; textLines: string[] }> = {};

  let match: RegExpExecArray | null;
  let examCounter = 1;

  while ((match = blockRegex.exec(anonymizedText)) !== null) {
    const blockText = match[1].trim();
    const firstLine = blockText.split('\n')[0].trim();
    const dateMatch = firstLine.match(/Výsledky z (\d{2}\/\d{2}\/\d{2,4}):/i);
    if (!dateMatch) continue;

    const rawDate = dateMatch[1];
    const isoDate = parseCzechDateToIso(rawDate) || '2026-01-01';

    // Detekce, zda blok obsahuje ne-laboratorní zprávu (histologie, zobrazení, mikrobiologie, nálezy)
    const isNonLabBlock = /Nálezy:|REPT_|REP_|REPP_|RTGVYS:|SONOVYS:|MAMOVYS:|ECHO TT:|KULTIVACE A VYŠETŘENÍ|Histologické vyšetření|Klinická diagnóza:|Nález:|Závěr:|Makro:|Mikro:|CT hrudníku|Ultrasonografie|Mamografie|Trombóza/i.test(blockText);

    if (isNonLabBlock) {
      let reportType = 'Zobrazovací / Diagnostické vyšetření';
      const lower = blockText.toLowerCase();

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

      let doctor: string | null = null;
      const docMatch = blockText.match(/(?:Potvrzující lékař|Lékař|UVOLNIL):\s*([^:\r\n]+)/i);
      if (docMatch) doctor = docMatch[1].trim();

      examinations.push({
        id: `${fileName}-exam-${examCounter++}`,
        date: isoDate,
        rawDate,
        sourceFile: fileName,
        sourceType: 'lab',
        type: reportType,
        doctor,
        title: `${reportType} (${rawDate})`,
        content: blockText
      });
    } else {
      // Kvantitativní laboratorní hodnoty z daného data
      if (!labLinesByDate[rawDate]) {
        labLinesByDate[rawDate] = {
          rawDate,
          isoDate,
          textLines: []
        };
      }
      labLinesByDate[rawDate].textLines.push(blockText);
    }
  }

  // Sdružení laboratorních hodnot podle data do samostatných vyšetření
  for (const rawDate of Object.keys(labLinesByDate)) {
    const item = labLinesByDate[rawDate];
    const fullLabText = item.textLines.join('\n\n');

    let doctor: string | null = null;
    const docMatch = fullLabText.match(/(?:Potvrzující lékař|Lékař|UVOLNIL):\s*([^:\r\n]+)/i);
    if (docMatch) doctor = docMatch[1].trim();

    examinations.push({
      id: `${fileName}-lab-${rawDate.replace(/\//g, '')}`,
      date: item.isoDate,
      rawDate,
      sourceFile: fileName,
      sourceType: 'lab',
      type: 'Laboratoř / Laboratorní panel',
      doctor,
      title: `Laboratorní panel (${rawDate})`,
      content: fullLabText
    });
  }

  examinations.sort((a, b) => a.date.localeCompare(b.date));

  return { examinations, anonymizationSummary: summary };
}

// Test parseru
['vstup/ai-neumannova-lab.txt', 'vstup/ai-stankova-lab.txt', 'vstup/ai-wolf-lab.txt'].forEach(fp => {
  if (fs.existsSync(fp)) {
    const res = parseLabFileToExaminationsV2(fp);
    console.log(`\n=== PARSED ${fp} ===`);
    console.log(`Total examinations created: ${res.examinations.length}`);
    res.examinations.forEach(e => {
      console.log(` [${e.date}] (${e.type}) ${e.title} - len: ${e.content.length}`);
    });
  }
});
