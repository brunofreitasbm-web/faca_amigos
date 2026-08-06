import { describe, expect, it } from "vitest";
import { checkinRequestSchema } from "../src/checkin.js";

describe("checkinRequestSchema", () => {
  const base = {
    activityCode: "PLAYGROUND" as const,
    child: {
      fullName: "Helena Souza",
      birthDate: "2019-04-12",
      inclusiveEligible: false,
    },
    guardian: {
      fullName: "Ana Souza",
      phoneE164: "+5591982501215",
    },
    consents: [{ purpose: "TERMO_USO" as const, granted: true, termsVersion: 1 }],
    requestedMinutes: 30,
    idempotencyKey: "018f2c1e-0000-7000-8000-000000000001",
  };

  it("aceita um check-in mínimo válido", () => {
    expect(checkinRequestSchema.safeParse(base).success).toBe(true);
  });

  it("normaliza telefone brasileiro de 11 dígitos sem +55", () => {
    const result = checkinRequestSchema.safeParse({
      ...base,
      guardian: { ...base.guardian, phoneE164: "91982501215" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.guardian.phoneE164).toBe("+5591982501215");
    }
  });

  it("rejeita telefone com número de dígitos inválido", () => {
    const result = checkinRequestSchema.safeParse({
      ...base,
      guardian: { ...base.guardian, phoneE164: "123" },
    });
    expect(result.success).toBe(false);
  });

  it("aceita requestedMinutes nulo para Day Use", () => {
    const result = checkinRequestSchema.safeParse({ ...base, requestedMinutes: null });
    expect(result.success).toBe(true);
  });

  it("exige ao menos um consentimento", () => {
    const result = checkinRequestSchema.safeParse({ ...base, consents: [] });
    expect(result.success).toBe(false);
  });
});
