import * as fs from 'fs';
import * as path from 'path';
import { parseUploadedFiles } from '../src/parser/parseInput.js';

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

console.log('Total Examinations:', dataset.examinations.length);
console.log('Unparsed Fragments Count:', dataset.unparsedFragments?.length || 0);

if (dataset.unparsedFragments) {
  dataset.unparsedFragments.forEach((frag, idx) => {
    console.log(`\n[Fragment ${idx + 1}] File: ${frag.fileName} | Location: ${frag.location} | Reason: ${frag.reason} | Size: ${frag.sizeBytes} bytes`);
    console.log('Content preview:', frag.content.substring(0, 150).replace(/\n/g, ' '));
  });
}
