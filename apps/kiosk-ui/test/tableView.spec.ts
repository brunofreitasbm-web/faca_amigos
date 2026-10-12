import { describe, expect, it } from "vitest";
import {
  applyTableView,
  filterRows,
  nextSort,
  normalizeText,
  sortRows,
  type TableColumn,
} from "../src/lib/tableView.js";

interface Row {
  name: string;
  qty: number | null;
  day: string;
}

const columns: TableColumn<Row>[] = [
  { key: "name", label: "Nome", sortValue: (r) => r.name, searchText: (r) => r.name },
  {
    key: "qty",
    label: "Qtd",
    sortValue: (r) => r.qty,
    searchText: (r) => (r.qty === null ? "" : String(r.qty)),
  },
  { key: "day", label: "Dia", sortValue: (r) => r.day, searchText: (r) => r.day },
  { key: "none", label: "Sem sort" },
];

const rows: Row[] = [
  { name: "Helena", qty: 10, day: "2026-10-02" },
  { name: "Ágata", qty: 2, day: "2026-10-01" },
  { name: "Bruno", qty: null, day: "2026-10-03" },
  { name: "Caio", qty: 2, day: "2026-10-04" },
];

describe("normalizeText", () => {
  it("ignora acento e caixa", () => {
    expect(normalizeText("Criança ÁGATA")).toBe("crianca agata");
  });
});

describe("sortRows", () => {
  it("ordena números como números (10 depois de 2)", () => {
    expect(sortRows(rows, columns[1], "asc").map((r) => r.qty)).toEqual([2, 2, 10, null]);
  });

  it("vazios ficam no fim nas duas direções", () => {
    expect(sortRows(rows, columns[1], "desc").map((r) => r.qty)).toEqual([10, 2, 2, null]);
  });

  it("ordena texto em pt-BR sem acento atrapalhar (Ágata antes de Bruno)", () => {
    expect(sortRows(rows, columns[0], "asc").map((r) => r.name)).toEqual([
      "Ágata",
      "Bruno",
      "Caio",
      "Helena",
    ]);
  });

  it("é estável nos empates e não muta a entrada", () => {
    const copy = [...rows];
    expect(
      sortRows(rows, columns[1], "asc")
        .filter((r) => r.qty === 2)
        .map((r) => r.name),
    ).toEqual(["Ágata", "Caio"]);
    expect(rows).toEqual(copy);
  });

  it("coluna sem sortValue mantém a ordem", () => {
    expect(sortRows(rows, columns[3], "asc")).toEqual(rows);
  });
});

describe("filterRows", () => {
  it("busca sem acento nem caixa", () => {
    expect(filterRows(rows, columns, "AGATA").map((r) => r.name)).toEqual(["Ágata"]);
  });

  it("exige todas as palavras (E)", () => {
    expect(filterRows(rows, columns, "caio 2026-10-04")).toHaveLength(1);
    expect(filterRows(rows, columns, "caio 2026-10-01")).toHaveLength(0);
  });

  it("busca vazia devolve tudo", () => {
    expect(filterRows(rows, columns, "   ")).toHaveLength(4);
  });

  it("ignora colunas sem searchText", () => {
    expect(filterRows(rows, columns, "Sem sort")).toHaveLength(0);
  });
});

describe("nextSort", () => {
  it("cicla asc → desc → nenhum, e reinicia ao trocar de coluna", () => {
    const a = nextSort(null, "name");
    expect(a).toEqual({ key: "name", dir: "asc" });
    const b = nextSort(a, "name");
    expect(b).toEqual({ key: "name", dir: "desc" });
    expect(nextSort(b, "name")).toBeNull();
    expect(nextSort(b, "qty")).toEqual({ key: "qty", dir: "asc" });
  });
});

describe("applyTableView", () => {
  it("filtra e depois ordena", () => {
    const out = applyTableView(rows, columns, "2026-10", { key: "name", dir: "desc" });
    expect(out.map((r) => r.name)).toEqual(["Helena", "Caio", "Bruno", "Ágata"]);
  });
});
