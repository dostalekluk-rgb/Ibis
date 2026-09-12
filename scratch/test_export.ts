import { generateTumorBoardDocx } from '../src/exporter/docxExporter';
import * as fs from 'fs';

async function testExport() {
  const sampleJson = {
    patientHeader: {
      name: "Lánská Jaroslava",
      insuranceNumber: "5551021696",
      insuranceCode: "111",
      address: "Horní Rokytnice 552",
      phone: "+420737836785",
      metrics: "71 let, 167 cm, 82 kg, ECOG PS 0"
    },
    presentIllness: "NO: Pacientka přichází pro pánevní recidivu ca endometria dle MRI.",
    anamnesis: {
      oa: "OA: vážněji nestonala",
      operace: "Operace: S.C. z DSL - 1979",
      fa: "FA: Tezefort 40mg/5mg",
      aa: "AA: neguje",
      ga: "GA: partus 1x S.C."
    },
    stagingExaminations: [
      {
        title: "CT hrudníku, břicha a pánve (4.9.2026):",
        fullText: "Výrazná progrese generalizace - v játrech, plicních hilech..."
      }
    ],
    diagnosisAndTreatment: [
      {
        dg: "ca endometrii (endometroidní G2) pT1a (5/22 mm) Nx Mx (I.dg. 8/2021)",
        operations: [
          {
            title: "St.p. TLH cum AE bilat.",
            dateAndPlace: "12/2021, Jilemnice",
            histology: "G2 endometroidní adenoca endometria."
          }
        ],
        treatmentsAndHistory: [
          "St.p. adjuvantní CHT"
        ],
        recurrences: [
          {
            header: "1. recidiva / progrese (05/2023):",
            description: "Pánevní tumor.",
            operations: [
              {
                title: "St.p. reLPT, exstirpace recidivy",
                dateAndPlace: "27.1.2026, VFN Praha",
                histology: "Recidiva endometroidního karcinomu G3."
              }
            ]
          }
        ]
      }
    ],
    tumorBoardConclusion: {
      date: "Onkogynekologické konsilium 9.9.2026",
      attendees: "prof. MUDr. Cibula, CSc., prof. MUDr. Sláma, Ph.D., MUDr. Frühauf, Ph.D.",
      recommendation: "Doporučení: Vzhledem ke zhoršení klinického stavu doporučujeme ukončit systémovou léčbu a dále jen BSC."
    }
  };

  const metadata = {
    patientName: "Lánská Jaroslava",
    insuranceNumber: "5551021696",
    insuranceCode: "111",
    address: "Horní Rokytnice 552",
    phone: "+420737836785",
    dateOfBirth: "02.01.1955",
    generatedAt: "2026-09-12",
    totalEvents: 10,
    ambEventsCount: 5,
    hospEventsCount: 3,
    labEventsCount: 2,
    dateRange: { firstDate: "2023-01-01", lastDate: "2026-09-09" }
  };

  const { buffer, filename } = await generateTumorBoardDocx(sampleJson, metadata, "2026-09-09");
  console.log("GENERATED FILENAME:", filename);
  console.log("BUFFER SIZE:", buffer.length);
  fs.writeFileSync(`scratch/${filename}`, buffer);
}

testExport().catch(console.error);
