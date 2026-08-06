import type { FastifyInstance } from "fastify";
import { salesByDay, revenueByMethod, visitsByDay, childrenBirthdaysInMonth, shiftHistory, folhaPonto } from "@facaamigos/db-local";
import type { AppContext } from "../context.js";

export function registerReportRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get<{ Querystring: { unitId: string; from: string; to: string } }>("/api/reports/sales", async (req) => ({
    byDay: salesByDay(ctx.db, req.query.unitId, req.query.from, req.query.to),
    byMethod: revenueByMethod(ctx.db, req.query.unitId, req.query.from, req.query.to),
  }));

  app.get<{ Querystring: { unitId: string; from: string; to: string } }>("/api/reports/visits", async (req) =>
    visitsByDay(ctx.db, req.query.unitId, req.query.from, req.query.to),
  );

  app.get<{ Querystring: { month: string } }>("/api/reports/birthdays", async (req) =>
    childrenBirthdaysInMonth(ctx.db, Number(req.query.month)),
  );

  app.get<{ Querystring: { unitId: string } }>("/api/reports/shifts", async (req) => shiftHistory(ctx.db, req.query.unitId));

  app.get<{ Querystring: { fromMs: string; toMs: string } }>("/api/reports/ponto", async (req) =>
    folhaPonto(ctx.db, Number(req.query.fromMs), Number(req.query.toMs)),
  );
}
