import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateShoppingRequest, createServiceClient, getShoppingUnitMetadata } from "../../../_shopping/common.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const supabase = createServiceClient();
  const authUnit = await authenticateShoppingRequest(supabase, req, res);
  if (!authUnit) return;

  const { de, ate, unitId } = req.query as { de?: string; ate?: string; unitId?: string };

  if (!de || !ate) {
    return res.status(400).json({ error: "PARAMETROS_INVALIDOS", message: "Parâmetros 'de' e 'ate' são obrigatórios" });
  }

  const targetUnitId = unitId || authUnit.id;
  const unitRow =
    targetUnitId === authUnit.id
      ? authUnit
      : ((await supabase.from("fa_kiosk_units").select("id, kind, name, cnpj, razao_social, timezone").eq("id", targetUnitId).single()).data as any) ||
        authUnit;
  const unitMeta = getShoppingUnitMetadata(unitRow);

  const { data, error } = await supabase
    .from("fa_kiosk_orders")
    .select("id, created_at, closed_at_ms, total_cents, status")
    .eq("unit_id", targetUnitId)
    .gte("business_date", de)
    .lte("business_date", ate)
    .in("status", ["PAGA", "CANCELADA"])
    .order("created_at", { ascending: true });

  if (error) {
    return res.status(500).json({ error: "ERRO_CONSULTA", message: "Falha ao consultar vendas." });
  }

  const orders = (data || []) as { id: string; created_at: string; closed_at_ms: number | null; total_cents: number; status: string }[];

  const vendas = orders.map((o) => ({
    idVenda: o.id,
    dataHora: new Date(o.closed_at_ms ?? o.created_at).toISOString(),
    valorCentavos: o.total_cents,
    cancelado: o.status === "CANCELADA",
    troca: false,
  }));

  const totalVendas = vendas.filter((v) => !v.cancelado).length;
  const brutoCentavos = vendas.filter((v) => !v.cancelado).reduce((acc, v) => acc + v.valorCentavos, 0);

  return res.status(200).json({
    layoutVersao: "1.0",
    loja: {
      unidadeId: unitMeta.unidadeId,
      nome: unitMeta.nome,
      cnpj: unitMeta.cnpj,
      luc: unitMeta.luc,
      codigoLojista: unitMeta.codigoLojista,
    },
    periodo: {
      dataInicial: de,
      dataFinal: ate,
      totalVendas,
      brutoCentavos,
    },
    vendas,
    geradoEmMs: Date.now(),
  });
}
