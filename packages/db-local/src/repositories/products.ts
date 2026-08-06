import type { Db } from "../connection.js";
import { uuidv7 } from "../id.js";

export interface ProductRow {
  id: string;
  unit_id: string;
  name: string;
  description: string | null;
  emoji: string | null;
  price_cents: number;
  stock: number;
  active: 0 | 1;
  created_at_ms: number;
}

export function insertProduct(db: Db, p: Omit<ProductRow, "created_at_ms" | "active">, nowMs: number): void {
  db.prepare(
    `INSERT INTO products (id, unit_id, name, description, emoji, price_cents, stock, active, created_at_ms)
     VALUES (@id, @unit_id, @name, @description, @emoji, @price_cents, @stock, 1, @created_at_ms)`,
  ).run({ ...p, created_at_ms: nowMs });
}

export function listProducts(db: Db, unitId: string, opts: { activeOnly?: boolean } = {}): ProductRow[] {
  const sql = opts.activeOnly
    ? "SELECT * FROM products WHERE unit_id = ? AND active = 1 ORDER BY name"
    : "SELECT * FROM products WHERE unit_id = ? ORDER BY name";
  return db.prepare(sql).all(unitId) as unknown as ProductRow[];
}

export function getProduct(db: Db, id: string): ProductRow | undefined {
  return db.prepare("SELECT * FROM products WHERE id = ?").get(id) as unknown as ProductRow | undefined;
}

/**
 * Debita estoque só se houver saldo suficiente no momento exato do
 * UPDATE — mesma técnica de transição condicional da seção 5.2, para
 * dois PDVs não venderem a mesma última unidade.
 */
export function tryDecrementStock(db: Db, productId: string, quantity: number, orderId: string, nowMs: number): boolean {
  const result = db
    .prepare("UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?")
    .run(quantity, productId, quantity);
  if (result.changes === 0) return false;
  db.prepare(`INSERT INTO stock_movements (id, product_id, delta, reason, order_id, at_ms) VALUES (?, ?, ?, 'VENDA', ?, ?)`).run(
    uuidv7(nowMs),
    productId,
    -quantity,
    orderId,
    nowMs,
  );
  return true;
}

export function adjustStock(db: Db, productId: string, delta: number, reason: string, nowMs: number): void {
  db.prepare("UPDATE products SET stock = stock + ? WHERE id = ?").run(delta, productId);
  db.prepare(`INSERT INTO stock_movements (id, product_id, delta, reason, order_id, at_ms) VALUES (?, ?, ?, ?, NULL, ?)`).run(
    uuidv7(nowMs),
    productId,
    delta,
    reason,
    nowMs,
  );
}
