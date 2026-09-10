import * as fs from 'fs';
import * as path from 'path';
import { anonymizeLocalText } from '../src/parser/parseLab.js';

const jsonPath = path.resolve('output/chronology_parsed.json');
if (!fs.existsSync(jsonPath)) {
  console.log('chronology_parsed.json not found.');
  process.exit(0);
}

const targetDataset = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const datasetJson = JSON.stringify(targetDataset);
const { anonymizedText, summary } = anonymizeLocalText(datasetJson, targetDataset.metadata);

console.log('Anonymization summary:', summary);

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
} else {
  console.log('SUCCESS: ZERO LEAKS!');
}
