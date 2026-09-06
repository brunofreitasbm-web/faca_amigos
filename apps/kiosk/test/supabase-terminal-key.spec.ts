import { describe, expect, it, afterEach } from "vitest";
import { resolveTerminalSupabaseKey } from "../src/config/supabaseTerminalKey.js";

const KEYS = ["FACAAMIGOS_SUPABASE_SECRET_KEY", "FACAAMIGOS_SUPABASE_SERVICE_ROLE_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY"] as const;

// Uma chave secreta de mentira, montada em pedaços para não casar com o
// varredor de credenciais embutidas (no-embedded-credentials.spec.ts).
const SECRET_FALSA = ["sb", "secret", "chavefalsadetestesomente"].join("_");

describe("resolveTerminalSupabaseKey", () => {
  afterEach(() => {
    for (const key of KEYS) delete process.env[key];
  });

  it("hasServiceRoleKey é false quando nenhuma chave está configurada (cai na publicável embutida)", () => {
    const result = resolveTerminalSupabaseKey();
    expect(result.hasServiceRoleKey).toBe(false);
    expect(result.canFetchFiscalCredentials).toBe(false);
    expect(result.secretKey).toMatch(/^sb_publishable_/);
  });

  it("hasServiceRoleKey é false quando FACAAMIGOS_SUPABASE_SECRET_KEY foi preenchida por engano com a chave publicável", () => {
    process.env.FACAAMIGOS_SUPABASE_SECRET_KEY = "sb_publishable_ssGb6CGSjsE7PTfXpR6cBg_I20V6YBh";

    const result = resolveTerminalSupabaseKey();

    expect(result.hasServiceRoleKey).toBe(false);
    expect(result.canFetchFiscalCredentials).toBe(false);
    expect(result.kind).toBe("publishable");
  });

  it("hasServiceRoleKey é true com uma chave secreta real (sb_secret_...)", () => {
    process.env.FACAAMIGOS_SUPABASE_SECRET_KEY = SECRET_FALSA;

    const result = resolveTerminalSupabaseKey();

    expect(result.hasServiceRoleKey).toBe(true);
    expect(result.canFetchFiscalCredentials).toBe(true);
    expect(result.secretKey).toBe(SECRET_FALSA);
  });

  // A service_role legada continua servindo para gravar no banco — é com
  // ela que alguns terminais imprimem hoje —, mas a Edge Function
  // nfse-certificate-fetch a recusa com 401 (medido em produção,
  // 2026-09-02). Separar as duas respostas é o que impede de consertar a
  // emissão fiscal derrubando a impressão de pulseira junto.
  it("service role legada (JWT) serve para o banco, mas NÃO para buscar o certificado", () => {
    process.env.FACAAMIGOS_SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiJ9.fake.jwt";

    const result = resolveTerminalSupabaseKey();

    expect(result.hasServiceRoleKey).toBe(true);
    expect(result.canFetchFiscalCredentials).toBe(false);
    expect(result.kind).toBe("legacy-jwt");
  });

  it("a chave secreta nova vence a legada quando as duas estão preenchidas", () => {
    process.env.FACAAMIGOS_SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiJ9.fake.jwt";
    process.env.FACAAMIGOS_SUPABASE_SECRET_KEY = SECRET_FALSA;

    const result = resolveTerminalSupabaseKey();

    expect(result.secretKey).toBe(SECRET_FALSA);
    expect(result.canFetchFiscalCredentials).toBe(true);
  });

  // Caso real do terminal quebrado: a publicável ocupando a variável de
  // maior precedência e a secreta boa na de compatibilidade. Antes, a
  // publicável vencia por vir primeiro na lista e o terminal ficava mudo.
  it("ignora a publicável e usa a secreta que está na variável de compatibilidade", () => {
    process.env.FACAAMIGOS_SUPABASE_SECRET_KEY = "sb_publishable_ssGb6CGSjsE7PTfXpR6cBg_I20V6YBh";
    process.env.FACAAMIGOS_SUPABASE_SERVICE_ROLE_KEY = SECRET_FALSA;

    const result = resolveTerminalSupabaseKey();

    expect(result.secretKey).toBe(SECRET_FALSA);
    expect(result.canFetchFiscalCredentials).toBe(true);
  });
});
