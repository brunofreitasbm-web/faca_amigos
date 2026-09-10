// Gera o bitmap 1-bit do símbolo Faça Amigos (arcos amarelo/verde + ponto)
// usado como timbre no topo dos cupons não fiscais das impressoras térmicas
// ESC/POS (Elgin i8/i9, Bematech, Epson, etc. — todas monocromáticas: a
// impressora térmica não reproduz cor, só preto/branco).
//
// Fonte: scripts/assets/logo-simbolo.png (arte com fundo transparente —
// o canal alfa já é o contorno certo, então vira 1-bit por threshold, sem
// dithering, o que mantém as bordas do símbolo nítidas na resolução baixa
// da cabeça térmica).
//
// Saída: packages/domain/src/printers/logoBitmap.ts (dado gerado, não
// editar à mão — rodar `pnpm print:logo` de novo se a arte mudar).
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SOURCE = path.join(root, "scripts/assets/logo-simbolo.png");
const OUTPUT = path.join(root, "packages/domain/src/printers/logoBitmap.ts");

// Largura em dots precisa ser múltiplo de 8 (1 byte = 8 dots horizontais no
// formato raster ESC/POS). 176 dots ≈ 22mm em 203dpi — cabe centralizado
// numa bobina de 80mm sem competir com o texto do cabeçalho.
const WIDTH_DOTS = 176;
const WIDTH_BYTES = WIDTH_DOTS / 8;
const ALPHA_THRESHOLD = 127;

async function main() {
  const meta = await sharp(SOURCE).metadata();
  const heightDots = Math.round((meta.height / meta.width) * WIDTH_DOTS);

  const { data, info } = await sharp(SOURCE)
    .resize(WIDTH_DOTS, heightDots, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const bytes = [];
  for (let y = 0; y < height; y++) {
    for (let xByte = 0; xByte < WIDTH_BYTES; xByte++) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit++) {
        const x = xByte * 8 + bit;
        const alpha = data[(y * width + x) * channels + 3];
        const on = alpha > ALPHA_THRESHOLD ? 1 : 0;
        byte |= on << (7 - bit);
      }
      bytes.push(byte);
    }
  }
  const hex = Buffer.from(bytes).toString("hex");

  const contents = `// Gerado por scripts/generate-print-logo.mjs a partir de
// scripts/assets/logo-simbolo.png — não editar à mão.
//
// Bitmap 1-bit (raster ESC/POS: 1 byte = 8 dots horizontais, MSB primeiro,
// bit 1 = ponto preto) do símbolo Faça Amigos, para impressão como timbre
// via NV Graphics (FS q / FS p) — ver packages/domain/src/printers/escpos.ts.

/** Largura do bitmap em bytes (dots horizontais / 8). */
export const LOGO_WIDTH_BYTES = ${WIDTH_BYTES};

/** Altura do bitmap em dots. */
export const LOGO_HEIGHT_DOTS = ${height};

/** Dados do bitmap em hexadecimal (${bytes.length} bytes). */
export const LOGO_BITMAP_HEX =
  "${hex}";
`;

  await writeFile(OUTPUT, contents);
  console.log(`Logo bitmap gerado: ${WIDTH_DOTS}x${height} dots → ${OUTPUT}`);
}

main();
