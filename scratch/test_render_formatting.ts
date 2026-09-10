import { renderStructuredJsonToHtml } from '../src/gemini/tumorBoardAgent.js';

const mockData: any = {
  patientHeader: {
    name: '[ANONYMIZOVÁNO]',
    insuranceNumber: '[ANON-RČ]',
    insuranceCode: 'VZP (111)',
    address: '[ANON-KONTAKT]',
    phone: '[ANON-KONTAKT]',
    metrics: '63 let, 168 cm, 85 kg, ECOG PS 0'
  },
  presentIllness: 'NO: pacientka přichází ke zvážení...',
  anamnesis: { oa: 'OA: nestonala' },
  stagingExaminations: [
    { title: 'CT hrudníku, břicha a pánve (28.5.2026):', fullText: 'Exaktní celý popis vyšetření bez zkracování...' }
  ],
  diagnosisAndTreatment: {
    dg: 'ca ovarii - HGSC tubo-ovariální (cT3c N1 M1b, FIGO IVB) (I.dg. 09/2025)',
    operations: [
      {
        title: 'St.p. core needle biopsii',
        dateAndPlace: '3.9.2025, VFN',
        histology: 'High-grade serózní karcinom (HGSC) - IHC: CK7+, PAX8+, WT1+, p53 mutovaný.'
      }
    ],
    chemotherapyLines: [
      {
        lineTitle: 'St.p. I. linii chemoterapie v režimu PTX/CBDCA (ukončeno 12.03.2026)',
        toxicityAndDose: 'Toxicita: G2 neutropenie, bez redukce dávky.'
      }
    ]
  },
  recurrences: [
    {
      header: '1. recidiva / progrese (05/2026, PFI 3 měsíce):',
      description: 'Platina-rezistentní progrese onemocnění (PFI 3 měsíce), progrese karcinomatózy, ascitu a nadbrániční lymfadenopatie na CT (28.05.2026), nárůst CA 125 na 1368 U/ml.',
      chemotherapyLine: 'II. linie CHT Caelyx (podány 3 cykly, poslední 18.08.2026)',
      chemotherapyToxicity: 'Toxicita: bez závažné toxicity, bez redukce dávky.'
    }
  ],
  tumorBoardConclusion: {
    date: 'Onkogynekologické konzilium 9.9.2026',
    attendees: 'prof. MUDr. Cibula, CSc., prof. MUDr. Sláma, Ph.D.',
    recommendation: 'Doporučení: Pacientka je předána ke sledování.'
  }
};

const res = renderStructuredJsonToHtml(mockData);
console.log('=== RENDERED REPORT HTML ===');
console.log(res.reportHtml);
