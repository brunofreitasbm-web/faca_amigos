/**
 * Passagem de Turno — regras puras do livro de registro diário.
 *
 * ATENÇÃO: `validateHandover` é a MESMA regra que
 * `supabase/migrations/20260920100000_fa_passagem_turno.sql` aplica dentro
 * de `fa_close_shift`. A duplicação é intencional e não é opcional: o
 * fechamento pode ficar horas na fila offline, e é a validação daqui que
 * garante que o payload enfileirado não vai ser recusado pelo servidor na
 * manhã seguinte. Se um dia a regra do SQL mudar, esta muda junto.
 */

export interface HandoverDraft {
  /** Declaração explícita de "não houve nada a repassar neste turno". */
  noChanges: boolean;
  conteudo: string;
}

/** Mínimo de caracteres úteis quando o operador escolhe escrever. */
export const HANDOVER_MIN_CHARS = 10;

/** Piso do atraso do botão "Li e estou ciente" (ms). */
export const ACK_DELAY_MIN_MS = 6000;
/** Teto — ninguém fica preso olhando uma contagem regressiva longa. */
export const ACK_DELAY_MAX_MS = 20000;
/** Ritmo de leitura assumido para dimensionar o atraso. */
const MS_POR_CARACTERE = 35;

export type HandoverInvalidReason = "VAZIO" | "CURTO" | "CONTRADITORIO";

export type HandoverValidation = { ok: true } | { ok: false; reason: HandoverInvalidReason };

export function validateHandover(draft: HandoverDraft): HandoverValidation {
  const texto = draft.conteudo.trim();
  if (draft.noChanges) {
    // Marcar "sem alteração" e escrever ao mesmo tempo deixa o registro
    // ambíguo para quem lê amanhã — a tela precisa forçar a escolha.
    return texto.length > 0 ? { ok: false, reason: "CONTRADITORIO" } : { ok: true };
  }
  if (texto.length === 0) return { ok: false, reason: "VAZIO" };
  if (texto.length < HANDOVER_MIN_CHARS) return { ok: false, reason: "CURTO" };
  return { ok: true };
}

/** Mensagem em PT-BR para cada motivo de recusa, exibida abaixo do campo. */
export const HANDOVER_INVALID_MESSAGE: Record<HandoverInvalidReason, string> = {
  VAZIO: "Escreva o que precisa ser repassado ou marque “Sem alteração a registrar”.",
  CURTO: `Descreva com um pouco mais de detalhe (mínimo ${HANDOVER_MIN_CHARS} caracteres) ou marque “Sem alteração a registrar”.`,
  CONTRADITORIO: "Você marcou “Sem alteração” mas escreveu um texto. Desmarque a opção ou apague o texto.",
};

/**
 * Forma canônica enviada ao servidor: texto sempre aparado e zerado quando
 * o operador declarou "sem alteração" (evita mandar um rascunho esquecido
 * junto com a declaração de que nada houve).
 */
export function normalizeHandover(draft: HandoverDraft): HandoverDraft {
  if (draft.noChanges) return { noChanges: true, conteudo: "" };
  return { noChanges: false, conteudo: draft.conteudo.trim() };
}

/**
 * Atraso do botão de ciência. Não impede o clique automático — só encarece
 * o suficiente para que ler seja mais rápido que esperar, e o tempo real
 * gasto fica registrado em `leitura_ms` para o Gerencial.
 */
export function ackDelayFor(conteudo: string | null | undefined): number {
  const chars = (conteudo ?? "").trim().length;
  const bruto = ACK_DELAY_MIN_MS + chars * MS_POR_CARACTERE;
  return Math.min(ACK_DELAY_MAX_MS, Math.max(ACK_DELAY_MIN_MS, bruto));
}

/** Resumo de uma linha para listas (aba Gerencial). */
export function handoverSummary(h: { no_changes: boolean; conteudo: string | null }, maxChars = 120): string {
  if (h.no_changes) return "Sem alteração";
  const texto = (h.conteudo ?? "").trim().replace(/\s+/g, " ");
  if (texto.length === 0) return "—";
  return texto.length > maxChars ? `${texto.slice(0, maxChars - 1)}…` : texto;
}
