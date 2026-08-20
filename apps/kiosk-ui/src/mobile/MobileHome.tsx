import { useEffect, useState } from "react";
import { Api } from "../api/client.js";
import type { Unit } from "../api/client.js";
import { useAuth } from "../auth/AuthContext.js";
import { money } from "../format.js";

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

/**
 * Home do turno — "o que fazer agora", não "tudo o que dá para fazer".
 *
 * A ordem da tela é a ordem da fila real do balcão: quem já preencheu o
 * cadastro pelo QR aparece antes de qualquer outra coisa, porque é a
 * família que está parada esperando alguém conferir dois campos. No
 * sistema de balcão essa lista mora dentro de um cartão do Painel — se o
 * operador não abre, ele digita de novo o que já estava pronto.
 */
export function MobileHome({
  unit,
  employeeName,
  activeCount,
  onNovaEntrada,
  onAbrirTela,
  pendingRenewalsCount,
  onAbrirPedidos,
}: {
  unit: Unit;
  employeeName: string;
  activeCount: number | null;
  onNovaEntrada: () => void;
  onAbrirTela: (screen: "SAIDA" | "CAIXA" | "PONTO") => void;
  pendingRenewalsCount: number;
  onAbrirPedidos: () => void;
}) {
  const { can } = useAuth();
  const [pendentes, setPendentes] = useState<number | null>(null);
  const [revenueCents, setRevenueCents] = useState<number | null>(null);
  const [shiftOpen, setShiftOpen] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;

    function load() {
      Api.preCheckinList(unit.id)
        .then((list) => alive && setPendentes(list.length))
        .catch(() => alive && setPendentes(null));
      Api.todayRevenue(unit.id, unit.business_day_cutoff_hour)
        .then((r) => alive && setRevenueCents(r.totalCents))
        .catch(() => alive && setRevenueCents(null));
      Api.currentShift(unit.id)
        .then((s) => alive && setShiftOpen(Boolean(s)))
        .catch(() => alive && setShiftOpen(null));
    }

    load();
    // O celular fica no bolso e volta: revalidar ao reabrir evita o
    // operador agir sobre uma fila de meia hora atrás. Sem polling — a
    // contagem de pré-cadastros não justifica uma consulta por minuto.
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [unit.id, unit.business_day_cutoff_hour]);

  const temPendentes = (pendentes ?? 0) > 0;

  return (
    <>
      <div className="m-appbar">
        <div className="m-grow">
          <p className="m-title m-trunc">Turno de {employeeName.split(" ")[0]}</p>
          <p className="m-sub">
            {unit.name}
            {shiftOpen === false ? " · caixa fechado" : revenueCents != null ? ` · ${money(revenueCents)} hoje` : ""}
          </p>
        </div>
        <span className="m-avatar" aria-hidden="true">
          {initials(employeeName)}
        </span>
      </div>

      <div className="m-scroll">
        {can("sessao.checkin") && (
          <button
            type="button"
            className="m-tap"
            onClick={onNovaEntrada}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 14,
              background: temPendentes ? "var(--gradient-brand, var(--color-primary))" : "var(--color-primary)",
              border: "none",
              borderRadius: 20,
              padding: "18px 20px",
              font: "inherit",
              textAlign: "left",
            }}
          >
            <span className="m-grow">
              <span style={{ display: "block", fontFamily: "var(--font-display)", fontSize: 21, lineHeight: 1.2, color: "#fff" }}>
                Nova entrada
              </span>
              <span style={{ display: "block", marginTop: 3, fontSize: 12.5, fontWeight: 700, color: "rgba(255,255,255,.85)" }}>
                {temPendentes
                  ? `${pendentes} família(s) já preencheram pelo QR`
                  : "busca, plano, confirmar"}
              </span>
            </span>
            <span aria-hidden="true" style={{ fontSize: 22, color: "rgba(255,255,255,.9)", flex: "none" }}>
              ›
            </span>
          </button>
        )}

        {pendingRenewalsCount > 0 && (
          <button
            type="button"
            className="m-tap"
            onClick={onAbrirPedidos}
            style={{
              marginTop: 10,
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 12,
              background: "var(--surface-card)",
              border: "2px solid var(--color-teal)",
              borderRadius: 20,
              padding: "14px 16px",
              font: "inherit",
              textAlign: "left",
            }}
          >
            <span aria-hidden="true" style={{ fontSize: 20 }}>📱</span>
            <span className="m-grow" style={{ fontSize: 13.5, fontWeight: 800, lineHeight: 1.35 }}>
              {pendingRenewalsCount === 1 ? "1 pedido de mais tempo" : `${pendingRenewalsCount} pedidos de mais tempo`}
            </span>
            <span style={{ fontSize: 13, fontWeight: 800, color: "#1D8273", flex: "none" }}>Ver</span>
          </button>
        )}

        <div className="m-row" style={{ gap: 12, marginTop: 14 }}>
          <div className="m-card m-grow" style={{ borderRadius: 20, padding: 14 }}>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>Dentro agora</p>
            <p
              className="m-num"
              style={{ margin: "4px 0 0", fontFamily: "var(--font-display)", fontSize: 28, lineHeight: 1.15, color: "#1D8273" }}
            >
              {activeCount ?? "—"}
            </p>
          </div>
          <div className="m-card m-grow" style={{ borderRadius: 20, padding: 14 }}>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>Receita do dia</p>
            <p
              className="m-num"
              style={{ margin: "4px 0 0", fontFamily: "var(--font-display)", fontSize: 22, lineHeight: 1.3, color: "#996D18" }}
            >
              {revenueCents != null ? money(revenueCents) : "—"}
            </p>
          </div>
        </div>

        {shiftOpen === false && can("caixa.open_close") && (
          <button
            type="button"
            className="m-tap"
            onClick={() => onAbrirTela("CAIXA")}
            style={{
              marginTop: 12,
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 12,
              background: "var(--surface-card)",
              border: "2px solid var(--color-yellow)",
              borderRadius: 20,
              padding: "14px 16px",
              font: "inherit",
              textAlign: "left",
            }}
          >
            <span className="m-grow" style={{ fontSize: 13.5, fontWeight: 800, lineHeight: 1.35 }}>
              O caixa deste turno ainda não foi aberto
            </span>
            <span style={{ fontSize: 13, fontWeight: 800, color: "#996D18", flex: "none" }}>Abrir</span>
          </button>
        )}

        <p className="m-eyebrow" style={{ margin: "22px 0 10px" }}>
          Abrir a tela completa
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {can("sessao.checkout") && (
            <AtalhoTela titulo="Saída" ajuda="cobrar e liberar" onClick={() => onAbrirTela("SAIDA")} />
          )}
          {can("caixa.open_close") && (
            <AtalhoTela titulo="Caixa" ajuda="abrir, sangria, fechar" onClick={() => onAbrirTela("CAIXA")} />
          )}
          {can("ponto.self") && <AtalhoTela titulo="Ponto" ajuda="entrada e intervalo" onClick={() => onAbrirTela("PONTO")} />}
        </div>
      </div>
    </>
  );
}

function AtalhoTela({ titulo, ajuda, onClick }: { titulo: string; ajuda: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="m-tap m-card"
      onClick={onClick}
      style={{ borderRadius: 20, padding: "13px 16px", minHeight: 60, font: "inherit", textAlign: "left" }}
    >
      <span style={{ display: "block", fontSize: 15.5, fontWeight: 800 }}>{titulo}</span>
      <span style={{ display: "block", marginTop: 2, fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>{ajuda}</span>
    </button>
  );
}
