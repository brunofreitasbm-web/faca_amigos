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
  "venda.upsell",
  "venda.estorno",
  "caixa.open_close",
  "caixa.sangria",
  "desconto.manual",
  "ponto.self",
  "relatorio.read",
  "relatorio.ponto",
  "config.read",
  "config.write",
  "config.employees.write",
  "config.unit.write",
  "config.fiscal.write",
  "config.terms.write",
  "talentos.read",
  "talentos.write",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/** Papéis como estão no banco. Ver ROLE_LABEL para o que o usuário lê. */
export type Role = "ESTAGIARIO" | "OPERADOR" | "GERENTE" | "ADMIN";

/**
 * Os valores no banco continuam OPERADOR/GERENTE/ADMIN — renomeá-los
 * exigiria migrar check constraint, linhas, funções e policies de uma vez,
 * com risco de deixar um 'ADMIN' hardcoded para trás. O rótulo resolve o
 * mesmo problema visível com risco zero.
 *
 * ESTAGIARIO não é hierárquico como os outros três (não herda nem é
 * herdado) — só bate ponto, sem nenhum outro acesso ao sistema.
 */
export const ROLE_LABEL: Record<Role, string> = {
  ESTAGIARIO: "Estagiário",
  OPERADOR: "Operador",
  GERENTE: "Líder",
  ADMIN: "Owner",
};

export const ROLE_DESCRIPTION: Record<Role, string> = {
  ESTAGIARIO: "Só acessa o Controle de Frequência. Não opera caixa, vendas nem check-in/saída.",
  OPERADOR: "Caixa e vendas. Não acessa Configurações.",
  GERENTE: "Tudo do Operador, mais cancelamentos, sangrias, estornos e relatórios.",
  ADMIN: "Acesso total, incluindo o menu Configurações.",
};

/**
 * Função do colaborador, como aparece no formulário de cadastro. Cada opção
 * já carrega o nível de acesso (`role`) correspondente — o campo não é mais
 * um texto livre desacoplado do RBAC, é a própria porta de entrada dele: ao
 * escolher "Líder de Turno", o colaborador já nasce GERENTE, sem um segundo
 * select para o Owner esquecer de ajustar.
 *
 * O rótulo (`position`) continua livre no banco para o cargo real do
 * colaborador aparecer no espelho de ponto e em relatórios — só a lista de
 * opções aqui é fechada, para toda função nova exigir uma decisão explícita
 * de nível de acesso.
 */
export const FUNCTION_OPTIONS: ReadonlyArray<{ value: string; label: string; role: Role }> = [
  { value: "RECEPCAO", label: "Recepção", role: "OPERADOR" },
  { value: "VENDEDOR", label: "Vendedor", role: "OPERADOR" },
  { value: "CAIXA", label: "Caixa", role: "OPERADOR" },
  { value: "MONITOR", label: "Monitor de Brincadeira", role: "OPERADOR" },
  { value: "LIDER_TURNO", label: "Líder de Turno", role: "GERENTE" },
  { value: "SUPERVISOR", label: "Supervisor", role: "GERENTE" },
  { value: "GERENTE", label: "Gerente", role: "GERENTE" },
  { value: "OWNER", label: "Owner / Administrador", role: "ADMIN" },
  { value: "ESTAGIARIO", label: "Estagiário", role: "ESTAGIARIO" },
];
