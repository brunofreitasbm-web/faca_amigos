/**
 * Expiração diária da sessão do terminal.
 *
 * A sessão do Supabase Auth fica salva no navegador e sobrevive a reinício do
 * terminal. Um timer em memória não basta para encerrá-la às 23h30: se a
 * máquina estiver desligada, suspensa ou o app fechado nesse horário, o timer
 * nunca dispara e, no dia seguinte, o operador anterior continua logado.
 *
 * Por isso o horário do login (PIN ou SSO do Hub) é gravado aqui e a sessão é
 * considerada vencida se esse login for anterior ao último corte das 23h30 —
 * checado tanto ao restaurar a sessão quanto a cada 30 s com o app aberto.
 */

const STORAGE_KEY = "fa_kiosk_session_started_at";

/** Horário local do corte diário. */
export const AUTO_LOGOUT_HOUR = 23;
export const AUTO_LOGOUT_MINUTE = 30;

/** Último corte (23h30 local) que já aconteceu em relação a `now`. */
export function lastCutoff(now: Date): Date {
  const cutoff = new Date(now);
  cutoff.setHours(AUTO_LOGOUT_HOUR, AUTO_LOGOUT_MINUTE, 0, 0);
  if (cutoff.getTime() > now.getTime()) cutoff.setDate(cutoff.getDate() - 1);
  return cutoff;
}

/** Sessão sem carimbo (anterior a esta regra) é tratada como vencida: falha fechada. */
export function isSessionExpired(startedAtMs: number | null, now: Date = new Date()): boolean {
  if (startedAtMs === null) return true;
  return startedAtMs < lastCutoff(now).getTime();
}

export function markSessionStarted(now: Date = new Date()) {
  try {
    localStorage.setItem(STORAGE_KEY, String(now.getTime()));
  } catch { /* melhor esforço: falha ignorada */ }
}

export function readSessionStartedAt(): number | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const value = raw === null ? NaN : Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export function clearSessionStarted() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* melhor esforço: falha ignorada */ }
}

export function isStoredSessionExpired(now: Date = new Date()): boolean {
  return isSessionExpired(readSessionStartedAt(), now);
}
