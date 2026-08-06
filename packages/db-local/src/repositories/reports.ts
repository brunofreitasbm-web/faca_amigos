import type { Db } from "../connection.js";

/**
 * Consultas de relatório (seção "Relatório" do protótipo: Vendas,
 * Crianças por aniversário, Faturamento, Visitas). Leitura pura sobre
 * as mesmas tabelas operacionais — nenhuma tabela nova, nenhum
 * recálculo divergente do que o caixa já fechou.
 */

export interface DailySales {
  business_date: string;
  orders_count: number;
  total_cents: number;
}

export function salesByDay(db: Db, unitId: string, fromDate: string, toDate: string): DailySales[] {
  return db
    .prepare(
      `SELECT business_date, COUNT(*) AS orders_count, SUM(total_cents) AS total_cents
       FROM orders
       WHERE unit_id = ? AND status = 'PAGA' AND business_date BETWEEN ? AND ?
       GROUP BY business_date
       ORDER BY business_date`,
    )
    .all(unitId, fromDate, toDate) as unknown as DailySales[];
}

export interface RevenueByMethod {
  method: string;
  total_cents: number;
}

export function revenueByMethod(db: Db, unitId: string, fromDate: string, toDate: string): RevenueByMethod[] {
  return db
    .prepare(
      `SELECT p.method AS method, SUM(p.amount_cents) AS total_cents
       FROM payments p
       JOIN orders o ON o.id = p.order_id
       WHERE o.unit_id = ? AND o.status = 'PAGA' AND o.business_date BETWEEN ? AND ?
       GROUP BY p.method`,
    )
    .all(unitId, fromDate, toDate) as unknown as RevenueByMethod[];
}

export interface DailyVisits {
  business_date: string;
  sessions_count: number;
}

export function visitsByDay(db: Db, unitId: string, fromDate: string, toDate: string): DailyVisits[] {
  return db
    .prepare(
      `SELECT business_date, COUNT(*) AS sessions_count
       FROM sessions
       WHERE unit_id = ? AND business_date BETWEEN ? AND ?
       GROUP BY business_date
       ORDER BY business_date`,
    )
    .all(unitId, fromDate, toDate) as unknown as DailyVisits[];
}

export interface AssetUsage {
  id: string;
  name: string;
  emoji: string;
  color: string;
  sessions_count: number;
  total_minutes: number;
}

/** Mapa de calor de uso: frequência e tempo de alocação por carrinho, para identificar quais se pagam mais rápido. */
export function assetUsage(db: Db, unitId: string, fromDate: string, toDate: string): AssetUsage[] {
  return db
    .prepare(
      `SELECT a.id AS id, a.name AS name, a.emoji AS emoji, a.color AS color,
              COUNT(s.id) AS sessions_count,
              COALESCE(SUM((COALESCE(s.checkout_at_ms, s.checkin_at_ms) - s.checkin_at_ms) / 60000), 0) AS total_minutes
       FROM assets a
       LEFT JOIN sessions s ON s.asset_id = a.id AND s.checkout_at_ms IS NOT NULL AND s.business_date BETWEEN ? AND ?
       WHERE a.unit_id = ?
       GROUP BY a.id
       ORDER BY sessions_count DESC`,
    )
    .all(fromDate, toDate, unitId) as unknown as AssetUsage[];
}

export interface BirthdayChild {
  id: string;
  full_name: string;
  birth_date: string;
}

/** Aniversariantes do mês (1-12) — base da campanha de aniversário (Fase 5, ainda não implementada). */
export function childrenBirthdaysInMonth(db: Db, month: number): BirthdayChild[] {
  const mm = String(month).padStart(2, "0");
  return db
    .prepare(`SELECT id, full_name, birth_date FROM children WHERE substr(birth_date, 6, 2) = ? ORDER BY substr(birth_date, 9, 2)`)
    .all(mm) as unknown as BirthdayChild[];
}

export interface ShiftSummary {
  id: string;
  opened_at_ms: number;
  closed_at_ms: number | null;
  status: "ABERTO" | "FECHADO";
  declared_json: string | null;
  expected_json: string | null;
}

export function shiftHistory(db: Db, unitId: string, limit = 30): ShiftSummary[] {
  return db
    .prepare(
      `SELECT id, opened_at_ms, closed_at_ms, status, declared_json, expected_json
       FROM shifts WHERE unit_id = ? ORDER BY opened_at_ms DESC LIMIT ?`,
    )
    .all(unitId, limit) as unknown as ShiftSummary[];
}

export interface FolhaPontoRow {
  employee_id: string;
  full_name: string;
  kind: string;
  at_ms: number;
  nsr: number;
}

/** Folha de ponto gerencial: todos os colaboradores, filtro por período (seção "Relatório" do protótipo). */
export function folhaPonto(db: Db, fromMs: number, toMs: number): FolhaPontoRow[] {
  return db
    .prepare(
      `SELECT pr.employee_id AS employee_id, e.full_name AS full_name, pr.kind AS kind, pr.at_ms AS at_ms, pr.nsr AS nsr
       FROM ponto_records pr
       JOIN employees e ON e.id = pr.employee_id
       WHERE pr.at_ms BETWEEN ? AND ?
       ORDER BY e.full_name, pr.at_ms`,
    )
    .all(fromMs, toMs) as unknown as FolhaPontoRow[];
}
