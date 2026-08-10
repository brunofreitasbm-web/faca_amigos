import { z } from "zod";
import { uuidV7 } from "./common.js";

/**
 * Resposta da RPC pública fa_acompanhar_por_codigo — painel do
 * responsável, acessado sem login via QR da pulseira/recibo. União
 * discriminada por `status`: cada motivo carrega só os campos que fazem
 * sentido para ele (uma sessão FINALIZADA não tem plano para mostrar).
 */
export const acompanharPlanoSchema = z.object({
  durationValue: z.number().int().positive(),
  durationUnit: z.enum(["MINUTO", "HORA"]),
  valueCents: z.number().int().nonnegative(),
  overageCentsPerMinute: z.number().int().nonnegative(),
  /** Só preenchido para activity=CARRINHO — distingue carro elétrico de pelúcia (mesma activity, ver copyCircuito.ts). */
  assetKind: z.enum(["CARRO", "PELUCIA"]).nullable(),
});

export const acompanharSessaoSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("NAO_ENCONTRADO") }),
  z.object({
    status: z.literal("NAO_SUPORTADO"),
    childFirstName: z.string(),
  }),
  z.object({
    status: z.literal("FINALIZADA"),
    childFirstName: z.string(),
    checkoutAtMs: z.number().int().nonnegative().nullable(),
  }),
  z.object({
    status: z.enum(["ATIVA", "PAUSADA"]),
    sessionId: uuidV7,
    childFirstName: z.string(),
    activity: z.enum(["PLAYGROUND", "CARRINHO"]),
    checkinAtMs: z.number().int().nonnegative(),
    pausedAtMs: z.number().int().nonnegative().nullable(),
    pausedMsTotal: z.number().int().nonnegative(),
    /** Instante do servidor no momento da resposta — usado pelo cliente para corrigir o relógio local do celular. */
    serverNowMs: z.number().int().nonnegative(),
    sensoryTags: z.array(z.string()),
    plan: acompanharPlanoSchema,
  }),
]);
export type AcompanharSessao = z.infer<typeof acompanharSessaoSchema>;

/** Tipos de evento que o painel do responsável pode gravar via fa_acompanhar_evento. */
export const acompanharEventoKindSchema = z.enum(["QR_ABERTO", "LEMBRETE_ATIVADO", "RENOVACAO_SOLICITADA"]);
export type AcompanharEventoKind = z.infer<typeof acompanharEventoKindSchema>;
