/**
 * Capacidades do RBAC — espelho da tabela `fa_kiosk_role_capabilities`
 * (migration 20260807000002).
 *
 * Isto é uma lista de NOMES, não a regra: quem tem o quê é decidido no
 * banco e chega pronto pela view `fa_kiosk_my_capabilities`. O tipo existe
 * só para o TypeScript acusar um `can("cofig.write")` digitado errado, que
 * silenciosamente esconderia a tela em vez de falhar.
 */
export const CAPABILITIES = [
  "sessao.checkin",
  "sessao.checkout",
  "sessao.cancel",
  "sessao.change_plan",
  "pdv.sell",
  "venda.estorno",
  "caixa.open_close",
  "caixa.sangria",
  "desconto.manual",
  "ponto.self",
  "relatorio.read",
  "config.read",
  "config.write",
  "config.employees.write",
  "config.unit.write",
  "config.fiscal.write",
  "config.terms.write",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/** Papéis como estão no banco. Ver ROLE_LABEL para o que o usuário lê. */
export type Role = "OPERADOR" | "GERENTE" | "ADMIN";

/**
 * Os valores no banco continuam OPERADOR/GERENTE/ADMIN — renomeá-los
 * exigiria migrar check constraint, linhas, funções e policies de uma vez,
 * com risco de deixar um 'ADMIN' hardcoded para trás. O rótulo resolve o
 * mesmo problema visível com risco zero.
 */
export const ROLE_LABEL: Record<Role, string> = {
  OPERADOR: "Operador",
  GERENTE: "Líder",
  ADMIN: "Owner",
};

export const ROLE_DESCRIPTION: Record<Role, string> = {
  OPERADOR: "Caixa e vendas. Não acessa Configurações.",
  GERENTE: "Tudo do Operador, mais cancelamentos, sangrias, estornos e relatórios.",
  ADMIN: "Acesso total, incluindo o menu Configurações.",
};
