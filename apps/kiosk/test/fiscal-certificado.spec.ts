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
