import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const mdPath = path.resolve('fichatecnicaapi.md');
const htmlPath = path.resolve('fichatecnicaapi_temp.html');
const pdfPath = path.resolve('fichatecnicaapi.pdf');

const mdContent = fs.readFileSync(mdPath, 'utf8');

// Basic Markdown parser for clean styling
function markdownToHtml(md) {
  let html = md
    // Code blocks
    .replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
      const escaped = code.replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<pre><code class="language-${lang || ''}">${escaped}</code></pre>`;
    })
    // Headers
    .replace(/^# (.*$)/gm, '<h1>$1</h1>')
    .replace(/^## (.*$)/gm, '<h2>$1</h2>')
    .replace(/^### (.*$)/gm, '<h3>$1</h3>')
    // Bold / Italic
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code>$1</code>')
    // Blockquotes
    .replace(/^> (.*$)/gm, '<blockquote>$1</blockquote>')
    // Lists
    .replace(/^- (.*$)/gm, '<li>$1</li>');

  // Process tables
  const lines = html.split('\n');
  let inTable = false;
  let tableHtml = '';
  let finalLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('|') && line.endsWith('|')) {
      if (!inTable) {
        inTable = true;
        tableHtml = '<table><thead>';
        const cells = line.split('|').slice(1, -1).map(c => `<th>${c.trim()}</th>`).join('');
        tableHtml += `<tr>${cells}</tr></thead><tbody>`;
      } else if (line.includes('---')) {
        // Separator row, skip
      } else {
        const cells = line.split('|').slice(1, -1).map(c => `<td>${c.trim()}</td>`).join('');
        tableHtml += `<tr>${cells}</tr>`;
      }
    } else {
      if (inTable) {
        inTable = false;
        tableHtml += '</tbody></table>';
        finalLines.push(tableHtml);
      }
      finalLines.push(line);
    }
  }
  if (inTable) {
    tableHtml += '</tbody></table>';
    finalLines.push(tableHtml);
  }

  return finalLines.join('\n');
}

const bodyHtml = markdownToHtml(mdContent);

const fullHtml = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Ficha Técnica — API FaçaAmigos Shopping</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
    
    @page {
      size: A4;
      margin: 15mm 15mm 15mm 15mm;
    }
    
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      color: #1e293b;
      line-height: 1.5;
      font-size: 12px;
      background: #ffffff;
      margin: 0;
      padding: 0;
    }
    
    .header-banner {
      border-bottom: 3px solid #6366f1;
      padding-bottom: 10px;
      margin-bottom: 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    h1 {
      font-size: 20px;
      color: #0f172a;
      margin: 0 0 8px 0;
      font-weight: 700;
      letter-spacing: -0.5px;
    }
    
    h2 {
      font-size: 14px;
      color: #334155;
      margin: 18px 0 8px 0;
      padding-bottom: 4px;
      border-bottom: 1px solid #e2e8f0;
      font-weight: 600;
      page-break-after: avoid;
    }
    
    h3 {
      font-size: 12px;
      color: #475569;
      margin: 12px 0 6px 0;
      font-weight: 600;
      page-break-after: avoid;
    }
    
    p {
      margin: 0 0 8px 0;
    }
    
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 10px 0 14px 0;
      font-size: 11px;
    }
    
    th {
      background-color: #f8fafc;
      color: #334155;
      font-weight: 600;
      text-align: left;
      padding: 7px 10px;
      border: 1px solid #cbd5e1;
    }
    
    td {
      padding: 6px 10px;
      border: 1px solid #e2e8f0;
      color: #334155;
    }
    
    tr:nth-child(even) td {
      background-color: #f8fafc;
    }
    
    code {
      font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
      font-size: 11px;
      background: #f1f5f9;
      color: #0f172a;
      padding: 2px 4px;
      border-radius: 3px;
      border: 1px solid #e2e8f0;
    }
    
    pre {
      background: #0f172a;
      color: #f8fafc;
      padding: 10px 12px;
      border-radius: 6px;
      overflow-x: auto;
      margin: 8px 0 12px 0;
      page-break-inside: avoid;
    }
    
    pre code {
      background: transparent;
      color: inherit;
      border: none;
      padding: 0;
      font-size: 10.5px;
      line-height: 1.4;
    }
    
    blockquote {
      background: #eff6ff;
      border-left: 4px solid #3b82f6;
      margin: 10px 0;
      padding: 8px 12px;
      color: #1e3a8a;
      border-radius: 0 6px 6px 0;
      font-size: 11.5px;
    }
    
    li {
      margin-bottom: 3px;
    }

    .footer-stamp {
      margin-top: 24px;
      padding-top: 8px;
      border-top: 1px solid #e2e8f0;
      font-size: 10px;
      color: #64748b;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="header-banner">
    <div>
      <span style="font-weight: 700; color: #6366f1; font-size: 13px;">FAÇAAMIGOS — TECNOLOGIA & SISTEMAS</span>
    </div>
  </div>
  ${bodyHtml}
  <div class="footer-stamp">
    FaçaAmigos Entretenimento Infantil LTDA — Documento Técnico Oficial para Integração Shopping
  </div>
</body>
</html>`;

fs.writeFileSync(htmlPath, fullHtml, 'utf8');

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const command = `"${edgePath}" --headless --disable-gpu --print-to-pdf="${pdfPath}" "${htmlPath}"`;

console.log('Executando conversão para PDF...');
execSync(command);

console.log('PDF gerado com sucesso!');

fs.unlinkSync(htmlPath);
