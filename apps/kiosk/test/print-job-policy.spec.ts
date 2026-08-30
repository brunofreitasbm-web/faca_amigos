import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, migrate, setTerminalSetting, type Db } from "@facaamigos/db-local";
import { getTerminalUnitIds, shouldConsiderJob, resolvePrinterName, isRetryableClaim, MAX_CLAIM_ATTEMPTS } from "../src/main/printJobPolicy.js";

const CIRCUITO = "e43ba7a8-bd5f-47ad-b81d-dae7ea19d504";
const PLAYGROUND = "11111111-1111-1111-1111-111111111111";

let db: Db;
const envBackup = { unit: process.env.FACAAMIGOS_UNIT_ID, unitAlt: process.env.UNIT_ID };

beforeEach(() => {
  delete process.env.FACAAMIGOS_UNIT_ID;
  delete process.env.UNIT_ID;
  db = openDatabase(":memory:");
  migrate(db);
});

afterEach(() => {
  if (envBackup.unit === undefined) delete process.env.FACAAMIGOS_UNIT_ID;
  else process.env.FACAAMIGOS_UNIT_ID = envBackup.unit;
  if (envBackup.unitAlt === undefined) delete process.env.UNIT_ID;
  else process.env.UNIT_ID = envBackup.unitAlt;
});

describe("getTerminalUnitIds", () => {
  it("é vazio num terminal recém-instalado", () => {
    expect(getTerminalUnitIds(db).size).toBe(0);
  });

  it("lê a unidade amarrada em terminal_settings, normalizada em minúsculas", () => {
    setTerminalSetting(db, "terminal_unit_id", CIRCUITO.toUpperCase(), Date.now());
    expect(Array.from(getTerminalUnitIds(db))).toEqual([CIRCUITO]);
  });

  it("aceita lista separada por vírgula e junta com a variável de ambiente", () => {
    setTerminalSetting(db, "terminal_unit_id", `${CIRCUITO}, ${PLAYGROUND}`, Date.now());
    process.env.FACAAMIGOS_UNIT_ID = "5fc99a57-81ee-4232-a105-1fcb4634cef4";
    expect(getTerminalUnitIds(db).size).toBe(3);
    expect(getTerminalUnitIds(db).has(PLAYGROUND)).toBe(true);
  });
});

describe("shouldConsiderJob", () => {
  const job = { id: "job-1", unit_id: PLAYGROUND };

  it("REGRESSÃO: terminal sem unidade amarrada recusa job de qualquer unidade", () => {
    // Era exatamente aqui que a impressão de uma unidade saía na outra: a
    // guarda antiga (`size > 0 && !has(...)`) tratava conjunto vazio como
    // "aceita tudo", e nenhum dos dois computadores estava amarrado.
    const decision = shouldConsiderJob({ job, allowedUnits: new Set(), deviceId: "dev-a" });
    expect(decision.accept).toBe(false);
    expect(decision.reason).toContain("sem unidade amarrada");
  });

  it("recusa job de outra unidade", () => {
    const decision = shouldConsiderJob({ job, allowedUnits: new Set([CIRCUITO]), deviceId: "dev-a" });
    expect(decision.accept).toBe(false);
  });

  it("aceita job da própria unidade", () => {
    expect(shouldConsiderJob({ job, allowedUnits: new Set([PLAYGROUND]), deviceId: "dev-a" }).accept).toBe(true);
  });

  it("compara a unidade sem depender de maiúsculas/minúsculas", () => {
    const upper = { id: "job-2", unit_id: PLAYGROUND.toUpperCase() };
    expect(shouldConsiderJob({ job: upper, allowedUnits: new Set([PLAYGROUND]), deviceId: "dev-a" }).accept).toBe(true);
  });

  it("recusa quando o terminal não tem device_id (não conseguiria reservar o job)", () => {
    expect(shouldConsiderJob({ job, allowedUnits: new Set([PLAYGROUND]), deviceId: null }).accept).toBe(false);
  });
});

describe("resolvePrinterName", () => {
  it("prefere o nome exato quando há um parecido instalado", () => {
    expect(resolvePrinterName("POS-80", ["POS-80 (Cópia 1)", "POS-80"]).name).toBe("POS-80");
  });

  it("casa ignorando maiúsculas e espaços repetidos", () => {
    expect(resolvePrinterName("pos-80  c", ["POS-80 C"]).name).toBe("POS-80 C");
  });

  it("recusa nome ambíguo em vez de escolher a impressora errada", () => {
    // Com as duas unidades usando o mesmo modelo térmico, o match por
    // substring dos dois lados fazia o job da unidade errada achar
    // impressora e imprimir.
    const match = resolvePrinterName("POS-80", ["POS-80 (Cópia 1)", "POS-80 (Cópia 2)"]);
    expect(match.name).toBeNull();
    expect(match.warning).toContain("ambíguo");
  });

  it("devolve null quando a impressora configurada não existe e há mais de uma física conectada", () => {
    expect(resolvePrinterName("Gainscha X", ["Gainscha Y", "Gainscha Z", "Microsoft Print to PDF"]).name).toBeNull();
  });

  it("recupera automaticamente usando a única impressora física conectada se a configurada tiver nome divergente", () => {
    const match = resolvePrinterName("POS-80 Genérica", ["Thermal Printer POS-80", "Microsoft Print to PDF"]);
    expect(match.name).toBe("Thermal Printer POS-80");
    expect(match.warning).toContain("única impressora física instalada");
  });

  it("sem configuração, cai na primeira impressora física e avisa", () => {
    const match = resolvePrinterName("", ["Microsoft Print to PDF", "POS-80"]);
    expect(match.name).toBe("POS-80");
    expect(match.warning).toContain("Nenhuma impressora configurada");
  });

  it("sem nenhuma impressora instalada, devolve null", () => {
    expect(resolvePrinterName("", []).name).toBeNull();
  });
});

describe("isRetryableClaim", () => {
  it("fail-closed quando claim_attempts não veio do RPC: finaliza em vez de arriscar loop", () => {
    expect(isRetryableClaim({})).toBe(false);
  });

  it("é retryable abaixo do limite de tentativas", () => {
    expect(isRetryableClaim({ claim_attempts: 1 })).toBe(true);
  });

  it("não é mais retryable ao atingir o limite (evita ping-pong infinito entre dois terminais sem impressora)", () => {
    expect(isRetryableClaim({ claim_attempts: MAX_CLAIM_ATTEMPTS })).toBe(false);
  });
});
