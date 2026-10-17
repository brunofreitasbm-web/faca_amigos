import type { SupabaseClient } from "@supabase/supabase-js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpScope } from "./auth.js";

export const MAX_RANGE_DAYS = 366;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use o formato AAAA-MM-DD")
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), "Data inválida");

const unitId = z.string().uuid().optional().describe("ID da unidade (use listar_unidades). Omita para somar todas.");

const range = {
  inicio: isoDate.describe("Primeiro dia (business_date), AAAA-MM-DD, inclusive."),
  fim: isoDate.describe("Último dia (business_date), AAAA-MM-DD, inclusive."),
  unit_id: unitId,
};

export function validateRange(inicio: string, fim: string): string | null {
  const a = Date.parse(`${inicio}T00:00:00Z`);
  const b = Date.parse(`${fim}T00:00:00Z`);
  if (b < a) return "fim não pode ser anterior a inicio.";
  if ((b - a) / 86_400_000 + 1 > MAX_RANGE_DAYS) return `Intervalo máximo é de ${MAX_RANGE_DAYS} dias.`;
  return null;
}

/**
 * Unidades que a RPC pode enxergar: interseção entre o escopo da chave e o
 * unit_id pedido. Devolve erro se o pedido sair do escopo.
 */
export function resolveUnits(
  scope: McpScope,
  requested?: string,
): { ok: true; units: string[] | null } | { ok: false; error: string } {
  if (requested) {
    if (scope.unitIds && !scope.unitIds.includes(requested)) {
      return { ok: false, error: "unit_id fora do escopo desta chave." };
    }
    return { ok: true, units: [requested] };
  }
  return { ok: true, units: scope.unitIds };
}

/** Para cada campo *_cents, acrescenta *_reais — o modelo não precisa converter. */
export function addReais<T>(value: T): T {
  if (Array.isArray(value)) return value.map(addReais) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = addReais(v);
      if (k.endsWith("_cents") && typeof v === "number") out[k.replace(/_cents$/, "_reais")] = v / 100;
    }
    return out as T;
  }
  return value;
}

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };

const ok = (data: unknown): Result => ({
  content: [{ type: "text", text: JSON.stringify(addReais(data), null, 2) }],
});
const fail = (msg: string): Result => ({ content: [{ type: "text", text: msg }], isError: true });

export function registerTools(server: McpServer, supabase: SupabaseClient, scope: McpScope): void {
  async function call(rpc: string, args: Record<string, unknown>, unit_id?: string): Promise<Result> {
    const u = resolveUnits(scope, unit_id);
    if (!u.ok) return fail(u.error);
    const { data, error } = await supabase.rpc(rpc, { ...args, p_units: u.units });
    if (error) return fail(`Erro ao consultar dados (${rpc}).`);
    return ok(data);
  }

  async function ranged(rpc: string, a: { inicio: string; fim: string; unit_id?: string }): Promise<Result> {
    const err = validateRange(a.inicio, a.fim);
    if (err) return fail(err);
    return call(rpc, { p_inicio: a.inicio, p_fim: a.fim }, a.unit_id);
  }

  const readOnly = { readOnlyHint: true, openWorldHint: false } as const;

  server.registerTool(
    "listar_unidades",
    {
      description: "Lista as unidades do FaçaAmigos (Playground, Circuito etc.) com seus IDs. Use antes das outras tools para filtrar por unidade.",
      annotations: readOnly,
    },
    async () => call("fa_mcp_unidades", {}),
  );

  server.registerTool(
    "faturamento",
    {
      description:
        "Faturamento de pedidos PAGOS no período, por dia/unidade (sessões vs. PDV) e por forma de pagamento (DINHEIRO, PIX, CREDITO, DEBITO, VOUCHER). Datas são o dia de negócio (business_date). Valores em centavos e em reais.",
      inputSchema: range,
      annotations: readOnly,
    },
    async (a) => ranged("fa_mcp_faturamento", a),
  );

  server.registerTool(
    "sessoes",
    {
      description:
        "Check-ins no período: total, por atividade e plano (PLAYGROUND/CARRINHO), duração média em minutos, e distribuição por dia da semana (1=segunda..7=domingo) e por hora do check-in (America/Belem). Só contagens, sem dados de crianças.",
      inputSchema: range,
      annotations: readOnly,
    },
    async (a) => ranged("fa_mcp_sessoes", a),
  );

  server.registerTool(
    "ocupacao_agora",
    {
      description: "Quantas sessões estão ATIVAS ou AGUARDANDO_PAGAMENTO neste momento, por unidade e atividade.",
      inputSchema: { unit_id: unitId },
      annotations: readOnly,
    },
    async (a) => call("fa_mcp_ocupacao_agora", {}, a.unit_id),
  );

  server.registerTool(
    "caixa",
    {
      description:
        "Turnos de caixa no período: status, abertura, esperado vs. declarado (JSON por forma de pagamento, preenchido no fechamento), sangrias e suprimentos. Útil para achar divergências.",
      inputSchema: range,
      annotations: readOnly,
    },
    async (a) => ranged("fa_mcp_caixa", a),
  );

  server.registerTool(
    "produtos",
    {
      description: "Vendas de produtos do PDV no período (quantidade e valor por produto) e o estoque atual dos produtos ativos.",
      inputSchema: range,
      annotations: readOnly,
    },
    async (a) => ranged("fa_mcp_produtos", a),
  );

  server.registerTool(
    "metas",
    {
      description: "Meta diária de faturamento vs. realizado de um dia, por unidade.",
      inputSchema: { data: isoDate.describe("Dia de negócio, AAAA-MM-DD."), unit_id: unitId },
      annotations: readOnly,
    },
    async (a) => call("fa_mcp_metas", { p_data: a.data }, a.unit_id),
  );

  server.registerTool(
    "nps",
    {
      description:
        "NPS do período (respostas 0-10 recebidas por WhatsApp): total de respostas, promotores (9-10), neutros (7-8), detratores (0-6), NPS e médias de equipe/espaço (1-5). Não inclui comentários.",
      inputSchema: range,
      annotations: readOnly,
    },
    async (a) => ranged("fa_mcp_nps", a),
  );

  server.registerTool(
    "fidelidade",
    {
      description:
        "Pacotes de horas vendidos no período, saldo de créditos pré-pagos em aberto (agora) e uso de cupons / sessões grátis por fidelidade.",
      inputSchema: range,
      annotations: readOnly,
    },
    async (a) => ranged("fa_mcp_fidelidade", a),
  );
}
