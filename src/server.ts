import express from 'express';
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import { generateTumorBoardSummary, handleGeminiChatCall } from './gemini/tumorBoardAgent.js';
import { parseAllInputs, parseUploadedFiles } from './parser/parseInput.js';
import { generateChronologyHtml } from './parser/generateHtml.js';
import { PatientChronologyDataset, PatientChronologyMetadata } from './types/chronology.js';
import { generateTumorBoardDocx } from './exporter/docxExporter.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;


// Helper pro vygenerování čisté prázdné stránky bez načtení souborů (SOUBORY VE VSTUP/ NA DISKU SE NIKDY NEMAŽOU)
function serveEmptyChronologyPage(res: express.Response) {
  const outputDir = path.resolve(process.cwd(), 'output');
  const emptyDataset: PatientChronologyDataset = {
    metadata: {
      patientName: 'Není načten žádný pacient',
      insuranceNumber: '—',
      insuranceCode: '—',
      address: '—',
      phone: '—',
      dateOfBirth: '—',
      generatedAt: new Date().toISOString(),
      totalEvents: 0,
      ambEventsCount: 0,
      hospEventsCount: 0,
      labEventsCount: 0,
      dateRange: { firstDate: '—', lastDate: '—' }
    },
    examinations: [],
    unparsedFiles: [],
    unparsedFragments: []
  };

  const htmlPath = path.join(outputDir, 'chronology.html');
  generateChronologyHtml(emptyDataset, htmlPath);
  res.sendFile(htmlPath);
}

// Načtení / Obnovení stránky (GET / a GET /chronology.html): Při načtení/obnovení stránky (F5) VŽDY zobrazí čistý stav (0 vyšetření)
app.get(['/', '/chronology.html'], (req, res) => {
  console.log('[Express Server] Načtení/Obnovení stránky (GET) -> zobrazuji čistý stav bez načtených vyšetření.');
  serveEmptyChronologyPage(res);
});

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.resolve(process.cwd(), 'output')));

// Endpoint pro odeslání anonymizovaných dat do Gemini
app.post('/api/gemini', async (req, res) => {
  try {
    const { isAnonymized, userApiKey, maxDate } = req.body;

    if (!isAnonymized) {
      return res.status(400).json({
        isSuccess: false,
        error: 'BEZPEČNOSTNÍ STOP: Data nebyla anonymizována! Provedení anonymizace je povinné.'
      });
    }

    console.log(`[Express Server] Přijat požadavek na generování Závěru Tumor Boardu${maxDate ? ` (maxDate: ${maxDate})` : ''}...`);
    const result = await generateTumorBoardSummary(undefined, userApiKey, maxDate);

    res.json(result);
  } catch (err: any) {
    console.error('[Express Server Error]:', err.message || err);
    res.status(500).json({
      isSuccess: false,
      error: err.message || 'Chyba při komunikaci s Gemini API'
    });
  }
});

let currentServerDataset: PatientChronologyDataset | null = null;

// Endpoint pro export Závěru Tumor Boardu do Wordu (.docx) ve formátu konzilia.docx
app.post('/api/export-docx', async (req, res) => {
  try {
    const { structuredJson, metadata, maxDate } = req.body;

    let targetJson = structuredJson;
    if (!targetJson) {
      const tbJsonPath = path.resolve(process.cwd(), 'output', 'json', 'tumor_board_conclusion.json');
      if (fs.existsSync(tbJsonPath)) {
        targetJson = JSON.parse(fs.readFileSync(tbJsonPath, 'utf8'));
      }
    }

    if (!targetJson) {
      return res.status(400).json({ isSuccess: false, error: 'Žádný Závěr Tumor Boardu pro export neby prokazatelný.' });
    }

    const serverMeta = currentServerDataset?.metadata;
    const combinedMeta: PatientChronologyMetadata = {
      patientName: (metadata?.patientName && !metadata.patientName.includes('ANON') && metadata.patientName !== 'Není načten žádný pacient' && metadata.patientName !== 'Vyšetřovaná Pacientka')
        ? metadata.patientName
        : (serverMeta?.patientName || 'Pacientka'),
      insuranceNumber: (metadata?.insuranceNumber && !metadata.insuranceNumber.includes('ANON') && metadata.insuranceNumber !== '—' && metadata.insuranceNumber !== '[Neznámé RČ]')
        ? metadata.insuranceNumber
        : (serverMeta?.insuranceNumber || '—'),
      insuranceCode: (metadata?.insuranceCode && metadata.insuranceCode !== '—')
        ? metadata.insuranceCode
        : (serverMeta?.insuranceCode || '—'),
      address: (metadata?.address && !metadata.address.includes('ANON') && metadata.address !== '—' && metadata.address !== '[Neznámý bydliště]')
        ? metadata.address
        : (serverMeta?.address || '—'),
      phone: (metadata?.phone && !metadata.phone.includes('ANON') && metadata.phone !== '—' && metadata.phone !== '[Neznámý telefon]')
        ? metadata.phone
        : (serverMeta?.phone || '—'),
      dateOfBirth: metadata?.dateOfBirth || serverMeta?.dateOfBirth || '—',
      generatedAt: metadata?.generatedAt || serverMeta?.generatedAt || new Date().toISOString(),
      totalEvents: metadata?.totalEvents || serverMeta?.totalEvents || 0,
      ambEventsCount: metadata?.ambEventsCount || serverMeta?.ambEventsCount || 0,
      hospEventsCount: metadata?.hospEventsCount || serverMeta?.hospEventsCount || 0,
      labEventsCount: metadata?.labEventsCount || serverMeta?.labEventsCount || 0,
      dateRange: metadata?.dateRange || serverMeta?.dateRange || { firstDate: '—', lastDate: '—' }
    };

    const { buffer, filename } = await generateTumorBoardDocx(targetJson, combinedMeta, maxDate);

    const encodedFilename = encodeURIComponent(filename);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`);
    res.send(buffer);
  } catch (err: any) {
    console.error('[Express Server DOCX Export Error]:', err);
    res.status(500).json({ isSuccess: false, error: err.message || 'Chyba při generování DOCX.' });
  }
});

// Endpoint pro privátní chat s Gemini nad případem
app.post('/api/chat', async (req, res) => {
  try {
    const { message, history, userApiKey } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ isSuccess: false, error: 'Zpráva je povinná.' });
    }
    const result = await handleGeminiChatCall(message, history || [], userApiKey);
    res.json(result);
  } catch (err: any) {
    console.error('[Express Server Chat Error]:', err.message || err);
    res.status(500).json({
      isSuccess: false,
      error: err.message || 'Chyba při komunikaci s Gemini Chat API'
    });
  }
});

// Endpoint pro nahrávání souborů, parsování a chronologické řazení
app.post('/api/upload', async (req, res) => {
  try {
    const { files } = req.body;
    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ isSuccess: false, error: 'Žádné soubory k nahrání.' });
    }

    const outputDir = path.resolve(process.cwd(), 'output');
    // Zpracování VÝHRADNĚ souborů vybraných v dialogu (složka vstup se nepoužívá ani neprohledává)
    const dataset = parseUploadedFiles(files, outputDir);
    currentServerDataset = dataset;
    const htmlPath = path.join(outputDir, 'chronology.html');
    generateChronologyHtml(dataset, htmlPath);

    const generatedHtml = fs.readFileSync(htmlPath, 'utf8');

    console.log(`[Express Upload] Úspěšně zpracováno výhradně ${files.length} vybraných souborů, celkem ${dataset.metadata.totalEvents} vyšetření.`);

    res.json({
      isSuccess: true,
      totalEvents: dataset.metadata.totalEvents,
      html: generatedHtml
    });
  } catch (err: any) {
    console.error('[Express Upload Error]:', err.message || err);
    res.status(500).json({ isSuccess: false, error: err.message || 'Chyba při nahrávání souborů' });
  }
});

// Endpoint pro opětovné načtení chronologie
app.post('/api/clear', async (req, res) => {
  try {
    serveEmptyChronologyPage(res);
  } catch (err: any) {
    res.status(500).json({ isSuccess: false, error: err.message });
  }
});


app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`  IBIS TUMOR BOARD SERVER BĚŽÍ NA PORTU ${PORT}`);
  console.log(`  Otevřete: http://localhost:${PORT}/chronology.html`);
  console.log(`====================================================`);
});
