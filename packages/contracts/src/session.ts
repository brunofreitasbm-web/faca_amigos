import { z } from "zod";
import { uuidV7 } from "./common.js";

/**
 * Frame de tick transmitido pelo WebSocket (canal unit:{id}) a 1 Hz.
 * O cliente usa serverNowMs para renderizar — nunca o próprio relógio
 * (seção 5.5 do plano: relógio e fuso).
 */
export const sessionPhaseSchema = z.enum(["VERDE", "AMARELO", "VERMELHO", "EXCEDENTE"]);

export const tickFrameSchema = z.object({
  serverNowMs: z.number().int().nonnegative(),
  sessions: z.array(
    z.object({
      id: uuidV7,
      remainingMs: z.number().int(),
      phase: sessionPhaseSchema,
      billedFractionIndex: z.number().int().nonnegative(),
    }),
  ),
});
export type TickFrame = z.infer<typeof tickFrameSchema>;

/**
 * POST /api/checkout/verify — pareamento de QR da pulseira + ticket
 * (seção 9.3 do plano). Falha de pareamento nunca deve travar
 * silenciosamente: o contrato distingue os motivos de recusa.
 */
export const checkoutVerifyRequestSchema = z.object({
  wristbandPayload: z.string(), // "FA1|W|<sessionShortId>|<hmac8>"
  ticketPayload: z.string(), // "FA1|T|<sessionShortId>|<hmac8>"
});
export type CheckoutVerifyRequest = z.infer<typeof checkoutVerifyRequestSchema>;

export const checkoutVerifyResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), sessionId: uuidV7 }),
  z.object({
    ok: z.literal(false),
    reason: z.enum(["HMAC_INVALIDO", "SESSOES_DIFERENTES", "SESSAO_NAO_ATIVA"]),
  }),
]);
export type CheckoutVerifyResponse = z.infer<typeof checkoutVerifyResponseSchema>;
