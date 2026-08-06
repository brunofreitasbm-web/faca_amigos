export type Role = "OPERADOR" | "GERENTE" | "ADMIN";

interface PermissionRule {
  roles: readonly Role[];
  /** Papel mínimo exigido para step-up (PIN de gerente) mesmo se o papel atual já tem acesso. */
  stepUp?: Role;
  /** Se presente, toda concessão desse tipo é gravada em audit_log independentemente do resultado. */
  audit?: "ALWAYS";
}

function rule(roles: readonly Role[], extra: Omit<PermissionRule, "roles"> = {}): PermissionRule {
  return { roles, ...extra };
}

/**
 * Matriz declarativa de permissões (seção 7.2 do plano). Não fica em
 * tabela: é código, versionado e revisável em PR como qualquer regra
 * de negócio sensível.
 */
export const PERMISSIONS = {
  "session.checkin": rule(["OPERADOR", "GERENTE", "ADMIN"]),
  "session.checkout.bypass_ticket": rule(["OPERADOR", "GERENTE", "ADMIN"], { stepUp: "GERENTE" }),
  "order.discount.manual": rule(["GERENTE", "ADMIN"], { stepUp: "GERENTE" }),
  "order.reverse": rule(["GERENTE", "ADMIN"], { stepUp: "GERENTE" }),
  "shift.close": rule(["GERENTE", "ADMIN"]),
  "shift.view_expected": rule(["GERENTE", "ADMIN"]),
  "cash.sangria": rule(["OPERADOR", "GERENTE", "ADMIN"]),
  "price_table.edit": rule(["ADMIN"]),
  "customer.export": rule(["ADMIN"], { audit: "ALWAYS" }),
} as const satisfies Record<string, PermissionRule>;

export type PermissionKey = keyof typeof PERMISSIONS;

export interface PermissionCheck {
  allowed: boolean;
  requiresStepUp: boolean;
}

/**
 * `stepUpRole` é o papel autenticado no momento via PIN adicional
 * (pode ser diferente do papel logado — ex.: operador chama o
 * gerente). Quando ausente, `requiresStepUp` avisa a UI para pedir o
 * PIN antes de liberar a ação.
 */
export function checkPermission(key: PermissionKey, role: Role, stepUpRole?: Role): PermissionCheck {
  const permission = PERMISSIONS[key];
  const hasBaseRole = (permission.roles as readonly Role[]).includes(role);
  if (!hasBaseRole) return { allowed: false, requiresStepUp: false };

  if (!permission.stepUp) return { allowed: true, requiresStepUp: false };

  const ROLE_RANK: Record<Role, number> = { OPERADOR: 0, GERENTE: 1, ADMIN: 2 };
  const satisfiedByOwnRole = ROLE_RANK[role] >= ROLE_RANK[permission.stepUp];
  const satisfiedByStepUp = stepUpRole !== undefined && ROLE_RANK[stepUpRole] >= ROLE_RANK[permission.stepUp];

  if (satisfiedByOwnRole || satisfiedByStepUp) return { allowed: true, requiresStepUp: false };
  return { allowed: true, requiresStepUp: true };
}
