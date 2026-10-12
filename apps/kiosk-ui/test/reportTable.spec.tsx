import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SortTh, TableFilter, type TableView } from "../src/components/ReportTable.js";
import type { TableColumn } from "../src/lib/tableView.js";

interface Row {
  n: number;
}

const columns: TableColumn<Row>[] = [
  { key: "n", label: "Número", sortValue: (r) => r.n, searchText: (r) => String(r.n) },
  { key: "plain", label: "Sem ordenação" },
];

function makeView(over: Partial<TableView<Row>> = {}): TableView<Row> {
  return {
    rows: [],
    total: 0,
    query: "",
    setQuery: () => {},
    sort: null,
    toggleSort: () => {},
    columns,
    ...over,
  };
}

describe("SortTh", () => {
  it("expõe aria-sort conforme o estado", () => {
    const none = renderToStaticMarkup(<SortTh view={makeView()} column="n" />);
    expect(none).toContain('aria-sort="none"');
    const asc = renderToStaticMarkup(
      <SortTh view={makeView({ sort: { key: "n", dir: "asc" } })} column="n" />,
    );
    expect(asc).toContain('aria-sort="ascending"');
    const desc = renderToStaticMarkup(
      <SortTh view={makeView({ sort: { key: "n", dir: "desc" } })} column="n" />,
    );
    expect(desc).toContain('aria-sort="descending"');
  });

  it("coluna sem sortValue vira <th> simples, sem botão", () => {
    const html = renderToStaticMarkup(<SortTh view={makeView()} column="plain" />);
    expect(html).not.toContain("<button");
    expect(html).toContain("Sem ordenação");
  });
});

describe("TableFilter", () => {
  it("some em tabela curta e aparece em tabela longa", () => {
    expect(
      renderToStaticMarkup(<TableFilter view={makeView({ total: 3 })} label="Filtrar" />),
    ).toBe("");
    expect(
      renderToStaticMarkup(<TableFilter view={makeView({ total: 30 })} label="Filtrar" />),
    ).toContain("data-search-input");
  });

  it("mostra 'X de Y' quando há filtro ativo e continua visível com busca sem resultado", () => {
    const html = renderToStaticMarkup(
      <TableFilter view={makeView({ total: 3, query: "zzz" })} label="Filtrar" />,
    );
    expect(html).toContain("0 de 3");
  });
});
