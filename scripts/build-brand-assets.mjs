// Regenera supabase/functions/_shared/assets/brandAssets.ts a partir de
// supabase/functions/_shared/assets/src/ (TTFs OFL + logo.png já recortado).
// Uso: node scripts/build-brand-assets.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "supabase/functions/_shared/assets/src");
const files = [
  ["FREDOKA_B64", "FredokaOne_400Regular.ttf"],
  ["NUNITO_REG_B64", "Nunito_400Regular.ttf"],
  ["NUNITO_BOLD_B64", "Nunito_700Bold.ttf"],
  ["LOGO_PNG_B64", "logo.png"],
];
const out = [
  "// Gerado por scripts/build-brand-assets.mjs a partir de supabase/functions/_shared/assets/src/.",
  "// Fontes OFL (Fredoka One, Nunito) e logo FaçaAmigos embutidos em base64: static_files do Supabase",
  "// é descartado no deploy sem Docker, então os bytes viajam dentro do bundle da function.",
  "// NÃO editar à mão.",
  "",
  ...files.map(([name, f]) => `export const ${name} =\n  "${readFileSync(join(src, f)).toString("base64")}";\n`),
];
writeFileSync(join(root, "supabase/functions/_shared/assets/brandAssets.ts"), out.join("\n"));
console.log("ok");
