import fs from 'fs';
import path from 'path';

async function runTest() {
  const samplePath = path.resolve(process.cwd(), 'vstup_samples', 'ai-stankova-amb.txt');
  const sampleContent = fs.readFileSync(samplePath, 'utf8');

  console.log('--- Step 1: Upload file via POST /api/upload ---');
  const uploadRes = await fetch('http://localhost:3000/api/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      files: [{ fileName: 'ai-stankova-amb.txt', content: sampleContent }]
    })
  });
  const uploadData = await uploadRes.json();
  console.log('Upload response:', uploadData.isSuccess, 'totalEvents:', uploadData.totalEvents);

  const checkVstup1 = fs.readdirSync(path.resolve(process.cwd(), 'vstup'));
  console.log('vstup files after upload:', checkVstup1);

  console.log('\n--- Step 2: Simulate browser F5 refresh via GET /chronology.html ---');
  const refreshRes = await fetch('http://localhost:3000/chronology.html');
  const refreshHtml = await refreshRes.text();

  console.log('Refresh status:', refreshRes.status);
  console.log('Refresh HTML includes empty state msg:', refreshHtml.includes('Není načtena žádná zdravotní dokumentace'));
  console.log('Refresh HTML includes EXAM-001:', refreshHtml.includes('EXAM-001'));

  const checkVstup2 = fs.readdirSync(path.resolve(process.cwd(), 'vstup'));
  console.log('vstup files after F5 refresh:', checkVstup2);
}

runTest().catch(console.error);
