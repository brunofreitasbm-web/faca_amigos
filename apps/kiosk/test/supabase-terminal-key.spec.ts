import { describe, expect, it, afterEach } from "vitest";
import { resolveTerminalSupabaseKey } from "../src/config/supabaseTerminalKey.js";

const KEYS = ["FACAAMIGOS_SUPABASE_SECRET_KEY", "FACAAMIGOS_SUPABASE_SERVICE_ROLE_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY"] as const;

describe("resolveTerminalSupabaseKey", () => {
  afterEach(() => {
    for (const key of KEYS) delete process.env[key];
  });

  it("hasServiceRoleKey é false quando nenhuma chave está configurada (cai na publicável embutida)", () => {
    const result = resolveTerminalSupabaseKey();
    expect(result.hasServiceRoleKey).toBe(false);
    expect(result.secretKey).toMatch(/^sb_publishable_/);
  });

  it("hasServiceRoleKey é false quando FACAAMIGOS_SUPABASE_SECRET_KEY foi preenchida por engano com a chave publicável", () => {
    process.env.FACAAMIGOS_SUPABASE_SECRET_KEY = "sb_publishable_ssGb6CGSjsE7PTfXpR6cBg_I20V6YBh";

    const result = resolveTerminalSupabaseKey();

    expect(result.hasServiceRoleKey).toBe(false);
  });

  it("hasServiceRoleKey é true com uma chave secreta real (sb_secret_...)", () => {
    process.env.FACAAMIGOS_SUPABASE_SECRET_KEY = "sb_secret_algumacoisarealaqui";

    const result = resolveTerminalSupabaseKey();

    expect(result.hasServiceRoleKey).toBe(true);
    expect(result.secretKey).toBe("sb_secret_algumacoisarealaqui");
  });

  it("hasServiceRoleKey é true com a service role key legada (formato JWT)", () => {
    process.env.FACAAMIGOS_SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiJ9.fake.jwt";

    const result = resolveTerminalSupabaseKey();

    expect(result.hasServiceRoleKey).toBe(true);
  });
});
