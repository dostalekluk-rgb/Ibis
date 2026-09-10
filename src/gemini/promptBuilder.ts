import { PatientChronologyDataset } from '../types/chronology.js';
import { anonymizeLocalText } from '../parser/parseLab.js';

/**
 * Bezpečné a optimalizované sestavení promptu pro Gemini s žádostí o strukturovaný JSON podle vzoru konsilium.docx.
 * GARANCE: Všechna data jsou před sestavením promptu přísně anonymizována!
 */
export function buildTumorBoardPrompt(dataset: PatientChronologyDataset): string {
  // 1. Důsledná anonymizace celého datasetu před odesláním
  const jsonStr = JSON.stringify(dataset);
  const { anonymizedText } = anonymizeLocalText(jsonStr, dataset.metadata);

  // Bezpečnostní pojistka: Kontrola zbývajících výskytů
  const czWordChar = 'a-zA-Z0-9áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ';
  const nameCheck = anonymizedText.match(new RegExp(`(?<![${czWordChar}])(Staňková|Stankova|Šárka|Sarka|Neumannová|Neumannova|Hana|Wolf|Heike|Šromová|Sromová|Sromova|Eva)(?![${czWordChar}])`, 'gi'));
  const pojCheck = anonymizedText.match(/(?<![0-9])(635105\/?6382|606120\/?0530|656022\/?7091|575916\/?0993)(?![0-9])/g);

  if (nameCheck || pojCheck) {
    console.error('[PROMPT BUILDER SECURITY CHECK FAILED]', nameCheck, pojCheck);
    throw new Error('BEZPEČNOSTNÍ CHYBA: Zjištěny neanonymizované osobní údaje! Odeslání do Gemini bylo zablokováno.');
  }

  const cleanDataset: PatientChronologyDataset = JSON.parse(anonymizedText);

  // Zjištění nejnovějšího data vyšetření v datasetu a spočítání hranice 2 měsíců (61 dní)
  let maxTime = 0;
  cleanDataset.examinations.forEach(e => {
    if (e.date && e.date !== '1970-01-01') {
      const t = new Date(e.date).getTime();
      if (!isNaN(t) && t > maxTime) maxTime = t;
    }
  });

  const twoMonthsAgo = maxTime > 0 ? maxTime - (61 * 24 * 60 * 60 * 1000) : 0;
  const cutoffDateStr = twoMonthsAgo > 0 ? new Date(twoMonthsAgo).toISOString().split('T')[0] : '1970-01-01';

  // Zobrazovací vyšetření z posledních 2 měsíců (EXKLUDUJE MAMOGRAFII)
  const recentExamsWithFullText = cleanDataset.examinations
    .filter(e => {
      if (!e.date || e.date === '1970-01-01') return false;
      const t = new Date(e.date).getTime();
      if (isNaN(t) || t < twoMonthsAgo) return false;
      // Exkluze Mamografie ze stagingových vyšetření
      const titleType = `${e.type || ''} ${e.title || ''}`;
      if (/mamograf|mamog|MG\b|MMG\b/i.test(titleType)) return false;
      return true;
    })
    .map(e => ({
      id: e.id,
      date: e.date,
      rawDate: e.rawDate,
      type: e.type,
      title: e.title,
      doctor: e.doctor || 'Neuveden',
      fullContent: e.content // EXAKTNÍ CELÝ POPIS VYŠETŘENÍ
    }));

  // Ostatní starší vyšetření (zkrácený přehled pro kontext)
  const olderExams = cleanDataset.examinations
    .filter(e => {
      if (!e.date || e.date === '1970-01-01') return true;
      const t = new Date(e.date).getTime();
      if (isNaN(t) || t < twoMonthsAgo) return true;
      const titleType = `${e.type || ''} ${e.title || ''}`;
      return /mamograf|mamog|MG\b|MMG\b/i.test(titleType);
    })
    .map(e => ({
      id: e.id,
      date: e.date,
      rawDate: e.rawDate,
      type: e.type,
      title: e.title,
      contentSnippet: e.content && e.content.length > 1000 ? e.content.substring(0, 1000) + '... [starší zprávu zkráceno]' : e.content
    }));

  // Sdružená laboratorní vyšetření (posledních 20 měření pro každý analyt)
  const labAggregatedSummary = cleanDataset.labAggregated?.byTest ? 
    Object.keys(cleanDataset.labAggregated.byTest).map(testKey => {
      const t = cleanDataset.labAggregated!.byTest[testKey];
      const recentMeasurements = t.measurements.slice(-20);
      const history = recentMeasurements.map(m => `${m.rawDate}: ${m.value}`).join('; ');
      return `${t.testName}: ${history}`;
    }).join('\n') : '';

  const prompt = `
Jsi špičkový expertní onkogynekologický AI specialista a člen Tumor Boardu (Multioborového onkologického konsilia VFN Praha).

Tvým úkolem je na základě níže poskytnutých chronologických vyšetření pacientky vytvořit VÝHRADNĚ ČISTÝ VALIDNÍ JSON OBSAHUJÍCÍ STRUKTUROVANÝ ZÁVĚR TUMOR BOARDU A NÁVRH DALŠÍHO POSTUPU PŘESNĚ PODLE TĚCHTO INSTRUKCÍ A VZORU KONZILIA.DOCX:

DŮLEŽITÉ VYŽADOVANÉ PRAVIDLA FORMÁTU A OBSAHU:
1. STAGINGOVÁ VYŠETŘENÍ: Zahrň VÝHRADNĚ zobrazovací vyšetření (CT, Onko UZ, MRI, PET/CT atd.), která se udála V ODSTUPU MAXIMÁLNĚ 2 MĚSÍCŮ od data tumor boardu / nejnovějšího vyšetření (od data ${cutoffDateStr}). MAMOGRAFIE SE NESMÍ BÁT JAKO STAGINGOVÉ VYŠETŘENÍ. Pokud v rozmezí 2 měsíců před datem tumor boardu nejsou k dispozici ŽÁDNÁ zobrazovací vyšetření (nebo jsou všechna starší než 2 měsíce), pole stagingExaminations MUSÍ BÝT PRÁZDNÉ POLE \`[]\`!
2. DIAGNÓZA (Dg.) A DUPLICITA: Zkontroluj v anamnéze a vyšetřeních, zda má pacientka v anamnéze další (předchozí či druhotnou) malignitu (např. ca prsu, ca endometria, ca coli apod. = duplicita).
   - Pokud má pacientka DALŠÍ MALIGNITU (duplicitu):
     Do pole "dg" uveď přesný text: "Dg.: Duplicita:" a očísluj diagnózy arabskými číslicemi 1), 2) atd.
     Příklad hodnota pole "dg":
     "Dg.: Duplicita: 1) ca ovarii - HGSC tubo-ovariální (ypT3c pNX pMX, FIGO IIIC) (I.dg. 01/2025), 2) ca prsu (I.dg. 2009)"
     DŮLEŽITÉ: V polích "operations", "chemotherapyLines" a "treatmentsAndHistory" uveď ucelený průběh a léčebné výkony pro jednotlivá onemocnění tak, aby bylo možné přehledně zobrazit průběh 1) prvního onemocnění i 2) druhého onemocnění.
   - Pokud má pacientka POUZE JEDNU MALIGNITU:
     Uveď běžný tvar bez slova duplicita a bez číslování, např.:
     "Dg.: ca ovarii - HGSC tubo-ovariální (cT3c N1 M1b, FIGO IVB) (I.dg. 09/2025)".
3. OPERACE A HISTOLOGIE: Každou operaci/výkon uvozuj v poli operations tvarem "St.p. [název operace]" a v poli dateAndPlace VŽDY VLOŽ V ZÁVORCE DATUM A MÍSTO PROVEDENÍ (např. "3.9.2025, VFN" nebo "24.8.2026, VFN Praha"). Pokud k operaci patřila histologie, uveď ji do samostatného pole histology.
4. LINIE CHEMOTERAPIE: Linie chemoterapie ulož do chemotherapyLines a VŽDY JE OČÍSLUJ ARABSKÝMI ČÍSLICEMI (např. "St.p. 1. linii chemoterapie v režimu PTX/CBDCA (ukončeno 12.3.2026)"). NIKDY nepopisuj linie římskými číslicemi. Hned v poli toxicityAndDose UVEĎ NAPROSTO STRUČNĚ, jestli se vyskytla nějaká toxicita a jestli nemusela být redukována dávka (např. "Toxicita: G2 neutropenie, bez redukce dávky." nebo "Bez závažné toxicity, redukce dávky 0 %").
5. RECIDIVY: V oddílu recurrences vytvoř položku s headerem např. "1. recidiva / progrese (05/2026, PFI 3 měsíce):" a v description uveď souvislý popis (VYPUSŤ SLOVO "Zahájena"). Další linii chemoterapie pro recidivu uveď v samostatném poli chemotherapyLine a OČÍSLUJ JI ARABSKOU ČÍSLICÍ (např. "2. linie CHT Caelyx (podány 3 cykly, poslední 18.08.2026)").
6. CHRONOLOGICKÉ ŘAZENÍ ANAMNÉZY LÉČBY V diagnosisAndTreatment: Všechny operační výkony i linie chemoterapie MUSÍ být seřazeny přísně CHRONOLOGICKY podle data podání/provedení. Pokud neoadjuvantní chemoterapie předcházela operaci (např. 1. linie CHT v 09/2025 před intervalovou operací v 02/2026), MUSÍ být tato linie chemoterapie uvedena PŘED danou operací!

MUSÍŠ VRÁTIT POUZE A JENOM ČISTÝ VALIDNÍ JSON PODLE TÉTO PŘESNÉ STRUKTURY Z KONZILIA.DOCX:

{
  "patientHeader": {
    "name": "[ANONYMIZOVÁNO]",
    "insuranceNumber": "[ANON-RČ]",
    "insuranceCode": "VZP (111)",
    "address": "[ANON-KONTAKT]",
    "phone": "[ANON-KONTAKT]",
    "metrics": "např. 63 let, 168 cm, 85 kg, ECOG PS 0"
  },
  "presentIllness": "NO: pacientka s endometroidním karcinomem / ca ovarii přichází pro...",
  "anamnesis": {
    "oa": "OA: vážněji nestonala",
    "operace": "Operace: 0",
    "fa": "FA: neguje",
    "aa": "AA: na léky a dezinfekci neguje",
    "ga": "GA: nuligravida / partus 2x"
  },
  "stagingExaminations": [
    {
      "title": "CT hrudníku, břicha a pánve (28.5.2026):",
      "fullText": "Exaktní celý popis vyšetření bez zkracování..."
    }
  ],
  "diagnosisAndTreatment": {
    "dg": "Dg.: **Duplicita:** 1) ca ovarii - HGSC tubo-ovariální (cT3c N1 M1b, FIGO IVB) (I.dg. 09/2025), 2) ca prsu (I.dg. 2018)",
    "operations": [
      {
        "title": "St.p. core needle biopsii",
        "dateAndPlace": "3.9.2025, VFN",
        "histology": "High-grade serózní karcinom (HGSC) - IHC: CK7+, PAX8+, WT1+, p53 mutovaný."
      }
    ],
    "chemotherapyLines": [
      {
        "lineTitle": "St.p. 1. linii chemoterapie v režimu PTX/CBDCA (ukončeno 12.03.2026)",
        "toxicityAndDose": "Toxicita: G2 neutropenie, bez redukce dávky."
      }
    ],
    "treatmentsAndHistory": [
      "sBRCA1/2 negativní, somatic BRCA1/2 negativní"
    ]
  },
  "recurrences": [
    {
      "header": "1. recidiva / progrese (05/2026, PFI 3 měsíce):",
      "description": "Platina-rezistentní progrese onemocnění (PFI 3 měsíce), progrese karcinomatózy a ascitu na CT (28.05.2026), nárůst CA 125 na 1368 U/ml.",
      "chemotherapyLine": "2. linie CHT Caelyx (podány 3 cykly, poslední 18.08.2026)",
      "chemotherapyToxicity": "Toxicita: G1 PPE, bez redukce dávky."
    }
  ],
  "tumorBoardConclusion": {
    "date": "Onkogynekologické konzilium 9.9.2026",
    "attendees": "prof. MUDr. Cibula, CSc., prof. MUDr. Sláma, Ph.D., MUDr. Frühauf, Ph.D., MUDr. Tomancová, prof. MUDr. Burgetová, Ph.D., MUDr. Valentová, MUDr. Brynda, MUDr. Emingr, MUDr. Malik",
    "recommendation": "Doporučení: Bude doplněno testování somatických prediktorů... Pacientka je předána ke sledování do onkogynekologické ambulance. Informována dr. Frühaufem."
  }
}

ZDE JSOU VSTUPNÍ DATA PACIENTKY:

=== AKTUÁLNÍ VYŠETŘENÍ Z POSLEDNÍCH 2 MĚSÍCŮ (PRO ODDÍL STAGINGOVÁ VYŠETŘENÍ, MAMOGRAFIE EXKLUDOVÁNA) ===
${JSON.stringify(recentExamsWithFullText, null, 2)}

=== ANAMNESTICKÝ A STARŠÍ PŘEHLED VYŠETŘENÍ ===
${JSON.stringify(olderExams, null, 2)}

=== SDRUŽENÁ LABORATORNÍ VYŠETŘENÍ (ČASOVÉ ŘADY ANALYTŮ) ===
${labAggregatedSummary}
`;

  return prompt;
}



