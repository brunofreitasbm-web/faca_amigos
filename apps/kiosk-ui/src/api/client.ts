import { quoteForSession } from "@facaamigos/domain";
import { supabase } from "../lib/supabase/client.js";
import { callResilient } from "../lib/supabase/offlineQueue.js";

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
}

export interface Employee {
  id: string;
  full_name: string;
  role: "OPERADOR" | "GERENTE" | "ADMIN";
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
}

export interface ChildMatch {
  id: string;
  full_name: string;
  birth_date: string;
  phone_e164: string | null;
  guardian_name: string | null;
  cpf: string | null;
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
    child_name_snapshot: string;
    activity: "PLAYGROUND" | "CARRINHO";
    checkin_at_ms: number;
    asset_id: string | null;
    wristband_code?: string;
    guardian_name_snapshot?: string;
    guardian_phone_snapshot?: string;
    notes?: string;
  };
  quote: {
    lines: QuoteLine[];
    totalCents: number;
    timing: { phase: SessionPhase; elapsedMs: number; durationMs: number; overMinutes: number };
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
  kind: "TROCO_INICIAL" | "SANGRIA" | "SUPRIMENTO" | "AJUSTE";
  amount_cents: number;
  reason: string | null;
}

export interface BonusRule {
  id: string;
  unitId: string;
  description: string;
  rewardValueCents: number;
}

export interface Coupon {
  id: string;
  code: string;
  kind: "MINUTOS_EXTRA" | "DESCONTO_PCT" | "DESCONTO_VALOR";
  value: number;
  max_uses: number;
  used_count: number;
  active: 0 | 1;
  description: string | null;
}

export interface LoyaltyRule {
  id: string;
  activity: "PLAYGROUND" | "CARRINHO" | "AMBOS";
  triggerVisits: number;
  rewardKind: "ENTRADA_GRATIS" | "DESCONTO_PCT" | "MINUTOS_EXTRA";
  rewardValue: number;
}

export interface RedeemableReward {
  id: string;
  rule_id: string;
  earned_at_ms: number;
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
  kind: string;
  at_ms: number;
  nsr: number;
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
  };
}

function bonusRuleFromRow(row: Record<string, unknown>): BonusRule {
  return {
    id: row.id as string,
    unitId: row.unit_id as string,
    description: row.description as string,
    rewardValueCents: row.reward_value_cents as number,
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
  };
}

function loyaltyRuleFromRow(row: Record<string, unknown>): LoyaltyRule {
  return {
    id: row.id as string,
    activity: row.activity as LoyaltyRule["activity"],
    triggerVisits: row.trigger_visits as number,
    rewardKind: row.reward_kind as LoyaltyRule["rewardKind"],
    rewardValue: row.reward_value as number,
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
  if (sessions.length === 0) return { sessions: [], planById: new Map(), guardianById: new Map(), assetById: new Map() };

  const planIds = [...new Set(sessions.map((s) => s.plan_id as string))];
  const guardianIds = [...new Set(sessions.map((s) => s.guardian_id as string))];
  const assetIds = [...new Set(sessions.map((s) => s.asset_id as string | null).filter((id): id is string => Boolean(id)))];
  const [plans, guardians, assets] = await Promise.all([
    unwrap<Record<string, unknown>[]>(supabase().from("fa_kiosk_plans").select("*").in("id", planIds)),
    unwrap<Record<string, unknown>[]>(supabase().from("fa_kiosk_guardians").select("id, full_name, phone_e164").in("id", guardianIds)),
    assetIds.length === 0
      ? Promise.resolve([])
      : unwrap<Record<string, unknown>[]>(supabase().from("fa_kiosk_assets").select("id, name, emoji, photo_url").in("id", assetIds)),
  ]);
  return {
    sessions,
    planById: new Map(plans.map((p) => [p.id as string, planFromRow(p)])),
    guardianById: new Map(guardians.map((g) => [g.id as string, g])),
    assetById: new Map(assets.map((a) => [a.id as string, a])),
  };
}

export function computeActiveSessionEntries(raw: ActiveSessionsRaw, nowMs: number): ActiveSessionEntry[] {
  return raw.sessions.map((row) => {
    const plan = raw.planById.get(row.plan_id as string)!;
    const guardian = raw.guardianById.get(row.guardian_id as string);
    const assetRow = row.asset_id ? raw.assetById.get(row.asset_id as string) : undefined;
    const quote = quoteForSession(
      plan,
      {
        checkinAtMs: row.checkin_at_ms as number,
        childName: row.child_name_snapshot as string,
        planId: row.plan_id as string,
        couponDiscountCents: row.coupon_discount_cents as number,
        couponCode: null,
        freeFromLoyalty: Boolean(row.free_from_loyalty),
      },
      nowMs,
    );
    return {
      session: {
        id: row.id as string,
        child_name_snapshot: row.child_name_snapshot as string,
        activity: row.activity as "PLAYGROUND" | "CARRINHO",
        checkin_at_ms: row.checkin_at_ms as number,
        asset_id: row.asset_id as string | null,
        wristband_code: row.wristband_code as string,
        guardian_name_snapshot: (guardian?.full_name as string) ?? undefined,
        guardian_phone_snapshot: (guardian?.phone_e164 as string) ?? undefined,
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
  units: () => unwrap<Unit[]>(supabase().from("fa_kiosk_units").select("id, kind, name, business_day_cutoff_hour")),
  employees: () => unwrap<Employee[]>(supabase().from("fa_kiosk_employees").select("id, full_name, role").eq("active", true)),
  plans: async (unitId: string, activity: string) => {
    const rows = await unwrap<Record<string, unknown>[]>(
      supabase().from("fa_kiosk_plans").select("*").eq("unit_id", unitId).eq("activity", activity).eq("active", true),
    );
    return rows.map(planFromRow);
  },
  assets: (unitId: string) =>
    unwrap<Asset[]>(
      supabase()
        .from("fa_kiosk_assets")
        .select("id, unit_id, name, emoji, color, status, odometer_minutes, photo_url")
        .eq("unit_id", unitId),
    ),
  products: (unitId: string) =>
    unwrap<Product[]>(
      supabase()
        .from("fa_kiosk_products")
        .select("id, name, description, emoji, price_cents, stock")
        .eq("unit_id", unitId)
        .eq("active", true),
    ),
  searchChildren: async (q: string) => {
    if (!q || q.length < 2) return [];
    return unwrap<ChildMatch[]>(supabase().rpc("fa_kiosk_search_children", { p_query: q }));
  },
  lastAssetForChild: async (childId: string) => {
    const assetId = await unwrap<string | null>(supabase().rpc("fa_kiosk_last_asset_for_child", { p_child_id: childId }));
    return { assetId };
  },
  activeSessions: (unitId: string) => fetchActiveSessions(unitId),
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

  checkin: (body: {
    unitId: string;
    activity: "PLAYGROUND" | "CARRINHO";
    assetId?: string;
    planId: string;
    employeeId: string;
    child: { id?: string; fullName: string; birthDate: string; inclusiveEligible: boolean; inclusiveProofType?: string };
    guardian: { id?: string; fullName: string; cpf: string; phoneE164: string };
    couponCode?: string;
  }) =>
    callResilient<{ sessionId: string; childId: string; guardianId: string; wristbandCode: string; ticketCode: string }>(
      "fa_checkin",
      {
        p_unit_id: body.unitId,
        p_activity: body.activity,
        p_plan_id: body.planId,
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
      },
    ),
  checkout: (body: {
    sessionIds: string[];
    employeeId: string;
    payments: { method: string; amountCents: number; nsu?: string; authorization?: string; pixTxid?: string }[];
    redeemRewardIds?: string[];
  }) =>
    callResilient<{ orderId: string; totalCents: number }>("fa_checkout", {
      p_session_ids: body.sessionIds,
      p_payments: body.payments,
      p_redeem_reward_ids: body.redeemRewardIds ?? [],
      p_employee_id: body.employeeId,
    }),
  pdvOrder: (body: { unitId: string; employeeId: string; items: { productId: string; quantity: number }[]; payments: unknown[] }) =>
    callResilient<{ orderId: string; totalCents: number }>("fa_create_pdv_order", {
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
  cashMovement: (shiftId: string, body: { employeeId: string; kind: string; amountCents: number; reason?: string }) =>
    callResilient("fa_record_cash_movement", {
      p_shift_id: shiftId,
      p_kind: body.kind,
      p_amount_cents: body.amountCents,
      p_reason: body.reason ?? null,
      p_employee_id: body.employeeId,
    }),
  cashMovements: (shiftId: string) =>
    unwrap<CashMovement[]>(
      supabase().from("fa_kiosk_cash_movements").select("kind, amount_cents, reason").eq("shift_id", shiftId),
    ),
  revenueByMethod: async (shiftId: string) => {
    const rows = await unwrap<{ method: string; amount_cents: number }[]>(
      supabase().from("fa_kiosk_payments").select("method, amount_cents, fa_kiosk_orders!inner(shift_id)").eq("fa_kiosk_orders.shift_id", shiftId),
    );
    const totals = new Map<string, number>();
    for (const row of rows) totals.set(row.method, (totals.get(row.method) ?? 0) + row.amount_cents);
    return [...totals.entries()].map(([method, total_cents]) => ({ method, total_cents }));
  },

  ponto: (body: { unitId: string; employeeId: string; kind: PontoRecord["kind"]; registeredByEmployeeId: string }) =>
    callResilient<{ id: string; nsr: number; atMs: number }>("fa_register_ponto", {
      p_employee_id: body.employeeId,
      p_unit_id: body.unitId,
      p_kind: body.kind,
      p_registered_by_employee_id: body.registeredByEmployeeId,
    }),
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
  createBonusRule: (body: { unitId: string; description: string; rewardValueCents: number }) =>
    unwrap<{ id: string }>(
      supabase()
        .from("fa_kiosk_bonus_rules")
        .insert({ unit_id: body.unitId, description: body.description, reward_value_cents: body.rewardValueCents })
        .select("id")
        .single(),
    ),
  unitSetting: async (unitId: string, key: "daily_goal_cents" | "terms_of_use" | "closing_time") => {
    const row = await unwrap<{ value: string } | null>(
      supabase().from("fa_kiosk_app_settings").select("value").eq("unit_id", unitId).eq("key", key).maybeSingle(),
    );
    return { value: row?.value ?? null };
  },
  setUnitSetting: (unitId: string, key: "daily_goal_cents" | "terms_of_use" | "closing_time", value: string) =>
    unwrap(
      supabase()
        .from("fa_kiosk_app_settings")
        .upsert({ unit_id: unitId, key, value, updated_at_ms: Date.now() }, { onConflict: "unit_id,key" }),
    ),
  todayRevenue: async (unitId: string, cutoffHour: number) => {
    const shifted = new Date(Date.now() - cutoffHour * 3600_000);
    const businessDate = `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}-${String(shifted.getDate()).padStart(2, "0")}`;
    const totalCents = await unwrap<number>(
      supabase().rpc("fa_kiosk_today_revenue", { p_unit_id: unitId, p_business_date: businessDate }),
    );
    return { totalCents };
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

  coupons: (unitId: string) =>
    unwrap<Record<string, unknown>[]>(supabase().from("fa_kiosk_coupons").select("*").eq("unit_id", unitId)).then((rows) =>
      rows.map(couponFromRow),
    ),
  createCoupon: (body: { unitId: string; code: string; kind: Coupon["kind"]; value: number; description?: string }) =>
    unwrap<{ id: string }>(
      supabase()
        .from("fa_kiosk_coupons")
        .insert({ unit_id: body.unitId, code: body.code, kind: body.kind, value: body.value, description: body.description ?? null })
        .select("id")
        .single(),
    ),
  loyaltyRules: (unitId: string) =>
    unwrap<Record<string, unknown>[]>(supabase().from("fa_kiosk_loyalty_rules").select("*").eq("unit_id", unitId)).then((rows) =>
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
  createProduct: (body: { unitId: string; name: string; emoji?: string; priceCents: number; stock: number }) =>
    unwrap<{ id: string }>(
      supabase()
        .from("fa_kiosk_products")
        .insert({ unit_id: body.unitId, name: body.name, emoji: body.emoji ?? null, price_cents: body.priceCents, stock: body.stock })
        .select("id")
        .single(),
    ),
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
  // Criação de funcionário exige uma conta real no Supabase Auth (não dá
  // para ser feita com a chave anônima do cliente) — segue pelo servidor
  // local até a Fase 1 ganhar um fluxo de convite via backoffice/admin API.
  createEmployee: (body: unknown) => api.post<{ id: string }>("/api/employees", body),
  setEmployeeActive: (id: string, active: boolean) => api.patch(`/api/employees/${id}/active`, { active }),

  reportSales: (unitId: string, from: string, to: string) =>
    api.get<{ byDay: DailySales[]; byMethod: RevenueByMethod[] }>(`/api/reports/sales?unitId=${unitId}&from=${from}&to=${to}`),
  reportVisits: (unitId: string, from: string, to: string) =>
    api.get<DailyVisits[]>(`/api/reports/visits?unitId=${unitId}&from=${from}&to=${to}`),
  reportBirthdays: (month: number) => api.get<BirthdayChild[]>(`/api/reports/birthdays?month=${month}`),
  reportShifts: (unitId: string) => api.get<ShiftSummary[]>(`/api/reports/shifts?unitId=${unitId}`),
  reportAssetUsage: (unitId: string, from: string, to: string) =>
    api.get<AssetUsage[]>(`/api/reports/asset-usage?unitId=${unitId}&from=${from}&to=${to}`),
  reportPonto: (fromMs: number, toMs: number) => api.get<FolhaPontoRow[]>(`/api/reports/ponto?fromMs=${fromMs}&toMs=${toMs}`),
};
