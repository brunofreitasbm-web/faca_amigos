import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { persistTerminalKey, readEnvVar, upsertEnvVar } from "../src/config/terminalKeyStore.js";

const SECRET = "sb_secret_abc123";

describe("terminalKeyStore", () => {
  it("troca a linha vazia sem perder o resto do .env", () => {
    const out = upsertEnvVar("A=1\nFACAAMIGOS_SUPABASE_SECRET_KEY=\nB=2\n", "FACAAMIGOS_SUPABASE_SECRET_KEY", SECRET);
    expect(out).toBe(`A=1\nFACAAMIGOS_SUPABASE_SECRET_KEY=${SECRET}\nB=2\n`);
  });

  it("acrescenta quando a variável não existe", () => {
    expect(readEnvVar(upsertEnvVar("A=1\n", "FACAAMIGOS_SUPABASE_SECRET_KEY", SECRET), "FACAAMIGOS_SUPABASE_SECRET_KEY")).toBe(SECRET);
  });

  it("persiste no arquivo, cria se faltar e recusa chave publicável", () => {
    const f = join(mkdtempSync(join(tmpdir(), "key-")), "sub", ".env");
    expect(persistTerminalKey(f, "sb_publishable_x")).toBe(false);
    expect(persistTerminalKey(f, SECRET)).toBe(true);
    expect(readFileSync(f, "utf8")).toContain(`FACAAMIGOS_SUPABASE_SECRET_KEY=${SECRET}`);
    expect(persistTerminalKey(f, SECRET)).toBe(false);
    writeFileSync(f, "FACAAMIGOS_SUPABASE_SECRET_KEY=sb_publishable_x\n");
    expect(persistTerminalKey(f, SECRET)).toBe(true);
  });
});
