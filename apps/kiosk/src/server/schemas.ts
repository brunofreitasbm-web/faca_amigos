import { z } from "zod";
import { normalizePhoneE164, normalizeCpf, isValidCpf } from "@facaamigos/domain";


/**
 * DTOs específicos de Configurações/gestão que ainda não vivem em
 * packages/contracts. Ficam aqui enquanto só o kiosk local os usa; o
 * dia que o back-office (Next.js) ou um tablet precisar dos mesmos
 * formatos, é sinal de promovê-los para o pacote compartilhado.
 */

export const createPlanSchema = z.object({
  unitId: z.string().uuid(),
  activity: z.enum(["PLAYGROUND", "CARRINHO"]),
  name: z.string().min(1),
  valueCents: z.number().int().nonnegative(),
  durationValue: z.number().int().positive(),
  durationUnit: z.enum(["MINUTO", "HORA"]),
  overageCentsPerMinute: z.number().int().nonnegative(),
  color: z.string().min(1).default("#2ECFB5"),
});

export const createProductSchema = z.object({
  unitId: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().optional(),
  emoji: z.string().optional(),
  priceCents: z.number().int().nonnegative(),
  stock: z.number().int().nonnegative().default(0),
});

export const createCouponSchema = z.object({
  unitId: z.string().uuid(),
  code: z.string().min(1),
  kind: z.enum(["MINUTOS_EXTRA", "DESCONTO_PCT", "DESCONTO_VALOR"]),
  value: z.number().int().positive(),
  maxUses: z.number().int().nonnegative().default(0),
  description: z.string().optional(),
});

export const createLoyaltyRuleSchema = z.object({
  unitId: z.string().uuid(),
  activity: z.enum(["PLAYGROUND", "CARRINHO", "AMBOS"]),
  triggerVisits: z.number().int().positive(),
  rewardKind: z.enum(["ENTRADA_GRATIS", "DESCONTO_PCT", "MINUTOS_EXTRA"]),
  rewardValue: z.number().int().positive(),
});

export const createBonusRuleSchema = z.object({
  unitId: z.string().uuid(),
  description: z.string().min(1),
  rewardValueCents: z.number().int().nonnegative(),
});

export const setUnitSettingSchema = z.object({
  key: z.enum(["daily_goal_cents", "terms_of_use", "closing_time"]),
  value: z.string(),
});

export const notifySessionSchema = z.object({
  channel: z.enum(["WHATSAPP", "SMS"]),
  message: z.string().min(1),
});

export const changeSessionPlanSchema = z.object({
  planId: z.string().uuid(),
});

export const createAssetSchema = z.object({
  unitId: z.string().uuid(),
  name: z.string().min(1),
  emoji: z.string().min(1),
  color: z.string().min(1),
  maintenanceThresholdHours: z.number().int().positive().default(200),
});

export const createEmployeeSchema = z.object({
  fullName: z.string().min(2),
  role: z.enum(["OPERADOR", "GERENTE", "ADMIN"]),
  pis: z.string().optional(),
  cpfLast4: z.string().length(4).optional(),
  pin: z.string().regex(/^\d{6}$/, "PIN deve ter 6 dígitos"),
});

export const setAssetStatusSchema = z.object({
  status: z.enum(["DISPONIVEL", "EM_USO", "MANUTENCAO"]),
});

export const loginPinSchema = z.object({
  employeeId: z.string().uuid(),
  pin: z.string(),
});

export const checkinBodySchema = z.object({
  unitId: z.string().uuid(),
  activity: z.enum(["PLAYGROUND", "CARRINHO"]),
  assetId: z.string().uuid().optional(),
  planId: z.string().uuid(),
  employeeId: z.string().uuid(),
  child: z.object({
    id: z.string().uuid().optional(),
    fullName: z.string().min(2),
    birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    inclusiveEligible: z.boolean().default(false),
    inclusiveProofType: z.enum(["LAUDO", "CIPTEA", "BPC", "CIN_TEA", "OUTRO"]).optional(),
  }),
  guardian: z.object({
    id: z.string().uuid().optional(),
    fullName: z.string().min(2),
    cpf: z
      .string()
      .transform(normalizeCpf)
      .pipe(z.string().refine(isValidCpf, "CPF inválido")),
    phoneE164: z
      .string()
      .transform(normalizePhoneE164)
      .pipe(z.string().regex(/^\+55\d{10,11}$/, "Telefone deve conter DDD + número (ex: 91999999999)")),
  }),
  couponCode: z.string().optional(),
});

export const checkoutBodySchema = z.object({
  sessionIds: z.array(z.string().uuid()).min(1),
  employeeId: z.string().uuid(),
  payments: z
    .array(
      z.object({
        method: z.enum(["DINHEIRO", "PIX", "CREDITO", "DEBITO", "VOUCHER"]),
        amountCents: z.number().int().positive(),
        nsu: z.string().optional(),
        authorization: z.string().optional(),
      }),
    )
    .min(1),
  redeemRewardIds: z.array(z.string().uuid()).default([]),
});

export const pdvOrderBodySchema = z.object({
  unitId: z.string().uuid(),
  employeeId: z.string().uuid(),
  items: z.array(z.object({ productId: z.string().uuid(), quantity: z.number().int().positive() })).min(1),
  payments: z
    .array(
      z.object({
        method: z.enum(["DINHEIRO", "PIX", "CREDITO", "DEBITO", "VOUCHER"]),
        amountCents: z.number().int().positive(),
      }),
    )
    .min(1),
});

export const openShiftBodySchema = z.object({
  unitId: z.string().uuid(),
  employeeId: z.string().uuid(),
  openingCashCents: z.number().int().nonnegative(),
});

export const closeShiftBodySchema = z.object({
  employeeId: z.string().uuid(),
  declared: z.record(z.string(), z.number().int().nonnegative()),
});

export const cashMovementBodySchema = z.object({
  employeeId: z.string().uuid(),
  kind: z.enum(["SANGRIA", "SUPRIMENTO", "AJUSTE"]),
  amountCents: z.number().int().positive(),
  reason: z.string().optional(),
});

export const pontoBodySchema = z.object({
  unitId: z.string().uuid(),
  employeeId: z.string().uuid(),
  kind: z.enum(["ENTRADA", "SAIDA", "INTERVALO_INICIO", "INTERVALO_FIM"]),
  registeredByEmployeeId: z.string().uuid().optional(),
});
