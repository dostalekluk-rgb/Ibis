import fs from 'fs';
import path from 'path';
import iconv from 'iconv-lite';

function decodeFileBuffer(buf) {
  const utf8Str = buf.toString('utf8');
  if (!utf8Str.includes('\uFFFD') && !utf8Str.includes('ďż˝')) {
    return utf8Str;
  }
  return iconv.decode(buf, 'win1250');
}

const samplesDir = path.resolve(process.cwd(), 'vstup_samples');
if (fs.existsSync(samplesDir)) {
  const files = fs.readdirSync(samplesDir);
  for (const f of files) {
    const buf = fs.readFileSync(path.join(samplesDir, f));
    const decoded = decodeFileBuffer(buf);
    const hasCorrupt = decoded.includes('ďż˝') || decoded.includes('\uFFFD');
    console.log(`File: ${f} | Size: ${buf.length} bytes | Corrupt: ${hasCorrupt} | Sample: "${decoded.substring(0, 100).replace(/\r?\n/g, ' ')}"`);
  }
}
