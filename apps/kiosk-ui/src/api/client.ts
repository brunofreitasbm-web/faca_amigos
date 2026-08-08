import { quoteForSession } from "@facaamigos/domain";
import { supabase } from "../lib/supabase/client.js";
import { callResilient } from "../lib/supabase/offlineQueue.js";
import { computeWorkedMinutes, monthRangeMs, type PontoKind } from "../lib/ponto.js";
import { compressImageForUpload } from "../lib/imageCompression.js";

export interface ApiError {
  error: string;
  message?: string;
}

/**
 * Sinaliza indisponibilidade do backend local para o SystemStatusOverlay,
 * sem interferir no tratamento de erro que cada tela já faz (o throw
 * continua acontecendo normalmente — isto é só um aviso em paralelo).
 */
export const systemStatus = new EventTarget();

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch (err) {
    systemStatus.dispatchEvent(new CustomEvent("backend-unreachable"));
    throw err;
  }
  systemStatus.dispatchEvent(new CustomEvent("backend-reachable"));
  if (!res.ok) {
    const body = (await res.json().catch(() => ({ error: "UNKNOWN" }))) as ApiError;
    throw new Error(body.message ?? body.error);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
};

export interface Unit {
  id: string;
  kind: "LOJA" | "QUIOSQUE";
  name: string;
  business_day_cutoff_hour: number;
  address?: string | null;
  phone?: string | null;
  cnpj?: string | null;
}

export interface Birthday {
  id: string;
  full_name: string;
  birth_date: string;
  age_turning: number;
  guardian_name: string;
  phone_e164: string;
  day_of_month: number;
  is_today: boolean;
}

export interface JobApplication {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  course: string | null;
  desired_area: string;
  opportunity_type: "ESTAGIO" | "REMUNERADO" | "BOLSA";
  resume_path: string;
  status: "NOVO" | "EM_ANALISE" | "CONTATADO" | "ARQUIVADO";
  created_at_ms: number;
}

export interface Employee {
  id: string;
  full_name: string;
  role: "OPERADOR" | "GERENTE" | "ADMIN";
  cpf?: string | null;
  email?: string | null;
  phone?: string | null;
  birth_date?: string | null;
  admission_date?: string | null;
  position?: string | null;
  contract_type?: "CLT" | "ESTAGIO" | "AUTONOMO" | null;
  weekly_hours_contracted?: number | null;
  active?: boolean;
  /** Unidades em que o colaborador atua — só preenchido por `Api.allEmployees()` (Gerencial). */
  unitIds?: string[];
}

export interface FolhaPagamentoEmployee {
  id: string;
  fullName: string;
  cpf: string | null;
  position: string | null;
  weeklyHoursContracted: number | null;
  workedMinutes: number;
  workedIncomplete: boolean;
  salaryBaseCents: number | null;
  bankCode: string | null;
  bankAgencia: string | null;
  bankAgenciaDv: string | null;
  bankConta: string | null;
  bankContaDv: string | null;
  bankAccountType: string | null;
  pixKey: string | null;
}

export interface ClosedPayrollItem {
  id: string;
  employee_id: string | null;
  full_name_snapshot: string;
  cpf_snapshot: string | null;
  bank_code_snapshot: string | null;
  bank_agencia_snapshot: string | null;
  bank_agencia_dv_snapshot: string | null;
  bank_conta_snapshot: string | null;
  bank_conta_dv_snapshot: string | null;
  bank_account_type_snapshot: string | null;
  salary_base_cents: number;
  adjustment_cents: number;
  adjustment_note: string | null;
  total_cents: number;
  hours_contracted: number | null;
  hours_worked_minutes: number | null;
}

export interface ClosedRun {
  id: string;
  year: number;
  month: number;
  totalCents: number;
  createdAtMs: number;
  items: ClosedPayrollItem[];
}

export interface PayrollCloseItem {
  employeeId: string;
  fullName: string;
  cpf: string | null;
  bankCode: string | null;
  bankAgencia: string | null;
  bankAgenciaDv: string | null;
  bankConta: string | null;
  bankContaDv: string | null;
  bankAccountType: string | null;
  salaryBaseCents: number;
  adjustmentCents: number;
  adjustmentNote: string | null;
  totalCents: number;
  hoursContracted: number | null;
  hoursWorkedMinutes: number | null;
}

/** Dados de RH preenchidos no convite de cadastro — ver OnboardingInviteScreen. */
export interface EmployeePersonalInfo {
  ctpsNumero?: string | null;
  ctpsSerie?: string | null;
  ctpsUf?: string | null;
  rgNumero?: string | null;
  rgOrgaoEmissor?: string | null;
  nomeMae?: string | null;
  nomePai?: string | null;
  estadoCivil?: string | null;
  escolaridade?: string | null;
  cep?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
}

export interface PersonalInfoStatus {
  employeeId: string;
  completed: boolean;
}

export interface CreateOnboardingInviteInput {
  role: Employee["role"];
  position: string;
  unitIds: string[];
  fullNameHint?: string;
  admissionDate?: string;
}

export interface OnboardingInviteInfo {
  position: string;
  unitNames: string[];
  fullNameHint: string | null;
}

export interface OnboardingCompleteInput {
  inviteId: string;
  token: string;
  fullName: string;
  cpf?: string;
  email?: string;
  phone?: string;
  birthDate?: string;
  pin: string;
  personalInfo?: EmployeePersonalInfo;
  pixKey?: string;
  /** Conta corrente, sem dígito da agência — só o dígito da conta é pedido. */
  bankCode?: string;
  bankAgencia?: string;
  bankConta?: string;
  bankContaDv?: string;
}

export interface NewEmployeeInput {
  fullName: string;
  role: Employee["role"];
  cpf?: string;
  email?: string;
  phone?: string;
  /** PIN de 6 dígitos escolhido pelo ADMIN para o novo colaborador — não existe login por e-mail/senha. */
  pin: string;
  birthDate?: string;
  admissionDate?: string;
  position?: string;
  contractType?: NonNullable<Employee["contract_type"]>;
  weeklyHoursContracted?: number;
}

export interface EspelhoPontoRecord {
  atMs: number;
  kind: "ENTRADA" | "SAIDA" | "INTERVALO_INICIO" | "INTERVALO_FIM";
  nsr: number;
}

export interface EspelhoPontoUnit {
  name: string;
  razaoSocial: string | null;
  nomeFantasia: string | null;
  cnpj: string | null;
  address: string | null;
  phone: string | null;
}

export interface EspelhoPonto {
  employee: {
    id: string;
    full_name: string;
    cpf: string | null;
    position: string | null;
    role: Employee["role"];
    admission_date: string | null;
    weekly_hours_contracted: number | null;
    birth_date: string | null;
    rg_numero: string | null;
    rg_orgao_emissor: string | null;
    ctps_numero: string | null;
    ctps_serie: string | null;
    ctps_uf: string | null;
  };
  units: EspelhoPontoUnit[];
  records: EspelhoPontoRecord[];
  year: number;
  month: number;
  timezone: string;
}

export interface Plan {
  id: string;
  activity: "PLAYGROUND" | "CARRINHO";
  name: string;
  valueCents: number;
  durationValue: number;
  durationUnit: "MINUTO" | "HORA";
  overageCentsPerMinute: number;
  color: string;
  active?: boolean;
  /** Só preenchido por `Api.plansAllUnits()` (Gerencial). */
  unitId?: string;
}

export interface Asset {
  id: string;
  unit_id: string;
  name: string;
  emoji: string;
  color: string;
  status: "DISPONIVEL" | "EM_USO" | "MANUTENCAO";
  odometer_minutes: number;
  photo_url: string | null;
}

export interface Product {
  id: string;
  name: string;
  description: string | null;
  emoji: string | null;
  price_cents: number;
  stock: number;
  active?: boolean;
  /** Só preenchido por `Api.productsAllUnits()` (Gerencial). */
  unit_id?: string;
}

/**
 * Dados fiscais do emitente. NFC-e (modelo 65, mercadoria, autorizada pela
 * SVRS desde que a SEFA-PA desativou os webservices próprios) e o CADASTRO
 * de NFS-e (serviço, ISS, Prefeitura de Belém) — a emissão de NFS-e está
 * fora de escopo, ver migration 20260807000004.
 *
 * Nenhum segredo trafega aqui: `nfce_csc_id` é só o identificador do CSC
 * (ex. '000001'), que não é secreto. O TOKEN do CSC e o certificado A1
 * (.pfx) vivem exclusivamente no cofre local do PC do balcão.
 */
export interface UnitFiscal {
  id: string;
  name: string;
  cnpj: string | null;
  razao_social: string | null;
  nome_fantasia: string | null;
  inscricao_estadual: string | null;
  inscricao_municipal: string | null;
  cnae_principal: string | null;
  crt: number | null;
  end_logradouro: string | null;
  end_numero: string | null;
  end_complemento: string | null;
  end_bairro: string | null;
  end_municipio_ibge: string | null;
  end_uf: string | null;
  end_cep: string | null;
  fone: string | null;
  fiscal_ambiente: string | null;
  fiscal_enabled: boolean | null;
  nfce_serie: number | null;
  nfce_csc_id: string | null;
  nfce_qrcode_url_consulta: string | null;
  nfse_item_lista_servico: string | null;
  nfse_codigo_tributacao_municipio: string | null;
  nfse_aliquota_iss_bp: number | null;
  nfse_iss_retido: boolean | null;
  nfse_regime_especial: number | null;
  nfse_serie_rps: string | null;
  nfse_ambiente: string | null;
  nfse_enabled: boolean | null;
}

/** Tributação por item — sem NCM/CFOP/CSOSN a NFC-e é rejeitada. */
export interface ProductFiscal {
  id: string;
  name: string;
  ncm: string | null;
  cest: string | null;
  cfop: string | null;
  csosn: string | null;
  origem: number | null;
  unidade_comercial: string | null;
  gtin: string | null;
  pis_cst: string | null;
  cofins_cst: string | null;
}

export interface FiscalTerminalStatus {
  unit_id: string;
  terminal_id: string;
  worker_version: string | null;
  cert_subject_cn: string | null;
  cert_not_after_ms: number | null;
  csc_configured: boolean;
  environment: string | null;
  last_heartbeat_ms: number;
  last_error: string | null;
}

export interface ChildMatch {
  id: string;
  full_name: string;
  birth_date: string;
  phone_e164: string | null;
  guardian_name: string | null;
  cpf: string | null;
  /** Check-ins na janela móvel do motor VIP (30 dias por padrão). */
  visits_in_window: number;
  /** Selo VIP: atingiu o número de visitas na janela. Decidido no banco. */
  is_vip: boolean;
}

/**
 * Pacote de recorrência vendável como upgrade (`fa_kiosk_packages`).
 *
 * Não confundir com `Plan`: plano é a permanência avulsa desta visita
 * (15 min, 1 hora); pacote é o produto mensal, com saldo de horas e
 * validade, que o motor de cross-selling oferece.
 */
export interface Package {
  id: string;
  activity: "PLAYGROUND" | "CARRINHO";
  name: string;
  priceCents: number;
  includedMinutes: number;
  validityDays: number;
  benefitText: string;
  color: string;
  active: boolean;
  /** Só preenchido por `Api.packagesAllUnits()` (Gerencial). */
  unitId?: string;
}

/**
 * Resposta de `fa_upsell_offer`. Como em `ResolvedAccessCode`, cada
 * `reason` é uma situação real de balcão e não um erro — "esta criança
 * não tem oferta hoje" é o caso comum:
 *
 *   OK                   há oferta; o card de conversão deve aparecer
 *   SEM_VIP              ainda não bateu as 4 visitas na janela
 *   COOLDOWN             o responsável recusou há menos de 15 dias
 *   JA_TEM_PACOTE        já comprou e ainda tem saldo — não se oferece de novo
 *   SEM_GASTO_NO_MES     sem avulsos pagos no mês: não há âncora de preço
 *   SEM_HORAS_APURADAS   sem tempo fechado no mês: o custo/hora seria inventado
 *   SEM_PACOTE_SUPERIOR  nenhum pacote acima do gasto que baixe o custo/hora
 *   SEM_RESPONSAVEL      criança sem vínculo — nada a ofertar a ninguém
 */
export type UpsellReason =
  | "OK"
  | "SEM_VIP"
  | "COOLDOWN"
  | "JA_TEM_PACOTE"
  | "SEM_GASTO_NO_MES"
  | "SEM_HORAS_APURADAS"
  | "SEM_PACOTE_SUPERIOR"
  | "SEM_RESPONSAVEL"
  | "UNIDADE_INVALIDA"
  | "CRIANCA_INVALIDA";

export interface UpsellOffer {
  eligible: boolean;
  reason: UpsellReason;
  isVip?: boolean;
  visitsInWindow?: number;
  visitsWindowDays?: number;
  visitsRequired?: number;
  cooldownUntilMs?: number;
  offerId?: string;
  guardianId?: string;
  guardianName?: string;
  childId?: string;
  childName?: string;
  spendCents?: number;
  consumedMinutes?: number;
  package?: {
    id: string;
    name: string;
    priceCents: number;
    includedMinutes: number;
    validityDays: number;
    benefitText: string;
    color: string;
  };
  deltaCents?: number;
  hourlyAvulsoCents?: number;
  hourlyPlanCents?: number;
  /** Script já parametrizado, montado no banco. A UI só o exibe. */
  scriptText?: string;
}

/**
 * Chaves de `fa_kiosk_app_settings` que a UI lê/escreve. É uma união
 * fechada, e não `string`, para que uma chave digitada errado falhe no
 * build em vez de gravar em silêncio uma configuração que ninguém lê.
 */
export type UnitSettingKey =
  | "daily_goal_cents"
  | "terms_of_use"
  | "closing_time"
  | "printer_wristband"
  | "printer_receipt"
  // Calibragem do motor de cross-selling (ver migration 20260807000008).
  | "upsell_vip_visits"
  | "upsell_vip_window_days"
  | "upsell_cooldown_days"
  // Cross-sell rápido (produto único, ex.: "Água") oferecido ao selecionar
  // um plano de permanência a partir de N minutos. Ver migration
  // fa_kiosk_session_extra_items_upsell.
  | "upsell_quick_product_id"
  | "upsell_quick_trigger_minutes"
  // Modelo do contrato de prestação de serviços dos planos acima de 2h
  // (banco de horas). Editável no Gerencial > Contrato; impresso em A4.
  | "hour_bank_contract_template"
  // Validade do banco de horas em dias (padrão 45 — mesmo default do banco).
  | "hour_bank_validity_days";

export interface VipFlag {
  child_id: string;
  visits_in_window: number;
  is_vip: boolean;
}

/** Saldo do banco de horas de uma criança (`fa_kiosk_hour_bank_balance`). */
export interface HourBankBalance {
  child_id: string;
  remaining_minutes: number;
  /** Vencimento mais próximo entre os créditos válidos — o que a Entrada mostra. */
  next_expiry_ms: number;
}

/** Dados cadastrais do Contratante para o contrato dos planos >2h. */
export interface GuardianContractInfo {
  id: string;
  fullName: string;
  cpf: string | null;
  rg: string | null;
  email: string | null;
  phone: string | null;
  addressLine: string | null;
  addressCity: string | null;
  addressState: string | null;
  addressZip: string | null;
}

/**
 * Resposta de `fa_resolve_access_code`. Cada `reason` é uma situação real de
 * balcão, não um erro genérico:
 *
 *   OK             sessão ativa encontrada, pode seguir para o pagamento
 *   PAUSADA        criança está com o tempo pausado — retomar antes de fechar
 *   CODIGO_INVALIDO leu outra coisa, ou o dígito verificador não bate
 *   NAO_ENCONTRADO código válido, mas nenhuma sessão com ele
 *   OUTRA_UNIDADE  pulseira de outra operação/módulo
 *   JA_FINALIZADA  essa criança já saiu (leitura duplicada da mesma pulseira)
 */
export interface ResolvedAccessCode {
  reason: "OK" | "PAUSADA" | "CODIGO_INVALIDO" | "NAO_ENCONTRADO" | "OUTRA_UNIDADE" | "JA_FINALIZADA";
  code?: string;
  sessionId?: string;
  childName?: string;
  guardianName?: string;
  guardianPhone?: string;
  checkinAtMs?: number;
  checkoutAtMs?: number;
  notes?: string | null;
  sensoryTags?: string[];
}

export interface AuthorizedGuardian {
  guardianId: string;
  fullName: string;
  cpf: string | null;
  phone: string | null;
  isPrimary: boolean;
}

export type SessionPhase = "VERDE" | "AMARELO" | "VERMELHO" | "EXCEDENTE";

export interface QuoteLine {
  label: string;
  cents: number;
}

export interface ActiveSessionEntry {
  plan: { id: string; name: string; color: string };
  asset: { id: string; name: string; emoji: string; photo_url: string | null } | null;
  session: {
    id: string;
    child_id: string;
    child_name_snapshot: string;
    activity: "PLAYGROUND" | "CARRINHO";
    checkin_at_ms: number;
    checkin_by_employee_id?: string | null;
    asset_id: string | null;
    wristband_code?: string;
    /** Código curto impresso na pulseira e no recibo de guarda (11 caracteres). */
    access_code?: string | null;
    guardian_name_snapshot?: string;
    guardian_phone_snapshot?: string;
    child_birth_date?: string;
    notes?: string;
    sensory_tags?: string[];
    paused_at_ms: number | null;
    paused_ms_total: number;
    /** Minutos de pacote pré-pago ainda válidos do responsável, se houver. */
    package_balance_minutes?: number;
    /** Entrada feita pelo banco de horas da criança (sem plano vendido). */
    uses_hour_bank?: boolean;
    /** Saldo alocado no check-in — a "duração do plano" da sessão de banco. */
    hour_bank_allocated_minutes?: number;
  };
  quote: {
    lines: QuoteLine[];
    totalCents: number;
    timing: { phase: SessionPhase; elapsedMs: number; durationMs: number; overMinutes: number; isPaused: boolean; pausedForMs: number };
  };
}

export interface Shift {
  id: string;
  unit_id: string;
  status: "ABERTO" | "FECHADO";
  opening_cash_cents: number;
  opened_at_ms: number;
}

export interface CashMovement {
  id: string;
  kind: "TROCO_INICIAL" | "SANGRIA" | "SUPRIMENTO" | "AJUSTE";
  amount_cents: number;
  reason: string | null;
  envelope_number: string | null;
  photo_url: string | null;
  employee_id: string;
  at_ms: number;
}

export interface UnitShiftRow {
  id: string;
  unit_id: string;
  status: "ABERTO" | "FECHADO";
  opening_cash_cents: number;
  opened_at_ms: number;
  closed_at_ms: number | null;
  opened_by_employee_id: string;
  closed_by_employee_id: string | null;
}

export interface EnvelopeMovement {
  id: string;
  shift_id: string;
  amount_cents: number;
  reason: string | null;
  envelope_number: string | null;
  photo_url: string | null;
  employee_id: string;
  at_ms: number;
  fa_kiosk_shifts: { unit_id: string }[];
}

export interface UnitEnvelopeBalance {
  unit_id: string;
  unit_name: string;
  pending_cents: number;
  pending_count: number;
  oldest_pending_at_ms: number | null;
  last_collected_at_ms: number | null;
}

export interface UnitCashStatus {
  unit_id: string;
  unit_name: string;
  shift_id: string | null;
  status: "ABERTO" | "FECHADO" | null;
  opened_at_ms: number | null;
  closed_at_ms: number | null;
  opening_cash_cents: number | null;
  current_cash_cents: number | null;
}

export interface ShiftSale {
  orderId: string;
  orderCode: string | null;
  kind: "SESSAO" | "PDV";
  createdAtMs: number;
  method: string;
  amountCents: number;
  discountCents: number;
  childNames: string;
  guardianName: string | null;
  productsSummary: string | null;
}

export interface BonusRule {
  id: string;
  unitId: string;
  description: string;
  rewardValueCents: number;
  active?: boolean;
}

export interface Coupon {
  id: string;
  code: string;
  kind: "MINUTOS_EXTRA" | "DESCONTO_PCT" | "DESCONTO_VALOR";
  value: number;
  max_uses: number;
  used_count: number;
  active: boolean | number;
  description: string | null;
  /** Só preenchido por `Api.couponsAllUnits()` (Gerencial). */
  unitId?: string;
}

export interface LoyaltyRule {
  id: string;
  activity: "PLAYGROUND" | "CARRINHO" | "AMBOS";
  triggerVisits: number;
  rewardKind: "ENTRADA_GRATIS" | "DESCONTO_PCT" | "MINUTOS_EXTRA";
  rewardValue: number;
  /** Só preenchido por `Api.loyaltyRulesAllUnits()` (Gerencial). */
  unitId?: string;
}

export interface RedeemableReward {
  id: string;
  rule_id: string;
  earned_at_ms: number;
}

export interface SessionEvent {
  id: string;
  kind: string;
  at_ms: number;
  employee_name: string | null;
  payload: Record<string, unknown> | null;
}

export interface PontoRecord {
  id: string;
  employee_id: string;
  kind: "ENTRADA" | "SAIDA" | "INTERVALO_INICIO" | "INTERVALO_FIM";
  nsr: number;
  at_ms: number;
}

export interface DailySales {
  business_date: string;
  orders_count: number;
  total_cents: number;
}
export interface RevenueByMethod {
  method: string;
  total_cents: number;
}
export interface DailyVisits {
  business_date: string;
  sessions_count: number;
}
export interface BirthdayChild {
  id: string;
  full_name: string;
  birth_date: string;
}
export interface AssetUsage {
  id: string;
  name: string;
  emoji: string;
  color: string;
  sessions_count: number;
  total_minutes: number;
}
export interface ShiftSummary {
  id: string;
  opened_at_ms: number;
  closed_at_ms: number | null;
  status: "ABERTO" | "FECHADO";
  declared_json: string | null;
  expected_json: string | null;
}
export interface FolhaPontoRow {
  employee_id: string;
  full_name: string;
  weekly_hours_contracted: number | null;
  kind: string;
  at_ms: number;
  nsr: number;
}
export interface PlanSold {
  plan_id: string;
  plan_name: string;
  plan_color: string;
  activity: "PLAYGROUND" | "CARRINHO";
  sessions_count: number;
}
/**
 * Um registro por entrada. `id` é o identificador estável da sessão (nunca
 * muda, nunca se repete, mesmo para a mesma criança/responsável em dias e
 * horários diferentes) — é a referência para rastreio posterior por
 * questões jurídicas. `access_code` é o código curto impresso na pulseira
 * e no recibo: operacional, não é a chave de auditoria.
 */
export interface SessionAudit {
  id: string;
  unit_id: string;
  access_code: string | null;
  checkin_at_ms: number;
  checkout_at_ms: number | null;
  status: string;
  activity: "PLAYGROUND" | "CARRINHO";
  child_name: string;
  guardian_name: string;
  guardian_phone: string | null;
  guardian_cpf: string | null;
  plan_name: string | null;
  employee_name: string | null;
}

/**
 * Data do dia operacional (AAAA-MM-DD) de uma unidade. O dia só vira
 * depois do `business_day_cutoff_hour`, então um check-in de 1h da manhã
 * ainda conta para o movimento do dia anterior. Espelha a função SQL
 * `fa_kiosk_business_date`, que é quem grava `business_date` nas tabelas.
 */
export function businessDateFor(nowMs: number, cutoffHour: number): string {
  const shifted = new Date(nowMs - cutoffHour * 3600_000);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}-${String(shifted.getDate()).padStart(2, "0")}`;
}

function planFromRow(row: Record<string, unknown>): Plan {
  return {
    id: row.id as string,
    activity: row.activity as Plan["activity"],
    name: row.name as string,
    valueCents: row.value_cents as number,
    durationValue: row.duration_value as number,
    durationUnit: row.duration_unit as Plan["durationUnit"],
    overageCentsPerMinute: row.overage_cents_per_minute as number,
    color: row.color as string,
    active: Boolean(row.active),
    unitId: row.unit_id as string | undefined,
  };
}

function packageFromRow(row: Record<string, unknown>): Package {
  return {
    id: row.id as string,
    activity: row.activity as Package["activity"],
    name: row.name as string,
    priceCents: row.price_cents as number,
    includedMinutes: row.included_minutes as number,
    validityDays: row.validity_days as number,
    benefitText: row.benefit_text as string,
    color: row.color as string,
    active: Boolean(row.active),
    unitId: row.unit_id as string | undefined,
  };
}

function bonusRuleFromRow(row: Record<string, unknown>): BonusRule {
  return {
    id: row.id as string,
    unitId: row.unit_id as string,
    description: row.description as string,
    rewardValueCents: row.reward_value_cents as number,
    active: Boolean(row.active),
  };
}

function couponFromRow(row: Record<string, unknown>): Coupon {
  return {
    id: row.id as string,
    code: row.code as string,
    kind: row.kind as Coupon["kind"],
    value: row.value as number,
    max_uses: row.max_uses as number,
    used_count: row.used_count as number,
    active: row.active ? 1 : 0,
    description: (row.description as string | null) ?? null,
    unitId: row.unit_id as string | undefined,
  };
}

function loyaltyRuleFromRow(row: Record<string, unknown>): LoyaltyRule {
  return {
    id: row.id as string,
    activity: row.activity as LoyaltyRule["activity"],
    triggerVisits: row.trigger_visits as number,
    rewardKind: row.reward_kind as LoyaltyRule["rewardKind"],
    rewardValue: row.reward_value as number,
    unitId: row.unit_id as string | undefined,
  };
}

async function unwrap<T>(promise: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await promise;
  if (error) throw new Error(error.message);
  return data as T;
}

export interface ActiveSessionsRaw {
  sessions: Record<string, unknown>[];
  planById: Map<string, Plan>;
  guardianById: Map<string, Record<string, unknown>>;
  assetById: Map<string, Record<string, unknown>>;
  childById: Map<string, Record<string, unknown>>;
  /** Saldo de pacote ainda válido, por responsável (minutos). */
  packageBalanceByGuardian: Map<string, number>;
}

/**
 * Busca os dados crus (sem cálculo de tempo/valor, que muda a cada
 * segundo). Separado de `computeActiveSessionEntries` para permitir
 * recalcular a contagem regressiva localmente a cada tick (Fase 3 —
 * substitui o antigo canal WS de 1Hz) sem refazer a consulta ao banco.
 */
export async function fetchActiveSessionsRaw(unitId: string): Promise<ActiveSessionsRaw> {
  const sessions = await unwrap<Record<string, unknown>[]>(
    supabase().from("fa_kiosk_sessions").select("*").eq("unit_id", unitId).eq("status", "ATIVA"),
  );
  if (sessions.length === 0)
    return {
      sessions: [],
      planById: new Map(),
      guardianById: new Map(),
      assetById: new Map(),
      childById: new Map(),
      packageBalanceByGuardian: new Map(),
    };

  // Sessões de banco de horas não têm plano (plan_id nulo) — não entram
  // na consulta de planos; o pseudo-plano delas é montado no compute.
  const planIds = [...new Set(sessions.map((s) => s.plan_id as string | null).filter((id): id is string => Boolean(id)))];
  const guardianIds = [...new Set(sessions.map((s) => s.guardian_id as string))];
  const assetIds = [...new Set(sessions.map((s) => s.asset_id as string | null).filter((id): id is string => Boolean(id)))];
  const childIds = [...new Set(sessions.map((s) => s.child_id as string))];
  const [plans, guardians, assets, children, balances] = await Promise.all([
    unwrap<Record<string, unknown>[]>(supabase().from("fa_kiosk_plans").select("*").in("id", planIds)),
    unwrap<Record<string, unknown>[]>(supabase().from("fa_kiosk_guardians").select("id, full_name, phone_e164").in("id", guardianIds)),
    assetIds.length === 0
      ? Promise.resolve([])
      : unwrap<Record<string, unknown>[]>(supabase().from("fa_kiosk_assets").select("id, name, emoji, photo_url").in("id", assetIds)),
    unwrap<Record<string, unknown>[]>(supabase().from("fa_kiosk_children").select("id, birth_date").in("id", childIds)),
    // Saldo de pacote pré-pago. Sem isto o card mostraria o preço cheio e o
    // fechamento cobraria menos — o operador leria a diferença como erro do
    // sistema justamente na frente do cliente que comprou o pacote.
    unwrap<{ guardian_id: string; remaining_minutes: number }[]>(
      supabase().rpc("fa_kiosk_guardian_package_balance", { p_unit_id: unitId, p_guardian_ids: guardianIds }),
    ).catch(() => []),
  ]);
  return {
    sessions,
    planById: new Map(plans.map((p) => [p.id as string, planFromRow(p)])),
    guardianById: new Map(guardians.map((g) => [g.id as string, g])),
    assetById: new Map(assets.map((a) => [a.id as string, a])),
    childById: new Map(children.map((c) => [c.id as string, c])),
    packageBalanceByGuardian: new Map(balances.map((b) => [b.guardian_id, b.remaining_minutes])),
  };
}

export function computeActiveSessionEntries(raw: ActiveSessionsRaw, nowMs: number): ActiveSessionEntry[] {
  return raw.sessions.map((row) => {
    const usesHourBank = Boolean(row.uses_hour_bank);
    // Sessão de banco de horas: não existe plano vendido. O pseudo-plano
    // reusa o mesmo motor de preço — valor 0, duração = saldo alocado no
    // check-in e excedente pela tarifa congelada do crédito de origem.
    const plan: Plan = usesHourBank
      ? {
          id: "HOUR_BANK",
          activity: row.activity as Plan["activity"],
          name: "Banco de Horas",
          valueCents: 0,
          durationValue: (row.hour_bank_allocated_minutes as number | null) ?? 0,
          durationUnit: "MINUTO",
          overageCentsPerMinute: (row.hour_bank_overage_cents_per_minute as number | null) ?? 0,
          color: "#2ECFB5",
        }
      : raw.planById.get(row.plan_id as string)!;
    const guardian = raw.guardianById.get(row.guardian_id as string);
    const assetRow = row.asset_id ? raw.assetById.get(row.asset_id as string) : undefined;
    const childRow = raw.childById.get(row.child_id as string);
    const quote = quoteForSession(
      plan,
      {
        checkinAtMs: row.checkin_at_ms as number,
        childName: row.child_name_snapshot as string,
        planId: row.plan_id as string,
        couponDiscountCents: row.coupon_discount_cents as number,
        couponCode: null,
        freeFromLoyalty: Boolean(row.free_from_loyalty),
        pausedAtMs: (row.paused_at_ms as number | null) ?? null,
        pausedMsTotal: (row.paused_ms_total as number) ?? 0,
      },
      nowMs,
    );
    return {
      session: {
        id: row.id as string,
        child_id: row.child_id as string,
        child_name_snapshot: row.child_name_snapshot as string,
        activity: row.activity as "PLAYGROUND" | "CARRINHO",
        checkin_at_ms: row.checkin_at_ms as number,
        checkin_by_employee_id: (row.checkin_by_employee_id as string | null) ?? null,
        asset_id: row.asset_id as string | null,
        wristband_code: row.wristband_code as string,
        access_code: (row.access_code as string | null) ?? null,
        guardian_name_snapshot: (guardian?.full_name as string) ?? undefined,
        guardian_phone_snapshot: (guardian?.phone_e164 as string) ?? undefined,
        child_birth_date: (childRow?.birth_date as string) ?? undefined,
        // Estes dois chegavam do banco no select("*") e eram descartados
        // aqui — por isso o alerta de cuidados no card do Painel e o "OBS"
        // da etiqueta nunca apareciam, mesmo com a tela de Entrada tendo um
        // seletor de tags sensoriais desde o começo.
        notes: (row.notes as string | null) ?? undefined,
        sensory_tags: (row.sensory_tags as string[] | null) ?? undefined,
        paused_at_ms: (row.paused_at_ms as number | null) ?? null,
        paused_ms_total: (row.paused_ms_total as number) ?? 0,
        package_balance_minutes: raw.packageBalanceByGuardian.get(row.guardian_id as string),
        uses_hour_bank: usesHourBank,
        hour_bank_allocated_minutes: (row.hour_bank_allocated_minutes as number | null) ?? undefined,
      },
      quote,
      plan: { id: plan.id, name: plan.name, color: plan.color },
      asset: assetRow
        ? {
            id: assetRow.id as string,
            name: assetRow.name as string,
            emoji: assetRow.emoji as string,
            photo_url: (assetRow.photo_url as string | null) ?? null,
          }
        : null,
    };
  });
}

async function fetchActiveSessions(unitId: string, nowMs: number = Date.now()): Promise<ActiveSessionEntry[]> {
  return computeActiveSessionEntries(await fetchActiveSessionsRaw(unitId), nowMs);
}

export const Api = {
  units: () =>
    unwrap<Unit[]>(
      supabase().from("fa_kiosk_units").select("id, kind, name, business_day_cutoff_hour, address, phone, cnpj"),
    ),
  employees: () =>
    unwrap<Employee[]>(
      supabase()
        .from("fa_kiosk_employees")
        .select("id, full_name, role, cpf, email, phone, birth_date, admission_date, position, contract_type, weekly_hours_contracted, active")
        .eq("active", true)
        .order("full_name"),
    ),
  allEmployees: async () => {
    const [employees, links] = await Promise.all([
      unwrap<Employee[]>(
        supabase()
          .from("fa_kiosk_employees")
          .select("id, full_name, role, cpf, email, phone, birth_date, admission_date, position, contract_type, weekly_hours_contracted, active")
          .order("full_name"),
      ),
      unwrap<{ employee_id: string; unit_id: string }[]>(supabase().from("fa_kiosk_employee_units").select("employee_id, unit_id")),
    ]);
    const unitIdsByEmployee = new Map<string, string[]>();
    for (const link of links) {
      unitIdsByEmployee.set(link.employee_id, [...(unitIdsByEmployee.get(link.employee_id) ?? []), link.unit_id]);
    }
    return employees.map((e) => ({ ...e, unitIds: unitIdsByEmployee.get(e.id) ?? [] }));
  },
  plans: async (unitId: string, activity: string, onlyActive = true) => {
    let query = supabase().from("fa_kiosk_plans").select("*").eq("unit_id", unitId).eq("activity", activity);
    if (onlyActive) query = query.eq("active", true);
    const rows = await unwrap<Record<string, unknown>[]>(query);
    return rows.map(planFromRow);
  },
  /** Todos os planos de todas as unidades — Gerencial. */
  plansAllUnits: async () => {
    const rows = await unwrap<Record<string, unknown>[]>(supabase().from("fa_kiosk_plans").select("*"));
    return rows.map(planFromRow);
  },
  assets: (unitId: string) =>
    unwrap<Asset[]>(
      supabase()
        .from("fa_kiosk_assets")
        .select("id, unit_id, name, emoji, color, status, odometer_minutes, photo_url")
        .eq("unit_id", unitId),
    ),
  products: (unitId: string, onlyActive = true) => {
    let query = supabase()
      .from("fa_kiosk_products")
      .select("id, name, description, emoji, price_cents, stock, active")
      .eq("unit_id", unitId);
    if (onlyActive) query = query.eq("active", true);
    return unwrap<Product[]>(query);
  },
  /** Todos os produtos de todas as unidades — Gerencial. */
  productsAllUnits: () =>
    unwrap<Product[]>(
      supabase().from("fa_kiosk_products").select("id, name, description, emoji, price_cents, stock, active, unit_id"),
    ),
  // `unitId` é opcional só porque o limiar do selo VIP tem padrão global;
  // passando-o, a busca respeita o limiar configurado para a unidade.
  searchChildren: async (q: string, unitId?: string) => {
    if (!q || q.length < 2) return [];
    return unwrap<ChildMatch[]>(
      supabase().rpc("fa_kiosk_search_children", { p_query: q, p_unit_id: unitId ?? null }),
    );
  },
  /**
   * Cuidados inclusivos registrados na última visita da criança.
   *
   * Necessidade sensorial não muda de uma visita para a outra: obrigar o
   * operador a remarcar "usa abafador" toda vez é o tipo de recadastro que
   * na prática deixa de ser feito na correria — e aí o monitor não recebe a
   * informação. Vem preenchido e pode ser alterado.
   */
  lastCareForChild: async (childId: string) => {
    const row = await unwrap<{ notes: string | null; sensory_tags: string[] | null } | null>(
      supabase()
        .from("fa_kiosk_sessions")
        .select("notes, sensory_tags")
        .eq("child_id", childId)
        .order("checkin_at_ms", { ascending: false })
        .limit(1)
        .maybeSingle(),
    );
    return { notes: row?.notes ?? "", sensoryTags: row?.sensory_tags ?? [] };
  },
  lastAssetForChild: async (childId: string) => {
    const assetId = await unwrap<string | null>(supabase().rpc("fa_kiosk_last_asset_for_child", { p_child_id: childId }));
    return { assetId };
  },
  activeSessions: (unitId: string) => fetchActiveSessions(unitId),

  // ── Motor de cross-selling ─────────────────────────────────────────
  /**
   * Oferta de upgrade para esta criança, ou o motivo de não haver.
   *
   * Nunca lança por "não tem oferta": a tela chama isto a cada criança
   * identificada no balcão, e o não-elegível é a maioria dos casos. Só
   * falha de rede/permissão vira exceção.
   */
  upsellOffer: (unitId: string, childId: string, guardianId?: string | null, employeeId?: string | null) =>
    unwrap<UpsellOffer>(
      supabase().rpc("fa_upsell_offer", {
        p_unit_id: unitId,
        p_child_id: childId,
        p_guardian_id: guardianId ?? null,
        p_employee_id: employeeId ?? null,
      }),
    ),
  /** Recusa registrada + cooldown de 15 dias aplicado ao responsável. */
  upsellRecusar: (offerId: string, employeeId?: string | null) =>
    unwrap<{ outcome: string; cooldownUntilMs: number; cooldownDays: number }>(
      supabase().rpc("fa_upsell_recusar", { p_offer_id: offerId, p_employee_id: employeeId ?? null }),
    ),
  /**
   * Aceite: cobra a DIFERENÇA anunciada no script, gera o pedido, o saldo
   * do pacote e o comprovante impresso — tudo na mesma transação do banco.
   * O valor não é enviado daqui de propósito: quem decide quanto cobrar é
   * a oferta gravada, não a tela.
   */
  upsellVenderPacote: (body: {
    offerId: string;
    employeeId: string;
    payments: { method: string; amountCents: number }[];
  }) =>
    callResilient<{
      orderId: string;
      orderCode: string;
      chargedCents: number;
      guardianPackageId: string;
      expiresAtMs: number;
    }>("fa_upsell_vender_pacote", {
      p_offer_id: body.offerId,
      p_payments: body.payments,
      p_employee_id: body.employeeId,
    }),
  /**
   * Cross-sell rápido: adiciona um produto único (ex.: "Água") à comanda
   * da sessão, cobrado junto no fechamento (fa_checkout). Diferente do
   * upgrade de pacote (upsellVenderPacote) — aqui não há cobrança
   * imediata nem ancoragem, é só um item extra que entra na conta.
   */
  addSessionExtra: (sessionId: string, productId: string, employeeId: string, quantity = 1) =>
    unwrap<void>(
      supabase().rpc("fa_kiosk_add_session_extra", {
        p_session_id: sessionId,
        p_product_id: productId,
        p_quantity: quantity,
        p_employee_id: employeeId,
      }),
    ),
  /** Selo VIP de várias crianças numa consulta só (cards do Painel). */
  vipFlags: async (unitId: string, childIds: string[]) => {
    if (childIds.length === 0) return new Map<string, VipFlag>();
    const rows = await unwrap<VipFlag[]>(
      supabase().rpc("fa_kiosk_vip_flags", { p_unit_id: unitId, p_child_ids: childIds }),
    );
    return new Map(rows.map((r) => [r.child_id, r]));
  },
  packages: async (unitId: string, onlyActive = true) => {
    let query = supabase().from("fa_kiosk_packages").select("*").eq("unit_id", unitId);
    if (onlyActive) query = query.eq("active", true);
    const rows = await unwrap<Record<string, unknown>[]>(query.order("price_cents"));
    return rows.map(packageFromRow);
  },
  /** Todos os pacotes de todas as unidades — Gerencial. */
  packagesAllUnits: async () => {
    const rows = await unwrap<Record<string, unknown>[]>(supabase().from("fa_kiosk_packages").select("*").order("price_cents"));
    return rows.map(packageFromRow);
  },
  createPackage: (body: {
    unitId: string;
    activity: Package["activity"];
    name: string;
    priceCents: number;
    includedMinutes: number;
    validityDays: number;
    benefitText: string;
    color: string;
  }) =>
    unwrap<{ id: string }>(
      supabase()
        .from("fa_kiosk_packages")
        .insert({
          unit_id: body.unitId,
          activity: body.activity,
          name: body.name,
          price_cents: body.priceCents,
          included_minutes: body.includedMinutes,
          validity_days: body.validityDays,
          benefit_text: body.benefitText,
          color: body.color,
        })
        .select("id")
        .single(),
    ),
  setPackageActive: (id: string, active: boolean) =>
    unwrap(supabase().from("fa_kiosk_packages").update({ active }).eq("id", id)),
  updatePackage: (id: string, body: { name: string; priceCents: number; includedMinutes: number; validityDays: number; benefitText: string; color: string }) =>
    unwrap(supabase().from("fa_kiosk_packages").update({
      name: body.name,
      price_cents: body.priceCents,
      included_minutes: body.includedMinutes,
      validity_days: body.validityDays,
      benefit_text: body.benefitText,
      color: body.color,
    }).eq("id", id)),
  redeemableRewards: (childId: string) =>
    unwrap<RedeemableReward[]>(
      supabase()
        .from("fa_kiosk_loyalty_rewards")
        .select("id, rule_id, earned_at_ms")
        .eq("child_id", childId)
        .is("redeemed_at_ms", null),
    ),
  currentShift: (unitId: string) =>
    unwrap<Shift | null>(
      supabase()
        .from("fa_kiosk_shifts")
        .select("id, unit_id, status, opening_cash_cents, opened_at_ms")
        .eq("unit_id", unitId)
        .eq("status", "ABERTO")
        .maybeSingle(),
    ),

  /** Saldo do banco de horas (planos >2h) por criança — vale em qualquer unidade. */
  hourBankBalances: async (childIds: string[]) => {
    if (childIds.length === 0) return new Map<string, HourBankBalance>();
    const rows = await unwrap<HourBankBalance[]>(
      supabase().rpc("fa_kiosk_hour_bank_balance", { p_child_ids: childIds }),
    );
    return new Map(rows.map((r) => [r.child_id, r]));
  },
  /** Dados cadastrais do responsável para preencher o contrato dos planos >2h. */
  guardianContractInfo: (guardianId: string) =>
    unwrap<GuardianContractInfo>(
      supabase().rpc("fa_kiosk_guardian_contract_info", { p_guardian_id: guardianId }),
    ),
  updateGuardianContractInfo: (body: {
    guardianId: string;
    rg?: string;
    email?: string;
    addressLine?: string;
    addressCity?: string;
    addressState?: string;
    addressZip?: string;
  }) =>
    unwrap<void>(
      supabase().rpc("fa_kiosk_guardian_contract_info_update", {
        p_guardian_id: body.guardianId,
        p_rg: body.rg ?? null,
        p_email: body.email ?? null,
        p_address_line: body.addressLine ?? null,
        p_address_city: body.addressCity ?? null,
        p_address_state: body.addressState ?? null,
        p_address_zip: body.addressZip ?? null,
      }),
    ),

  checkin: (body: {
    unitId: string;
    activity: "PLAYGROUND" | "CARRINHO";
    assetId?: string;
    /** Nulo quando a entrada é pelo banco de horas (useHourBank). */
    planId: string | null;
    /** Entrada pelo saldo do banco de horas da criança (exige criança já cadastrada). */
    useHourBank?: boolean;
    employeeId: string;
    child: { id?: string; fullName: string; birthDate: string; inclusiveEligible: boolean; inclusiveProofType?: string };
    guardian: { id?: string; fullName: string; cpf: string; phoneE164: string };
    couponCode?: string;
    notes?: string;
    sensoryTags?: string[];
  }) =>
    // fa_checkin também enfileira, na mesma transação, a pulseira e o recibo
    // de guarda. Nenhuma tela precisa disparar impressão no check-in: se a
    // RPC voltou, as duas vias já estão na fila do print bridge.
    callResilient<{
      sessionId: string;
      childId: string;
      guardianId: string;
      accessCode: string;
      /** PIN numérico de 4 dígitos para digitação rápida na Saída (único do dia). */
      exitPin: string;
      wristbandCode: string;
      ticketCode: string;
      /** Minutos do banco de horas alocados nesta entrada (só quando useHourBank). */
      hourBankAllocatedMinutes: number | null;
    }>(
      "fa_checkin",
      {
        p_unit_id: body.unitId,
        p_activity: body.activity,
        p_plan_id: body.planId,
        p_use_hour_bank: body.useHourBank ?? false,
        p_asset_id: body.assetId ?? null,
        p_guardian: { id: body.guardian.id, fullName: body.guardian.fullName, cpf: body.guardian.cpf, phoneE164: body.guardian.phoneE164 },
        p_child: {
          id: body.child.id,
          fullName: body.child.fullName,
          birthDate: body.child.birthDate,
          inclusiveEligible: body.child.inclusiveEligible,
          inclusiveProofType: body.child.inclusiveProofType,
        },
        p_coupon_code: body.couponCode ?? null,
        p_employee_id: body.employeeId,
        p_notes: body.notes ?? null,
        p_sensory_tags: body.sensoryTags && body.sensoryTags.length > 0 ? body.sensoryTags : null,
      },
    ),
  /**
   * Fechamento do atendimento.
   *
   * Havia aqui um "fechamento direto de segurança": quando fa_checkout
   * falhava por qualquer motivo, o navegador marcava as sessões como
   * FINALIZADA por conta própria e devolvia um código inventado. A criança
   * saía, mas nenhum pedido, item ou pagamento era gravado — o dinheiro
   * entrava no caixa físico e sumia do sistema, e o turno fechava com
   * divergência sem rastro de onde. Removido: erro de fechamento agora
   * chega à tela para o operador resolver (abrir o caixa, retomar a
   * sessão, tentar de novo), que é a única saída que não perde a venda.
   *
   * Queda de rede continua coberta, e sem esse risco: callResilient guarda
   * a chamada na fila offline com a mesma chave de idempotência e reenvia
   * quando a conexão volta.
   */
  checkout: (body: {
    sessionIds: string[];
    employeeId: string;
    payments: { method: string; amountCents: number; nsu?: string; authorization?: string; pixTxid?: string }[];
    redeemRewardIds?: string[];
  }) =>
    callResilient<{ orderId: string; orderCode: string; totalCents: number }>("fa_checkout", {
      p_session_ids: body.sessionIds,
      p_payments: body.payments,
      p_redeem_reward_ids: body.redeemRewardIds ?? [],
      p_employee_id: body.employeeId,
    }),
  pdvOrder: (body: { unitId: string; employeeId: string; items: { productId: string; quantity: number }[]; payments: unknown[] }) =>
    callResilient<{ orderId: string; orderCode: string; totalCents: number }>("fa_create_pdv_order", {
      p_unit_id: body.unitId,
      p_employee_id: body.employeeId,
      p_items: body.items,
      p_payments: body.payments,
    }),

  openShift: (body: { unitId: string; employeeId: string; openingCashCents: number }) =>
    callResilient<{ id: string }>("fa_open_shift", {
      p_unit_id: body.unitId,
      p_employee_id: body.employeeId,
      p_opening_cash_cents: body.openingCashCents,
    }),
  closeShift: (shiftId: string, body: { employeeId: string; declared: Record<string, number> }) =>
    callResilient<{ expected: Record<string, number>; declared: Record<string, number>; divergence: Record<string, number> }>(
      "fa_close_shift",
      { p_shift_id: shiftId, p_employee_id: body.employeeId, p_declared: body.declared },
    ),
  cashMovement: (shiftId: string, body: { employeeId: string; kind: string; amountCents: number; reason?: string; envelopeNumber?: string; photoUrl?: string }) =>
    callResilient("fa_record_cash_movement", {
      p_shift_id: shiftId,
      p_kind: body.kind,
      p_amount_cents: body.amountCents,
      p_reason: body.reason ?? null,
      p_employee_id: body.employeeId,
      p_envelope_number: body.envelopeNumber ?? null,
      p_photo_url: body.photoUrl ?? null,
    }),
  cashMovements: (shiftId: string) =>
    unwrap<CashMovement[]>(
      supabase()
        .from("fa_kiosk_cash_movements")
        .select("id, kind, amount_cents, reason, envelope_number, photo_url, employee_id, at_ms")
        .eq("shift_id", shiftId)
        .order("at_ms", { ascending: true }),
    ),
  // Upload direto para o bucket público `envelope-fotos` (ver migration
  // fa_kiosk_envelope_photos_cash_status) — mesmo padrão de uploadAssetPhoto,
  // mas comprimida antes: foto de câmera sem redimensionar chegava a vários
  // MB por envelope e inflava o Storage sem necessidade (ver imageCompression.ts).
  uploadEnvelopePhoto: async (unitId: string, file: File): Promise<string> => {
    const optimized = await compressImageForUpload(file);
    const ext = optimized.type === "image/png" ? "png" : "jpg";
    const path = `${unitId}/${Date.now()}.${ext}`;
    const { error } = await supabase().storage.from("envelope-fotos").upload(path, optimized, {
      contentType: optimized.type,
      upsert: false,
    });
    if (error) throw new Error(error.message);
    const { data } = supabase().storage.from("envelope-fotos").getPublicUrl(path);
    return data.publicUrl;
  },
  // Histórico de abertura/fechamento de turno por unidade (ou todas, se
  // unitId for null) — usado pela aba gerencial "Abertura e Fechamento".
  unitShifts: (unitId: string | null) => {
    let query = supabase()
      .from("fa_kiosk_shifts")
      .select("id, unit_id, status, opening_cash_cents, opened_at_ms, closed_at_ms, opened_by_employee_id, closed_by_employee_id")
      .order("opened_at_ms", { ascending: false })
      .limit(100);
    if (unitId) query = query.eq("unit_id", unitId);
    return unwrap<UnitShiftRow[]>(query);
  },
  // Sangrias com número de envelope registrado (com ou sem foto ainda),
  // mais recentes primeiro — usado pela aba gerencial "Fotos de Envelope".
  envelopeMovements: (unitId: string | null) => {
    let query = supabase()
      .from("fa_kiosk_cash_movements")
      .select("id, shift_id, amount_cents, reason, envelope_number, photo_url, employee_id, at_ms, fa_kiosk_shifts!inner(unit_id)")
      .eq("kind", "SANGRIA")
      .not("envelope_number", "is", null)
      .order("at_ms", { ascending: false })
      .limit(200);
    if (unitId) query = query.eq("fa_kiosk_shifts.unit_id", unitId);
    return unwrap<EnvelopeMovement[]>(query);
  },
  // Saldo físico em caixa por unidade agora (ver RPC fa_units_cash_status) —
  // usado como linha secundária da aba gerencial "Saldo em Envelopes".
  unitsCashStatus: () => unwrap<UnitCashStatus[]>(supabase().rpc("fa_units_cash_status")),
  // Saldo em envelopes pendentes (ainda na loja) por unidade — aba gerencial
  // "Saldo em Envelopes" (ver RPC fa_units_envelope_balance).
  unitsEnvelopeBalance: () => unwrap<UnitEnvelopeBalance[]>(supabase().rpc("fa_units_envelope_balance")),
  // Candidaturas do Banco de Talentos, mais recentes primeiro — só quem tem
  // talentos.read enxerga (RLS de fa_kiosk_job_applications).
  jobApplications: () =>
    unwrap<JobApplication[]>(
      supabase()
        .from("fa_kiosk_job_applications")
        .select("id, full_name, email, phone, course, desired_area, opportunity_type, resume_path, status, created_at_ms")
        .order("created_at_ms", { ascending: false }),
    ),
  updateJobApplicationStatus: (id: string, status: JobApplication["status"]) =>
    unwrap<null>(supabase().from("fa_kiosk_job_applications").update({ status }).eq("id", id)),
  // Bucket privado `curriculos` — link assinado de 60s, gerado sob demanda
  // no clique (nunca guardado), já que getPublicUrl não funciona em bucket
  // privado e a policy de select do Storage já exige talentos.read.
  jobApplicationResumeUrl: async (resumePath: string): Promise<string> => {
    const { data, error } = await supabase().storage.from("curriculos").createSignedUrl(resumePath, 60);
    if (error) throw new Error(error.message);
    return data.signedUrl;
  },
  // Marca todos os envelopes pendentes da unidade como recolhidos pelo gestor.
  collectEnvelopes: (unitId: string, employeeId: string) =>
    callResilient<{ ok: boolean; collected_count: number; collected_cents: number }>("fa_collect_envelopes", {
      p_unit_id: unitId,
      p_employee_id: employeeId,
    }),
  revenueByMethod: async (shiftId: string) => {
    const rows = await unwrap<{ method: string; amount_cents: number }[]>(
      supabase().from("fa_kiosk_payments").select("method, amount_cents, fa_kiosk_orders!inner(shift_id)").eq("fa_kiosk_orders.shift_id", shiftId),
    );
    const totals = new Map<string, number>();
    for (const row of rows) totals.set(row.method, (totals.get(row.method) ?? 0) + row.amount_cents);
    return [...totals.entries()].map(([method, total_cents]) => ({ method, total_cents }));
  },
  // Extrato de cada venda do turno (a pedido do dono, para auditoria): uma
  // linha por pedido pago — código único, criança(s)/responsável para
  // check-outs, produtos para vendas de PDV, forma de pagamento, desconto
  // (fa_kiosk_sessions.coupon_discount_cents) e valor.
  shiftSales: async (shiftId: string): Promise<ShiftSale[]> => {
    // fa_kiosk_orders é a tabela-stub original (ver migration 05): tem
    // `created_at` (timestamptz), não `created_at_ms` como as tabelas
    // criadas do zero nesta fase.
    const orders = await unwrap<Record<string, unknown>[]>(
      supabase()
        .from("fa_kiosk_orders")
        .select("id, order_code, kind, total_cents, created_at")
        .eq("shift_id", shiftId)
        .eq("status", "PAGA")
        .order("created_at", { ascending: false }),
    );
    if (orders.length === 0) return [];
    const orderIds = orders.map((o) => o.id as string);

    const [payments, items] = await Promise.all([
      unwrap<Record<string, unknown>[]>(supabase().from("fa_kiosk_payments").select("order_id, method, amount_cents").in("order_id", orderIds)),
      unwrap<Record<string, unknown>[]>(
        supabase().from("fa_kiosk_order_items").select("order_id, session_id, description, quantity").in("order_id", orderIds),
      ),
    ]);

    const sessionIds = [...new Set(items.map((i) => i.session_id as string | null).filter((id): id is string => Boolean(id)))];
    const sessions =
      sessionIds.length === 0
        ? []
        : await unwrap<Record<string, unknown>[]>(
            supabase().from("fa_kiosk_sessions").select("id, child_name_snapshot, guardian_id, coupon_discount_cents").in("id", sessionIds),
          );
    const guardianIds = [...new Set(sessions.map((s) => s.guardian_id as string))];
    const guardians =
      guardianIds.length === 0
        ? []
        : await unwrap<Record<string, unknown>[]>(supabase().from("fa_kiosk_guardians").select("id, full_name").in("id", guardianIds));

    const sessionById = new Map(sessions.map((s) => [s.id as string, s]));
    const guardianById = new Map(guardians.map((g) => [g.id as string, g]));
    const paymentByOrder = new Map(payments.map((p) => [p.order_id as string, p]));
    const itemsByOrder = new Map<string, Record<string, unknown>[]>();
    for (const item of items) {
      const list = itemsByOrder.get(item.order_id as string) ?? [];
      list.push(item);
      itemsByOrder.set(item.order_id as string, list);
    }

    return orders.map((order) => {
      const orderId = order.id as string;
      const kind = order.kind as "SESSAO" | "PDV";
      const payment = paymentByOrder.get(orderId);
      const orderItems = itemsByOrder.get(orderId) ?? [];

      if (kind === "SESSAO") {
        const uniqueSessionIds = [...new Set(orderItems.map((i) => i.session_id as string | null).filter((id): id is string => Boolean(id)))];
        const sessionsForOrder = uniqueSessionIds.map((id) => sessionById.get(id)).filter((s): s is Record<string, unknown> => Boolean(s));
        const childNames = sessionsForOrder.map((s) => s.child_name_snapshot as string).join(", ");
        const firstGuardian = sessionsForOrder[0] ? guardianById.get(sessionsForOrder[0].guardian_id as string) : undefined;
        const discountCents = sessionsForOrder.reduce((sum, s) => sum + ((s.coupon_discount_cents as number) ?? 0), 0);
        return {
          orderId,
          orderCode: (order.order_code as string) ?? null,
          kind,
          createdAtMs: new Date(order.created_at as string).getTime(),
          method: (payment?.method as string) ?? "—",
          amountCents: order.total_cents as number,
          discountCents,
          childNames: childNames || "—",
          guardianName: (firstGuardian?.full_name as string) ?? null,
          productsSummary: null,
        };
      }

      const productsSummary = orderItems.map((i) => `${i.quantity}× ${i.description as string}`).join(", ");
      return {
        orderId,
        orderCode: (order.order_code as string) ?? null,
        kind,
        createdAtMs: order.created_at_ms as number,
        method: (payment?.method as string) ?? "—",
        amountCents: order.total_cents as number,
        discountCents: 0,
        childNames: "—",
        guardianName: null,
        productsSummary: productsSummary || "—",
      };
    });
  },

  ponto: (body: { unitId: string; employeeId: string; kind: PontoRecord["kind"]; registeredByEmployeeId: string }) =>
    callResilient<{ id: string; nsr: number; atMs: number }>("fa_register_ponto", {
      p_employee_id: body.employeeId,
      p_unit_id: body.unitId,
      p_kind: body.kind,
      p_registered_by_employee_id: body.registeredByEmployeeId,
    }),
  /** Linha do tempo de uma sessão (pausas, retomadas, troca de plano, notificações) — botão "Sessão" no Painel. */
  sessionEvents: async (sessionId: string) => {
    const rows = await unwrap<Record<string, unknown>[]>(
      supabase()
        .from("fa_kiosk_session_events")
        .select("id, kind, at_ms, payload_json, fa_kiosk_employees(full_name)")
        .eq("session_id", sessionId)
        .order("at_ms", { ascending: true }),
    );
    return rows.map((r) => ({
      id: r.id as string,
      kind: r.kind as string,
      at_ms: r.at_ms as number,
      employee_name: (r.fa_kiosk_employees as unknown as { full_name: string } | null)?.full_name ?? null,
      payload: (r.payload_json as Record<string, unknown> | null) ?? null,
    })) as SessionEvent[];
  },
  pontoHistory: (employeeId: string, fromMs: number, toMs: number) =>
    unwrap<PontoRecord[]>(
      supabase()
        .from("fa_kiosk_ponto_records")
        .select("id, employee_id, kind, nsr, at_ms")
        .eq("employee_id", employeeId)
        .gte("at_ms", fromMs)
        .lte("at_ms", toMs),
    ),

  bonusRules: (unitId: string) =>
    unwrap<Record<string, unknown>[]>(supabase().from("fa_kiosk_bonus_rules").select("*").eq("unit_id", unitId).eq("active", true)).then(
      (rows) => rows.map(bonusRuleFromRow),
    ),
  /** Todas as regras de bonificação de todas as unidades (ativas e inativas) — Gerencial. */
  bonusRulesAllUnits: () =>
    unwrap<Record<string, unknown>[]>(supabase().from("fa_kiosk_bonus_rules").select("*")).then((rows) =>
      rows.map(bonusRuleFromRow),
    ),

  /**
   * Aniversariantes do mês, só desta unidade — uma criança só aparece aqui
   * se já teve check-in nesta unidade (fa_kiosk_children não tem unit_id
   * próprio). Sem esse filtro, uma unidade veria os aniversariantes de
   * todas as outras.
   */
  birthdaysByUnit: (unitId: string, month: number) =>
    unwrap<Birthday[]>(supabase().rpc("fa_kiosk_birthdays_by_unit", { p_unit_id: unitId, p_month: month })).then(
      (rows) => rows.sort((a, b) => a.day_of_month - b.day_of_month),
    ),
  /** Pool de 1000 mensagens de felicitação para sortear uma por criança. */
  birthdayMessages: () =>
    unwrap<{ id: number; message: string }[]>(supabase().from("fa_kiosk_birthday_messages").select("id, message")),
  /**
   * Registra que a felicitação já foi enviada este ano, nesta unidade — o
   * card correspondente some da lista (fa_kiosk_birthdays_by_unit passa a
   * excluí-lo) e só volta a aparecer no aniversário do ano seguinte.
   */
  markBirthdaySent: (unitId: string, childId: string, employeeId: string | null) =>
    unwrap<null>(
      supabase().rpc("fa_kiosk_mark_birthday_sent", { p_unit_id: unitId, p_child_id: childId, p_employee_id: employeeId }),
    ),
  createBonusRule: (body: { unitId: string; description: string; rewardValueCents: number }) =>
    unwrap<{ id: string }>(
      supabase()
        .from("fa_kiosk_bonus_rules")
        .insert({ unit_id: body.unitId, description: body.description, reward_value_cents: body.rewardValueCents })
        .select("id")
        .single(),
    ),
  setBonusRuleActive: (id: string, active: boolean) => unwrap(supabase().from("fa_kiosk_bonus_rules").update({ active }).eq("id", id)),
  updateBonusRule: (id: string, body: { description: string; rewardValueCents: number }) =>
    unwrap(supabase().from("fa_kiosk_bonus_rules").update({ description: body.description, reward_value_cents: body.rewardValueCents }).eq("id", id)),
  unitSetting: async (unitId: string, key: UnitSettingKey) => {
    try {
      const row = await unwrap<{ value: string } | null>(
        supabase().from("fa_kiosk_app_settings").select("value").eq("unit_id", unitId).eq("key", key).maybeSingle(),
      );
      if (row?.value) return { value: row.value };
    } catch (err) {
      console.warn("Falha ao ler fa_kiosk_app_settings do Supabase, buscando no localStorage:", err);
    }
    const localVal = typeof localStorage !== "undefined" ? localStorage.getItem(`fa_setting_${unitId}_${key}`) : null;
    return { value: localVal };
  },
  setUnitSetting: async (
    unitId: string,
    key: UnitSettingKey,
    value: string,
  ) => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(`fa_setting_${unitId}_${key}`, value);
    }
    try {
      await unwrap(
        supabase()
          .from("fa_kiosk_app_settings")
          .upsert({ unit_id: unitId, key, value, updated_at_ms: Date.now() }, { onConflict: "unit_id,key" }),
      );
    } catch (err) {
      console.warn("Supabase RLS impediu gravação remota em fa_kiosk_app_settings (salvo localmente no quiosque):", err);
    }
  },
  /**
   * Enfileira um pedido de impressão para o print bridge (processo local
   * em cada terminal, ver apps/kiosk) em vez de abrir o diálogo nativo do
   * navegador — só assim dá pra imprimir sem clique nenhum do operador,
   * direto na impressora escolhida em Configurações > Impressoras.
   */
  /**
   * Traduz o que a câmera leu (ou o que o operador digitou) numa sessão.
   *
   * Nunca lança para código errado: na porta de saída, apontar a câmera para
   * a etiqueta errada é rotina, não falha de sistema. O motivo vem em
   * `reason` para a tela reagir sem tratar tudo como erro vermelho.
   */
  resolveAccessCode: (unitId: string, code: string, employeeId?: string) =>
    unwrap<ResolvedAccessCode>(
      supabase().rpc("fa_resolve_access_code", {
        p_unit_id: unitId,
        p_code: code,
        p_employee_id: employeeId ?? null,
      }),
    ),
  /** Responsáveis autorizados a retirar a criança desta sessão, para conferência do documento. */
  saidaResponsaveis: async (sessionId: string) =>
    (await unwrap<AuthorizedGuardian[] | null>(
      supabase().rpc("fa_saida_responsaveis", { p_session_id: sessionId }),
    )) ?? [],
  /** Registra a liberação de contingência (recibo perdido / etiqueta danificada) antes de cobrar. */
  saidaManualAuthorize: (body: {
    sessionId: string;
    guardianId: string | null;
    documentKind: string;
    documentNote?: string;
    reason?: string;
    employeeId: string;
  }) =>
    unwrap<{ authorizedPickup: boolean; guardianName: string | null }>(
      supabase().rpc("fa_saida_manual_authorize", {
        p_session_id: body.sessionId,
        p_guardian_id: body.guardianId,
        p_document_kind: body.documentKind,
        p_document_note: body.documentNote ?? null,
        p_reason: body.reason ?? null,
        p_employee_id: body.employeeId,
      }),
    ),
  /** Reimprime pulseira + recibo de guarda da mesma sessão, sem gerar código novo. */
  reimprimirEntrada: (sessionId: string, employeeId?: string) =>
    unwrap<{ accessCode: string }>(
      supabase().rpc("fa_reimprimir_entrada", { p_session_id: sessionId, p_employee_id: employeeId ?? null }),
    ),
  queuePrintJob: (unitId: string, kind: "WRISTBAND" | "RECEIPT", payload: unknown) =>
    unwrap(
      supabase()
        .from("fa_kiosk_print_jobs")
        .insert({ unit_id: unitId, kind, payload_json: payload, status: "PENDING", created_at_ms: Date.now() }),
    ),
  todayRevenue: async (unitId: string, cutoffHour: number) => {
    const totalCents = await unwrap<number>(
      supabase().rpc("fa_kiosk_today_revenue", { p_unit_id: unitId, p_business_date: businessDateFor(Date.now(), cutoffHour) }),
    );
    return { totalCents };
  },
  /** Quantidade de sessões vendidas por tipo de plano no intervalo de dias operacionais. */
  reportPlansSold: async (unitId: string | null, from: string, to: string) => {
    let query = supabase()
      .from("fa_kiosk_sessions")
      .select("plan_id, fa_kiosk_plans(name, color, activity)")
      .gte("business_date", from)
      .lte("business_date", to);
    if (unitId) query = query.eq("unit_id", unitId);
    const rows = await unwrap<Record<string, unknown>[]>(query);
    const map = new Map<string, { plan_id: string; plan_name: string; plan_color: string; activity: PlanSold["activity"]; sessions_count: number }>();
    for (const r of rows) {
      const planId = r.plan_id as string;
      const plan = r.fa_kiosk_plans as unknown as { name: string; color: string; activity: PlanSold["activity"] } | null;
      const cur = map.get(planId) ?? {
        plan_id: planId,
        plan_name: plan?.name ?? "Plano",
        plan_color: plan?.color ?? "#2ECFB5",
        activity: plan?.activity ?? "PLAYGROUND",
        sessions_count: 0,
      };
      cur.sessions_count += 1;
      map.set(planId, cur);
    }
    return [...map.values()] as PlanSold[];
  },
  notifySession: async (sessionId: string, body: { channel: "WHATSAPP" | "SMS"; message: string }) => {
    await unwrap(
      supabase().rpc("fa_kiosk_log_session_event", {
        p_session_id: sessionId,
        p_kind: body.channel === "WHATSAPP" ? "NOTIFICACAO_WHATSAPP" : "NOTIFICACAO_SMS_SIMULADA",
        p_employee_id: null,
        p_payload: { message: body.message },
      }),
    );
    return { ok: true, simulated: body.channel === "SMS" };
  },
  changeSessionPlan: (sessionId: string, planId: string) =>
    unwrap(supabase().rpc("fa_kiosk_change_session_plan", { p_session_id: sessionId, p_plan_id: planId })),
  pauseSession: (sessionId: string, reason: string) =>
    unwrap(supabase().rpc("fa_kiosk_pause_session", { p_session_id: sessionId, p_reason: reason })),
  resumeSession: (sessionId: string) =>
    unwrap(supabase().rpc("fa_kiosk_resume_session", { p_session_id: sessionId })),

  coupons: (unitId: string) =>
    unwrap<Record<string, unknown>[]>(supabase().from("fa_kiosk_coupons").select("*").eq("unit_id", unitId)).then((rows) =>
      rows.map(couponFromRow),
    ),
  /** Todos os cupons de todas as unidades — Gerencial. */
  couponsAllUnits: () =>
    unwrap<Record<string, unknown>[]>(supabase().from("fa_kiosk_coupons").select("*")).then((rows) => rows.map(couponFromRow)),
  createCoupon: (body: { unitId: string; code: string; kind: Coupon["kind"]; value: number; description?: string }) =>
    unwrap<{ id: string }>(
      supabase()
        .from("fa_kiosk_coupons")
        .insert({ unit_id: body.unitId, code: body.code, kind: body.kind, value: body.value, description: body.description ?? null })
        .select("id")
        .single(),
    ),
  setCouponActive: (id: string, active: boolean) => unwrap(supabase().from("fa_kiosk_coupons").update({ active }).eq("id", id)),
  updateCoupon: (id: string, body: { code: string; kind: Coupon["kind"]; value: number; description?: string }) =>
    unwrap(supabase().from("fa_kiosk_coupons").update({ code: body.code, kind: body.kind, value: body.value, description: body.description ?? null }).eq("id", id)),
  loyaltyRules: (unitId: string) =>
    unwrap<Record<string, unknown>[]>(supabase().from("fa_kiosk_loyalty_rules").select("*").eq("unit_id", unitId)).then((rows) =>
      rows.map(loyaltyRuleFromRow),
    ),
  /** Todas as regras de fidelidade de todas as unidades — Gerencial. */
  loyaltyRulesAllUnits: () =>
    unwrap<Record<string, unknown>[]>(supabase().from("fa_kiosk_loyalty_rules").select("*")).then((rows) =>
      rows.map(loyaltyRuleFromRow),
    ),
  createLoyaltyRule: (body: {
    unitId: string;
    activity: LoyaltyRule["activity"];
    triggerVisits: number;
    rewardKind: LoyaltyRule["rewardKind"];
    rewardValue: number;
  }) =>
    unwrap<{ id: string }>(
      supabase()
        .from("fa_kiosk_loyalty_rules")
        .insert({
          unit_id: body.unitId,
          activity: body.activity,
          trigger_visits: body.triggerVisits,
          reward_kind: body.rewardKind,
          reward_value: body.rewardValue,
        })
        .select("id")
        .single(),
    ),
  createPlan: (body: {
    unitId: string;
    activity: Plan["activity"];
    name: string;
    valueCents: number;
    durationValue: number;
    durationUnit: Plan["durationUnit"];
    overageCentsPerMinute: number;
    color: string;
  }) =>
    unwrap<{ id: string }>(
      supabase()
        .from("fa_kiosk_plans")
        .insert({
          unit_id: body.unitId,
          activity: body.activity,
          name: body.name,
          value_cents: body.valueCents,
          duration_value: body.durationValue,
          duration_unit: body.durationUnit,
          overage_cents_per_minute: body.overageCentsPerMinute,
          color: body.color,
        })
        .select("id")
        .single(),
    ),
  setPlanActive: (id: string, active: boolean) => unwrap(supabase().from("fa_kiosk_plans").update({ active }).eq("id", id)),
  updatePlan: (id: string, body: { name: string; valueCents: number; durationValue: number; durationUnit: Plan["durationUnit"]; overageCentsPerMinute: number; color: string }) =>
    unwrap(supabase().from("fa_kiosk_plans").update({
      name: body.name,
      value_cents: body.valueCents,
      duration_value: body.durationValue,
      duration_unit: body.durationUnit,
      overage_cents_per_minute: body.overageCentsPerMinute,
      color: body.color,
    }).eq("id", id)),
  createProduct: (body: { unitId: string; name: string; emoji?: string; priceCents: number; stock: number }) =>
    unwrap<{ id: string }>(
      supabase()
        .from("fa_kiosk_products")
        .insert({ unit_id: body.unitId, name: body.name, emoji: body.emoji ?? null, price_cents: body.priceCents, stock: body.stock })
        .select("id")
        .single(),
    ),
  setProductActive: (id: string, active: boolean) => unwrap(supabase().from("fa_kiosk_products").update({ active }).eq("id", id)),
  updateProduct: (id: string, body: { name: string; emoji?: string; priceCents: number; stock: number }) =>
    unwrap(supabase().from("fa_kiosk_products").update({ name: body.name, emoji: body.emoji ?? null, price_cents: body.priceCents, stock: body.stock }).eq("id", id)),
  createAsset: (body: {
    unitId: string;
    name: string;
    emoji: string;
    color: string;
    maintenanceThresholdHours: number;
    photoUrl?: string | null;
  }) =>
    unwrap<{ id: string }>(
      supabase()
        .from("fa_kiosk_assets")
        .insert({
          unit_id: body.unitId,
          name: body.name,
          emoji: body.emoji,
          color: body.color,
          maintenance_threshold_hours: body.maintenanceThresholdHours,
          photo_url: body.photoUrl ?? null,
        })
        .select("id")
        .single(),
    ),
  setAssetStatus: (id: string, status: Asset["status"]) => unwrap(supabase().from("fa_kiosk_assets").update({ status }).eq("id", id)),
  setAssetPhoto: (id: string, photoUrl: string | null) =>
    unwrap(supabase().from("fa_kiosk_assets").update({ photo_url: photoUrl }).eq("id", id)),
  // Bucket privado `crianca-fotos` (ver migration fa_kiosk_child_photos) —
  // diferente de `carrinho-fotos`, sem leitura pública: é foto de criança,
  // não de equipamento. O caminho é gravado via RPC (fa_set_child_photo_path),
  // não por UPDATE direto na tabela — mesma regra que vale para o resto de
  // fa_kiosk_children: escrita só por função SECURITY DEFINER (ver migration
  // fa_kiosk_temp_anon_read). Exibir a foto de volta exigiria uma signed URL,
  // fora do escopo deste formulário.
  uploadChildPhoto: async (childId: string, photo: Blob): Promise<void> => {
    const path = `${childId}/${Date.now()}.jpg`;
    const { error: uploadError } = await supabase().storage.from("crianca-fotos").upload(path, photo, {
      contentType: "image/jpeg",
      upsert: false,
    });
    if (uploadError) throw new Error(uploadError.message);
    await unwrap(supabase().rpc("fa_set_child_photo_path", { p_child_id: childId, p_photo_path: path }));
  },
  // Upload direto para o bucket público `carrinho-fotos` (ver migration
  // fa_kiosk_asset_photos) — aceita apenas JPG/PNG, nome do arquivo prefixado
  // com timestamp para evitar colisão ao trocar a foto de um mesmo carrinho.
  uploadAssetPhoto: async (unitId: string, file: File): Promise<string> => {
    const ext = file.type === "image/png" ? "png" : "jpg";
    const path = `${unitId}/${Date.now()}.${ext}`;
    const { error } = await supabase().storage.from("carrinho-fotos").upload(path, file, {
      contentType: file.type,
      upsert: false,
    });
    if (error) throw new Error(error.message);
    const { data } = supabase().storage.from("carrinho-fotos").getPublicUrl(path);
    return data.publicUrl;
  },
  // Criação de funcionário exige uma conta real no Supabase Auth — não dá
  // para ser feita com a chave anônima/de sessão do cliente, só com a
  // service role. A Edge Function `admin-create-employee` confere que
  // quem chama é ADMIN autenticado e faz o resto (auth.users + linha em
  // fa_kiosk_employees + PIN em fa_kiosk_local_credentials) do lado do
  // servidor. Não existe e-mail/senha em nenhum passo — só o PIN.
  createEmployee: (body: NewEmployeeInput) =>
    unwrap<{ id: string }>(supabase().functions.invoke("admin-create-employee", { body })),
  // Ativar/desativar e trocar papel passam por RPC (e não por UPDATE direto)
  // para a alteração ficar na trilha de auditoria na mesma transação e para
  // o guard do último Owner disparar. Ver migration 20260807000005.
  setEmployeeActive: (id: string, active: boolean) =>
    unwrap(supabase().rpc("fa_config_set_employee_active", { p_employee_id: id, p_active: active })),
  setEmployeeRole: (id: string, role: Employee["role"]) =>
    unwrap(supabase().rpc("fa_config_set_employee_role", { p_employee_id: id, p_role: role })),
  // Redefinição de PIN (ex.: colaborador esqueceu) — mesma exigência de
  // chamador ADMIN autenticado, resolvida do lado do servidor.
  setEmployeePin: (employeeId: string, pin: string) =>
    unwrap<{ ok: boolean }>(supabase().functions.invoke("admin-set-employee-pin", { body: { employeeId, pin } })),
  /** Substitui o conjunto de unidades em que o colaborador atua — Gerencial. */
  setEmployeeUnits: (employeeId: string, unitIds: string[]) =>
    unwrap(supabase().rpc("fa_config_set_employee_units", { p_employee_id: employeeId, p_unit_ids: unitIds })),
  // Espelho de ponto mensal — a RPC já confere `relatorio.ponto` no banco;
  // aqui só repassa os parâmetros e devolve o jsonb pronto para impressão.
  espelhoPonto: (employeeId: string, year: number, month: number) =>
    unwrap<EspelhoPonto>(
      supabase().rpc("fa_kiosk_espelho_ponto", { p_employee_id: employeeId, p_year: year, p_month: month }),
    ),

  /** Quem já completou o cadastro via convite — Gerencial > Colaboradores, exige `folha_pagamento.read`. */
  personalInfoStatus: async (): Promise<PersonalInfoStatus[]> => {
    const rows = await unwrap<Array<{ employee_id: string; completed: boolean }>>(
      supabase().rpc("fa_kiosk_personal_info_status"),
    );
    return rows.map((r) => ({ employeeId: r.employee_id, completed: r.completed }));
  },

  // Link de convite individual — gerar exige sessão de ADMIN (JWT), as
  // outras duas rodam ANTES de qualquer conta existir (anon, ver
  // supabase/config.toml) e por isso não passam por `supabase().rpc`.
  createOnboardingInvite: (body: CreateOnboardingInviteInput) =>
    unwrap<{ inviteId: string; token: string; expiresAtMs: number }>(
      supabase().functions.invoke("create-onboarding-invite", { body }),
    ),
  onboardingInviteInfo: (inviteId: string, token: string) =>
    unwrap<OnboardingInviteInfo>(
      supabase().functions.invoke("onboarding-invite-info", { body: { inviteId, token } }),
    ),
  onboardingComplete: (body: OnboardingCompleteInput) =>
    unwrap<{ id: string }>(supabase().functions.invoke("onboarding-complete", { body })),

  /**
   * Colaborador correspondente à sessão do Supabase Auth atual. É daqui
   * que o app descobre "quem está operando" ao restaurar uma sessão salva —
   * nunca do que o cliente afirma ser.
   */
  currentEmployee: async (): Promise<{ id: string; full_name: string; role: Employee["role"] }> => {
    const { data: userData } = await supabase().auth.getUser();
    const authUserId = userData.user?.id;
    if (!authUserId) throw new Error("sem sessão");
    return unwrap<{ id: string; full_name: string; role: Employee["role"] }>(
      supabase()
        .from("fa_kiosk_employees")
        .select("id, full_name, role")
        .eq("auth_user_id", authUserId)
        .eq("active", true)
        .single(),
    );
  },

  /**
   * Lista usada na TELA DE LOGIN, antes de existir sessão. Vai por Edge
   * Function porque fa_kiosk_employees só é legível por `authenticated`
   * (e deve continuar assim: tem CPF, PIS e cargo). Devolve só id + nome —
   * sem o papel, para um ataque de força bruta não saber qual nome é o
   * Owner. Ver supabase/functions/list-employees.
   */
  employeesForLogin: async (): Promise<{ id: string; full_name: string }[]> => {
    const { data, error } = await supabase().functions.invoke<{
      employees: { id: string; full_name: string }[];
    }>("list-employees", { body: {} });
    if (error || !data) throw new Error("Não foi possível carregar a lista de colaboradores");
    return data.employees;
  },

  /** Capacidades do colaborador logado (view fa_kiosk_my_capabilities). */
  myCapabilities: () =>
    unwrap<{ capability: string }[]>(supabase().from("fa_kiosk_my_capabilities").select("capability")),

  // --- Configurações: unidade, fiscal e termos de uso -----------------------
  // Todas passam por RPC `fa_config_*`, que checa fa_kiosk_can() no servidor
  // ANTES de tocar em qualquer linha e registra a alteração na trilha de
  // auditoria. Esconder a aba no menu é UX; isto é o que de fato protege.
  createUnit: (body: { name: string; kind: Unit["kind"]; timezone?: string; businessDayCutoffHour?: number }) =>
    unwrap<string>(supabase().rpc("fa_config_create_unit", { p_payload: body })),
  updateUnit: (
    unitId: string,
    body: {
      name?: string;
      timezone?: string;
      businessDayCutoffHour?: number;
      address?: string | null;
      phone?: string | null;
    },
  ) => unwrap(supabase().rpc("fa_config_update_unit", { p_unit_id: unitId, p_payload: body })),
  unitFiscal: (unitId: string) =>
    unwrap<UnitFiscal>(
      supabase()
        .from("fa_kiosk_units")
        .select(
          "id, name, cnpj, razao_social, nome_fantasia, inscricao_estadual, inscricao_municipal, cnae_principal, crt, " +
            "end_logradouro, end_numero, end_complemento, end_bairro, end_municipio_ibge, end_uf, end_cep, fone, " +
            "fiscal_ambiente, fiscal_enabled, nfce_serie, nfce_csc_id, nfce_qrcode_url_consulta, " +
            "nfse_item_lista_servico, nfse_codigo_tributacao_municipio, nfse_aliquota_iss_bp, nfse_iss_retido, " +
            "nfse_regime_especial, nfse_serie_rps, nfse_ambiente, nfse_enabled",
        )
        .eq("id", unitId)
        .single(),
    ),
  updateUnitFiscal: (unitId: string, payload: Record<string, unknown>) =>
    unwrap(supabase().rpc("fa_config_update_unit_fiscal", { p_unit_id: unitId, p_payload: payload })),
  productsFiscal: (unitId: string) =>
    unwrap<ProductFiscal[]>(
      supabase()
        .from("fa_kiosk_products")
        .select("id, name, ncm, cest, cfop, csosn, origem, unidade_comercial, gtin, pis_cst, cofins_cst")
        .eq("unit_id", unitId)
        .eq("active", true)
        .order("name"),
    ),
  updateProductFiscal: (productId: string, payload: Record<string, unknown>) =>
    unwrap(supabase().rpc("fa_config_update_product_fiscal", { p_product_id: productId, p_payload: payload })),
  fiscalTerminalStatus: (unitId: string) =>
    unwrap<FiscalTerminalStatus[]>(
      supabase()
        .from("fa_kiosk_fiscal_terminal_status")
        .select("unit_id, terminal_id, worker_version, cert_subject_cn, cert_not_after_ms, csc_configured, environment, last_heartbeat_ms, last_error")
        .eq("unit_id", unitId),
    ),
  setTerms: (unitId: string, terms: string) =>
    unwrap(supabase().rpc("fa_config_set_terms", { p_unit_id: unitId, p_terms: terms })),

  // Os relatórios abaixo chamavam `/api/reports/...` (servidor Fastify
  // local, apps/kiosk) — removido na migração para Supabase (commit
  // cafbda6), então todo relatório voltava 404. Reescritos como consultas
  // diretas ao Supabase, agregadas no cliente (mesmo padrão de
  // apps/backoffice/.../relatorios/page.tsx).
  // `unitId: null` no relatório de vendas/visitas/planos/frota/sessões
  // significa "todas as unidades" — usado pelo Gerencial, que enxerga as 3
  // de uma vez (mesmo padrão de apps/backoffice/.../relatorios/page.tsx,
  // que resolvia esse mesmo dilema antes de ser desativado).
  reportSales: async (unitId: string | null, from: string, to: string) => {
    let ordersQuery = supabase()
      .from("fa_kiosk_orders")
      .select("id, business_date, total_cents")
      .eq("status", "PAGA")
      .gte("business_date", from)
      .lte("business_date", to);
    if (unitId) ordersQuery = ordersQuery.eq("unit_id", unitId);
    const orders = await unwrap<Record<string, unknown>[]>(ordersQuery);
    const byDayMap = new Map<string, { orders_count: number; total_cents: number }>();
    for (const o of orders) {
      const d = o.business_date as string;
      const cur = byDayMap.get(d) ?? { orders_count: 0, total_cents: 0 };
      cur.orders_count += 1;
      cur.total_cents += o.total_cents as number;
      byDayMap.set(d, cur);
    }
    const byDay: DailySales[] = [...byDayMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([business_date, v]) => ({ business_date, ...v }));

    const orderIds = orders.map((o) => o.id as string);
    let byMethod: RevenueByMethod[] = [];
      if (orderIds.length > 0) {
      let paymentsQuery = supabase().from("fa_kiosk_payments").select("method, amount_cents").in("order_id", orderIds);
      const payments = await unwrap<Record<string, unknown>[]>(paymentsQuery);
      const methodMap = new Map<string, number>();
      for (const p of payments) {
        const m = p.method as string;
        methodMap.set(m, (methodMap.get(m) ?? 0) + (p.amount_cents as number));
      }
      byMethod = [...methodMap.entries()].map(([method, total_cents]) => ({ method, total_cents }));
    }
    return { byDay, byMethod };
  },
  reportVisits: async (unitId: string | null, from: string, to: string) => {
    let query = supabase().from("fa_kiosk_sessions").select("business_date").gte("business_date", from).lte("business_date", to);
    if (unitId) query = query.eq("unit_id", unitId);
    const sessions = await unwrap<Record<string, unknown>[]>(query);
    const map = new Map<string, number>();
    for (const s of sessions) {
      const d = s.business_date as string;
      map.set(d, (map.get(d) ?? 0) + 1);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([business_date, sessions_count]) => ({ business_date, sessions_count }));
  },
  reportBirthdays: async (month: number) => {
    let query = supabase().from("fa_kiosk_children").select("id, full_name, birth_date");
    const children = await unwrap<Record<string, unknown>[]>(query);
    return children
      .filter((c) => c.birth_date && new Date(c.birth_date as string).getUTCMonth() + 1 === month)
      .map((c) => ({ id: c.id as string, full_name: c.full_name as string, birth_date: c.birth_date as string }));
  },
  reportShifts: (unitId: string) =>
    unwrap<ShiftSummary[]>(
      supabase()
        .from("fa_kiosk_shifts")
        .select("id, opened_at_ms, closed_at_ms, status, declared_json, expected_json")
        .eq("unit_id", unitId)
        .order("opened_at_ms", { ascending: false }),
    ),
  reportAssetUsage: async (unitId: string, from: string, to: string) => {
    let sessionsQuery = supabase()
      .from("fa_kiosk_sessions")
      .select("asset_id, checkin_at_ms, checkout_at_ms")
      .eq("unit_id", unitId)
      .eq("activity", "CARRINHO")
      .not("asset_id", "is", null)
      .gte("business_date", from)
      .lte("business_date", to);
    const [assets, sessions] = await Promise.all([
      unwrap<Record<string, unknown>[]>(supabase().from("fa_kiosk_assets").select("id, name, emoji, color").eq("unit_id", unitId)),
      unwrap<Record<string, unknown>[]>(sessionsQuery),
    ]);
    const usageByAsset = new Map<string, { sessions_count: number; total_minutes: number }>();
    const nowMs = Date.now();
    for (const s of sessions) {
      const assetId = s.asset_id as string;
      const checkin = s.checkin_at_ms as number;
      const checkout = (s.checkout_at_ms as number | null) ?? nowMs;
      const cur = usageByAsset.get(assetId) ?? { sessions_count: 0, total_minutes: 0 };
      cur.sessions_count += 1;
      cur.total_minutes += Math.max(0, Math.round((checkout - checkin) / 60000));
      usageByAsset.set(assetId, cur);
    }
    return assets.map((a) => {
      const usage = usageByAsset.get(a.id as string) ?? { sessions_count: 0, total_minutes: 0 };
      return { id: a.id as string, name: a.name as string, emoji: a.emoji as string, color: a.color as string, ...usage };
    }) as AssetUsage[];
  },
  reportPonto: async (fromMs: number, toMs: number) => {
    const rows = await unwrap<Record<string, unknown>[]>(
      supabase()
        .from("fa_kiosk_ponto_records")
        .select("employee_id, kind, at_ms, nsr, fa_kiosk_employees!employee_id(full_name, weekly_hours_contracted)")
        .gte("at_ms", fromMs)
        .lte("at_ms", toMs)
        .order("at_ms", { ascending: false }),
    );
    return rows.map((r) => ({
      employee_id: r.employee_id as string,
      full_name: (r.fa_kiosk_employees as unknown as { full_name: string; weekly_hours_contracted: number | null } | null)?.full_name ?? "—",
      weekly_hours_contracted:
        (r.fa_kiosk_employees as unknown as { full_name: string; weekly_hours_contracted: number | null } | null)?.weekly_hours_contracted ?? null,
      kind: r.kind as string,
      at_ms: r.at_ms as number,
      nsr: r.nsr as number,
    })) as FolhaPontoRow[];
  },
  reportSessions: async (unitId: string | null, from: string, to: string) => {
    let sessionsQuery = supabase()
      .from("fa_kiosk_sessions")
      .select("id, unit_id, access_code, checkin_at_ms, checkout_at_ms, status, activity, child_name_snapshot, guardian_id, plan_id, checkin_by_employee_id")
      .gte("business_date", from)
      .lte("business_date", to)
      .order("checkin_at_ms", { ascending: false });
    if (unitId) sessionsQuery = sessionsQuery.eq("unit_id", unitId);
    const sessions = await unwrap<Record<string, unknown>[]>(sessionsQuery);
    if (sessions.length === 0) return [] as SessionAudit[];

    const guardianIds = [...new Set(sessions.map((s) => s.guardian_id as string))];
    const planIds = [...new Set(sessions.map((s) => s.plan_id as string).filter(Boolean))];
    const employeeIds = [...new Set(sessions.map((s) => s.checkin_by_employee_id as string).filter(Boolean))];

    const [guardians, plans, employees] = await Promise.all([
      unwrap<Record<string, unknown>[]>(supabase().from("fa_kiosk_guardians").select("id, full_name, phone_e164, cpf").in("id", guardianIds)),
      planIds.length > 0
        ? unwrap<Record<string, unknown>[]>(supabase().from("fa_kiosk_plans").select("id, name").in("id", planIds))
        : Promise.resolve([]),
      employeeIds.length > 0
        ? unwrap<Record<string, unknown>[]>(supabase().from("fa_kiosk_employees").select("id, full_name").in("id", employeeIds))
        : Promise.resolve([]),
    ]);
    const guardianById = new Map(guardians.map((g) => [g.id as string, g]));
    const planById = new Map(plans.map((p) => [p.id as string, p]));
    const employeeById = new Map(employees.map((e) => [e.id as string, e]));

    return sessions.map((s) => {
      const guardian = guardianById.get(s.guardian_id as string);
      const plan = planById.get(s.plan_id as string);
      const employee = employeeById.get(s.checkin_by_employee_id as string);
      return {
        id: s.id as string,
        unit_id: s.unit_id as string,
        access_code: s.access_code as string | null,
        checkin_at_ms: s.checkin_at_ms as number,
        checkout_at_ms: s.checkout_at_ms as number | null,
        status: s.status as string,
        activity: s.activity as "PLAYGROUND" | "CARRINHO",
        child_name: s.child_name_snapshot as string,
        guardian_name: (guardian?.full_name as string | undefined) ?? "—",
        guardian_phone: (guardian?.phone_e164 as string | undefined) ?? null,
        guardian_cpf: (guardian?.cpf as string | undefined) ?? null,
        plan_name: (plan?.name as string | undefined) ?? null,
        employee_name: (employee?.full_name as string | undefined) ?? null,
      } satisfies SessionAudit;
    });
  },
  getFolhaPagamentoData: async (unitId: string, year: number, month: number) => {
    const { fromMs, toMs } = monthRangeMs(year, month);
    let tablesMissing = false;
    const [employees, payrollInfos, pontoRecords, runs] = await Promise.all([
      unwrap<Record<string, unknown>[]>(
        supabase()
          .from("fa_kiosk_employees")
          .select("id, full_name, cpf, position, weekly_hours_contracted")
          .eq("unit_id", unitId)
          .eq("active", true)
          .order("full_name"),
      ),
      unwrap<Record<string, unknown>[]>(
        supabase().from("fa_kiosk_employee_payroll_info").select("*"),
      ).catch(() => {
        tablesMissing = true;
        return [];
      }),
      unwrap<Record<string, unknown>[]>(
        supabase()
          .from("fa_kiosk_ponto_records")
          .select("employee_id, kind, at_ms")
          .eq("unit_id", unitId)
          .gte("at_ms", fromMs)
          .lt("at_ms", toMs),
      ),
      unwrap<Record<string, unknown>[]>(
        supabase()
          .from("fa_kiosk_payroll_runs")
          .select("id, year, month, total_cents, created_at_ms, fa_kiosk_payroll_items(*)")
          .eq("unit_id", unitId)
          .order("year", { ascending: false })
          .order("month", { ascending: false }),
      ).catch(() => {
        tablesMissing = true;
        return [];
      }),
    ]);


    const payrollInfoByEmployee = new Map((payrollInfos ?? []).map((p) => [p.employee_id as string, p]));

    const pontoByEmployee = new Map<string, { kind: PontoKind; at_ms: number }[]>();
    for (const record of pontoRecords ?? []) {
      const list = pontoByEmployee.get(record.employee_id as string) ?? [];
      list.push({ kind: record.kind as PontoKind, at_ms: record.at_ms as number });
      pontoByEmployee.set(record.employee_id as string, list);
    }

    const folhaEmployees: FolhaPagamentoEmployee[] = (employees ?? []).map((e) => {
      const info = payrollInfoByEmployee.get(e.id as string);
      const worked = computeWorkedMinutes(pontoByEmployee.get(e.id as string) ?? []);
      return {
        id: e.id as string,
        fullName: e.full_name as string,
        cpf: (e.cpf as string | null) ?? null,
        position: (e.position as string | null) ?? null,
        weeklyHoursContracted: (e.weekly_hours_contracted as number | null) ?? null,
        workedMinutes: worked.minutes,
        workedIncomplete: worked.incomplete,
        salaryBaseCents: (info?.salary_base_cents as number | null) ?? null,
        bankCode: (info?.bank_code as string | null) ?? null,
        bankAgencia: (info?.bank_agencia as string | null) ?? null,
        bankAgenciaDv: (info?.bank_agencia_dv as string | null) ?? null,
        bankConta: (info?.bank_conta as string | null) ?? null,
        bankContaDv: (info?.bank_conta_dv as string | null) ?? null,
        bankAccountType: (info?.bank_account_type as string | null) ?? null,
        pixKey: (info?.pix_key as string | null) ?? null,
      };
    });

    const parsedRuns: ClosedRun[] = (runs ?? []).map((r) => ({
      id: r.id as string,
      year: r.year as number,
      month: r.month as number,
      totalCents: r.total_cents as number,
      createdAtMs: r.created_at_ms as number,
      items: (r.fa_kiosk_payroll_items as Record<string, unknown>[] ?? []).map((item) => ({
        id: item.id as string,
        employee_id: (item.employee_id as string | null) ?? null,
        full_name_snapshot: item.full_name_snapshot as string,
        cpf_snapshot: (item.cpf_snapshot as string | null) ?? null,
        bank_code_snapshot: (item.bank_code_snapshot as string | null) ?? null,
        bank_agencia_snapshot: (item.bank_agencia_snapshot as string | null) ?? null,
        bank_agencia_dv_snapshot: (item.bank_agencia_dv_snapshot as string | null) ?? null,
        bank_conta_snapshot: (item.bank_conta_snapshot as string | null) ?? null,
        bank_conta_dv_snapshot: (item.bank_conta_dv_snapshot as string | null) ?? null,
        bank_account_type_snapshot: (item.bank_account_type_snapshot as string | null) ?? null,
        salary_base_cents: item.salary_base_cents as number,
        adjustment_cents: item.adjustment_cents as number,
        adjustment_note: (item.adjustment_note as string | null) ?? null,
        total_cents: item.total_cents as number,
        hours_contracted: (item.hours_contracted as number | null) ?? null,
        hours_worked_minutes: (item.hours_worked_minutes as number | null) ?? null,
      })),
    }));

    const closedRun = parsedRuns.find((r) => r.year === year && r.month === month) ?? null;

    return {
      employees: folhaEmployees,
      runs: parsedRuns,
      closedRun,
      tablesMissing,
    };

  },
  updatePayrollInfo: async (
    employeeId: string,
    info: {
      salaryBaseCents: number | null;
      bankCode: string | null;
      bankAgencia: string | null;
      bankAgenciaDv: string | null;
      bankConta: string | null;
      bankContaDv: string | null;
      bankAccountType: string | null;
      pixKey: string | null;
    },
  ) => {
    await unwrap(
      supabase().from("fa_kiosk_employee_payroll_info").upsert(
        {
          employee_id: employeeId,
          salary_base_cents: info.salaryBaseCents,
          bank_code: info.bankCode,
          bank_agencia: info.bankAgencia,
          bank_agencia_dv: info.bankAgenciaDv,
          bank_conta: info.bankConta,
          bank_conta_dv: info.bankContaDv,
          bank_account_type: info.bankAccountType,
          pix_key: info.pixKey,
          updated_at_ms: Date.now(),
        },
        { onConflict: "employee_id" },
      ),
    );
  },
  closePayrollRun: async (unitId: string, year: number, month: number, items: PayrollCloseItem[]) => {
    const formattedItems = items.map((item) => ({
      employee_id: item.employeeId,
      full_name_snapshot: item.fullName,
      cpf_snapshot: item.cpf,
      bank_code_snapshot: item.bankCode,
      bank_agencia_snapshot: item.bankAgencia,
      bank_agencia_dv_snapshot: item.bankAgenciaDv,
      bank_conta_snapshot: item.bankConta,
      bank_conta_dv_snapshot: item.bankContaDv,
      bank_account_type_snapshot: item.bankAccountType,
      salary_base_cents: item.salaryBaseCents,
      adjustment_cents: item.adjustmentCents,
      adjustment_note: item.adjustmentNote,
      total_cents: item.totalCents,
      hours_contracted: item.hoursContracted,
      hours_worked_minutes: item.hoursWorkedMinutes,
    }));

    await unwrap(
      supabase().rpc("fa_kiosk_close_payroll_run", {
        p_unit_id: unitId,
        p_year: year,
        p_month: month,
        p_items: formattedItems,
      }),
    );
  },
};

