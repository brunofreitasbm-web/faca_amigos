/**
 * Fila única de impressão + dedupe por job.id, sem dependência de electron
 * (testável). Garante que, dentro deste processo:
 *  - só UM job imprime por vez (Realtime e sweep entram na mesma fila);
 *  - um job.id nunca é impresso duas vezes, mesmo que o Postgres o devolva a
 *    PENDING (reserva "stale") e ele seja reservado de novo.
 */
export const HANDLED_TTL_MS = 6 * 60 * 60 * 1000;
const HANDLED_MAX = 5000;

export interface PrintQueue<J extends { id: string }> {
  /** Enfileira; resolve quando o job foi tratado ou descartado. Retorna false se descartado por dedupe. */
  enqueue(job: J): Promise<boolean>;
  /** true se o id já está em processamento/fila ou foi tratado recentemente. */
  has(id: string): boolean;
}

export function createPrintQueue<J extends { id: string }>(
  handler: (job: J) => Promise<void | "released">,
  opts: { now?: () => number; log?: (msg: string) => void } = {},
): PrintQueue<J> {
  const now = opts.now ?? Date.now;
  const log = opts.log ?? ((m: string) => console.warn(m));
  const inFlight = new Set<string>();
  const handled = new Map<string, number>(); // id -> instante em que terminou
  let tail: Promise<void> = Promise.resolve();

  function prune(): void {
    const t = now();
    for (const [id, at] of handled) {
      if (t - at > HANDLED_TTL_MS || handled.size > HANDLED_MAX) handled.delete(id);
      else break; // Map mantém ordem de inserção: o resto é mais novo
    }
  }

  function has(id: string): boolean {
    prune();
    return inFlight.has(id) || handled.has(id);
  }

  function enqueue(job: J): Promise<boolean> {
    if (has(job.id)) {
      log(`[print-bridge] job ${job.id} ignorado: já tratado/em processamento neste processo (evita impressão duplicada).`);
      return Promise.resolve(false);
    }
    inFlight.add(job.id);
    const run = tail.then(async () => {
      let released = false;
      try {
        // "released": o job voltou à fila para outro terminal; nada foi impresso,
        // então este processo pode reservá-lo de novo mais tarde.
        released = (await handler(job)) === "released";
      } catch (err) {
        console.error(`[print-bridge] erro inesperado no job ${job.id}:`, err);
      } finally {
        inFlight.delete(job.id);
        // Mesmo se o handler falhou/foi devolvido à fila: não reimprime neste processo.
        if (!released) handled.set(job.id, now());
      }
      return true;
    });
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  return { enqueue, has };
}
