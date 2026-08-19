import { useEffect, useState } from "react";
import { Button, Card, MinusIcon, HelpText, Input } from "@facaamigos/ui";
import { Api } from "../api/client.js";
import type { Product, FiscalDoc } from "../api/client.js";
import { useAppState } from "../state/AppState.js";
import { money } from "../format.js";
import { CashPaymentPad } from "../components/CashPaymentPad.js";
import { openTapCharge, savePendingTap } from "../lib/infinitepayTap.js";
import { NfceModal } from "../components/NfceModal.js";

interface CartLine {
  product: Product;
  quantity: number;
}

const METHODS = ["DINHEIRO", "PIX", "CREDITO", "DEBITO"] as const;

function formatCpfMask(val: string): string {
  const digits = val.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

export function PdvScreen() {
  const { unit, employee } = useAppState();
  const [products, setProducts] = useState<Product[]>([]);
  const [hasOpenShift, setHasOpenShift] = useState<boolean | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [method, setMethod] = useState<(typeof METHODS)[number]>("PIX");
  const [fiscalCpf, setFiscalCpf] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showNfceModal, setShowNfceModal] = useState(false);
  const [lastSaleDoc, setLastSaleDoc] = useState<{
    doc: FiscalDoc | null;
    orderCode: string;
    items: Array<{ description: string; quantity: number; amountCents: number }>;
    payments: Array<{ method: string; amountCents: number }>;
    fiscalCpf: string | null;
  } | null>(null);

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
      const cleanCpf = fiscalCpf.replace(/\D/g, "");
      const itemsSnapshot = cart.map((line) => ({
        description: line.product.name,
        quantity: line.quantity,
        amountCents: line.product.price_cents * line.quantity,
      }));

      const result = await Api.pdvOrder({
        unitId: unit.id,
        employeeId: employee.id,
        items: cart.map((line) => ({ productId: line.product.id, quantity: line.quantity })),
        payments: [{ method, amountCents: totalCents }],
        fiscalCpf: cleanCpf || null,
      });

      setSuccess(`Venda registrada! Código: ${result.orderCode}`);
      setCart([]);
      setFiscalCpf("");
      Api.products(unit.id).then(setProducts).catch(() => {});

      const fiscalDoc = await Api.fiscalDocByOrder(result.orderId).catch(() => null);
      setLastSaleDoc({
        doc: fiscalDoc,
        orderCode: result.orderCode,
        items: itemsSnapshot,
        payments: [{ method, amountCents: totalCents }],
        fiscalCpf: cleanCpf || null,
      });
      setShowNfceModal(true);
    } catch (err) {
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

  const itemCount = cart.reduce((sum, line) => sum + line.quantity, 0);

  return (
    <div className="pdv-shell" style={{ display: "flex", gap: "24px", padding: "24px" }}>
      <div style={{ flex: 2 }}>
        <h1 style={{ fontFamily: "var(--font-display)" }}>PDV</h1>
        <HelpText>Toque num produto para adicioná-lo ao carrinho, ao lado. Produtos sem estoque aparecem apagados.</HelpText>
        <div className="pdv-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "12px", marginTop: "16px" }}>
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

      <Card id="pdv-cart-section" className="pdv-cart" style={{ flex: 1, padding: "16px", height: "fit-content" }}>
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

        <div style={{ marginTop: "12px" }}>
          <Input
            label="CPF no Cupom Fiscal (opcional)"
            placeholder="000.000.000-00"
            value={fiscalCpf}
            onChange={(e) => setFiscalCpf(formatCpfMask(e.target.value))}
            maxLength={14}
          />
        </div>

        <HelpText style={{ margin: "12px 0 0" }}>Escolha como o cliente vai pagar:</HelpText>
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
        {success && (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", margin: "8px 0" }}>
            <p style={{ color: "var(--color-teal-text)", margin: 0 }}>{success}</p>
            {lastSaleDoc && (
              <Button variant="secondary" size="sm" onClick={() => setShowNfceModal(true)}>
                📄 Ver / Imprimir Cupom NFC-e
              </Button>
            )}
          </div>
        )}

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

      {cart.length > 0 && (
        <button
          type="button"
          className="pdv-cart-bar"
          onClick={() => document.getElementById("pdv-cart-section")?.scrollIntoView({ behavior: "smooth", block: "start" })}
          title="Ir para o carrinho"
        >
          <span>
            🛒 {itemCount} {itemCount === 1 ? "item" : "itens"}
          </span>
          <span>{money(totalCents)}</span>
          <span>Ver carrinho ▲</span>
        </button>
      )}

      {showNfceModal && lastSaleDoc && (
        <NfceModal
          doc={lastSaleDoc.doc}
          unitName={unit.name}
          orderCode={lastSaleDoc.orderCode}
          items={lastSaleDoc.items}
          payments={lastSaleDoc.payments}
          fiscalCpf={lastSaleDoc.fiscalCpf}
          onClose={() => setShowNfceModal(false)}
        />
      )}
    </div>
  );
}
