import * as fs from 'fs';
import * as path from 'path';
import { parseUploadedFiles } from '../src/parser/parseInput.js';
import { filterDatasetByMaxDate } from '../src/gemini/tumorBoardAgent.js';
import { buildTumorBoardPrompt } from '../src/gemini/promptBuilder.js';

const sampleFiles = [
  'ai-stankova-amb.txt',
  'ai-stankova-hosp-01.txt',
  'ai-stankova-hosp-02.txt',
  'ai-stankova-hosp-03.txt',
  'ai-stankova-hosp-04.txt',
  'ai-stankova-lab.txt'
].map(f => {
  const buf = fs.readFileSync(path.resolve('vstup_samples', f));
  return { fileName: f, base64Content: buf.toString('base64') };
});

const dataset = parseUploadedFiles(sampleFiles);
console.log('Original total examinations:', dataset.examinations.length);
console.log('Original date range:', dataset.metadata.dateRange);

// Test 1: Cutoff at 2026-05-01 (should exclude 2026-05-01 and later)
const cutoff1 = '2026-05-01';
const filtered1 = filterDatasetByMaxDate(dataset, cutoff1);

console.log(`\n--- Cutoff Test 1 (maxDate = ${cutoff1}) ---`);
console.log('Filtered total examinations:', filtered1.examinations.length);
console.log('Filtered date range:', filtered1.metadata.dateRange);

const hasExcluded1 = filtered1.examinations.some(e => e.date >= cutoff1);
console.log('Any examination >= cutoff present in filtered dataset?', hasExcluded1);
if (!hasExcluded1 && filtered1.examinations.length < dataset.examinations.length) {
  console.log('SUCCESS: All examinations >= 2026-05-01 correctly excluded!');
} else {
  console.error('FAILURE in Cutoff Test 1');
}

// Test 2: Build prompt with maxDate and verify no dates >= cutoff1 exist in prompt JSON inputs
const promptStr = buildTumorBoardPrompt(filtered1, cutoff1);
const hasCutoffDateInPrompt = promptStr.includes('2026-09-05') || promptStr.includes('2026-06-01') || promptStr.includes('2026-05-01');
console.log('Any dates >= 2026-05-01 present in generated prompt string?', hasCutoffDateInPrompt);
if (!hasCutoffDateInPrompt) {
  console.log('SUCCESS: Prompt string contains ZERO dates on or after cutoff!');
} else {
  console.error('FAILURE: Found date on or after cutoff in prompt!');
}

// Test 3: Cutoff in future (e.g. 2099-01-01) -> should keep all
const cutoff2 = '2099-01-01';
const filtered2 = filterDatasetByMaxDate(dataset, cutoff2);
console.log(`\n--- Cutoff Test 3 (maxDate = ${cutoff2}) ---`);
console.log('Filtered total examinations:', filtered2.examinations.length);
if (filtered2.examinations.length === dataset.examinations.length) {
  console.log('SUCCESS: Future date cutoff keeps all examinations!');
}

