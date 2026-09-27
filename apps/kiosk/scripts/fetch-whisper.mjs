// Baixa o binário Windows x64 (CPU, sem CUDA/BLAS — o PC do balcão não tem
// GPU dedicada) do whisper.cpp e extrai para vendor/whisper/, de onde
// electron-builder.yml o empacota via extraResources.
//
// NUNCA o modelo (.bin, ~470MB+): o instalador vai para um bucket PÚBLICO
// do Supabase Storage com limite de 100MB/arquivo (ver electron-builder.yml)
// — o modelo é baixado em runtime pelo próprio worker
// (apps/kiosk/src/main/voiceWorker.ts) para userData/whisper/.
//
// Versão pinada (não "latest"): o release "latest" do whisper.cpp aponta
// pro nightly mais novo sem aviso — pinar evita que um instalador saia
// com um binário nunca testado. Para atualizar: escolher uma tag em
// https://github.com/ggml-org/whisper.cpp/releases, baixar
// whisper-bin-x64.zip, conferir o sha256 e atualizar as duas constantes
// abaixo (verificado manualmente em 2026-09-27).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WHISPER_CPP_TAG = "b5130";
const ZIP_URL = `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_CPP_TAG}/whisper-bin-x64.zip`;
const ZIP_SHA256 = "f9ec6c52a2e949b62ab51fa21d0d497958f9e41c3010c157c4e42932d5316f3c";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const kioskDir = join(scriptDir, "..");
const vendorDir = join(kioskDir, "vendor", "whisper");
const cliPath = join(vendorDir, "whisper-cli.exe");

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function alreadyFetched() {
  if (!existsSync(cliPath)) return false;
  const marker = join(vendorDir, ".fetched-tag");
  return existsSync(marker) && readFileSync(marker, "utf-8").trim() === WHISPER_CPP_TAG;
}

async function main() {
  if (alreadyFetched()) {
    console.log(`[fetch-whisper] já presente (tag ${WHISPER_CPP_TAG}) — nada a fazer.`);
    return;
  }

  if (process.platform !== "win32") {
    console.warn(
      "[fetch-whisper] plataforma não-Windows: pulando o download do binário " +
        "(o build do kiosk só empacota para Windows). O worker de transcrição " +
        "ficará sem whisper-cli neste ambiente.",
    );
    return;
  }

  console.log(`[fetch-whisper] baixando ${ZIP_URL}...`);
  const res = await fetch(ZIP_URL);
  if (!res.ok) throw new Error(`download falhou: HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());

  const actualHash = sha256(buffer);
  if (actualHash !== ZIP_SHA256) {
    throw new Error(
      `sha256 do zip não confere (esperado ${ZIP_SHA256}, obtido ${actualHash}). ` +
        "O release pode ter mudado — confira manualmente antes de atualizar a constante.",
    );
  }

  mkdirSync(vendorDir, { recursive: true });
  const zipPath = join(vendorDir, "_whisper.zip");
  writeFileSync(zipPath, buffer);

  // Expand-Archive (PowerShell nativo do Windows) evita adicionar uma
  // dependência de unzip só para isto — o dev e o CI (windows-latest) já
  // têm PowerShell disponível.
  const extractDir = join(vendorDir, "_extracted");
  rmSync(extractDir, { recursive: true, force: true });
  execFileSync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${extractDir}' -Force`,
  ]);

  // Só o executável e as DLLs que ele carrega em runtime (whisper.dll +
  // ggml.dll/ggml-base.dll/ggml-cpu-*.dll — o ggml escolhe em runtime qual
  // ggml-cpu-*.dll casa com o CPU do balcão). Deixa de fora bench/talk-llama/
  // parakeet/SDL2 e as demais ferramentas do pacote, que não são usadas.
  const releaseDir = join(extractDir, "Release");
  for (const name of ["whisper-cli.exe", "whisper.dll", "ggml.dll", "ggml-base.dll"]) {
    const from = join(releaseDir, name);
    if (!existsSync(from)) throw new Error(`arquivo esperado não encontrado no zip: ${name}`);
    writeFileSync(join(vendorDir, name), readFileSync(from));
  }
  const { readdirSync } = await import("node:fs");
  for (const file of readdirSync(releaseDir)) {
    if (file.startsWith("ggml-cpu-") && file.endsWith(".dll")) {
      writeFileSync(join(vendorDir, file), readFileSync(join(releaseDir, file)));
    }
  }

  rmSync(zipPath, { force: true });
  rmSync(extractDir, { recursive: true, force: true });
  writeFileSync(join(vendorDir, ".fetched-tag"), WHISPER_CPP_TAG, "utf-8");

  console.log(`[fetch-whisper] pronto em ${vendorDir} (whisper.cpp ${WHISPER_CPP_TAG}, CPU x64).`);
}

main().catch((err) => {
  console.error("[fetch-whisper]", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
