// Gera todos os ícones do aplicativo a partir da arte oficial enviada pelo
// usuário (coração entrelaçado teal/amarelo num quadrado arredondado):
//   scripts/assets/app-icon-white.png  → fonte (fundo branco; o PNG
//   "transparente" recebido tinha o xadrez PINTADO, alpha 255 em tudo —
//   a transparência real é produzida aqui via recorte + máscara).
// Saídas:
//   apps/kiosk/build/icon.ico              → instalador/janela/taskbar Electron
//   apps/kiosk/src/main/appIcon.ts         → base64 p/ splash screen
//   apps/kiosk-ui/public/icons/*.png       → manifest PWA + apple-touch-icon
//   apps/kiosk-ui/public/favicon.png       → favicon
// Rodar com `pnpm icons` na raiz. Os PNGs vão para o git (o deploy da
// Vercel não roda este script).
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import pngToIco from "png-to-ico";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SOURCE = path.join(root, "scripts/assets/app-icon-white.png");

// Raio dos cantos da arte ≈ 21% do lado — a máscara segue o desenho para
// deixar só os cantos transparentes (o miolo branco faz parte do "tile").
const RADIUS_FRACTION = 0.21;

// Recorta a moldura branca ao redor do tile e força canvas quadrado.
async function loadTile() {
  const trimmed = await sharp(SOURCE).trim({ threshold: 12 }).png().toBuffer();
  const meta = await sharp(trimmed).metadata();
  const side = Math.max(meta.width, meta.height);
  return sharp(trimmed)
    .resize(side, side, { fit: "contain", background: "#FFFFFF" })
    .png()
    .toBuffer();
}

function roundedMask(size) {
  const r = Math.round(size * RADIUS_FRACTION);
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" fill="#fff"/></svg>`,
  );
}

/** Tile redimensionado com cantos transparentes (máscara arredondada). */
async function tilePng(tile, size) {
  const resized = await sharp(tile).resize(size, size).png().toBuffer();
  return sharp(resized)
    .composite([{ input: await sharp(roundedMask(size)).png().toBuffer(), blend: "dest-in" }])
    .png()
    .toBuffer();
}

/** Tile sobre canvas branco opaco (iOS/maskable), com fração de padding. */
async function opaquePng(tile, size, fraction) {
  const inner = Math.round(size * fraction);
  const resized = await tilePng(tile, inner);
  const margin = Math.round((size - inner) / 2);
  return sharp({ create: { width: size, height: size, channels: 4, background: "#FFFFFF" } })
    .composite([{ input: resized, left: margin, top: margin }])
    .png()
    .toBuffer();
}

const pwaDir = path.join(root, "apps/kiosk-ui/public/icons");
const buildDir = path.join(root, "apps/kiosk/build");
await mkdir(pwaDir, { recursive: true });
await mkdir(buildDir, { recursive: true });

const tile = await loadTile();

// PWA: ícones normais com cantos transparentes; maskable com o tile na
// safe zone (~78%); apple-touch-icon opaco (iOS ignora transparência e
// aplica o próprio arredondamento).
await writeFile(path.join(pwaDir, "pwa-192.png"), await tilePng(tile, 192));
await writeFile(path.join(pwaDir, "pwa-512.png"), await tilePng(tile, 512));
await writeFile(path.join(pwaDir, "maskable-512.png"), await opaquePng(tile, 512, 0.78));
await writeFile(path.join(pwaDir, "apple-touch-icon.png"), await opaquePng(tile, 180, 1));
await writeFile(path.join(root, "apps/kiosk-ui/public/favicon.png"), await tilePng(tile, 64));

// Windows .ico multi-resolução para o electron-builder.
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const icoPngs = await Promise.all(icoSizes.map((s) => tilePng(tile, s)));
await writeFile(path.join(buildDir, "icon.ico"), await pngToIco(icoPngs));

// Base64 p/ a splash do Electron (embutido no bundle via import).
const splash128 = await tilePng(tile, 128);
await writeFile(
  path.join(root, "apps/kiosk/src/main/appIcon.ts"),
  `// Gerado por scripts/generate-icons.mjs — não editar à mão.\nexport const appIconPngBase64 =\n  "${splash128.toString("base64")}";\n`,
);

console.log(`Ícones gerados: ${pwaDir}, favicon.png, ${buildDir}/icon.ico, appIcon.ts`);
