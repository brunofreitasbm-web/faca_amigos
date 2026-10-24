// Gera fichatecnicaapi.pdf a partir de fichatecnicaapi.md com o branding FaçaAmigos
// (Branding/fa-aamigos-design-system: logo, Fredoka One + Nunito, rosa/turquesa/amarelo,
// botões e cartões arredondados). Rodar da raiz do repositório:
//   node scripts/generate-pdf.mjs
// Navegador: Edge no Windows; em outros sistemas usa o Chromium do Playwright, se instalado.
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';

const mdPath = path.resolve('fichatecnicaapi.md');
const htmlPath = path.resolve('fichatecnicaapi_temp.html');
const pdfPath = path.resolve('fichatecnicaapi.pdf');
const logoPath = path.resolve('Branding/fa-aamigos-design-system/project/assets/Logo.png');

const md = fs.readFileSync(mdPath, 'utf8').replace(/\r\n/g, '\n');
const logoDataUri = `data:image/png;base64,${fs.readFileSync(logoPath).toString('base64')}`;

const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function inline(text) {
  const codes = [];
  let out = esc(text).replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });
  out = out
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
}

function markdownToHtml(src) {
  const lines = src.split('\n');
  const html = [];
  let i = 0;
  let para = [];
  const flush = () => {
    if (para.length) html.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
  };
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('```')) {
      flush();
      const code = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]);
      i++;
      html.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,3}) (.*)$/.exec(line);
    if (h) {
      flush();
      html.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      i++;
      continue;
    }
    if (line.trim().startsWith('|')) {
      flush();
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(lines[i++].trim());
      const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim()));
      const head = cells(rows[0]);
      const body = rows.slice(2).map(cells);
      html.push(
        `<table><thead><tr>${head.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>` +
          body.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('') +
          '</tbody></table>',
      );
      continue;
    }
    if (line.startsWith('> ')) {
      flush();
      const q = [];
      while (i < lines.length && lines[i].startsWith('> ')) q.push(lines[i++].slice(2));
      html.push(`<blockquote>${inline(q.join(' '))}</blockquote>`);
      continue;
    }
    if (/^- /.test(line)) {
      flush();
      const items = [];
      while (i < lines.length && (/^- /.test(lines[i]) || /^  \S/.test(lines[i]))) {
        if (/^- /.test(lines[i])) items.push(lines[i].slice(2));
        else items[items.length - 1] += ' ' + lines[i].trim();
        i++;
      }
      html.push(`<ul>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</ul>`);
      continue;
    }
    if (line.trim() === '') {
      flush();
      i++;
      continue;
    }
    para.push(line.trim());
    i++;
  }
  flush();
  return html.join('\n');
}

// Título (h1) vira o cabeçalho do documento; o restante é o corpo.
const bodyMd = md.replace(/^# .*\n/, '');
const title = /^# (.*)$/m.exec(md)?.[1] ?? 'Ficha técnica';
const bodyHtml = markdownToHtml(bodyMd);

const fullHtml = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Fredoka+One&family=Nunito:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
  :root {
    --pink: #F0196B;
    --teal: #2ECFB5;
    --yellow: #FFE234;
    --dark: #1A3F35;
    --text: #1A3F35;
    --muted: #5B6F69;
    --line: #DDEBE7;
    --soft: #F4FBF9;
  }
  @page { size: A4; margin: 14mm 12mm 16mm; }
  * { box-sizing: border-box; }
  body {
    font-family: 'Nunito', 'Segoe UI', Arial, sans-serif;
    color: var(--text);
    font-size: 10.5px;
    line-height: 1.55;
    margin: 0;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .brandbar { display: flex; height: 8px; border-radius: 9999px; overflow: hidden; margin-bottom: 14px; }
  .brandbar span { flex: 1; }
  .header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
  .logo { position: relative; width: 190px; aspect-ratio: 1750 / 365; overflow: hidden; flex: none; }
  .logo img { position: absolute; width: 114.23%; left: -4.571%; top: -117.8%; }
  .pill {
    display: inline-block; background: var(--pink); color: #fff; font-weight: 800;
    font-size: 9.5px; letter-spacing: .08em; text-transform: uppercase;
    padding: 6px 14px; border-radius: 9999px;
  }
  h1 {
    font-family: 'Fredoka One', 'Nunito', sans-serif; font-weight: 400;
    font-size: 30px; line-height: 1.1; margin: 0 0 6px; color: var(--dark);
  }
  h1 em { font-style: normal; color: var(--pink); }
  .lead { color: var(--muted); font-size: 11.5px; margin: 0 0 16px; }
  h2 {
    font-family: 'Fredoka One', 'Nunito', sans-serif; font-weight: 400;
    font-size: 17px; color: var(--dark); margin: 24px 0 8px;
    padding-bottom: 6px; position: relative; break-after: avoid;
  }
  h2::after {
    content: ''; position: absolute; left: 0; bottom: 0; width: 44px; height: 4px;
    border-radius: 9999px; background: var(--pink);
  }
  h3 { font-weight: 800; font-size: 12px; color: var(--pink); margin: 16px 0 6px; break-after: avoid; }
  p { margin: 6px 0; }
  ul { margin: 6px 0; padding-left: 18px; }
  li { margin-bottom: 3px; }
  li::marker { color: var(--pink); }
  strong { font-weight: 800; }
  code {
    font-family: 'Cascadia Mono', Consolas, 'DejaVu Sans Mono', monospace; font-size: 9.5px;
    background: #FFE9F1; color: #B50E4C; padding: 1px 6px; border-radius: 8px;
  }
  pre {
    background: var(--dark); color: #E9FFF9; border-radius: 16px;
    padding: 12px 16px; margin: 8px 0; break-inside: avoid; overflow: hidden;
  }
  pre code { background: none; color: inherit; padding: 0; font-size: 9.5px; white-space: pre-wrap; word-break: break-all; }
  table {
    width: 100%; border-collapse: separate; border-spacing: 0; margin: 8px 0 12px;
    border: 1px solid var(--line); border-radius: 14px; overflow: hidden; break-inside: avoid;
  }
  th {
    background: var(--dark); color: #fff; text-align: left; font-weight: 800;
    padding: 7px 10px; font-size: 9.5px; letter-spacing: .03em;
  }
  td { padding: 6px 10px; border-top: 1px solid var(--line); vertical-align: top; }
  tbody tr:nth-child(even) td { background: var(--soft); }
  td code { white-space: nowrap; }
  blockquote {
    background: #FFF8C2; border-radius: 16px; padding: 10px 14px; margin: 8px 0;
  }
  .footer {
    margin-top: 28px; padding: 10px 16px; border-radius: 9999px; background: var(--soft);
    text-align: center; font-size: 9.5px; font-weight: 700; color: var(--dark);
  }
  .footer b { color: var(--pink); }
</style>
</head>
<body>
  <div class="brandbar"><span style="background:var(--yellow)"></span><span style="background:var(--teal)"></span><span style="background:var(--pink)"></span></div>
  <div class="header">
    <div class="logo"><img src="${logoDataUri}" alt="FaçaAmigos — Playground Inclusivo"></div>
    <span class="pill">Integração via API · layout 1.0</span>
  </div>
  <h1>${esc(title).replace(/^(.*?—\s*)(.*)$/, '$1<em>$2</em>')}</h1>
  ${bodyHtml}
  <div class="footer"><b>FaçaAmigos</b> · Playground Inclusivo — Documento técnico para integração com shoppings</div>
</body>
</html>`;

fs.writeFileSync(htmlPath, fullHtml, 'utf8');

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
try {
  if (process.platform === 'win32' && fs.existsSync(edgePath)) {
    console.log('Executando conversão para PDF (Edge)...');
    execFileSync(edgePath, [
      '--headless', '--disable-gpu', '--no-pdf-header-footer',
      `--print-to-pdf=${pdfPath}`, htmlPath,
    ]);
  } else {
    console.log('Executando conversão para PDF (Playwright/Chromium)...');
    const require = createRequire(import.meta.url);
    const { chromium } = require('playwright');
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle' });
    await page.pdf({ path: pdfPath, format: 'A4', printBackground: true, preferCSSPageSize: true });
    await browser.close();
  }
  console.log('PDF gerado com sucesso!');
} finally {
  fs.unlinkSync(htmlPath);
}
