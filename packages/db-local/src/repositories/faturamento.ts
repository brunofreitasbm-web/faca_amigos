import type { Db } from "../connection.js";

/**
 * Leituras cruas que alimentam a declaração de faturamento ao
 * shopping. Consultas puras sobre as mesmas tabelas que o caixa já
 * fechou — `reports.ts` responde "como foi o dia?" para o dono, este
 * arquivo responde "quanto entrou, por dia, decomposto do jeito que o
 * contrato de locação pede".
 *
 * A montagem do documento final (totais, ticket médio, CSV) fica em
 * @facaamigos/domain: aqui só sai linha de banco.
 */

export interface FaturamentoDiaRow {
  business_date: string;
  /** Vendas com status PAGA no dia. */
  orders_count: number;
  /** Soma do preço de tabela (list_unit_price_cents × quantidade) — o "bruto" antes de desconto. */
  gross_cents: number;
  /** Soma efetivamente cobrada (= orders.total_cents das vendas pagas). */
  net_cents: number;
}

/**
 * Bruto e líquido por dia operacional. O desconto não é uma coluna:
 * é a diferença entre o preço de tabela e o preço praticado, que é
 * exatamente como o shopping audita (ele compara o bruto declarado com
 * o preço de tabela exposto na loja).
 *
 * Só entra `status = 'PAGA'`: venda aberta ainda não é receita e venda
 * cancelada sai no agregado próprio (`cancelamentosPorDia`), porque a
 * administração costuma exigir o cancelamento visível e não abatido
 * silenciosamente do bruto.
 */
export function faturamentoPorDia(
  db: Db,
  unitId: string,
  fromDate: string,
  toDate: string,
): FaturamentoDiaRow[] {
  return db
    .prepare(
      `SELECT o.business_date AS business_date,
              COUNT(DISTINCT o.id) AS orders_count,
              COALESCE(SUM(oi.list_unit_price_cents * oi.quantity), 0) AS gross_cents,
              COALESCE(SUM(oi.total_cents), 0) AS net_cents
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       WHERE o.unit_id = ? AND o.status = 'PAGA' AND o.business_date BETWEEN ? AND ?
       GROUP BY o.business_date
       ORDER BY o.business_date`,
    )
    .all(unitId, fromDate, toDate) as unknown as FaturamentoDiaRow[];
}

export interface FaturamentoPorNaturezaRow {
  business_date: string;
  /** SERVICO = tempo de brincadeira/sessão; PRODUTO = venda no balcão (meia, lanche, souvenir). */
  item_nature: "SERVICO" | "PRODUTO";
  net_cents: number;
}

/**
 * Separação serviço × produto. Importa porque muitos contratos de
 * shopping aplicam percentuais diferentes por natureza de receita, e
 * porque a tributação das duas não é a mesma — declarar tudo num
 * balde só é o caminho mais curto para uma glosa na auditoria.
 */
export function faturamentoPorNatureza(
  db: Db,
  unitId: string,
  fromDate: string,
  toDate: string,
): FaturamentoPorNaturezaRow[] {
  return db
    .prepare(
      `SELECT o.business_date AS business_date,
              oi.item_nature AS item_nature,
              COALESCE(SUM(oi.total_cents), 0) AS net_cents
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       WHERE o.unit_id = ? AND o.status = 'PAGA' AND o.business_date BETWEEN ? AND ?
       GROUP BY o.business_date, oi.item_nature
       ORDER BY o.business_date`,
    )
    .all(unitId, fromDate, toDate) as unknown as FaturamentoPorNaturezaRow[];
}

export interface FaturamentoPorMeioPagamentoRow {
  business_date: string;
  method: "DINHEIRO" | "PIX" | "CREDITO" | "DEBITO" | "VOUCHER";
  total_cents: number;
}

/** Quebra por meio de pagamento — item padrão de conciliação em quase todo layout de shopping. */
export function faturamentoPorMeioPagamento(
  db: Db,
  unitId: string,
  fromDate: string,
  toDate: string,
): FaturamentoPorMeioPagamentoRow[] {
  return db
    .prepare(
      `SELECT o.business_date AS business_date,
              p.method AS method,
              COALESCE(SUM(p.amount_cents), 0) AS total_cents
       FROM payments p
       JOIN orders o ON o.id = p.order_id
       WHERE o.unit_id = ? AND o.status = 'PAGA' AND o.business_date BETWEEN ? AND ?
       GROUP BY o.business_date, p.method
       ORDER BY o.business_date`,
    )
    .all(unitId, fromDate, toDate) as unknown as FaturamentoPorMeioPagamentoRow[];
}

export interface CancelamentoDiaRow {
  business_date: string;
  cancelled_count: number;
  cancelled_cents: number;
}

/** Cancelamentos do dia, declarados à parte do bruto (ver comentário em `faturamentoPorDia`). */
export function cancelamentosPorDia(
  db: Db,
  unitId: string,
  fromDate: string,
  toDate: string,
): CancelamentoDiaRow[] {
  return db
    .prepare(
      `SELECT business_date,
              COUNT(*) AS cancelled_count,
              COALESCE(SUM(total_cents), 0) AS cancelled_cents
       FROM orders
       WHERE unit_id = ? AND status = 'CANCELADA' AND business_date BETWEEN ? AND ?
       GROUP BY business_date
       ORDER BY business_date`,
    )
    .all(unitId, fromDate, toDate) as unknown as CancelamentoDiaRow[];
}
