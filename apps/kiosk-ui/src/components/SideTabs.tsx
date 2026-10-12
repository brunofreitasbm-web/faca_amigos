import { useRef } from "react";
import type { KeyboardEvent } from "react";

export interface SideTabGroup<T extends string> {
  label: string;
  tabs: Array<{ value: T; label: string }>;
}

/**
 * Menu lateral vertical com abas agrupadas, para telas largas com mouse. Com
 * 12 abas, a barra horizontal de `Tabs` quebra em várias linhas e empurra o
 * conteúdo para baixo; aqui o menu fica fixo ao lado e o grupo dá contexto
 * ("Catálogo", "Operação"...) sem o operador ter que decorar a ordem.
 * Mantém a semântica de abas (`tablist`/`tab`/`aria-selected`) e navega por
 * ↑/↓ e Home/End, como `Tabs` faz com ←/→.
 */
export function SideTabs<T extends string>({
  value,
  onChange,
  groups,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  groups: SideTabGroup<T>[];
  label: string;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const flat = groups.flatMap((g) => g.tabs);
  // Aba ativa fora do menu (ex.: perfil sem permissão para a aba padrão): a
  // primeira ainda precisa ser alcançável por Tab, senão o menu fica inacessível.
  const tabStop = flat.some((t) => t.value === value) ? value : flat[0]?.value;

  function onKeyDown(e: KeyboardEvent, index: number) {
    let next: number;
    if (e.key === "ArrowDown") next = (index + 1) % flat.length;
    else if (e.key === "ArrowUp") next = (index - 1 + flat.length) % flat.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = flat.length - 1;
    else return;
    e.preventDefault();
    const target = flat[next]!;
    onChange(target.value);
    refs.current[target.value]?.focus();
  }

  let index = -1;
  return (
    <nav className="side-tabs" aria-label={label}>
      <div role="tablist" aria-orientation="vertical">
        {groups.map((g) => (
          <div key={g.label} role="presentation" className="side-tabs-group">
            <div className="side-tabs-heading" aria-hidden="true">
              {g.label}
            </div>
            {g.tabs.map((t) => {
              index += 1;
              const i = index;
              const active = value === t.value;
              return (
                <button
                  key={t.value}
                  ref={(el) => {
                    refs.current[t.value] = el;
                  }}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  tabIndex={t.value === tabStop ? 0 : -1}
                  className={`side-tab${active ? " is-active" : ""}`}
                  onClick={() => onChange(t.value)}
                  onKeyDown={(e) => onKeyDown(e, i)}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </nav>
  );
}
