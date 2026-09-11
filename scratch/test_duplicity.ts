import { renderStructuredJsonToHtml } from '../src/gemini/tumorBoardAgent.js';
import { TumorBoardStructuredJson } from '../src/types/chronology.js';

const sampleJson: TumorBoardStructuredJson = {
  patientHeader: {
    name: '[ANONYMIZOVÁNO]',
    insuranceNumber: '[ANON-RČ]',
    insuranceCode: 'VZP (111)',
    address: '[ANON-KONTAKT]',
    phone: '[ANON-KONTAKT]',
    metrics: '63 let, 168 cm, 85 kg, ECOG PS 0'
  },
  presentIllness: 'NO: Pacientka s duplicitním karcinomem colli uteri a thyroidey...',
  anamnesis: { oa: 'OA: duplicitní malignita' },
  stagingExaminations: [],
  diagnosisAndTreatment: [
    {
      dg: '1) ca colli uteri - adenokarcinom/adenoskvamózní (I.dg. 2016)',
      operations: [
        {
          title: 'St.p. hysterektomii sec. Pfannenstiel',
          dateAndPlace: '2016, Ukrajina',
          histology: 'Dokumentace z primární operace není k dispozici.'
        }
      ],
      treatmentsAndHistory: [
        'St.p. adjuvantní kombinované radioterapii (EBRT + BRT) pro ca colli uteri (2016)'
      ],
      recurrences: [
        {
          header: '1. recidiva / progrese (02/2024, TFI 8 let):',
          description: 'Pánevní tumor vpravo utlačující pravý ureter s hydronefrózou III. st. a parailickou lymfadenopatií.',
          treatmentsAndHistory: [
            'St.p. zavedení ureterálního stentu vpravo pro hydronefrózu a útlak ureteru (01/2024, opakované výměny stentu)'
          ],
          operations: [
            {
              title: 'St.p. resekci recidivy pánevního tumoru, disekci ureteru, exstirpaci tumoru a pánevních LN',
              dateAndPlace: '1.2.2024, VFN Praha',
              histology: 'Metastáza HPV asociovaného dobře diferencovaného adenokarcinomu hrdla děložního s minoritní dlaždicobuněčnou diferenciací (adenoskvamózní). Největší rozměr ložiska 20 mm. Uzlina průměru 8 mm zcela spotřebována metastázou. PD-L1 (22C3) CPS = 20.'
            }
          ],
          chemotherapyLine: 'St.p. 1. linii CHT v režimu Abraxane/cDDP (6 cyklů, ukončeno 02.07.2024) + bevacizumab + pembrolizumab (od 05.03.2024, pembrolizumab ukončen 22.05.2026 35. cyklem)',
          chemotherapyToxicity: 'Toxicita: G1 hypothyreóza při imunoterapii (substituce Letrox), G1 neutropenie (odklad cyklu o týden), bez redukce dávky. Aplikován 38. cyklus bevacizumabu (04.09.2026)'
        }
      ]
    },
    {
      dg: '2) ca thyroidey (I.dg. 2016)',
      operations: [
        {
          title: 'St.p. totální thyreoidektomii',
          dateAndPlace: '2016',
          histology: 'Ca thyroidey.'
        }
      ],
      treatmentsAndHistory: [
        'St.p. terapii radiojodem pro ca thyroidey (2016–2020)'
      ]
    }
  ],
  tumorBoardConclusion: {
    date: 'Onkogynekologické konzilium 9.9.2026',
    attendees: 'prof. MUDr. Cibula, CSc.',
    recommendation: 'Doporučení: Pokračovat v zavedené udržovací terapii.'
  }
};

const result = renderStructuredJsonToHtml(sampleJson);
console.log('--- RENDERED REPORT HTML ---');
console.log(result.reportHtml);
