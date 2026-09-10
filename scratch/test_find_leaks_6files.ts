import * as fs from 'fs';
import * as path from 'path';
import { parseUploadedFiles } from '../src/parser/parseInput.js';
import { anonymizeLocalText } from '../src/parser/parseLab.js';

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
const datasetJson = JSON.stringify(dataset);
const { anonymizedText, summary } = anonymizeLocalText(datasetJson, dataset.metadata);

const czWordChar = 'a-zA-Z0-9áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ';
const nameCheck = anonymizedText.match(new RegExp(`(?<![${czWordChar}])(Staňková|Stankova|Šárka|Sarka|Neumannová|Neumannova|Hana|Wolf|Heike|Šromová|Sromová|Sromova|Eva)(?![${czWordChar}])`, 'gi'));
const pojCheck = anonymizedText.match(/(?<![0-9])(635105\/?6382|606120\/?0530|656022\/?7091|575916\/?0993)(?![0-9])/g);

console.log('nameCheck matches:', nameCheck);
console.log('pojCheck matches:', pojCheck);

if (nameCheck || pojCheck) {
  const lines = anonymizedText.split('\n');
  lines.forEach((l, idx) => {
    const nm = l.match(new RegExp(`(?<![${czWordChar}])(Staňková|Stankova|Šárka|Sarka|Neumannová|Neumannova|Hana|Wolf|Heike|Šromová|Sromová|Sromova|Eva)(?![${czWordChar}])`, 'gi'));
    const pm = l.match(/(?<![0-9])(635105\/?6382|606120\/?0530|656022\/?7091|575916\/?0993)(?![0-9])/g);
    if (nm || pm) {
      console.log(`[Line ${idx + 1} match] names:`, nm, 'rc:', pm);
      console.log('   Snippet:', l.substring(0, 300));
    }
  });
}
