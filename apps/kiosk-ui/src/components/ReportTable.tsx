import { useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { applyTableView, nextSort, type SortState, type TableColumn } from "../lib/tableView.js";
import { renderEmoji } from "./Emoji3D.js";

export interface TableView<T> {
  /** Linhas já filtradas e ordenadas — é o que a tabela renderiza. */
  rows: T[];
  total: number;
  query: string;
  setQuery: (q: string) => void;
  sort: SortState | null;
  toggleSort: (key: string) => void;
  columns: readonly TableColumn<T>[];
}

/**
 * Estado de ordenação + filtro de uma tabela de relatório. `columns` pode
 * ser recriada a cada render (fecha sobre fuso, unidades etc.): a última
 * versão fica numa ref e só linhas/busca/ordenação invalidam o cálculo.
 */
export function useTableView<T>(
  rows: readonly T[],
  columns: readonly TableColumn<T>[],
): TableView<T> {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortState | null>(null);
  const columnsRef = useRef(columns);
  columnsRef.current = columns;
  const view = useMemo(
    () => applyTableView(rows, columnsRef.current, query, sort),
    [rows, query, sort],
  );
  return {
    rows: view,
    total: rows.length,
    query,
    setQuery,
    sort,
    toggleSort: (key) => setSort((s) => nextSort(s, key)),
    columns,
  };
}

/** Cabeçalho clicável: asc → desc → ordem original. `aria-sort` informa leitores de tela. */
export function SortTh<T>({
  view,
  column,
  style,
}: {
  view: TableView<T>;
  column: string;
  style?: CSSProperties;
}) {
  const col = view.columns.find((c) => c.key === column);
  const label = col?.label ?? column;
  if (!col?.sortValue) return <th style={style}>{label}</th>;
  const active = view.sort?.key === column ? view.sort.dir : null;
  const justify =
    style?.textAlign === "right"
      ? "flex-end"
      : style?.textAlign === "center"
        ? "center"
        : "flex-start";
  return (
    <th
      style={style}
      aria-sort={active === "asc" ? "ascending" : active === "desc" ? "descending" : "none"}
    >
      <button
        type="button"
        className="report-sort-btn"
        style={{ justifyContent: justify }}
        onClick={() => view.toggleSort(column)}
        title={`Ordenar por ${label.toLowerCase()}`}
      >
        {label}
        <span aria-hidden="true" className={`report-sort-icon${active ? " is-active" : ""}`}>
          {active === "asc" ? "▲" : active === "desc" ? "▼" : renderEmoji("↕")}
        </span>
      </button>
    </th>
  );
}

/**
 * Campo de filtro da tabela. Some em tabelas curtas (`minRows`): com meia
 * dúzia de linhas só ocupa espaço. `data-search-input` faz a tecla "/" focar
 * aqui (ver useKeyboardShortcuts).
 */
export function TableFilter<T>({
  view,
  label,
  minRows = 8,
}: {
  view: TableView<T>;
  label: string;
  minRows?: number;
}) {
  if (view.total < minRows && !view.query) return null;
  const filtered = view.rows.length !== view.total;
  return (
    <div className="report-filter">
      <input
        type="search"
        data-search-input
        aria-label={label}
        placeholder={label}
        value={view.query}
        autoComplete="off"
        onChange={(e) => view.setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && view.query) {
            e.stopPropagation();
            view.setQuery("");
          }
        }}
      />
      <span className="report-filter-count" aria-live="polite">
        {filtered
          ? `${view.rows.length} de ${view.total}`
          : `${view.total} linha${view.total === 1 ? "" : "s"}`}
      </span>
    </div>
  );
}
