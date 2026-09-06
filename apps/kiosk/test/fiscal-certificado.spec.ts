import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const readCredentialsMock = vi.fn();

vi.mock("../src/fiscal/vault.js", () => ({
  readCredentials: (...args: unknown[]) => readCredentialsMock(...args),
}));

import { buscarCredenciaisFiscais } from "../src/fiscal/certificado.js";

function fakeSupabase(invoke: ReturnType<typeof vi.fn>): SupabaseClient {
  return { functions: { invoke } } as unknown as SupabaseClient;
}

describe("buscarCredenciaisFiscais", () => {
  beforeEach(() => {
    readCredentialsMock.mockReset();
    readCredentialsMock.mockReturnValue(null);
  });

  it("retorna credenciais com cscId e cscToken quando a Edge Function responde com sucesso", async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: { pfxBase64: Buffer.from("pfx-bytes").toString("base64"), password: "senha123", cscId: "5", cscToken: "token-csc" },
      error: null,
    });

    const result = await buscarCredenciaisFiscais(fakeSupabase(invoke), "unit-1");

    expect(invoke).toHaveBeenCalledWith("nfse-certificate-fetch", { body: { unitId: "unit-1" } });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.credenciais.password).toBe("senha123");
      expect(result.credenciais.cscId).toBe("5");
      expect(result.credenciais.cscToken).toBe("token-csc");
      expect(result.credenciais.pfxBuffer.toString()).toBe("pfx-bytes");
    }
  });

  it("retorna credenciais com cscId/cscToken null quando a unidade não tem CSC configurado na nuvem", async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: { pfxBase64: Buffer.from("pfx-bytes").toString("base64"), password: "senha123", cscId: null, cscToken: null },
      error: null,
    });

    const result = await buscarCredenciaisFiscais(fakeSupabase(invoke), "unit-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.credenciais.cscId).toBeNull();
      expect(result.credenciais.cscToken).toBeNull();
    }
  });

  it("produz um motivo legível a partir de um corpo de erro JSON", async () => {
    const response = new Response(JSON.stringify({ error: "certificado vencido" }), { status: 400 });
    const invoke = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "Edge Function returned a non-2xx status code", context: response },
    });

    const result = await buscarCredenciaisFiscais(fakeSupabase(invoke), "unit-1");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.motivo).toBe("Certificado A1 não disponível: certificado vencido");
    }
  });

  it("produz um motivo legível a partir de um corpo de erro não-JSON", async () => {
    const response = new Response("Internal Server Error", { status: 500 });
    const invoke = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "Edge Function returned a non-2xx status code", context: response },
    });

    const result = await buscarCredenciaisFiscais(fakeSupabase(invoke), "unit-1");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.motivo).toContain("HTTP 500");
      expect(result.motivo).toContain("Internal Server Error");
    }
  });

  it("acrescenta uma dica sobre a chave do terminal quando o motivo é 'não autorizado'", async () => {
    const response = new Response(JSON.stringify({ error: "não autorizado" }), { status: 401 });
    const invoke = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "Edge Function returned a non-2xx status code", context: response },
    });

    const result = await buscarCredenciaisFiscais(fakeSupabase(invoke), "unit-1");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.motivo).toContain("Certificado A1 não disponível: não autorizado");
      expect(result.motivo).toContain("FACAAMIGOS_SUPABASE_SECRET_KEY");
    }
  });

  it("usa o cofre local (readCredentials) e nunca chama a Edge Function quando há credenciais no disco", async () => {
    readCredentialsMock.mockReturnValue({
      pfxBuffer: Buffer.from("pfx-local"),
      password: "senha-local",
      cscToken: "token-local",
    });
    const invoke = vi.fn();

    const result = await buscarCredenciaisFiscais(fakeSupabase(invoke), "unit-1", {
      userDataPath: "/fake/path",
      crypto: { encrypt: (s: string) => Buffer.from(s), decrypt: (b: Buffer) => b.toString() },
    });

    expect(invoke).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.credenciais.password).toBe("senha-local");
      expect(result.credenciais.cscToken).toBe("token-local");
      expect(result.credenciais.cscId).toBeNull();
    }
  });
});

/**
 * Regressão do bug que parou a emissão fiscal por dias.
 *
 * Em @supabase/supabase-js 2.112.1, `functions.invoke` envia
 * `apikey: <secretKey>` mas deriva o bearer da sessão do usuário. Num
 * worker headless não há sessão, e o header vai literalmente como
 * `Authorization: undefined` — a Edge Function compara "undefined" com o
 * segredo e responde 401 "não autorizado".
 *
 * Medido em 2026-09-02 com a MESMA chave: `fetch` cru devolveu 200 e
 * `functions.invoke` devolveu 401. O comentário do código afirmava que o
 * invoke mandava a chave sozinho e que um header manual quebraria a
 * autorização — o oposto da verdade.
 *
 * Por isso o cliente do worker precisa nascer com o Authorization em
 * `global.headers`. Se alguém tirar essa linha achando que é redundante,
 * a emissão volta a falhar com um erro que aponta para o certificado.
 */
describe("cliente do worker fiscal", () => {
  it("cria o Supabase client com Authorization explícito em global.headers", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(join(import.meta.dirname, "../src/fiscal/index.ts"), "utf-8");

    expect(source).toMatch(/global:\s*\{\s*headers:\s*\{\s*Authorization:\s*`Bearer \$\{secretKey\}`/);
  });
});
