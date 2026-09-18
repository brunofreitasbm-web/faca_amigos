import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateShoppingRequest, createServiceClient, formatIsoTimezone, getShoppingUnitMetadata } from "../../../_shopping/common.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const supabase = createServiceClient();
  const authUnit = await authenticateShoppingRequest(supabase, req, res);
  if (!authUnit) return;

  const { de, ate, pagina, page, limite, limit } = req.query as {
    de?: string;
    ate?: string;
    unitId?: string;
    pagina?: string;
    page?: string;
    limite?: string;
    limit?: string;
  };

  if (!de || !ate) {
    return res.status(400).json({ error: "PARAMETROS_INVALIDOS", message: "Parâmetros 'de' e 'ate' são obrigatórios" });
  }

  // O escopo da credencial prevalece sobre o parâmetro unitId
  const targetUnitId = authUnit.id;
  const unitMeta = getShoppingUnitMetadata(authUnit);

  const pageNum = parseInt(pagina || page || "0", 10);
  const pageSize = parseInt(limite || limit || "0", 10);

  function shiftDateStr(dateStr: string, days: number): string {
    const d = new Date(`${dateStr}T00:00:00Z`);
    if (isNaN(d.getTime())) return dateStr;
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().split("T")[0]!;
  }

  const deBuf = shiftDateStr(de, -1);
  const ateBuf = shiftDateStr(ate, 1);

  let allOrders: { id: string; created_at: string; closed_at_ms: number | null; total_cents: number; status: string }[] = [];
  let from = 0;
  const step = 1000;
  while (true) {
    const { data, error } = await supabase
      .from("fa_kiosk_orders")
      .select("id, created_at, closed_at_ms, total_cents, status")
      .eq("unit_id", targetUnitId)
      .gte("business_date", deBuf)
      .lte("business_date", ateBuf)
      .in("status", ["PAGA", "CANCELADA"])
      .order("created_at", { ascending: true })
      .range(from, from + step - 1);

    if (error) {
      return res.status(500).json({ error: "ERRO_CONSULTA", message: "Falha ao consultar vendas." });
    }

    const chunk = (data || []) as any[];
    allOrders = allOrders.concat(chunk);
    if (chunk.length < step) break;
    from += step;
  }

  const mappedVendas = allOrders
    .map((o) => {
      const dataHora = formatIsoTimezone(o.closed_at_ms ?? o.created_at, unitMeta.timezone);
      const saleDate = dataHora.slice(0, 10);
      return {
        idVenda: o.id,
        dataHora,
        saleDate,
        valorCentavos: o.total_cents,
        cancelado: o.status === "CANCELADA",
        troca: false,
      };
    })
    .filter((v) => v.saleDate >= de && v.saleDate <= ate);

  const pageNum = parseInt(pagina || page || "0", 10);
  const pageSize = parseInt(limite || limit || "0", 10);

  const totalRegistros = mappedVendas.length;
  let vendas = mappedVendas.map(({ saleDate, ...v }) => v);
  let paginacaoMeta: any = undefined;

  if (pageNum > 0 || pageSize > 0) {
    const actualPage = pageNum > 0 ? pageNum : 1;
    const actualLimit = pageSize > 0 ? pageSize : 1000;
    const startIdx = (actualPage - 1) * actualLimit;
    const endIdx = startIdx + actualLimit;

    vendas = vendas.slice(startIdx, endIdx);
    paginacaoMeta = {
      pagina: actualPage,
      limite: actualLimit,
      totalPaginas: Math.ceil(totalRegistros / actualLimit) || 1,
      totalRegistros,
    };
  }

  const totalVendas = vendas.filter((v) => !v.cancelado).length;
  const brutoCentavos = vendas.filter((v) => !v.cancelado).reduce((acc, v) => acc + v.valorCentavos, 0);

  const responseBody: any = {
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
  };

  if (paginacaoMeta) {
    responseBody.paginacao = paginacaoMeta;
  }

  return res.status(200).json(responseBody);
}
