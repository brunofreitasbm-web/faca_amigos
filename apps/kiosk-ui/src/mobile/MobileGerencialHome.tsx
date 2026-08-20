import { useEffect, useState } from "react";
import { Badge } from "@facaamigos/ui";
import { Api } from "../api/client.js";
import type { Unit, UnitCashStatus, UnitEnvelopeBalance } from "../api/client.js";
import { unitBrandFor } from "../branding/unitBrand.js";
import { money } from "../format.js";

/**
 * Home do Owner no modo celular — "as 3 operações numa tela".
 *
 * Só mostra números que têm fonte real: faturamento do dia (fa_kiosk_
 * today_revenue), quem está dentro agora (fa_kiosk_active_sessions),
 * status do caixa e saldo em envelope (fa_units_cash_status /
 * fa_units_envelope_balance — as mesmas RPCs das abas "Abertura e
 * Fechamento" e "Saldo em Envelopes" do Gerencial completo).
 *
 * O protótipo original desta tela tinha uma barra de "Meta do dia %" —
 * removida aqui de propósito: não existe, no banco, uma meta de
 * faturamento diário por unidade. Inventar um número ali seria decidir
 * fictício numa tela que o Owner usa para decisão real.
 */
export function MobileGerencialHome({ units, onAbrirPainelCompleto }: { units: Unit[]; onAbrirPainelCompleto: () => void }) {
  const [revenueByUnit, setRevenueByUnit] = useState<Record<string, number>>({});
  const [insideByUnit, setInsideByUnit] = useState<Record<string, number>>({});
  const [cashStatus, setCashStatus] = useState<UnitCashStatus[]>([]);
  const [envelopeBalance, setEnvelopeBalance] = useState<UnitEnvelopeBalance[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (units.length === 0) return;
    let alive = true;

    function load() {
      setLoading(true);
      Promise.all(units.map((u) => Api.todayRevenue(u.id, u.business_day_cutoff_hour).then((r) => [u.id, r.totalCents] as const)))
        .then((pairs) => alive && setRevenueByUnit(Object.fromEntries(pairs)))
        .catch(() => {});
      Promise.all(units.map((u) => Api.activeSessions(u.id).then((entries) => [u.id, entries.length] as const)))
        .then((pairs) => alive && setInsideByUnit(Object.fromEntries(pairs)))
        .catch(() => {});
      Api.unitsCashStatus()
        .then((rows) => alive && setCashStatus(rows))
        .catch(() => {});
      Api.unitsEnvelopeBalance()
        .then((rows) => alive && setEnvelopeBalance(rows))
        .catch(() => {})
        .finally(() => alive && setLoading(false));
    }

    load();
    // Mesmo espírito do MobileHome (turno do Operador): revalida quando o
    // celular volta a ficar visível, sem manter polling ligado o tempo todo.
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [units]);

  const totalRevenueCents = Object.values(revenueByUnit).reduce((sum, v) => sum + v, 0);
  const totalInside = Object.values(insideByUnit).reduce((sum, v) => sum + v, 0);
  const hasAnyData = Object.keys(revenueByUnit).length > 0;

  return (
    <div className="m-scroll">
      <div className="m-row" style={{ gap: 10, marginBottom: 4 }}>
        <div className="m-card m-grow" style={{ borderRadius: 20, padding: 14 }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>Faturamento hoje · nas 3</p>
          <p className="m-num" style={{ margin: "4px 0 0", fontFamily: "var(--font-display)", fontSize: 24, color: "var(--color-primary-hover)" }}>
            {hasAnyData ? money(totalRevenueCents) : "—"}
          </p>
        </div>
        <div className="m-card m-grow" style={{ borderRadius: 20, padding: 14 }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>Dentro agora</p>
          <p className="m-num" style={{ margin: "4px 0 0", fontFamily: "var(--font-display)", fontSize: 24, color: "#1D8273" }}>
            {hasAnyData ? totalInside : "—"}
          </p>
        </div>
      </div>

      <p className="m-eyebrow" style={{ margin: "20px 0 10px" }}>Operações</p>
      <div className="m-stack" style={{ gap: 10 }}>
        {units.map((u) => {
          const brand = unitBrandFor(u.name);
          const cash = cashStatus.find((c) => c.unit_id === u.id);
          const envelope = envelopeBalance.find((e) => e.unit_id === u.id);
          const revenue = revenueByUnit[u.id];
          const inside = insideByUnit[u.id];

          return (
            <div
              key={u.id}
              className="m-card"
              style={{ borderTop: `5px solid ${brand.accent}`, borderRadius: 20, padding: "15px 16px" }}
            >
              <div className="m-row" style={{ justifyContent: "space-between", gap: 10 }}>
                <span style={{ fontSize: 15.5, fontWeight: 800 }}>
                  {brand.icon} {brand.title}
                </span>
                <Badge variant={brand.badge}>{brand.location}</Badge>
              </div>

              <div className="m-row" style={{ gap: 18, marginTop: 12, flexWrap: "wrap" }}>
                <div>
                  <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: "var(--text-muted)" }}>Dentro</p>
                  <p className="m-num" style={{ margin: "2px 0 0", fontFamily: "var(--font-display)", fontSize: 18 }}>
                    {inside ?? "—"}
                  </p>
                </div>
                <div>
                  <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: "var(--text-muted)" }}>Faturamento</p>
                  <p className="m-num" style={{ margin: "2px 0 0", fontFamily: "var(--font-display)", fontSize: 18 }}>
                    {revenue != null ? money(revenue) : "—"}
                  </p>
                </div>
                {cash && (
                  <div>
                    <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: "var(--text-muted)" }}>Caixa</p>
                    <p
                      className="m-num"
                      style={{
                        margin: "2px 0 0",
                        fontFamily: "var(--font-display)",
                        fontSize: 18,
                        color: cash.status === "ABERTO" ? "#1D8273" : "var(--text-primary)",
                      }}
                    >
                      {cash.status === "ABERTO" ? "Aberto" : "Fechado"}
                    </p>
                  </div>
                )}
              </div>

              {envelope && envelope.pending_cents > 0 && (
                <p style={{ margin: "10px 0 0", fontSize: 12, fontWeight: 700, color: "#996D18" }}>
                  {money(envelope.pending_cents)} em {envelope.pending_count} envelope(s) aguardando recolhimento
                </p>
              )}
            </div>
          );
        })}
      </div>

      {loading && !hasAnyData && (
        <p style={{ marginTop: 14, fontSize: 13, fontWeight: 600, color: "var(--text-muted)" }}>Carregando os números das 3 operações…</p>
      )}

      <button
        type="button"
        className="m-cta"
        onClick={onAbrirPainelCompleto}
        style={{ marginTop: 24, background: "var(--color-dark, #1A3F35)" }}
      >
        Abrir painel administrativo completo
      </button>
      <p style={{ margin: "10px 0 24px", textAlign: "center", fontSize: 11.5, lineHeight: 1.4, fontWeight: 600, color: "var(--text-muted)" }}>
        Preço, colaboradores, permissões, folha e relatórios — desenhado para tela maior, funciona no celular
      </p>
    </div>
  );
}
