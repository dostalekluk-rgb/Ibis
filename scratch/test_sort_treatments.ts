import * as fs from 'fs';

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

interface TreatmentItem {
  type: 'operation' | 'chemotherapy' | 'other';
  sortDate: string;
  html: string;
}

const operations = [
  { title: 'St.p. interval debulking operaci', dateAndPlace: '15.02.2026, VFN', histology: 'HGSC' },
  { title: 'St.p. core needle biopsii', dateAndPlace: '03.09.2025, VFN', histology: 'Biopsie' }
];

const chemotherapyLines = [
  { lineTitle: 'St.p. 1. linii neoadjuvantní chemoterapie PTX/CBDCA (09/2025 - 01/2026)', toxicityAndDose: 'Bez redukce' }
];

const allTreatmentItems: TreatmentItem[] = [];

operations.forEach(op => {
  const dateStr = `${op.dateAndPlace || ''} ${op.title || ''}`;
  const sortDate = extractTreatmentDateIso(dateStr);
  const rawTitle = op.title || 'operačním výkonu';
  const title = rawTitle.startsWith('St.p.') ? rawTitle : `St.p. ${rawTitle}`;
  const datePlace = op.dateAndPlace ? ` (${op.dateAndPlace})` : '';
  const histHtml = op.histology ? `<p class="konzilia-histology-line" style="margin-top: 2px; margin-bottom: 6px; font-style: italic;"><em>-histol: ${op.histology}</em></p>` : '';
  const html = `<p class="konzilia-history-item" style="margin-top: 6px;"><u>${title}</u>${datePlace}</p>${histHtml}`;
  
  allTreatmentItems.push({ type: 'operation', sortDate, html });
});

chemotherapyLines.forEach(cht => {
  const dateStr = `${cht.lineTitle || ''} ${cht.toxicityAndDose || ''}`;
  const sortDate = extractTreatmentDateIso(dateStr);
  const lineTitle = cht.lineTitle || '';
  const tox = cht.toxicityAndDose ? ` ${cht.toxicityAndDose}` : '';
  const html = `<p class="konzilia-chemo-line" style="margin-top: 10px;">${lineTitle}${tox}</p>`;

  allTreatmentItems.push({ type: 'chemotherapy', sortDate, html });
});

allTreatmentItems.sort((a, b) => a.sortDate.localeCompare(b.sortDate));

console.log('CHRONOLOGICALLY SORTED TREATMENT ITEMS:');
allTreatmentItems.forEach((it, idx) => {
  console.log(`Item #${idx + 1} [Date: ${it.sortDate}, Type: ${it.type}]:`);
  console.log('  ' + it.html);
});
