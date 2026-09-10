import * as path from 'path';
import { parseAllInputs } from './parser/parseInput.js';
import { generateChronologyHtml } from './parser/generateHtml.js';

function main() {
  console.log('====================================================');
  console.log('  IBIS ONCOLOGY AI — Fáze Ibis A: Parsování Vstupu');
  console.log('====================================================\n');

  const vstupDir = path.resolve(process.cwd(), 'vstup');
  const outputDir = path.resolve(process.cwd(), 'output');
  const htmlOutputPath = path.join(outputDir, 'chronology.html');

  // 1. Spuštění lokálního parseru
  const dataset = parseAllInputs(vstupDir, outputDir);

  // 2. Vygenerování HTML přehledu
  generateChronologyHtml(dataset, htmlOutputPath);

  console.log('\n----------------------------------------------------');
  console.log('  SHRNUTÍ ZPRACOVÁNÍ PACIENTKY:');
  console.log(`  Pacientka:            ${dataset.metadata.patientName}`);
  console.log(`  Číslo pojištěnce:     ${dataset.metadata.insuranceNumber}`);
  console.log(`  Datum narození:       ${dataset.metadata.dateOfBirth}`);
  console.log(`  Celkem vyšetření:     ${dataset.metadata.totalEvents}`);
  console.log(`  Ambulantní (amb):     ${dataset.metadata.ambEventsCount}`);
  console.log(`  Hospitalizační (hosp): ${dataset.metadata.hospEventsCount}`);
  console.log(`  Laboratorní (lab):    ${dataset.metadata.labEventsCount || 0}`);
  console.log(`  Sdružené lab. testy:  ${dataset.labAggregated?.totalUniqueTests || 0} analytů (${dataset.labAggregated?.totalUniqueDates || 0} odběrových dnů)`);
  console.log(`  Časový rozsah:        ${dataset.metadata.dateRange.firstDate} až ${dataset.metadata.dateRange.lastDate}`);
  console.log('----------------------------------------------------');
  console.log(`\n✅ HOTOVO! Otevřete HTML přehled v prohlížeči:\n   file:///${htmlOutputPath.replace(/\\/g, '/')}\n`);
}

main();
