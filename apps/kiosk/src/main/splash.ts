import { appIconPngBase64 } from "./appIcon.js";

/**
 * Splash como data-URL: zero arquivo extra para o empacotador carregar —
 * o esbuild embute a string no bundle e o BrowserWindow carrega direto.
 * Cores da marca: rosa #F0196B (packages/ui/src/tokens/colors.css); o
 * ícone é a arte oficial (scripts/generate-icons.mjs → appIcon.ts).
 */
const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<style>
  html, body { margin: 0; height: 100%; }
  body {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 18px; background: #F0196B; color: #fff; user-select: none;
    font-family: "Segoe UI", system-ui, sans-serif;
  }
  .logo { width: 84px; height: 84px; }
  .name { font-size: 26px; font-weight: 700; letter-spacing: 0.5px; }
  .status { font-size: 13px; opacity: 0.85; display: flex; align-items: center; gap: 8px; }
  .spin {
    width: 14px; height: 14px; border-radius: 50%;
    border: 2px solid rgba(255,255,255,0.35); border-top-color: #fff;
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
  <img class="logo" src="data:image/png;base64,${appIconPngBase64}" alt="" />
  <div class="name">FaçaAmigos</div>
  <div class="status"><span class="spin"></span> Iniciando o sistema…</div>
</body>
</html>`;

export const splashDataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
