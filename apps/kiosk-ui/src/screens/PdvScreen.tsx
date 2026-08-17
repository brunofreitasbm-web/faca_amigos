import { useEffect, useState } from "react";
import { Button, Card, MinusIcon, HelpText } from "@facaamigos/ui";
import { Api } from "../api/client.js";
import type { Product } from "../api/client.js";
import { useAppState } from "../state/AppState.js";
import { money } from "../format.js";
import { CashPaymentPad } from "../components/CashPaymentPad.js";
import { openTapCharge, savePendingTap } from "../lib/infinitepayTap.js";

interface CartLine {
  product: Product;
  quantity: number;
}

const METHODS = ["DINHEIRO", "PIX", "CREDITO", "DEBITO"] as const;

export function PdvScreen() {
  const { unit, employee } = useAppState();
  const [products, setProducts] = useState<Product[]>([]);
  const [hasOpenShift, setHasOpenShift] = useState<boolean | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [method, setMethod] = useState<(typeof METHODS)[number]>("PIX");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!unit) return;
    Api.products(unit.id).then(setProducts);
    Api.currentShift(unit.id).then((shift) => setHasOpenShift(!!shift));
  }, [unit]);


  function addToCart(product: Product) {
    setCart((prev) => {
      const existing = prev.find((line) => line.product.id === product.id);
      if (existing) return prev.map((line) => (line.product.id === product.id ? { ...line, quantity: line.quantity + 1 } : line));
      return [...prev, { product, quantity: 1 }];
    });
  }

  function removeFromCart(productId: string) {
    setCart((prev) =>
      prev
        .map((line) => (line.product.id === productId ? { ...line, quantity: line.quantity - 1 } : line))
        .filter((line) => line.quantity > 0),
    );
  }

  const totalCents = cart.reduce((sum, line) => sum + line.product.price_cents * line.quantity, 0);

  async function confirm() {
    if (!unit || !employee || cart.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await Api.pdvOrder({
        unitId: unit.id,
        employeeId: employee.id,
        items: cart.map((line) => ({ productId: line.product.id, quantity: line.quantity })),
        payments: [{ method, amountCents: totalCents }],
      });
      setSuccess(`Venda registrada! Código: ${result.orderCode}`);
      setCart([]);
      // A venda já está feita — se só esta atualização de estoque falhar,
      // a tela continua com o estoque antigo até a próxima ação; não é
      // motivo pra reportar erro na venda que na verdade deu certo.
      Api.products(unit.id).then(setProducts).catch(() => {});
    } catch (err) {
      // Só o <p> abaixo (sem toast redundante): a mesma mensagem duas
      // vezes — uma que some sozinha, outra que fica — não ajudava.
      const msg = err instanceof Error ? err.message : "Erro ao vender";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  function handleTapCharge() {
    if (!unit || !employee || cart.length === 0 || (method !== "CREDITO" && method !== "DEBITO")) return;
    const orderId = crypto.randomUUID();
    savePendingTap(orderId, {
      kind: "pdv",
      unitId: unit.id,
      employeeId: employee.id,
      method,
      amountCents: totalCents,
      items: cart.map((line) => ({ productId: line.product.id, quantity: line.quantity })),
    });
    openTapCharge({
      amountCents: totalCents,
      method,
      orderId,
      handle: import.meta.env.VITE_INFINITEPAY_HANDLE as string | undefined,
      docNumber: unit.cnpj ?? undefined,
    });
  }

  if (!unit) return null;

  return (
    <div style={{ display: "flex", gap: "24px", padding: "24px" }}>
      <div style={{ flex: 2 }}>
        <h1 style={{ fontFamily: "var(--font-display)" }}>PDV</h1>
        <HelpText>Toque num produto para adicioná-lo ao carrinho, ao lado. Produtos sem estoque aparecem apagados.</HelpText>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "12px", marginTop: "16px" }}>
          {products.map((p) => (
            <Card key={p.id} onClick={() => p.stock > 0 && addToCart(p)} style={{ cursor: p.stock > 0 ? "pointer" : "not-allowed", opacity: p.stock > 0 ? 1 : 0.4, padding: "12px" }}>
              <div style={{ fontSize: "28px" }}>{p.emoji}</div>
              <strong>{p.name}</strong>
              <div>{money(p.price_cents)}</div>
              <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>{p.stock} un.</div>
            </Card>
          ))}
        </div>
      </div>

      <Card style={{ flex: 1, padding: "16px", height: "fit-content" }}>
        <h2>Carrinho</h2>
        {cart.length === 0 && <p>Vazio</p>}
        {cart.map((line) => (
          <div key={line.product.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0" }}>
            <span>
              {line.quantity}× {line.product.name}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span>{money(line.product.price_cents * line.quantity)}</span>
              <Button variant="ghost" size="sm" onClick={() => removeFromCart(line.product.id)} aria-label={`Remover uma unidade de ${line.product.name}`}>
                <MinusIcon />
              </Button>
            </div>
          </div>
        ))}
        <hr />
        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: "bold" }}>
          <span>Total</span>
          <span>{money(totalCents)}</span>
        </div>

        <HelpText style={{ margin: "8px 0 0" }}>Escolha como o cliente vai pagar:</HelpText>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", margin: "12px 0" }}>
          {METHODS.map((m) => (
            <Button key={m} variant={method === m ? "primary" : "secondary"} size="sm" onClick={() => setMethod(m)} title={`Pagar via ${m}`}>
              {m}
            </Button>
          ))}
        </div>

        {hasOpenShift === false && (
          <div style={{ background: "#FEF3C7", color: "#92400E", padding: "12px 16px", borderRadius: "8px", border: "1px solid #F59E0B", marginBottom: "16px", fontSize: "14px" }}>
            ⚠️ <strong>Caixa fechado:</strong> Não há turno de caixa aberto nesta unidade. Abra o turno na tela de <strong>Caixa</strong> para realizar vendas no PDV.
          </div>
        )}

        {error && <p style={{ color: "var(--color-error-text)" }}>{error}</p>}
        {success && <p style={{ color: "var(--color-teal-text)" }}>{success}</p>}

        {method === "DINHEIRO" ? (
          <CashPaymentPad totalCents={totalCents} busy={busy || cart.length === 0 || hasOpenShift === false} onConfirm={() => confirm()} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {(method === "CREDITO" || method === "DEBITO") && (
              <Button
                variant="secondary"
                fullWidth
                disabled={busy || cart.length === 0 || hasOpenShift === false}
                onClick={handleTapCharge}
                title="Cobrar por aproximação usando o celular/tablet como maquininha (InfiniteTap)"
              >
                📲 Cobrar com InfiniteTap
              </Button>
            )}
            <Button
              variant="primary"
              fullWidth
              loading={busy}
              disabled={busy || cart.length === 0 || hasOpenShift === false}
              onClick={confirm}
              title="Confirmar a venda com o método selecionado"
            >
              Confirmar venda
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
