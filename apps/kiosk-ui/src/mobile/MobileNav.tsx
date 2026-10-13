import type { ReactNode } from "react";

/**
 * Peças de navegação compartilhadas pela casca do operador e pela do Owner.
 *
 * Duas regras de produto moram aqui, para não divergirem entre telas:
 *  1. Voltar é sempre um botão COM TEXTO ("Voltar"/nome do destino) no canto
 *     superior esquerdo — um "‹" solto de 40px não diz para onde vai, e o
 *     operador de pé, com a criança puxando a outra mão, não adivinha.
 *  2. As seções principais ficam numa barra inferior com ícone + rótulo, ao
 *     alcance do polegar, e continuam visíveis em tudo que não seja um
 *     fluxo que precisa de foco total (ex.: preencher a entrada).
 */

function Chevron() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

export function MobileNavBar({
  title,
  onBack,
  backLabel = "Voltar",
  right,
}: {
  title: string;
  onBack: () => void;
  /** Para onde o botão leva ("Turno", "Resumo"…) — mais claro que só "Voltar". */
  backLabel?: string;
  right?: ReactNode;
}) {
  return (
    <div className="m-navbar">
      <button type="button" className="m-back" aria-label={`Voltar para ${backLabel}`} onClick={onBack}>
        <Chevron />
        <span>{backLabel}</span>
      </button>
      <span className="m-title-sm m-grow m-trunc m-navbar-title">{title}</span>
      {right}
    </div>
  );
}

export interface MobileTabItem<Id extends string> {
  id: Id;
  label: string;
  icon: ReactNode;
  /** Contador de pendências (ex.: pedidos de tempo). 0/undefined some. */
  badge?: number;
  show?: boolean;
}

export function MobileTabBar<Id extends string>({
  tabs,
  active,
  onSelect,
  label = "Seções",
}: {
  tabs: Array<MobileTabItem<Id>>;
  active: Id | null;
  onSelect: (id: Id) => void;
  label?: string;
}) {
  return (
    <nav className="m-tabbar" aria-label={label}>
      {tabs
        .filter((t) => t.show !== false)
        .map((t) => (
          <button key={t.id} type="button" aria-current={active === t.id ? "page" : undefined} onClick={() => onSelect(t.id)}>
            <span className="m-tab-icon" aria-hidden="true">
              {t.icon}
              {t.badge != null && t.badge > 0 && <span className="m-tab-badge">{t.badge > 9 ? "9+" : t.badge}</span>}
            </span>
            <span>{t.label}</span>
          </button>
        ))}
    </nav>
  );
}

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

export const TabIcons = {
  turno: (
    <Svg>
      <path d="M3 11l9-8 9 8" />
      <path d="M5 10v10h14V10" />
    </Svg>
  ),
  painel: (
    <Svg>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </Svg>
  ),
  mais: (
    <Svg>
      <circle cx="5" cy="12" r="1.2" />
      <circle cx="12" cy="12" r="1.2" />
      <circle cx="19" cy="12" r="1.2" />
    </Svg>
  ),
  resumo: (
    <Svg>
      <path d="M4 20V10" />
      <path d="M10 20V4" />
      <path d="M16 20v-7" />
      <path d="M22 20H2" />
    </Svg>
  ),
  relatorios: (
    <Svg>
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h7M9 17h5" />
    </Svg>
  ),
  console: (
    <Svg>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" />
    </Svg>
  ),
  operar: (
    <Svg>
      <path d="M12 21s7-6.2 7-11.5A7 7 0 005 9.5C5 14.8 12 21 12 21z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </Svg>
  ),
};
