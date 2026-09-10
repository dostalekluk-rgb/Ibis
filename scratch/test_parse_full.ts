import { parseAllInputs } from '../src/parser/parseInput.js';
import * as path from 'path';

const vstupDir = path.resolve(process.cwd(), 'vstup');
const outputDir = path.resolve(process.cwd(), 'output');

console.log('Running parseAllInputs...');
const dataset = parseAllInputs(vstupDir, outputDir);
console.log('Total examinations parsed:', dataset.examinations.length);
console.log('Total unique lab analytes:', dataset.labAggregated?.totalUniqueTests);
console.log('Lab events count:', dataset.metadata.labEventsCount);
console.log('\nSample parsed lab/report examinations:');
dataset.examinations.filter(e => e.sourceType === 'lab').slice(0, 25).forEach(e => {
  console.log(` - [${e.date}] (${e.type}) ${e.title} [len: ${e.content.length}]`);
});
