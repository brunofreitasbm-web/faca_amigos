import { useEffect, useMemo, useState } from "react";
import { Button, Card, HelpText, Input } from "@facaamigos/ui";
import { Api } from "../../../api/client.js";
import type { Unit } from "../../../api/client.js";
import { useToast } from "../../../state/ToastContext.js";
import { useAuth } from "../../../auth/AuthContext.js";
import { IfCan } from "../../../auth/RequireCapability.js";
import { planRuleKey, type BonusPlanRule } from "../../../lib/apuracaoBonificacao.js";
import { money } from "../../../format.js";

/** Uma linha por plano ou pacote ativo da unidade; valores em reais (texto) enquanto o Owner digita. */
interface Row {
  key: string;
  kind: BonusPlanRule["kind"];
  refId: string;
  label: string;
  /** Preço de tabela, só para o Owner se orientar (não entra no cálculo). */
  priceCents: number;
  active: boolean;
  bonusReais: string;
  escadaMeta: string;
  escadaBonusReais: string;
}

const toCents = (reais: string): number => Math.max(0, Math.round(Number(reais.replace(",", ".")) * 100) || 0);
const toReais = (cents: number): string => (cents / 100).toFixed(2);
const toInt = (v: string): number => Math.max(0, Math.round(Number(v) || 0));

/**
 * Bônus de Planos Longos (2 horas, Day Use, Porto Seguro): bônus fixo por
 * unidade vendida, escada mensal e teto próprio, sem as travas de caixa.
 * Salva em fa_kiosk_bonus_plan_rules / fa_kiosk_bonus_program_config
 * (`Api.setBonusPlanRules`). Regras: docs/bonificacao/programa-planos-longos-out-2026.md.
 */
export function PlanosLongosSection({ unit }: { unit: Unit }) {
  const toast = useToast();
  const { can } = useAuth();
  const activity = unit.kind === "QUIOSQUE" ? "CARRINHO" : "PLAYGROUND";
  const [rows, setRows] = useState<Row[]>([]);
  const [tetoReais, setTetoReais] = useState("0.00");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    setLoading(true);
    setErro(null);
    Promise.all([Api.plans(unit.id, activity, true), Api.packages(unit.id, activity, true), Api.bonusProgramsByUnit([unit.id])])
      .then(([plans, packages, programs]) => {
        if (cancelado) return;
        const program = programs[unit.id];
        const rules = new Map((program?.planRules ?? []).map((r) => [planRuleKey(r.kind, r.refId), r]));
        // Aluguel de pelúcia não é plano de permanência: fica fora da lista.
        const planos = plans.filter((p) => !p.assetKind);
        const linhas: Row[] = [
          ...planos.map((p) => ({ kind: "PLANO" as const, refId: p.id, label: p.name, priceCents: p.valueCents })),
          ...packages.map((p) => ({ kind: "PACOTE" as const, refId: p.id, label: p.name, priceCents: p.priceCents })),
        ].map((base) => {
          const key = planRuleKey(base.kind, base.refId);
          const rule = rules.get(key);
          return {
            key,
            ...base,
            active: rule?.active ?? false,
            bonusReais: toReais(rule?.bonusCents ?? 0),
            escadaMeta: String(rule?.escadaMeta ?? 0),
            escadaBonusReais: toReais(rule?.escadaBonusCents ?? 0),
          };
        });
        setRows(linhas);
        setTetoReais(toReais(program?.planosTetoMesCents ?? 0));
      })
      .catch((err) => {
        if (!cancelado) setErro(err instanceof Error ? err.message : "Não foi possível carregar as regras.");
      })
      .finally(() => {
        if (!cancelado) setLoading(false);
      });
    return () => {
      cancelado = true;
    };
  }, [unit.id, activity]);

  const ativas = useMemo(() => rows.filter((r) => r.active).length, [rows]);

  function update(key: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  async function save() {
    setBusy(true);
    try {
      const rules: BonusPlanRule[] = rows.map((r, i) => ({
        kind: r.kind,
        refId: r.refId,
        label: r.label,
        bonusCents: toCents(r.bonusReais),
        escadaMeta: toInt(r.escadaMeta),
        escadaBonusCents: toCents(r.escadaBonusReais),
        active: r.active,
        sortOrder: i + 1,
      }));
      await Api.setBonusPlanRules(unit.id, rules, toCents(tetoReais));
      toast.success(`Bônus de Planos Longos de ${unit.name} salvo.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar o Bônus de Planos Longos.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ padding: "16px", marginTop: "16px" }}>
      <h2 style={{ fontFamily: "var(--font-display)", fontSize: "18px", margin: "0 0 8px" }}>📦 Bônus de Planos Longos — {unit.name}</h2>
      <HelpText style={{ marginBottom: "12px" }}>
        Bônus fixo por unidade vendida (por criança), não por valor. A escada paga um prêmio único ao bater N unidades no mês.
        O teto é separado do teto de metas e produtos, e este bônus não depende das travas de caixa. Zero no teto = sem teto.
      </HelpText>

      {erro && <div style={{ color: "var(--color-error-text)", marginBottom: "12px" }}>{erro}</div>}
      {loading && <div style={{ color: "var(--text-muted)" }}>Carregando…</div>}

      {!loading && rows.length === 0 && !erro && (
        <div style={{ color: "var(--text-muted)" }}>Esta unidade não tem plano ou pacote ativo para configurar.</div>
      )}

      {rows.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table className="report-table">
            <thead>
              <tr>
                <th>Conta</th>
                <th>Plano / pacote</th>
                <th>Preço</th>
                <th>Bônus por unidade (R$)</th>
                <th>Escada (unid. no mês)</th>
                <th>Prêmio da escada (R$)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} style={{ opacity: r.active ? 1 : 0.6 }}>
                  <td style={{ textAlign: "center" }}>
                    <input
                      type="checkbox"
                      checked={r.active}
                      aria-label={`Conta para o bônus: ${r.label}`}
                      onChange={(e) => update(r.key, { active: e.target.checked })}
                    />
                  </td>
                  <td>
                    {r.label}{" "}
                    <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>{r.kind === "PACOTE" ? "pacote" : "plano"}</span>
                  </td>
                  <td style={{ textAlign: "right" }}>{money(r.priceCents)}</td>
                  <td>
                    <Input
                      type="number"
                      value={r.bonusReais}
                      disabled={!r.active}
                      onChange={(e) => update(r.key, { bonusReais: e.target.value })}
                    />
                  </td>
                  <td>
                    <Input
                      type="number"
                      value={r.escadaMeta}
                      disabled={!r.active}
                      onChange={(e) => update(r.key, { escadaMeta: e.target.value })}
                    />
                  </td>
                  <td>
                    <Input
                      type="number"
                      value={r.escadaBonusReais}
                      disabled={!r.active}
                      onChange={(e) => update(r.key, { escadaBonusReais: e.target.value })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div style={{ display: "flex", gap: "16px", alignItems: "flex-end", flexWrap: "wrap", marginTop: "16px" }}>
          <div style={{ width: "260px" }}>
            <Input
              type="number"
              label="Teto do mês por operador (R$) — 0 = sem teto"
              value={tetoReais}
              onChange={(e) => setTetoReais(e.target.value)}
            />
          </div>
          <IfCan capability="config.write">
            <Button variant="primary" disabled={busy} onClick={save}>
              {busy ? "Salvando..." : "Salvar Bônus de Planos Longos"}
            </Button>
          </IfCan>
          {!can("config.write") && (
            <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>
              {ativas} regra(s) ativa(s). Só quem edita configurações pode alterar.
            </span>
          )}
        </div>
      )}
    </Card>
  );
}
