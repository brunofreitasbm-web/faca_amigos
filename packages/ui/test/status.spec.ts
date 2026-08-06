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
