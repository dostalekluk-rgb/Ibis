import * as fs from 'fs';
import * as path from 'path';
import { decodeFileBuffer } from '../utils/encoding.js';
import { ParsedExamination, PatientChronologyDataset, SourceType } from '../types/chronology.js';

/**
 * Odstraní exportní hlavičky stran a stránkování v textu
 */
export function cleanPageBreakArtifacts(text: string): string {
  // Odstranění netisknutelných řídicích znaků
  const sanitized = text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
  return sanitized.replace(
    /\s*Strana č\.:\s*\d+[\s\S]*?Tisk archivní dokumentace[^\r\n]*\r?\n[^\r\n]*\r?\n--------------------------------------------------------------------------/gi,
    ''
  );
}

/**
 * Převod českého formátu data (DD.MM.YY nebo DD.MM.YYYY) a času (HH:mm) na ISO řetězec
 */
export function parseCzechDateToIso(dateStr: string, timeStr?: string | null): string | null {
  if (!dateStr) return null;
  const parts = dateStr.trim().split(/[.\/]/);
  if (parts.length < 3) return null;
  const day = parts[0].padStart(2, '0');
  const month = parts[1].padStart(2, '0');
  let year = parts[2].trim();
  if (year.length === 2) {
    year = '20' + year;
  }
  const isoDate = `${year}-${month}-${day}`;
  if (timeStr && timeStr.trim()) {
    const time = timeStr.trim().padStart(5, '0');
    return `${isoDate}T${time}:00`;
  }
  return isoDate;
}

/**
 * Extrakce základních osobnách údajů pacientky z úvodu textu (pro LOKÁLNÍ zobrazení v UI a protokolu)
 */
function extractPatientInfoFromText(text: string): {
  patientName?: string;
  insuranceNumber?: string;
  insuranceCode?: string;
  address?: string;
  phone?: string;
  dateOfBirth?: string;
} {
  const info: {
    patientName?: string;
    insuranceNumber?: string;
    insuranceCode?: string;
    address?: string;
    phone?: string;
    dateOfBirth?: string;
  } = {};

  const lines = text.split(/\r?\n/);
  for (const line of lines.slice(0, 15)) {
    const nameMatch = line.match(/^(.*?)\s+Č\.\s*poj\.:\s*(\d+)(?:\s+Kód\s*poj\.:\s*(\d+))?/i);
    if (nameMatch) {
      if (nameMatch[1].trim()) info.patientName = nameMatch[1].trim();
      if (nameMatch[2].trim()) info.insuranceNumber = nameMatch[2].trim();
      if (nameMatch[3]) info.insuranceCode = nameMatch[3].trim();
      break;
    }
  }

  if (!info.insuranceCode) {
    const kodMatch = text.match(/Kód\s*poj\.:\s*(\d+)/i);
    if (kodMatch) info.insuranceCode = kodMatch[1].trim();
  }

  const addrMatch = text.match(/Bydliště:\s*([^,\r\n]+(?:\s*,\s*[^,\r\n]+)*?)(?:\s*,\s*tel\.|\r?\n|$)/i);
  if (addrMatch) {
    info.address = addrMatch[1].trim();
  }

  const phoneMatch = text.match(/tel\.\s*(\+?\d[\d\s]+)/i);
  if (phoneMatch) {
    info.phone = phoneMatch[1].trim();
  }

  const dobMatch = text.match(/Dat\.\s*nar\.:\s*([0-9]{2}\.[0-9]{2}\.[0-9]{2,4})/i);
  if (dobMatch) {
    info.dateOfBirth = dobMatch[1].trim();
  }

  return info;
}

/**
 * Zpracuje jeden textový soubor (ambulantní nebo hospitalizační)
 */
export function parseInputText(fileName: string, rawText: string): ParsedExamination[] {
  const sourceType: SourceType = fileName.includes('amb') ? 'amb' : 'hosp';
  const text = cleanPageBreakArtifacts(rawText);
  const lines = text.split(/\r?\n/);

  // Vyhledání řádků se záhlavím sekcí
  const blockHeaderIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.includes('Dokumentace ze dne') || line.includes('Nález ze dne') || line.includes('DEKURZ ze dne')) {
      blockHeaderIndices.push(i);
    }
  }

  // Sloučení sousedních záhlaví patřících ke stejnému vyšetření (do 5 řádků od sebe)
  interface HeaderGroup {
    startLineIdx: number;
    endLineIdx: number;
    lines: string[];
  }

  const mergedHeaders: HeaderGroup[] = [];
  for (let i = 0; i < blockHeaderIndices.length; i++) {
    const currIdx = blockHeaderIndices[i];
    if (mergedHeaders.length > 0) {
      const prev = mergedHeaders[mergedHeaders.length - 1];
      if (currIdx - prev.endLineIdx <= 5) {
        prev.endLineIdx = currIdx;
        prev.lines.push(lines[currIdx]);
        continue;
      }
    }
    mergedHeaders.push({
      startLineIdx: currIdx,
      endLineIdx: currIdx,
      lines: [lines[currIdx]]
    });
  }

  const entries: ParsedExamination[] = [];

  // Preamble (úvodní část před prvním záhlavím)
  if (mergedHeaders.length > 0 && mergedHeaders[0].startLineIdx > 0) {
    const preambleContent = lines.slice(0, mergedHeaders[0].startLineIdx).join('\n').trim();
    if (preambleContent.length > 30) {
      let preambleDateIso = '2025-09-03';
      const dateMatch = preambleContent.match(/Dat\.\s*zal\.\s*karty:\s*([0-9]{2}\.[0-9]{2}\.[0-9]{2,4})|Dat\.\s*přij\.:\s*([0-9]{2}\.[0-9]{2}\.[0-9]{2,4})/i);
      if (dateMatch) {
        const foundDate = dateMatch[1] || dateMatch[2];
        const parsed = parseCzechDateToIso(foundDate);
        if (parsed) preambleDateIso = parsed;
      }

      entries.push({
        id: `${fileName}-preamble`,
        date: preambleDateIso,
        rawDate: '03.09.25',
        sourceFile: fileName,
        sourceType,
        type: sourceType === 'amb' ? 'Vstupní anamnéza / Souhrn' : 'Vstupní dekurs / Anamnéza',
        title: sourceType === 'amb' ? 'Vstupní anamnéza a stagingový souhrn' : 'Vstupní status a anamnéza hospitalizace',
        content: preambleContent
      });
    }
  }

  // Zpracování jednotlivých sekcí
  for (let i = 0; i < mergedHeaders.length; i++) {
    const header = mergedHeaders[i];
    const nextStartLine = (i + 1 < mergedHeaders.length) ? mergedHeaders[i + 1].startLineIdx : lines.length;
    const headerText = header.lines.join(' ');

    let dateStr: string | null = null;
    let timeStr: string | null = null;
    let doctor: string | null = null;

    const nalezMatch = headerText.match(/Nález ze dne\s+([0-9]{1,2}\.[0-9]{1,2}\.[0-9]{2,4})(?:\s+([0-9]{1,2}:[0-9]{2}))?\s*([^:\r\n]*):/i);
    const dekurzMatch = headerText.match(/DEKURZ ze dne\s+([0-9]{1,2}\.[0-9]{1,2}\.[0-9]{2,4})/i);
    const dokMatch = headerText.match(/Dokumentace ze dne\s+([0-9]{1,2}\.[0-9]{1,2}\.[0-9]{2,4})/i);

    if (nalezMatch) {
      dateStr = nalezMatch[1];
      timeStr = nalezMatch[2] || null;
      doctor = nalezMatch[3] ? nalezMatch[3].trim() : null;
    } else if (dekurzMatch) {
      dateStr = dekurzMatch[1];
    } else if (dokMatch) {
      dateStr = dokMatch[1];
    }

    const isoDate = parseCzechDateToIso(dateStr || '', timeStr);

    let type = 'Vyšetření';
    if (sourceType === 'hosp') {
      type = 'Hospitalizační dekurz';
    } else if (headerText.includes('Nález ze dne')) {
      type = 'Ambulantní nález';
    } else if (headerText.includes('Dokumentace ze dne')) {
      type = 'Ambulantní dokumentace';
    }

    const content = lines.slice(header.startLineIdx, nextStartLine).join('\n').trim();

    entries.push({
      id: `${fileName}-entry-${i + 1}`,
      date: isoDate || '1970-01-01',
      rawDate: dateStr || '',
      time: timeStr,
      sourceFile: fileName,
      sourceType,
      type,
      doctor,
      title: headerText.trim(),
      content
    });
  }

  return entries;
}

export function parseInputFile(filePath: string): ParsedExamination[] {
  const fileName = path.basename(filePath);
  const buf = fs.readFileSync(filePath);
  const rawText = decodeFileBuffer(buf);
  return parseInputText(fileName, rawText);
}

import { parseLabFileToExaminations, parseLabTextToExaminations, anonymizeLocalText } from './parseLab.js';
import { aggregateLabAnalytesFromDir, extractLabAnalytesFromText } from './parseLabAnalytes.js';

export interface UploadedFileItem {
  fileName: string;
  base64Content?: string;
  content?: string;
}

/**
 * Hlavní paměťový parser zobrazený a zpracovaný VÝHRADNĚ ze souborů vybraných v dialogu uživatelem.
 * Složka /vstup se nečte ani nepoužívá.
 */
export function parseUploadedFiles(
  uploadedFiles: UploadedFileItem[],
  outputDir?: string
): PatientChronologyDataset {
  const processedFiles: Array<{ fileName: string; rawText: string }> = [];

  for (const f of uploadedFiles) {
    const fileName = path.basename(f.fileName);
    let rawText = '';
    if (f.base64Content) {
      const buf = Buffer.from(f.base64Content, 'base64');
      rawText = decodeFileBuffer(buf);
    } else if (f.content) {
      rawText = f.content;
    }
    if (rawText) {
      processedFiles.push({ fileName, rawText });
    }
  }

  // 1. Extrakce osobních údajů pacientky VÝHRADNĚ ze souborů vybraných v dialogu
  let patientInfo: {
    patientName?: string;
    insuranceNumber?: string;
    insuranceCode?: string;
    address?: string;
    phone?: string;
    dateOfBirth?: string;
  } = {};

  for (const pf of processedFiles) {
    if (!patientInfo.patientName) {
      const extracted = extractPatientInfoFromText(pf.rawText);
      if (extracted.patientName) {
        patientInfo = extracted;
      }
    }
  }

  let extractedEntries: ParsedExamination[] = [];
  const unparsedFiles: Array<{ fileName: string; sizeBytes: number; content: string }> = [];
  let combinedLabText = '';

  for (const pf of processedFiles) {
    const isLab = pf.fileName.toLowerCase().includes('lab') || pf.rawText.includes('Výsledky z ');
    const isTxtOrDoc = pf.fileName.endsWith('.txt') || pf.fileName.endsWith('.json') || pf.fileName.endsWith('.doc') || pf.fileName.endsWith('.docx');

    if (isLab) {
      combinedLabText += pf.rawText + '\n';
      const { examinations } = parseLabTextToExaminations(pf.fileName, pf.rawText);
      extractedEntries = extractedEntries.concat(examinations);
    } else if (isTxtOrDoc) {
      const entries = parseInputText(pf.fileName, pf.rawText);
      extractedEntries = extractedEntries.concat(entries);
    } else {
      unparsedFiles.push({
        fileName: pf.fileName,
        sizeBytes: Buffer.byteLength(pf.rawText, 'utf8'),
        content: cleanPageBreakArtifacts(pf.rawText)
      });
    }
  }

  // Agregace laboratorních analytů výhradně z vybraných laboratorních souborů
  const labAggregated = extractLabAnalytesFromText(combinedLabText);

  // Seřazení vyšetření chronologicky
  extractedEntries.sort((a, b) => a.date.localeCompare(b.date));

  // Přečíslování ID pro sekvenci EXAM-001, EXAM-002, ...
  extractedEntries.forEach((entry, idx) => {
    const seqNum = String(idx + 1).padStart(3, '0');
    entry.id = `EXAM-${seqNum}`;
  });

  const ambCount = extractedEntries.filter(e => e.sourceType === 'amb').length;
  const hospCount = extractedEntries.filter(e => e.sourceType === 'hosp').length;
  const labCount = extractedEntries.filter(e => e.sourceType === 'lab').length;

  const dataset: PatientChronologyDataset = {
    metadata: {
      patientName: patientInfo.patientName || (extractedEntries.length > 0 ? 'Vyšetřovaná Pacientka' : 'Neznámá Pacientka'),
      insuranceNumber: patientInfo.insuranceNumber || '[Neznámé RČ]',
      insuranceCode: patientInfo.insuranceCode || 'VZP (111)',
      address: patientInfo.address || '[Neznámé bydliště]',
      phone: patientInfo.phone || '[Neznámý telefon]',
      dateOfBirth: patientInfo.dateOfBirth || '[Neznámý datum narození]',
      generatedAt: new Date().toISOString(),
      totalEvents: extractedEntries.length,
      ambEventsCount: ambCount,
      hospEventsCount: hospCount,
      labEventsCount: labCount,
      dateRange: {
        firstDate: extractedEntries[0]?.date ? extractedEntries[0].date.split('T')[0] : '',
        lastDate: extractedEntries[extractedEntries.length - 1]?.date ? extractedEntries[extractedEntries.length - 1].date.split('T')[0] : ''
      }
    },
    examinations: extractedEntries,
    unparsedFiles,
    labAggregated
  };

  if (outputDir) {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const jsonSubDir = path.join(outputDir, 'json');
    if (!fs.existsSync(jsonSubDir)) {
      fs.mkdirSync(jsonSubDir, { recursive: true });
    }

    const parsedJsonPath = path.join(outputDir, 'chronology_parsed.json');
    fs.writeFileSync(parsedJsonPath, JSON.stringify(dataset, null, 2), 'utf8');

    dataset.examinations.forEach(exam => {
      const singleJsonPath = path.join(jsonSubDir, `${exam.id.toLowerCase()}.json`);
      fs.writeFileSync(singleJsonPath, JSON.stringify(exam, null, 2), 'utf8');
    });

    fs.writeFileSync(path.join(jsonSubDir, 'lab_aggregated_by_test.json'), JSON.stringify(labAggregated.byTest, null, 2), 'utf8');
    fs.writeFileSync(path.join(jsonSubDir, 'lab_aggregated_by_date.json'), JSON.stringify(labAggregated.byDate, null, 2), 'utf8');
    fs.writeFileSync(path.join(jsonSubDir, 'lab_analytes_summary.json'), JSON.stringify(labAggregated, null, 2), 'utf8');
  }

  return dataset;
}

/**
 * Hlavní funkce pro parsování všech vstupních souborů v adresáři
 */
export function parseAllInputs(vstupDir: string, outputDir: string): PatientChronologyDataset {
  if (!fs.existsSync(vstupDir)) {
    throw new Error(`Vstupní adresář ${vstupDir} neexistuje!`);
  }

  const allFiles = fs.readdirSync(vstupDir).filter(f => f.endsWith('.txt') && !f.includes('_anonymized'));

  const targetFiles: string[] = [];
  const labFiles: string[] = [];
  const unparsedTargetFiles: string[] = [];

  allFiles.forEach(file => {
    const filePath = path.join(vstupDir, file);
    const buf = fs.readFileSync(filePath);
    const text = decodeFileBuffer(buf);

    const lowerName = file.toLowerCase();
    const isAmbOrHosp = lowerName.includes('amb') || lowerName.includes('hosp');
    const isLabName = lowerName.includes('lab');
    const hasLabContent = /Výsledky z \d{2}\/\d{2}\/\d{2,4}:/i.test(text) || /Minerály\+Osmolalita:|Krevní obraz-perifer:|Dusíkové metabolity:|REPT_BIOPVYS_DTP:|REPT_CTVYS_DTP:/i.test(text);

    if (isLabName || hasLabContent) {
      labFiles.push(file);
    } else if (isAmbOrHosp) {
      targetFiles.push(file);
    } else {
      unparsedTargetFiles.push(file);
    }
  });

  let extractedEntries: ParsedExamination[] = [];
  let patientInfo: {
    patientName?: string;
    insuranceNumber?: string;
    insuranceCode?: string;
    address?: string;
    phone?: string;
    dateOfBirth?: string;
  } = {};

  // Extrakce osobnách údajů pacientky ze všech dostupných souborů
  allFiles.forEach(file => {
    if (!patientInfo.patientName) {
      const filePath = path.join(vstupDir, file);
      const buf = fs.readFileSync(filePath);
      const text = decodeFileBuffer(buf);
      const extracted = extractPatientInfoFromText(text);
      if (extracted.patientName) {
        patientInfo = extracted;
      }
    }
  });

  targetFiles.forEach(file => {
    const filePath = path.join(vstupDir, file);
    const entries = parseInputFile(filePath);
    extractedEntries = extractedEntries.concat(entries);
  });

  // Zpracování laboratorních souborů (*lab*.txt i souborů s "Výsledky z dd/mm/yy:")
  labFiles.forEach(file => {
    const filePath = path.join(vstupDir, file);
    const { examinations } = parseLabFileToExaminations(filePath);
    extractedEntries = extractedEntries.concat(examinations);
  });

  // Agregace jednotlivých laboratorních analytů a časových řad (CRP, CA 125, Na, K, IRI atd.)
  const labAggregated = aggregateLabAnalytesFromDir(vstupDir);

  // Seřazení záznamů chronologicky (podle ISO data vzestupně)
  extractedEntries.sort((a, b) => a.date.localeCompare(b.date));

  // Přečíslování ID pro čistou sekvenci EXAM-001, EXAM-002, ...
  extractedEntries.forEach((entry, idx) => {
    const seqNum = String(idx + 1).padStart(3, '0');
    entry.id = `EXAM-${seqNum}`;
  });

  const ambCount = extractedEntries.filter(e => e.sourceType === 'amb').length;
  const hospCount = extractedEntries.filter(e => e.sourceType === 'hosp').length;
  const labCount = extractedEntries.filter(e => e.sourceType === 'lab').length;

  // Načtení zbývajících neparsovaných souborů (opravdové ostatní neparsované soubory)
  const unparsedFiles: Array<{ fileName: string; sizeBytes: number; content: string }> = [];

  unparsedTargetFiles.forEach(file => {
    const filePath = path.join(vstupDir, file);
    const stats = fs.statSync(filePath);
    const buf = fs.readFileSync(filePath);
    const rawText = decodeFileBuffer(buf);
    let cleanedContent = cleanPageBreakArtifacts(rawText);

    unparsedFiles.push({
      fileName: file,
      sizeBytes: stats.size,
      content: cleanedContent
    });
  });

  const dataset: PatientChronologyDataset = {
    metadata: {
      patientName: patientInfo.patientName || (extractedEntries.length > 0 ? 'Vyšetřovaná Pacientka' : 'Neznámá Pacientka'),
      insuranceNumber: patientInfo.insuranceNumber || '[Neznámé RČ]',
      insuranceCode: patientInfo.insuranceCode || 'VZP (111)',
      address: patientInfo.address || '[Neznámé bydliště]',
      phone: patientInfo.phone || '[Neznámý telefon]',
      dateOfBirth: patientInfo.dateOfBirth || '[Neznámý datum narození]',
      generatedAt: new Date().toISOString(),
      totalEvents: extractedEntries.length,
      ambEventsCount: ambCount,
      hospEventsCount: hospCount,
      labEventsCount: labCount,
      dateRange: {
        firstDate: extractedEntries[0]?.date ? extractedEntries[0].date.split('T')[0] : '',
        lastDate: extractedEntries[extractedEntries.length - 1]?.date ? extractedEntries[extractedEntries.length - 1].date.split('T')[0] : ''
      }
    },
    examinations: extractedEntries,
    unparsedFiles,
    labAggregated
  };

  // Uložení výstupů
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const jsonSubDir = path.join(outputDir, 'json');
  if (!fs.existsSync(jsonSubDir)) {
    fs.mkdirSync(jsonSubDir, { recursive: true });
  }

  // 1. Sloučený JSON soubor
  const parsedJsonPath = path.join(outputDir, 'chronology_parsed.json');
  fs.writeFileSync(parsedJsonPath, JSON.stringify(dataset, null, 2), 'utf8');

  // 2. Jednotlivé JSON soubory pro každé vyšetření
  dataset.examinations.forEach(exam => {
    const singleJsonPath = path.join(jsonSubDir, `${exam.id.toLowerCase()}.json`);
    fs.writeFileSync(singleJsonPath, JSON.stringify(exam, null, 2), 'utf8');
  });

  // 3. Uložení sdružených laboratorních vyšetření podle testu i podle data
  const aggregatedByTestPath = path.join(jsonSubDir, 'lab_aggregated_by_test.json');
  const aggregatedByDatePath = path.join(jsonSubDir, 'lab_aggregated_by_date.json');
  const labAnalytesSummaryPath = path.join(jsonSubDir, 'lab_analytes_summary.json');

  fs.writeFileSync(aggregatedByTestPath, JSON.stringify(labAggregated.byTest, null, 2), 'utf8');
  fs.writeFileSync(aggregatedByDatePath, JSON.stringify(labAggregated.byDate, null, 2), 'utf8');
  fs.writeFileSync(labAnalytesSummaryPath, JSON.stringify(labAggregated, null, 2), 'utf8');

  console.log(`[Parser] Úspěšně zpracováno ${targetFiles.length + labFiles.length} souborů.`);
  console.log(`[Parser] Celkem vyextrahováno ${extractedEntries.length} vyšetření a ${labAggregated.totalUniqueTests} laboratorních analytů.`);
  console.log(`[Parser] Sloučený JSON uložen do: ${parsedJsonPath}`);
  console.log(`[Parser] Sdružená vyšetření podle testu uložena do: ${aggregatedByTestPath}`);
  console.log(`[Parser] Sdružená vyšetření podle data uložena do: ${aggregatedByDatePath}`);
  console.log(`[Parser] Samostatné JSONy uloženy do: ${jsonSubDir}`);

  return dataset;
}
