import iconv from 'iconv-lite';

/**
 * Automatická detekce a čisté dekódování souboru (UTF-8 vs. Windows-1250 / CP1250)
 */
export function decodeFileBuffer(buf: Buffer): string {
  if (!buf || buf.length === 0) return '';

  // 1. Kontrola, zda vygenerovaný UTF-8 řetězec neobsahuje replacement character (\uFFFD)
  // a zda buffer neobsahuje bajty EF BF BD
  const utf8Str = buf.toString('utf8');
  const hasUfffd = utf8Str.includes('\uFFFD') || buf.includes(Buffer.from([0xef, 0xbf, 0xbd]));

  if (!hasUfffd) {
    return utf8Str;
  }

  // 2. Jinak se jedná o původní české lékařské exporty z VFN v kódování Windows-1250 (CP1250)
  const decodedWin1250 = iconv.decode(buf, 'win1250');
  
  // Pokud náhodou řetězec ještě obsahuje pozůstatky 'ďż˝', očistíme ho
  return decodedWin1250.replace(/ďż˝/g, '');
}

