import { useEffect, useMemo, useState } from "react";
import { HelpText, Select } from "@facaamigos/ui";
import { Card } from "../GCard.js";
import { Api } from "../../../api/client.js";
import type { BirthdayCourtesyRow } from "../../../api/client.js";
import { money } from "../../../format.js";

/**
 * Cortesia de aniversário (Gerencial › Equipe & Clientes). Lê
 * fa_birthday_courtesy_report. O grupo de controle (aniversário em dia
 * terminado em 0/5) não recebe a mensagem; a comparação usa a MESMA janela
 * para os dois grupos: 7 dias antes do aniversário até o fim do mês.
 */
const pad = (n: number) => String(n).padStart(2, "0");
const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const pct = (n: number, d: number) => (d === 0 ? "—" : `${Math.round((n / d) * 100)}%`);
const avg = (n: number, d: number) => (d === 0 ? "—" : (n / d).toFixed(2).replace(".", ","));

/** Mês atual, 5 anteriores e o seguinte (mensagens saem até 7 dias antes). */
function monthOptions(): { value: string; label: string }[] {
  const now = new Date();
  const out: { value: string; label: string }[] = [];
  for (let i = 1; i >= -5; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    out.push({
      value: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`,
      label: d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }),
    });
  }
  return out;
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card style={{ padding: 18 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>{label}</span>
        <span style={{ fontSize: 28, fontWeight: 800, color: "#0f172a", lineHeight: 1.1 }}>{value}</span>
        {hint && <span style={{ fontSize: 12, color: "#64748b" }}>{hint}</span>}
      </div>
    </Card>
  );
}

function CohortSummary({ rows }: { rows: BirthdayCourtesyRow[] }) {
  const withVisit = rows.filter((r) => r.visits_in_window > 0).length;
  const visits = rows.reduce((a, r) => a + r.visits_in_window, 0);
  const paid = rows.reduce((a, r) => a + r.paid_cents_in_window, 0);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 14 }}>
      <span><strong>{rows.length}</strong> crianças</span>
      <span>{pct(withVisit, rows.length)} com ao menos 1 visita na janela</span>
      <span>{avg(visits, rows.length)} visitas por criança</span>
      <span>{rows.length === 0 ? "—" : money(Math.round(paid / rows.length))} pagos por criança</span>
    </div>
  );
}

export function AniversarioCortesiaTab() {
  const months = useMemo(monthOptions, []);
  const [month, setMonth] = useState(months[1]!.value);
  const [rows, setRows] = useState<BirthdayCourtesyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const [y, m] = month.split("-").map(Number) as [number, number];
    const last = new Date(y, m, 0).getDate();
    setLoading(true);
    setError(null);
    Api.birthdayCourtesyReport(`${y}-${pad(m)}-01`, `${y}-${pad(m)}-${pad(last)}`)
      .then((r) => alive && setRows(r))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Não foi possível carregar o relatório."))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [month]);

  const treated = rows.filter((r) => r.cohort === "TRATAMENTO");
  const control = rows.filter((r) => r.cohort === "CONTROLE");
  const used = treated.filter((r) => r.used);
  const overageMin = used.reduce((a, r) => a + r.overage_minutes, 0);
  const overageCents = used.reduce((a, r) => a + r.overage_cents, 0);
  const bought = used.filter((r) => r.bought_after).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "end", gap: 12, flexWrap: "wrap" }}>
        <Select label="Mês de aniversário" value={month} onChange={(e) => setMonth(e.target.value)}>
          {months.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        <HelpText>
          Cortesia de 30 min no Playground, enviada 7 dias antes e válida até o fim do mês de aniversário, de segunda a sexta.
        </HelpText>
      </div>

      {error && <p style={{ color: "var(--color-error-text)", margin: 0, fontWeight: "bold" }}>{error}</p>}
      {loading && <p style={{ color: "var(--text-secondary)" }}>Carregando…</p>}

      {!loading && !error && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
            <Kpi label="Cortesias enviadas" value={String(treated.length)} />
            <Kpi label="Usaram" value={String(used.length)} hint={`${pct(used.length, treated.length)} das enviadas`} />
            <Kpi
              label="Minutos adicionais"
              value={String(overageMin)}
              hint={`${money(overageCents)} cobrados além dos 30 min`}
            />
            <Kpi
              label="Compraram depois"
              value={String(bought)}
              hint={`${pct(bought, used.length)} de quem usou, em até 30 dias`}
            />
          </div>

          <Card style={{ padding: 18 }}>
            <strong style={{ fontSize: 14 }}>Comparação com o grupo de controle</strong>
            <HelpText>
              Janela: 7 dias antes do aniversário até o fim do mês. Grupo de controle = aniversário em dia terminado em 0 ou 5.
              Quem faz anos no fim do mês tem janela mais curta: compare dentro da mesma faixa de dia antes de concluir.
            </HelpText>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, marginTop: 8 }}>
              <div>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>Recebeu a cortesia</span>
                <CohortSummary rows={treated} />
              </div>
              <div>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>Controle</span>
                <CohortSummary rows={control} />
              </div>
            </div>
          </Card>

          <Card style={{ padding: 0, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "#64748b" }}>
                  {["Criança", "Aniversário", "Grupo", "Enviada", "Usou", "Unidade", "Min. adicionais", "Comprou depois", "Visitas na janela", "Pago na janela"].map((h) => (
                    <th key={h} style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.courtesy_id} style={{ borderTop: "1px solid var(--border-subtle)" }}>
                    <td style={{ padding: "8px 10px" }}>{r.child_name ?? "—"}</td>
                    <td style={{ padding: "8px 10px" }}>{dm(r.birthday_date)}</td>
                    <td style={{ padding: "8px 10px" }}>{r.cohort === "TRATAMENTO" ? "Cortesia" : "Controle"}</td>
                    <td style={{ padding: "8px 10px" }}>
                      {r.sent_at_ms ? new Date(r.sent_at_ms).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : "—"}
                    </td>
                    <td style={{ padding: "8px 10px" }}>{r.cohort === "CONTROLE" ? "—" : r.used ? "Sim" : "Não"}</td>
                    <td style={{ padding: "8px 10px" }}>{r.used_unit_name ?? "—"}</td>
                    <td style={{ padding: "8px 10px" }}>{r.used ? r.overage_minutes : "—"}</td>
                    <td style={{ padding: "8px 10px" }}>{r.bought_after == null ? "—" : r.bought_after ? "Sim" : "Não"}</td>
                    <td style={{ padding: "8px 10px" }}>{r.visits_in_window}</td>
                    <td style={{ padding: "8px 10px" }}>{money(r.paid_cents_in_window)}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={10} style={{ padding: 16, color: "var(--text-secondary)" }}>
                      Nenhuma cortesia nem criança do grupo de controle neste mês.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
