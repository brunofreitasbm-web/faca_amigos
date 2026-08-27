import { describe, expect, it, vi } from "vitest";
import { runFiscalClaimOnce } from "../src/fiscal/claim.js";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("runFiscalClaimOnce (Modo SIMULADO)", () => {
  it("processa e autoriza documento na fila em modo SIMULADO", async () => {
    const updateEqMock = vi.fn().mockResolvedValue({ data: null, error: null });
    const updateMock = vi.fn().mockReturnValue({ eq: updateEqMock });
    const fromMock = vi.fn().mockReturnValue({ update: updateMock });

    const claimedDoc = {
      doc: {
        id: "doc-12345",
        docType: "NFCE",
        environment: "HOMOLOGACAO" as const,
        status: "PENDENTE",
        emissionType: "NORMAL",
        serie: "1",
        numero: 100,
        accessKey: null,
        attempts: 0,
        totalCents: 5000,
      },
      order: { id: "order-1", orderCode: "FA-001", businessDate: "2026-08-27" },
      unit: { id: "unit-1", cnpj: "12345678000199" },
      items: [{ description: "Café Expresso", quantity: 1, unitPriceCents: 5000, totalCents: 5000 }],
      payments: [{ method: "PIX", amountCents: 5000 }],
    };

    const rpcMock = vi.fn().mockResolvedValue({
      data: [claimedDoc],
      error: null,
    });

    const fakeSupabase = {
      rpc: rpcMock,
      from: fromMock,
    } as unknown as SupabaseClient;

    const logs: string[] = [];
    const count = await runFiscalClaimOnce({
      supabase: fakeSupabase,
      terminalId: "test-terminal-01",
      simulado: true,
      onLog: (msg) => logs.push(msg),
    });

    expect(count).toBe(1);
    expect(rpcMock).toHaveBeenCalledWith("fa_fiscal_claim_next", {
      p_terminal_id: "test-terminal-01",
      p_limit: 5,
    });

    expect(fromMock).toHaveBeenCalledWith("fa_kiosk_fiscal_docs");
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "AUTORIZADO",
        serie: "1",
        numero: 100,
      })
    );
    expect(updateEqMock).toHaveBeenCalledWith("id", "doc-12345");
    expect(logs.some((l) => l.includes("autorizado (SIMULADO)"))).toBe(true);
  });

  it("trata falha de rpc graciosamente retornando 0", async () => {
    const rpcMock = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "Erro de banco de dados" },
    });

    const fakeSupabase = {
      rpc: rpcMock,
    } as unknown as SupabaseClient;

    const logs: string[] = [];
    const count = await runFiscalClaimOnce({
      supabase: fakeSupabase,
      terminalId: "test-terminal-01",
      simulado: true,
      onLog: (msg) => logs.push(msg),
    });

    expect(count).toBe(0);
    expect(logs.some((l) => l.includes("fa_fiscal_claim_next falhou"))).toBe(true);
  });
});
