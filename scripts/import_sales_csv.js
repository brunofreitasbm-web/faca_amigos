const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://ivjvpdzsfjdpyabbzzuj.supabase.co';
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_ssGb6CGSjsE7PTfXpR6cBg_I20V6YBh';

/**
 * Parser de CSV com suporte a campos entre aspas contendo vírgulas
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

/**
 * Sanitiza telefone para E.164 (+55...)
 */
function formatE164(phoneRaw) {
  if (!phoneRaw) return '+5500000000000';
  const digits = String(phoneRaw).replace(/\D/g, '');
  if (!digits) return '+5500000000000';
  if (digits.startsWith('55') && digits.length >= 12) return `+${digits}`;
  if (digits.length >= 10) return `+55${digits}`;
  return `+${digits}`;
}

/**
 * Sanitiza CPF (11 dígitos)
 */
function sanitizeCpf(cpfRaw) {
  if (!cpfRaw) return undefined;
  const digits = String(cpfRaw).replace(/\D/g, '');
  return digits.length === 11 ? digits : undefined;
}

/**
 * Converte valor em moeda R$ para centavos
 */
function parseMoneyToCents(moneyStr) {
  if (!moneyStr) return 0;
  const clean = moneyStr.replace(/[^\d,-]/g, '').replace(',', '.');
  const val = parseFloat(clean);
  return isNaN(val) ? 0 : Math.round(val * 100);
}

/**
 * Extrai data e hora (DD/MM/YYYY HH:mm)
 */
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

/**
 * Estima a data de nascimento com base no texto de idade ("X ano (s) e Y mês (es)")
 */
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

/**
 * Converte tempo HH:MM:SS para minutos
 */
function parseDurationMinutes(durationStr) {
  if (!durationStr) return 0;
  const parts = durationStr.split(':');
  if (parts.length < 2) return 0;
  const h = parseInt(parts[0], 10) || 0;
  const m = parseInt(parts[1], 10) || 0;
  return h * 60 + m;
}

/**
 * Envia o registro para a RPC do Supabase
 */
async function sendToSupabase(record) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fa_kiosk_import_legacy_record`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      },
      body: JSON.stringify({ p_record: record })
    });

    if (res.ok) {
      return await res.json();
    } else {
      const errText = await res.text();
      return { status: 'rpc_error', message: errText };
    }
  } catch (err) {
    return { status: 'network_error', message: err.message };
  }
}

/**
 * Processamento principal do CSV
 */
async function importSalesCSV(csvFilePath) {
  console.log(`\n🚀 Lendo arquivo CSV: ${csvFilePath}`);
  console.log(`📡 Supabase Endpoint Target: ${SUPABASE_URL}\n`);

  const fileContent = fs.readFileSync(csvFilePath, 'utf-8');
  const rows = parseCSV(fileContent);

  if (rows.length <= 1) {
    console.error('❌ CSV vazio ou contendo apenas cabeçalho.');
    return;
  }

  // Ignorar o cabeçalho
  const dataRows = rows.slice(1);
  console.log(`📊 Total de linhas encontradas no CSV: ${dataRows.length}`);

  let totalProcessed = 0;
  let totalSuccess = 0;
  let totalError = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    if (row.length < 15) continue; // Linha inválida

    totalProcessed++;

    const legacyId = row[0] || `row-${totalProcessed}`;
    const rowType = (row[4] || 'SESSION').toUpperCase();
    const dateTimeStr = row[5];
    const planCode = row[6] || 'PLAYGROUND';
    const cpfRaw = row[9];
    const guardianName = row[10] || 'Responsável Não Informado';
    const phoneRaw = row[11];
    const periodStr = row[12]; // ex: "12:05 - 12:48"
    const totalTimeStr = row[13];
    const chargeableTimeStr = row[14];
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

    const justificativa = row[26] || '';
    const autorizador = row[27] || '';
    const colaborador = row[28] || '';

    // Determinar Método de Pagamento
    let paymentMethod = 'DINHEIRO';
    let paidAmountCents = totalPayCents;

    if (credCents > 0) paymentMethod = 'CREDITO';
    else if (debCents > 0) paymentMethod = 'DEBITO';
    else if (dinCents > 0) paymentMethod = 'DINHEIRO';
    else if (transfCents > 0) paymentMethod = 'PIX';
    else if (cartCents > 0) paymentMethod = 'CARTEIRA';
    else if (valesCents > 0) paymentMethod = 'OUTROS';
    else if (outrosCents > 0) paymentMethod = 'OUTROS';

    if (paidAmountCents === 0 && (credCents || debCents || dinCents || transfCents)) {
      paidAmountCents = credCents + debCents + dinCents + transfCents;
    }

    // Processamento de datas de checkin / checkout
    const baseDate = parseDateTime(dateTimeStr);
    let checkinMs = baseDate.getTime();
    let checkoutMs = baseDate.getTime();

    if (periodStr && periodStr.includes('-')) {
      const [startT, endT] = periodStr.split('-').map(s => s.trim());
      const checkinDate = parseDateTime(dateTimeStr, startT);
      const checkoutDate = parseDateTime(dateTimeStr, endT);
      checkinMs = checkinDate.getTime();
      checkoutMs = checkoutDate.getTime();
    }

    // Business date (YYYY-MM-DD)
    const [datePart] = dateTimeStr.split(' ');
    const [d, m, y] = datePart.split('/');
    const businessDate = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;

    // Estimar Data de Nascimento
    const birthDate = calculateBirthDate(baseDate, ageStr);

    // Notas agrupadas
    const notesParts = [];
    if (justificativa) notesParts.push(`Justificativa: ${justificativa}`);
    if (autorizador) notesParts.push(`Autorizado por: ${autorizador}`);
    const combinedNotes = notesParts.join(' | ');

    // Estrutura do Payload esperado pela RPC fa_kiosk_import_legacy_record
    const payload = {
      guardian: {
        legacy_id: `g-${legacyId}`,
        full_name: guardianName,
        phone_e164: formatE164(phoneRaw),
        cpf: sanitizeCpf(cpfRaw),
        notes: combinedNotes
      },
      child: {
        legacy_id: `c-${legacyId}`,
        full_name: childName,
        birth_date: birthDate,
        inclusive_eligible: false,
        notes: ageStr ? `Idade na época: ${ageStr}` : undefined
      },
      session: {
        legacy_id: `s-${legacyId}`,
        activity: rowType === 'PRODUCT' || rowType === 'PRODUCT_ITEM' ? 'PRODUTO' : 'PLAYGROUND',
        business_date: businessDate,
        checkin_at_ms: checkinMs,
        checkout_at_ms: checkoutMs > checkinMs ? checkoutMs : checkinMs + (30 * 60 * 1000),
        duration_minutes: parseDurationMinutes(totalTimeStr),
        overtime_minutes: parseDurationMinutes(chargeableTimeStr),
        operator: colaborador || 'SISTEMA'
      },
      payment: paidAmountCents > 0 ? {
        legacy_id: `p-${legacyId}`,
        amount_cents: paidAmountCents,
        method: paymentMethod
      } : null
    };

    console.log(`[${totalProcessed}/${dataRows.length}] Processando ID #${legacyId} | Resp: "${guardianName}" | Criança: "${childName}" | Valor: R$ ${(paidAmountCents / 100).toFixed(2)}`);

    const rpcResult = await sendToSupabase(payload);
    if (rpcResult && rpcResult.status === 'success') {
      console.log(`   ⚡ Importado com sucesso no Supabase (Session ID: ${rpcResult.session_id || 'N/A'})`);
      totalSuccess++;
    } else {
      console.error(`   ❌ Falha/Aviso no envio ao Supabase:`, rpcResult ? (rpcResult.message || rpcResult.status) : 'Sem resposta');
      totalError++;
    }
  }

  console.log('\n========================================');
  console.log('📊 RESUMO FINAL DA IMPORTAÇÃO DO SALES.CSV');
  console.log('========================================');
  console.log(` Total de linhas no CSV: ${dataRows.length}`);
  console.log(` Processadas com sucesso: ${totalSuccess}`);
  console.log(` Falhas/Erros: ${totalError}`);
  console.log('========================================\n');
}

// Execução
const csvPath = process.argv[2] || 'C:\\Users\\bruno\\Downloads\\sales.csv';
importSalesCSV(path.resolve(csvPath)).catch(err => {
  console.error('❌ Erro fatal durante importação:', err);
  process.exit(1);
});
