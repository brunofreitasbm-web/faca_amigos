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
}

export interface SessionForQuote {
  checkinAtMs: number;
  childName: string;
  planId: string;
  /** Desconto de cupom já validado, em centavos (0 = nenhum). */
  couponDiscountCents: number;
  couponCode: string | null;
  /** Resgate de cortesia de fidelidade — zera o total. */
  freeFromLoyalty: boolean;
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
