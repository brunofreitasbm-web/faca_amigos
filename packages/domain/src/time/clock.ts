/**
 * Relógio injetado (D5 / seção 5.5 do plano): o domínio nunca lê o
 * relógio do sistema diretamente. Isso permite testes determinísticos
 * e faz o mesmo motor rodar em Electron, navegador e Edge Function.
 */
export interface Clock {
  nowMs(): number;
}

export function fixedClock(atMs: number): Clock {
  return { nowMs: () => atMs };
}
