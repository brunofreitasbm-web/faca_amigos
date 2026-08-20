import { useEffect, useState } from "react";
import { Api } from "../api/client.js";
import type { Unit, UnitCashStatus, UnitEnvelopeBalance } from "../api/client.js";
import { useActiveSessions } from "../api/useTick.js";
import { unitBrandFor } from "../branding/unitBrand.js";
import { money } from "../format.js";

type FrequenciaRow = Awaited<ReturnType<typeof Api.frequenciaRecords>>[number];

function pontoStatusLabel(kind: FrequenciaRow["kind"]): { label: string; color: string } {
  switch (kind) {
    case "ENTRADA":
      return { label: "no turno", color: "#1D8273" };
    case "INTERVALO_FIM":
      return { label: "voltou do intervalo", color: "#1D8273" };
    case "INTERVALO_INICIO":
      return { label: "em intervalo", color: "#996D18" };
    case "SAIDA":
      return { label: "saiu", color: "var(--text-muted)" };
  }
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Detalhe de uma operação — aberto a partir de um card da home do Owner
 * (MobileGerencialHome). Só números com fonte real: quem bateu ponto hoje
 * (frequenciaRecords, o último registro de cada um decide o status atual),
 * caixa e envelope (as mesmas RPCs da home). Sem "Meta %" e sem "quem
 * ainda não chegou" — nenhum dos dois existe no banco (não há meta de
 * faturamento nem agenda de turnos futuros), então inventar aqui seria
 * dado fictício numa tela de decisão real.
 */
export function MobileUnitDetail({ unit, onBack }: { unit: Unit; onBack: () => void }) {
  const { entries, status } = useActiveSessions(unit.id);
  const [revenueCents, setRevenueCents] = useState<number | null>(null);
  const [cash, setCash] = useState<UnitCashStatus | null>(null);
  const [envelope, setEnvelope] = useState<UnitEnvelopeBalance | null>(null);
  const [equipe, setEquipe] = useState<FrequenciaRow[] | null>(null);

  useEffect(() => {
    let alive = true;
    Api.todayRevenue(unit.id, unit.business_day_cutoff_hour)
      .then((r) => alive && setRevenueCents(r.totalCents))
      .catch(() => {});
    Api.unitsCashStatus()
      .then((rows) => alive && setCash(rows.find((r) => r.unit_id === unit.id) ?? null))
      .catch(() => {});
    Api.unitsEnvelopeBalance()
      .then((rows) => alive && setEnvelope(rows.find((r) => r.unit_id === unit.id) ?? null))
      .catch(() => {});
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    Api.frequenciaRecords(unit.id, startOfDay.getTime(), Date.now())
      .then((rows) => {
        if (!alive) return;
        // A consulta já vem mais recente primeiro — a primeira ocorrência
        // de cada colaborador é o status de agora.
        const lastByEmployee = new Map<string, FrequenciaRow>();
        for (const row of rows) {
          if (!lastByEmployee.has(row.employee_id)) lastByEmployee.set(row.employee_id, row);
        }
        setEquipe(Array.from(lastByEmployee.values()).sort((a, b) => b.at_ms - a.at_ms));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [unit.id, unit.business_day_cutoff_hour]);

  const brand = unitBrandFor(unit.name);
  const insideCount = status === "ready" ? entries.length : null;
  const leavingSoon = status === "ready" ? entries.filter((e) => {
    const left = (e.quote.timing.durationMs - e.quote.timing.elapsedMs) / 60000;
    return !e.quote.timing.isPaused && left > 0 && left <= 5;
  }).length : 0;

  return (
    <div className="m-shell">
      <div className="m-frame">
        <div className="m-navbar">
          <button type="button" className="m-round" aria-label="Voltar" onClick={onBack}>
            ‹
          </button>
          <span className="m-title-sm m-grow">{brand.icon} {brand.title}</span>
        </div>

        <div className="m-scroll">
          <div className="m-row" style={{ gap: 10 }}>
            <div className="m-card m-grow" style={{ borderRadius: 20, padding: 14 }}>
              <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>Receita hoje</p>
              <p className="m-num" style={{ margin: "4px 0 0", fontFamily: "var(--font-display)", fontSize: 22, color: "var(--color-primary-hover)" }}>
                {revenueCents != null ? money(revenueCents) : "—"}
              </p>
            </div>
            <div className="m-card m-grow" style={{ borderRadius: 20, padding: 14 }}>
              <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>Dentro</p>
              <p className="m-num" style={{ margin: "4px 0 0", fontFamily: "var(--font-display)", fontSize: 22, color: "#1D8273" }}>
                {insideCount ?? "—"}
              </p>
            </div>
          </div>

          {leavingSoon > 0 && (
            <p style={{ margin: "12px 0 0", fontSize: 12.5, fontWeight: 700, color: "#996D18" }}>
              {leavingSoon === 1 ? "1 criança saindo" : `${leavingSoon} crianças saindo`} nos próximos 5 minutos
            </p>
          )}

          <p className="m-eyebrow" style={{ margin: "22px 0 10px" }}>Equipe no turno</p>
          <div className="m-stack" style={{ gap: 8 }}>
            {(equipe ?? []).map((row) => {
              const st = pontoStatusLabel(row.kind);
              return (
                <div key={row.employee_id} className="m-row" style={{ justifyContent: "space-between", background: "var(--surface-card)", border: "1px solid var(--color-gray-200)", borderRadius: 16, padding: "11px 14px" }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700 }}>{row.full_name}</span>
                  <span style={{ fontSize: 12, fontWeight: 800, color: st.color }}>{st.label} · {fmtTime(row.at_ms)}</span>
                </div>
              );
            })}
            {equipe !== null && equipe.length === 0 && (
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--text-muted)" }}>Ninguém bateu ponto ainda hoje.</p>
            )}
          </div>

          <p className="m-eyebrow" style={{ margin: "22px 0 10px" }}>Caixa</p>
          <div className="m-card" style={{ borderRadius: 20 }}>
            {cash ? (
              <>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>
                  {cash.status === "ABERTO" ? `Aberto às ${fmtTime(cash.opened_at_ms!)}` : "Fechado"}
                </p>
                {cash.status === "ABERTO" && cash.current_cash_cents != null && (
                  <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-secondary)" }}>{money(cash.current_cash_cents)} em caixa agora</p>
                )}
              </>
            ) : (
              <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>Carregando…</p>
            )}
            {envelope && envelope.pending_cents > 0 && (
              <p style={{ margin: "10px 0 0", fontSize: 12.5, fontWeight: 700, color: "#996D18" }}>
                {money(envelope.pending_cents)} em {envelope.pending_count} envelope(s) aguardando recolhimento
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
