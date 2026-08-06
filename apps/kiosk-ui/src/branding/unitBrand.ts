/**
 * Identidade visual de cada operação — fonte única de verdade.
 *
 * Antes o ícone e a cor viviam em dois lugares (o cabeçalho do App.tsx e o
 * SelectModuleScreen), com regras de correspondência copiadas e resultados
 * divergentes: o cabeçalho pintava o badge de teal para as três unidades,
 * contradizendo o rosa/teal/âmbar da tela de seleção.
 *
 * A correspondência é por nome porque `fa_kiosk_units` não tem coluna de
 * cor nem slug — só `id` (UUID gerado) e `kind`, e `kind` não serve:
 * duas das três operações são 'LOJA'.
 */
export interface UnitBrand {
  key: string;
  icon: string;
  /** Texto da faixa do timbre, sob o wordmark. */
  operation: string;
  title: string;
  subtitle: string;
  location: string;
  details: string;
  /** Cor da operação: tinge a faixa do timbre, o ponto da marca e a régua do cabeçalho. */
  accent: string;
  badge: "pink" | "teal" | "amber";
}

export const UNIT_BRANDS: UnitBrand[] = [
  {
    key: "playground",
    icon: "🏰",
    operation: "Playground · Parque Shopping",
    title: "Playground (Parque Shopping)",
    subtitle: "Operação Loja — Brinquedoteca Física & Regulação Sensorial",
    location: "Parque Shopping Belém",
    details: "Ambiente regulado com neuroarquitetura, mediação ABA, Cantinho da Calma e brinquedos adaptados.",
    accent: "var(--color-primary)",
    badge: "pink",
  },
  {
    key: "circuito",
    icon: "🏎️",
    operation: "Circuito · Parque Shopping",
    title: "Circuito (Parque Shopping)",
    subtitle: "Operação Quiosque — Pista & Carrinhos Elétricos",
    location: "Parque Shopping Belém",
    details: "Pista de carrinhos elétricos no corredor principal, controle de frota e cotação por minutos.",
    accent: "var(--color-secondary)",
    badge: "teal",
  },
  {
    key: "grao-para",
    icon: "🌳",
    operation: "Playground · Bosque Grão-Pará",
    title: "Playground (Bosque Grão-Pará)",
    subtitle: "Operação Loja — Brinquedoteca Física & Regulação Sensorial",
    location: "Shopping Bosque Grão-Pará",
    details: "Unidade ampliada com espaço de socialização inclusiva para o público da região metropolitana.",
    accent: "var(--color-amber)",
    badge: "amber",
  },
];

const FALLBACK: Omit<UnitBrand, "operation" | "title"> = {
  key: "outra",
  icon: "📍",
  subtitle: "Operação",
  location: "",
  details: "",
  accent: "var(--color-primary)",
  badge: "pink",
};

/**
 * Testa se um nome de unidade pertence a uma operação conhecida.
 *
 * A ordem importa e por isso Grão-Pará é testado antes de Playground:
 * "Playground (Bosque Grão-Pará)" contém as duas palavras, e checar
 * "playground" primeiro faria as duas lojas caírem na mesma identidade.
 */
export function unitMatchesBrand(brandKey: string, unitName: string): boolean {
  const lower = unitName.toLowerCase();
  if (brandKey === "circuito") return lower.includes("circuito");
  if (brandKey === "grao-para") return lower.includes("grão") || lower.includes("grao");
  if (brandKey === "playground") {
    return lower.includes("playground") && !lower.includes("grão") && !lower.includes("grao");
  }
  return false;
}

/** Identidade da operação a partir do nome da unidade. Nunca falha. */
export function unitBrandFor(unitName: string): UnitBrand {
  const found = UNIT_BRANDS.find((b) => unitMatchesBrand(b.key, unitName));
  if (found) return found;
  return { ...FALLBACK, operation: unitName, title: unitName };
}
