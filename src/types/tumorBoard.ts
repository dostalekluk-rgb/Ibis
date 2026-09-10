/**
 * Ibis B: Datové typy pro redukovaný zápis pro Tumor Board (Indikační komisi)
 */

import { BiomarkerProfile } from './chronology.js';

export interface TreatmentLineSummary {
  lineType: 'neoadjuvant' | 'adjuvant' | 'palliative_line_1' | 'palliative_line_2' | 'palliative_line_3_plus';
  regimen: string;           // Název režimu
  period: string;            // Např. "03/2024 - 08/2024"
  bestResponse: string;      // Např. "Parciální remise (PR)", "Progrese (PD) po 6 měsících"
  toxicityOrNotes?: string;  // Důvod ukončení / toxicita
}

export interface KeyImagingSummary {
  date: string;
  modality: string;
  keyFindings: string;       // Klíčový nález (např. "Nová ložiska v játrech S4/S8 do 18mm, osteolytické metastázy Th12-L2 stabilní")
  overallAssessment: 'response' | 'stable' | 'progression';
}

export interface TumorBoardSummary {
  patientId: string;
  summaryDate: string;       // Datum sestavení zápisu
  
  // 1. Diagnóza a Biomarkery
  primaryDiagnosis: {
    icdCode: string;
    description: string;
    stageInitial: string;
    currentStage: string;
    histologyType: string;
    biomarkers: BiomarkerProfile;
  };

  // 2. Anamnéza dosavadní onkologické léčby (Chronologicky po liniích)
  treatmentHistory: TreatmentLineSummary[];

  // 3. Chirurgické výkony a radioterapie
  surgeriesAndRadiotherapy: Array<{
    date: string;
    procedure: string;     // Např. "Ablatio mammae l.dx. + exenterace axily" nebo "RT na skelet Th11-L3 (30 Gy)"
    resultOrOutcome: string;
  }>;

  // 4. Aktuální stav & Indikační dotaz pro komisi
  currentClinicalStatus: {
    performanceStatusECOG: number; // 0, 1, 2, 3, 4
    currentSymptoms: string[];     // Bolesti záder, únava atd.
    presentationReason: string;    // Důvod předložení: npř. "Progrese nálezu v játrech při 1. linii léčby (Anastrozol + Ribociclib)"
    questionForBoard: string;      // Dotaz pro komisi: npř. "Volba 2. linie systémové léčby (T-DXd vs. Alpelisib + Fulvestrant při PIK3CA mutaci vs. Chemoterapie)"
  };

  // 5. Nejnovější vyšetření (CT, PET/CT, Tumor markery)
  latestImaging: KeyImagingSummary[];
  latestLabMarkers?: Array<{
    date: string;
    markerName: string;   // CA 15-3, CEA
    value: string;
    referenceRange?: string;
  }>;
}

/**
 * Ibis C: Struktura odpovědi od Gemini (Doporučení & Návrhy postupu)
 */
export interface ClinicalRecommendationOption {
  optionNumber: number;
  title: string;                 // Např. "Sestava 2. linie: Sacituzumab govitecan (Trodelvy)"
  rationale: string;             // Klinické zdůvodnění na základě výsledků a guidelines
  cosGuidelineRef?: string;      // Odkaz na Modrou knihu ČOS (např. "ČOS Modrá kniha 2025, Kapitola 5.2.3")
  nccnEsmoRef?: string;          // Odkaz na NCCN/ESMO guidelines
  pros: string[];
  consAndRisks: string[];
  vzpReimbursementCriteriaMet?: boolean | string; // Splňuje kritéria úhrady VZP v ČR?
}

export interface GeminiTumorBoardAnalysis {
  patientId: string;
  analysisTimestamp: string;
  executiveSummary: string;       // Krátké shrnutí případu pro komisi
  recommendedOptions: ClinicalRecommendationOption[];
  suggestedFurtherWorkup?: string[]; // Doplňující vyšetření (např. "Doporučujeme doplnit ctDNA / NGS panel FoundationOne pro PIK3CA/ESR1")
}
