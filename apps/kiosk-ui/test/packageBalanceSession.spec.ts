import { describe, expect, it } from "vitest";
import { computeActiveSessionEntries } from "../src/api/client.js";
import type { ActiveSessionsRaw, Plan } from "../src/api/client.js";

describe("computeActiveSessionEntries com saldo de pacote (Porto Seguro)", () => {
  const dummyPlan: Plan = {
    id: "plan-1h",
    activity: "PLAYGROUND",
    name: "1 hora",
    valueCents: 18000,
    durationValue: 60,
    durationUnit: "MINUTO",
    overageCentsPerMinute: 300,
    color: "#F0196B",
  };

  const raw: ActiveSessionsRaw = {
    sessions: [
      {
        id: "sess-1",
        child_id: "child-1",
        child_name_snapshot: "HELOISA MONTEIRO",
        guardian_id: "guardian-1",
        activity: "PLAYGROUND",
        plan_id: "plan-1h",
        checkin_at_ms: 100000,
        paused_ms_total: 0,
        wristband_code: "WB1",
        uses_hour_bank: false,
        uses_package: false,
        uses_child_credit: false,
        loyalty_courtesy_minutes: 0,
      },
    ],
    planById: new Map([["plan-1h", dummyPlan]]),
    guardianById: new Map([["guardian-1", { id: "guardian-1", full_name: "BRUNO MONTEIRO" }]]),
    assetById: new Map(),
    childById: new Map([["child-1", { id: "child-1", birth_date: "2024-02-05", inclusive_eligible: false }]]),
    packageBalanceByGuardian: new Map([["guardian-1", 514]]),
    clockOffsetMs: 0,
  };

  it("zera o valor base e aloca os minutos do saldo do pacote para a sessão", () => {
    // 40 minutos após o check-in (dentro dos 514 min do pacote)
    const nowMs = 100000 + 40 * 60 * 1000;
    const entries = computeActiveSessionEntries(raw, nowMs);

    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry.quote.plan.valueCents).toBe(0);
    expect(entry.quote.plan.durationValue).toBe(514);
    expect(entry.plan.name).toContain("Porto Seguro");
    expect(entry.quote.totalCents).toBe(0);
    expect(entry.checkoutQuote?.totalCents).toBe(0);
  });

  it("cobra apenas o excedente se o tempo ultrapassar o saldo do pacote", () => {
    // 520 minutos após o check-in (ultrapassou os 514 min do pacote em 6 min; 1 min tolerância = 5 min excedente)
    const nowMs = 100000 + 520 * 60 * 1000;
    const entries = computeActiveSessionEntries(raw, nowMs);

    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry.quote.plan.valueCents).toBe(0);
    // 5 min * 300 cents = 1500 cents (R$ 15,00)
    expect(entry.quote.totalCents).toBe(1500);
  });
});
