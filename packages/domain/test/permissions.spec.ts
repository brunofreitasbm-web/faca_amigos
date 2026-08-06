import { describe, expect, it } from "vitest";
import { checkPermission } from "../src/rbac/permissions.js";

describe("checkPermission", () => {
  it("OPERADOR pode fazer check-in", () => {
    expect(checkPermission("session.checkin", "OPERADOR")).toEqual({ allowed: true, requiresStepUp: false });
  });

  it("OPERADOR não pode editar tabela de preços", () => {
    expect(checkPermission("price_table.edit", "OPERADOR")).toEqual({ allowed: false, requiresStepUp: false });
  });

  it("OPERADOR pode dar bypass de ticket mas precisa de step-up de gerente", () => {
    expect(checkPermission("session.checkout.bypass_ticket", "OPERADOR")).toEqual({
      allowed: true,
      requiresStepUp: true,
    });
  });

  it("GERENTE já satisfaz o próprio step-up de GERENTE", () => {
    expect(checkPermission("order.discount.manual", "GERENTE")).toEqual({ allowed: true, requiresStepUp: false });
  });

  it("OPERADOR com PIN de gerente (stepUpRole) confirma uma ação que já é permitida ao seu papel", () => {
    // bypass_ticket já libera OPERADOR na base — o PIN de gerente supre o step-up exigido.
    expect(checkPermission("session.checkout.bypass_ticket", "OPERADOR", "GERENTE")).toEqual({
      allowed: true,
      requiresStepUp: false,
    });
  });

  it("papel fora da lista de roles permanece negado mesmo com PIN de gerente", () => {
    // order.reverse não lista OPERADOR — step-up não é uma porta lateral para acesso indevido.
    expect(checkPermission("order.reverse", "OPERADOR", "GERENTE")).toEqual({ allowed: false, requiresStepUp: false });
  });

  it("ADMIN nunca precisa de step-up", () => {
    expect(checkPermission("order.reverse", "ADMIN")).toEqual({ allowed: true, requiresStepUp: false });
  });
});
