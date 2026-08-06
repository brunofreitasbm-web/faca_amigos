export interface ApiError {
  error: string;
  message?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
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
}

export interface Asset {
  id: string;
  unit_id: string;
  name: string;
  emoji: string;
  color: string;
  status: "DISPONIVEL" | "EM_USO" | "MANUTENCAO";
  odometer_minutes: number;
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
}

export type SessionPhase = "VERDE" | "AMARELO" | "VERMELHO" | "EXCEDENTE";

export interface QuoteLine {
  label: string;
  cents: number;
}

export interface ActiveSessionEntry {
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

export const Api = {
  units: () => api.get<Unit[]>("/api/units"),
  employees: () => api.get<Employee[]>("/api/employees"),
  plans: (unitId: string, activity: string) => api.get<Plan[]>(`/api/plans?unitId=${unitId}&activity=${activity}`),
  assets: (unitId: string) => api.get<Asset[]>(`/api/assets?unitId=${unitId}`),
  products: (unitId: string) => api.get<Product[]>(`/api/products?unitId=${unitId}`),
  searchChildren: (q: string) => api.get<ChildMatch[]>(`/api/children/search?q=${encodeURIComponent(q)}`),
  activeSessions: (unitId: string) => api.get<ActiveSessionEntry[]>(`/api/sessions/active?unitId=${unitId}`),
  redeemableRewards: (childId: string) => api.get<RedeemableReward[]>(`/api/children/${childId}/redeemable-rewards`),
  currentShift: (unitId: string) => api.get<Shift | null>(`/api/shifts/current?unitId=${unitId}`),

  loginPin: (employeeId: string, pin: string) => api.post<{ employee: Employee }>("/api/auth/login-pin", { employeeId, pin }),

  checkin: (body: unknown) => api.post<{ sessionId: string; wristbandCode: string; ticketCode: string }>("/api/checkins", body),
  checkout: (body: unknown) => api.post<{ orderId: string; totalCents: number }>("/api/checkout", body),
  pdvOrder: (body: unknown) => api.post<{ orderId: string; totalCents: number }>("/api/pdv/orders", body),

  openShift: (body: unknown) => api.post<{ id: string }>("/api/shifts/open", body),
  closeShift: (shiftId: string, body: unknown) =>
    api.post<{ expected: Record<string, number>; declared: Record<string, number>; divergence: Record<string, number> }>(
      `/api/shifts/${shiftId}/close`,
      body,
    ),
  cashMovement: (shiftId: string, body: unknown) => api.post(`/api/shifts/${shiftId}/cash-movements`, body),
  cashMovements: (shiftId: string) => api.get<CashMovement[]>(`/api/shifts/${shiftId}/cash-movements`),
  revenueByMethod: (shiftId: string) => api.get<RevenueByMethod[]>(`/api/shifts/${shiftId}/revenue-by-method`),

  ponto: (body: unknown) => api.post<{ id: string; nsr: number; atMs: number }>("/api/ponto", body),
  pontoHistory: (employeeId: string, fromMs: number, toMs: number) =>
    api.get<PontoRecord[]>(`/api/ponto/${employeeId}?fromMs=${fromMs}&toMs=${toMs}`),

  coupons: (unitId: string) => api.get<Coupon[]>(`/api/coupons?unitId=${unitId}`),
  createCoupon: (body: unknown) => api.post<{ id: string }>("/api/coupons", body),
  loyaltyRules: (unitId: string) => api.get<LoyaltyRule[]>(`/api/loyalty-rules?unitId=${unitId}`),
  createLoyaltyRule: (body: unknown) => api.post<{ id: string }>("/api/loyalty-rules", body),
  createPlan: (body: unknown) => api.post<{ id: string }>("/api/plans", body),
  setPlanActive: (id: string, active: boolean) => api.patch(`/api/plans/${id}/active`, { active }),
  createProduct: (body: unknown) => api.post<{ id: string }>("/api/products", body),
  createAsset: (body: unknown) => api.post<{ id: string }>("/api/assets", body),
  setAssetStatus: (id: string, status: Asset["status"]) => api.patch(`/api/assets/${id}/status`, { status }),
  createEmployee: (body: unknown) => api.post<{ id: string }>("/api/employees", body),
  setEmployeeActive: (id: string, active: boolean) => api.patch(`/api/employees/${id}/active`, { active }),

  reportSales: (unitId: string, from: string, to: string) =>
    api.get<{ byDay: DailySales[]; byMethod: RevenueByMethod[] }>(`/api/reports/sales?unitId=${unitId}&from=${from}&to=${to}`),
  reportVisits: (unitId: string, from: string, to: string) =>
    api.get<DailyVisits[]>(`/api/reports/visits?unitId=${unitId}&from=${from}&to=${to}`),
  reportBirthdays: (month: number) => api.get<BirthdayChild[]>(`/api/reports/birthdays?month=${month}`),
  reportShifts: (unitId: string) => api.get<ShiftSummary[]>(`/api/reports/shifts?unitId=${unitId}`),
  reportPonto: (fromMs: number, toMs: number) => api.get<FolhaPontoRow[]>(`/api/reports/ponto?fromMs=${fromMs}&toMs=${toMs}`),
};
