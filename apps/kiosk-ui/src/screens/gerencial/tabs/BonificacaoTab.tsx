import { useEffect, useMemo, useState } from "react";
import { Card, HelpText } from "@facaamigos/ui";
import { Api } from "../../../api/client.js";
import { mesAtualValue, rangeDoMes, type ApuracaoOperador } from "../../../lib/apuracaoBonificacao.js";
import { useAppState } from "../../../state/AppState.js";
import { money } from "../../../format.js";

const TETO_MES_CENTS = 20_000;

/**
 * Saldo de bonificação acumulado por operador no mês — apuração feita no
 * cliente com a mesma lógica de docs/bonificacao/apuracao_bonificacao.sql
 * (piloto Circuito + Playground, docs/bonificacao/programa-bonificacao-set-2026.md).
 * Antes desta tela, só existia como script SQL rodado manualmente contra o
 * Supabase — nada no app mostrava isso ao owner.
 */
export function BonificacaoTab() {
  const { units } = useAppState();
  const [mes, setMes] = useState(mesAtualValue());
  const [rows, setRows] = useState<ApuracaoOperador[]>([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const { from, to } = useMemo(() => rangeDoMes(mes), [mes]);

  useEffect(() => {
    if (units.length === 0) return;
    let cancelado = false;
    setLoading(true);
    setErro(null);
    Api.bonusAccrualMonth(units.map((u) => u.id), from, to)
      .then((r) => {
        if (!cancelado) setRows(r);
      })
      .catch((err) => {
        if (!cancelado) setErro(err instanceof Error ? err.message : "Não foi possível calcular a bonificação do mês.");
      })
      .finally(() => {
        if (!cancelado) setLoading(false);
      });
    return () => {
      cancelado = true;
    };
  }, [units, from, to]);

  const totalGeralCents = rows.reduce((sum, r) => sum + r.acumuladoMesCents, 0);

  return (
    <div>
      <Card style={{ padding: "16px", marginBottom: "16px" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: "18px", margin: "0 0 8px" }}>💰 Bonificação por Operador</h2>
        <HelpText style={{ marginBottom: "12px" }}>
          Acumulado do mês por operador, já com o teto de R$200 aplicado — meta de faturamento/locações batida, produtos
          vendidos e a trava de abertura/fechamento de caixa (mesmas regras de docs/bonificacao/apuracao_bonificacao.sql).
          Owner/Admin não entra na apuração.
        </HelpText>
        <label style={{ display: "flex", flexDirection: "column", gap: "4px", width: "180px", fontSize: "13px" }}>
          Mês
          <input
            type="month"
            value={mes}
            onChange={(e) => setMes(e.target.value)}
            style={{ padding: "8px 12px", borderRadius: "8px", border: "1px solid var(--border-subtle)", background: "var(--surface-sunken)", color: "var(--text-primary)" }}
          />
        </label>
      </Card>

      {erro && (
        <Card style={{ padding: "12px 16px", marginBottom: "16px", border: "1px solid var(--color-error-text)" }}>
          <span style={{ color: "var(--color-error-text)" }}>{erro}</span>
        </Card>
      )}

      <Card style={{ padding: "8px", overflowX: "auto" }}>
        <table className="report-table">
          <thead>
            <tr>
              <th>Operador</th>
              <th>Unidade</th>
              <th>Dias com bônus</th>
              <th title="Produtos vendidos no mês (leva ao bônus de +R$10 ao bater 10)">Produtos no mês</th>
              <th>Bônus meta</th>
              <th>Bônus produtos</th>
              <th>Acumulado no mês</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.unitId}|${r.employeeId}`}>
                <td>{r.employeeName}</td>
                <td>{r.unitName}</td>
                <td style={{ textAlign: "center" }}>
                  {r.diasComBonus} / {r.diasTrabalhados}
                </td>
                <td style={{ textAlign: "center" }}>{r.itensMes}</td>
                <td style={{ textAlign: "right" }}>{money(r.bonusMetaMesCents)}</td>
                <td style={{ textAlign: "right" }}>{money(r.bonusProdutosMesCents)}</td>
                <td style={{ textAlign: "right", fontWeight: "bold" }}>
                  {money(r.acumuladoMesCents)}
                  {r.atingiuTeto && (
                    <span style={{ marginLeft: "6px", fontSize: "11px", color: "var(--text-muted)" }} title={`Teto de ${money(TETO_MES_CENTS)}/mês atingido`}>
                      🔒 teto
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", color: "var(--text-muted)", padding: "24px" }}>
                  Nenhuma bonificação apurada para o mês selecionado.
                </td>
              </tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={6} style={{ textAlign: "right", fontWeight: "bold" }}>
                  Total geral do mês
                </td>
                <td style={{ textAlign: "right", fontWeight: "bold" }}>{money(totalGeralCents)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </Card>
    </div>
  );
}
