import * as fs from 'fs';
import * as path from 'path';
import { parseUploadedFiles } from '../src/parser/parseInput.js';
import { filterDatasetByMaxDate } from '../src/gemini/tumorBoardAgent.js';
import { buildTumorBoardPrompt } from '../src/gemini/promptBuilder.js';

const sampleFiles = fs.readdirSync(path.resolve('vstup'))
  .filter(f => f.endsWith('.txt'))
  .map(f => {
    const buf = fs.readFileSync(path.resolve('vstup', f));
    return { fileName: f, base64Content: buf.toString('base64') };
  });

const dataset = parseUploadedFiles(sampleFiles);
console.log('Total examinations parsed:', dataset.examinations.length);
dataset.examinations.forEach((e, idx) => {
  console.log(`Exam ${idx + 1}: id=${e.id}, date=${e.date}, rawDate=${e.rawDate}, title=${e.title}, file=${e.sourceFile}`);
});

const maxDate = '2026-04-01';
const filteredDataset = filterDatasetByMaxDate(dataset, maxDate);

console.log('\n--- AFTER FILTERING BY 2026-04-01 ---');
console.log('Filtered examinations length:', filteredDataset.examinations.length);
filteredDataset.examinations.forEach((e, idx) => {
  console.log(`Filtered Exam ${idx + 1}: id=${e.id}, date=${e.date}, rawDate=${e.rawDate}, title=${e.title}`);
});

const prompt = buildTumorBoardPrompt(filteredDataset, maxDate);
fs.writeFileSync(path.resolve('scratch', 'debug_prompt_output.txt'), prompt, 'utf8');

console.log('\nPrompt written to scratch/debug_prompt_output.txt (length:', prompt.length, ')');

// Check if any mention of PTX/CBDCA 6 cycles or 17.9.2026 or 10.09.2026 exists in prompt!
const suspiciousMatches = prompt.match(/(17\.9\.2026|23\.9\.2026|10\.09\.26|30\.07\.26|11\.8\.2026|6 cykl|MK2870)/gi);
console.log('Suspicious matches found in prompt:', suspiciousMatches);
