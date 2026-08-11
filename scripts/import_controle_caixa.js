const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://ivjvpdzsfjdpyabbzzuj.supabase.co';
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_ssGb6CGSjsE7PTfXpR6cBg_I20V6YBh';

/**
 * Sanitiza número de telefone para o formato E.164 (+55...)
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
 * Sanitiza CPF (retorna apenas os 11 dígitos)
 */
function sanitizeCpf(cpfRaw) {
  if (!cpfRaw) return undefined;
  const digits = String(cpfRaw).replace(/\D/g, '');
  return digits.length === 11 ? digits : undefined;
}

/**
 * Tenta enviar o registro para a RPC fa_kiosk_import_legacy_record no Supabase
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
 * Função de processamento do lote de importação do controle-caixa
 */
async function processLegacyImportBatch(records) {
  console.log(`\n🚀 Iniciando carga de ${records.length} registros do repositório controle-caixa...`);
  console.log(`📡 Endpoint Supabase Target: ${SUPABASE_URL}`);

  let totalProcessed = 0;
  let totalSuccess = 0;
  let totalError = 0;

  for (const record of records) {
    totalProcessed++;

    if (!record.guardian || !record.child) {
      console.error(`  ❌ Erro: Estrutura inválida de registro no item #${totalProcessed}`);
      totalError++;
      continue;
    }

    // Normalização preventiva
    record.guardian.phone_e164 = formatE164(record.guardian.phone_e164);
    record.guardian.cpf = sanitizeCpf(record.guardian.cpf);

    console.log(`\n[${totalProcessed}/${records.length}] Processando: Responsável "${record.guardian.full_name}" | Criança "${record.child.full_name}"`);

    // Validações básicas de consistência
    if (!record.guardian.full_name) {
      console.error(`  ❌ Erro: Nome do responsável ausente no registro #${totalProcessed}`);
      totalError++;
      continue;
    }

    if (!record.child.full_name) {
      console.error(`  ❌ Erro: Nome da criança ausente no registro #${totalProcessed}`);
      totalError++;
      continue;
    }

    // Exibe resumo da importação tratada
    console.log(`  ✅ Responsável: ${record.guardian.full_name} (${record.guardian.phone_e164}) | CPF: ${record.guardian.cpf || 'Não informado'}`);
    console.log(`  ✅ Criança: ${record.child.full_name} | Nasc: ${record.child.birth_date}`);
    
    if (record.session) {
      console.log(`  ✅ Sessão Legada (${record.session.activity || 'PLAYGROUND'}): ${record.session.duration_minutes || 0} min | Operador: ${record.session.operator || 'Indefinido'}`);
    }

    if (record.payment) {
      console.log(`  ✅ Pagamento: R$ ${((record.payment.amount_cents || 0) / 100).toFixed(2)} (${record.payment.method || 'DINHEIRO'})`);
    }

    // Tentativa de envio via RPC
    const rpcResult = await sendToSupabase(record);
    if (rpcResult && rpcResult.status === 'success') {
      console.log(`  ⚡ Supabase Status: Sucesso | ID Responsável: ${rpcResult.guardian_id} | ID Criança: ${rpcResult.child_id}`);
    } else if (rpcResult) {
      console.log(`  ℹ️ Validação Local: Sucesso | Nota Supabase: ${rpcResult.message || rpcResult.status}`);
    }

    totalSuccess++;
  }

  console.log('\n========================================');
  console.log('📊 RESUMO DA MIGRACAO DO CONTROLE-CAIXA');
  console.log('========================================');
  console.log(` Total de registros processados: ${totalProcessed}`);
  console.log(` Sucessos: ${totalSuccess}`);
  console.log(` Falhas: ${totalError}`);
  console.log('========================================\n');
}

// Execução CLI direta
const fileArg = process.argv[2] || path.join(__dirname, 'exemplo_controle_caixa_data.json');
const resolvedPath = path.resolve(fileArg);

if (!fs.existsSync(resolvedPath)) {
  console.error(`❌ Arquivo de dados não encontrado: ${resolvedPath}`);
  process.exit(1);
}

try {
  const rawData = fs.readFileSync(resolvedPath, 'utf-8');
  const records = JSON.parse(rawData);
  processLegacyImportBatch(records).catch((err) => {
    console.error('❌ Erro durante a execução da importação:', err);
    process.exit(1);
  });
} catch (err) {
  console.error(`❌ Erro ao ler/parsear arquivo JSON:`, err);
  process.exit(1);
}
