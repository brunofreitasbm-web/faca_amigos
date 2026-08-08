import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { uuidv7 } from "@facaamigos/db-local";

export interface SangriaItem {
  id: string;
  shift_id?: string;
  unit_id: string;
  amount_cents: number;
  reason: string;
  envelope_number?: string;
  employee_id: string;
  employee_name: string;
  created_at_ms: number;
}

export interface FaBonificacaoDiaria {
  id: string;
  unit_id: string;
  employee_name: string;
  business_date: string;
  locacoes_count: number;
  vendas_30m: number;
  vendas_1h: number;
  vendas_2h: number;
  created_at_ms: number;
}

const sangriasStore: SangriaItem[] = [];
const bonificacaoStore: Map<string, FaBonificacaoDiaria> = new Map();

export function registerCaixaFaRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get<{ Querystring: { unitId?: string; shiftId?: string } }>("/api/caixa/sangrias", async (req) => {
    const { unitId, shiftId } = req.query;
    let list = sangriasStore;
    if (unitId) list = list.filter((s) => s.unit_id === unitId);
    if (shiftId) list = list.filter((s) => s.shift_id === shiftId);
    return { items: list };
  });

  app.post<{ Body: Partial<SangriaItem> }>("/api/caixa/sangrias", async (req) => {
    const b = req.body;
    if (!b.amount_cents || b.amount_cents <= 0) {
      return { error: "Valor da sangria é obrigatório e deve ser maior que zero." };
    }

    const item: SangriaItem = {
      id: uuidv7(),
      shift_id: b.shift_id,
      unit_id: b.unit_id || "loja",
      amount_cents: b.amount_cents,
      reason: b.reason || "Retirada de caixa",
      envelope_number: b.envelope_number || "",
      employee_id: b.employee_id || "emp_1",
      employee_name: b.employee_name || "Operador",
      created_at_ms: ctx.nowMs(),
    };

    sangriasStore.unshift(item);
    return { success: true, item };
  });

  app.get<{ Querystring: { unitId?: string; competencia?: string } }>("/api/caixa/bonificacao-diaria", async (req) => {
    const { unitId, competencia } = req.query;
    let list = Array.from(bonificacaoStore.values());
    if (unitId) list = list.filter((b) => b.unit_id === unitId);
    if (competencia) list = list.filter((b) => b.business_date.startsWith(competencia));

    return { items: list };
  });

  app.post<{ Body: Partial<FaBonificacaoDiaria> }>("/api/caixa/bonificacao-diaria", async (req) => {
    const b = req.body;
    const dateStr: string = b.business_date || new Date().toISOString().split("T")[0] || "2026-08-08";
    const empName: string = b.employee_name || "Operador";
    const unitId: string = b.unit_id || "loja";
    const id = `${empName}_${unitId}_${dateStr}`;

    const item: FaBonificacaoDiaria = {
      id,
      unit_id: unitId,
      employee_name: empName,
      business_date: dateStr,
      locacoes_count: b.locacoes_count || 0,
      vendas_30m: b.vendas_30m || 0,
      vendas_1h: b.vendas_1h || 0,
      vendas_2h: b.vendas_2h || 0,
      created_at_ms: ctx.nowMs(),
    };

    bonificacaoStore.set(id, item);
    return { success: true, item };
  });
}
