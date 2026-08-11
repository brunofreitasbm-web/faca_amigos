const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://ivjvpdzsfjdpyabbzzuj.supabase.co';
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_ssGb6CGSjsE7PTfXpR6cBg_I20V6YBh';

const headers = {
  'Content-Type': 'application/json',
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Prefer': 'return=representation'
};

/**
 * Parser de CSV com suporte a aspas e vírgulas internas
 */
function parseCSV(text) {
  const lines = text.split(/\r?\n/);
  const result = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const row = [];
    let insideQuote = false;
    let currentCell = '';

    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      if (char === '"') {
        insideQuote = !insideQuote;
      } else if (char === ',' && !insideQuote) {
        row.push(currentCell.trim().replace(/^"+|"+$/g, ''));
        currentCell = '';
      } else {
        currentCell += char;
      }
    }
    row.push(currentCell.trim().replace(/^"+|"+$/g, ''));
    result.push(row);
  }

  return result;
}

function formatE164(phoneRaw, indexSeed) {
  if (!phoneRaw) return `+55000${String(indexSeed).padStart(8, '0')}`;
  const digits = String(phoneRaw).replace(/\D/g, '');
  if (!digits || digits.length < 8) return `+55000${String(indexSeed).padStart(8, '0')}`;
  if (digits.startsWith('55') && digits.length >= 12) return `+${digits}`;
  if (digits.length >= 10) return `+55${digits}`;
  return `+${digits}`;
}

function sanitizeCpf(cpfRaw) {
  if (!cpfRaw) return null;
  const digits = String(cpfRaw).replace(/\D/g, '');
  return digits.length === 11 ? digits : null;
}

function parseMoneyToCents(moneyStr) {
  if (!moneyStr) return 0;
  const clean = moneyStr.replace(/[^\d,-]/g, '').replace(',', '.');
  const val = parseFloat(clean);
  return isNaN(val) ? 0 : Math.round(val * 100);
}

function parseDateTime(dateStr, timeStr) {
  try {
    const [datePart, defaultTimePart] = dateStr.split(' ');
    const [day, month, year] = datePart.split('/');
    const timeToUse = timeStr || defaultTimePart || '00:00';
    const [hours, minutes] = timeToUse.split(':');

    const dt = new Date(Date.UTC(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10), parseInt(hours, 10) + 3, parseInt(minutes, 10)));
    return dt;
  } catch (err) {
    return new Date();
  }
}

function calculateBirthDate(baseDate, ageStr) {
  if (!ageStr) return '2020-01-01';
  
  let years = 0;
  let months = 0;

  const yearsMatch = ageStr.match(/(\d+)\s*ano/i);
  const monthsMatch = ageStr.match(/(\d+)\s*mês/i) || ageStr.match(/(\d+)\s*mes/i);

  if (yearsMatch) years = parseInt(yearsMatch[1], 10);
  if (monthsMatch) months = parseInt(monthsMatch[1], 10);

  const dt = new Date(baseDate.getTime());
  dt.setUTCFullYear(dt.getUTCFullYear() - years);
  dt.setUTCMonth(dt.getUTCMonth() - months);

  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function apiFetch(endpoint, method = 'GET', body = null) {
  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, options);
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`API ${endpoint} (${res.status}): ${txt}`);
  }
  return await res.json();
}

async function ensureUnitAndPlan() {
  console.log('🔍 Garantindo Unidade e Plano padrão no Supabase...');
  let units = await apiFetch('fa_kiosk_units?select=*');
  let unitId;

  if (units.length === 0) {
    const createdUnit = await apiFetch('fa_kiosk_units', 'POST', [{
      kind: 'LOJA',
      name: 'Faça Amigos Playground',
      timezone: 'America/Belem',
      business_day_cutoff_hour: 4
    }]);
    unitId = createdUnit[0].id;
    console.log(`  ✅ Unidade criada: ${unitId}`);
  } else {
    unitId = units[0].id;
    console.log(`  ✅ Unidade existente: ${unitId}`);
  }

  let plans = await apiFetch(`fa_kiosk_plans?unit_id=eq.${unitId}&select=*`);
  let planId;

  if (plans.length === 0) {
    const createdPlan = await apiFetch('fa_kiosk_plans', 'POST', [{
      unit_id: unitId,
      activity: 'PLAYGROUND',
      name: 'Sessão Playground (Legado)',
      value_cents: 10000,
      duration_value: 30,
      duration_unit: 'MINUTO',
      overage_cents_per_minute: 100,
      color: '#2ECFB5',
      active: true
    }]);
    planId = createdPlan[0].id;
    console.log(`  ✅ Plano padrão criado: ${planId}`);
  } else {
    planId = plans[0].id;
    console.log(`  ✅ Plano padrão existente: ${planId}`);
  }

  return { unitId, planId };
}

async function runDirectImport(csvFilePath) {
  console.log(`\n==================================================`);
  console.log(`🚀 INICIANDO IMPORTAÇÃO DE SALES.CSV PARA SUPABASE`);
  console.log(`==================================================\n`);

  const { unitId, planId } = await ensureUnitAndPlan();

  const fileContent = fs.readFileSync(csvFilePath, 'utf-8');
  const rows = parseCSV(fileContent);
  const dataRows = rows.slice(1);

  console.log(`📊 Total de registros para processar: ${dataRows.length}\n`);

  const guardianCache = new Map(); // cpf or phone -> guardian_id
  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    if (row.length < 15) continue;

    const rowNum = i + 1;
    const legacyId = row[0] || `row-${rowNum}`;
    const rowType = (row[4] || 'SESSION').toUpperCase();
    const dateTimeStr = row[5];
    const cpfRaw = row[9];
    const guardianName = row[10] || 'Responsável Não Informado';
    const phoneRaw = row[11];
    const periodStr = row[12];
    const childName = row[15] || 'Criança';
    const ageStr = row[16];

    const credCents = parseMoneyToCents(row[18]);
    const debCents = parseMoneyToCents(row[19]);
    const dinCents = parseMoneyToCents(row[20]);
    const cartCents = parseMoneyToCents(row[21]);
    const valesCents = parseMoneyToCents(row[22]);
    const transfCents = parseMoneyToCents(row[23]);
    const outrosCents = parseMoneyToCents(row[24]);
    const totalPayCents = parseMoneyToCents(row[25]);

    const colaborador = row[28] || '';

    // Método de Pagamento (validações com check constraint: 'DINHEIRO', 'PIX', 'CREDITO', 'DEBITO', 'VOUCHER')
    let paymentMethod = 'DINHEIRO';
    if (credCents > 0) paymentMethod = 'CREDITO';
    else if (debCents > 0) paymentMethod = 'DEBITO';
    else if (dinCents > 0) paymentMethod = 'DINHEIRO';
    else if (transfCents > 0) paymentMethod = 'PIX';
    else if (cartCents > 0) paymentMethod = 'PIX';
    else if (valesCents > 0) paymentMethod = 'VOUCHER';
    else if (outrosCents > 0) paymentMethod = 'VOUCHER';

    let paidAmountCents = totalPayCents;
    if (paidAmountCents === 0 && (credCents || debCents || dinCents || transfCents)) {
      paidAmountCents = credCents + debCents + dinCents + transfCents;
    }

    const baseDate = parseDateTime(dateTimeStr);
    let checkinMs = baseDate.getTime();
    let checkoutMs = baseDate.getTime() + (30 * 60 * 1000);

    if (periodStr && periodStr.includes('-')) {
      const [startT, endT] = periodStr.split('-').map(s => s.trim());
      const checkinDate = parseDateTime(dateTimeStr, startT);
      const checkoutDate = parseDateTime(dateTimeStr, endT);
      checkinMs = checkinDate.getTime();
      if (checkoutDate.getTime() > checkinMs) checkoutMs = checkoutDate.getTime();
    }

    const [datePart] = dateTimeStr.split(' ');
    const [d, m, y] = datePart.split('/');
    const businessDate = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    const birthDate = calculateBirthDate(baseDate, ageStr);
    const cpfClean = sanitizeCpf(cpfRaw);
    const phoneClean = formatE164(phoneRaw, rowNum);

    try {
      // 1. Obter ou Criar Responsável
      let guardianId;
      const cacheKey = cpfClean || phoneClean;

      if (guardianCache.has(cacheKey)) {
        guardianId = guardianCache.get(cacheKey);
      } else {
        let existing = [];
        if (cpfClean) {
          existing = await apiFetch(`fa_kiosk_guardians?cpf=eq.${cpfClean}&select=id`);
        }
        if (existing.length === 0 && phoneClean !== '+5500000000000') {
          existing = await apiFetch(`fa_kiosk_guardians?phone_e164=eq.${encodeURIComponent(phoneClean)}&select=id`);
        }

        if (existing.length > 0) {
          guardianId = existing[0].id;
        } else {
          const newG = await apiFetch('fa_kiosk_guardians', 'POST', [{
            full_name: guardianName,
            phone_e164: phoneClean,
            cpf: cpfClean
          }]);
          guardianId = newG[0].id;
        }
        guardianCache.set(cacheKey, guardianId);
      }

      // 2. Obter ou Criar Criança
      let childId;
      const existingChildren = await apiFetch(`fa_kiosk_children?full_name=ilike.${encodeURIComponent(childName)}&select=id`);
      
      if (existingChildren.length > 0) {
        childId = existingChildren[0].id;
      } else {
        const newC = await apiFetch('fa_kiosk_children', 'POST', [{
          full_name: childName,
          birth_date: birthDate,
          inclusive_eligible: false
        }]);
        childId = newC[0].id;

        // Vincular ao responsável
        try {
          await apiFetch('fa_kiosk_child_guardians', 'POST', [{
            child_id: childId,
            guardian_id: guardianId,
            is_authorized_pickup: true
          }]);
        } catch (e) {
          // ignora se já vinculado
        }
      }

      // 3. Criar Sessão
      const wristbandCode = `WB-LEG-${legacyId}-${rowNum}`;
      const ticketCode = `TK-LEG-${legacyId}-${rowNum}`;
      const isProductRow = rowType === 'PRODUCT' || rowType === 'PRODUCT_ITEM';

      const sessionObj = await apiFetch('fa_kiosk_sessions', 'POST', [{
        unit_id: unitId,
        activity: isProductRow ? 'PLAYGROUND' : 'PLAYGROUND',
        plan_id: planId,
        child_id: childId,
        child_name_snapshot: childName,
        guardian_id: guardianId,
        wristband_code: wristbandCode,
        ticket_code: ticketCode,
        checkin_at_ms: checkinMs,
        checkout_at_ms: checkoutMs,
        status: 'FINALIZADA',
        business_date: businessDate
      }]);
      const sessionId = sessionObj[0].id;

      // Log de visita
      await apiFetch('fa_kiosk_visit_log', 'POST', [{
        child_id: childId,
        activity: 'PLAYGROUND',
        at_ms: checkinMs
      }]);

      // 4. Criar Pedido e Pagamento se houver valor pago
      if (paidAmountCents > 0) {
        const orderObj = await apiFetch('fa_kiosk_orders', 'POST', [{
          unit_id: unitId,
          kind: isProductRow ? 'PDV' : 'SESSAO',
          total_cents: paidAmountCents,
          status: 'PAGA',
          business_date: businessDate,
          created_at_ms: checkinMs
        }]);
        const orderId = orderObj[0].id;

        // Item do pedido
        await apiFetch('fa_kiosk_order_items', 'POST', [{
          order_id: orderId,
          item_type: isProductRow ? 'PRODUTO' : 'SESSAO',
          item_nature: isProductRow ? 'PRODUTO' : 'SERVICO',
          description: isProductRow ? 'Item de Produto Legado' : `Sessão Playground (${dateTimeStr})`,
          quantity: 1,
          unit_price_cents: paidAmountCents,
          list_unit_price_cents: paidAmountCents,
          total_cents: paidAmountCents,
          session_id: sessionId
        }]);

        // Registro de Pagamento
        await apiFetch('fa_kiosk_payments', 'POST', [{
          order_id: orderId,
          method: paymentMethod,
          amount_cents: paidAmountCents,
          created_at_ms: checkinMs
        }]);
      }

      successCount++;
      if (rowNum % 100 === 0 || rowNum === dataRows.length) {
        console.log(` ✅ [${rowNum}/${dataRows.length}] Processados com sucesso (${((rowNum / dataRows.length) * 100).toFixed(1)}%)`);
      }
    } catch (err) {
      errorCount++;
      console.error(` ❌ [Linha ${rowNum} | ID ${legacyId}] Erro ao importar:`, err.message);
    }
  }

  console.log('\n==================================================');
  console.log('📊 RESUMO DA IMPORTAÇÃO DIRETA (REST API)');
  console.log('==================================================');
  console.log(` Total de linhas no CSV: ${dataRows.length}`);
  console.log(` Sucessos: ${successCount}`);
  console.log(` Erros/Falhas: ${errorCount}`);
  console.log('==================================================\n');
}

const csvPath = process.argv[2] || 'C:\\Users\\bruno\\Downloads\\sales.csv';
runDirectImport(path.resolve(csvPath)).catch(err => {
  console.error('❌ Erro fatal:', err);
  process.exit(1);
});
