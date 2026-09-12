import * as fs from 'fs';
import * as path from 'path';
import { decodeFileBuffer } from '../utils/encoding.js';
import { ParsedExamination, PatientChronologyDataset, SourceType, UnparsedTextFragment } from '../types/chronology.js';

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
export function extractPatientInfoFromText(text: string): {
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
  const headerLines = lines.slice(0, 30);

  for (const line of headerLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // 1. Jméno pacientky
    if (!info.patientName) {
      const mName1 = trimmed.match(/^(?:Pacientka|Pacient|Jméno)\s*:\s*([^|,\r\n]+(?:\s*,\s*[^|,\r\n]+)?)/i);
      if (mName1 && mName1[1].trim() && !mName1[1].toLowerCase().includes('vyšetřovaná') && !mName1[1].toLowerCase().includes('neznámá')) {
        info.patientName = mName1[1].trim();
      } else {
        const mName2 = trimmed.match(/^(.*?)\s+Č\.\s*poj\.:\s*(\d+)/i);
        if (mName2 && mName2[1].trim()) {
          info.patientName = mName2[1].trim();
        }
      }
    }

    // 2. Číslo pojištěnce (RČ)
    if (!info.insuranceNumber) {
      const mRc = trimmed.match(/(?:Číslo\s*pojištěnce(?:\s*\(RČ\))?|Č\.\s*poj\.|RČ|Rodné\s*číslo)\s*:\s*(\d{6}\/?\d{3,4}|\d{9,10})/i);
      if (mRc && mRc[1].trim()) {
        info.insuranceNumber = mRc[1].trim();
      }
    }

    // 3. Kód pojišťovny
    if (!info.insuranceCode) {
      const mCode = trimmed.match(/(?:Kód\s*pojišťovny|Kód\s*poj\.|Pojišťovna)\s*:\s*(\d{3}|[A-Z0-9\s()]+)/i);
      if (mCode && mCode[1].trim()) {
        let codeVal = mCode[1].trim();
        if (codeVal === '207') codeVal = 'OZP (207)';
        else if (codeVal === '111') codeVal = 'VZP (111)';
        else if (codeVal === '201') codeVal = 'VoZP (201)';
        else if (codeVal === '205') codeVal = 'ČPZP (205)';
        else if (codeVal === '209') codeVal = 'ZPŠ (209)';
        else if (codeVal === '211') codeVal = 'ZPMV (211)';
        else if (codeVal === '213') codeVal = 'RBP (213)';
        info.insuranceCode = codeVal;
      }
    }

    // 4. Datum narození
    if (!info.dateOfBirth) {
      const mDob = trimmed.match(/(?:Datum\s*narození|Dat\.\s*nar\.|Narozen(?:a)?)\s*:\s*([0-9]{2}\.[0-9]{2}\.[0-9]{2,4})/i);
      if (mDob && mDob[1].trim()) {
        info.dateOfBirth = mDob[1].trim();
      }
    }

    // 5. Bydliště
    if (!info.address) {
      const mAddr = trimmed.match(/(?:Bydliště|Adresa)\s*:\s*([^,\r\n]+(?:\s*,\s*[^,\r\n]+)*?)(?:\s*,\s*tel\.|\r?\n|$)/i);
      if (mAddr && mAddr[1].trim()) {
        info.address = mAddr[1].trim();
      }
    }

    // 6. Telefon
    if (!info.phone) {
      const mPhone = trimmed.match(/(?:Telefon|tel\.)\s*:\s*(\+?\d[\d\s]+)/i);
      if (mPhone && mPhone[1].trim()) {
        info.phone = mPhone[1].trim();
      }
    }
  }

  return info;
}

/**
 * Zpracuje jeden textový soubor (ambulantní nebo hospitalizační)
 */
export function parseInputText(fileName: string, rawText: string): {
  examinations: ParsedExamination[];
  unparsedFragments: UnparsedTextFragment[];
} {
  const sourceType: SourceType = fileName.includes('amb') ? 'amb' : 'hosp';
  const text = cleanPageBreakArtifacts(rawText);
  const lines = text.split(/\r?\n/);

  const entries: ParsedExamination[] = [];
  const unparsedFragments: UnparsedTextFragment[] = [];

  // Vyhledání řádků se záhlavím sekcí
  const blockHeaderIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (
      line.includes('Dokumentace ze dne') ||
      line.includes('Nález ze dne') ||
      line.includes('DEKURZ ze dne') ||
      line.includes('Zpráva ze dne') ||
      line.includes('Vyšetření ze dne') ||
      /\b(Dokumentace|Nález|DEKURZ|Zpráva|Vyšetření|Konzilium|Správa)\s+ze\s+dne/i.test(line) ||
      /\bze\s+dne\s+\d{1,2}[\.\/]\d{1,2}[\.\/]\d{2,4}/i.test(line)
    ) {
      blockHeaderIndices.push(i);
    }
  }

  if (blockHeaderIndices.length === 0) {
    if (text.trim().length > 0) {
      const dateMatch = text.match(/\b(\d{1,2})[\.\/](\d{1,2})[\.\/](\d{2,4})\b/);
      const parsedIso = dateMatch ? parseCzechDateToIso(dateMatch[0]) : null;
      const examDate = (parsedIso && parsedIso !== '1970-01-01') ? parsedIso : '1970-01-01';

      entries.push({
        id: `${fileName}-EXAM-001`,
        date: examDate,
        rawDate: dateMatch ? dateMatch[0] : 'Neuvedeno',
        sourceFile: fileName,
        sourceType,
        doctor: 'Neuveden',
        type: 'Zdravotní zpráva',
        title: `Lékařská zpráva (${fileName})`,
        content: text.trim()
      });
    }
    return { examinations: entries, unparsedFragments };
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

  // Preamble (úvodní část před prvním záhlavím)
  if (mergedHeaders.length > 0 && mergedHeaders[0].startLineIdx > 0) {
    const preambleContent = lines.slice(0, mergedHeaders[0].startLineIdx).join('\n').trim();
    if (preambleContent.length > 30) {
      let preambleDateIso = '2025-09-03';
      const preambleDates = (preambleContent.match(/\b(\d{1,2})[\.\/](\d{1,2})[\.\/](\d{2,4})\b/g) || [])
        .map(dStr => parseCzechDateToIso(dStr))
        .filter((d): d is string => d !== null && d !== '1970-01-01');

      if (preambleDates.length > 0) {
        preambleDates.sort();
        preambleDateIso = preambleDates[preambleDates.length - 1];
      } else {
        const dateMatch = preambleContent.match(/Dat\.\s*zal\.\s*karty:\s*([0-9]{2}\.[0-9]{2}\.[0-9]{2,4})|Dat\.\s*přij\.:\s*([0-9]{2}\.[0-9]{2}\.[0-9]{2,4})/i);
        if (dateMatch) {
          const foundDate = dateMatch[1] || dateMatch[2];
          const parsed = parseCzechDateToIso(foundDate);
          if (parsed) preambleDateIso = parsed;
        }
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
    } else if (preambleContent.length > 0) {
      unparsedFragments.push({
        id: `${fileName}-unparsed-preamble`,
        fileName,
        sourceType,
        location: `Úvodní část (řádky 1–${mergedHeaders[0].startLineIdx})`,
        reason: 'Krátký text před první hlavičkou vyšetření (≤ 30 znaků)',
        content: preambleContent,
        sizeBytes: Buffer.byteLength(preambleContent, 'utf8')
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

  return { examinations: entries, unparsedFragments };
}

export function parseInputFile(filePath: string): {
  examinations: ParsedExamination[];
  unparsedFragments: UnparsedTextFragment[];
} {
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
    const extracted = extractPatientInfoFromText(pf.rawText);
    if (extracted.patientName && !patientInfo.patientName) patientInfo.patientName = extracted.patientName;
    if (extracted.insuranceNumber && !patientInfo.insuranceNumber) patientInfo.insuranceNumber = extracted.insuranceNumber;
    if (extracted.insuranceCode && !patientInfo.insuranceCode) patientInfo.insuranceCode = extracted.insuranceCode;
    if (extracted.address && !patientInfo.address) patientInfo.address = extracted.address;
    if (extracted.phone && !patientInfo.phone) patientInfo.phone = extracted.phone;
    if (extracted.dateOfBirth && !patientInfo.dateOfBirth) patientInfo.dateOfBirth = extracted.dateOfBirth;
  }

  let extractedEntries: ParsedExamination[] = [];
  const unparsedFiles: Array<{ fileName: string; sizeBytes: number; content: string }> = [];
  let unparsedFragments: UnparsedTextFragment[] = [];
  let combinedLabText = '';

  for (const pf of processedFiles) {
    const lowerName = pf.fileName.toLowerCase();
    const isAmbOrHosp = lowerName.includes('amb') || lowerName.includes('hosp');
    const isLab = lowerName.includes('lab') || (!isAmbOrHosp && /Výsledky z \d{2}\/\d{2}\/\d{2,4}:/i.test(pf.rawText));
    const isTxtOrDoc = pf.fileName.endsWith('.txt') || pf.fileName.endsWith('.json') || pf.fileName.endsWith('.doc') || pf.fileName.endsWith('.docx');

    if (isLab) {
      combinedLabText += pf.rawText + '\n';
      const { examinations, unparsedFragments: labFrags } = parseLabTextToExaminations(pf.fileName, pf.rawText);
      extractedEntries = extractedEntries.concat(examinations);
      unparsedFragments = unparsedFragments.concat(labFrags);
    } else if (isAmbOrHosp || isTxtOrDoc) {
      const { examinations, unparsedFragments: textFrags } = parseInputText(pf.fileName, pf.rawText);
      extractedEntries = extractedEntries.concat(examinations);
      unparsedFragments = unparsedFragments.concat(textFrags);
    } else {
      const cleaned = cleanPageBreakArtifacts(pf.rawText);
      unparsedFiles.push({
        fileName: pf.fileName,
        sizeBytes: Buffer.byteLength(pf.rawText, 'utf8'),
        content: cleaned
      });
      unparsedFragments.push({
        id: `${pf.fileName}-unparsed-file`,
        fileName: pf.fileName,
        location: 'Celý soubor',
        reason: 'Nepodporovaný nebo neznámý typ souboru',
        content: cleaned,
        sizeBytes: Buffer.byteLength(pf.rawText, 'utf8')
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

  const metadata = {
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
  };

  // Lokální anonymizace neparsovaných fragmentů
  unparsedFragments.forEach(frag => {
    const { anonymizedText } = anonymizeLocalText(frag.content, metadata);
    frag.content = anonymizedText;
  });

  // Zajištění zpětné kompatibility unparsedFiles
  if (unparsedFiles.length === 0 && unparsedFragments.length > 0) {
    unparsedFragments.forEach(f => {
      unparsedFiles.push({
        fileName: f.fileName,
        sizeBytes: f.sizeBytes,
        content: f.content
      });
    });
  }

  const dataset: PatientChronologyDataset = {
    metadata,
    examinations: extractedEntries,
    unparsedFiles,
    unparsedFragments,
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
  let unparsedFragments: UnparsedTextFragment[] = [];
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
    const filePath = path.join(vstupDir, file);
    if (fs.existsSync(filePath)) {
      const buf = fs.readFileSync(filePath);
      const text = decodeFileBuffer(buf);
      const extracted = extractPatientInfoFromText(text);
      if (extracted.patientName && !patientInfo.patientName) patientInfo.patientName = extracted.patientName;
      if (extracted.insuranceNumber && !patientInfo.insuranceNumber) patientInfo.insuranceNumber = extracted.insuranceNumber;
      if (extracted.insuranceCode && !patientInfo.insuranceCode) patientInfo.insuranceCode = extracted.insuranceCode;
      if (extracted.address && !patientInfo.address) patientInfo.address = extracted.address;
      if (extracted.phone && !patientInfo.phone) patientInfo.phone = extracted.phone;
      if (extracted.dateOfBirth && !patientInfo.dateOfBirth) patientInfo.dateOfBirth = extracted.dateOfBirth;
    }
  });

  targetFiles.forEach(file => {
    const filePath = path.join(vstupDir, file);
    const { examinations, unparsedFragments: textFrags } = parseInputFile(filePath);
    extractedEntries = extractedEntries.concat(examinations);
    unparsedFragments = unparsedFragments.concat(textFrags);
  });

  // Zpracování laboratorních souborů (*lab*.txt i souborů s "Výsledky z dd/mm/yy:")
  labFiles.forEach(file => {
    const filePath = path.join(vstupDir, file);
    const { examinations, unparsedFragments: labFrags } = parseLabFileToExaminations(filePath);
    extractedEntries = extractedEntries.concat(examinations);
    unparsedFragments = unparsedFragments.concat(labFrags);
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
    unparsedFragments.push({
      id: `${file}-unparsed-file`,
      fileName: file,
      location: 'Celý soubor',
      reason: 'Nepodporovaný nebo nezařazený soubor z adresáře /vstup',
      content: cleanedContent,
      sizeBytes: stats.size
    });
  });

  const metadata = {
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
  };

  // Lokální anonymizace neparsovaných fragmentů
  unparsedFragments.forEach(frag => {
    const { anonymizedText } = anonymizeLocalText(frag.content, metadata);
    frag.content = anonymizedText;
  });

  if (unparsedFiles.length === 0 && unparsedFragments.length > 0) {
    unparsedFragments.forEach(f => {
      unparsedFiles.push({
        fileName: f.fileName,
        sizeBytes: f.sizeBytes,
        content: f.content
      });
    });
  }

  const dataset: PatientChronologyDataset = {
    metadata,
    examinations: extractedEntries,
    unparsedFiles,
    unparsedFragments,
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
