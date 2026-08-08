import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { uuidv7 } from "@facaamigos/db-local";

export interface PosVisitaItem {
  id: string;
  unit_id: string;
  guardian_name: string;
  phone_e164: string;
  child_name: string;
  last_visit_date: string;
  last_visit_date: string;
  status: "PENDENTE" | "CONTATADO";
  notes?: string;
  updated_at_ms: number;
}

const posVisitaStore: Map<string, PosVisitaItem> = new Map();

const POS_VISITA_TEMPLATES = [
  {
    id: "padrao_agradecimento",
    title: "Agradecimento e Convite",
    message: "Olá {responsavel}! Tudo bem? 😊 Nós do Faça Amigos amamos receber a visita do(a) {crianca}!\n\nEsperamos que a experiência tenha sido incrível! Já estamos com saudades e preparamos muitas novidades divertidas para a próxima brincadeira! 🎈\n\n⭐ Avalie a gente com 5 estrelas no Google e garanta 10% de DESCONTO na sua próxima visita no Faça Amigos Circuito (válido por 7 dias)! \n👉 https://institutofacaamigos.com.br/playground/index.html\n\nTe esperamos em breve!",
  }
];

export function registerPosVisitaRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get<{ Querystring: { unitId?: string } }>("/api/pos-visita", async (req) => {
    const unitId = req.query.unitId;

    try {
      const rows = ctx.db
        .prepare(
          `SELECT g.id as g_id, g.full_name as guardian_name, g.phone_e164, c.full_name as child_name,
                  MAX(s.checkout_at_ms) as last_visit_ms
           FROM guardians g
           JOIN sessions s ON s.guardian_id = g.id
           JOIN children c ON c.id = s.child_id
           LEFT JOIN coupons cp ON cp.code = '5STARS_' || SUBSTR(UPPER(g.id), 1, 8)
           WHERE s.unit_id = ?
             AND s.status = 'FINALIZADA'
             AND s.checkout_at_ms IS NOT NULL
             AND cp.id IS NULL
           GROUP BY g.id, c.id
           ORDER BY last_visit_ms DESC
           LIMIT 50`
        )
        .all(unitId || "loja") as Array<{ g_id: string; guardian_name: string; phone_e164: string; child_name: string; last_visit_ms: number | null }>;

      const results: PosVisitaItem[] = rows.map((r) => {
        const id = `pv_${r.g_id}`;
        const existing = posVisitaStore.get(id);
        const lastVisitDate: string = r.last_visit_ms
          ? (new Date(r.last_visit_ms).toISOString().split("T")[0] as string)
          : (new Date().toISOString().split("T")[0] as string);

        if (existing) {
          return { ...existing, guardian_name: r.guardian_name, phone_e164: r.phone_e164, child_name: r.child_name };
        }

        const newItem: PosVisitaItem = {
          id,
          unit_id: unitId || "loja",
          guardian_name: r.guardian_name,
          phone_e164: r.phone_e164 || "",
          child_name: r.child_name,
          last_visit_date: lastVisitDate,
          status: "PENDENTE",
          notes: "",
          updated_at_ms: ctx.nowMs(),
        };
        posVisitaStore.set(id, newItem);
        return newItem;
      });

      return { items: Array.from(posVisitaStore.values()).length > 0 ? Array.from(posVisitaStore.values()) : results };
    } catch {
      return { items: Array.from(posVisitaStore.values()) };
    }
  });

  app.post<{ Body: Partial<PosVisitaItem> }>("/api/pos-visita", async (req) => {
    const body = req.body;
    const id = body.id || uuidv7();
    const existing = posVisitaStore.get(id);
    const todayStr: string = new Date().toISOString().split("T")[0] as string;

    const item: PosVisitaItem = {
      id,
      unit_id: body.unit_id || existing?.unit_id || "loja",
      guardian_name: body.guardian_name || existing?.guardian_name || "Cliente",
      phone_e164: body.phone_e164 || existing?.phone_e164 || "",
      child_name: body.child_name || existing?.child_name || "",
      last_visit_date: body.last_visit_date || existing?.last_visit_date || todayStr,
      status: body.status || existing?.status || "PENDENTE",
      notes: body.notes !== undefined ? body.notes : existing?.notes || "",
      updated_at_ms: ctx.nowMs(),
    };
    posVisitaStore.set(id, item);
    return { success: true, item };
  });

  app.get("/api/pos-visita/templates", async () => {
    return { templates: POS_VISITA_TEMPLATES };
  });

  app.post<{ Body: { guardian_id: string; unit_id?: string } }>("/api/pos-visita/google-review-callback", async (req) => {
    const { guardian_id, unit_id } = req.body;
    
    // Tenta encontrar o ID da unidade Circuito se não for provido
    let targetUnitId = unit_id;
    if (!targetUnitId) {
      const row = ctx.db.prepare("SELECT id FROM units WHERE name LIKE '%Circuito%' LIMIT 1").get() as { id: string } | undefined;
      targetUnitId = row?.id || "loja";
    }

    const couponId = uuidv7();
    const code = `5STARS_${guardian_id.substring(0, 8).toUpperCase()}`;

    try {
      ctx.db.prepare(`
        INSERT INTO coupons (
          id, unit_id, code, kind, value, max_uses, used_count, active, description, created_at_ms
        ) VALUES (?, ?, ?, 'DESCONTO_PCT', 10, 1, 0, 1, '10% desconto - 5 Avaliação Google', ?)
        ON CONFLICT(unit_id, code) DO UPDATE SET
          active = 1,
          value = 10,
          created_at_ms = excluded.created_at_ms
      `).run(couponId, targetUnitId, code, ctx.nowMs());

      return { success: true, message: "Cupom de 10% gerado com sucesso!", code };
    } catch (err) {
      app.log.error(err);
      return { success: false, error: "Erro ao gerar cupom" };
    }
  });
}
