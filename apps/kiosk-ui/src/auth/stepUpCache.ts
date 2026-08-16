/**
 * Cache de reautenticação recente para o EmployeeAuthGate — só em
 * memória (nunca localStorage: não pode sobreviver a uma troca de
 * colaborador num terminal compartilhado). Existe para não pedir o PIN
 * de novo a cada ação sensível dentro de uma janela curta de tempo; a
 * checagem de capacidade em si continua sendo refeita contra o servidor
 * a cada uso, só a digitação do PIN é que é dispensada.
 */

let lastVerified: { employeeId: string; verifiedAtMs: number } | null = null;

export function recordStepUpVerified(employeeId: string): void {
  lastVerified = { employeeId, verifiedAtMs: Date.now() };
}

export function isStepUpFresh(employeeId: string, ttlMs: number): boolean {
  if (!lastVerified || ttlMs <= 0) return false;
  if (lastVerified.employeeId !== employeeId) return false;
  return Date.now() - lastVerified.verifiedAtMs < ttlMs;
}

export function clearStepUpCache(): void {
  lastVerified = null;
}
