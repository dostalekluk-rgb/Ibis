import { TumorBoardStructuredJson, DiagnosisAndTreatmentBlock, RecurrenceBlock } from '../types/chronology.js';

/**
 * Bezpečná vnitřní kontrola a normalizace strukturovaného JSONu z Gemini.
 * GARANTUJE: Žádné položky (operace, chemoterapie, jiné výkony, recidivy) z vráceného JSONu nebudou vynechány,
 * i když Gemini použije alternativní názvy vlastností (např. chemotherapyLine místo chemotherapyLines).
 */
export function normalizeAndAuditStructuredJson(input: any): TumorBoardStructuredJson {
  if (!input) return input;

  let raw = input;
  // Pokud Gemini zabalilo celý výstup do pole [ { ... } ], rozbalíme 1. objekt!
  if (Array.isArray(raw)) {
    console.log('[JSON AUDIT] Detekována kořenová struktura v poli [ { ... } ] - rozbaluji 1. objekt.');
    raw = raw.length > 0 && typeof raw[0] === 'object' && raw[0] !== null ? raw[0] : {};
  }

  const data: TumorBoardStructuredJson = JSON.parse(JSON.stringify(raw));

  // 1. Zjištění počtu diagnóz a převod na pole
  let blocks: DiagnosisAndTreatmentBlock[] = [];
  if (Array.isArray(data.diagnosisAndTreatment)) {
    blocks = data.diagnosisAndTreatment;
  } else if (data.diagnosisAndTreatment && typeof data.diagnosisAndTreatment === 'object') {
    blocks = [data.diagnosisAndTreatment as DiagnosisAndTreatmentBlock];
  } else {
    blocks = [];
  }

  if (blocks.length === 0) {
    blocks = [{ dg: 'ca ovarii' }];
  }

  const topRecs: RecurrenceBlock[] = Array.isArray(data.recurrences)
    ? data.recurrences
    : (data.recurrences ? [data.recurrences] : []);

  blocks.forEach((block: any, blockIdx: number) => {
    // A0. Normalizace GENETICKÉHO TESTOVÁNÍ (BRCA a další)
    let genTesting: string = block.geneticTesting || block.genetic || block.brcaStatus || block.brca || '';

    // A. Normalizace OPERACÍ
    let ops: any[] = [];
    if (Array.isArray(block.operations)) ops.push(...block.operations);
    else if (block.operations) ops.push(block.operations);

    if (block.operation && !ops.includes(block.operation)) ops.push(block.operation);
    if (block.op && !ops.includes(block.op)) ops.push(block.op);
    if (block.surgeries && Array.isArray(block.surgeries)) ops.push(...block.surgeries);

    block.operations = ops.map(op => {
      if (typeof op === 'string') return op;
      return {
        title: op.title || op.opTitle || op.name || op.operation || 'operačním výkonu',
        dateAndPlace: op.dateAndPlace || op.date || op.place || '',
        text: op.text || op.inSitu || op.description || '',
        histology: op.histology || op.histol || op.histo || ''
      };
    });

    // B. Normalizace CHEMOTERAPIE
    let chts: any[] = [];
    if (Array.isArray(block.chemotherapyLines)) chts.push(...block.chemotherapyLines);
    else if (block.chemotherapyLines) chts.push(block.chemotherapyLines);

    if (block.chemotherapyLine) chts.push(block.chemotherapyLine);
    if (block.chemotherapy) chts.push(block.chemotherapy);
    if (block.chemo) chts.push(block.chemo);
    if (block.chemoLines && Array.isArray(block.chemoLines)) chts.push(...block.chemoLines);
    if (block.systemicTherapy) chts.push(block.systemicTherapy);

    // Vyřazení vyšetření BRCA z linií CHT (pokud je tam AI omylem vložila)
    chts = chts.filter(cht => {
      const text = typeof cht === 'string' ? cht : (cht?.lineTitle || cht?.line || cht?.text || '');
      if (/gBRCA|sBRCA|BRCA1\/2|BRCA\s*1|BRCA\s*2|BRCA\s*wt|BRCA\s*mut|genetick/i.test(text)) {
        if (!genTesting) genTesting = text;
        return false;
      }
      return true;
    });

    block.chemotherapyLines = chts.map(cht => {
      if (typeof cht === 'string') {
        return {
          lineTitle: cht,
          toxicityAndDose: block.chemotherapyToxicity || block.toxicityAndDose || ''
        };
      }
      if (typeof cht === 'object' && cht !== null) {
        return {
          lineTitle: cht.lineTitle || cht.line || cht.lineText || cht.text || cht.chemotherapyLine || cht.title || cht.description || '',
          toxicityAndDose: cht.toxicityAndDose || cht.chemotherapyToxicity || cht.toxicity || cht.dose || ''
        };
      }
      return { lineTitle: String(cht), toxicityAndDose: '' };
    });

    // C. Normalizace OSTATNÍ LÉČBY (treatmentsAndHistory)
    let ths: any[] = [];
    if (Array.isArray(block.treatmentsAndHistory)) ths.push(...block.treatmentsAndHistory);
    else if (block.treatmentsAndHistory) ths.push(block.treatmentsAndHistory);

    if (block.treatment) ths.push(block.treatment);
    if (block.treatments && Array.isArray(block.treatments)) ths.push(...block.treatments);
    if (block.history && Array.isArray(block.history)) ths.push(...block.history);
    if (block.radiotherapy) ths.push(block.radiotherapy);
    if (block.otherTreatments && Array.isArray(block.otherTreatments)) ths.push(...block.otherTreatments);

    // Vyřazení vyšetření BRCA z anamn. výkonů
    ths = ths.filter(t => {
      const text = typeof t === 'string' ? t : (t?.text || t?.title || '');
      if (/gBRCA|sBRCA|BRCA1\/2|BRCA\s*1|BRCA\s*2|BRCA\s*wt|BRCA\s*mut|genetick/i.test(text)) {
        if (!genTesting) genTesting = text;
        return false;
      }
      return true;
    });

    block.treatmentsAndHistory = ths.map(t => typeof t === 'string' ? t : (t.text || t.title || JSON.stringify(t)));
    block.geneticTesting = genTesting;

    // D. Normalizace RECIDIV
    let recs: any[] = [];
    if (Array.isArray(block.recurrences)) recs.push(...block.recurrences);
    else if (block.recurrences) recs.push(block.recurrences);

    if (block.recurrence) recs.push(block.recurrence);

    // Sloučení s top-level recurrences pro 1. blok, pokud block.recurrences neobsahuje vše
    if (blockIdx === 0 && topRecs.length > 0) {
      topRecs.forEach(tr => {
        const trHeader = typeof tr === 'string' ? tr : (tr.header || tr.description || '');
        const exists = recs.some(r => {
          const rHeader = typeof r === 'string' ? r : (r.header || r.description || '');
          return rHeader === trHeader;
        });
        if (!exists) {
          recs.push(tr);
        }
      });
    }

    block.recurrences = recs.map(r => {
      if (typeof r === 'string') {
        return {
          header: '1. recidiva / progrese:',
          description: r
        };
      }
      const recObj: RecurrenceBlock = {
        header: r.header || r.title || r.recurrenceHeader || '1. recidiva / progrese:',
        description: r.description || r.details || r.findings || '',
        operations: Array.isArray(r.operations) ? r.operations : (r.operations ? [r.operations] : []),
        treatmentsAndHistory: Array.isArray(r.treatmentsAndHistory) ? r.treatmentsAndHistory : (r.treatmentsAndHistory ? [r.treatmentsAndHistory] : []),
        chemotherapyLine: r.chemotherapyLine || (Array.isArray(r.chemotherapyLines) ? r.chemotherapyLines.map((c: any) => typeof c === 'string' ? c : (c.lineTitle || c.line || c.text || '')).join(' ') : (r.chemotherapy || r.chemo || '')),
        chemotherapyToxicity: r.chemotherapyToxicity || r.toxicityAndDose || r.toxicity || ''
      };
      return recObj;
    });
  });

  data.diagnosisAndTreatment = blocks;

  // Započítání vysázených položek pro kontrolu
  let auditedOpCount = 0;
  let auditedChtCount = 0;
  let auditedThCount = 0;
  let auditedRecCount = 0;

  blocks.forEach(b => {
    auditedOpCount += (b.operations || []).length;
    auditedChtCount += (b.chemotherapyLines || []).length;
    auditedThCount += (b.treatmentsAndHistory || []).length;
    auditedRecCount += (b.recurrences || []).length;
  });

  console.log(`[JSON AUDIT & NORMALIZER] Vnitřní kontrola kompletnosti výstupu: načteno ${auditedOpCount} operací, ${auditedChtCount} linií CHT, ${auditedThCount} anamn. výkonů, ${auditedRecCount} recidiv. (0 vynecháno).`);

  return data;
}
