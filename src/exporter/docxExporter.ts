import { Document, Paragraph, TextRun, Packer, AlignmentType } from 'docx';
import { TumorBoardStructuredJson, PatientChronologyMetadata } from '../types/chronology.js';
import { normalizeAndAuditStructuredJson } from '../parser/jsonAudit.js';

/**
 * Generování přísně formátovaného Word dokumentu (.docx) přesně podle vzoru konzilia.docx
 */
export async function generateTumorBoardDocx(
  rawJson: TumorBoardStructuredJson,
  metadata?: PatientChronologyMetadata,
  maxDate?: string
): Promise<{ buffer: Buffer; filename: string }> {
  // 0. Bezpečná vnitřní kontrola a normalizace JSONu
  const structuredJson = normalizeAndAuditStructuredJson(rawJson);

  // 1. Zjištění reálných údajů pacientky (z metadata nebo z JSONu)
  const header = structuredJson.patientHeader || {};

  const isValidVal = (v?: string) => Boolean(
    v &&
    v.trim() &&
    v !== '—' &&
    !v.toLowerCase().includes('anonym') &&
    !v.toLowerCase().includes('anon') &&
    !v.toLowerCase().includes('[neznám') &&
    !v.toLowerCase().includes('vyšetřovaná') &&
    !v.toLowerCase().includes('neznámá') &&
    v !== 'Pacientka'
  );

  const realName = isValidVal(metadata?.patientName) && metadata!.patientName !== 'Není načten žádný pacient' && metadata!.patientName !== 'Vyšetřovaná Pacientka' && metadata!.patientName !== 'Neznámá Pacientka'
    ? metadata!.patientName
    : (isValidVal(header.name) && header.name !== 'Vyšetřovaná Pacientka' ? header.name : 'Pacientka');

  const realRc = isValidVal(metadata?.insuranceNumber)
    ? metadata!.insuranceNumber
    : (isValidVal(header.insuranceNumber) ? header.insuranceNumber : undefined);

  const realCode = isValidVal(metadata?.insuranceCode)
    ? metadata!.insuranceCode
    : (isValidVal(header.insuranceCode) ? header.insuranceCode : undefined);

  const realAddr = isValidVal(metadata?.address)
    ? metadata!.address
    : (isValidVal(header.address) ? header.address : undefined);

  const realPhone = isValidVal(metadata?.phone)
    ? metadata!.phone
    : (isValidVal(header.phone) ? header.phone : undefined);

  const metrics = header.metrics || '';
  const presentIllness = structuredJson.presentIllness || '';
  const anamnesis = structuredJson.anamnesis || {};

  const rawStaging = structuredJson.stagingExaminations || [];
  const stagingExaminations: Array<{ title?: string; fullText?: string }> = rawStaging.map((exam: any) => {
    if (typeof exam === 'string') {
      return { title: exam, fullText: '' };
    }
    return exam || {};
  });

  const rawDiagBlocks = structuredJson.diagnosisAndTreatment;
  const diagBlocks: any[] = Array.isArray(rawDiagBlocks) ? rawDiagBlocks : rawDiagBlocks ? [rawDiagBlocks] : [];

  const tbConclusion = structuredJson.tumorBoardConclusion || {};

  // 2. Stanovení datumu: buď z omezovacího pole (maxDate), nebo dnešní datum
  let effectiveDateFormatted = '';
  if (maxDate && maxDate.trim()) {
    const rawDatePart = maxDate.trim().split('T')[0];
    const parts = rawDatePart.split('-');
    if (parts.length === 3) {
      const day = parts[2].padStart(2, '0');
      const month = parts[1].padStart(2, '0');
      const year = parts[0];
      effectiveDateFormatted = `${day}.${month}.${year}`;
    }
  }

  if (!effectiveDateFormatted) {
    const today = new Date();
    const day = String(today.getDate()).padStart(2, '0');
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const year = today.getFullYear();
    effectiveDateFormatted = `${day}.${month}.${year}`;
  }

  const boardDate = `Onkogynekologické konsilium ${effectiveDateFormatted}`;
  const dateStrForFile = effectiveDateFormatted;

  // Příprava jména pro soubor (příjmení_jméno_datum.docx)
  let nameForFile = 'Pacientka';
  if (realName && realName !== 'Pacientka' && !realName.includes('ANONYMIZOVÁNO')) {
    const nameParts = realName.trim().split(/\s+/);
    if (nameParts.length >= 2) {
      nameForFile = `${nameParts[0]}_${nameParts[1]}`;
    } else {
      nameForFile = nameParts[0];
    }
  }

  // Očistění názvu souboru od neplatných znaků
  const safeName = nameForFile.replace(/[\\/:*?"<>|]/g, '_');
  const safeDate = dateStrForFile.replace(/[\\/:*?"<>|]/g, '_');
  const filename = `${safeName}_${safeDate}.docx`;

  // 3. Sestavení odstavců Word dokumentu (.docx) v přesné struktuře konzilia.docx
  const paragraphs: Paragraph[] = [];
  const FONT_NAME = 'Arial';
  const FONT_SIZE = 20; // 10pt v docx (half-points)

  // Pomocný builder pro odstavce zarovnané do bloku (JUSTIFIED)
  const addP = (
    runs: TextRun[],
    spaceAfter = 3,
    spaceBefore = 0,
    alignment: (typeof AlignmentType)[keyof typeof AlignmentType] = AlignmentType.JUSTIFIED
  ) => {
    paragraphs.push(
      new Paragraph({
        alignment,
        spacing: { before: spaceBefore * 20, after: spaceAfter * 20, line: 260 },
        children: runs,
      })
    );
  };

  // --- HLAVIČKA PACIENTKY (Zarovnáno vlevo, CELÁ TUČNĚ, vyřazeny neuvedené/prázdné řádky) ---
  if (realName) {
    addP([new TextRun({ text: realName, font: FONT_NAME, size: FONT_SIZE, bold: true })], 2, 0, AlignmentType.LEFT);
  }
  if (realRc) {
    addP([new TextRun({ text: realRc, font: FONT_NAME, size: FONT_SIZE, bold: true })], 2, 0, AlignmentType.LEFT);
  }
  if (realCode) {
    addP([new TextRun({ text: realCode, font: FONT_NAME, size: FONT_SIZE, bold: true })], 2, 0, AlignmentType.LEFT);
  }
  if (realAddr) {
    addP([new TextRun({ text: realAddr, font: FONT_NAME, size: FONT_SIZE, bold: true })], 2, 0, AlignmentType.LEFT);
  }
  if (realPhone) {
    addP([new TextRun({ text: realPhone, font: FONT_NAME, size: FONT_SIZE, bold: true })], 2, 0, AlignmentType.LEFT);
  }

  addP([], 6); // Prázdný řádek

  // --- METRIKY A NYNĚJŠÍ ONEMOCNĚNÍ ---
  if (metrics) {
    addP([new TextRun({ text: metrics, font: FONT_NAME, size: FONT_SIZE })]);
  }
  if (presentIllness) {
    const formattedNO = presentIllness.startsWith('NO:') ? presentIllness : `NO: ${presentIllness}`;
    const noParts = formattedNO.split(/^NO:\s*/i);
    if (noParts.length > 1) {
      addP([
        new TextRun({ text: 'NO: ', font: FONT_NAME, size: FONT_SIZE, bold: true }),
        new TextRun({ text: noParts[1], font: FONT_NAME, size: FONT_SIZE }),
      ]);
    } else {
      addP([new TextRun({ text: formattedNO, font: FONT_NAME, size: FONT_SIZE })]);
    }
  }

  addP([], 6); // Prázdný řádek

  // --- ANAMNÉZA ---
  addP([new TextRun({ text: 'Anamnéza:', font: FONT_NAME, size: FONT_SIZE, bold: true })]);
  if (anamnesis.oa) addP([new TextRun({ text: anamnesis.oa, font: FONT_NAME, size: FONT_SIZE })]);
  if (anamnesis.operace) addP([new TextRun({ text: anamnesis.operace, font: FONT_NAME, size: FONT_SIZE })]);
  if (anamnesis.fa) addP([new TextRun({ text: anamnesis.fa, font: FONT_NAME, size: FONT_SIZE })]);
  if (anamnesis.aa) addP([new TextRun({ text: anamnesis.aa, font: FONT_NAME, size: FONT_SIZE })]);
  if (anamnesis.ga) addP([new TextRun({ text: anamnesis.ga, font: FONT_NAME, size: FONT_SIZE })]);

  addP([], 6); // Prázdný řádek

  // --- STAGINGOVÁ VYŠETŘENÍ ---
  if (stagingExaminations && stagingExaminations.length > 0) {
    addP([new TextRun({ text: 'Stagingová vyšetření', font: FONT_NAME, size: FONT_SIZE, bold: true })], 3, 4);
    stagingExaminations.forEach((exam) => {
      const runs: TextRun[] = [];
      if (exam.title) {
        let tStr = exam.title.trim();
        if (exam.fullText && !tStr.endsWith(':') && !tStr.endsWith('.')) {
          tStr = `${tStr}: `;
        } else if (exam.fullText && !tStr.endsWith(' ')) {
          tStr = `${tStr} `;
        }
        runs.push(new TextRun({ text: tStr, font: FONT_NAME, size: FONT_SIZE, bold: true }));
      }
      if (exam.fullText) {
        runs.push(new TextRun({ text: exam.fullText.trim(), font: FONT_NAME, size: FONT_SIZE }));
      }
      if (runs.length > 0) {
        addP(runs, 3, 2);
      }
    });
    addP([], 6); // Prázdný řádek
  }

  // --- DIAGNÓZY A LÉČBA (diagnosisAndTreatment) ---
  const getMultiplicityLabel = (count: number): string => {
    if (count === 2) return 'Duplicita';
    if (count === 3) return 'Triplicita';
    if (count === 4) return 'Kvadruplicita';
    if (count === 5) return 'Kvintuplicita';
    return `Multiplicita (${count} diagnózy)`;
  };

  if (diagBlocks.length > 1) {
    const label = getMultiplicityLabel(diagBlocks.length);
    addP([new TextRun({ text: `Dg.: ${label}:`, font: FONT_NAME, size: FONT_SIZE, bold: true })]);
    diagBlocks.forEach((block, idx) => {
      let dgTitle = block.dg || '';
      dgTitle = dgTitle.replace(/^(?:Dg\.\:\s*)?/, '').trim();
      if (!dgTitle.startsWith('Dg.:') && !/^\d+\)/.test(dgTitle)) {
        dgTitle = `${idx + 1}) ${dgTitle}`;
      }
      addP([new TextRun({ text: dgTitle, font: FONT_NAME, size: FONT_SIZE, bold: true })], 3, idx === 0 ? 2 : 6);
      renderBlockToDocx(block, addP, FONT_NAME, FONT_SIZE);
    });
  } else if (diagBlocks.length === 1) {
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
          subItems.push(`${num}) ${m[1].trim()}`);
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
      addP([new TextRun({ text: `Dg.: ${label}:`, font: FONT_NAME, size: FONT_SIZE, bold: true })]);

      if (subItems.length > 0) {
        subItems.forEach((subTitle, idx) => {
          addP([new TextRun({ text: subTitle, font: FONT_NAME, size: FONT_SIZE, bold: true })], 3, idx === 0 ? 2 : 6);
          if (idx === 0) {
            renderBlockToDocx(block, addP, FONT_NAME, FONT_SIZE);
          }
        });
      } else {
        renderBlockToDocx(block, addP, FONT_NAME, FONT_SIZE);
      }
    } else {
      let formattedDg = rawDg.replace(/^(?:Dg\.\:\s*)?1[\)\.]\s*/i, '').trim();
      formattedDg = formattedDg.startsWith('Dg.:') ? formattedDg : `Dg.: ${formattedDg}`;
      addP([new TextRun({ text: formattedDg, font: FONT_NAME, size: FONT_SIZE, bold: true })]);
      renderBlockToDocx(block, addP, FONT_NAME, FONT_SIZE);
    }
  } else {
    addP([new TextRun({ text: 'Dg.: Neuvedeno', font: FONT_NAME, size: FONT_SIZE, bold: true })]);
  }

  addP([], 6); // Prázdný řádek

  // --- ZÁVĚR ONKOGYNEKOLOGICKÉHO KONSILIA ---
  addP([new TextRun({ text: boardDate, font: FONT_NAME, size: FONT_SIZE, bold: true })]);

  const HARDCODED_ATTENDEES = 'prof. MUDr. Cibula, CSc., prof. MUDr. Sláma, Ph.D., MUDr. Frühauf, Ph.D., MUDr. Tomancová, prof. MUDr. Burgetová, Ph.D., MUDr. Valentová, MUDr. Brynda, MUDr. Emingr, MUDr. Malčák, doc. MUDr. Kocián, Ph.D. a MUDr. Dostálek, Ph.D.';

  addP([
    new TextRun({ text: 'Přítomni: ', font: FONT_NAME, size: FONT_SIZE, bold: true }),
    new TextRun({ text: HARDCODED_ATTENDEES, font: FONT_NAME, size: FONT_SIZE }),
  ]);

  const rawRec = tbConclusion.recommendation || 'Doporučení: Neuvedeno';
  const recText = rawRec.replace(/^Doporučení:\s*/i, '');
  addP([
    new TextRun({ text: 'Doporučení: ', font: FONT_NAME, size: FONT_SIZE, bold: true }),
    new TextRun({ text: recText, font: FONT_NAME, size: FONT_SIZE }),
  ]);

  // 4. Vytvoření finálního Document objektu s světle růžovým pozadím
  const doc = new Document({
    background: {
      color: 'FCE4EC',
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1440, // 1 inch (2.54 cm)
              bottom: 1440,
              left: 1440,
              right: 1440,
            },
          },
        },
        children: paragraphs,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  return { buffer, filename };
}

function normalizeChemoLineNumerals(str: string): string {
  if (!str) return '';
  return str.replace(/^(St\.p\.\s*)?I\.\s*/i, '$11. ');
}

function isValidInSituText(text?: string, title?: string): boolean {
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
}

function extractTreatmentDateIso(str: string): string {
  if (!str) return '9999-99-99';

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

  const yearMatches = [...str.matchAll(/\b(19\d{2}|20\d{2})\b/g)];
  if (yearMatches.length > 0) {
    const years = yearMatches.map(m => m[1]).sort();
    return `${years[0]}-01-01`;
  }

  return '9999-99-99';
}

/**
 * Pomocné vykreslení operací, historií, recidiv pro daný blok diagnózy do Word odstavců
 * Formátování:
 * - Diagnóza: tučně (řešeno výše)
 * - Název operace (title): podtrhnout (kromě zavedení venózního portu)
 * - Datum a místo operace (dateAndPlace): nepodtrhávat
 * - Nález v dutině břišní: in situ: ... (pokud je k dispozici)
 * - Histologie: -histol: ... (kurzívou)
 * - Všechny položky odděleny prázdným řádkem
 */
function renderBlockToDocx(
  block: any,
  addP: (runs: TextRun[], spaceAfter?: number, spaceBefore?: number, alignment?: (typeof AlignmentType)[keyof typeof AlignmentType]) => void,
  font: string,
  size: number
) {
  interface DocxTreatmentItem {
    sortDate: string;
    render: () => void;
  }

  const treatmentItems: DocxTreatmentItem[] = [];

  // 1. Operace
  if (block.operations && Array.isArray(block.operations)) {
    block.operations.forEach((op: any) => {
      let opTitle = typeof op === 'string' ? op : (op.title || '');
      if (opTitle && !opTitle.toLowerCase().startsWith('st.p.')) {
        opTitle = `St.p. ${opTitle}`;
      }
      const dpStr = typeof op === 'object' && op.dateAndPlace ? ` (${op.dateAndPlace})` : '';
      const sortDate = extractTreatmentDateIso(`${typeof op === 'object' ? op.dateAndPlace || '' : ''} ${opTitle}`);
      const isVenousPort = /zaveden[íi]\s+(?:venózního\s+)?portu/i.test(opTitle);

      treatmentItems.push({
        sortDate,
        render: () => {
          addP([
            new TextRun({
              text: opTitle,
              font,
              size,
              underline: isVenousPort ? undefined : {},
            }),
            new TextRun({
              text: dpStr,
              font,
              size,
            }),
          ]);

          if (typeof op === 'object' && op.text) {
            let cleanInSitu = op.text.replace(/^(?:in\s*situ|\-insitu)\:\s*/i, '').trim();
            if (isValidInSituText(cleanInSitu, opTitle)) {
              addP([
                new TextRun({
                  text: `in situ: ${cleanInSitu}`,
                  font,
                  size,
                }),
              ]);
            }
          }

          if (typeof op === 'object' && op.histology) {
            let cleanHist = op.histology.replace(/^(?:Histologie|\-histol|\-histo)\:\s*/i, '').trim();
            addP([
              new TextRun({
                text: `-histol: ${cleanHist}`,
                font,
                size,
                italics: true,
              }),
            ]);
          }
        },
      });
    });
  }

  // 2. Ostatní léčba (treatmentsAndHistory)
  if (block.treatmentsAndHistory && Array.isArray(block.treatmentsAndHistory)) {
    block.treatmentsAndHistory.forEach((t: string) => {
      let text = t;
      if (!text.toLowerCase().startsWith('st.p.')) {
        text = `St.p. ${text}`;
      }
      const sortDate = extractTreatmentDateIso(text);

      treatmentItems.push({
        sortDate,
        render: () => {
          addP([
            new TextRun({
              text,
              font,
              size,
            }),
          ]);
        },
      });
    });
  }

  // 3. Linie chemoterapie (chemotherapyLines)
  if (block.chemotherapyLines && Array.isArray(block.chemotherapyLines)) {
    block.chemotherapyLines.forEach((c: any) => {
      if (typeof c === 'string') {
        const lineText = normalizeChemoLineNumerals(c);
        const sortDate = extractTreatmentDateIso(lineText);
        treatmentItems.push({
          sortDate,
          render: () => {
            addP([new TextRun({ text: lineText, font, size })]);
          },
        });
        return;
      }
      const rawLine = typeof c === 'object' && c !== null ? (c.lineTitle || c.line || c.lineText || c.text || '') : String(c);
      const lineText = normalizeChemoLineNumerals(rawLine);
      const rawTox = typeof c === 'object' && c !== null ? (c.toxicityAndDose || c.chemotherapyToxicity || c.toxicity || '') : '';
      const toxText = rawTox ? ` ${rawTox}` : '';
      const sortDate = extractTreatmentDateIso(`${lineText} ${toxText}`);

      treatmentItems.push({
        sortDate,
        render: () => {
          addP([new TextRun({ text: lineText, font, size })]);
          if (rawTox) {
            addP([new TextRun({ text: rawTox, font, size })]);
          }
        },
      });
    });
  }

  // Seřazení chronologicky
  treatmentItems.sort((a, b) => a.sortDate.localeCompare(b.sortDate));

  // Vykreslení položek s prázdným řádkem pouze mezi 2. a dalšími položkami
  treatmentItems.forEach((item, idx) => {
    if (idx > 0) {
      addP([], 6); // Prázdný řádek oddělující až druhou a další položky
    }
    item.render();
  });

  // 4. Recidivy (recurrences)
  // 4. Recidivy (recurrences)
  if (block.recurrences && Array.isArray(block.recurrences)) {
    block.recurrences.forEach((rec: any) => {
      addP([], 6); // Prázdný řádek před recidivou
      if (rec.header) {
        addP([new TextRun({ text: rec.header, font, size, bold: true })], 3, 4);
      }
      if (rec.description) {
        addP([new TextRun({ text: rec.description, font, size })]);
      }

      interface RecDocxItem {
        sortDate: string;
        render: () => void;
      }
      const recItems: RecDocxItem[] = [];

      // 1. Ostatní výkony (treatmentsAndHistory)
      if (rec.treatmentsAndHistory && Array.isArray(rec.treatmentsAndHistory)) {
        rec.treatmentsAndHistory.forEach((t: string) => {
          let text = t;
          if (!text.toLowerCase().startsWith('st.p.')) {
            text = `St.p. ${text}`;
          }
          const sortDate = extractTreatmentDateIso(text);
          recItems.push({
            sortDate,
            render: () => {
              addP([], 6);
              addP([new TextRun({ text, font, size })]);
            }
          });
        });
      }

      // 2. Operace
      if (rec.operations && Array.isArray(rec.operations)) {
        rec.operations.forEach((op: any) => {
          let opTitle = typeof op === 'string' ? op : (op.title || '');
          if (opTitle && !opTitle.toLowerCase().startsWith('st.p.')) {
            opTitle = `St.p. ${opTitle}`;
          }
          const dpStr = typeof op === 'object' && op.dateAndPlace ? ` (${op.dateAndPlace})` : '';
          const sortDate = extractTreatmentDateIso(`${typeof op === 'object' ? op.dateAndPlace || '' : ''} ${opTitle}`);
          const isVenousPort = /zaveden[íi]\s+(?:venózního\s+)?portu/i.test(opTitle);

          recItems.push({
            sortDate,
            render: () => {
              addP([], 6);
              addP([
                new TextRun({
                  text: opTitle,
                  font,
                  size,
                  underline: isVenousPort ? undefined : {},
                }),
                new TextRun({
                  text: dpStr,
                  font,
                  size,
                }),
              ]);

              if (typeof op === 'object' && op.text) {
                let cleanInSitu = op.text.replace(/^(?:in\s*situ|\-insitu)\:\s*/i, '').trim();
                if (isValidInSituText(cleanInSitu, opTitle)) {
                  addP([new TextRun({ text: `in situ: ${cleanInSitu}`, font, size })]);
                }
              }

              if (typeof op === 'object' && op.histology) {
                let cleanHist = op.histology.replace(/^(?:Histologie|\-histol|\-histo)\:\s*/i, '').trim();
                addP([new TextRun({ text: `-histol: ${cleanHist}`, font, size, italics: true })]);
              }
            }
          });
        });
      }

      // 3. Chemoterapie u recidivy
      if (rec.chemotherapyLine) {
        let chtLine = rec.chemotherapyLine;
        chtLine = normalizeChemoLineNumerals(chtLine);
        const chtTox = rec.chemotherapyToxicity ? ` ${rec.chemotherapyToxicity}` : '';
        const sortDate = extractTreatmentDateIso(`${chtLine} ${chtTox}`);

        recItems.push({
          sortDate,
          render: () => {
            addP([], 6);
            addP([new TextRun({ text: chtLine, font, size })]);
            if (rec.chemotherapyToxicity) {
              addP([new TextRun({ text: rec.chemotherapyToxicity, font, size })]);
            }
          }
        });
      }

      // Seřazení položek v recidivě přísně chronologicky podle zjištěného data
      recItems.sort((a, b) => a.sortDate.localeCompare(b.sortDate));

      // Vykreslení položek
      recItems.forEach(item => item.render());
    });
  }
}
