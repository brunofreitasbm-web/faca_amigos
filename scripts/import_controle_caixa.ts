import fs from 'fs';
import path from 'path';

export interface LegacyGuardian {
  legacy_id?: string;
  full_name: string;
  cpf?: string;
  phone_e164: string;
  notes?: string;
}

export interface LegacyChild {
  legacy_id?: string;
  full_name: string;
  birth_date: string; // YYYY-MM-DD
  inclusive_eligible?: boolean;
  notes?: string;
}

export interface LegacySession {
  legacy_id?: string;
  activity?: 'PLAYGROUND' | 'CARRINHO';
  wristband_code?: string;
  ticket_code?: string;
  checkin_at_ms?: number;
  checkout_at_ms?: number;
  business_date?: string;
  operator?: string;
  duration_minutes?: number;
  overtime_minutes?: number;
}

export interface LegacyPayment {
  legacy_id?: string;
  method?: 'DINHEIRO' | 'PIX' | 'CREDITO' | 'DEBITO' | 'VOUCHER';
  amount_cents?: number;
}

export interface LegacyRecord {
  guardian: LegacyGuardian;
  child: LegacyChild;
  session?: LegacySession;
  payment?: LegacyPayment;
}

/**
 * Sanitiza número de telefone para o formato E.164 (+55...)
 */
export function formatE164(phoneRaw: string): string {
  const digits = phoneRaw.replace(/\D/g, '');
  if (!digits) return '+5500000000000';
  if (digits.startsWith('55') && digits.length >= 12) return `+${digits}`;
  if (digits.length >= 10) return `+55${digits}`;
  return `+${digits}`;
}

/**
 * Sanitiza CPF (retorna apenas os 11 dígitos)
 */
export function sanitizeCpf(cpfRaw?: string): string | undefined {
  if (!cpfRaw) return undefined;
  const digits = cpfRaw.replace(/\D/g, '');
  return digits.length === 11 ? digits : undefined;
}

/**
 * Função de processamento do lote de importação do controle-caixa
 */
export async function processLegacyImportBatch(records: LegacyRecord[]) {
  console.log(`\n🚀 Iniciando carga de ${records.length} registros do repositório controle-caixa...`);

  let totalProcessed = 0;
  let totalSuccess = 0;
  let totalError = 0;

  for (const record of records) {
    totalProcessed++;

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

// Execução direta via CLI se chamado diretamente
if (require.main === module) {
  const fileArg = process.argv[2] || path.join(__dirname, 'exemplo_controle_caixa_data.json');
  const resolvedPath = path.resolve(fileArg);

  if (!fs.existsSync(resolvedPath)) {
    console.error(`❌ Arquivo de dados não encontrado: ${resolvedPath}`);
    process.exit(1);
  }

  try {
    const rawData = fs.readFileSync(resolvedPath, 'utf-8');
    const records: LegacyRecord[] = JSON.parse(rawData);
    processLegacyImportBatch(records).catch((err) => {
      console.error('❌ Erro durante a execução da importação:', err);
      process.exit(1);
    });
  } catch (err) {
    console.error(`❌ Erro ao ler/parsear arquivo JSON:`, err);
    process.exit(1);
  }
}
