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
1. STAGINGOVÁ VYŠETŘENÍ: Zahrň VÝHRADNĚ zobrazovací vyšetření (CT, Onko UZ, MRI, PET/CT atd.), která se udála V ODSTUPU MAXIMÁLNĚ 2 MĚSÍCŮ od data tumor boardu / nejnovějšího vyšetření (od data ${cutoffDateStr}). MAMOGRAFIE SE NESMÍ BÁT JAKO STAGINGOVÉ VYŠETŘENÍ. Pokud v rozmezí 2 měsíců před datem tumor boardu nejsou k dispozici ŽÁDNÁ zobrazovací vyšetření (nebo jsou všechna starší než 2 měsíce), pole stagingExaminations MUSÍ BÝT PRÁZDNÉ POLE []!
2. DIAGNÓZA (Dg.) A STRUKTURA diagnosisAndTreatment (POLE PRO KAŽDOU DIAGNÓZU):
   - Pole "diagnosisAndTreatment" MUSÍ BÝT VŽDY POLE OBJEKTŮ (Array).
   - V poli "dg" uváděj VÝHRADNĚ primární diagnózu a rok I.dg., např.: "1) ca colli uteri - adenokarcinom/adenoskvamózní (I.dg. 2016)". JE PŘÍSNĚ ZAKÁZÁNO do "dg" doplňovat jakékoliv zmínky o recidivách (např. NIKDY NEVKLÁDAT ", 1. recidiva 02/2024")! Recidivy patří výhradně do oddílu "recurrences"!
   - V poli "diagnosisAndTreatment" uváděj u každé diagnózy VÝHRADNĚ **primární operační výkony a primární (adjuvantní) léčbu z doby I.dg.** (např. hysterektomie z roku 2016, radioterapie z roku 2016).
   - Pokud má pacientka VÍCE ONKOLOGICKÝCH DIAGNÓZ (duplicita / triplicita, např. 1) ca colli uteri, 2) ca thyroidey):
     Vytvoř v poli "diagnosisAndTreatment" SAMOSTATNÝ OBJEKT PRO KAŽDOU DIAGNÓZU a zařaď primární operace a léčbu výhradně k té diagnóze, ke které klinicky patří.
   - Pokud má pacientka POUZE JEDNU MALIGNITU:
     Pole "diagnosisAndTreatment" bude obsahovat právě 1 objekt, např. { "dg": "Dg.: ca ovarii - HGSC tubo-ovariální (cT3c N1 M1b, FIGO IVB) (I.dg. 09/2025)", ... }.
3. OPERACE A HISTOLOGIE: Každou operaci/výkon uvozuj v poli operations tvarem "St.p. [název operace]" a v poli dateAndPlace VŽDY VLOŽ V ZÁVORCE DATUM A MÍSTO PROVEDENÍ (např. "3.9.2025, VFN" nebo "24.8.2026, VFN Praha"). Pokud k operaci patřila histologie, uveď ji do samostatného pole histology.
4. LINIE CHEMOTERAPIE: Primární linie chemoterapie ulož do chemotherapyLines a VŽDY JE OČÍSLUJ ARABSKÝMI ČÍSLICEMI (např. "St.p. 1. linii chemoterapie v režimu PTX/CBDCA (ukončeno 12.3.2026)"). NIKDY nepopisuj linie římskými číslicemi. Hned v poli toxicityAndDose UVEĎ NAPROSTO STRUČNĚ, jestli se vyskytla nějaká toxicita a jestli nemusela být redukována dávka (např. "Toxicita: G2 neutropenie, bez redukce dávky.").
5. RECIDIVY UVNITŘ SVOJÍ DIAGNÓZY:
   - Každá recidiva MUSÍ BÝT ULOŽENA V POLI "recurrences" UVNITŘ OBJEKTU PŘÍSLUŠNÉ DIAGNÓZY v "diagnosisAndTreatment"! (Tzn. Recidivy nepatří do samostatného oddílu na konci, ale přímo pod diagnózu, ke které klinicky patří).
   - V poli "description" uváděj VÝHRADNĚ klinický a zobrazovací nález recidivy (např. "Pánevní tumor vpravo utlačující pravý ureter s hydronefrózou III. st. a parailickou lymfadenopatií."). NESMÍŠ v description slévat operace, histologie ani stenty do jednoho odstavce!
   - Operační výkony pro recidivu ulož do pole "operations" u dané recidivy (např. title: "St.p. resekci recidivy pánevního tumoru...", dateAndPlace: "1.2.2024, VFN Praha", histology: "Metastáza HPV asociovaného...").
   - Ostatní výkony (stenty apod.) ulož do pole "treatmentsAndHistory" u dané recidivy (např. ["St.p. zavedení ureterálního stentu vpravo..."]).
   - VŠECHNA SYSTÉMOVÁ LÉČBA, CHEMOTERAPIE, IMUNOTERAPIE A BIOLOGICKÁ LÉČBA INDIKOVANÁ PRO RECIDIVU MUSÍ BÝT UVEDENA V POLI "chemotherapyLine" A "chemotherapyToxicity" UVNITŘ PŘÍSLUŠNÉ RECIDIVY!
6. CHRONOLOGICKÉ ŘAZENÍ ANAMNÉZY LÉČBY V diagnosisAndTreatment: Všechny operační výkony i linie chemoterapie u každé diagnózy MUSÍ být seřazeny přísně CHRONOLOGICKY podle data podání/provedení.
7. ZÁKAZ DUPLICITY CHEMOTERAPIE: Každá linie chemoterapie / systémové léčby smí být v celém JSON výstupu uvedena VÝHRADNĚ JEDNOU!

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
  "diagnosisAndTreatment": [
    {
      "dg": "1) ca colli uteri - adenokarcinom/adenoskvamózní (I.dg. 2016)",
      "operations": [
        {
          "title": "St.p. hysterektomii sec. Pfannenstiel",
          "dateAndPlace": "2016, Ukrajina",
          "histology": "Dokumentace z primární operace není k dispozici."
        }
      ],
      "treatmentsAndHistory": [
        "St.p. adjuvantní kombinované radioterapii (EBRT + BRT) pro ca colli uteri (2016)"
      ],
      "recurrences": [
        {
          "header": "1. recidiva / progrese (02/2024, TFI 8 let):",
          "description": "Pánevní tumor vpravo utlačující pravý ureter s hydronefrózou III. st. a parailickou lymfadenopatií.",
          "treatmentsAndHistory": [
            "St.p. zavedení ureterálního stentu vpravo pro hydronefrózu a útlak ureteru (01/2024, opakované výměny stentu)"
          ],
          "operations": [
            {
              "title": "St.p. resekci recidivy pánevního tumoru, disekci ureteru, exstirpaci tumoru a pánevních LN",
              "dateAndPlace": "1.2.2024, VFN Praha",
              "histology": "Metastáza HPV asociovaného dobře diferencovaného adenokarcinomu hrdla děložního s minoritní dlaždicobuněčnou diferenciací (adenoskvamózní). Největší rozměr ložiska 20 mm. Uzlina průměru 8 mm zcela spotřebována metastázou. PD-L1 (22C3) CPS = 20."
            }
          ],
          "chemotherapyLine": "St.p. 1. linii CHT v režimu Abraxane/cDDP (6 cyklů, ukončeno 02.07.2024) + bevacizumab + pembrolizumab (od 05.03.2024, pembrolizumab ukončen 22.05.2026 35. cyklem)",
          "chemotherapyToxicity": "Toxicita: G1 hypothyreóza při imunoterapii (substituce Letrox), G1 neutropenie (odklad cyklu o týden), bez redukce dávky. Aplikován 38. cyklus bevacizumabu (04.09.2026)"
        }
      ]
    },
    {
      "dg": "2) ca thyroidey (I.dg. 2016)",
      "operations": [
        {
          "title": "St.p. totální thyreoidektomii",
          "dateAndPlace": "2016",
          "histology": "Ca thyroidey."
        }
      ],
      "treatmentsAndHistory": [
        "St.p. terapii radiojodem pro ca thyroidey (ukončeno 2020)"
      ]
    }
  ],
  "tumorBoardConclusion": {
    "date": "Onkogynekologické konzilium 9.9.2026",
    "attendees": "prof. MUDr. Cibula, CSc., prof. MUDr. Sláma, Ph.D., MUDr. Frühauf, Ph.D., MUDr. Tomancová...",
    "recommendation": "Doporučení: ..."
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



