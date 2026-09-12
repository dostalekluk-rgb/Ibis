import * as fs from 'fs';
import * as path from 'path';

const text = fs.readFileSync(path.resolve('scratch', 'debug_prompt_output.txt'), 'utf8');
const lines = text.split('\n');

lines.forEach((line, idx) => {
  if (line.includes('17.9.2026') || line.includes('11.8.2026') || line.includes('MK2870')) {
    console.log(`Line ${idx + 1}: ${line.substring(0, 200)}`);
  }
});
