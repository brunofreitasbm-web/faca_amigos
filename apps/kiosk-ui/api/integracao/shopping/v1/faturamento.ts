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

  const { de, ate, formato = "json" } = req.query as {
    de?: string;
    ate?: string;
    formato?: string;
    unitId?: string;
  };

  if (!de || !ate) {
    return res.status(400).json({ error: "PARAMETROS_INVALIDOS", message: "Parâmetros 'de' e 'ate' são obrigatórios" });
  }

  // O escopo da credencial prevalece sobre o parâmetro unitId
  const targetUnitId = authUnit.id;
  const unitMeta = getShoppingUnitMetadata(authUnit);

  // 1. Busca TODAS as ordens no período sem truncamento de 1.000 registros (PostgREST default limit)
  let orders: { id: string; business_date: string; status: string; total_cents: number }[] = [];
  let from = 0;
  const step = 1000;

  while (true) {
    const ordersRes = await supabase
      .from("fa_kiosk_orders")
      .select("id, business_date, status, total_cents")
      .eq("unit_id", targetUnitId)
      .gte("business_date", de)
      .lte("business_date", ate)
      .range(from, from + step - 1);

    if (ordersRes.error) {
      return res.status(500).json({ error: "ERRO_CONSULTA", message: "Falha ao consultar dados de faturamento." });
    }

    const chunk = (ordersRes.data || []) as { id: string; business_date: string; status: string; total_cents: number }[];
    orders = orders.concat(chunk);
    if (chunk.length < step) break;
    from += step;
  }

  const businessDateByOrderId = new Map(orders.map((o) => [o.id, o.business_date]));

  // 2. Busca TODOS os pagamentos sem truncamento
  let payments: { order_id: string; amount_cents: number; method: string }[] = [];
  from = 0;
  while (true) {
    const paymentsRes = await supabase
      .from("fa_kiosk_payments")
      .select("order_id, amount_cents, method, fa_kiosk_orders!inner(unit_id, business_date, status)")
      .eq("fa_kiosk_orders.unit_id", targetUnitId)
      .eq("fa_kiosk_orders.status", "PAGA")
      .gte("fa_kiosk_orders.business_date", de)
      .lte("fa_kiosk_orders.business_date", ate)
      .range(from, from + step - 1);

    if (paymentsRes.error) {
      return res.status(500).json({ error: "ERRO_CONSULTA", message: "Falha ao consultar dados de faturamento." });
    }

    const chunk = (paymentsRes.data || []) as { order_id: string; amount_cents: number; method: string }[];
    payments = payments.concat(chunk);
    if (chunk.length < step) break;
    from += step;
  }

  // 3. Busca TODOS os itens sem truncamento
  let items: { order_id: string; total_cents: number; item_nature: string }[] = [];
  from = 0;
  while (true) {
    const itemsRes = await supabase
      .from("fa_kiosk_order_items")
      .select("order_id, total_cents, item_nature, fa_kiosk_orders!inner(unit_id, business_date, status)")
      .eq("fa_kiosk_orders.unit_id", targetUnitId)
      .eq("fa_kiosk_orders.status", "PAGA")
      .gte("fa_kiosk_orders.business_date", de)
      .lte("fa_kiosk_orders.business_date", ate)
      .range(from, from + step - 1);

    if (itemsRes.error) {
      return res.status(500).json({ error: "ERRO_CONSULTA", message: "Falha ao consultar dados de faturamento." });
    }

    const chunk = (itemsRes.data || []) as { order_id: string; total_cents: number; item_nature: string }[];
    items = items.concat(chunk);
    if (chunk.length < step) break;
    from += step;
  }

  // 4. Preenche todos os dias do intervalo de 'de' até 'ate' (garante que dias sem movimento apareçam com zeros)
  const daysMap = new Map<string, DayAggregate>();
  const startDate = new Date(`${de}T00:00:00Z`);
  const endDate = new Date(`${ate}T00:00:00Z`);

  if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
    for (let d = new Date(startDate); d <= endDate; d.setUTCDate(d.getUTCDate() + 1)) {
      const dateStr = d.toISOString().split("T")[0]!;
      daysMap.set(dateStr, {
        data: dateStr,
        brutoCentavos: 0,
        descontosCentavos: 0,
        liquidoCentavos: 0,
        cancelamentosCentavos: 0,
        quantidadeVendas: 0,
        quantidadeCancelamentos: 0,
        ticketMedioCentavos: 0,
        porNatureza: { SERVICO: 0, PRODUTO: 0 },
        porMeioPagamento: { DINHEIRO: 0, PIX: 0, CREDITO: 0, DEBITO: 0, VOUCHER: 0 },
      });
    }
  }

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
