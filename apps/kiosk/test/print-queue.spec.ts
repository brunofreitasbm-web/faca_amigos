import { describe, expect, it, vi } from "vitest";
import { createPrintQueue } from "../src/main/printQueue.js";
import { classifyRawPrintOutput } from "../src/main/rawPrint.js";
import { isCircuitoReceipt } from "../src/main/printJobPolicy.js";

const quiet = { log: () => {} };

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe("fila de impressão", () => {
  it("serializa: nunca dois jobs imprimindo ao mesmo tempo", async () => {
    let active = 0;
    let maxActive = 0;
    const order: string[] = [];
    const q = createPrintQueue<{ id: string }>(async (j) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      order.push(j.id);
      active--;
    }, quiet);
    await Promise.all([q.enqueue({ id: "a" }), q.enqueue({ id: "b" }), q.enqueue({ id: "c" })]);
    expect(maxActive).toBe(1);
    expect(order).toEqual(["a", "b", "c"]);
  });

  it("dedupe: mesmo id enfileirado duas vezes imprime uma só vez (Realtime + sweep)", async () => {
    const handler = vi.fn(async () => {});
    const q = createPrintQueue<{ id: string }>(handler, quiet);
    const [x, y] = await Promise.all([q.enqueue({ id: "j1" }), q.enqueue({ id: "j1" })]);
    expect([x, y]).toEqual([true, false]);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("job devolvido a PENDING pela reserva stale e reservado de novo não reimprime", async () => {
    const handler = vi.fn(async () => {});
    const q = createPrintQueue<{ id: string }>(handler, quiet);
    await q.enqueue({ id: "j1" });
    expect(await q.enqueue({ id: "j1" })).toBe(false);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("job reenfileirado enquanto outro lote ainda imprime é descartado", async () => {
    const gate = deferred();
    const handler = vi.fn(async (j: { id: string }) => {
      if (j.id === "j1") await gate.promise;
    });
    const q = createPrintQueue<{ id: string }>(handler, quiet);
    const first = q.enqueue({ id: "j1" });
    expect(q.has("j1")).toBe(true);
    expect(await q.enqueue({ id: "j1" })).toBe(false);
    gate.resolve();
    await first;
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("falha do handler não trava a fila e o id continua marcado como tratado", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = vi.fn(async (j: { id: string }) => {
      if (j.id === "bad") throw new Error("boom");
    });
    const q = createPrintQueue<{ id: string }>(handler, quiet);
    await q.enqueue({ id: "bad" });
    await q.enqueue({ id: "ok" });
    expect(handler).toHaveBeenCalledTimes(2);
    expect(await q.enqueue({ id: "bad" })).toBe(false);
    spy.mockRestore();
  });

  it("'released' (devolvido a outro terminal) pode ser reservado de novo", async () => {
    const handler = vi.fn(async () => "released" as const);
    const q = createPrintQueue<{ id: string }>(handler, quiet);
    await q.enqueue({ id: "j1" });
    expect(await q.enqueue({ id: "j1" })).toBe(true);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("entradas antigas expiram (TTL)", async () => {
    let t = 0;
    const handler = vi.fn(async () => {});
    const q = createPrintQueue<{ id: string }>(handler, { ...quiet, now: () => t });
    await q.enqueue({ id: "j1" });
    t += 7 * 60 * 60 * 1000;
    expect(q.has("j1")).toBe(false);
  });
});

describe("classifyRawPrintOutput", () => {
  it("RESULT|0 => SENT", () => {
    expect(classifyRawPrintOutput("COMPILED\r\nRESULT|0|10|10|0\r\n", null).status).toBe("SENT");
  });
  it("falhas antes do WritePrinter => NOT_SENT (fallback seguro)", () => {
    for (const c of [1, 2, 3, 4]) {
      expect(classifyRawPrintOutput(`COMPILED\nRESULT|${c}|0|10|5`, null).status).toBe("NOT_SENT");
    }
  });
  it("WritePrinter falhou sem escrever nada => NOT_SENT; parcial => UNCERTAIN", () => {
    expect(classifyRawPrintOutput("COMPILED\nRESULT|5|0|10|5", null).status).toBe("NOT_SENT");
    expect(classifyRawPrintOutput("COMPILED\nRESULT|5|4|10|5", null).status).toBe("UNCERTAIN");
  });
  it("EndDoc falhou depois de escrever => UNCERTAIN (não duplicar)", () => {
    expect(classifyRawPrintOutput("COMPILED\nRESULT|6|10|10|0", null).status).toBe("UNCERTAIN");
  });
  it("timeout depois de compilar => UNCERTAIN; antes de compilar => NOT_SENT", () => {
    expect(classifyRawPrintOutput("COMPILED\n", { killed: true }).status).toBe("UNCERTAIN");
    expect(classifyRawPrintOutput("", { killed: true }).status).toBe("NOT_SENT");
  });
  it("Add-Type/powershell ausente => NOT_SENT", () => {
    expect(classifyRawPrintOutput("ERROR|compile", { code: 1 }).status).toBe("NOT_SENT");
    expect(classifyRawPrintOutput("", { code: "ENOENT", message: "spawn powershell.exe ENOENT" }).status).toBe("NOT_SENT");
  });
});

describe("isCircuitoReceipt", () => {
  const base = { accessCode: "ABC" };
  it("CARRINHO e assetName => termo", () => {
    expect(isCircuitoReceipt({ ...base, activity: "CARRINHO" })).toBe(true);
    expect(isCircuitoReceipt({ ...base, assetName: "Carro 3" })).toBe(true);
  });
  it("PLAYGROUND nunca, mesmo com unitName 'Circuito'", () => {
    expect(isCircuitoReceipt({ ...base, activity: "PLAYGROUND", unitName: "Circuito" })).toBe(false);
  });
  it("com activity definida o nome da unidade não decide", () => {
    expect(isCircuitoReceipt({ ...base, activity: "OUTRA", unitName: "Circuito" })).toBe(false);
  });
  it("legado sem activity: nome 'Circuito' ainda funciona; sem accessCode nunca", () => {
    expect(isCircuitoReceipt({ ...base, unitName: "FaçaAmigos Circuito" })).toBe(true);
    expect(isCircuitoReceipt({ activity: "CARRINHO" })).toBe(false);
  });
});
