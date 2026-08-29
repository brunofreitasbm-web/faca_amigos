import { describe, expect, it, vi } from "vitest";
import { claimPrintJobs, claimPrintJob, CLAIM_BATCH_LIMIT } from "../src/main/printJobPolicy.js";

const CIRCUITO = "e43ba7a8-bd5f-47ad-b81d-dae7ea19d504";
const job = { id: "job-1", unit_id: CIRCUITO, kind: "RECEIPT" as const, payload_json: {} };

function fakeClient(result: { data: unknown; error: { message: string } | null }) {
  return { rpc: vi.fn().mockResolvedValue(result) };
}

describe("reserva de jobs de impressão", () => {
  it("envia device, unidades e limite para a RPC de lote", async () => {
    const client = fakeClient({ data: [job], error: null });
    const jobs = await claimPrintJobs(client, [CIRCUITO], "dev-a");

    expect(jobs).toEqual([job]);
    expect(client.rpc).toHaveBeenCalledWith("fa_kiosk_claim_print_jobs", {
      p_device_id: "dev-a",
      p_unit_ids: [CIRCUITO],
      p_limit: CLAIM_BATCH_LIMIT,
    });
  });

  it("não chama a RPC quando o terminal não tem unidade amarrada", async () => {
    const client = fakeClient({ data: [job], error: null });
    expect(await claimPrintJobs(client, [], "dev-a")).toEqual([]);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("não chama a RPC quando o terminal não tem device_id", async () => {
    const client = fakeClient({ data: [job], error: null });
    expect(await claimPrintJobs(client, [CIRCUITO], null)).toEqual([]);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("devolve lista vazia quando a RPC falha, em vez de imprimir às cegas", async () => {
    const client = fakeClient({ data: null, error: { message: "timeout" } });
    expect(await claimPrintJobs(client, [CIRCUITO], "dev-a")).toEqual([]);
  });

  it("job único: devolve null quando outro terminal já reservou", async () => {
    const client = fakeClient({ data: null, error: null });
    expect(await claimPrintJob(client, "job-1", [CIRCUITO], "dev-b")).toBeNull();
  });

  it("REGRESSÃO: dois terminais no mesmo job — só o primeiro recebe o job para imprimir", async () => {
    // O Postgres resolve a corrida com `for update skip locked`; aqui o
    // que se garante é que o bridge respeita o resultado: quem não
    // reservou não imprime. Antes não havia reserva nenhuma — os dois
    // terminais imprimiam o mesmo job.
    const primeiro = fakeClient({ data: job, error: null });
    const segundo = fakeClient({ data: null, error: null });

    const a = await claimPrintJob(primeiro, "job-1", [CIRCUITO], "dev-a");
    const b = await claimPrintJob(segundo, "job-1", [CIRCUITO], "dev-b");

    expect(a).toEqual(job);
    expect(b).toBeNull();
  });
});
