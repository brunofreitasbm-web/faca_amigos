import type { FastifyInstance } from "fastify";
import {
  listUnits,
  listPlans,
  insertPlan,
  listProducts,
  insertProduct,
  listAssets,
  insertAsset,
  listCoupons,
  insertCoupon,
  listActiveLoyaltyRules,
  insertLoyaltyRule,
  listEmployees,
  insertEmployee,
  upsertLocalCredentials,
  searchChildrenByNameOrPhone,
  setAssetStatus,
  setEmployeeActive,
  setPlanActive,
  uuidv7,
} from "@facaamigos/db-local";
import type { AppContext } from "../context.js";
import {
  createAssetSchema,
  createCouponSchema,
  createEmployeeSchema,
  createLoyaltyRuleSchema,
  createPlanSchema,
  createProductSchema,
  setAssetStatusSchema,
} from "../schemas.js";
import { parseBody } from "../validate.js";
import { hashPin } from "../security/pin.js";

export function registerCatalogRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/units", async () => listUnits(ctx.db));

  app.get<{ Querystring: { unitId: string; activity?: "PLAYGROUND" | "CARRINHO" } }>("/api/plans", async (req) =>
    listPlans(ctx.db, req.query.unitId, req.query.activity),
  );
  app.post("/api/plans", async (req, reply) => {
    const body = parseBody(createPlanSchema, req.body);
    const id = uuidv7(ctx.nowMs());
    insertPlan(ctx.db, body.unitId, { id, ...body }, ctx.nowMs());
    return reply.code(201).send({ id });
  });

  app.get<{ Querystring: { unitId: string } }>("/api/products", async (req) => listProducts(ctx.db, req.query.unitId, { activeOnly: true }));
  app.post("/api/products", async (req, reply) => {
    const body = parseBody(createProductSchema, req.body);
    const id = uuidv7(ctx.nowMs());
    insertProduct(
      ctx.db,
      { id, unit_id: body.unitId, name: body.name, description: body.description ?? null, emoji: body.emoji ?? null, price_cents: body.priceCents, stock: body.stock },
      ctx.nowMs(),
    );
    return reply.code(201).send({ id });
  });

  app.get<{ Querystring: { unitId: string } }>("/api/assets", async (req) => listAssets(ctx.db, req.query.unitId));
  app.post("/api/assets", async (req, reply) => {
    const body = parseBody(createAssetSchema, req.body);
    const id = uuidv7(ctx.nowMs());
    insertAsset(
      ctx.db,
      { id, unit_id: body.unitId, name: body.name, emoji: body.emoji, color: body.color, maintenance_threshold_hours: body.maintenanceThresholdHours },
      ctx.nowMs(),
    );
    return reply.code(201).send({ id });
  });
  // Gatilho de manutenção (seção do plano) sinaliza sozinho; isto é a via manual do gerente para reverter/forçar o status.
  app.patch<{ Params: { id: string } }>("/api/assets/:id/status", async (req, reply) => {
    const body = parseBody(setAssetStatusSchema, req.body);
    setAssetStatus(ctx.db, req.params.id, body.status);
    return reply.code(200).send({ ok: true });
  });

  app.get<{ Querystring: { unitId: string } }>("/api/coupons", async (req) => listCoupons(ctx.db, req.query.unitId));
  app.post("/api/coupons", async (req, reply) => {
    const body = parseBody(createCouponSchema, req.body);
    const id = uuidv7(ctx.nowMs());
    insertCoupon(
      ctx.db,
      { id, unit_id: body.unitId, code: body.code, kind: body.kind, value: body.value, max_uses: body.maxUses, description: body.description ?? null },
      ctx.nowMs(),
    );
    return reply.code(201).send({ id });
  });

  app.get<{ Querystring: { unitId: string } }>("/api/loyalty-rules", async (req) => listActiveLoyaltyRules(ctx.db, req.query.unitId));
  app.post("/api/loyalty-rules", async (req, reply) => {
    const body = parseBody(createLoyaltyRuleSchema, req.body);
    const id = uuidv7(ctx.nowMs());
    insertLoyaltyRule(
      ctx.db,
      { id, unit_id: body.unitId, activity: body.activity, trigger_visits: body.triggerVisits, reward_kind: body.rewardKind, reward_value: body.rewardValue },
      ctx.nowMs(),
    );
    return reply.code(201).send({ id });
  });

  app.get("/api/employees", async () => listEmployees(ctx.db, { activeOnly: true }));
  app.post("/api/employees", async (req, reply) => {
    const body = parseBody(createEmployeeSchema, req.body);
    const id = uuidv7(ctx.nowMs());
    insertEmployee(ctx.db, { id, full_name: body.fullName, role: body.role, pis: body.pis ?? null, cpf_last4: body.cpfLast4 ?? null }, ctx.nowMs());
    upsertLocalCredentials(ctx.db, id, hashPin(body.pin), ctx.nowMs());
    return reply.code(201).send({ id });
  });
  app.patch<{ Params: { id: string }; Body: { active: boolean } }>("/api/employees/:id/active", async (req, reply) => {
    setEmployeeActive(ctx.db, req.params.id, req.body.active);
    return reply.code(200).send({ ok: true });
  });

  app.patch<{ Params: { id: string }; Body: { active: boolean } }>("/api/plans/:id/active", async (req, reply) => {
    setPlanActive(ctx.db, req.params.id, req.body.active);
    return reply.code(200).send({ ok: true });
  });

  // Autocomplete ao vivo na Entrada — digitar o mínimo possível (princípio de produto do protótipo).
  app.get<{ Querystring: { q: string } }>("/api/children/search", async (req) => {
    if (!req.query.q || req.query.q.length < 2) return [];
    return searchChildrenByNameOrPhone(ctx.db, req.query.q);
  });
}
