/**
 * Minutos restantes até o horário de fechamento configurado (ex: "22:00"),
 * considerando hoje no fuso local do processo (mesma simplificação já
 * assumida em business-date.ts: servidor roda no fuso da unidade).
 * Retorna null se `closingTime` não estiver no formato "HH:MM".
 */
export function minutesUntilClosing(nowMs: number, closingTime: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(closingTime.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;

  const now = new Date(nowMs);
  const closing = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
  return Math.round((closing.getTime() - nowMs) / 60_000);
}
