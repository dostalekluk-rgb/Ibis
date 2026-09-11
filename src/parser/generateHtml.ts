import * as fs from 'fs';
import * as path from 'path';
import { PatientChronologyDataset, ParsedExamination } from '../types/chronology.js';

function escapeHtml(str: string | null | undefined): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDateDisplay(isoDateStr: string, rawDate: string): string {
  if (!isoDateStr || isoDateStr === '1970-01-01') return rawDate || 'N/A';
  const parts = isoDateStr.split('T');
  const datePart = parts[0];
  const timePart = parts[1] ? parts[1].substring(0, 5) : null;

  const d = datePart.split('-');
  if (d.length === 3) {
    const formattedDate = `${d[2]}.${d[1]}.${d[0]}`;
    return timePart ? `${formattedDate} ${timePart} h` : formattedDate;
  }
  return isoDateStr;
}

/**
 * Pre-render single Timeline Examination Box (Default view: Text Vyšetření)
 */
function renderTimelineBox(exam: ParsedExamination, index: number): string {
  const badgeClass = exam.sourceType === 'amb' ? 'badge-amb' : (exam.sourceType === 'hosp' ? 'badge-hosp' : 'badge-lab');
  const formattedDate = formatDateDisplay(exam.date, exam.rawDate);
  const jsonFormatted = JSON.stringify(exam, null, 2);
  const examNumber = index + 1;

  const searchText = `vyšetření ${examNumber} ${exam.id} ${exam.date} ${exam.rawDate} ${exam.type} ${exam.sourceFile} ${exam.doctor || ''} ${exam.content}`.toLowerCase();

  return `
    <div class="timeline-box" id="box-${exam.id}" data-type="${exam.sourceType}" data-search="${escapeHtml(searchText)}">
      <div class="box-header">
        <div class="box-title-group">
          <span class="box-number">Vyšetření ${examNumber}</span>
          <span class="exam-id-tag">${exam.id}</span>
          <span class="${badgeClass}">${escapeHtml(exam.type)}</span>
        </div>
        <div class="box-meta-group">
          <span class="box-date">📅 ${escapeHtml(formattedDate)}</span>
          <span class="box-doctor">${exam.doctor ? '👨‍⚕️ ' + escapeHtml(exam.doctor) : '📁 ' + escapeHtml(exam.sourceFile)}</span>
        </div>
      </div>

      <div class="box-body">
        <div class="view-tabs">
          <button class="tab-btn active" id="btn-text-${exam.id}" onclick="switchTab('${exam.id}', 'text')">📄 Text Vyšetření</button>
          <button class="tab-btn" id="btn-json-${exam.id}" onclick="switchTab('${exam.id}', 'json')">💻 JSON Záznam</button>
        </div>

        <div class="text-content-view" id="text-${exam.id}">${escapeHtml(exam.content)}</div>
        <pre class="json-code-view" id="json-${exam.id}" style="display: none;"><code>${escapeHtml(jsonFormatted)}</code></pre>
      </div>
    </div>
  `;
}

export function generateChronologyHtml(dataset: PatientChronologyDataset, outputPath: string): void {
  const meta = dataset.metadata;

  // Render all examination boxes chronologically or display empty state if none loaded
  const timelineBoxesHtml = dataset.examinations.length === 0 ? `
    <div class="empty-state" style="background: #ffffff; border: 1.5px dashed var(--nejm-border); border-radius: 6px; padding: 48px 24px; margin-top: 16px; text-align: center;">
      <div style="font-size: 48px; margin-bottom: 14px;">📁</div>
      <h3 style="font-family: 'Merriweather', serif; font-size: 15px; color: var(--nejm-navy); margin-bottom: 8px;">Není načtena žádná zdravotní dokumentace</h3>
      <p style="color: var(--text-muted); font-size: 11px; max-width: 440px; line-height: 1.6; margin: 0 auto 16px auto;">
        Na začátku nebyly načteny žádné soubory. Klikněte nahoře na tlačítko <strong>"📁 Přidat Soubor"</strong> pro nahrání zpráv nebo vyšetření pacientky.
      </p>
      <label class="btn-upload" style="margin: 0 auto; padding: 9px 20px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;">
        📁 Přidat Soubor Nyní
        <input type="file" multiple accept=".txt,.json,.doc,.docx" style="display:none" onchange="handleFileUpload(event)">
      </label>
    </div>
  ` : dataset.examinations.map((exam, idx) => renderTimelineBox(exam, idx)).join('\n');

  // Check unparsed fragments (or files in the right panel)
  const unparsedFragments = dataset.unparsedFragments && dataset.unparsedFragments.length > 0 
    ? dataset.unparsedFragments 
    : (dataset.unparsedFiles || []).map((f, idx) => ({
        id: `UNPARSED-${idx + 1}`,
        fileName: f.fileName,
        location: 'Celý neparsovaný soubor',
        reason: 'Neparsovaný soubor z adresáře',
        content: f.content,
        sizeBytes: f.sizeBytes
      }));

  let unparsedContentHtml = '';

  if (unparsedFragments.length === 0) {
    unparsedContentHtml = `
      <div class="empty-state">
        <h3 style="font-family: 'Merriweather', serif; font-size: 13px; color: var(--nejm-navy); margin-bottom: 6px;">📄 Neparsované Části Textu</h3>
        <p style="color: var(--text-muted); font-size: 11px; line-height: 1.5;">
          Všechny části textu ze zpracovávaných souborů byly úspěšně parsovány a zařazeny do vyšetření. Žádný neparsovaný textový úsek nebyl nalezen.
        </p>
      </div>
    `;
  } else {
    const unparsedTabs = unparsedFragments.map((f, idx) => `
      <button class="file-tab-btn ${idx === 0 ? 'active' : ''}" onclick="selectUnparsedFragment(${idx})">
        📄 ${escapeHtml(f.fileName)} <span style="font-size: 9px; opacity: 0.8; margin-left: 4px;">(${escapeHtml(f.location)})</span>
      </button>
    `).join('');

    unparsedContentHtml = `
      <div class="file-tabs">${unparsedTabs}</div>
      <div class="unparsed-toolbar">
        <div id="fileInfo"><strong>${escapeHtml(unparsedFragments[0].fileName)}</strong> | <span style="color: #64748b;">${escapeHtml(unparsedFragments[0].location)}</span> | ${(unparsedFragments[0].sizeBytes / 1024).toFixed(1)} KB</div>
        <input type="text" id="rightSearch" class="search-input" style="max-width: 200px;" placeholder="Hledat v neparsovaném textu..." oninput="filterUnparsedText()">
      </div>
      <div class="unparsed-viewer" id="unparsedViewer">${escapeHtml(unparsedFragments[0].content)}</div>
    `;
  }

  const htmlContent = `<!DOCTYPE html>
<html lang="cs">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ibis A — Vyšetření Pacientky | NEJM Style Timeline & Tumor Board AI</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Merriweather:ital,wght@0,300;0,400;0,700;1,300;1,400&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --nejm-navy: #0e2a47;
      --nejm-crimson: #8b0000;
      --nejm-gold: #c59b27;
      --nejm-bg: #f8fafc;
      --nejm-card-bg: #ffffff;
      --nejm-border: #cbd5e1;
      --text-main: #1e293b;
      --text-muted: #64748b;
      --text-dark: #0f172a;
      --badge-amb-bg: #e0f2fe;
      --badge-amb-text: #0369a1;
      --badge-hosp-bg: #f3e8ff;
      --badge-hosp-text: #6b21a8;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: 'Inter', sans-serif;
      background-color: var(--nejm-bg);
      color: var(--text-main);
      line-height: 1.4;
      padding: 0;
      margin: 0;
      font-size: 11px;
      min-height: 100vh;
    }

    .nejm-top-bar {
      height: 4px;
      background: linear-gradient(90deg, var(--nejm-crimson) 0%, var(--nejm-navy) 50%, var(--nejm-gold) 100%);
    }

    header {
      background: #ffffff;
      border-bottom: 2px solid var(--nejm-navy);
      padding: 14px 24px 10px 24px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
      position: relative;
      z-index: 20;
    }

    .masthead {
      text-align: center;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--nejm-border);
    }

    .masthead-title {
      font-family: 'Merriweather', Georgia, serif;
      font-size: 18px;
      font-weight: 700;
      letter-spacing: 1px;
      color: var(--nejm-navy);
      text-transform: uppercase;
    }

    .masthead-sub {
      font-family: 'Inter', sans-serif;
      font-size: 10px;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      color: var(--nejm-crimson);
      font-weight: 600;
      margin-top: 2px;
    }

    .patient-banner {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 10px;
      background: #f8fafc;
      border: 1px solid var(--nejm-border);
      border-left: 4px solid var(--nejm-navy);
      padding: 8px 16px;
      border-radius: 4px;
      font-family: 'Inter', sans-serif;
    }

    .patient-meta-item {
      display: flex;
      flex-direction: column;
    }

    .patient-meta-label {
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
      font-weight: 600;
    }

    .patient-meta-val {
      font-size: 12px;
      font-weight: 700;
      color: var(--nejm-navy);
    }

    .btn-anonymize {
      background: var(--nejm-crimson);
      color: #ffffff;
      font-family: 'Inter', sans-serif;
      font-size: 11px;
      font-weight: 700;
      padding: 7px 16px;
      border: 1px solid var(--nejm-crimson);
      border-radius: 4px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      position: relative;
      z-index: 30;
      pointer-events: auto;
      transition: all 0.2s ease-in-out;
    }

    .btn-anonymize:hover {
      background: #700000;
    }

    .btn-upload {
      background: var(--nejm-navy);
      color: #ffffff;
      font-family: 'Inter', sans-serif;
      font-size: 11px;
      font-weight: 700;
      padding: 7px 16px;
      border: 1px solid var(--nejm-navy);
      border-radius: 4px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      position: relative;
      z-index: 30;
      pointer-events: auto;
      transition: all 0.2s ease-in-out;
    }

    .btn-upload:hover {
      background: #1b3d63;
      box-shadow: 0 0 8px rgba(14, 42, 71, 0.3);
    }

    .btn-send-gemini {
      background: #15803d;
      color: #ffffff;
      font-family: 'Inter', sans-serif;
      font-size: 11px;
      font-weight: 700;
      padding: 7px 16px;
      border: 1px solid #15803d;
      border-radius: 4px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      position: relative;
      z-index: 30;
      pointer-events: auto;
      box-shadow: 0 0 12px rgba(21, 128, 61, 0.4);
      transition: all 0.2s ease-in-out;
    }

    .btn-send-gemini:hover {
      background: #166534;
      box-shadow: 0 0 16px rgba(22, 101, 52, 0.6);
    }

    .anonymize-result-alert {
      background: #fef2f2;
      border: 1.5px solid var(--nejm-crimson);
      color: #991b1b;
      padding: 10px 16px;
      border-radius: 4px;
      font-family: 'Inter', sans-serif;
      font-size: 12px;
      font-weight: 600;
      margin-top: 10px;
      display: none;
      align-items: center;
      justify-content: space-between;
    }

    /* Dual Column Layout */
    .layout-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      max-width: 1800px;
      margin: 16px auto;
      padding: 0 16px;
    }

    .column-panel {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .panel-header {
      background: var(--nejm-navy);
      color: #ffffff;
      padding: 10px 14px;
      border-radius: 4px 4px 0 0;
      font-family: 'Inter', sans-serif;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.5px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-shadow: 0 2px 4px rgba(0,0,0,0.08);
    }

    .panel-header-badge {
      background: rgba(255, 255, 255, 0.15);
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 10px;
      font-weight: 600;
    }

    /* Controls Box */
    .controls-box {
      background: #ffffff;
      border: 1px solid var(--nejm-border);
      border-radius: 4px;
      padding: 10px;
      display: flex;
      gap: 10px;
      align-items: center;
      font-family: 'Inter', sans-serif;
      position: relative;
      z-index: 10;
    }

    .search-input {
      flex: 1;
      padding: 6px 10px;
      border: 1px solid var(--nejm-border);
      border-radius: 4px;
      font-size: 11px;
      outline: none;
    }

    .search-input:focus {
      border-color: var(--nejm-navy);
    }

    select, .btn-action {
      font-family: 'Inter', sans-serif;
      font-size: 11px;
      padding: 6px 10px;
      border: 1px solid var(--nejm-border);
      background: #ffffff;
      border-radius: 4px;
      cursor: pointer;
      color: var(--text-dark);
      position: relative;
      z-index: 15;
      pointer-events: auto;
    }

    .btn-action:hover {
      background: #f1f5f9;
      border-color: var(--nejm-navy);
    }

    /* Vertical Timeline Container (ibis a.png diagram) */
    .timeline-wrapper {
      max-height: calc(100vh - 200px);
      overflow-y: auto;
      padding-right: 8px;
    }

    .timeline-container {
      position: relative;
      padding: 8px 0 8px 18px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .timeline-container::before {
      content: '';
      position: absolute;
      left: 28px;
      top: 0;
      bottom: 0;
      width: 2px;
      background: var(--nejm-navy);
      z-index: 1;
      pointer-events: none;
    }

    .timeline-box {
      position: relative;
      z-index: 2;
      background: #ffffff;
      border: 1.5px solid var(--nejm-navy);
      border-radius: 6px;
      box-shadow: 0 2px 6px rgba(14, 42, 71, 0.06);
      margin-left: 32px;
      transition: all 0.2s;
    }

    .timeline-box:hover {
      border-color: var(--nejm-crimson);
      box-shadow: 0 4px 10px rgba(139, 0, 0, 0.1);
    }

    .timeline-box::before {
      content: '';
      position: absolute;
      left: -40px;
      top: 14px;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: var(--nejm-crimson);
      border: 2px solid #ffffff;
      box-shadow: 0 0 0 2px var(--nejm-navy);
      z-index: 3;
      pointer-events: none;
    }

    .timeline-box::after {
      content: '';
      position: absolute;
      left: -28px;
      top: 19px;
      width: 28px;
      height: 2px;
      background: var(--nejm-navy);
      z-index: 2;
      pointer-events: none;
    }

    .box-header {
      background: #f8fafc;
      border-bottom: 1px solid var(--nejm-border);
      padding: 8px 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-family: 'Inter', sans-serif;
    }

    .box-title-group {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .box-number {
      font-family: 'Merriweather', Georgia, serif;
      font-weight: 700;
      font-size: 13px;
      color: var(--nejm-navy);
    }

    .exam-id-tag {
      font-family: 'JetBrains Mono', monospace;
      font-weight: 700;
      font-size: 10px;
      color: var(--nejm-crimson);
      background: rgba(139, 0, 0, 0.08);
      padding: 1px 6px;
      border-radius: 3px;
    }

    .box-meta-group {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 11px;
    }

    .box-date {
      font-weight: 600;
      color: var(--nejm-navy);
    }

    .box-doctor {
      color: var(--text-muted);
      font-style: italic;
    }

    .badge-amb {
      background: var(--badge-amb-bg);
      color: var(--badge-amb-text);
      font-family: 'Inter', sans-serif;
      font-size: 9px;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 3px;
      text-transform: uppercase;
    }

    .badge-hosp {
      background: var(--badge-hosp-bg);
      color: var(--badge-hosp-text);
      font-family: 'Inter', sans-serif;
      font-size: 9px;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 3px;
      text-transform: uppercase;
    }

    .badge-lab {
      background: #e0f2fe;
      color: #0284c7;
      font-family: 'Inter', sans-serif;
      font-size: 9px;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 3px;
      text-transform: uppercase;
    }

    .box-body {
      padding: 10px;
    }

    .view-tabs {
      display: flex;
      gap: 6px;
      margin-bottom: 8px;
      font-family: 'Inter', sans-serif;
      position: relative;
      z-index: 10;
    }

    .tab-btn {
      padding: 5px 12px;
      font-size: 10px;
      font-weight: 600;
      border: 1.5px solid var(--nejm-border);
      background: #ffffff;
      border-radius: 4px;
      cursor: pointer;
      color: var(--text-muted);
      position: relative;
      z-index: 15;
      pointer-events: auto;
      user-select: none;
      transition: all 0.15s ease-in-out;
    }

    .tab-btn:hover {
      border-color: var(--nejm-navy);
      color: var(--nejm-navy);
    }

    .tab-btn.active {
      background: var(--nejm-navy);
      color: #ffffff;
      border-color: var(--nejm-navy);
    }

    /* MANDATORY USER DIRECTIVE: Black text on white background at 7pt font inside boxes */
    .json-code-view {
      font-family: 'JetBrains Mono', monospace;
      font-size: 7pt;
      line-height: 1.4;
      background: #ffffff;
      color: #000000;
      padding: 10px;
      border-radius: 4px;
      max-height: 300px;
      overflow: auto;
      white-space: pre-wrap;
      border: 1px solid #cbd5e1;
    }

    .json-code-view code {
      font-family: 'JetBrains Mono', monospace;
      font-size: 7pt;
      color: #000000;
    }

    .text-content-view {
      font-family: 'Merriweather', Georgia, serif;
      font-size: 7pt;
      line-height: 1.4;
      color: #000000;
      white-space: pre-wrap;
      max-height: 280px;
      overflow-y: auto;
      background: #ffffff;
      padding: 10px;
      border: 1px solid #cbd5e1;
      border-radius: 4px;
    }

    /* Right Column (Unparsed Files & Tumor Board View) */
    .unparsed-container {
      background: #ffffff;
      border: 1px solid var(--nejm-border);
      border-radius: 4px;
      box-shadow: 0 2px 6px rgba(0,0,0,0.04);
      display: flex;
      flex-direction: column;
      height: calc(100vh - 200px);
    }

    .file-tabs {
      display: flex;
      background: #f8fafc;
      border-bottom: 1px solid var(--nejm-border);
      padding: 6px 10px 0 10px;
      gap: 4px;
      font-family: 'Inter', sans-serif;
    }

    .file-tab-btn {
      padding: 6px 10px;
      font-size: 10px;
      font-weight: 600;
      border: 1px solid var(--nejm-border);
      border-bottom: none;
      background: #e2e8f0;
      border-radius: 4px 4px 0 0;
      cursor: pointer;
      color: var(--text-muted);
      position: relative;
      z-index: 10;
      pointer-events: auto;
    }

    .file-tab-btn.active {
      background: #ffffff;
      color: var(--nejm-crimson);
      border-color: var(--nejm-border);
      font-weight: 700;
    }

    .unparsed-toolbar {
      padding: 8px 12px;
      background: #ffffff;
      border-bottom: 1px solid var(--nejm-border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-family: 'Inter', sans-serif;
      font-size: 11px;
    }

    .unparsed-viewer {
      flex: 1;
      padding: 10px;
      background: #ffffff;
      color: #000000;
      font-family: 'JetBrains Mono', monospace;
      font-size: 7pt;
      line-height: 1.4;
      white-space: pre-wrap;
      overflow-y: auto;
      border: 1px solid #cbd5e1;
    }

    /* Tumor Board HTML View Elements */
    .tb-container-right {
      display: flex;
      flex-direction: column;
      height: calc(100vh - 200px);
      gap: 12px;
      overflow-y: auto;
    }

    .tb-report-card {
      background: #ffffff;
      border: 1.5px solid var(--nejm-navy);
      border-radius: 6px;
      box-shadow: 0 2px 8px rgba(14, 42, 71, 0.08);
      display: flex;
      flex-direction: column;
    }

    .tb-card-header {
      background: var(--nejm-navy);
      color: #ffffff;
      padding: 10px 14px;
      font-family: 'Merriweather', serif;
      font-size: 12px;
      font-weight: 700;
      display: flex;
      justify-content: space-between;
      align-items: center;
      letter-spacing: 0.5px;
    }

    .tb-card-header.proposal {
      background: var(--nejm-crimson);
    }

    /* KONZILIA.DOCX PROTOCOL STYLING */
    .konzilia-document {
      font-family: 'Arial', 'Inter', sans-serif;
      font-size: 11px;
      line-height: 1.45;
      color: #0f172a;
      background: #ffffff;
      padding: 16px;
      border-radius: 4px;
    }

    .konzilia-patient-meta {
      margin-bottom: 12px;
      font-family: 'Arial', sans-serif;
      font-size: 11px;
      line-height: 1.35;
      color: #1e293b;
    }

    .konzilia-meta-line {
      margin-bottom: 2px;
    }

    .konzilia-metrics {
      font-weight: 700;
      font-size: 11.5px;
      margin-bottom: 14px;
      color: #0e2a47;
      border-bottom: 1.5px solid #cbd5e1;
      padding-bottom: 8px;
    }

    .konzilia-section {
      margin-bottom: 12px;
      padding-bottom: 10px;
      border-bottom: 1px dashed #e2e8f0;
    }

    .konzilia-section:last-child {
      border-bottom: none;
    }

    .konzilia-section-heading {
      font-weight: 700;
      font-size: 11.5px;
      color: #0e2a47;
      margin-bottom: 6px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    .konzilia-no-text, .konzilia-dg-line, .konzilia-history-item, .konzilia-exam-item {
      margin-bottom: 5px;
      color: #1e293b;
    }

    .konzilia-conclusion-box {
      background: #f8fafc;
      border: 1.5px solid #0e2a47;
      border-left: 4px solid #8b0000;
      border-radius: 4px;
      padding: 12px 14px;
      margin-top: 14px;
    }

    .konzilia-board-header {
      font-family: 'Merriweather', Georgia, serif;
      font-weight: 700;
      font-size: 12px;
      color: #8b0000;
      margin-bottom: 6px;
      text-transform: uppercase;
    }

    .konzilia-recommendation {
      margin-top: 8px;
      padding-top: 6px;
      border-top: 1px solid #cbd5e1;
      font-weight: 600;
      color: #0f172a;
    }

    .konzilia-recurrence-plain {
      margin-bottom: 6px;
      color: #1e293b;
      font-family: 'Arial', sans-serif;
      font-size: 11px;
      line-height: 1.45;
    }


    .konzilia-recurrence-header {
      font-weight: 700;
      color: #991b1b;
      margin-bottom: 4px;
    }

      margin-top: 6px;
      margin-bottom: 6px;
    }

    .recurrence-card h4 {
      font-family: 'Merriweather', serif;
      font-size: 11px;
      font-weight: 700;
      color: var(--nejm-crimson);
      margin-bottom: 4px;
    }

    .tb-exam-list {
      margin-left: 18px;
      color: #1e293b;
    }

    .tb-exam-list li {
      margin-bottom: 4px;
    }

    .tb-block {
      margin-bottom: 12px;
      border-bottom: 1px solid var(--nejm-border);
      padding-bottom: 10px;
    }

    /* AI CHAT ROOM (TERMINAL GREEN ON BLACK WITH BLINKING GEMINI STAR) */
    .chat-container {
      background: #050811;
      border: 1.5px solid #00ff66;
      border-radius: 6px;
      display: flex;
      flex-direction: column;
      height: calc(100vh - 200px);
      box-shadow: 0 0 20px rgba(0, 255, 102, 0.15);
      font-family: 'JetBrains Mono', 'Consolas', monospace;
      color: #00ff66;
      overflow: hidden;
    }

    .chat-header {
      background: #0d1527;
      border-bottom: 1.5px solid #00ff66;
      padding: 10px 14px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.5px;
      flex-shrink: 0;
    }

    .chat-header-title {
      display: flex;
      align-items: center;
      gap: 8px;
      color: #00ff66;
      text-shadow: 0 0 8px rgba(0, 255, 102, 0.4);
    }

    .chat-star-icon {
      font-size: 14px;
      animation: geminiPulse 1.5s infinite ease-in-out;
      display: inline-block;
    }

    @keyframes geminiPulse {
      0%, 100% { transform: scale(1); opacity: 1; text-shadow: 0 0 10px #00ff66; }
      50% { transform: scale(1.25); opacity: 0.5; text-shadow: 0 0 2px #00ff66; }
    }

    .btn-clear-chat {
      background: #330000;
      color: #ff4d4d;
      border: 1px solid #ff4d4d;
      padding: 4px 10px;
      font-size: 10px;
      font-weight: 700;
      border-radius: 4px;
      cursor: pointer;
      font-family: 'JetBrains Mono', monospace;
      transition: all 0.2s ease-in-out;
    }

    .btn-clear-chat:hover {
      background: #660000;
      color: #ffffff;
      box-shadow: 0 0 8px rgba(255, 77, 77, 0.5);
    }

    .chat-messages {
      flex: 1 1 auto;
      min-height: 0;
      padding: 14px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 12px;
      background: #050811;
    }

    .chat-msg {
      padding: 10px 12px;
      border-radius: 4px;
      font-size: 11px;
      line-height: 1.5;
      max-width: 95%;
      white-space: pre-wrap;
      word-break: break-word;
      overflow-wrap: anywhere;
    }

    .chat-msg.user {
      align-self: flex-end;
      background: #0a2918;
      border: 1px solid #00ff66;
      color: #66ffaa;
      border-radius: 8px 8px 0 8px;
    }

    .chat-msg.model {
      align-self: flex-start;
      background: #0b1326;
      border: 1px solid #00e5ff;
      color: #00ff66;
      border-radius: 8px 8px 8px 0;
      box-shadow: 0 0 8px rgba(0, 255, 102, 0.1);
    }

    .chat-msg-author {
      font-size: 9px;
      text-transform: uppercase;
      font-weight: 700;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .chat-msg.user .chat-msg-author { color: #66ffaa; }
    .chat-msg.model .chat-msg-author { color: #00e5ff; }

    .chat-pills {
      padding: 8px 12px;
      background: #090e1a;
      border-top: 1px solid #1e293b;
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      flex-shrink: 0;
    }

    .chat-pill-btn {
      background: #05140b;
      color: #00ff66;
      border: 1px solid #00ff66;
      padding: 4px 8px;
      font-size: 9px;
      font-family: 'JetBrains Mono', monospace;
      border-radius: 3px;
      cursor: pointer;
      transition: all 0.15s;
    }

    .chat-pill-btn:hover {
      background: #00ff66;
      color: #000000;
      font-weight: 700;
    }

    .chat-input-bar {
      padding: 10px 12px;
      background: #090e1a;
      border-top: 1.5px solid #00ff66;
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }

    .chat-prompt-symbol {
      color: #00ff66;
      font-weight: 700;
      font-size: 14px;
      animation: geminiPulse 1s infinite;
    }

    .chat-input {
      flex: 1;
      background: #050811;
      border: 1px solid #00ff66;
      color: #00ff66;
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      padding: 8px 12px;
      border-radius: 4px;
      outline: none;
    }

    .chat-input:focus {
      box-shadow: 0 0 10px rgba(0, 255, 102, 0.4);
    }

    .chat-send-btn {
      background: #00ff66;
      color: #000000;
      border: none;
      padding: 8px 16px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      font-weight: 700;
      border-radius: 4px;
      cursor: pointer;
      transition: all 0.2s;
    }

    .chat-send-btn:hover {
      background: #39ff14;
      box-shadow: 0 0 12px #00ff66;
    }


    .tb-block:last-child {
      border-bottom: none;
      margin-bottom: 0;
      padding-bottom: 0;
    }

    .tb-block h3 {
      font-family: 'Merriweather', serif;
      font-size: 11px;
      font-weight: 700;
      color: var(--nejm-navy);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }

    .tb-proposal-content ul {
      margin-left: 18px;
    }

    .tb-proposal-content li {
      margin-bottom: 8px;
      color: #0f172a;
    }

    .empty-state {
      padding: 36px 20px;
      text-align: center;
      font-family: 'Inter', sans-serif;
    }

    @media (max-width: 1200px) {
      .layout-grid {
        grid-template-columns: 1fr;
      }
      .unparsed-container, .tb-container-right {
        height: 500px;
      }
    }
  </style>
</head>
<body>
  <div class="nejm-top-bar"></div>
  
  <header>
    <div class="masthead">
      <div class="masthead-title">IBIS</div>
      <div class="masthead-sub">Onkogynekologie - konzilia</div>
    </div>

    <div class="patient-banner">
      <div class="patient-meta-item">
        <span class="patient-meta-label">Pacientka</span>
        <span class="patient-meta-val" id="valPatientName">${escapeHtml(meta.patientName)}</span>
      </div>
      <div class="patient-meta-item">
        <span class="patient-meta-label">Číslo pojištěnce (RČ)</span>
        <span class="patient-meta-val" id="valInsuranceNumber">${escapeHtml(meta.insuranceNumber)}</span>
      </div>
      <div class="patient-meta-item">
        <span class="patient-meta-label">Kód pojišťovny</span>
        <span class="patient-meta-val" id="valInsuranceCode">${escapeHtml(meta.insuranceCode)}</span>
      </div>
      <div class="patient-meta-item">
        <span class="patient-meta-label">Datum narození</span>
        <span class="patient-meta-val" id="valDateOfBirth">${escapeHtml(meta.dateOfBirth)}</span>
      </div>
      <div class="patient-meta-item">
        <span class="patient-meta-label">Bydliště</span>
        <span class="patient-meta-val" id="valAddress" style="max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(meta.address)}">${escapeHtml(meta.address)}</span>
      </div>
      <div class="patient-meta-item">
        <span class="patient-meta-label">Telefon</span>
        <span class="patient-meta-val" id="valPhone">${escapeHtml(meta.phone)}</span>
      </div>
      <div class="patient-meta-item">
        <span class="patient-meta-label">Celkem Záznamů</span>
        <span class="patient-meta-val" style="color: var(--nejm-crimson);">${meta.totalEvents} JSON vyšetření</span>
      </div>
      <div class="patient-meta-item" style="display: flex; gap: 8px; flex-direction: row; align-items: center;">
        <label class="btn-upload" style="cursor: pointer; display: inline-flex; align-items: center; gap: 6px;">
          📁 Přidat Soubor
          <input type="file" multiple accept=".txt,.json,.doc,.docx" style="display:none" onchange="handleFileUpload(event)">
        </label>
        <button id="anonymizeBtn" class="btn-anonymize" onclick="handleActionClick()">
          🔒 Anonymizovat Data
        </button>
      </div>
    </div>

    <div class="anonymize-result-alert" id="anonymizeResultAlert">
      <span id="anonymizeResultText"></span>
      <span style="cursor: pointer; padding-left: 12px; font-weight: 700;" onclick="document.getElementById('anonymizeResultAlert').style.display='none'">&times;</span>
    </div>
  </header>

  <div class="layout-grid">
    <!-- Left Column: Connected Box Timeline (ibis a.png diagram style) -->
    <div class="column-panel" id="leftPanelColumn">
      <div class="panel-header">
        <span>📋 Vyextrahovaná Vyšetření (JSON Chronologie)</span>
        <span class="panel-header-badge" id="examCountBadge">${meta.totalEvents} vyšetření</span>
      </div>

      <div class="controls-box">
        <input type="text" id="leftSearch" class="search-input" placeholder="Vyhledat v vyšetřeních (text, lékař, datum)..." oninput="filterExaminations()">
        <select id="typeSelect" onchange="filterExaminations()">
          <option value="all">Všechny typy</option>
          <option value="amb">Ambulantní (*amb*)</option>
          <option value="hosp">Hospitalizační (*hosp*)</option>
          <option value="lab">Laboratorní (*lab*)</option>
        </select>
        <button id="sortBtn" class="btn-action" onclick="toggleSort()">⬇️ Nejstarší</button>
      </div>

      <div class="timeline-wrapper">
        <div class="timeline-container" id="cardsList">
${timelineBoxesHtml}
        </div>
      </div>
    </div>

    <!-- Right Column: Unparsed Text Fragments & Tumor Board Result -->
    <div class="column-panel" id="rightPanelColumn">
      <div class="panel-header" style="background: #334155;">
        <span>📄 Neparsované Části Textu & Zbytek</span>
        <span class="panel-header-badge" id="unparsedCountBadge">${unparsedFragments.length} úseků</span>
      </div>

      <div class="unparsed-container">
${unparsedContentHtml}
      </div>
    </div>
  </div>

  <script>
    let sortAscending = true;
    let isAnonymized = false;
    const currentMeta = ${JSON.stringify(meta).replace(/</g, '\\u003c')};
    const unparsedFragmentsData = ${JSON.stringify(unparsedFragments.map(f => ({
      id: f.id,
      fileName: f.fileName,
      location: f.location,
      reason: f.reason,
      sizeBytes: f.sizeBytes,
      content: f.content
    }))).replace(/</g, '\\u003c')};
    const unparsedFilesData = unparsedFragmentsData;

    // Rock-solid tab switcher
    function switchTab(id, mode) {
      const jsonEl = document.getElementById('json-' + id);
      const textEl = document.getElementById('text-' + id);
      const btnJson = document.getElementById('btn-json-' + id);
      const btnText = document.getElementById('btn-text-' + id);

      if (!jsonEl || !textEl) return;

      if (mode === 'json') {
        jsonEl.style.display = 'block';
        textEl.style.display = 'none';
        if (btnJson) btnJson.classList.add('active');
        if (btnText) btnText.classList.remove('active');
      } else {
        jsonEl.style.display = 'none';
        textEl.style.display = 'block';
        if (btnText) btnText.classList.add('active');
        if (btnJson) btnJson.classList.remove('active');
      }
    }

    function filterExaminations() {
      const searchEl = document.getElementById('leftSearch');
      const typeEl = document.getElementById('typeSelect');
      if (!searchEl || !typeEl) return;

      const query = searchEl.value.trim().toLowerCase();
      const type = typeEl.value;
      const boxes = document.querySelectorAll('.timeline-box');
      let visibleCount = 0;

      boxes.forEach(box => {
        const boxType = box.getAttribute('data-type');
        const boxSearch = box.getAttribute('data-search') || '';

        const matchesType = (type === 'all') || (boxType === type);
        const matchesQuery = !query || boxSearch.includes(query);

        if (matchesType && matchesQuery) {
          box.style.display = 'block';
          visibleCount++;
        } else {
          box.style.display = 'none';
        }
      });

      const badge = document.getElementById('examCountBadge');
      if (badge) badge.innerText = visibleCount + ' vyšetření';
    }

    function toggleSort() {
      sortAscending = !sortAscending;
      const sortBtn = document.getElementById('sortBtn');
      if (sortBtn) sortBtn.innerText = sortAscending ? '⬇️ Nejstarší' : '⬆️ Nejnovější';

      const container = document.getElementById('cardsList');
      if (!container) return;
      const boxes = Array.from(container.querySelectorAll('.timeline-box'));
      boxes.reverse();
      boxes.forEach(box => container.appendChild(box));
    }

    function selectUnparsedFragment(idx) {
      const frag = unparsedFragmentsData[idx];
      if (!frag) return;
      const viewer = document.getElementById('unparsedViewer');
      const info = document.getElementById('fileInfo');
      if (viewer) viewer.innerText = frag.content;
      if (info) info.innerHTML = '<strong>' + escapeHtml(frag.fileName) + '</strong> | <span style="color: #64748b;">' + escapeHtml(frag.location) + '</span> | ' + (frag.sizeBytes / 1024).toFixed(1) + ' KB';

      document.querySelectorAll('.file-tab-btn').forEach((btn, i) => {
        if (i === idx) btn.classList.add('active');
        else btn.classList.remove('active');
      });
    }

    function selectUnparsedFile(idx) {
      selectUnparsedFragment(idx);
    }

    function filterUnparsedText() {
      const input = document.getElementById('rightSearch');
      if (!input) return;
      const query = input.value.toLowerCase().trim();
      const tabs = document.querySelectorAll('.file-tab-btn');

      unparsedFragmentsData.forEach((frag, idx) => {
        const btn = tabs[idx];
        if (!btn) return;
        const searchStr = (frag.fileName + ' ' + frag.location + ' ' + frag.content).toLowerCase();
        if (!query || searchStr.includes(query)) {
          btn.style.display = 'inline-block';
        } else {
          btn.style.display = 'none';
        }
      });
    }

    function escapeRegExpStr(str) {
      if (!str) return '';
      const spec = ['.', '*', '+', '?', '^', '$', '(', ')', '[', ']', '{', '}', '|', '\\\\'];
      return String(str).split('').map(function(ch) { return spec.indexOf(ch) !== -1 ? '\\\\' + ch : ch; }).join('');
    }

    /**
     * 100% Lokální anonymizace údajů pacientky
     */
    function runAnonymization() {
      if (isAnonymized) return;

      let nameMatches = 0;
      let pojMatches = 0;
      let contactMatches = 0;

      const czWordChar = 'a-zA-Z0-9áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ';
      const namesList = [
        currentMeta.patientName,
        'Staňková', 'Stankova', 'Šárka', 'Sarka',
        'Neumannová', 'Neumannova', 'Hana',
        'Wolf', 'Heike',
        'Šromová', 'Sromová', 'Sromova', 'Eva'
      ].filter(Boolean);
      
      const uniqueTerms = new Set();
      namesList.forEach(name => {
        if (!name) return;
        const clean = name.replace(/\b(Mgr|MUDr|PhDr|Ing|doc|prof|Ph\.D\.|CSc\.)\.?/gi, '').replace(/[.,]/g, '');
        clean.split(/\s+/).forEach(w => {
          const trimmed = w.trim();
          if (trimmed.length > 2 && !/^(Vyšetřovaná|Neznámá|Není)$/i.test(trimmed)) {
            uniqueTerms.add(trimmed);
          }
        });
      });

      const sortedNames = Array.from(uniqueTerms).sort((a, b) => b.length - a.length);
      const namePattern = sortedNames.map(n => escapeRegExpStr(n)).join('|');
      const nameRegex = namePattern ? new RegExp('(?<![' + czWordChar + '])(' + namePattern + ')(?![' + czWordChar + '])', 'gi') : new RegExp('Staňková|Wolf|Neumannová|Šromová', 'gi');

      const pojList = [
        currentMeta.insuranceNumber ? currentMeta.insuranceNumber.replace('/', '') : '',
        '6351056382', '6061200530', '6560227091', '5759160993'
      ].filter(Boolean);
      const pojPattern = Array.from(new Set(pojList)).map(r => escapeRegExpStr(r)).join('|');
      const pojRegex = new RegExp('(?<![0-9])(' + pojPattern + ')(?![0-9])', 'g');
      const genericRcRegex = new RegExp('(?<![0-9])\\\\d{6}/\\\\d{3,4}(?![0-9])', 'g');

      const contactList = [
        currentMeta.address,
        currentMeta.phone
      ].filter(a => a && a.length > 5 && !a.includes('[Neznámé') && a !== '—');
      const contactPattern = contactList.map(c => escapeRegExpStr(c)).join('|');
      const contactRegex = contactPattern ? new RegExp('(' + contactPattern + '|U\\\\s+Hostavického\\\\s+potoka\\\\s+735/27,\\\\s*(?:198\\\\s*00\\\\s*)?Praha\\\\s*98?|\\\\+?420\\\\s*737\\\\s*947\\\\s*022|\\\\+?420\\\\s*\\\\d{3}\\\\s*\\\\d{3}\\\\s*\\\\d{3})', 'gi') : new RegExp('U\\\\s+Hostavického', 'gi');

      // 1. Vymazat z levých boxů i pravého prohlížeče
      document.querySelectorAll('.text-content-view, .json-code-view code, .unparsed-viewer').forEach(el => {
        let text = el.innerText || el.textContent;

        const nm = (text.match(nameRegex) || []).length;
        const pm = (text.match(pojRegex) || []).length + (text.match(genericRcRegex) || []).length;
        const cm = (text.match(contactRegex) || []).length;

        nameMatches += nm;
        pojMatches += pm;
        contactMatches += cm;

        text = text
          .replace(nameRegex, '[ANONYMIZOVÁNO]')
          .replace(pojRegex, '[ANON-RČ]')
          .replace(genericRcRegex, '[ANON-RČ]')
          .replace(contactRegex, '[ANON-KONTAKT]');

        el.innerText = text;
      });

      // 2. Vymazat z hlavičky pacientky
      document.querySelectorAll('.patient-meta-val').forEach(el => {
        let text = el.innerText;
        const nm = (text.match(nameRegex) || []).length;
        const pm = (text.match(pojRegex) || []).length;

        nameMatches += nm;
        pojMatches += pm;

        text = text
          .replace(nameRegex, '[ANONYMIZOVÁNO]')
          .replace(pojRegex, '[ANON-RČ]');

        el.innerText = text;
      });

      // 3. Vyčistit vyhledávací atributy
      document.querySelectorAll('.timeline-box').forEach(box => {
        let searchAttr = box.getAttribute('data-search') || '';
        searchAttr = searchAttr.replace(nameRegex, '').replace(pojRegex, '');
        box.setAttribute('data-search', searchAttr);
      });

      isAnonymized = true;
      const totalErased = nameMatches + pojMatches + contactMatches;

      // Zobrazit banner se shrnutím anonymizace
      const alertBox = document.getElementById('anonymizeResultAlert');
      const alertText = document.getElementById('anonymizeResultText');

      if (alertText) {
        alertText.innerHTML = '<strong>🔒 Anonymizace úspěšně provedena:</strong> Důsledně vymazáno celkem <strong>' + totalErased + ' instancí</strong> osobních údajů. Data jsou nyní 100% bezpečná pro AI.';
      }
      if (alertBox) alertBox.style.display = 'flex';

      // ZMĚNA TLAČÍTKA NA "Odeslat do Gemini"
      const btn = document.getElementById('anonymizeBtn');
      if (btn) {
        btn.innerText = '🚀 Odeslat do Gemini';
        btn.className = 'btn-send-gemini';
      }
    }

    /**
     * Dynamické nahrávání nových souborů uživatelem, parsování a chronologické zařazení
     */
    function handleFileUpload(event) {
      const inputEl = event ? event.target : null;
      const files = Array.from((inputEl && inputEl.files) || []);
      if (!files || files.length === 0) return;

      const uploadBtns = document.querySelectorAll('.btn-upload');
      uploadBtns.forEach(btn => {
        btn.style.opacity = '0.6';
        btn.style.pointerEvents = 'none';
      });

      const filePromises = files.map(file => {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = e => {
            try {
              const arrayBuffer = e.target.result;
              const bytes = new Uint8Array(arrayBuffer);
              let binary = '';
              const len = bytes.byteLength;
              for (let i = 0; i < len; i++) {
                binary += String.fromCharCode(bytes[i]);
              }
              const base64Content = btoa(binary);
              resolve({ fileName: file.name, base64Content: base64Content });
            } catch (err) {
              reject(err);
            }
          };
          reader.onerror = err => reject(err);
          reader.readAsArrayBuffer(file);
        });
      });

      Promise.all(filePromises)
      .then(uploadedFiles => {
        const isHttp = window.location.protocol && window.location.protocol.startsWith('http');
        const uploadUrl = isHttp ? '/api/upload' : 'http://localhost:3000/api/upload';
        return fetch(uploadUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ files: uploadedFiles })
        });
      })
      .then(res => res.json())
      .then(data => {
        if (inputEl) inputEl.value = '';

        if (!data.isSuccess) {
          alert('Chyba při parsování souborů: ' + (data.error || 'Neznámá chyba'));
          uploadBtns.forEach(btn => {
            btn.style.opacity = '1';
            btn.style.pointerEvents = 'auto';
          });
          return;
        }

        if (data.html) {
          document.open();
          document.write(data.html);
          document.close();
        } else {
          window.location.reload();
        }
      })
      .catch(err => {
        console.error('File upload error:', err);
        if (inputEl) inputEl.value = '';
        uploadBtns.forEach(btn => {
          btn.style.opacity = '1';
          btn.style.pointerEvents = 'auto';
        });
        alert('Chyba při zpracování souborů: ' + (err.message || 'Nelze se připojit k IBIS serveru. Ujistěte se, že server běží na http://localhost:3000.'));
      });
    }

    function handleActionClick() {
      if (!isAnonymized) {
        runAnonymization();
      } else {
        sendToGemini();
      }
    }

    window.handleActionClick = handleActionClick;
    window.runAnonymization = runAnonymization;
    window.sendToGemini = sendToGemini;
    window.handleFileUpload = handleFileUpload;
    window.selectUnparsedFragment = selectUnparsedFragment;
    window.selectUnparsedFile = selectUnparsedFile;

    let chatHistory = [];


    /**
     * Odeslání anonymizovaných dat do Gemini AI, výpis Tumor Boardu vlevo a otevření Chatu vpravo
     */
    function sendToGemini() {
      if (!isAnonymized) {
        alert('BEZPEČNOSTNÍ POJISTKA: Data MUSÍ být před odesláním do Gemini anonymizována!');
        return;
      }

      const btn = document.getElementById('anonymizeBtn');
      if (btn) {
        btn.innerText = '⏳ Generuji Závěr Tumor Boardu...';
        btn.disabled = true;
        btn.style.opacity = '0.75';
      }

      // Načítací stav v pravém panelu
      const rightPanel = document.getElementById('rightPanelColumn');
      if (rightPanel) {
        rightPanel.innerHTML = '\
          <div class="panel-header" style="background: var(--nejm-crimson);">\
            <span>🏥 Závěr Tumor Boardu — Gemini AI Processing</span>\
            <span class="panel-header-badge">Zpracovávám...</span>\
          </div>\
          <div class="tb-container-right" style="justify-content: center; align-items: center; background: #ffffff; border: 1px solid var(--nejm-border); border-radius: 4px;">\
            <div style="text-align: center; padding: 40px;">\
              <div style="font-size: 36px; margin-bottom: 12px;">⏳</div>\
              <h3 style="font-family: Merriweather, serif; font-size: 14px; color: var(--nejm-navy); margin-bottom: 8px;">Generuji Závěr Tumor Boardu přes Gemini AI...</h3>\
              <p style="color: var(--text-muted); font-size: 11px; max-width: 420px; line-height: 1.5; margin: 0 auto;">\
                Analytický agent prochází všech 159 vyšetření a časové řady analytů. Vybírá pouze nálezy s klinickým významem pro léčbu.\
              </p>\
            </div>\
          </div>\
        ';
      }

      fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isAnonymized: true })
      })
      .then(res => res.json())
      .then(data => {
        if (!data.isSuccess) {
          alert('Chyba Gemini API: ' + (data.error || 'Neznámá chyba'));
          if (btn) {
            btn.innerText = '🚀 Odeslat do Gemini';
            btn.disabled = false;
            btn.style.opacity = '1';
          }
          return;
        }

        if (btn) {
          btn.innerText = '✅ Závěr Tumor Boardu Hotov (' + data.modelUsed + ')';
          btn.style.background = '#0e2a47';
          btn.style.borderColor = '#0e2a47';
          btn.disabled = false;
          btn.style.opacity = '1';
        }

        // 1. PŘEKRESLENÍ LEVÉ ČÁSTI STRÁNKY — VÝPIS TUMOR BOARDU (PŘEPÍŠEME BOXY S JSONY)
        const leftPanel = document.getElementById('leftPanelColumn');
        if (leftPanel) {
          leftPanel.innerHTML = '\
            <div class="panel-header" style="background: var(--nejm-navy);">\
              <span>🏥 Výstup Multioborového Konsilia (Tumor Board)</span>\
              <span class="panel-header-badge" style="background: var(--nejm-gold); color: #000;">AI: ' + data.modelUsed + '</span>\
            </div>\
\
            <div class="tb-container-right">\
              <!-- HORNÍ ČÁST: ZPRÁVA Z TUMOR BOARDU -->\
              <div class="tb-report-card" style="flex: 1.2;">\
                <div class="tb-card-header">\
                  <span>🏥 ZPRÁVA Z TUMOR BOARDU (VZOR KONSILIUM.DOCX)</span>\
                  <span style="font-size: 10px; font-weight: 400;">VFN Praha — Onkogynekologie</span>\
                </div>\
                <div class="tb-card-body">\
                  ' + data.reportHtml + '\
                </div>\
              </div>\
\
              <!-- DOLNÍ ČÁST: NÁVRH DALŠÍ LÉČBY A POSTUPU -->\
              <div class="tb-report-card" style="flex: 0.8;">\
                <div class="tb-card-header proposal">\
                  <span>💡 NÁVRH DALŠÍHO POSTUPU A LÉČBY</span>\
                </div>\
                <div class="tb-card-body">\
                  ' + data.treatmentPlanHtml + '\
                </div>\
              </div>\
            </div>\
          ';
        }

        // Aktualizace hlavičky reportu o neanonymizovaná data uložená na začátku
        restoreRealPatientHeader();

        // 2. OTEVŘENÍ PRIVÁTNÍHO CHATU V PRAVÉ ČÁSTI (ČERNÉ POZADÍ, ZELENÝ TEXT, BLIKAJÍCÍ ✦ KURZOR)
        if (rightPanel) {
          rightPanel.innerHTML = '\
            <div class="chat-container">\
              <div class="chat-header">\
                <div class="chat-header-title">\
                  <span class="chat-star-icon">✦</span>\
                  <span>GEMINI AI PRIVÁTNÍ KONSILIÁRNÍ CHAT</span>\
                </div>\
                <button class="btn-clear-chat" onclick="clearChatSession()">🗑️ Smazat chat</button>\
              </div>\
\
              <div class="chat-messages" id="chatMessagesLog">\
                <div class="chat-msg model">\
                  <div class="chat-msg-author">✦ Gemini AI (Konzultant)</div>\
✦ Dobrý den, jsem váš AI konzultant. Prostudoval jsem kompletní anonymizovaný Závěr Tumor Boardu a vyšetření pacientky. <br><br>Na co se chcete k tomuto případu zeptat?\
                </div>\
              </div>\
\
              <div class="chat-pills">\
                <button class="chat-pill-btn" onclick="askPill(1)">✦ Proč pouze BSC?</button>\
                <button class="chat-pill-btn" onclick="askPill(2)">✦ Odezva na Caelyx & CA 125</button>\
                <button class="chat-pill-btn" onclick="askPill(3)">✦ Komorbidity a rizika</button>\
              </div>\
\
              <div class="chat-input-bar">\
                <span class="chat-prompt-symbol">✦</span>\
                <input type="text" id="chatInput" class="chat-input" placeholder="Ptejte se Gemini AI na cokoliv k tomuto případu..." onkeydown="handleChatKeyDown(event)" />\
                <button class="chat-send-btn" onclick="sendChatMessage()">Odeslat [Enter]</button>\
              </div>\
            </div>\
          ';
        }
      })
      .catch(err => {
        console.error(err);
        alert('Chyba komunikace se serverem. Ujistěte se, že běží "npm run server" na http://localhost:3000');
        if (btn) {
          btn.innerText = '🚀 Odeslat do Gemini';
          btn.disabled = false;
          btn.style.opacity = '1';
        }
      });
    }

    /**
     * Obnoví v hlavičce reportu i banneru neanonymizovaná data pacientky (uložená na začátku v currentMeta)
     */
    function restoreRealPatientHeader() {
      if (!currentMeta) return;

      const realName = currentMeta.patientName && !currentMeta.patientName.includes('ANONYMIZOVÁNO') && currentMeta.patientName !== 'Není načten žádný pacient' && currentMeta.patientName !== 'Vyšetřovaná Pacientka' ? currentMeta.patientName : null;
      const realRc = currentMeta.insuranceNumber && !currentMeta.insuranceNumber.includes('ANON') && currentMeta.insuranceNumber !== '—' && currentMeta.insuranceNumber !== '[Neznámé RČ]' ? currentMeta.insuranceNumber : null;
      const realCode = currentMeta.insuranceCode && currentMeta.insuranceCode !== '—' ? currentMeta.insuranceCode : null;
      const realDob = currentMeta.dateOfBirth && currentMeta.dateOfBirth !== '—' ? currentMeta.dateOfBirth : null;
      const realAddr = currentMeta.address && !currentMeta.address.includes('ANON') && currentMeta.address !== '—' && currentMeta.address !== '[Neznámé bydliště]' ? currentMeta.address : null;
      const realPhone = currentMeta.phone && !currentMeta.phone.includes('ANON') && currentMeta.phone !== '—' && currentMeta.phone !== '[Neznámý telefon]' ? currentMeta.phone : null;

      // 1. Obnova v horním NEJM banneru
      if (realName) {
        const elName = document.getElementById('valPatientName');
        if (elName) elName.innerText = realName;
      }
      if (realRc) {
        const elRc = document.getElementById('valInsuranceNumber');
        if (elRc) elRc.innerText = realRc;
      }
      if (realCode) {
        const elCode = document.getElementById('valInsuranceCode');
        if (elCode) elCode.innerText = realCode;
      }
      if (realDob) {
        const elDob = document.getElementById('valDateOfBirth');
        if (elDob) elDob.innerText = realDob;
      }
      if (realAddr) {
        const elAddr = document.getElementById('valAddress');
        if (elAddr) { elAddr.innerText = realAddr; elAddr.title = realAddr; }
      }
      if (realPhone) {
        const elPhone = document.getElementById('valPhone');
        if (elPhone) elPhone.innerText = realPhone;
      }

      // 2. Obnova v hlavičce samotné zprávy z Tumor Boardu (.konzilia-patient-meta)
      const docMeta = document.querySelector('.konzilia-patient-meta');
      if (docMeta) {
        const lines = docMeta.querySelectorAll('.konzilia-meta-line');
        lines.forEach(line => {
          const text = line.innerText || line.textContent;
          if (text.includes('Pacientka:') && realName) {
            line.innerHTML = '<strong>Pacientka:</strong> ' + escapeHtml(realName);
          } else if (text.includes('Číslo pojištěnce') && realRc) {
            const codePart = realCode ? ' &nbsp;&nbsp;&nbsp;|&nbsp;&nbsp;&nbsp; <strong>Kód pojišťovny:</strong> ' + escapeHtml(realCode) : '';
            line.innerHTML = '<strong>Číslo pojištěnce (RČ):</strong> ' + escapeHtml(realRc) + codePart;
          } else if (text.includes('Datum narození:') && realDob) {
            line.innerHTML = '<strong>Datum narození:</strong> ' + escapeHtml(realDob);
          } else if (text.includes('Bydliště:') && realAddr) {
            line.innerHTML = '<strong>Bydliště:</strong> ' + escapeHtml(realAddr);
          } else if (text.includes('Telefon:') && realPhone) {
            line.innerHTML = '<strong>Telefon:</strong> ' + escapeHtml(realPhone);
          }
        });
      }
    }

    function askPill(num) {
      if (num === 1) sendChatMessage('Proč přesně je navrženo ukončení CHT a indikováno pouze BSC?');
      if (num === 2) sendChatMessage('Sumařuj odezvu na CHT II. linie Caelyx a vývoj CA 125.');
      if (num === 3) sendChatMessage('Jaké jsou hlavní komorbidity a anamnestická rizika pacientky?');
    }

    /**
     * Odeslání dotazu klinika do Gemini AI Chatu
     */
    function sendChatMessage(promptText) {
      const inputEl = document.getElementById('chatInput');
      const msgText = promptText || (inputEl ? inputEl.value.trim() : '');
      if (!msgText) return;

      if (inputEl) inputEl.value = '';

      const messagesLog = document.getElementById('chatMessagesLog');
      if (messagesLog) {
        const userDiv = document.createElement('div');
        userDiv.className = 'chat-msg user';
        userDiv.innerHTML = '<div class="chat-msg-author">👤 Klinik</div>' + escapeHtml(msgText);
        messagesLog.appendChild(userDiv);

        const loadingDiv = document.createElement('div');
        loadingDiv.className = 'chat-msg model';
        loadingDiv.id = 'chatLoadingMsg';
        loadingDiv.innerHTML = '<div class="chat-msg-author">✦ Gemini AI</div><span class="chat-star-icon">✦</span> Přemýšlím nad odpovedí...';
        messagesLog.appendChild(loadingDiv);
        messagesLog.scrollTop = messagesLog.scrollHeight;
      }

      fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msgText,
          history: chatHistory
        })
      })
      .then(res => res.json())
      .then(data => {
        const loadingDiv = document.getElementById('chatLoadingMsg');
        if (loadingDiv) loadingDiv.remove();

        if (!data.isSuccess) {
          alert('Chyba chatu: ' + (data.error || 'Neznámá chyba'));
          return;
        }

        chatHistory.push({ role: 'user', parts: [{ text: msgText }] });
        chatHistory.push({ role: 'model', parts: [{ text: data.reply }] });

        if (messagesLog) {
          const modelDiv = document.createElement('div');
          modelDiv.className = 'chat-msg model';
          modelDiv.innerHTML = '<div class="chat-msg-author">✦ Gemini AI</div>' + escapeHtml(data.reply);
          messagesLog.appendChild(modelDiv);
          messagesLog.scrollTop = messagesLog.scrollHeight;
        }
      })
      .catch(err => {
        const loadingDiv = document.getElementById('chatLoadingMsg');
        if (loadingDiv) loadingDiv.remove();
        alert('Chyba spojení s chat serverem.');
      });
    }

    /**
     * Smazání paměti chatu a resetování relace
     */
    function clearChatSession() {
      if (confirm('Opravdu chcete kompletně smazat paměť chatu a vyčistit konverzaci?')) {
        chatHistory = [];
        const messagesLog = document.getElementById('chatMessagesLog');
        if (messagesLog) {
          messagesLog.innerHTML = '\
            <div class="chat-msg model">\
              <div class="chat-msg-author">✦ Gemini AI</div>\
✦ [Relace byla resetována]. Chat byl kompletně smazán z paměti. Na co se chcete znova zeptat?\
            </div>\
          ';
        }
      }
    }

    function handleChatKeyDown(event) {
      if (event.key === 'Enter') {
        sendChatMessage();
      }
    }

    function escapeHtml(text) {
      return text ? text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") : '';
    }
  </script>
</body>
</html>`;




  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(outputPath, htmlContent, 'utf8');
  console.log(`[HTML Generator Interactive Buttons Fix] Vygenerován nový výstup se stoprocentně funkčními tlačítky v: ${outputPath}`);
}
