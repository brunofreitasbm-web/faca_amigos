import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SideTabs } from "../src/components/SideTabs.js";

const groups = [
  {
    label: "Catálogo",
    tabs: [
      { value: "A", label: "Planos" },
      { value: "B", label: "Produtos" },
    ],
  },
  { label: "Fiscal", tabs: [{ value: "C", label: "Termos" }] },
];

describe("SideTabs", () => {
  it("marca só a aba ativa como selecionada e deixa as outras fora do tab order", () => {
    const html = renderToStaticMarkup(
      <SideTabs value="B" onChange={() => {}} groups={groups} label="Seções" />,
    );
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(html.match(/tabindex="-1"/g)).toHaveLength(2);
    expect(html).toContain('aria-orientation="vertical"');
    expect(html).toContain("Catálogo");
    expect(html).toContain("Fiscal");
  });
});
