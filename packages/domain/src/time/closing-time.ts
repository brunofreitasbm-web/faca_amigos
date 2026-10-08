const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"] as const;

/**
 * Minutos restantes até o horário de fechamento configurado, considerando hoje no fuso local do
 * processo (mesma simplificação já assumida em business-date.ts: servidor roda no fuso da unidade).
 *
 * Formatos (espelha fa_kiosk_minutes_until_closing no banco):
 *   "22:10"             fecha 22:10 todos os dias
 *   "22:10;dom=21:10"   domingo fecha 21:10 (dias: dom, seg, ter, qua, qui, sex, sab)
 *
 * Retorna null se o horário base não estiver no formato "HH:MM".
 */
export function minutesUntilClosing(nowMs: number, closingTime: string): number | null {
  const [base, ...overrides] = closingTime.split(";").map((p) => p.trim());
  const now = new Date(nowMs);
  let pick = base ?? "";
  for (const o of overrides) {
    const m = /^(dom|seg|ter|qua|qui|sex|sab)=(\d{1,2}:\d{2})$/.exec(o);
    if (m && m[1] === DIAS[now.getDay()]) pick = m[2]!;
  }

  const match = /^(\d{1,2}):(\d{2})$/.exec(pick);
  if (!match || !/^\d{1,2}:\d{2}$/.test(base ?? "")) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;

  const closing = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
  return Math.round((closing.getTime() - nowMs) / 60_000);
}
