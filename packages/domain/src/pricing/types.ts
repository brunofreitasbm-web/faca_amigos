export type DurationUnit = "MINUTO" | "HORA";

export interface Plan {
  id: string;
  activity: "PLAYGROUND" | "CARRINHO";
  name: string;
  valueCents: number;
  durationValue: number;
  durationUnit: DurationUnit;
  /** Preço do minuto excedente, cobrado após o teto do plano. */
  overageCentsPerMinute: number;
  /** Cor usada para identificar o plano no Painel (hex). */
  color: string;
  active?: boolean;
}

export interface SessionForQuote {
  checkinAtMs: number;
  childName: string;
  planId: string;
  activity?: "PLAYGROUND" | "CARRINHO";
  /** Desconto de cupom já validado, em centavos (0 = nenhum). Usado direto para cupom DESCONTO_VALOR. */
  couponDiscountCents: number;
  couponCode: string | null;
  /** Tipo do cupom aplicado no check-in (null/undefined = nenhum, ou cupom antigo sem essa info). */
  couponKind?: "DESCONTO_PCT" | "DESCONTO_VALOR" | null;
  /** Percentual do cupom quando couponKind = DESCONTO_PCT (ex: 50 = 50%). */
  couponPct?: number | null;
  /** Resgate de cortesia de fidelidade — zera o total. */
  freeFromLoyalty: boolean;
  /** Timestamp de quando a sessão foi pausada; null = não está pausada agora. */
  pausedAtMs: number | null;
  /** Soma de todos os períodos pausados já encerrados (não inclui a pausa em curso). */
  pausedMsTotal: number;
}

export type SessionPhase = "VERDE" | "AMARELO" | "VERMELHO" | "EXCEDENTE";

export interface SessionTiming {
  elapsedMs: number;
  durationMs: number;
  overMinutes: number;
  overCents: number;
  /** Preço do plano + excedente, sem cupom/fidelidade. */
  liveTotalCents: number;
  phase: SessionPhase;
  isPaused: boolean;
  /** Há quanto tempo está pausada agora (0 se não estiver pausada). */
  pausedForMs: number;
}

export interface QuoteLine {
  label: string;
  cents: number;
}

export interface SessionQuote {
  plan: Plan;
  timing: SessionTiming;
  lines: QuoteLine[];
  totalCents: number;
}
