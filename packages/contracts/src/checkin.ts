import { z } from "zod";
import { uuidV7 } from "./common.js";

function normalizePhoneE164(phone: string): string {
  if (!phone) return phone;
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) return `+${digits}`;
  if (trimmed.startsWith("+")) return `+${digits}`;
  return trimmed;
}



/**
 * Payload de POST /api/checkins (seção 1.3 do plano — fluxo de check-in).
 * Formulário reduzido por decisão de produto: sem biometria, sem foto.
 */
export const consentCheckboxSchema = z.object({
  purpose: z.enum(["TERMO_USO", "DADOS_SAUDE", "WHATSAPP_MARKETING"]),
  granted: z.boolean(),
  termsVersion: z.number().int().positive(),
});

export const checkinRequestSchema = z.object({
  activityCode: z.enum(["PLAYGROUND", "CARRINHO"]),
  assetId: uuidV7.optional(), // obrigatório quando activityCode === 'CARRINHO'

  child: z.object({
    id: uuidV7.optional(), // presente se já é cliente conhecido (busca por telefone)
    fullName: z.string().min(2).max(120),
    birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    inclusiveEligible: z.boolean().default(false),
    inclusiveProofType: z.enum(["LAUDO", "CIPTEA", "BPC", "CIN_TEA", "OUTRO"]).optional(),
  }),

  guardian: z.object({
    id: uuidV7.optional(),
    fullName: z.string().min(2).max(120),
    phoneE164: z
      .string()
      .transform(normalizePhoneE164)
      .pipe(z.string().regex(/^\+55\d{10,11}$/, "Telefone deve estar em E.164 (+55DDDNNNNNNNNN)")),
  }),

  // Consentimentos SEPARADOS e não pré-marcados (seção 8 do plano — LGPD).
  // TERMO_USO é obrigatório; DADOS_SAUDE e WHATSAPP_MARKETING são opcionais.
  consents: z.array(consentCheckboxSchema).min(1),

  requestedMinutes: z.number().int().positive().nullable(), // null = Day Use

  idempotencyKey: uuidV7,
});
export type CheckinRequest = z.infer<typeof checkinRequestSchema>;

export const checkinResponseSchema = z.object({
  sessionId: uuidV7,
  wristbandCode: z.string(),
  ticketCode: z.string(),
  printJobIds: z.array(uuidV7),
  offer: z.object({
    priceTier: z.enum(["GERAL", "INCLUSIVO"]),
    offerKind: z.enum([
      "AVULSO",
      "PACOTE",
      "DAY_USE",
      "ASSINATURA",
      "BANCO_HORAS",
      "FIDELIDADE",
      "CORTESIA",
      "PARCEIRO_CLINICA",
    ]),
    quotedListCents: z.number().int(),
    quotedDiscountCents: z.number().int(),
  }),
});
export type CheckinResponse = z.infer<typeof checkinResponseSchema>;
