import * as fs from 'fs';
import * as path from 'path';
import { parseUploadedFiles, parseCzechDateToIso } from '../src/parser/parseInput.js';

const sampleFiles = fs.readdirSync(path.resolve('vstup'))
  .filter(f => f.endsWith('.txt'))
  .map(f => {
    const buf = fs.readFileSync(path.resolve('vstup', f));
    return { fileName: f, base64Content: buf.toString('base64') };
  });

const dataset = parseUploadedFiles(sampleFiles);

console.log('--- PREAMBLE ENTRIES IN PARSED DATASET ---');
dataset.examinations.filter(e => e.id.includes('preamble')).forEach(e => {
  console.log(`Preamble ID: ${e.id}, Assigned Date: ${e.date}, Source: ${e.sourceFile}`);
  
  // Extract all dates in preamble content
  const matches = (e.content || '').match(/\b(\d{1,2})[\.\/](\d{1,2})[\.\/](\d{2,4})\b/g);
  if (matches) {
    const parsedIsoDates = matches.map(m => parseCzechDateToIso(m)).filter((d): d is string => d !== null);
    parsedIsoDates.sort();
    console.log(`  -> Dates found in preamble content:`, parsedIsoDates.slice(-5));
  }
});
