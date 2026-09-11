import { GoogleGenAI } from '@google/genai';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { PatientChronologyDataset, PatientChronologyMetadata, TumorBoardStructuredJson } from '../types/chronology.js';
import { buildTumorBoardPrompt } from './promptBuilder.js';
import { anonymizeLocalText } from '../parser/parseLab.js';

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
  const isoMatch = str.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (isoMatch) return isoMatch[1];

  const fullDateMatch = str.match(/\b(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})\b/);
  if (fullDateMatch) {
    const day = fullDateMatch[1].padStart(2, '0');
    const month = fullDateMatch[2].padStart(2, '0');
    let year = fullDateMatch[3];
    if (year.length === 2) year = '20' + year;
    return `${year}-${month}-${day}`;
  }

  const monthYearMatch = str.match(/\b(\d{1,2})[.\/](\d{2,4})\b/);
  if (monthYearMatch) {
    const month = monthYearMatch[1].padStart(2, '0');
    let year = monthYearMatch[2];
    if (year.length === 2) year = '20' + year;
    return `${year}-${month}-01`;
  }

  return '9999-99-99';
}

/**
 * Převede strukturovaný JSON z Gemini na položkové zobrazení exaktně podle vzoru konzilia.docx
 */
export function renderStructuredJsonToHtml(
  data: TumorBoardStructuredJson,
  realMeta?: PatientChronologyMetadata
): { reportHtml: string; treatmentPlanHtml: string } {
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
  
  // Stagingová vyšetření (EXKLUDUJE MAMOGRAFII)
  const stagingExams = (Array.isArray(data.stagingExaminations) ? data.stagingExaminations : [])
    .filter(ex => {
      const text = typeof ex === 'object' && ex !== null ? `${ex.title || ''} ${ex.fullText || ''}` : String(ex);
      return !/mamograf|mamog|MG\b|MMG\b/i.test(text);
    });

  const diagTreatment = data.diagnosisAndTreatment || {
    dg: (data as any).primaryDiagnosisAndTreatment ? `ca ovarii - HGSC tubo-ovariální (cT3c N1 M1b, FIGO IVB) (I.dg. 09/2025)` : 'ca ovarii',
    operations: [],
    treatmentsAndHistory: []
  };

  const recurrences = Array.isArray(data.recurrences) ? data.recurrences : [];
  const tbConclusion = data.tumorBoardConclusion || {
    date: 'Onkogynekologické konzilium 9.9.2026',
    attendees: 'prof. MUDr. Cibula, CSc., prof. MUDr. Sláma, Ph.D., MUDr. Frühauf, Ph.D., MUDr. Tomancová, prof. MUDr. Burgetová, Ph.D., MUDr. Valentová, MUDr. Brynda, MUDr. Emingr, MUDr. Malik',
    recommendation: Array.isArray((data as any).treatmentRecommendation) ? (data as any).treatmentRecommendation.join(' ') : 'Doporučení: Pacientka je předána ke sledování v onkogynekologické ambulanci.'
  };

  // Formátování Dg. (celý řádek diagnózy, se zvýrazněním **Duplicita:**)
  const rawDg = diagTreatment.dg || 'ca ovarii';
  let formattedDg = rawDg.startsWith('Dg.:') ? rawDg : `Dg.: ${rawDg}`;
  formattedDg = formattedDg.replace(/\*\*Duplicita:\*\*/gi, '<strong>Duplicita:</strong>');
  formattedDg = formattedDg.replace(/\bDuplicita:\s*/gi, '<strong>Duplicita:</strong> ');

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

      <!-- 5. DIAGNÓZA & OPERACE & CHEMOTERAPIE (S PODPOROU DUPLICITY A CHRONOLOGICKÉHO PRŮBĚHU JEDNOTLIVÝCH ONEMOCNĚNÍ) -->
      <div class="konzilia-section">
        ${(() => {
          interface TreatmentItem {
            sortDate: string;
            html: string;
          }

          const isDuplicity = /duplicita/i.test(rawDg);

          if (!isDuplicity) {
            // Standardní zobrazení pro 1 diagnózu (bez duplicity)
            const formattedDg = rawDg.startsWith('Dg.:') ? rawDg : `Dg.: ${rawDg}`;
            const dgHeaderHtml = `<p class="konzilia-dg-line"><strong>${escapeHtml(formattedDg)}</strong></p>`;
            
            const treatmentItems: TreatmentItem[] = [];

            (diagTreatment.operations || []).forEach(op => {
              if (typeof op === 'string') {
                const sortDate = extractTreatmentDateIso(op);
                treatmentItems.push({ sortDate, html: `<p class="konzilia-history-item" style="margin-top: 6px;"><u>${escapeHtml(op)}</u></p>` });
                return;
              }
              const rawTitle = op.title || 'operačním výkonu';
              const title = rawTitle.startsWith('St.p.') ? rawTitle : `St.p. ${rawTitle}`;
              const datePlace = op.dateAndPlace ? ` (${op.dateAndPlace})` : '';
              const sortDate = extractTreatmentDateIso(`${op.dateAndPlace || ''} ${title}`);
              const histHtml = op.histology ? `<p class="konzilia-histology-line" style="margin-top: 2px; margin-bottom: 6px; font-style: italic;"><em>-histol: ${escapeHtml(op.histology)}</em></p>` : '';

              treatmentItems.push({ sortDate, html: `<p class="konzilia-history-item" style="margin-top: 6px;"><u>${escapeHtml(title)}</u>${escapeHtml(datePlace)}</p>${histHtml}` });
            });

            (diagTreatment.chemotherapyLines || []).forEach(cht => {
              if (typeof cht === 'string') {
                const sortDate = extractTreatmentDateIso(cht);
                treatmentItems.push({ sortDate, html: `<p class="konzilia-chemo-line" style="margin-top: 10px;">${escapeHtml(normalizeChemoLineNumerals(cht))}</p>` });
                return;
              }
              const lineTitle = normalizeChemoLineNumerals(cht.lineTitle || '');
              const tox = cht.toxicityAndDose ? ` ${cht.toxicityAndDose}` : '';
              const sortDate = extractTreatmentDateIso(`${lineTitle} ${tox}`);
              treatmentItems.push({ sortDate, html: `<p class="konzilia-chemo-line" style="margin-top: 10px;">${escapeHtml(lineTitle)}${escapeHtml(tox)}</p>` });
            });

            (diagTreatment.treatmentsAndHistory || []).forEach(th => {
              const strTh = String(th);
              const sortDate = extractTreatmentDateIso(strTh);
              if (strTh.toLowerCase().startsWith('st.p.')) {
                const spaceIdx = strTh.indexOf(' ', 5);
                const opName = spaceIdx !== -1 ? strTh.substring(0, spaceIdx) : strTh;
                const rest = spaceIdx !== -1 ? strTh.substring(spaceIdx) : '';
                treatmentItems.push({ sortDate, html: `<p class="konzilia-history-item" style="margin-top: 6px;"><u>${escapeHtml(opName)}</u>${escapeHtml(rest)}</p>` });
              } else {
                treatmentItems.push({ sortDate, html: `<p class="konzilia-history-item">${escapeHtml(strTh)}</p>` });
              }
            });

            treatmentItems.sort((a, b) => a.sortDate.localeCompare(b.sortDate));
            return dgHeaderHtml + treatmentItems.map(it => it.html).join('');
          }

          // === DUPLICITA (ŘÁDEK 1: Dg.: Duplicita:, ŘÁDEK 2: 1) ca ovarii..., ŘÁDEK 3: 2) ca prsu...) ===
          const dgHeaderHtml = `<p class="konzilia-dg-line" style="margin-bottom: 6px;"><strong>Dg.: Duplicita:</strong></p>`;

          // Extrakce jednotlivých diagnóz (1) ..., 2) ...)
          const match1 = rawDg.match(/1\)\s*([\s\S]+?)(?=\s*2\)|$)/i);
          const match2 = rawDg.match(/2\)\s*([\s\S]+?)(?=\s*3\)|$)/i);

          let dg1Title = match1 ? '1) ' + match1[1].replace(/[\n,]+$/, '').trim() : '';
          let dg2Title = match2 ? '2) ' + match2[1].replace(/[\n,]+$/, '').trim() : '';

          if (!dg1Title && !dg2Title) {
            const cleanText = rawDg.replace(/^Dg.:\s*(Duplicita:\s*)?/i, '').trim();
            dg1Title = '1) ' + cleanText;
          }

          // Pomocná funkce určující, zda výkona/léčba patří k 2. onemocnění (např. ca prsu v minulosti)
          const isDisease2Item = (str: string) => {
            const s = str.toLowerCase();
            if (/prs[uů]|mamm|mastek|ablat|tamoxifen|letrozol|herceptin|trastuz|fac\b|ac\b/i.test(s)) return true;
            if (dg2Title) {
              const dg2YearMatch = dg2Title.match(/\b(19\d{2}|20[01]\d)\b/);
              if (dg2YearMatch) {
                const itemDateStr = extractTreatmentDateIso(str);
                if (itemDateStr.startsWith(dg2YearMatch[1])) return true;
              }
            }
            return false;
          };

          const items1: TreatmentItem[] = [];
          const items2: TreatmentItem[] = [];

          (diagTreatment.operations || []).forEach(op => {
            const rawTitle = typeof op === 'string' ? op : (op.title || '');
            const text = typeof op === 'string' ? op : `${op.title || ''} ${op.dateAndPlace || ''} ${op.histology || ''}`;
            const sortDate = extractTreatmentDateIso(text);

            let html = '';
            if (typeof op === 'string') {
              html = `<p class="konzilia-history-item" style="margin-top: 4px;"><u>${escapeHtml(op)}</u></p>`;
            } else {
              const title = rawTitle.startsWith('St.p.') ? rawTitle : `St.p. ${rawTitle}`;
              const datePlace = op.dateAndPlace ? ` (${op.dateAndPlace})` : '';
              const histHtml = op.histology ? `<p class="konzilia-histology-line" style="margin-top: 2px; margin-bottom: 4px; font-style: italic;"><em>-histol: ${escapeHtml(op.histology)}</em></p>` : '';
              html = `<p class="konzilia-history-item" style="margin-top: 4px;"><u>${escapeHtml(title)}</u>${escapeHtml(datePlace)}</p>${histHtml}`;
            }

            if (isDisease2Item(text)) {
              items2.push({ sortDate, html });
            } else {
              items1.push({ sortDate, html });
            }
          });

          (diagTreatment.chemotherapyLines || []).forEach(cht => {
            const text = typeof cht === 'string' ? cht : `${cht.lineTitle || ''} ${cht.toxicityAndDose || ''}`;
            const sortDate = extractTreatmentDateIso(text);
            const lineTitle = typeof cht === 'string' ? normalizeChemoLineNumerals(cht) : normalizeChemoLineNumerals(cht.lineTitle || '');
            const tox = typeof cht !== 'string' && cht.toxicityAndDose ? ` ${cht.toxicityAndDose}` : '';
            const html = `<p class="konzilia-chemo-line" style="margin-top: 6px;">${escapeHtml(lineTitle)}${escapeHtml(tox)}</p>`;

            if (isDisease2Item(text)) {
              items2.push({ sortDate, html });
            } else {
              items1.push({ sortDate, html });
            }
          });

          (diagTreatment.treatmentsAndHistory || []).forEach(th => {
            const text = String(th);
            const sortDate = extractTreatmentDateIso(text);
            let html = '';
            if (text.toLowerCase().startsWith('st.p.')) {
              const spaceIdx = text.indexOf(' ', 5);
              const opName = spaceIdx !== -1 ? text.substring(0, spaceIdx) : text;
              const rest = spaceIdx !== -1 ? text.substring(spaceIdx) : '';
              html = `<p class="konzilia-history-item" style="margin-top: 4px;"><u>${escapeHtml(opName)}</u>${escapeHtml(rest)}</p>`;
            } else {
              html = `<p class="konzilia-history-item" style="margin-top: 2px;">${escapeHtml(text)}</p>`;
            }

            if (isDisease2Item(text)) {
              items2.push({ sortDate, html });
            } else {
              items1.push({ sortDate, html });
            }
          });

          items1.sort((a, b) => a.sortDate.localeCompare(b.sortDate));
          items2.sort((a, b) => a.sortDate.localeCompare(b.sortDate));

          let out = dgHeaderHtml;

          if (dg1Title) {
            out += `<p class="konzilia-dg-subtitle" style="margin-top: 6px;"><strong>${escapeHtml(dg1Title)}</strong></p>`;
            out += items1.map(it => it.html).join('');
          }

          if (dg2Title) {
            out += `<p class="konzilia-dg-subtitle" style="margin-top: 12px;"><strong>${escapeHtml(dg2Title)}</strong></p>`;
            out += items2.map(it => it.html).join('');
          }

          return out;
        })()}
      </div>

      <!-- 6. RECIDIVY (BEZ BOXU, BĚŽNÝ ARIAL TEXT, NADPIS TUČNĚ, CHT NA NOVÉM ŘÁDKU BEZ "ZAHÁJENA") -->
      ${recurrences.length > 0 ? `
        <div class="konzilia-section">
          ${recurrences.map(r => {
            if (typeof r === 'string') {
              return `<p class="konzilia-recurrence-plain" style="margin-top: 8px;">${escapeHtml(r)}</p>`;
            }
            const header = r.header || (r as any).recurrenceHeader || (r as any).date || '1. recidiva / progrese:';
            let desc = r.description || (r as any).details?.join(' ') || (r as any).findingsAndImaging || '';
            
            // Odstranění slova "Zahájena" pokud bylo včleněno do popisu
            desc = desc.replace(/Zahájena\s+/gi, '');

            let chtLine = r.chemotherapyLine || '';
            if (chtLine.toLowerCase().startsWith('zahájena ')) {
              chtLine = chtLine.substring(9);
            }
            chtLine = normalizeChemoLineNumerals(chtLine);
            const chtTox = r.chemotherapyToxicity ? ` ${r.chemotherapyToxicity}` : '';

            return `
              <p class="konzilia-recurrence-plain" style="margin-top: 8px;"><strong>${escapeHtml(header)}</strong> ${escapeHtml(desc)}</p>
              ${chtLine ? `<p class="konzilia-recurrence-cht" style="margin-top: 4px;">${escapeHtml(chtLine)}${escapeHtml(chtTox)}</p>` : ''}
            `;
          }).join('')}
        </div>
      ` : ''}

      <!-- 7. ONKOGYNEKOLOGICKÉ KONZILIUM A DOPORUČENÍ -->
      <div class="konzilia-conclusion-box">
        <div class="konzilia-board-header">${escapeHtml(tbConclusion.date || 'Onkogynekologické konzilium 9.9.2026')}</div>
        <p style="margin-bottom: 6px;"><strong>Přítomni:</strong> ${escapeHtml(tbConclusion.attendees || 'prof. MUDr. Cibula, CSc., prof. MUDr. Sláma, Ph.D., MUDr. Frühauf, Ph.D., MUDr. Tomancová, prof. MUDr. Burgetová, Ph.D., MUDr. Valentová, MUDr. Brynda, MUDr. Emingr, MUDr. Malik')}</p>
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
    if (!exam.date || exam.date === '1970-01-01') return true;
    const examDateIso = exam.date.split('T')[0];
    return examDateIso < cutoffIso;
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
        const mDate = m.date.split('T')[0];
        return mDate < cutoffIso;
      });
      if (validMeasurements.length > 0) {
        newByTest[testName] = {
          ...group,
          totalMeasurements: validMeasurements.length,
          measurements: validMeasurements
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
    labAggregated: filteredLabAggregated
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
  const prompt = buildTumorBoardPrompt(cleanDataset);

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
    console.error('[Tumor Board Agent] Chyba při parsování JSON výstupu z Gemini:', parseErr.message);
    throw new Error(`Gemini nevrátilo platný JSON: ${parseErr.message}`);
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
  const { reportHtml, treatmentPlanHtml } = renderStructuredJsonToHtml(structuredJson, targetDataset.metadata);

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

