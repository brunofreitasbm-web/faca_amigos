import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateShoppingRequest, createServiceClient, getShoppingUnitMetadata } from "../../../_shopping/common.js";

interface DayAggregate {
  data: string;
  brutoCentavos: number;
  descontosCentavos: number;
  liquidoCentavos: number;
  cancelamentosCentavos: number;
  quantidadeVendas: number;
  quantidadeCancelamentos: number;
  ticketMedioCentavos: number;
  porNatureza: { SERVICO: number; PRODUTO: number };
  porMeioPagamento: { DINHEIRO: number; PIX: number; CREDITO: number; DEBITO: number; VOUCHER: number };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const supabase = createServiceClient();
  const authUnit = await authenticateShoppingRequest(supabase, req, res);
  if (!authUnit) return;

  const { de, ate, formato = "json", unitId } = req.query as {
    de?: string;
    ate?: string;
    formato?: string;
    unitId?: string;
  };

  if (!de || !ate) {
    return res.status(400).json({ error: "PARAMETROS_INVALIDOS", message: "Parâmetros 'de' e 'ate' são obrigatórios" });
  }

  const targetUnitId = unitId || authUnit.id;
  const unitMeta = getShoppingUnitMetadata(
    targetUnitId === authUnit.id
      ? authUnit
      : ((await supabase.from("fa_kiosk_units").select("id, kind, name, cnpj, razao_social, timezone").eq("id", targetUnitId).single()).data as any) || authUnit,
  );

  const ordersRes = await supabase
    .from("fa_kiosk_orders")
    .select("id, business_date, status, total_cents")
    .eq("unit_id", targetUnitId)
    .gte("business_date", de)
    .lte("business_date", ate);

  if (ordersRes.error) {
    return res.status(500).json({ error: "ERRO_CONSULTA", message: "Falha ao consultar dados de faturamento." });
  }

  const orders = (ordersRes.data || []) as { id: string; business_date: string; status: string; total_cents: number }[];
  const businessDateByOrderId = new Map(orders.map((o) => [o.id, o.business_date]));

  // Filtra via o relacionamento com fa_kiosk_orders em vez de um IN (...) com
  // todos os ids de pedidos pagos: para períodos com centenas/milhares de
  // pedidos, o IN gerava uma URL longa demais e o PostgREST rejeitava a
  // consulta (500 ERRO_CONSULTA), mesmo com a query em si sendo válida.
  const [paymentsRes, itemsRes] = await Promise.all([
    supabase
      .from("fa_kiosk_payments")
      .select("order_id, amount_cents, method, fa_kiosk_orders!inner(unit_id, business_date, status)")
      .eq("fa_kiosk_orders.unit_id", targetUnitId)
      .eq("fa_kiosk_orders.status", "PAGA")
      .gte("fa_kiosk_orders.business_date", de)
      .lte("fa_kiosk_orders.business_date", ate),
    supabase
      .from("fa_kiosk_order_items")
      .select("order_id, total_cents, item_nature, fa_kiosk_orders!inner(unit_id, business_date, status)")
      .eq("fa_kiosk_orders.unit_id", targetUnitId)
      .eq("fa_kiosk_orders.status", "PAGA")
      .gte("fa_kiosk_orders.business_date", de)
      .lte("fa_kiosk_orders.business_date", ate),
  ]);

  if (paymentsRes.error || itemsRes.error) {
    return res.status(500).json({ error: "ERRO_CONSULTA", message: "Falha ao consultar dados de faturamento." });
  }

  const payments = (paymentsRes.data || []) as { order_id: string; amount_cents: number; method: string }[];
  const items = (itemsRes.data || []) as { order_id: string; total_cents: number; item_nature: string }[];

  const daysMap = new Map<string, DayAggregate>();

  for (const o of orders) {
    if (o.status !== "PAGA" && o.status !== "CANCELADA") continue;
    let day = daysMap.get(o.business_date);
    if (!day) {
      day = {
        data: o.business_date,
        brutoCentavos: 0,
        descontosCentavos: 0,
        liquidoCentavos: 0,
        cancelamentosCentavos: 0,
        quantidadeVendas: 0,
        quantidadeCancelamentos: 0,
        ticketMedioCentavos: 0,
        porNatureza: { SERVICO: 0, PRODUTO: 0 },
        porMeioPagamento: { DINHEIRO: 0, PIX: 0, CREDITO: 0, DEBITO: 0, VOUCHER: 0 },
      };
      daysMap.set(o.business_date, day);
    }
    if (o.status === "PAGA") {
      day.brutoCentavos += o.total_cents;
      day.liquidoCentavos += o.total_cents;
      day.quantidadeVendas += 1;
    } else {
      day.cancelamentosCentavos += o.total_cents;
      day.quantidadeCancelamentos += 1;
    }
  }

  for (const p of payments) {
    const businessDate = businessDateByOrderId.get(p.order_id);
    const day = businessDate ? daysMap.get(businessDate) : undefined;
    if (day && Object.prototype.hasOwnProperty.call(day.porMeioPagamento, p.method)) {
      (day.porMeioPagamento as Record<string, number>)[p.method] += p.amount_cents;
    }
  }

  for (const it of items) {
    const businessDate = businessDateByOrderId.get(it.order_id);
    const day = businessDate ? daysMap.get(businessDate) : undefined;
    if (day && Object.prototype.hasOwnProperty.call(day.porNatureza, it.item_nature)) {
      (day.porNatureza as Record<string, number>)[it.item_nature] += it.total_cents;
    }
  }

  for (const day of daysMap.values()) {
    day.ticketMedioCentavos = day.quantidadeVendas > 0 ? Math.round(day.liquidoCentavos / day.quantidadeVendas) : 0;
  }

  const diasList = Array.from(daysMap.values()).sort((a, b) => a.data.localeCompare(b.data));

  const periodoTotal = {
    dataInicial: de,
    dataFinal: ate,
    brutoCentavos: diasList.reduce((acc, d) => acc + d.brutoCentavos, 0),
    descontosCentavos: 0,
    liquidoCentavos: diasList.reduce((acc, d) => acc + d.liquidoCentavos, 0),
    cancelamentosCentavos: diasList.reduce((acc, d) => acc + d.cancelamentosCentavos, 0),
    quantidadeVendas: diasList.reduce((acc, d) => acc + d.quantidadeVendas, 0),
    quantidadeCancelamentos: diasList.reduce((acc, d) => acc + d.quantidadeCancelamentos, 0),
    ticketMedioCentavos: 0,
    porNatureza: {
      SERVICO: diasList.reduce((acc, d) => acc + d.porNatureza.SERVICO, 0),
      PRODUTO: diasList.reduce((acc, d) => acc + d.porNatureza.PRODUTO, 0),
    },
    porMeioPagamento: {
      DINHEIRO: diasList.reduce((acc, d) => acc + d.porMeioPagamento.DINHEIRO, 0),
      PIX: diasList.reduce((acc, d) => acc + d.porMeioPagamento.PIX, 0),
      CREDITO: diasList.reduce((acc, d) => acc + d.porMeioPagamento.CREDITO, 0),
      DEBITO: diasList.reduce((acc, d) => acc + d.porMeioPagamento.DEBITO, 0),
      VOUCHER: diasList.reduce((acc, d) => acc + d.porMeioPagamento.VOUCHER, 0),
    },
  };
  periodoTotal.ticketMedioCentavos =
    periodoTotal.quantidadeVendas > 0 ? Math.round(periodoTotal.liquidoCentavos / periodoTotal.quantidadeVendas) : 0;

  if (formato === "csv") {
    let csvContent =
      "data;cnpj;luc;codigo_lojista;bruto;descontos;liquido;cancelamentos;qtd_vendas;qtd_cancelamentos;ticket_medio;servico;produto;dinheiro;pix;credito;debito;voucher\r\n";
    const fmt = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
    for (const d of diasList) {
      csvContent += `${d.data};${unitMeta.cnpj};${unitMeta.luc};${unitMeta.codigoLojista};${fmt(d.brutoCentavos)};${fmt(d.descontosCentavos)};${fmt(d.liquidoCentavos)};${fmt(d.cancelamentosCentavos)};${d.quantidadeVendas};${d.quantidadeCancelamentos};${fmt(d.ticketMedioCentavos)};${fmt(d.porNatureza.SERVICO)};${fmt(d.porNatureza.PRODUTO)};${fmt(d.porMeioPagamento.DINHEIRO)};${fmt(d.porMeioPagamento.PIX)};${fmt(d.porMeioPagamento.CREDITO)};${fmt(d.porMeioPagamento.DEBITO)};${fmt(d.porMeioPagamento.VOUCHER)}\r\n`;
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    return res.status(200).send(csvContent);
  }

  return res.status(200).json({
    layoutVersao: "1.0",
    loja: unitMeta,
    periodo: periodoTotal,
    dias: diasList,
    moeda: "BRL",
    unidadeValores: "CENTAVOS",
    geradoEmMs: Date.now(),
  });
}
