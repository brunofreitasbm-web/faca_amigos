import type { FastifyInstance } from "fastify";
import { quoteForSession } from "@facaamigos/domain";
import { listActiveSessions, getPlan, listRedeemableRewards } from "@facaamigos/db-local";
import type { AppContext } from "../context.js";

export function registerSessionRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get<{ Querystring: { unitId: string } }>("/api/sessions/active", async (req) => {
    const nowMs = ctx.nowMs();
    return listActiveSessions(ctx.db, req.query.unitId).map((session) => {
      const plan = getPlan(ctx.db, session.plan_id)!;
      const quote = quoteForSession(
        plan,
        {
          checkinAtMs: session.checkin_at_ms,
          childName: session.child_name_snapshot,
          planId: session.plan_id,
          couponDiscountCents: session.coupon_discount_cents,
          couponCode: null,
          freeFromLoyalty: Boolean(session.free_from_loyalty),
        },
        nowMs,
      );
      return { session, quote };
    });
  });

  app.get<{ Params: { childId: string } }>("/api/children/:childId/redeemable-rewards", async (req) =>
    listRedeemableRewards(ctx.db, req.params.childId),
  );
}
