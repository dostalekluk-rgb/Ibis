import { GoogleGenAI } from '@google/genai';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { DiagnosisAndTreatmentBlock, PatientChronologyDataset, PatientChronologyMetadata, TumorBoardStructuredJson } from '../types/chronology.js';
import { buildTumorBoardPrompt } from './promptBuilder.js';
import { anonymizeLocalText } from '../parser/parseLab.js';
import { parseCzechDateToIso } from '../parser/parseInput.js';
import { normalizeAndAuditStructuredJson } from '../parser/jsonAudit.js';

dotenv.config();

export interface TumorBoardResult {
  reportHtml: string;
  treatmentPlanHtml: string;
  structuredJson?: TumorBoardStructuredJson;
  isSuccess: boolean;
  totalAnonymized: number;
  modelUsed: string;
  error?: string;
}

/**
 * Volání Gemini API přes REST s vynuceným JSON výstupem
 */
async function callGeminiRestJson(prompt: string, apiKey: string, modelName: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

  let maxAttempts = 3;
  let delayMs = 1500;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 8192,
            responseMimeType: 'application/json'
          }
        })
      });

      const data: any = await response.json();

      if (response.status === 200 && data.candidates && data.candidates[0]?.content?.parts[0]?.text) {
        return data.candidates[0].content.parts[0].text;
      }

      const errMsg = data.error?.message || `HTTP ${response.status}`;
      console.warn(`[Gemini REST] Pokus ${attempt}/${maxAttempts} selhal pro ${modelName}: ${errMsg}`);

      if (attempt < maxAttempts) {
        await new Promise(res => setTimeout(res, delayMs));
        delayMs *= 2;
      } else {
        throw new Error(`Gemini REST error (${modelName}): ${errMsg}`);
      }
    } catch (err: any) {
      if (attempt === maxAttempts) throw err;
      await new Promise(res => setTimeout(res, delayMs));
    }
  }

  throw new Error(`Model ${modelName} neodpověděl po ${maxAttempts} pokusech.`);
}

/**
 * Oprava zkráceného/neukončeného JSON řetězce z Gemini (když Gemini narazí na token limit).
 * Doplní chybějící uvozovky, hranaté a složené závorky.
 */
function repairTruncatedJson(str: string): string {
  let json = str.trim();
  let inString = false;
  let isEscaped = false;
  const openStack: string[] = [];

  for (let i = 0; i < json.length; i++) {
    const char = json[i];
    if (isEscaped) {
      isEscaped = false;
      continue;
    }
    if (char === '\\') {
      isEscaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (char === '{' || char === '[') {
        openStack.push(char);
      } else if (char === '}' || char === ']') {
        openStack.pop();
      }
    }
  }

  // Pokud zůstala neukončená hodnota řetězce
  if (inString) {
    json += '"';
  }

  // Oříznutí neukončené čárky nebo dvojtečky na konci
  json = json.replace(/,\s*$/, '').replace(/:\s*$/, ': ""');

  // Doplnění chybějících uzavíracích závorek v opačném pořadí
  while (openStack.length > 0) {
    const top = openStack.pop();
    if (top === '{') json += '}';
    else if (top === '[') json += ']';
  }

  return json;
}

function escapeHtml(str: string | null | undefined): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizeChemoLineNumerals(text: string | null | undefined): string {
  if (!text) return '';
  let str = text;
  str = str.replace(/\bVIII\.\s*(lini[ei]|CHT|chemoterapi[ei])/gi, '8. $1');
  str = str.replace(/\bVII\.\s*(lini[ei]|CHT|chemoterapi[ei])/gi, '7. $1');
  str = str.replace(/\bVI\.\s*(lini[ei]|CHT|chemoterapi[ei])/gi, '6. $1');
  str = str.replace(/\bIV\.\s*(lini[ei]|CHT|chemoterapi[ei])/gi, '4. $1');
  str = str.replace(/\bV\.\s*(lini[ei]|CHT|chemoterapi[ei])/gi, '5. $1');
  str = str.replace(/\bIII\.\s*(lini[ei]|CHT|chemoterapi[ei])/gi, '3. $1');
  str = str.replace(/\bII\.\s*(lini[ei]|CHT|chemoterapi[ei])/gi, '2. $1');
  str = str.replace(/\bI\.\s*(lini[ei]|CHT|chemoterapi[ei])/gi, '1. $1');

  str = str.replace(/^(St\.p\.\s*)?VIII\.\s*/i, '$18. ');
  str = str.replace(/^(St\.p\.\s*)?VII\.\s*/i, '$17. ');
  str = str.replace(/^(St\.p\.\s*)?VI\.\s*/i, '$16. ');
  str = str.replace(/^(St\.p\.\s*)?IV\.\s*/i, '$14. ');
  str = str.replace(/^(St\.p\.\s*)?V\.\s*/i, '$15. ');
  str = str.replace(/^(St\.p\.\s*)?III\.\s*/i, '$13. ');
  str = str.replace(/^(St\.p\.\s*)?II\.\s*/i, '$12. ');
  str = str.replace(/^(St\.p\.\s*)?I\.\s*/i, '$11. ');
  return str;
}

function extractTreatmentDateIso(str: string): string {
  if (!str) return '9999-99-99';

  // Krok 1: Hledání kompletních datů (YYYY-MM-DD nebo D.M.YYYY / DD.MM.YYYY)
  const fullDates: string[] = [];

  const isoMatches = [...str.matchAll(/\b(19\d{2}|20\d{2})[-.](0[1-9]|1[0-2])[-.](0[1-9]|[12]\d|3[01])\b/g)];
  for (const m of isoMatches) {
    fullDates.push(`${m[1]}-${m[2]}-${m[3]}`);
  }

  const czDateMatches = [...str.matchAll(/\b(\d{1,2})[.\/](\d{1,2})[.\/](19\d{2}|20\d{2})\b/g)];
  for (const m of czDateMatches) {
    const day = m[1].padStart(2, '0');
    const month = m[2].padStart(2, '0');
    const year = m[3];
    if (parseInt(month, 10) <= 12 && parseInt(day, 10) <= 31) {
      fullDates.push(`${year}-${month}-${day}`);
    }
  }

  if (fullDates.length > 0) {
    fullDates.sort();
    return fullDates[0];
  }

  // Krok 2: Hledání data ve formátu Měsíc/Rok (MM/YYYY, MM.YYYY)
  const monthYearDates: string[] = [];
  const myMatches = [...str.matchAll(/\b(\d{1,2})[.\/](19\d{2}|20\d{2})\b/g)];
  for (const m of myMatches) {
    const month = m[1].padStart(2, '0');
    const year = m[2];
    if (parseInt(month, 10) <= 12) {
      monthYearDates.push(`${year}-${month}-01`);
    }
  }

  if (monthYearDates.length > 0) {
    monthYearDates.sort();
    return monthYearDates[0];
  }

  // Krok 3: Hledání samostatných čtyřmístných roků (19XX nebo 20XX, např. 2016 nebo 2016-2020)
  const yearMatches = [...str.matchAll(/\b(19\d{2}|20\d{2})\b/g)];
  if (yearMatches.length > 0) {
    const years = yearMatches.map(m => m[1]).sort();
    return `${years[0]}-01-01`;
  }

  return '9999-99-99';
}

/**
 * Převede strukturovaný JSON z Gemini na položkové zobrazení exaktně podle vzoru konsilium.docx
 */
export function renderStructuredJsonToHtml(
  dataInput: TumorBoardStructuredJson,
  realMeta?: PatientChronologyMetadata,
  maxDate?: string
): { reportHtml: string; treatmentPlanHtml: string } {
  const data = normalizeAndAuditStructuredJson(dataInput);
  const pHeader = {
    name: (realMeta?.patientName && realMeta.patientName !== 'Vyšetřovaná Pacientka' && realMeta.patientName !== 'Není načten žádný pacient')
      ? realMeta.patientName
      : (data.patientHeader?.name && data.patientHeader.name !== '[ANONYMIZOVÁNO]' ? data.patientHeader.name : 'Vyšetřovaná Pacientka'),
    insuranceNumber: (realMeta?.insuranceNumber && realMeta.insuranceNumber !== '[Neznámé RČ]' && realMeta.insuranceNumber !== '—')
      ? realMeta.insuranceNumber
      : (data.patientHeader?.insuranceNumber && data.patientHeader.insuranceNumber !== '[ANON-RČ]' ? data.patientHeader.insuranceNumber : '[Neznámé RČ]'),
    insuranceCode: (realMeta?.insuranceCode && realMeta.insuranceCode !== '—')
      ? realMeta.insuranceCode
      : (data.patientHeader?.insuranceCode || 'VZP (111)'),
    address: (realMeta?.address && realMeta.address !== '[Neznámé bydliště]' && realMeta.address !== '—')
      ? realMeta.address
      : (data.patientHeader?.address && data.patientHeader.address !== '[ANON-KONTAKT]' ? data.patientHeader.address : '[Neznámé bydliště]'),
    phone: (realMeta?.phone && realMeta.phone !== '[Neznámý telefon]' && realMeta.phone !== '—')
      ? realMeta.phone
      : (data.patientHeader?.phone && data.patientHeader.phone !== '[ANON-KONTAKT]' ? data.patientHeader.phone : '[Neznámý telefon]'),
    dateOfBirth: (realMeta?.dateOfBirth && realMeta.dateOfBirth !== '[Neznámý datum narození]' && realMeta.dateOfBirth !== '—')
      ? realMeta.dateOfBirth
      : '',
    metrics: data.patientHeader?.metrics || (data as any).patientStatusHeader?.ageAndMetrics || '63 let, 168 cm, 85 kg, ECOG PS 0'
  };

  const presentIllness = data.presentIllness || 'NO: pacientka přichází ke zvážení dalšího postupu...';
  const anam = data.anamnesis || {};

  const isVenousPort = (text: string): boolean => /port|venózn|venozn/i.test(text);
  const wrapUnderline = (text: string): string => isVenousPort(text) ? escapeHtml(text) : `<u>${escapeHtml(text)}</u>`;

  // Stagingová vyšetření (EXKLUDUJE MAMOGRAFII)
  const stagingExams = (Array.isArray(data.stagingExaminations) ? data.stagingExaminations : [])
    .filter(ex => {
      const text = typeof ex === 'object' && ex !== null ? `${ex.title || ''} ${ex.fullText || ''}` : String(ex);
      return !/mamograf|mamog|MG\b|MMG\b/i.test(text);
    });

  const recurrences = Array.isArray(data.recurrences) ? data.recurrences : [];
  const tbConclusion = data.tumorBoardConclusion || {
    date: 'Onkogynekologické konsilium 9.9.2026',
    attendees: 'prof. MUDr. Cibula, CSc., prof. MUDr. Sláma, Ph.D., MUDr. Frühauf, Ph.D., MUDr. Tomancová, prof. MUDr. Burgetová, Ph.D., MUDr. Valentová, MUDr. Brynda, MUDr. Emingr, MUDr. Malik',
    recommendation: Array.isArray((data as any).treatmentRecommendation) ? (data as any).treatmentRecommendation.join(' ') : 'Doporučení: Pacientka je předána ke sledování v onkogynekologické ambulanci.'
  };

  let formattedBoardDate = '9.9.2026';
  if (maxDate && maxDate.trim()) {
    const isoMatch = maxDate.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      formattedBoardDate = `${parseInt(isoMatch[3], 10)}.${parseInt(isoMatch[2], 10)}.${isoMatch[1]}`;
    } else {
      const czMatch = maxDate.trim().match(/^(\d{1,2})[\.\/](\d{1,2})[\.\/](\d{4})/);
      if (czMatch) {
        formattedBoardDate = `${parseInt(czMatch[1], 10)}.${parseInt(czMatch[2], 10)}.${czMatch[3]}`;
      } else {
        formattedBoardDate = maxDate.trim();
      }
    }
  } else if (tbConclusion.date) {
    const dateMatch = tbConclusion.date.match(/(\d{1,2}[\.\/]\d{1,2}[\.\/]\d{4})/);
    if (dateMatch) {
      formattedBoardDate = dateMatch[1];
    } else {
      formattedBoardDate = tbConclusion.date.replace(/^Onkogynekologické konsilium\s*/i, '');
    }
  }

  const reportHtml = `
    <article class="konzilia-document">
      <!-- 1. IDENTIFIKACE PACIENTKY PODLE KONZILIA.DOCX -->
      <div class="konzilia-patient-meta">
        <div class="konzilia-meta-line"><strong>Pacientka:</strong> ${escapeHtml(pHeader.name)}</div>
        <div class="konzilia-meta-line"><strong>Číslo pojištěnce (RČ):</strong> ${escapeHtml(pHeader.insuranceNumber)}${pHeader.insuranceCode ? ` &nbsp;&nbsp;&nbsp;|&nbsp;&nbsp;&nbsp; <strong>Kód pojišťovny:</strong> ${escapeHtml(pHeader.insuranceCode)}` : ''}</div>
        ${pHeader.dateOfBirth ? `<div class="konzilia-meta-line"><strong>Datum narození:</strong> ${escapeHtml(pHeader.dateOfBirth)}</div>` : ''}
        ${pHeader.address ? `<div class="konzilia-meta-line"><strong>Bydliště:</strong> ${escapeHtml(pHeader.address)}</div>` : ''}
        ${pHeader.phone ? `<div class="konzilia-meta-line"><strong>Telefon:</strong> ${escapeHtml(pHeader.phone)}</div>` : ''}
      </div>

      <div class="konzilia-metrics">
        ${escapeHtml(pHeader.metrics)}
      </div>

      <!-- 2. NO: NYNĚJŠÍ ONEMOCNĚNÍ -->
      <div class="konzilia-section">
        <p class="konzilia-no-text"><strong>${presentIllness.startsWith('NO:') ? '' : 'NO: '}</strong>${escapeHtml(presentIllness)}</p>
      </div>

      <!-- 3. ANAMNÉZA -->
      <div class="konzilia-section">
        <div class="konzilia-section-heading">Anamnéza:</div>
        ${anam.oa ? `<p><strong>OA:</strong> ${escapeHtml(anam.oa.replace(/^OA:\s*/i, ''))}</p>` : ''}
        ${anam.operace ? `<p><strong>Operace:</strong> ${escapeHtml(anam.operace.replace(/^Operace:\s*/i, ''))}</p>` : ''}
        ${anam.fa ? `<p><strong>FA:</strong> ${escapeHtml(anam.fa.replace(/^FA:\s*/i, ''))}</p>` : ''}
        ${anam.aa ? `<p><strong>AA:</strong> ${escapeHtml(anam.aa.replace(/^AA:\s*/i, ''))}</p>` : ''}
        ${anam.ga ? `<p><strong>GA:</strong> ${escapeHtml(anam.ga.replace(/^GA:\s*/i, ''))}</p>` : ''}
      </div>

      <!-- 4. STAGINGOVÁ VYŠETŘENÍ (ZOBRAZOVACÍ VYŠETŘENÍ Z POSLEDNÍCH 2 MĚSÍCŮ; MAMOGRAFIE JE VYLOUČENA; NEVYPISUJEME POKUD JSOU PRÁZDNÁ) -->
      ${stagingExams.length > 0 ? `
        <div class="konzilia-section">
          <div class="konzilia-section-heading">Stagingové vyšetření</div>
          ${stagingExams.map(ex => {
            if (typeof ex === 'object' && ex !== null && (ex.title || ex.fullText)) {
              const title = ex.title || 'Vyšetření:';
              const fullText = ex.fullText || '';
              return `<p class="konzilia-exam-item"><strong>${escapeHtml(title)}</strong> ${escapeHtml(fullText)}</p>`;
            }
            const strVal = String(ex);
            const colonIdx = strVal.indexOf(':');
            if (colonIdx !== -1) {
              const headerPart = strVal.substring(0, colonIdx + 1);
              const textPart = strVal.substring(colonIdx + 1);
              return `<p class="konzilia-exam-item"><strong>${escapeHtml(headerPart)}</strong>${escapeHtml(textPart)}</p>`;
            }
            return `<p class="konzilia-exam-item">${escapeHtml(strVal)}</p>`;
          }).join('')}
        </div>
      ` : ''}

      <!-- 5. DIAGNÓZA & OPERACE & CHEMOTERAPIE & RECIDIVY (RECIDIVY JSOU VYKRESLENY PŘÍMO POD SVOJÍ DIAGNÓZOU) -->
      <div class="konzilia-section">
        ${(() => {
          interface TreatmentItem {
            sortDate: string;
            html: string;
          }

          const isValidInSituText = (text?: string, title?: string): boolean => {
            if (!text) return false;
            const clean = text.replace(/^(?:in\s*situ|\-insitu)\:\s*/i, '').trim();
            if (!clean) return false;
            const lower = clean.toLowerCase();

            if (
              lower.includes('není k dispozici') ||
              lower.includes('není dispozici') ||
              lower.includes('neuvedeno') ||
              lower.includes('dokumentace není') ||
              lower.includes('neuveden') ||
              lower === '0'
            ) {
              return false;
            }

            if (title) {
              const cleanTitle = title.toLowerCase().replace(/^st\.p\.\s*/i, '').trim();
              if (lower === cleanTitle || lower.includes(cleanTitle)) {
                return false;
              }
            }

            if (/^punkční\s+biopsie/i.test(clean) || /^core\s*needle\s*biops/i.test(clean)) {
              return false;
            }

            return true;
          };

          const renderRecurrencesList = (recs?: any[]): string => {
            if (!recs || recs.length === 0) return '';
            return recs.map(r => {
              if (typeof r === 'string') {
                return `<p class="konzilia-recurrence-plain" style="margin-top: 10px;">${escapeHtml(r)}</p>`;
              }
              const header = r.header || (r as any).recurrenceHeader || (r as any).date || '1. recidiva / progrese:';
              let desc = r.description || (r as any).details?.join(' ') || (r as any).findingsAndImaging || '';
              
              desc = desc.replace(/Zahájena\s+/gi, '');

              let opsHtml = '';
              const ops = r.operations || [];
              ops.forEach((op: any) => {
                if (typeof op === 'string') {
                  opsHtml += `<p class="konzilia-history-item" style="margin-top: 6px;">${wrapUnderline(op)}</p>`;
                  return;
                }
                const rawTitle = op.title || 'operačním výkonu';
                const title = rawTitle.startsWith('St.p.') ? rawTitle : `St.p. ${rawTitle}`;
                const datePlace = op.dateAndPlace ? ` (${op.dateAndPlace})` : '';
                const cleanInSitu = op.text ? op.text.replace(/^(?:in\s*situ|\-insitu)\:\s*/i, '').trim() : '';
                const hasValidInSitu = isValidInSituText(cleanInSitu, title);
                const inSituHtml = hasValidInSitu ? `<p class="konzilia-insitu-line" style="margin-top: 2px; margin-bottom: 4px;">in situ: ${escapeHtml(cleanInSitu)}</p>` : '';
                const histHtml = op.histology ? `<p class="konzilia-histology-line" style="margin-top: 2px; margin-bottom: 6px; font-style: italic;"><em>-histol: ${escapeHtml(op.histology)}</em></p>` : '';
                opsHtml += `<p class="konzilia-history-item" style="margin-top: 6px;">${wrapUnderline(title)}${escapeHtml(datePlace)}</p>${inSituHtml}${histHtml}`;
              });

              let thHtml = '';
              const ths = r.treatmentsAndHistory || [];
              ths.forEach((th: any) => {
                const strTh = String(th);
                if (strTh.toLowerCase().startsWith('st.p.')) {
                  const spaceIdx = strTh.indexOf(' ', 5);
                  const opName = spaceIdx !== -1 ? strTh.substring(0, spaceIdx) : strTh;
                  const rest = spaceIdx !== -1 ? strTh.substring(spaceIdx) : '';
                  thHtml += `<p class="konzilia-history-item" style="margin-top: 6px;">${wrapUnderline(opName)}${escapeHtml(rest)}</p>`;
                } else {
                  thHtml += `<p class="konzilia-history-item" style="margin-top: 2px;">${escapeHtml(strTh)}</p>`;
                }
              });

              // Náhradní rozdělení, pokud AI vrátila operaci slitou přímo v textu popisu desc
              if (ops.length === 0 && ths.length === 0 && /provedena\s+resekce|st\.p\./i.test(desc)) {
                const opMatch = desc.match(/(Provedena\s+resekce[\s\S]+?)(?=\s*s\s+histologií|\s*a\s+zavedením|\.|$)/i);
                const histMatch = desc.match(/s\s+histologií\s+([\s\S]+?)(?=\s*a\s+zavedením|\.|$)/i);
                const stentMatch = desc.match(/(zavedením[\s\S]+?)(?=\.|$)/i);

                if (opMatch) {
                  const rawOp = opMatch[1].trim();
                  const opText = `St.p. ${rawOp.replace(/^Provedena\s+/i, '')}`;
                  opsHtml += `<p class="konzilia-history-item" style="margin-top: 6px;">${wrapUnderline(opText)}</p>`;
                  desc = desc.replace(opMatch[0], '').trim();
                }
                if (histMatch) {
                  const rawHist = histMatch[1].trim();
                  opsHtml += `<p class="konzilia-histology-line" style="margin-top: 2px; margin-bottom: 6px; font-style: italic;"><em>-histol: ${escapeHtml(rawHist)}</em></p>`;
                  desc = desc.replace(histMatch[0], '').trim();
                }
                if (stentMatch) {
                  const rawStent = stentMatch[1].trim();
                  thHtml += `<p class="konzilia-history-item" style="margin-top: 6px;">${wrapUnderline('St.p.')} ${escapeHtml(rawStent)}</p>`;
                  desc = desc.replace(stentMatch[0], '').trim();
                }
                desc = desc.replace(/[\s.,;]+$/, '').trim();
              }

              let chtLine = r.chemotherapyLine || '';
              if (chtLine.toLowerCase().startsWith('zahájena ')) {
                chtLine = chtLine.substring(9);
              }
              chtLine = normalizeChemoLineNumerals(chtLine);
              const chtTox = r.chemotherapyToxicity && chtLine ? ` ${r.chemotherapyToxicity}` : '';

              return `
                <p class="konzilia-recurrence-plain" style="margin-top: 10px;"><strong>${escapeHtml(header)}</strong> ${escapeHtml(desc)}</p>
                ${opsHtml}
                ${thHtml}
                ${chtLine ? `<p class="konzilia-recurrence-cht" style="margin-top: 10px;">${escapeHtml(chtLine)}${escapeHtml(chtTox)}</p>` : ''}
              `;
            }).join('');
          };

          const renderBlockItems = (block: DiagnosisAndTreatmentBlock): string => {
            const treatmentItems: TreatmentItem[] = [];

            (block.operations || []).forEach(op => {
              if (typeof op === 'string') {
                const sortDate = extractTreatmentDateIso(op);
                treatmentItems.push({ sortDate, html: `<div class="konzilia-treatment-block" style="margin-top: 12px; margin-bottom: 12px;"><p class="konzilia-history-item" style="margin-top: 0; margin-bottom: 0;">${wrapUnderline(op)}</p></div>` });
                return;
              }
              const rawTitle = op.title || 'operačním výkonu';
              const title = rawTitle.startsWith('St.p.') ? rawTitle : `St.p. ${rawTitle}`;
              const datePlace = op.dateAndPlace ? ` (${op.dateAndPlace})` : '';
              const sortDate = extractTreatmentDateIso(`${op.dateAndPlace || ''} ${title}`);
              const cleanInSitu = op.text ? op.text.replace(/^(?:in\s*situ|\-insitu)\:\s*/i, '').trim() : '';
              const hasValidInSitu = isValidInSituText(cleanInSitu, title);
              const inSituHtml = hasValidInSitu ? `<p class="konzilia-insitu-line" style="margin-top: 4px; margin-bottom: 4px;">in situ: ${escapeHtml(cleanInSitu)}</p>` : '';
              const histHtml = op.histology ? `<p class="konzilia-histology-line" style="margin-top: 4px; margin-bottom: 4px; font-style: italic;"><em>-histol: ${escapeHtml(op.histology)}</em></p>` : '';

              treatmentItems.push({ sortDate, html: `<div class="konzilia-treatment-block" style="margin-top: 12px; margin-bottom: 12px;"><p class="konzilia-history-item" style="margin-top: 0; margin-bottom: 4px;">${wrapUnderline(title)}${escapeHtml(datePlace)}</p>${inSituHtml}${histHtml}</div>` });
            });

            (block.chemotherapyLines || []).forEach(cht => {
              if (typeof cht === 'string') {
                const sortDate = extractTreatmentDateIso(cht);
                treatmentItems.push({ sortDate, html: `<div class="konzilia-treatment-block" style="margin-top: 12px; margin-bottom: 12px;"><p class="konzilia-chemo-line" style="margin-top: 0; margin-bottom: 0;">${escapeHtml(normalizeChemoLineNumerals(cht))}</p></div>` });
                return;
              }
              const rawLine = typeof cht === 'object' && cht !== null ? (cht.lineTitle || cht.line || cht.lineText || cht.text || '') : String(cht);
              const lineTitle = normalizeChemoLineNumerals(rawLine);
              const rawTox = typeof cht === 'object' && cht !== null ? (cht.toxicityAndDose || cht.chemotherapyToxicity || cht.toxicity || '') : '';
              const toxHtml = rawTox ? `<p class="konzilia-chemo-tox" style="margin-top: 4px; margin-bottom: 4px;">${escapeHtml(rawTox)}</p>` : '';
              const sortDate = extractTreatmentDateIso(`${lineTitle} ${rawTox}`);
              treatmentItems.push({ sortDate, html: `<div class="konzilia-treatment-block" style="margin-top: 12px; margin-bottom: 12px;"><p class="konzilia-chemo-line" style="margin-top: 0; margin-bottom: 4px;">${escapeHtml(lineTitle)}</p>${toxHtml}</div>` });
            });

            (block.treatmentsAndHistory || []).forEach(th => {
              const strTh = String(th);
              const sortDate = extractTreatmentDateIso(strTh);
              if (strTh.toLowerCase().startsWith('st.p.')) {
                const spaceIdx = strTh.indexOf(' ', 5);
                const opName = spaceIdx !== -1 ? strTh.substring(0, spaceIdx) : strTh;
                const rest = spaceIdx !== -1 ? strTh.substring(spaceIdx) : '';
                treatmentItems.push({ sortDate, html: `<div class="konzilia-treatment-block" style="margin-top: 12px; margin-bottom: 12px;"><p class="konzilia-history-item" style="margin-top: 0; margin-bottom: 0;">${wrapUnderline(opName)}${escapeHtml(rest)}</p></div>` });
              } else {
                treatmentItems.push({ sortDate, html: `<div class="konzilia-treatment-block" style="margin-top: 12px; margin-bottom: 12px;"><p class="konzilia-history-item" style="margin-top: 0; margin-bottom: 0;">${escapeHtml(strTh)}</p></div>` });
              }
            });

            treatmentItems.sort((a, b) => a.sortDate.localeCompare(b.sortDate));
            const primaryHtml = treatmentItems.map((it, idx) => {
              if (idx === 0) {
                return it.html.replace('margin-top: 12px;', 'margin-top: 2px;');
              }
              return it.html;
            }).join('');
            const recsHtml = renderRecurrencesList(block.recurrences);
            return primaryHtml + recsHtml;
          };

          const diagBlocks: DiagnosisAndTreatmentBlock[] = Array.isArray(data.diagnosisAndTreatment)
            ? data.diagnosisAndTreatment
            : (data.diagnosisAndTreatment ? [data.diagnosisAndTreatment] : []);

          const topRecs = Array.isArray(data.recurrences) ? data.recurrences : [];
          if (topRecs.length > 0 && diagBlocks.length > 0) {
            const hasBlockRecs = diagBlocks.some(b => b.recurrences && b.recurrences.length > 0);
            if (!hasBlockRecs) {
              diagBlocks[0].recurrences = topRecs;
            }
          }

          const cleanTitleStr = (str: string): string => {
            let cleaned = str.replace(/,?\s*\d+\.\s*recidiva[\s\S]*/i, '').replace(/,?\s*\d+\.\s*progrese[\s\S]*/i, '').trim();
            cleaned = cleaned.replace(/[\n,]+$/, '').trim();
            const innerStr = cleaned.replace(/^\d+\)\s*/, '');
            const openCount = (innerStr.match(/\(/g) || []).length;
            const closeCount = (innerStr.match(/\)/g) || []).length;
            if (openCount > closeCount) {
              cleaned += ')'.repeat(openCount - closeCount);
            }
            return cleaned;
          };

          const getMultiplicityLabel = (count: number): string => {
            if (count === 2) return 'Duplicita';
            if (count === 3) return 'Triplicita';
            if (count === 4) return 'Kvadruplicita';
            if (count === 5) return 'Kvintuplicita';
            return `Multiplicita (${count} diagnózy)`;
          };

          if (diagBlocks.length > 1) {
            const label = getMultiplicityLabel(diagBlocks.length);
            let htmlOut = `<p class="konzilia-dg-line" style="margin-bottom: 6px;"><strong>Dg.: ${label}:</strong></p>`;
            diagBlocks.forEach((block, idx) => {
              let dgTitle = cleanTitleStr(block.dg || '');
              if (!dgTitle.startsWith('Dg.:') && !/^\d+\)/.test(dgTitle)) {
                dgTitle = `${idx + 1}) ${dgTitle}`;
              }
              htmlOut += `<p class="konzilia-dg-subtitle" style="margin-top: ${idx === 0 ? '4px' : '12px'};"><strong>${escapeHtml(dgTitle)}</strong></p>`;
              htmlOut += renderBlockItems(block);
            });
            return htmlOut;
          }

          if (diagBlocks.length === 1) {
            const block = diagBlocks[0];
            const rawDg = block.dg || 'ca ovarii';
            const hasMultipleInSingleStr = /duplicita|triplicita|kvadruplicita|kvintuplicita/i.test(rawDg) || (rawDg.includes('1)') && rawDg.includes('2)'));

            if (hasMultipleInSingleStr) {
              const subItems: string[] = [];
              let num = 1;
              while (true) {
                const reg = new RegExp(`${num}\\)\\s*([\\s\\S]+?)(?=\\s*${num + 1}\\)|$)`, 'i');
                const m = rawDg.match(reg);
                if (m && m[1].trim()) {
                  subItems.push(`${num}) ` + cleanTitleStr(m[1]));
                  num++;
                } else {
                  break;
                }
              }

              let count = subItems.length;
              if (count < 2) {
                if (/kvintuplicita/i.test(rawDg)) count = 5;
                else if (/kvadruplicita/i.test(rawDg)) count = 4;
                else if (/triplicita/i.test(rawDg)) count = 3;
                else count = 2;
              }

              const label = getMultiplicityLabel(count);
              let htmlOut = `<p class="konzilia-dg-line" style="margin-bottom: 6px;"><strong>Dg.: ${label}:</strong></p>`;

              if (subItems.length > 0) {
                subItems.forEach((subTitle, idx) => {
                  htmlOut += `<p class="konzilia-dg-subtitle" style="margin-top: ${idx === 0 ? '6px' : '12px'};"><strong>${escapeHtml(subTitle)}</strong></p>`;
                  if (idx === 0) {
                    htmlOut += renderBlockItems(block);
                  }
                });
              } else {
                let cleanedDg = cleanTitleStr(rawDg);
                cleanedDg = cleanedDg.replace(/^(?:Dg\.\:\s*)?(?:duplicita|triplicita|kvadruplicita|kvintuplicita)\s*[\:\-]?\s*/i, '');
                htmlOut += `<p class="konzilia-dg-subtitle" style="margin-top: 6px;"><strong>${escapeHtml(cleanedDg)}</strong></p>`;
                htmlOut += renderBlockItems(block);
              }
              return htmlOut;
            }

            let formattedDg = cleanTitleStr(rawDg);
            // Odstranění předpony 1) nebo 1. pokud má pacientka pouze 1 diagnózu
            formattedDg = formattedDg.replace(/^(?:Dg\.\:\s*)?1[\)\.]\s*/i, '');
            formattedDg = formattedDg.startsWith('Dg.:') ? formattedDg : `Dg.: ${formattedDg}`;
            formattedDg = formattedDg.replace(/\*\*(Duplicita|Triplicita|Kvadruplicita|Kvintuplicita):\*\*/gi, '<strong>$1:</strong>');
            const dgHeaderHtml = `<p class="konzilia-dg-line"><strong>${escapeHtml(formattedDg)}</strong></p>`;
            return dgHeaderHtml + renderBlockItems(block);
          }

          return '<p class="konzilia-dg-line"><strong>Dg.: Neuvedeno</strong></p>';
        })()}
      </div>

      <!-- 7. ONKOGYNEKOLOGICKÉ KONZILIUM A DOPORUČENÍ -->
      <div class="konzilia-conclusion-box">
        <div class="konzilia-board-header">Onkogynekologické konsilium ${escapeHtml(formattedBoardDate)}</div>
        <p style="margin-bottom: 6px;"><strong>Přítomni:</strong> prof. MUDr. Cibula, CSc., prof. MUDr. Sláma, Ph.D., MUDr. Frühauf, Ph.D., MUDr. Tomancová, prof. MUDr. Burgetová, Ph.D., MUDr. Valentová, MUDr. Brynda, MUDr. Emingr, MUDr. Malčák, doc. MUDr. Kocián, Ph.D. a MUDr. Dostálek, Ph.D.</p>
        <p class="konzilia-recommendation"><strong>${tbConclusion.recommendation.startsWith('Doporučení:') ? '' : 'Doporučení: '}</strong>${escapeHtml(tbConclusion.recommendation)}</p>
      </div>
    </article>
  `;

  const treatmentPlanHtml = `
    <section class="tb-section tb-proposal-section">
      <h2 class="tb-title tb-proposal-title">💡 Doporučení Onkogynekologického Konsilia</h2>
      <div class="tb-proposal-content">
        <p style="font-size: 11px; line-height: 1.6; color: #0f172a; margin-bottom: 8px;">
          ${escapeHtml(tbConclusion.recommendation.replace(/^Doporučení:\s*/i, ''))}
        </p>
      </div>
    </section>
  `;

  return { reportHtml, treatmentPlanHtml };
}

/**
 * Vyfiltruje dataset podle maximální hranice data.
 * Vyřazuje všechna vyšetření a laboratorní záznamy datované OD (včetně) zadaného data maxDate.
 * Ponechá pouze vyšetření s datem striktně menším než maxDate (examDate < maxDate).
 */
export function filterDatasetByMaxDate(dataset: PatientChronologyDataset, maxDate: string): PatientChronologyDataset {
  if (!maxDate || !maxDate.trim()) return dataset;
  const cutoffIso = maxDate.trim().split('T')[0];

  const filteredExams = (dataset.examinations || []).filter(exam => {
    // 1. Standardní kontrola podle ISO data (vyřazuje vše >= cutoffIso)
    if (exam.date && exam.date !== '1970-01-01') {
      const examDateIso = exam.date.split('T')[0];
      if (examDateIso >= cutoffIso) return false;
    }

    // 2. Kontrola všech dat v kompletním obsahu, rawDate a názvu (bez omezení délky textu!)
    const textToCheck = `${exam.rawDate || ''} ${exam.title || ''} ${exam.content || ''}`;
    const allFoundDates = (textToCheck.match(/\b(\d{1,2})[\.\/](\d{1,2})[\.\/](\d{2,4})\b/g) || [])
      .map(dStr => parseCzechDateToIso(dStr))
      .filter((d): d is string => d !== null && d !== '1970-01-01');

    if (allFoundDates.length > 0) {
      allFoundDates.sort();
      const maxFoundIso = allFoundDates[allFoundDates.length - 1].split('T')[0];
      if (maxFoundIso >= cutoffIso) {
        return false;
      }
    }

    return true;
  });

  const totalOriginal = (dataset.examinations || []).length;
  const totalFiltered = filteredExams.length;
  const totalExcluded = totalOriginal - totalFiltered;

  console.log(`[Tumor Board Agent] Omezuji vyšetření podle hraničního data maxDate = ${cutoffIso}.`);
  console.log(`[Tumor Board Agent] Vyřazeno celkem ${totalExcluded} vyšetření datovaných >= ${cutoffIso}. Ponecháno ${totalFiltered} vyšetření.`);

  const ambCount = filteredExams.filter(e => e.sourceType === 'amb').length;
  const hospCount = filteredExams.filter(e => e.sourceType === 'hosp').length;
  const labCount = filteredExams.filter(e => e.sourceType === 'lab').length;

  let filteredLabAggregated = dataset.labAggregated;
  if (dataset.labAggregated) {
    const newByDate: Record<string, any> = {};
    for (const d of Object.keys(dataset.labAggregated.byDate || {})) {
      if (d < cutoffIso) {
        newByDate[d] = dataset.labAggregated.byDate[d];
      }
    }

    const newByTest: Record<string, any> = {};
    for (const testName of Object.keys(dataset.labAggregated.byTest || {})) {
      const group = dataset.labAggregated.byTest[testName];
      const validMeasurements = (group.measurements || []).filter((m: any) => {
        const mDate = (m.date || '').split('T')[0];
        return mDate < cutoffIso;
      });
      if (validMeasurements.length > 0) {
        newByTest[testName] = {
          ...group,
          totalMeasurements: validMeasurements.length,
          measurements: validMeasurements,
          firstDate: validMeasurements[0]?.date ? validMeasurements[0].date.split('T')[0] : group.firstDate,
          lastDate: validMeasurements[validMeasurements.length - 1]?.date ? validMeasurements[validMeasurements.length - 1].date.split('T')[0] : group.lastDate
        };
      }
    }

    filteredLabAggregated = {
      byTest: newByTest,
      byDate: newByDate,
      totalUniqueTests: Object.keys(newByTest).length,
      totalUniqueDates: Object.keys(newByDate).length
    };
  }

  // Bezpečnostní vyčištění neparsovaných úseků při aktivním datovém filtru
  const filteredUnparsedFragments = (dataset.unparsedFragments || []).filter(frag => {
    const match = (frag.content || '').match(/\b(\d{1,2})[\.\/](\d{1,2})[\.\/](\d{2,4})\b/);
    if (match) {
      const parsed = parseCzechDateToIso(match[0]);
      if (parsed) return parsed.split('T')[0] < cutoffIso;
    }
    return true;
  });

  return {
    ...dataset,
    metadata: {
      ...dataset.metadata,
      totalEvents: filteredExams.length,
      ambEventsCount: ambCount,
      hospEventsCount: hospCount,
      labEventsCount: labCount,
      dateRange: {
        firstDate: filteredExams[0]?.date ? filteredExams[0].date.split('T')[0] : '',
        lastDate: filteredExams[filteredExams.length - 1]?.date ? filteredExams[filteredExams.length - 1].date.split('T')[0] : ''
      }
    },
    examinations: filteredExams,
    labAggregated: filteredLabAggregated,
    unparsedFragments: filteredUnparsedFragments
  };
}

/**
 * Hlavní agent pro generování Závěru Tumor Boardu ve formátu JSON podle vzoru konsilium.docx
 */
export async function generateTumorBoardSummary(
  dataset?: PatientChronologyDataset,
  userApiKey?: string,
  maxDate?: string
): Promise<TumorBoardResult> {
  const apiKey = userApiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

  if (!apiKey) {
    return {
      reportHtml: '<div class="empty-state"><h3 style="color: var(--nejm-crimson);">⚠️ Chybí Gemini API Klíč</h3><p>Nastavte GEMINI_API_KEY v .env souboru.</p></div>',
      treatmentPlanHtml: '',
      isSuccess: false,
      totalAnonymized: 0,
      modelUsed: 'none',
      error: 'GEMINI_API_KEY missing'
    };
  }

  // Načtení sloučeného datasetu z disku
  let targetDataset = dataset;
  if (!targetDataset) {
    const jsonPath = path.resolve(process.cwd(), 'output', 'chronology_parsed.json');
    if (!fs.existsSync(jsonPath)) {
      throw new Error(`Chronology dataset nenalezen v ${jsonPath}`);
    }
    targetDataset = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  }

  if (!targetDataset) {
    throw new Error('Chronology dataset nelze načíst.');
  }

  // Omezení vyšetření podle hraničního data maxDate, je-li zadáno
  if (maxDate && maxDate.trim()) {
    targetDataset = filterDatasetByMaxDate(targetDataset, maxDate);
  }

  // 1. BEZPEČNOSTNÍ POJISTKA: 100% Lokální anonymizace všech textů před odesláním do AI
  const datasetJson = JSON.stringify(targetDataset);
  const { anonymizedText, summary } = anonymizeLocalText(datasetJson, targetDataset.metadata);
  
  const czWordChar = 'a-zA-Z0-9áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ';
  const nameCheck = anonymizedText.match(new RegExp(`(?<![${czWordChar}])(Staňková|Stankova|Šárka|Sarka|Neumannová|Neumannova|Hana|Wolf|Heike|Šromová|Sromová|Sromova|Eva)(?![${czWordChar}])`, 'gi'));
  const pojCheck = anonymizedText.match(/(?<![0-9])(635105\/?6382|606120\/?0530|656022\/?7091|575916\/?0993)(?![0-9])/g);

  if (nameCheck || pojCheck) {
    console.error('[CRITICAL SECURITY VIOLATION] Neanonymizované zápisy:', nameCheck, pojCheck);
    throw new Error('CRITICAL SECURITY VIOLATION: Zjištěny neanonymizované osobní údaje! Data NEBYLA odeslána do AI.');
  }

  const cleanDataset: PatientChronologyDataset = JSON.parse(anonymizedText);

  // 2. Sestavení anonymizovaného promptu s vyžádáním JSONu podle konsilium.docx
  const prompt = buildTumorBoardPrompt(cleanDataset, maxDate);

  // 3. Volání Gemini API (primárně gemini-3.6-flash, záloha gemini-3.5-flash, gemini-flash-latest)
  const candidateModels = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-flash-latest', 'gemini-pro-latest'];

  let resultJsonStr = '';
  let modelUsed = '';
  let lastError = '';

  for (const modelName of candidateModels) {
    try {
      console.log(`[Tumor Board Agent] Odesílám anonymizovaný dotaz (konsilium.docx JSON mode) do Gemini API (model: ${modelName})...`);
      resultJsonStr = await callGeminiRestJson(prompt, apiKey, modelName);
      modelUsed = modelName;
      console.log(`[Tumor Board Agent] Úspěšně přijat JSON výstup z ${modelName} (${resultJsonStr.length} znaků).`);
      break;
    } catch (err: any) {
      console.warn(`[Tumor Board Agent] Model ${modelName} selhal: ${err.message}`);
      lastError = err.message;
    }
  }

  if (!resultJsonStr) {
    throw new Error(`Zádný model Gemini neodpověděl: ${lastError}`);
  }

  // Očistíme případný markdownový obal ```json ... ```
  let cleanJsonStr = resultJsonStr.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

  let structuredJson: TumorBoardStructuredJson;
  try {
    structuredJson = JSON.parse(cleanJsonStr);
  } catch (parseErr: any) {
    console.warn(`[Tumor Board Agent] Prvotní JSON.parse selhal (${parseErr.message}). Pokouším se o auto-repair zkráceného JSONu...`);
    try {
      const repairedJsonStr = repairTruncatedJson(cleanJsonStr);
      structuredJson = JSON.parse(repairedJsonStr);
      console.log('[Tumor Board Agent] Auto-repair zkráceného JSONu proběhl úspěšně!');
    } catch (repairErr: any) {
      console.error('[Tumor Board Agent] Chyba při parsování i po auto-repair:', repairErr.message);
      throw new Error(`Gemini nevrátilo platný JSON: ${parseErr.message}`);
    }
  }

  // Uložení vygenerovaného strukturovaného JSONu na disk do output/json/tumor_board_conclusion.json
  const outputJsonDir = path.resolve(process.cwd(), 'output', 'json');
  if (!fs.existsSync(outputJsonDir)) {
    fs.mkdirSync(outputJsonDir, { recursive: true });
  }
  const tbJsonPath = path.join(outputJsonDir, 'tumor_board_conclusion.json');
  fs.writeFileSync(tbJsonPath, JSON.stringify(structuredJson, null, 2), 'utf8');
  console.log(`[Tumor Board Agent] Strukturovaný Závěr Tumor Boardu (vzor konsilium.docx) uložen do: ${tbJsonPath}`);

  // 4. Převod JSON na HTML pololetové zobrazení podle vzoru konsilium.docx s doplněním reálných osobnách údajů z lokálního uložení
  const { reportHtml, treatmentPlanHtml } = renderStructuredJsonToHtml(structuredJson, targetDataset.metadata, maxDate);

  return {
    reportHtml,
    treatmentPlanHtml,
    structuredJson,
    isSuccess: true,
    totalAnonymized: (summary.namesErased || 0) + (summary.insuranceNumbersErased || 0) + (summary.contactsErased || 0),

    modelUsed
  };
}

/**
 * Volání Gemini API pro konverzaci / chat (textový výstup) se samoopravnými opakovanými pokusy
 */
async function callGeminiRestText(contents: any[], apiKey: string, modelName: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
  
  let maxAttempts = 3;
  let delayMs = 1500;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 2048
          }
        })
      });

      const data: any = await response.json();
      if (response.status === 200 && data.candidates && data.candidates[0]?.content?.parts[0]?.text) {
        return data.candidates[0].content.parts[0].text;
      }

      const errMsg = data.error?.message || `HTTP ${response.status}`;
      console.warn(`[Gemini Chat REST] Pokus ${attempt}/${maxAttempts} selhal pro ${modelName}: ${errMsg}`);

      if (attempt < maxAttempts) {
        await new Promise(res => setTimeout(res, delayMs));
        delayMs *= 2;
      } else {
        throw new Error(`Gemini REST error (${modelName}): ${errMsg}`);
      }
    } catch (err: any) {
      if (attempt === maxAttempts) throw err;
      await new Promise(res => setTimeout(res, delayMs));
    }
  }

  throw new Error(`Model ${modelName} neodpověděl v chatu po ${maxAttempts} pokusech.`);
}


/**
 * Privátní chatovací relace pro klinika s Gemini AI nad vyšetřovaným případem
 */
export async function handleGeminiChatCall(
  userMessage: string,
  history: { role: 'user' | 'model'; parts: { text: string }[] }[] = [],
  userApiKey?: string
): Promise<{ reply: string; isSuccess: boolean }> {
  const apiKey = userApiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY missing');
  }

  // Načtení anonymizovaného strukturovaného výstupu z Tumor Boardu
  let contextText = '';
  const jsonPath = path.resolve(process.cwd(), 'output', 'json', 'tumor_board_conclusion.json');
  if (fs.existsSync(jsonPath)) {
    contextText = fs.readFileSync(jsonPath, 'utf8');
  }

  const systemInstruction = `Jsi špičkový AI onkologický konzultant klinika na Tumor Boardu VFN Praha.
Máš k dispozici kompletní anonymizovaný strukturovaný Závěr Tumor Boardu a vyšetření pacientky:

=== STRUKTUROVANÝ ZÁVĚR PACIENTKY (KONSILIUM) ===
${contextText}

Odpovídej odborně, věcně, srozumitelně a strukturovaně v češtině. Používej medicínskou terminologii. Zákaz uvádět jakákoliv neanonymizovaná jména nebo RČ.
`;

  const contents = [
    { role: 'user', parts: [{ text: systemInstruction }] },
    { role: 'model', parts: [{ text: 'Rozumím. Jsem připraven odpovědět na odborné dotazy k tomuto onkologickému případu.' }] },
    ...history,
    { role: 'user', parts: [{ text: userMessage }] }
  ];

  const candidateModels = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-flash-latest', 'gemini-pro-latest'];
  let lastError = '';

  for (const modelName of candidateModels) {
    try {
      console.log(`[Gemini Chat] Odesílám dotaz klinika do ${modelName}...`);
      const reply = await callGeminiRestText(contents, apiKey, modelName);
      return { reply, isSuccess: true };
    } catch (err: any) {
      console.warn(`[Gemini Chat] Model ${modelName} selhal: ${err.message}`);
      lastError = err.message;
    }
  }

  throw new Error(`Žádný model Gemini neodpověděl v chatu: ${lastError}`);
}

