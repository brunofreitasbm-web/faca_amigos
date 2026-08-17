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
  "config.rbac.write",
  "talentos.read",
  "talentos.write",
  "ocorrencias.read",
  "ocorrencias.write",
  "notificacoes.owner_push",
  "metas.ticket.write",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/** Rótulo em PT-BR de cada capacidade, para a tela Gerencial > Permissões. */
export const CAPABILITY_LABEL: Record<Capability, string> = {
  "sessao.checkin": "Fazer check-in de sessão",
  "sessao.checkout": "Fazer saída/check-out de sessão",
  "sessao.cancel": "Cancelar sessão",
  "sessao.change_plan": "Trocar o plano de uma sessão em andamento",
  "pdv.sell": "Vender no PDV",
  "venda.upsell": "Fazer upsell de venda",
  "venda.estorno": "Estornar venda",
  "caixa.open_close": "Abrir e fechar caixa",
  "caixa.sangria": "Registrar sangria de caixa",
  "desconto.manual": "Aplicar desconto manual",
  "ponto.self": "Bater o próprio ponto",
  "relatorio.read": "Ver relatórios",
  "relatorio.ponto": "Ver espelho de ponto de colaboradores",
  "config.read": "Ver Configurações",
  "config.write": "Editar Configurações (planos, produtos, cupons etc.)",
  "config.employees.write": "Editar cadastro de colaboradores",
  "config.unit.write": "Editar dados da unidade",
  "config.fiscal.write": "Editar dados fiscais",
  "config.terms.write": "Editar Termos de Uso",
  "config.rbac.write": "Editar permissões de cada papel (esta tela)",
  "talentos.read": "Ver Banco de Talentos",
  "talentos.write": "Editar Banco de Talentos",
  "ocorrencias.read": "Ver ocorrências (atestado/falta) de colaboradores",
  "ocorrencias.write": "Lançar ocorrências (atestado/falta) de colaboradores",
  "notificacoes.owner_push": "Ativar notificações de relatório do Owner neste dispositivo",
  "metas.ticket.write": "Configurar meta de Ticket Médio (mínimo e alvo) de cada unidade",
};

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
  GERENTE: "Tudo do Operador, mais troca de planos, sangrias, estornos e relatórios.",
  ADMIN: "Acesso total, incluindo cancelamento de sessões e o menu Configurações.",
};

/**
 * Ordem de exibição dos níveis de acesso nos seletores de cadastro/edição
 * de colaborador. Não existe mais um cargo/função com nome próprio
 * (Recepção, Vendedor, Líder de Turno...) desacoplado do RBAC — o único
 * nível concedido é a própria permissão.
 */
export const ROLE_OPTIONS: ReadonlyArray<Role> = ["OPERADOR", "GERENTE", "ADMIN", "ESTAGIARIO"];
