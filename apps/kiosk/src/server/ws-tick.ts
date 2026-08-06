import type { FastifyInstance } from "fastify";
import { computeSessionTiming } from "@facaamigos/domain";
import { listActiveSessions, getPlan } from "@facaamigos/db-local";
import type { AppContext } from "./context.js";

/**
 * TickEngine (seção 1.3/5.5 do plano): 1 Hz, canal por unidade. O
 * cliente renderiza a partir de `serverNowMs` no frame — nunca do
 * próprio relógio, para o painel nunca divergir entre dois tablets.
 */
export function registerTickChannel(app: FastifyInstance, ctx: AppContext): void {
  app.get("/ws/units/:unitId", { websocket: true }, (socket, req) => {
    const { unitId } = req.params as { unitId: string };

    const interval = setInterval(() => {
      const nowMs = ctx.nowMs();
      const sessions = listActiveSessions(ctx.db, unitId).map((session) => {
        const plan = getPlan(ctx.db, session.plan_id)!;
        const timing = computeSessionTiming(plan, { checkinAtMs: session.checkin_at_ms }, nowMs);
        return {
          id: session.id,
          remainingMs: timing.durationMs - timing.elapsedMs,
          phase: timing.phase,
          billedFractionIndex: timing.overMinutes,
        };
      });
      socket.send(JSON.stringify({ serverNowMs: nowMs, sessions }));
    }, 1000);

    socket.on("close", () => clearInterval(interval));
  });
}
