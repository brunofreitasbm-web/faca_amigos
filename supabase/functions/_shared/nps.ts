// Pesquisa de NPS em etapas, respondida digitando o número dentro do WhatsApp.
// Só funções puras (sem Deno nem Supabase) para poderem ser testadas.
//
//   UNIT    "Em qual unidade você esteve?"  -> número da lista (no template novo é a 1ª pergunta;
//           no template antigo, que já abre pedindo a nota, vem logo depois da nota)
//   SCORE   recomendação de 0 a 10 (o NPS)
//   TEAM    equipe, 1 a 5
//   SPACE   espaço, 1 a 5
//   COMMENT contribuição em texto livre (ou "não")

export type NpsStep = "UNIT" | "SCORE" | "TEAM" | "SPACE" | "COMMENT";

export interface NpsSurveyState {
  status: string;
  unit_id: string | null;
  unit_options: unknown;
  score_team: number | null;
}

export interface UnitOption {
  id: string;
  name: string;
}

export function unitOptions(raw: unknown): UnitOption[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (o): o is UnitOption => !!o && typeof (o as UnitOption).id === "string" && typeof (o as UnitOption).name === "string",
  );
}

/** Próxima pergunta em aberto, ou null se a pesquisa não está esperando resposta. */
export function npsStep(s: NpsSurveyState): NpsStep | null {
  switch (s.status) {
    case "SENT":
      return unitOptions(s.unit_options).length > 0 && !s.unit_id ? "UNIT" : "SCORE";
    case "ASKING":
      // Template antigo: a unidade é perguntada DEPOIS da nota (unit_options é gravado nessa hora).
      if (unitOptions(s.unit_options).length > 0 && !s.unit_id) return "UNIT";
      return s.score_team == null ? "TEAM" : "SPACE";
    case "SCORED":
      return "COMMENT";
    default:
      return null;
  }
}

export type NumberParse = { kind: "ok"; value: number } | { kind: "out" } | { kind: "none" };

const KEYWORD = /(nota|unidade|op[cç][aã]o|n[uú]mero)/i;

/**
 * Lê um número digitado. Aceita a mensagem só com o número ("9", "9.", "9)")
 * ou curta com uma palavra-chave ("nota 9", "unidade 2"). Qualquer outra
 * coisa — texto livre, mais de um número — não é resposta: devolve "none" e
 * a mensagem segue como conversa normal. Só um número SOZINHO fora da faixa
 * ("7" na escala de 1 a 5) devolve "out", para o bot repetir a instrução.
 */
export function parseNumberInRange(body: string, min: number, max: number): NumberParse {
  const text = body.trim();
  const tokens = text.match(/\d+/g);
  if (!tokens || tokens.length !== 1) return { kind: "none" };
  const bare = /^\d+\s*[).!]?$/.test(text);
  if (!bare && !(text.length <= 40 && KEYWORD.test(text))) return { kind: "none" };
  const value = Number(tokens[0]);
  if (value >= min && value <= max) return { kind: "ok", value };
  return bare ? { kind: "out" } : { kind: "none" };
}

const DECLINES = new Set([
  "n", "nao", "nada", "nenhuma", "nenhum", "sem", "nao obrigado", "nao obrigada", "nao quero", "nao tenho", "nao tenho nada",
]);

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "não", "nada", "não obrigado"… na pergunta da contribuição. */
export function isDecline(body: string): boolean {
  return DECLINES.has(normalize(body));
}

export const NPS_FIRST_REPLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // primeira resposta: até 7 dias após o envio
export const NPS_STEP_WINDOW_MS = 24 * 60 * 60 * 1000; // cada etapa seguinte: até 24h após a anterior

/** Texto da lista numerada: "1) A · 2) B · 3) C" (mesmo formato usado no template). */
export function unitListText(options: UnitOption[]): string {
  return options.map((o, i) => `${i + 1}) ${o.name}`).join(" · ");
}

export const NPS_TEXT = {
  scoreQuestion: (unitName: string | null) =>
    `Obrigado! 💛 1/3 — De 0 a 10, o quanto você recomendaria ${unitName ?? "o FaçaAmigos"} a um amigo? Responda só com o número.`,
  /** Template antigo: o cliente já deu a nota; a unidade vem em seguida. */
  unitAfterScoreQuestion: (options: UnitOption[]) =>
    `Obrigado pela nota! 💛 Para registrar direitinho: em qual unidade você esteve? Responda só com o número: ${unitListText(options)}`,
  teamQuestion:
    "Anotado! 2/3 — De 1 a 5, como foi o cuidado e o atendimento da nossa equipe? (1 = ruim, 5 = excelente) Responda só com o número.",
  spaceQuestion:
    "Quase lá! 3/3 — De 1 a 5, e o espaço: estrutura, limpeza e segurança? (1 = ruim, 5 = excelente) Responda só com o número.",
  commentQuestion: (score: number) =>
    score >= 9
      ? "Que alegria! 💛 Quer deixar alguma contribuição ou elogio? É só escrever aqui. Se preferir não, responda NÃO."
      : score >= 7
        ? "Obrigado! 💛 O que podemos fazer para sua próxima visita ser ainda melhor? Escreva aqui ou responda NÃO."
        : "Poxa, sentimos muito. 😔 Quer nos contar o que aconteceu? Vamos usar seu retorno para melhorar. Escreva aqui ou responda NÃO.",
  thanks: "Muito obrigado pelo seu retorno! Ele ajuda a melhorar cada visita. 💛",
  thanksNoComment: "Tudo bem! Obrigado por responder. 💛",
  retryUnit: (options: UnitOption[]) => `Não entendi 😅 Responda só com o número da unidade: ${unitListText(options)}`,
  retryScore: "Não entendi 😅 Responda só com um número de 0 a 10.",
  retryFive: "Não entendi 😅 Responda só com um número de 1 a 5.",
} as const;
