import { z } from "zod";
import { businessDate, centavos, epochMs, uuidV7 } from "./common.js";

/**
 * Contrato da declaração de faturamento entregue à administração do
 * shopping (`GET /integracao/shopping/v1/faturamento`).
 *
 * Vive em `contracts` e não só em `domain` porque este é o único DTO
 * do sistema com um consumidor *externo*: o dia que um campo mudar de
 * significado aqui, quebra o lado de lá. Ter o schema versionado num
 * pacote compartilhado deixa essa quebra visível no diff — e permite
 * que o teste valide a resposta real contra o contrato publicado, em
 * vez de contra a nossa lembrança dele.
 */

export const meioPagamento = z.enum(["DINHEIRO", "PIX", "CREDITO", "DEBITO", "VOUCHER"]);
export const naturezaReceita = z.enum(["SERVICO", "PRODUTO"]);

export const totaisPorMeioPagamento = z.object({
  DINHEIRO: centavos,
  PIX: centavos,
  CREDITO: centavos,
  DEBITO: centavos,
  VOUCHER: centavos,
});

export const totaisPorNatureza = z.object({
  SERVICO: centavos,
  PRODUTO: centavos,
});

export const identificacaoLojaSchema = z.object({
  unidadeId: uuidV7,
  nome: z.string(),
  cnpj: z.string().nullable(),
  razaoSocial: z.string().nullable(),
  /** LUC: código da unidade comercial no contrato de locação. */
  luc: z.string().nullable(),
  codigoLojista: z.string().nullable(),
  timezone: z.string(),
  cutoffHoraDiaOperacional: z.number().int().min(0).max(23),
});

export const faturamentoDiaSchema = z.object({
  data: businessDate,
  brutoCentavos: centavos,
  descontosCentavos: centavos,
  liquidoCentavos: centavos,
  cancelamentosCentavos: centavos,
  quantidadeVendas: z.number().int().nonnegative(),
  quantidadeCancelamentos: z.number().int().nonnegative(),
  ticketMedioCentavos: centavos,
  porNatureza: totaisPorNatureza,
  porMeioPagamento: totaisPorMeioPagamento,
});

export const faturamentoPeriodoSchema = faturamentoDiaSchema
  .omit({ data: true })
  .extend({ dataInicial: businessDate, dataFinal: businessDate });

export const declaracaoFaturamentoSchema = z.object({
  layoutVersao: z.string(),
  loja: identificacaoLojaSchema,
  periodo: faturamentoPeriodoSchema,
  dias: z.array(faturamentoDiaSchema),
  moeda: z.literal("BRL"),
  unidadeValores: z.literal("CENTAVOS"),
  geradoEmMs: epochMs,
});

export type DeclaracaoFaturamentoDto = z.infer<typeof declaracaoFaturamentoSchema>;
export type FaturamentoDiaDto = z.infer<typeof faturamentoDiaSchema>;
