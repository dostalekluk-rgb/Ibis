import * as fs from 'fs';
import * as path from 'path';

const jsonPath = path.resolve('output/chronology_parsed.json');
if (!fs.existsSync(jsonPath)) {
  console.log('No chronology_parsed.json found.');
  process.exit(0);
}

const targetDataset = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

function escapeReg(str: string): string {
  const spec = ['.', '*', '+', '?', '^', '$', '(', ')', '[', ']', '{', '}', '|', '\\'];
  return str.split('').map(ch => spec.includes(ch) ? '\\' + ch : ch).join('');
}

function anonymizeDatasetText(text: string, metadata: any): string {
  let anonymized = text;

  // 1. Collect all name words
  const terms = new Set(['Staňková', 'Stankova', 'Šárka', 'Sarka', 'Neumannová', 'Neumannova', 'Hana', 'Wolf', 'Heike', 'Šromová', 'Sromová', 'Sromova', 'Eva']);

  if (metadata?.patientName) {
    const clean = metadata.patientName.replace(/\b(Mgr|MUDr|PhDr|Ing|doc|prof|Ph\.D\.|CSc\.)\.?/gi, '').replace(/[.,]/g, '');
    clean.split(/\s+/).forEach((w: string) => {
      const trimmed = w.trim();
      if (trimmed.length > 2) {
        terms.add(trimmed);
        const ascii = trimmed.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (ascii.length > 2) terms.add(ascii);
      }
    });
  }

  const sortedTerms = Array.from(terms).sort((a, b) => b.length - a.length);
  const namePattern = sortedTerms.map(t => escapeReg(t)).join('|');
  const czWordChar = 'a-zA-Z0-9áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ';
  const nameRegex = new RegExp(`(?<![${czWordChar}])(${namePattern})(?![${czWordChar}])`, 'gi');

  // 2. Collect insurance numbers / RČ
  const RČs = new Set(['6351056382', '6061200530', '6560227091', '5759160993']);
  if (metadata?.insuranceNumber) {
    const raw = metadata.insuranceNumber.replace('/', '').trim();
    if (raw.length >= 6) {
      RČs.add(raw);
      if (raw.length === 10) {
        RČs.add(raw.substring(0, 6) + '/' + raw.substring(6));
      }
    }
  }
  const rcPattern = Array.from(RČs).map(r => escapeReg(r)).join('|');
  const rcRegex = new RegExp(`(?<![0-9])(${rcPattern})(?![0-9])`, 'g');
  const genericRcRegex = /(?<![0-9])\d{6}\/\d{3,4}(?![0-9])/g;

  // 3. Address and Phone
  const contacts = new Set(['U Hostavického potoka 735/27', 'Praha 9', 'Praha 98', '+420737947022', '+420 737 947 022']);
  if (metadata?.address && metadata.address.length > 5) contacts.add(metadata.address);
  if (metadata?.phone && metadata.phone.length > 5) contacts.add(metadata.phone);

  const contactPattern = Array.from(contacts).map(c => escapeReg(c)).join('|');
  const contactRegex = new RegExp('(' + contactPattern + '|\\+?420\\s*\\d{3}\\s*\\d{3}\\s*\\d{3})', 'gi');

  anonymized = anonymized
    .replace(nameRegex, '[ANONYMIZOVÁNO]')
    .replace(rcRegex, '[ANON-RČ]')
    .replace(genericRcRegex, '[ANON-RČ]')
    .replace(contactRegex, '[ANON-KONTAKT]');

  return anonymized;
}

const datasetJson = JSON.stringify(targetDataset);
const cleanText = anonymizeDatasetText(datasetJson, targetDataset.metadata);

const nameCheck = cleanText.match(/Staňková|Stankova|Šárka|Sarka|Neumannová|Neumannova|Wolf|Heike|Šromová|Sromová/gi);
const pojCheck = cleanText.match(/635105\/?6382|606120\/?0530|656022\/?7091|575916\/?0993/g);

console.log('Remaining name matches count:', nameCheck ? nameCheck.length : 0);
console.log('Remaining RČ matches count:', pojCheck ? pojCheck.length : 0);

const parsedClean = JSON.parse(cleanText);
console.log('Checking dataset fields:');
parsedClean.examinations.forEach((ex: any, idx: number) => {
  if (/Staňková|Stankova/i.test(ex.sourceFile)) console.log(`Exam ${idx + 1} sourceFile:`, ex.sourceFile);
  if (/Staňková|Stankova/i.test(ex.title)) console.log(`Exam ${idx + 1} title:`, ex.title);
  if (/Staňková|Stankova/i.test(ex.content)) console.log(`Exam ${idx + 1} content sample:`, ex.content.substring(0, 100));
});

if (parsedClean.unparsedFiles) {
  parsedClean.unparsedFiles.forEach((uf: any) => {
    if (/Staňková|Stankova/i.test(uf.fileName)) console.log('Unparsed fileName:', uf.fileName);
    if (/Staňková|Stankova/i.test(uf.content)) console.log('Unparsed content sample:', uf.content.substring(0, 100));
  });
}
