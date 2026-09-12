export interface BiomarkerProfile {
  erStatus?: string;
  prStatus?: string;
  her2Status?: string;
  ki67Index?: string;
  brcaStatus?: string;
}

export type SourceType = 'amb' | 'hosp' | 'lab';

export interface ParsedExamination {
  id: string;
  date: string;               // ISO 8601 formát (např. "2025-09-03" nebo "2025-09-03T11:18:00")
  rawDate: string;            // Původní řetězec data (např. "03.09.25")
  time?: string | null;       // Původní čas vyšetření (např. "11:18"), pokud byl uveden
  sourceFile: string;         // Název zdrojového souboru (např. "ai-stankova-amb.txt")
  sourceType: SourceType;     // Typ zdroje: 'amb' (ambulatní zpráva), 'hosp' (průběh hospitalizace) nebo 'lab' (laboratoř/skiagrafie)
  type: string;               // Typ vyšetření / záznamu (např. "Ambulantní nález", "Hospitalizační dekurz", "Laboratorní panel")
  doctor?: string | null;     // Jméno ošetřujícího lékaře, je-li k dispozici
  title: string;              // Titulek / hlavička vyšetření
  content: string;            // Kompletní vyčištěný text vyšetření
}

export interface PatientChronologyMetadata {
  patientName?: string;
  insuranceNumber?: string;
  insuranceCode?: string;
  address?: string;
  phone?: string;
  dateOfBirth?: string;
  generatedAt: string;
  totalEvents: number;
  ambEventsCount: number;
  hospEventsCount: number;
  labEventsCount?: number;
  dateRange: {
    firstDate: string;
    lastDate: string;
  };
}

export interface UnparsedFile {
  fileName: string;
  sizeBytes: number;
  content: string;
}

export interface UnparsedTextFragment {
  id: string;
  fileName: string;
  sourceType?: SourceType;
  location: string;
  reason: string;
  content: string;
  sizeBytes: number;
}

export interface LabMeasurement {
  date: string;         // ISO date e.g. "2025-09-22"
  rawDate: string;      // Původní datum e.g. "22/09/25"
  value: string;        // Původní hodnota e.g. "4,8"
  numericValue?: number | null;
}

export interface LabTestGroup {
  testName: string;
  totalMeasurements: number;
  firstDate?: string;
  lastDate?: string;
  measurements: LabMeasurement[];
}

export interface LabDateGroup {
  date: string;
  rawDate: string;
  totalTests: number;
  results: Record<string, string>;
}

export interface LabAggregatedDataset {
  byTest: Record<string, LabTestGroup>;
  byDate: Record<string, LabDateGroup>;
  totalUniqueTests: number;
  totalUniqueDates: number;
}

export interface RecurrenceBlock {
  header: string;            // např. "1. recidiva / progrese (02/2024, TFI 8 let):"
  description: string;       // Popis zobrazení / klinického nálezu recidivy
  operations?: Array<{
    title: string;            // např. "St.p. resekci recidivy pánevního tumoru..."
    dateAndPlace: string;     // např. "1.2.2024, VFN Praha"
    text?: string;            // Popis nálezu v dutině břišní při operaci (in situ)
    histology?: string;       // Popis histologie na novém řádku s "-histol: "
  }>;
  treatmentsAndHistory?: string[]; // např. ["St.p. zavedení ureterálního stentu..."]
  chemotherapyLine?: string; // např. "1. linie CHT Abraxane/cDDP..."
  chemotherapyToxicity?: string; // např. "Toxicita: G1 hypothyreóza..."
}

export interface DiagnosisAndTreatmentBlock {
  dg: string;                 // Dg.: ca ovarii... nebo 1) ca colli uteri..., 2) ca thyroidey...
  operations?: Array<{
    title: string;            // např. "St.p. core needle biopsii"
    dateAndPlace: string;     // např. "3.9.2025, VFN"
    text?: string;            // Popis nálezu v dutině břišní při operaci (in situ)
    histology?: string;       // Popis histologie na novém řádku s "-histol: " kurzívou
  }>;
  chemotherapyLines?: Array<{
    lineTitle?: string;
    line?: string;
    lineText?: string;
    text?: string;
    toxicityAndDose?: string;
    chemotherapyToxicity?: string;
    toxicity?: string;
  } | string>;
  treatmentsAndHistory?: string[];
  recurrences?: RecurrenceBlock[];
}

export interface TumorBoardStructuredJson {
  patientHeader: {
    name: string;             // [ANONYMIZOVÁNO]
    insuranceNumber: string;  // [ANON-RČ]
    insuranceCode: string;    // VZP (111)
    address: string;          // [ANON-KONTAKT]
    phone: string;            // [ANON-KONTAKT]
    metrics: string;          // např. "63 let, 168 cm, 85 kg, ECOG PS 0"
  };
  presentIllness: string;     // NO: ...
  anamnesis: {
    oa?: string;
    operace?: string;
    fa?: string;
    aa?: string;
    ga?: string;
  };
  stagingExaminations: Array<{
    title: string;            // např. "CT hrudníku, břicha a pánve (28.5.2026):"
    fullText: string;         // Exaktní celý popis vyšetření
  }> | string[];
  diagnosisAndTreatment: DiagnosisAndTreatmentBlock[] | DiagnosisAndTreatmentBlock;
  recurrences?: RecurrenceBlock[];
  tumorBoardConclusion: {
    date: string;               // např. "Onkogynekologické konzilium 9.9.2026"
    attendees: string;          // prof. MUDr. Cibula, CSc., prof. MUDr. Sláma, Ph.D., ...
    recommendation: string;     // Doporučení: ...
  };
}

export interface PatientChronologyDataset {
  metadata: PatientChronologyMetadata;
  examinations: ParsedExamination[];
  unparsedFiles: UnparsedFile[];
  unparsedFragments?: UnparsedTextFragment[];
  labAggregated?: LabAggregatedDataset;
  tumorBoardStructured?: TumorBoardStructuredJson;
}
