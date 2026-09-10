import fs from 'fs';
import path from 'path';

const samplesDir = path.resolve(process.cwd(), 'vstup_samples');
const targetDir = path.resolve(process.cwd(), 'vstup');

if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

if (fs.existsSync(samplesDir)) {
  const files = fs.readdirSync(samplesDir);
  for (const f of files) {
    const src = path.join(samplesDir, f);
    const dest = path.join(targetDir, f);
    fs.copyFileSync(src, dest);
    console.log('Restored to vstup:', f);
  }
}
