// nfce/svrs-transport.js (import { request } from "node:https"),
// dps-nacional-transport.ts e nfce/ca-bundle.ts (import { rootCertificates }
// from "node:tls") ficam de fora deste barrel de propósito: o kiosk-ui
// (bundle de navegador, deploy na Vercel) importa deste pacote, e um
// `export *` puxando módulo Node quebra o build do Vite/Rollup mesmo sem
// nenhuma tela usar a função. Quem precisar da SVRS/ADN/ca-bundle importa
// direto de "@facaamigos/fiscal/svrs-transport",
// "@facaamigos/fiscal/dps-nacional-transport" ou
// "@facaamigos/fiscal/ca-bundle" (só rodam no worker Electron/Node).
export * from "./chave-acesso.js";
export * from "./types.js";
export * from "./nfce-xml.js";
export * from "./qrcode-nfce.js";
export * from "./assinatura.js";
export * from "./danfe-nfce.js";
export * from "./nfce/transport.js";
export * from "./nfce/urls-pa.js";
export * from "./dps-nacional-xml.js";
export * from "./eventos-xml.js";
export * from "./texto.js";
export * from "./data-hora.js";
