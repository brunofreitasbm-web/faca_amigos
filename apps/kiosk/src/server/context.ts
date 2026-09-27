import type { Db } from "@facaamigos/db-local";

export interface AppContext {
  db: Db;
  hmacKey: string;
  nowMs: () => number;
  /**
   * Pasta onde os WAVs de gravação de voz (check-in/check-out) ficam até o
   * worker transcrever e apagar (ver routes/voz.ts e main/voiceWorker.ts).
   * Ausente => rota /api/voz responde "indisponível" (dev sem configurar).
   */
  voiceDir?: string;
}
