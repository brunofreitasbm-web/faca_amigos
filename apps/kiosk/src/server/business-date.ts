/**
 * Dia operacional (seção 4.1 do plano): um dia começa no cutoff
 * configurado (padrão 04:00), não à meia-noite — para o turno da
 * madrugada não virar "dia seguinte" no meio do expediente.
 *
 * Simplificação assumida aqui: o servidor roda no fuso da unidade
 * (America/Belém, UTC-3 fixo, sem horário de verão), então trabalhar
 * em horário local do processo equivale a trabalhar em America/Belém.
 * Isso deixa de valer se o kiosk algum dia rodar em outro fuso —
 * nesse caso a conversão explícita por timezone (seção 5.5) passa a
 * ser necessária.
 */
export function businessDateFor(nowMs: number, cutoffHour: number): string {
  const d = new Date(nowMs);
  const shifted = new Date(d.getTime() - cutoffHour * 60 * 60_000);
  const y = shifted.getFullYear();
  const m = String(shifted.getMonth() + 1).padStart(2, "0");
  const day = String(shifted.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
