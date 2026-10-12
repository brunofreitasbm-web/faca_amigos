/**
 * Ordenação e filtro de tabelas de relatório — lógica pura, sem React, para
 * ser testável. O hook/componente em `components/ReportTable.tsx` só liga
 * isso à tela.
 */

export type SortDir = "asc" | "desc";
export type SortValue = string | number | null | undefined;

export interface TableColumn<T> {
  key: string;
  label: string;
  /** Valor usado na ordenação. Sem isso a coluna não é ordenável. */
  sortValue?: (row: T) => SortValue;
  /** Texto pesquisável da coluna. Sem isso a coluna fica fora do filtro. */
  searchText?: (row: T) => string | null | undefined;
}

export interface SortState {
  key: string;
  dir: SortDir;
}

const collator = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });

/** Minúsculas e sem acento: "Criança" casa com "crianca". */
export function normalizeText(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function isBlank(v: SortValue): v is null | undefined {
  return v === null || v === undefined || v === "";
}

/**
 * Ordena sem mutar a lista. Vazios (null/undefined/"") ficam sempre no fim,
 * em qualquer direção — "—" no topo de uma ordenação decrescente esconde os
 * dados reais. Estável: empates mantêm a ordem original.
 */
export function sortRows<T>(
  rows: readonly T[],
  column: TableColumn<T> | undefined,
  dir: SortDir,
): T[] {
  const get = column?.sortValue;
  if (!get) return [...rows];
  const sign = dir === "asc" ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, value: get(row) }))
    .sort((a, b) => {
      const aBlank = isBlank(a.value);
      const bBlank = isBlank(b.value);
      if (aBlank || bBlank) return aBlank === bBlank ? a.index - b.index : aBlank ? 1 : -1;
      let cmp: number;
      if (typeof a.value === "number" && typeof b.value === "number") cmp = a.value - b.value;
      else cmp = collator.compare(String(a.value), String(b.value));
      return cmp !== 0 ? cmp * sign : a.index - b.index;
    })
    .map((x) => x.row);
}

/**
 * Cada palavra da busca precisa aparecer em alguma coluna da linha (E entre
 * palavras): "helena 2026" restringe, em vez de ampliar.
 */
export function filterRows<T>(
  rows: readonly T[],
  columns: readonly TableColumn<T>[],
  query: string,
): T[] {
  const tokens = normalizeText(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [...rows];
  const searchable = columns.filter((c) => c.searchText);
  return rows.filter((row) => {
    const haystack = normalizeText(searchable.map((c) => c.searchText!(row) ?? "").join(" \n "));
    return tokens.every((t) => haystack.includes(t));
  });
}

/** asc → desc → sem ordenação (volta à ordem original da API). */
export function nextSort(current: SortState | null, key: string): SortState | null {
  if (!current || current.key !== key) return { key, dir: "asc" };
  if (current.dir === "asc") return { key, dir: "desc" };
  return null;
}

export function applyTableView<T>(
  rows: readonly T[],
  columns: readonly TableColumn<T>[],
  query: string,
  sort: SortState | null,
): T[] {
  const filtered = filterRows(rows, columns, query);
  if (!sort) return filtered;
  return sortRows(
    filtered,
    columns.find((c) => c.key === sort.key),
    sort.dir,
  );
}
