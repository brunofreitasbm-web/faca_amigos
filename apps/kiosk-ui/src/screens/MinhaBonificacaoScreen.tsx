import { useEffect, useMemo, useState } from "react";
import { Card, HelpText, Badge } from "@facaamigos/ui";
import { Api, businessDateFor } from "../api/client.js";
import type { TicketGoal } from "../api/client.js";
import { bonificacaoHoje, dentroDoPiloto, diaSemanaISO } from "../bonificacao.js";
import { mesAtualValue, rangeDoMes, type ApuracaoDia, type ApuracaoOperador, type BonusProgramsByUnit } from "../lib/apuracaoBonificacao.js";
import { useAppState } from "../state/AppState.js";
import { money } from "../format.js";

type Escopo = "UNIDADE" | "TODAS";

/**
 * Menu individual, somente-consulta: cada colaborador vê seus próprios
 * números do programa de bonificação (piloto Playground + Circuito), sem
 * depender do gerente para saber "quanto já ganhei no mês" (FAQ do
 * manual-operadores.md). Nada aqui é editável — quem decide meta, teto e
 * regras continua sendo Gerencial > Metas/Bonificação.
 */
export function MinhaBonificacaoScreen() {
  const { unit, units, employee } = useAppState();
  const [escopo, setEscopo] = useState<Escopo>("UNIDADE");
  const [dias, setDias] = useState<ApuracaoDia[]>([]);
  const [mes, setMes] = useState<ApuracaoOperador[]>([]);
  const [ticketGoal, setTicketGoal] = useState<TicketGoal | null>(null);
  const [programs, setPrograms] = useState<BonusProgramsByUnit>({});
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const unitIds = useMemo(
    () => (escopo === "UNIDADE" ? (unit ? [unit.id] : []) : units.map((u) => u.id)),
    [escopo, unit, units],
  );
  const { from, to } = useMemo(() => rangeDoMes(mesAtualValue()), []);

  useEffect(() => {
    if (!employee || unitIds.length === 0) {
      setDias([]);
      setMes([]);
      return;
    }
    let cancelado = false;
    setLoading(true);
    setErro(null);
    Api.myBonusAccrual(employee.id, unitIds, from, to)
      .then((r) => {
        if (cancelado) return;
        setDias(r.dias);
        setMes(r.mes);
      })
      .catch((err) => {
        if (!cancelado) setErro(err instanceof Error ? err.message : "Não foi possível calcular a sua bonificação.");
      })
      .finally(() => {
        if (!cancelado) setLoading(false);
      });
    return () => {
      cancelado = true;
    };
  }, [employee, unitIds, from, to]);

  useEffect(() => {
    if (unitIds.length === 0) {
      setPrograms({});
      return;
    }
    let cancelado = false;
    Api.bonusProgramsByUnit(unitIds).then((p) => {
      if (!cancelado) setPrograms(p);
    });
    return () => {
      cancelado = true;
    };
  }, [unitIds]);

  useEffect(() => {
    if (escopo !== "UNIDADE" || !unit) {
      setTicketGoal(null);
      return;
    }
    let cancelado = false;
    Api.ticketGoal(unit.id).then((g) => {
      if (!cancelado) setTicketGoal(g);
    });
    return () => {
      cancelado = true;
    };
  }, [escopo, unit]);

  if (!employee) return null;

  const diasOrdenados = [...dias].sort((a, b) => b.businessDate.localeCompare(a.businessDate));
  const hojeStr = unit ? businessDateFor(Date.now(), unit.business_day_cutoff_hour) : null;
  const diaHoje = hojeStr ? dias.find((d) => d.unitId === unit?.id && d.businessDate === hojeStr) : undefined;

  // O teto do mês é configurado por unidade (Gerencial > Metas) — cada linha
  // de `mes` já vem com o teto da própria unidade aplicado; aqui só somamos
  // os tetos das unidades no escopo para mostrar "de até X" no total.
  const tetoMesCents = unitIds.reduce((sum, id) => sum + (programs[id]?.tetoMesCents ?? 0), 0);
  const somaAcumuladoCents = mes.reduce((sum, m) => sum + m.acumuladoMesCents, 0);
  const acumuladoMesCents = tetoMesCents > 0 ? Math.min(somaAcumuladoCents, tetoMesCents) : somaAcumuladoCents;
  const diasComBonus = mes.reduce((sum, m) => sum + m.diasComBonus, 0);
  const diasTrabalhados = mes.reduce((sum, m) => sum + m.diasTrabalhados, 0);
  const itensMes = mes.reduce((sum, m) => sum + m.itensMes, 0);
  const faturamentoMesCents = dias.reduce((sum, d) => sum + d.faturamentoCents, 0);
  const pedidosMes = dias.reduce((sum, d) => sum + d.pedidos, 0);
  const ticketMedioMesCents = pedidosMes > 0 ? Math.round(faturamentoMesCents / pedidosMes) : 0;

  // Sequência atual de dias trabalhados com bônus batido, contando do mais
  // recente para trás — para de contar no primeiro dia trabalhado sem bônus.
  let streak = 0;
  for (const d of diasOrdenados) {
    if (d.bonusDiaCents > 0) streak += 1;
    else break;
  }

  return (
    <div style={{ padding: "16px", maxWidth: "820px", margin: "0 auto" }}>
      <Card style={{ padding: "16px", marginBottom: "16px" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: "18px", margin: "0 0 8px" }}>🎮 Minha Bonificação</h2>
        <HelpText style={{ marginBottom: "12px" }}>
          Só os seus números do programa de bonificação — ninguém mais vê o que aparece aqui, e você não edita nada
          nesta tela. O relatório oficial que decide o pagamento é apurado no fim do mês pelo Gerencial.
        </HelpText>
        {units.length > 1 && (
          <div style={{ display: "flex", gap: "8px" }}>
            {(["UNIDADE", "TODAS"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setEscopo(v)}
                style={{
                  padding: "8px 14px",
                  borderRadius: "9999px",
                  border: escopo === v ? "1px solid var(--color-primary)" : "1px solid var(--border-subtle)",
                  background: escopo === v ? "var(--color-primary)" : "var(--surface-sunken)",
                  color: escopo === v ? "#fff" : "var(--text-primary)",
                  fontWeight: "bold",
                  fontSize: "13px",
                  cursor: "pointer",
                }}
              >
                {v === "UNIDADE" ? `Esta unidade${unit ? ` (${unit.name})` : ""}` : "Todas as minhas unidades"}
              </button>
            ))}
          </div>
        )}
      </Card>

      {erro && (
        <Card style={{ padding: "12px 16px", marginBottom: "16px", border: "1px solid var(--color-error-text)" }}>
          <span style={{ color: "var(--color-error-text)" }}>{erro}</span>
        </Card>
      )}

      {escopo === "UNIDADE" && unit && hojeStr && dentroDoPiloto(hojeStr) && (() => {
        const tipo = unit.kind === "QUIOSQUE" ? "CIRCUITO" : "PLAYGROUND";
        const atual = tipo === "CIRCUITO" ? (diaHoje?.sessoes ?? 0) : (diaHoje?.faturamentoCents ?? 0);
        const program = programs[unit.id] ?? null;
        const goal = program?.goals.find((g) => g.weekday === diaSemanaISO(hojeStr)) ?? null;
        const b = bonificacaoHoje(tipo, hojeStr, atual, goal, program?.locacaoExtraBonusCents ?? 0);
        if (!b) return null;
        const corNivel = b.nivel === "supermeta" ? "var(--color-amber)" : b.nivel === "meta" ? "var(--color-success)" : "var(--color-primary)";
        const badgeVariant = b.nivel === "supermeta" ? "solid_amber" : b.nivel === "meta" ? "green" : "neutral";
        const badgeLabel = b.nivel === "supermeta" ? "🏆 Supermeta!" : b.nivel === "meta" ? "🥈 Meta batida!" : "Em andamento";
        const atualLabel = tipo === "CIRCUITO" ? `${b.atual} locações` : money(b.atual);
        const metaLabel = tipo === "CIRCUITO" ? `${b.meta}` : money(b.meta);
        const superLabel = tipo === "CIRCUITO" ? `${b.super}` : money(b.super);
        const travaZerou = Boolean(diaHoje && diaHoje.bonusMetaCents > 0 && diaHoje.bonusDiaCents === 0);
        return (
          <Card style={{ padding: "16px", marginBottom: "16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "4px 10px", marginBottom: "8px" }}>
              <span style={{ fontSize: "14px", fontWeight: "bold" }}>
                Hoje: {atualLabel} <span style={{ color: "var(--text-muted)", fontWeight: "normal" }}>(meta {metaLabel} / super {superLabel})</span>
              </span>
              <Badge variant={badgeVariant}>{badgeLabel}</Badge>
            </div>
            <div className="capacity-bar-track" role="progressbar" aria-valuenow={b.percent} aria-valuemin={0} aria-valuemax={100}>
              <div className="capacity-bar-fill" style={{ width: `${b.percent}%`, backgroundColor: corNivel }} />
            </div>
            <div style={{ fontSize: "13px", color: "var(--text-muted)", marginTop: "8px" }}>
              Bônus estimado do dia: <strong style={{ color: "var(--text-primary)" }}>{money(b.bonusCents)}</strong>
            </div>
            {travaZerou && (
              <div style={{ marginTop: "8px", fontSize: "13px", color: "var(--color-error-text)" }}>
                ⚠️ {!diaHoje?.travaAberturaOk
                  ? "Caixa aberto depois de 10h15: o bônus do dia zera mesmo batendo a meta."
                  : "Fechamento com diferença acima de R$20 sem justificativa: o bônus do dia zera mesmo batendo a meta."}
              </div>
            )}
          </Card>
        );
      })()}

      <Card style={{ padding: "16px", marginBottom: "16px" }}>
        <h3 style={{ fontSize: "15px", margin: "0 0 12px" }}>💳 Meu ticket médio do mês</h3>
        <div style={{ fontSize: "24px", fontWeight: "bold" }}>{money(ticketMedioMesCents)}</div>
        <div style={{ fontSize: "13px", color: "var(--text-muted)", marginTop: "4px" }}>
          {pedidosMes} pedido{pedidosMes === 1 ? "" : "s"} pago{pedidosMes === 1 ? "" : "s"} no mês
          {ticketGoal && ticketGoal.targetTicketCents > 0 && (
            <> · meta da unidade: {money(ticketGoal.targetTicketCents)}</>
          )}
        </div>
      </Card>

      <Card style={{ padding: "16px", marginBottom: "16px" }}>
        <h3 style={{ fontSize: "15px", margin: "0 0 12px" }}>💰 Bonificação do mês</h3>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "8px" }}>
          <span style={{ fontSize: "24px", fontWeight: "bold" }}>{money(acumuladoMesCents)}</span>
          {tetoMesCents > 0 && <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>de até {money(tetoMesCents)} no mês</span>}
        </div>
        {tetoMesCents > 0 && (
          <div className="capacity-bar-track" role="progressbar" aria-valuenow={Math.round((acumuladoMesCents / tetoMesCents) * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div
              className="capacity-bar-fill"
              style={{ width: `${Math.min(100, Math.round((acumuladoMesCents / tetoMesCents) * 100))}%`, backgroundColor: "var(--color-amber)" }}
            />
          </div>
        )}
        <div style={{ fontSize: "13px", color: "var(--text-muted)", marginTop: "8px" }}>
          {diasComBonus} de {diasTrabalhados} dia{diasTrabalhados === 1 ? "" : "s"} trabalhado{diasTrabalhados === 1 ? "" : "s"} com bônus · {itensMes}{" "}
          produto{itensMes === 1 ? "" : "s"} vendido{itensMes === 1 ? "" : "s"} no mês
          {escopo === "UNIDADE" && unit && (() => {
            const meta = programs[unit.id]?.itensMesMeta ?? 0;
            const bonusCents = programs[unit.id]?.itensMesBonusCents ?? 0;
            if (meta <= 0) return null;
            return itensMes >= meta ? ` (bateu a meta de ${meta}, +${money(bonusCents)})` : ` (meta: ${meta})`;
          })()}
        </div>
      </Card>

      {streak >= 2 && (
        <Card style={{ padding: "16px", marginBottom: "16px", border: "1px solid var(--color-amber)" }}>
          <span style={{ fontSize: "15px", fontWeight: "bold" }}>🔥 {streak} dias seguidos batendo o bônus!</span>
        </Card>
      )}

      <Card style={{ padding: "16px" }}>
        <h3 style={{ fontSize: "15px", margin: "0 0 12px" }}>Meus últimos dias trabalhados</h3>
        {diasOrdenados.length === 0 && !loading && (
          <HelpText>Nenhum dia trabalhado apurado ainda neste mês.</HelpText>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {diasOrdenados.slice(0, 7).map((d) => {
            const ok = d.bonusDiaCents > 0;
            const naoBateuMeta = d.bonusMetaCents === 0;
            const motivo = ok
              ? null
              : naoBateuMeta
                ? "não bateu a meta do dia"
                : !d.travaAberturaOk
                  ? "trava: caixa aberto depois de 10h15"
                  : "trava: diferença no fechamento sem justificativa";
            return (
              <div
                key={`${d.unitId}|${d.businessDate}`}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", borderRadius: "8px", background: "var(--surface-sunken)", fontSize: "13px" }}
              >
                <span>
                  {ok ? "✅" : "❌"} {d.businessDate}
                  {motivo && <span style={{ color: "var(--text-muted)" }}> — {motivo}</span>}
                </span>
                <strong>{money(d.bonusDiaCents)}</strong>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
