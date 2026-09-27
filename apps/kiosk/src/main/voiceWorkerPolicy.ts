/**
 * Regras puras do worker de transcrição de voz (voiceWorker.ts) — extraídas
 * para dar para testar sem spawnar o whisper-cli de verdade, mesmo
 * raciocínio de printJobPolicy.ts.
 */

export interface WhisperSegment {
  fromMs: number;
  toMs: number;
  text: string;
}

/** Formato de saída `-oj` do whisper.cpp (transcription[].offsets.{from,to} em ms, .text). */
interface WhisperCppJson {
  transcription?: Array<{ offsets?: { from?: number; to?: number }; text?: string }>;
}

export function buildWhisperArgs(opts: { modelPath: string; wavPath: string; outBase: string; threads: number }): string[] {
  return [
    "-m",
    opts.modelPath,
    "-f",
    opts.wavPath,
    "-l",
    "pt",
    "-oj",
    "-of",
    opts.outBase,
    "-t",
    String(Math.max(1, opts.threads)),
    "-np", // no-prints: não imprime nada além do necessário no stdout
    "-sns", // suppress non-speech tokens: reduz alucinação em trechos de silêncio/ruído
  ];
}

/** Remove segmentos idênticos repetidos 3x+ seguidas — sintoma clássico de alucinação do whisper em silêncio/ruído. */
function dropRepeatedSegments(segments: WhisperSegment[]): WhisperSegment[] {
  const out: WhisperSegment[] = [];
  let streak = 0;
  let lastNormalized = "";
  for (const seg of segments) {
    const normalized = seg.text.trim().toLowerCase();
    if (normalized && normalized === lastNormalized) {
      streak++;
    } else {
      streak = 1;
      lastNormalized = normalized;
    }
    if (streak <= 2) out.push(seg);
  }
  return out;
}

export interface ParsedTranscript {
  text: string;
  segments: WhisperSegment[];
  /** Menos de 5 palavras após a limpeza: provavelmente silêncio/ruído, não uma conversa de venda. */
  isEmpty: boolean;
}

export function parseWhisperJson(raw: string): ParsedTranscript {
  let parsed: WhisperCppJson;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { text: "", segments: [], isEmpty: true };
  }

  const rawSegments: WhisperSegment[] = (parsed.transcription ?? [])
    .map((t) => ({ fromMs: t.offsets?.from ?? 0, toMs: t.offsets?.to ?? 0, text: (t.text ?? "").trim() }))
    .filter((s) => s.text.length > 0);

  const segments = dropRepeatedSegments(rawSegments);
  const text = segments
    .map((s) => s.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  const wordCount = text.split(/\s+/).filter(Boolean).length;
  return { text, segments, isEmpty: wordCount < 5 };
}

/**
 * Mascara CPF (com ou sem pontuação) e telefone brasileiro (E.164 ou com
 * DDD) que o whisper eventualmente transcreveu ao pé da letra — o texto
 * sobe para uma base de conhecimento de treinamento, não precisa (e não
 * deve) carregar o documento/telefone literal de ninguém.
 *
 * Um número de 11 dígitos sem nenhuma pontuação é ambíguo entre CPF e
 * celular (DDD + 9 + 8 dígitos também dá 11) — a regra de CPF roda
 * primeiro e "vence" nesse caso. Não tem problema: o objetivo é remover o
 * dado sensível do texto, não classificá-lo corretamente.
 */
export function maskPiiInTranscript(text: string): string {
  return text
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[CPF]")
    .replace(/\+?55\s?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g, "[TELEFONE]")
    .replace(/\(?\d{2}\)?\s?9\d{4}[-\s]?\d{4}\b/g, "[TELEFONE]");
}

/** Timeout do processo whisper-cli: proporcional à duração do áudio, com um piso para áudios curtos (overhead de carregar o modelo). */
export function whisperTimeoutMs(durationMs: number): number {
  return Math.max(60_000, durationMs * 3);
}
