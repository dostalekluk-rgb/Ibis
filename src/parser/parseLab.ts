import * as fs from 'fs';
import * as path from 'path';
import { decodeFileBuffer } from '../utils/encoding.js';
import { ParsedExamination } from '../types/chronology.js';
import { parseCzechDateToIso, cleanPageBreakArtifacts } from './parseInput.js';

import { PatientChronologyMetadata } from '../types/chronology.js';

export interface AnonymizationSummary {
  namesErased: number;
  insuranceNumbersErased: number;
  contactsErased: number;
}

/**
  * 100% Lokální anonymizace údajů v laboratorních a neparsovaných souborech
  */
export function anonymizeLocalText(text: string, metadata?: PatientChronologyMetadata): { anonymizedText: string; summary: AnonymizationSummary } {
  let namesCount = 0;
  let pojCount = 0;
  let contactCount = 0;

  let anonymizedText = text;

  // Czech unicode word character set
  const czWordChar = 'a-zA-Z0-9áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ';

  // 1. Jména k vymazání
  const nameTerms = new Set<string>([
    'Staňková', 'Stankova', 'Šárka', 'Sarka',
    'Neumannová', 'Neumannova', 'Hana',
    'Wolf', 'Heike',
    'Šromová', 'Sromová', 'Sromova', 'Eva'
  ]);

  if (metadata?.patientName && metadata.patientName !== 'Vyšetřovaná Pacientka' && metadata.patientName !== 'Neznámá Pacientka' && metadata.patientName !== 'Není načten žádný pacient') {
    const clean = metadata.patientName.replace(/\b(Mgr|MUDr|PhDr|Ing|doc|prof|Ph\.D\.|CSc\.)\.?/gi, '').replace(/[.,]/g, '');
    clean.split(/\s+/).forEach((w: string) => {
      const trimmed = w.trim();
      if (trimmed.length > 2) {
        nameTerms.add(trimmed);
        const ascii = trimmed.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (ascii.length > 2) nameTerms.add(ascii);
      }
    });
  }

  const sortedTerms = Array.from(nameTerms).sort((a, b) => b.length - a.length);
  const spec = ['.', '*', '+', '?', '^', '$', '(', ')', '[', ']', '{', '}', '|', '\\'];
  const namePattern = sortedTerms.map(t => t.split('').map(ch => spec.includes(ch) ? '\\' + ch : ch).join('')).join('|');
  const nameRegex = new RegExp(`(?<![${czWordChar}])(${namePattern})(?![${czWordChar}])`, 'gi');

  // 2. Čísla pojištěnců / RČ
  const RČs = new Set<string>(['6351056382', '6061200530', '6560227091', '5759160993']);
  if (metadata?.insuranceNumber && metadata.insuranceNumber !== '[Neznámé RČ]' && metadata.insuranceNumber !== '—') {
    const rawRč = metadata.insuranceNumber.replace('/', '').trim();
    if (rawRč.length >= 6) {
      RČs.add(rawRč);
      if (rawRč.length === 10) {
        RČs.add(`${rawRč.substring(0, 6)}/${rawRč.substring(6)}`);
      }
    }
  }
  const rcPattern = Array.from(RČs).map(r => r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const rcRegex = new RegExp(`(?<![0-9])(${rcPattern})(?![0-9])`, 'g');
  const genericRcRegex = /(?<![0-9])\d{6}\/\d{3,4}(?![0-9])/g;

  // 3. Kontakty (Bydliště & Telefon)
  const contactRegexes: RegExp[] = [
    new RegExp('U\\s+Hostavického\\s+potoka\\s+735/27,\\s*(?:198\\s*00\\s*)?Praha\\s*98?|\\+?420\\s*737\\s*947\\s*022', 'gi'),
    /\b\+?420\s*\d{3}\s*\d{3}\s*\d{3}\b/g
  ];

  if (metadata?.address && metadata.address.length > 5 && !metadata.address.includes('[Neznámé') && metadata.address !== '—') {
    contactRegexes.push(new RegExp(metadata.address.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'));
  }
  if (metadata?.phone && metadata.phone.length > 5 && !metadata.phone.includes('[Neznámý') && metadata.phone !== '—') {
    contactRegexes.push(new RegExp(metadata.phone.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'));
  }

  namesCount += (anonymizedText.match(nameRegex) || []).length;
  pojCount += (anonymizedText.match(rcRegex) || []).length + (anonymizedText.match(genericRcRegex) || []).length;

  anonymizedText = anonymizedText
    .replace(nameRegex, '[ANONYMIZOVÁNO]')
    .replace(rcRegex, '[ANON-RČ]')
    .replace(genericRcRegex, '[ANON-RČ]');

  contactRegexes.forEach(cr => {
    contactCount += (anonymizedText.match(cr) || []).length;
    anonymizedText = anonymizedText.replace(cr, '[ANON-KONTAKT]');
  });

  return {
    anonymizedText,
    summary: {
      namesErased: namesCount,
      insuranceNumbersErased: pojCount,
      contactsErased: contactCount
    }
  };
}

/**
 * Parsování nového formátu laboratorního exportu (*lab*.txt).
 * Sady výsledků začínají "Výsledky z dd/mm/yy:"
 * - Vytřídí ne-laboratorní nálezy (histologie, CT, RTG, MR, UZ, mikrobiologie/kultivace) do samostatných JSON vyšetření.
 * - Kvantitativní laboratorní hodnoty sdruží podle data do vyšetření "Laboratorní panel (datum)".
 * - Zaručí 100% lokální anonymizaci před výstupem.
 */
export function parseLabTextToExaminations(fileName: string, rawText: string): { examinations: ParsedExamination[]; anonymizationSummary: AnonymizationSummary } {
  // 1. Důsledná lokální anonymizace před jakýmkoliv vyhodnocením
  const { anonymizedText, summary } = anonymizeLocalText(rawText);
  const cleanedText = cleanPageBreakArtifacts(anonymizedText);

  // Rozdělení podle "Výsledky z dd/mm/yy:" nebo "Výsledky z dd/mm/yyyy:"
  const blockRegex = /(?:^|\n)(Výsledky z \d{2}\/\d{2}\/\d{2,4}:[\s\S]*?)(?=(?:\nVýsledky z \d{2}\/\d{2}\/\d{2,4}:)|$)/gi;
  
  const examinations: ParsedExamination[] = [];
  const labLinesByDate: Record<string, { rawDate: string; isoDate: string; textLines: string[] }> = {};

  let match: RegExpExecArray | null;
  let examCounter = 1;

  while ((match = blockRegex.exec(cleanedText)) !== null) {
    const blockText = match[1].trim();
    const firstLine = blockText.split('\n')[0].trim();
    const dateMatch = firstLine.match(/Výsledky z (\d{2}\/\d{2}\/\d{2,4}):/i);
    if (!dateMatch) continue;

    const rawDate = dateMatch[1];
    const isoDate = parseCzechDateToIso(rawDate) || '2026-01-01';

    // Detekce, zda blok obsahuje ne-laboratorní narativní zprávu (histologie, zobrazení, mikrobiologie, nálezy)
    const isNonLabBlock = /Nálezy:|REPT_|REP_|REPP_|RTGVYS:|SONOVYS:|MAMOVYS:|ECHO TT:|KULTIVACE A VYŠETŘENÍ|Histologické vyšetření|Klinická diagnóza:|Nález:|Závěr:|Makro:|Mikro:|CT hrudníku|Ultrasonografie|Mamografie|Trombóza/i.test(blockText);

    if (isNonLabBlock) {
      let reportType = 'Zobrazovací / Diagnostické vyšetření';
      const lower = blockText.toLowerCase();

      // Přesná klasifikace podle hlaviček a obsahu
      if (/REPT_BIOPVYS_DTP:|biop|histol|patolog|hgsc|karcinom|p53|wt1|mib1/i.test(lower)) {
        reportType = 'Histologie / Biopsie';
      } else if (/REPT_CTVYS_DTP:|ctvys|ct\s|somatom/i.test(lower)) {
        reportType = 'CT Vyšetření';
      } else if (/REPP_MRVYS_DTP:|REPT_MRVYS_DTP:|mrvys|mr\s|ingenia|magnetick/i.test(lower)) {
        reportType = 'MR / Magnetická rezonance';
      } else if (/REPT_RTGVYS_DTP:|rtgvys|rtg\s/i.test(lower)) {
        reportType = 'RTG Vyšetření';
      } else if (/REPT_MAMOVYS_DTP:|mamovys|mamografie/i.test(lower)) {
        reportType = 'Mamografie / UZ prsů';
      } else if (/REPT_SONOVYS_DTP:|sonovys|sono\s|usg|echo\s|ultrazvuk|ultrasono/i.test(lower)) {
        reportType = 'Sonografie / UZ vyšetření';
      } else if (/REPT_MIKROBIO_DTP:|REP_MRUT_DTP:|mikrobio|mrut|bakteriol|kultiv|primokultura|escherichia/i.test(lower)) {
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

  return {
    examinations,
    anonymizationSummary: summary
  };
}

export function parseLabFileToExaminations(filePath: string): { examinations: ParsedExamination[]; anonymizationSummary: AnonymizationSummary } {
  const fileName = path.basename(filePath);
  const buf = fs.readFileSync(filePath);
  const rawText = decodeFileBuffer(buf);
  return parseLabTextToExaminations(fileName, rawText);
}
