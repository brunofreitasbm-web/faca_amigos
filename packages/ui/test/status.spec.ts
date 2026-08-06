import { describe, expect, it } from "vitest";
import { contrastRatio, WCAG_AA_NORMAL_TEXT } from "../src/tokens/contrast.js";

/**
 * MANTER EM SINCRONIA COM src/tokens/status.css.
 *
 * Este teste existe para que trocar um hex do semáforo operacional
 * sem medir o contraste quebre a build, em vez de virar um card
 * ilegível descoberto só no balcão. Se você mudar um valor aqui,
 * mude também no CSS — e vice-versa.
 */
const STATUS_PAIRS: Array<[label: string, fg: string, bg: string]> = [
  ["verde preenchido", "#FFFFFF", "#17803F"],
  ["amarelo preenchido", "#FFFFFF", "#A85D00"],
  ["vermelho preenchido", "#FFFFFF", "#C21F3A"],
  ["excedente preenchido", "#FFFFFF", "#7A0E24"],
  ["verde texto sobre soft", "#136836", "#E4F5EA"],
  ["amarelo texto sobre soft", "#8A4B00", "#FBEADB"],
  ["vermelho texto sobre soft", "#B0142F", "#FBE3E7"],
  ["excedente texto sobre soft", "#7A0E24", "#F3DDE1"],
];

describe("semáforo operacional — contraste WCAG AA", () => {
  it.each(STATUS_PAIRS)("%s atinge ao menos 4.5:1", (_label, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
  });

  // Nota: não há um teste de "verde e vermelho são distinguíveis entre si"
  // aqui. Razão de biológica de contraste (WCAG) é luminância relativa —
  // dois tons de matiz bem diferente podem ter luminância parecida e
  // ainda assim serem obviamente distintos a olho nu (é exatamente o
  // caso de #17803F e #C21F3A). Contraste é a ferramenta errada para
  // medir "essas duas cores parecem diferentes"; a garantia real contra
  // confusão de estado é estrutural — StatusBadge sempre emparelha
  // ícone + rótulo textual, nunca expõe cor sozinha (ver StatusBadge.tsx).

  it("excedente é visivelmente mais escuro que vermelho (evita confundir os dois estados)", () => {
    expect(contrastRatio("#7A0E24", "#FFFFFF")).toBeGreaterThan(contrastRatio("#C21F3A", "#FFFFFF"));
  });
});

/**
 * MANTER EM SINCRONIA COM src/tokens/colors.css.
 *
 * Nasceu de uma auditoria de design que mediu a paleta de marca (não só
 * o semáforo acima) e achou --color-teal (1.96:1), --color-success
 * (2.17:1), --color-amber (2.80:1) e --color-error (4.29:1) todas
 * falhando AA quando usadas como TEXTO — --text-muted (3.80:1) era o
 * pior: a cor de texto mais repetida do produto. As cores de marca em
 * si continuam iguais (preenchimento/borda/gráfico usam a mesma
 * fórmula do WCAG 1.4.11, que só exige 3:1); é só a variante -text —
 * pensada para texto — que precisa do teto de 4.5:1 daqui pra frente.
 */
const TEXT_SAFE_PAIRS: Array<[label: string, fg: string, bg: string]> = [
  ["--text-muted sobre --surface-card", "#6C7682", "#FFFFFF"],
  ["--color-teal-text sobre --surface-card", "#1D8273", "#FFFFFF"],
  ["--color-amber-text sobre --surface-card", "#996D18", "#FFFFFF"],
  ["--color-success-text sobre --surface-card", "#1A8454", "#FFFFFF"],
  ["--color-error-text sobre --surface-card", "#E61E1E", "#FFFFFF"],
  ["--color-primary-hover sobre --surface-card", "#C8155A", "#FFFFFF"],
  // Badge solid_*: texto branco sobre a variante -text usada como fundo
  // cheio (packages/ui/src/components/Badge.tsx).
  ["branco sobre solid_pink (--color-primary-hover)", "#FFFFFF", "#C8155A"],
  ["branco sobre solid_teal (--color-teal-text)", "#FFFFFF", "#1D8273"],
  ["branco sobre solid_amber (--color-amber-text)", "#FFFFFF", "#996D18"],
];

describe("paleta de texto da interface — contraste WCAG AA", () => {
  it.each(TEXT_SAFE_PAIRS)("%s atinge ao menos 4.5:1", (_label, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
  });
});
