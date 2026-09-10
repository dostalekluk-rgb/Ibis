import * as fs from 'fs';
import * as path from 'path';

const vstupDir = path.resolve(process.cwd(), 'vstup');
console.log('Target vstupDir:', vstupDir);
if (fs.existsSync(vstupDir)) {
  const files = fs.readdirSync(vstupDir);
  console.log('Found files:', files.length);
  for (const f of files) {
    try {
      const p = path.join(vstupDir, f);
      fs.unlinkSync(p);
      console.log('Unlinked:', f);
    } catch (err) {
      console.error('Failed to unlink:', f, err.message);
    }
  }
}
