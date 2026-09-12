import * as fs from 'fs';
import * as path from 'path';
import { parseUploadedFiles, parseCzechDateToIso } from '../src/parser/parseInput.js';
import { buildTumorBoardPrompt } from '../src/gemini/promptBuilder.js';

const sampleFiles = ['Faryadová-amb.txt', 'Faryadová-lab.txt'].map(f => {
  const buf = fs.readFileSync(path.resolve('vstup', f));
  return { fileName: f, base64Content: buf.toString('base64') };
});

const dataset = parseUploadedFiles(sampleFiles);
const cutoffIso = '2026-04-01';

const filteredExams = dataset.examinations.filter(exam => {
  // 1. Check ISO date
  if (exam.date && exam.date !== '1970-01-01') {
    const examDateIso = exam.date.split('T')[0];
    if (examDateIso >= cutoffIso) return false;
  }

  // 2. Check ALL embedded dates in FULL content (no substring limitation!)
  const textToCheck = `${exam.rawDate || ''} ${exam.title || ''} ${exam.content || ''}`;
  const allFoundDates = (textToCheck.match(/\b(\d{1,2})[\.\/](\d{1,2})[\.\/](\d{2,4})\b/g) || [])
    .map(dStr => parseCzechDateToIso(dStr))
    .filter((d): d is string => d !== null && d !== '1970-01-01');

  if (allFoundDates.length > 0) {
    allFoundDates.sort();
    const maxFoundIso = allFoundDates[allFoundDates.length - 1].split('T')[0];
    if (maxFoundIso >= cutoffIso) {
      console.log(`[EXCLUDED EXAM ${exam.id}] maxFoundIso = ${maxFoundIso}`);
      return false;
    }
  }

  return true;
});

console.log('Original exams count:', dataset.examinations.length);
console.log('Filtered exams count:', filteredExams.length);

const cleanDataset = {
  ...dataset,
  examinations: filteredExams
};

const prompt = buildTumorBoardPrompt(cleanDataset, cutoffIso);

const has17Sept = prompt.includes('17.9.2026') || prompt.includes('17.09.2026');
const has11Aug = prompt.includes('11.8.2026') || prompt.includes('11.08.2026');
const hasMK2870 = prompt.includes('MK2870') || prompt.includes('MK-2870');
const hasC6 = prompt.includes('6 cyklů primární') || prompt.includes('po 6 cyklech');

console.log('\n--- VERIFICATION FOR FARYADOVÁ AT CUTOFF 2026-04-01 (FULL TEXT INSPECTION) ---');
console.log('Contains 17.9.2026 (future CT)?', has17Sept);
console.log('Contains 11.8.2026 (future C6 end)?', has11Aug);
console.log('Contains MK2870 study info?', hasMK2870);
console.log('Contains CHT 6 cycles completion?', hasC6);
