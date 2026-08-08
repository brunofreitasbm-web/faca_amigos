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
  status: "PENDENTE" | "CONTATADO" | "SATISFEITO" | "INSATISFEITO";
  notes?: string;
  updated_at_ms: number;
}

const posVisitaStore: Map<string, PosVisitaItem> = new Map();

const POS_VISITA_TEMPLATES = [
  {
    id: "padrao_agradecimento",
    title: "Agradecimento Padrão",
    message: "Olá {responsavel}! Tudo bem? Agradecemos muito a visita do(a) {crianca} no Faça Amigos! Como foi a experiência de vocês hoje? Se puder nos dar um feedback, ficaremos muito felizes! 😊🎈",
  },
  {
    id: "retorno_convite",
    title: "Convite de Retorno",
    message: "Olá {responsavel}! Sentimos falta do(a) {crianca} aqui no Faça Amigos! Que tal nos fazer uma visita neste final de semana? Temos novidades te esperando! 🎠🍿",
  },
  {
    id: "pesquisa_satisfacao",
    title: "Pesquisa de Satisfação",
    message: "Olá {responsavel}! Sua opinião é essencial para nós. De 0 a 10, como você avalia o atendimento e a segurança do Faça Amigos na sua última visita com o(a) {crianca}? 🌟",
  },
];

export function registerPosVisitaRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get<{ Querystring: { unitId?: string } }>("/api/pos-visita", async (req) => {
    const unitId = req.query.unitId;

    try {
      const rows = ctx.db
        .prepare(
          `SELECT g.id as g_id, g.full_name as guardian_name, g.phone_e164, c.full_name as child_name,
                  MAX(vl.at_ms) as last_visit_ms
           FROM guardians g
           JOIN child_guardians cg ON cg.guardian_id = g.id
           JOIN children c ON c.id = cg.child_id
           LEFT JOIN visit_log vl ON vl.child_id = c.id
           GROUP BY g.id, c.id
           ORDER BY last_visit_ms DESC
           LIMIT 50`
        )
        .all() as Array<{ g_id: string; guardian_name: string; phone_e164: string; child_name: string; last_visit_ms: number | null }>;

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
}
