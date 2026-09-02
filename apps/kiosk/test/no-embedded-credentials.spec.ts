import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guarda de regressão: nenhuma credencial embutida no código-fonte.
 *
 * O print bridge carregou por meses uma chave `service_role` fixa como
 * fallback. Ela ignora todo o RLS do banco e viajava dentro de cada
 * instalador distribuído — quem tivesse o instalador lia e escrevia
 * qualquer tabela, inclusive `fa_kiosk_employee_payroll_info`. Passou
 * despercebida porque era só mais uma linha comprida num arquivo grande.
 *
 * Este teste falha se algo assim voltar. Chaves ficam no .env da
 * instalação (ver apps/kiosk/.env.example), nunca no código.
 */

const REPO_ROOT = join(import.meta.dirname, "../../..");

// Os padrões exigem um CORPO de chave plausível depois do prefixo, não o
// prefixo solto: comentários e documentação citam "sb_secret_..." o tempo
// todo, e um teste que falha com a própria documentação seria desligado
// na primeira vez que atrapalhasse.
const KEY_BODY = "[A-Za-z0-9_-]{20,}";

/** JWT do Supabase (anon/service_role): header base64 de {"alg":"HS256","typ":"JWT"}. */
const JWT_PATTERN = new RegExp(`eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\\.${KEY_BODY}`);
/** Formato novo de chave secreta do Supabase. */
const SECRET_KEY_PATTERN = new RegExp(`${["sb", "secret", ""].join("_")}${KEY_BODY}`);

function sourceFiles(): string[] {
  const out = execFileSync(
    "git",
    ["ls-files", "--", "apps/*/src/**", "packages/*/src/**", "scripts/*.mjs", "supabase/functions/**"],
    { cwd: REPO_ROOT, encoding: "utf-8" },
  );
  return out
    .split("\n")
    .map((f) => f.trim())
    .filter((f) => /\.(ts|tsx|js|mjs|cjs)$/.test(f))
    // Este próprio arquivo cita os prefixos para poder procurá-los.
    .filter((f) => !f.endsWith("no-embedded-credentials.spec.ts"));
}

describe("nenhuma credencial embutida no código-fonte", () => {
  const files = sourceFiles();

  it("encontra arquivos para varrer (a varredura em si não pode virar no-op)", () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files).toContain("apps/kiosk/src/main/printBridge.ts");
  });

  it("nenhum JWT do Supabase literal", () => {
    const offenders = files.filter((f) => JWT_PATTERN.test(readFileSync(join(REPO_ROOT, f), "utf-8")));
    expect(offenders, `Chave do Supabase embutida em: ${offenders.join(", ")}. Use o .env da instalação.`).toEqual([]);
  });

  it("nenhuma chave secreta do Supabase no formato novo", () => {
    const offenders = files.filter((f) => SECRET_KEY_PATTERN.test(readFileSync(join(REPO_ROOT, f), "utf-8")));
    expect(offenders, `Chave secreta embutida em: ${offenders.join(", ")}. Use o .env da instalação.`).toEqual([]);
  });

  it("o print bridge não tem chave padrão embutida — sem .env ele avisa e não sobe", () => {
    const source = readFileSync(join(REPO_ROOT, "apps/kiosk/src/main/printBridge.ts"), "utf-8");
    // O `||` com literal era exatamente a forma do fallback removido.
    expect(source).not.toMatch(/FACAAMIGOS_SUPABASE_(SECRET_KEY|SERVICE_ROLE_KEY)\s*\|\|\s*["'`]/);
  });

  /**
   * O instalador vai para um bucket PÚBLICO do Supabase Storage (ver
   * `publish` em electron-builder.yml). Um extraResource `.env` passava
   * despercebido porque no CI o arquivo nem existe — o electron-builder
   * ignora extraResource ausente em silêncio —, mas num build local ele
   * existe e a chave secreta do projeto ficaria baixável por qualquer um.
   */
  it("o electron-builder não embute o .env no instalador", () => {
    const yml = readFileSync(join(REPO_ROOT, "apps/kiosk/electron-builder.yml"), "utf-8");
    const linhasAtivas = yml
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));

    expect(linhasAtivas, "extraResources não pode listar `.env` — o bucket de release é público.").not.toContainEqual(
      "- from: .env",
    );
  });

  /**
   * O `.env` que o app semeia sozinho em %APPDATA% tem a precedência mais
   * alta de todas e nunca é corrigido por reinstalar. Nascer com a chave
   * publicável na variável da secreta parou a emissão fiscal por semanas:
   * o valor parecia configurado e a Edge Function respondia 401.
   */
  it("o .env semeado pelo app não preenche a chave secreta com a publicável", () => {
    const source = readFileSync(join(REPO_ROOT, "apps/kiosk/src/main/main.ts"), "utf-8");
    expect(source).not.toMatch(/FACAAMIGOS_SUPABASE_(SECRET_KEY|SERVICE_ROLE_KEY)=sb_publishable_/);
  });
});
