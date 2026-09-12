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
const cutoffIso = '2026-04-01';

const filteredExams = dataset.examinations
  .filter(exam => {
    // 1. Standardní kontrola podle ISO data
    if (exam.date && exam.date !== '1970-01-01') {
      const examDateIso = exam.date.split('T')[0];
      if (examDateIso >= cutoffIso) return false;
    }

    // 2. Kontrola všech dat v obsahu/názvu
    const textToCheck = `${exam.rawDate || ''} ${exam.title || ''} ${exam.content || ''}`;
    const allFoundDates = (textToCheck.match(/\b(\d{1,2})[\.\/](\d{1,2})[\.\/](\d{2,4})\b/g) || [])
      .map(dStr => parseCzechDateToIso(dStr))
      .filter((d): d is string => d !== null && d !== '1970-01-01');

    if (allFoundDates.length > 0) {
      allFoundDates.sort();
      const maxFoundIso = allFoundDates[allFoundDates.length - 1].split('T')[0];
      if (maxFoundIso >= cutoffIso) {
        return false;
      }
    }

    return true;
  });

filteredExams.forEach(e => {
  const content = e.content || '';
  if (content.includes('17.9.2026') || content.includes('11.8.2026') || content.includes('MK2870') || content.includes('6 cykl')) {
    console.log(`[STILL HAS MATCH] ${e.id} (${e.date}, ${e.title}, file: ${e.sourceFile}):`);
    const lines = content.split('\n');
    lines.forEach(l => {
      if (l.includes('17.9.2026') || l.includes('11.8.2026') || l.includes('MK2870') || l.includes('6 cykl')) {
        console.log('   -> ', l.substring(0, 150));
      }
    });
  }
});
