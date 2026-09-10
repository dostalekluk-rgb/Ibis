import * as fs from 'fs';
import * as path from 'path';

function copyFolderRecursiveSync(source: string, target: string) {
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }

  if (fs.lstatSync(source).isDirectory()) {
    const files = fs.readdirSync(source);
    files.forEach(file => {
      const curSource = path.join(source, file);
      const curTarget = path.join(target, file);
      if (fs.lstatSync(curSource).isDirectory()) {
        copyFolderRecursiveSync(curSource, curTarget);
      } else {
        fs.copyFileSync(curSource, curTarget);
      }
    });
  }
}

async function createPortableBuild() {
  console.log('[Portable Build] Vytvářím přenosný balíček v adresáři /portable ...');

  const rootDir = process.cwd();
  const portableDir = path.join(rootDir, 'portable');

  if (fs.existsSync(portableDir)) {
    console.log('[Portable Build] Čistím starý adresář /portable ...');
    fs.rmSync(portableDir, { recursive: true, force: true });
  }
  fs.mkdirSync(portableDir, { recursive: true });

  // 1. Kopírování dist/
  console.log('[Portable Build] Kopíruji dist/ ...');
  copyFolderRecursiveSync(path.join(rootDir, 'dist'), path.join(portableDir, 'dist'));

  // 2. Kopírování node_modules/
  console.log('[Portable Build] Kopíruji node_modules/ ...');
  copyFolderRecursiveSync(path.join(rootDir, 'node_modules'), path.join(portableDir, 'node_modules'));

  // 3. Kopírování vstup/
  console.log('[Portable Build] Kopíruji vstup/ ...');
  copyFolderRecursiveSync(path.join(rootDir, 'vstup'), path.join(portableDir, 'vstup'));

  // 4. Vytvoření prázdné složky output/
  const outputDir = path.join(portableDir, 'output');
  fs.mkdirSync(outputDir, { recursive: true });

  // 5. Kopírování .env a package.json
  const envPath = path.join(rootDir, '.env');
  if (fs.existsSync(envPath)) {
    console.log('[Portable Build] Kopíruji .env ...');
    fs.copyFileSync(envPath, path.join(portableDir, '.env'));
  }

  const pkgPath = path.join(rootDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    console.log('[Portable Build] Kopíruji package.json ...');
    fs.copyFileSync(pkgPath, path.join(portableDir, 'package.json'));
  }

  // 6. Kopírování přenosné binárky node.exe do portable/node/node.exe
  const nodeBinDir = path.join(portableDir, 'node');
  fs.mkdirSync(nodeBinDir, { recursive: true });

  const systemNodeExe = process.execPath;
  const portableNodeExe = path.join(nodeBinDir, 'node.exe');

  console.log(`[Portable Build] Kopíruji node.exe z ${systemNodeExe} do ${portableNodeExe} ...`);
  fs.copyFileSync(systemNodeExe, portableNodeExe);

  // 7. Vytvoření spouštěcího souboru spustit_IBIS.bat
  const batContent = `@echo off
chcp 65001 > nul
title IBIS Onkogynekologické Konzilium - Portable VFN
echo ====================================================================
echo   IBIS ONKOGYNEKOLOGIE - PORTABLE VERZE PRO USB DISK
echo   Všechna data zůstávají uložená výhradně na tomto USB disku.
echo ====================================================================
echo.
echo Spouštím přenosný IBIS server...
echo Otevírám webové rozhraní v prohlížeči...
echo.

start "" "http://localhost:3000/chronology.html"

"%~dp0node\\node.exe" "%~dp0dist\\server.js"

pause
`;

  const batPath = path.join(portableDir, 'spustit_IBIS.bat');
  fs.writeFileSync(batPath, batContent, 'utf8');
  console.log(`[Portable Build] Vytvořen spouštěcí skript: ${batPath}`);

  console.log('\n====================================================================');
  console.log('  PORTABLE VERZE BYLA ÚSPĚŠNĚ VYTVOŘENA V SLOLŽCE /portable');
  console.log('  Složku "portable" můžete nyní kompletně zkopírovat na USB disk!');
  console.log('====================================================================\n');
}

createPortableBuild();
