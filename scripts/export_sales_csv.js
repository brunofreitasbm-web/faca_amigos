const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://ivjvpdzsfjdpyabbzzuj.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;
if (!SUPABASE_KEY) {
  console.error('Defina SUPABASE_SECRET_KEY no ambiente (nao grave a chave no arquivo).');
  process.exit(1);
}
const UNIT_ID = '5fc99a57-81ee-4232-a105-1fcb4634cef4';

function escapeCsv(val) {
  if (val === null || val === undefined) return '';
  const str = String(val).replace(/"/g, '""');
  return `"${str}"`;
}

function formatCurrency(cents) {
  return ((cents || 0) / 100).toFixed(2).replace('.', ',');
}

function sanitizeItemDescription(desc) {
  if (!desc) return 'Sessão Playground';
  let clean = desc.trim();
  if (clean.includes('—')) {
    const parts = clean.split('—');
    const dur = parts[parts.length - 1].trim();
    if (/minuto|hora|min/i.test(dur)) return `Sessão Playground (${dur})`;
    return dur;
  }
  if (clean.includes(' - ')) {
    const parts = clean.split(' - ');
    const dur = parts[parts.length - 1].trim();
    if (/minuto|hora|min/i.test(dur)) return `Sessão Playground (${dur})`;
    return dur;
  }
  return clean;
}

function formatDateBelem(isoStr) {
  if (!isoStr) return '';
  const date = new Date(isoStr);
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Belem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(date);
}

async function exportSales() {
  console.log('Buscando dados no Supabase...');
  
  // Unidade
  const unitRes = await fetch(`${SUPABASE_URL}/rest/v1/fa_kiosk_units?id=eq.${UNIT_ID}`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });
  const unit = (await unitRes.json())[0];
  const unitName = unit ? unit.name : 'Playground (Bosque Grão-Pará)';

  // Pedidos
  const ordRes = await fetch(`${SUPABASE_URL}/rest/v1/fa_kiosk_orders?unit_id=eq.${UNIT_ID}&business_date=gte.2026-10-01&business_date=lte.2026-10-31&select=*&order=business_date.asc,created_at.asc`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });
  const orders = await ordRes.json();
  const orderIds = orders.map(o => o.id);

  // Pagamentos
  let payments = [];
  for (let i = 0; i < orderIds.length; i += 50) {
    const chunk = orderIds.slice(i, i + 50);
    const pRes = await fetch(`${SUPABASE_URL}/rest/v1/fa_kiosk_payments?order_id=in.(${chunk.join(',')})`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    payments = payments.concat(await pRes.json());
  }

  // Itens
  let items = [];
  for (let i = 0; i < orderIds.length; i += 50) {
    const chunk = orderIds.slice(i, i + 50);
    const itRes = await fetch(`${SUPABASE_URL}/rest/v1/fa_kiosk_order_items?order_id=in.(${chunk.join(',')})`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    items = items.concat(await itRes.json());
  }

  // Funcionários
  const empRes = await fetch(`${SUPABASE_URL}/rest/v1/fa_kiosk_employees?select=id,full_name,role`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });
  const employees = await empRes.json();
  const empMap = {};
  employees.forEach(e => { empMap[e.id] = e.full_name; });

  // Mapeamentos
  const payByOrder = {};
  payments.forEach(p => {
    if (!payByOrder[p.order_id]) payByOrder[p.order_id] = [];
    payByOrder[p.order_id].push(p);
  });

  const itemsByOrder = {};
  items.forEach(it => {
    if (!itemsByOrder[it.order_id]) itemsByOrder[it.order_id] = [];
    itemsByOrder[it.order_id].push(it);
  });

  // 1. CSV Principal de Vendas (Pedidos)
  const headerOrders = [
    'Codigo_Pedido',
    'Data_Contabil',
    'Data_Hora',
    'Unidade',
    'Status',
    'Operador_PDV',
    'Descricao_Itens',
    'Qtd_Itens',
    'Forma_Pagamento_Principal',
    'Detalhamento_Pagamentos',
    'Valor_Credito_R$',
    'Valor_Debito_R$',
    'Valor_Pix_R$',
    'Valor_Dinheiro_R$',
    'Valor_Total_R$'
  ];

  const rowsOrders = orders.map(o => {
    const ordPays = payByOrder[o.id] || [];
    const ordItems = itemsByOrder[o.id] || [];
    
    let creditoCents = 0;
    let debitoCents = 0;
    let pixCents = 0;
    let dinheiroCents = 0;
    const payDetails = [];

    ordPays.forEach(p => {
      const amt = p.amount_cents || 0;
      const m = (p.method || '').toUpperCase();
      if (m === 'CREDITO') creditoCents += amt;
      else if (m === 'DEBITO') debitoCents += amt;
      else if (m === 'PIX') pixCents += amt;
      else if (m === 'DINHEIRO') dinheiroCents += amt;
      payDetails.push(`${m} (R$ ${formatCurrency(amt)})`);
    });

    const itemsDesc = ordItems.map(it => sanitizeItemDescription(it.description)).join('; ') || 'Sessão Playground';
    const operator = empMap[o.closed_by_employee_id] || 'Operador PDV';
    const primaryPayMethod = ordPays.length > 0 ? ordPays[0].method : '—';

    return [
      escapeCsv(o.order_code || o.id.slice(0, 8).toUpperCase()),
      escapeCsv(o.business_date),
      escapeCsv(formatDateBelem(o.created_at)),
      escapeCsv(unitName),
      escapeCsv(o.status),
      escapeCsv(operator),
      escapeCsv(itemsDesc),
      ordItems.length || 1,
      escapeCsv(primaryPayMethod),
      escapeCsv(payDetails.join(', ')),
      formatCurrency(creditoCents),
      formatCurrency(debitoCents),
      formatCurrency(pixCents),
      formatCurrency(dinheiroCents),
      formatCurrency(o.total_cents)
    ].join(';');
  });

  const csvOrdersContent = '\ufeff' + [headerOrders.join(';'), ...rowsOrders].join('\r\n');
  const pathOrdersCsv = path.resolve('relatorio_vendas_outubro_2026_grao_para.csv');
  fs.writeFileSync(pathOrdersCsv, csvOrdersContent, 'utf8');
  console.log(`CSV de Vendas gerado com sucesso: ${pathOrdersCsv}`);

  // 2. CSV Resumo Diário
  const dailyMap = {};
  orders.forEach(o => {
    const d = o.business_date;
    if (!dailyMap[d]) {
      dailyMap[d] = {
        data: d,
        pedidos: 0,
        totalCents: 0,
        creditoCents: 0,
        debitoCents: 0,
        pixCents: 0,
        dinheiroCents: 0
      };
    }
    dailyMap[d].pedidos++;
    dailyMap[d].totalCents += (o.total_cents || 0);

    const ordPays = payByOrder[o.id] || [];
    ordPays.forEach(p => {
      const amt = p.amount_cents || 0;
      const m = (p.method || '').toUpperCase();
      if (m === 'CREDITO') dailyMap[d].creditoCents += amt;
      else if (m === 'DEBITO') dailyMap[d].debitoCents += amt;
      else if (m === 'PIX') dailyMap[d].pixCents += amt;
      else if (m === 'DINHEIRO') dailyMap[d].dinheiroCents += amt;
    });
  });

  const headerDaily = [
    'Data_Contabil',
    'Unidade',
    'Qtd_Vendas',
    'Total_Credito_R$',
    'Total_Debito_R$',
    'Total_Pix_R$',
    'Total_Dinheiro_R$',
    'Faturamento_Total_R$'
  ];

  const rowsDaily = Object.keys(dailyMap).sort().map(d => {
    const day = dailyMap[d];
    return [
      escapeCsv(day.data),
      escapeCsv(unitName),
      day.pedidos,
      formatCurrency(day.creditoCents),
      formatCurrency(day.debitoCents),
      formatCurrency(day.pixCents),
      formatCurrency(day.dinheiroCents),
      formatCurrency(day.totalCents)
    ].join(';');
  });

  const csvDailyContent = '\ufeff' + [headerDaily.join(';'), ...rowsDaily].join('\r\n');
  const pathDailyCsv = path.resolve('relatorio_resumo_diario_outubro_2026_grao_para.csv');
  fs.writeFileSync(pathDailyCsv, csvDailyContent, 'utf8');
  console.log(`CSV de Resumo Diário gerado com sucesso: ${pathDailyCsv}`);

  // 3. CSV de Itens Vendidos
  const headerItems = [
    'Codigo_Pedido',
    'Data_Contabil',
    'Data_Hora',
    'Unidade',
    'Item_Descricao',
    'Tipo_Item',
    'Natureza',
    'Quantidade',
    'Valor_Unitario_R$',
    'Valor_Total_Item_R$'
  ];

  const rowsItems = [];
  orders.forEach(o => {
    const ordItems = itemsByOrder[o.id] || [];
    ordItems.forEach(it => {
      rowsItems.push([
        escapeCsv(o.order_code || o.id.slice(0, 8).toUpperCase()),
        escapeCsv(o.business_date),
        escapeCsv(formatDateBelem(o.created_at)),
        escapeCsv(unitName),
        escapeCsv(sanitizeItemDescription(it.description)),
        escapeCsv(it.item_type || 'SESSAO'),
        escapeCsv(it.item_nature || 'SERVICO'),
        it.quantity || 1,
        formatCurrency(it.unit_price_cents),
        formatCurrency(it.total_cents)
      ].join(';'));
    });
  });

  const csvItemsContent = '\ufeff' + [headerItems.join(';'), ...rowsItems].join('\r\n');
  const pathItemsCsv = path.resolve('relatorio_itens_outubro_2026_grao_para.csv');
  fs.writeFileSync(pathItemsCsv, csvItemsContent, 'utf8');
  console.log(`CSV de Itens gerado com sucesso: ${pathItemsCsv}`);
}

exportSales().catch(err => {
  console.error('Erro na exportação:', err);
  process.exit(1);
});
