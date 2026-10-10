import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, HelpText, Select } from "@facaamigos/ui";
import { Card } from "../GCard.js";
import { useAppState } from "../../../state/AppState.js";
import { Api } from "../../../api/client.js";
import {
  deltaPoints,
  npsBandColor,
  npsValueColor,
  pct,
  type NpsCommentRow,
  type NpsDashboardData,
} from "../../../lib/nps.js";
import { NpsBandBar, NpsDistributionChart, NpsFunnel, NpsTrendChart } from "../../../components/charts/NpsCharts.js";

/**
 * Dashboard do NPS (Gerencial › Visão Geral & IA). Lê fa_crm_nps_dashboard e
 * fa_crm_nps_comments. Eixo de tempo: data de ENVIO da pesquisa; as pesquisas
 * dos últimos dias ainda podem não ter sido respondidas.
 */
const DAY_MS = 86_400_000;
const PERIODS = [7, 30, 90] as const;
type Band = "PROMOTER" | "PASSIVE" | "DETRACTOR";
const COMMENTS_PAGE = 20;

const fmt1 = (n: number | null) => (n == null ? "—" : n.toFixed(1).replace(".", ","));
const when = (ms: number) => new Date(ms).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const waLink = (phone: string) => `https://wa.me/${phone.replace(/\D/g, "")}`;

function Delta({ value, unit = "", invert = false }: { value: number | null; unit?: string; invert?: boolean }) {
  if (value == null) return <span style={{ fontSize: 12, color: "#94a3b8" }}>sem período anterior</span>;
  if (value === 0) return <span style={{ fontSize: 12, color: "#64748b" }}>= período anterior</span>;
  const good = invert ? value < 0 : value > 0;
  return (
    <span style={{ fontSize: 12, fontWeight: 600, color: good ? "#15803d" : "#b91c1c" }}>
      {value > 0 ? "▲" : "▼"} {Math.abs(value).toString().replace(".", ",")}
      {unit} vs período anterior
    </span>
  );
}

function Kpi({ label, value, color, children }: { label: string; value: string; color?: string; children?: React.ReactNode }) {
  return (
    <Card style={{ padding: 18 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>{label}</span>
        <span style={{ fontSize: 30, fontWeight: 800, color: color ?? "#0f172a", lineHeight: 1.1 }}>{value}</span>
        {children}
      </div>
    </Card>
  );
}

export function NpsDashboardTab() {
  const { units } = useAppState();
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const [unitId, setUnitId] = useState<string>("ALL");
  const [data, setData] = useState<NpsDashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  const [detractors, setDetractors] = useState<NpsCommentRow[]>([]);
  const [band, setBand] = useState<Band | "ALL">("ALL");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [comments, setComments] = useState<NpsCommentRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [commentsLoading, setCommentsLoading] = useState(false);

  // Janela fixa durante a vida de um carregamento (toMs com folga de 1 min).
  const range = useMemo(() => {
    const toMs = Date.now() + 60_000;
    return { fromMs: toMs - days * DAY_MS, toMs };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, reloadKey]);
  const unitFilter = unitId === "ALL" ? null : unitId;

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    Promise.all([
      Api.crmNpsDashboard({ ...range, unitId: unitFilter }),
      Api.crmNpsComments({ ...range, unitId: unitFilter, band: "DETRACTOR", onlyWithComment: false, limit: 10 }),
    ])
      .then(([d, det]) => {
        if (!alive) return;
        setData(d);
        setDetractors(det);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Não foi possível carregar o dashboard."))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [range, unitFilter]);

  const loadComments = useCallback(
    async (offset: number) => {
      setCommentsLoading(true);
      try {
        const rows = await Api.crmNpsComments({
          ...range,
          unitId: unitFilter,
          band: band === "ALL" ? null : band,
          search,
          onlyWithComment: true,
          limit: COMMENTS_PAGE,
          offset,
        });
        setComments((prev) => (offset === 0 ? rows : [...prev, ...rows]));
        setHasMore(rows.length === COMMENTS_PAGE);
      } catch {
        if (offset === 0) setComments([]);
        setHasMore(false);
      } finally {
        setCommentsLoading(false);
      }
    },
    [range, unitFilter, band, search],
  );

  useEffect(() => {
    void loadComments(0);
  }, [loadComments]);

  const s = data?.summary;
  const prev = data?.previous;
  const funnel = s
    ? [
        { label: "Pesquisas enviadas", count: s.sent },
        { label: "Informaram a unidade", count: s.unitAnswered },
        { label: "Deram a nota 0–10", count: s.scored },
        { label: "Avaliaram a equipe", count: s.teamAnswered },
        { label: "Avaliaram o espaço", count: s.spaceAnswered },
        { label: "Deixaram contribuição", count: s.commented },
      ]
    : [];
  const responseRate = s ? pct(s.scored, s.sent) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, padding: "8px 0 32px" }}>
      {/* Filtros */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        <div style={{ display: "flex", gap: 6 }} role="group" aria-label="Período">
          {PERIODS.map((p) => (
            <Button key={p} size="sm" variant={days === p ? "primary" : "secondary"} onClick={() => setDays(p)}>
              {p} dias
            </Button>
          ))}
        </div>
        <div style={{ width: 280, maxWidth: "100%" }}>
          <Select value={unitId} onChange={(e) => setUnitId(e.target.value)} aria-label="Unidade">
            <option value="ALL">Todas as unidades</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setReloadKey((k) => k + 1)} disabled={loading}>
          {loading ? "Atualizando…" : "↻ Atualizar"}
        </Button>
        <HelpText style={{ margin: 0, fontSize: 12 }}>
          Período pela data de envio da pesquisa; as mais recentes ainda podem estar sem resposta.
        </HelpText>
      </div>

      {error && (
        <Card style={{ padding: 16, borderLeft: "4px solid #ef4444" }}>
          <p style={{ margin: 0, color: "#b91c1c" }}>{error}</p>
        </Card>
      )}

      {!error && loading && !data && <HelpText>Carregando o dashboard…</HelpText>}

      {data && s && prev && (
        <>
          {s.sent === 0 ? (
            <Card style={{ padding: 24, textAlign: "center" }}>
              <p style={{ margin: 0, fontWeight: 600 }}>Nenhuma pesquisa enviada neste período.</p>
              <HelpText>As respostas aparecem aqui assim que o NPS for enviado pelo CRM do WhatsApp.</HelpText>
            </Card>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 14 }}>
                <Kpi label="NPS" value={s.nps == null ? "—" : s.nps > 0 ? `+${s.nps}` : String(s.nps)} color={npsValueColor(s.nps)}>
                  <Delta value={deltaPoints(s.nps, prev.nps)} unit=" pts" />
                  <span style={{ fontSize: 12, color: "#64748b" }}>{s.scored} resposta(s) · nota média {fmt1(s.avgScore)}</span>
                </Kpi>
                <Kpi label="Equipe (1–5)" value={fmt1(s.avgTeam)}>
                  <Delta value={deltaPoints(s.avgTeam, prev.avgTeam)} />
                  <span style={{ fontSize: 12, color: "#64748b" }}>{s.teamAnswered} avaliação(ões)</span>
                </Kpi>
                <Kpi label="Espaço (1–5)" value={fmt1(s.avgSpace)}>
                  <Delta value={deltaPoints(s.avgSpace, prev.avgSpace)} />
                  <span style={{ fontSize: 12, color: "#64748b" }}>{s.spaceAnswered} avaliação(ões)</span>
                </Kpi>
                <Kpi label="Taxa de resposta" value={responseRate == null ? "—" : `${responseRate}%`}>
                  <Delta value={deltaPoints(responseRate, pct(prev.scored, prev.sent))} unit=" pts" />
                  <span style={{ fontSize: 12, color: "#64748b" }}>
                    {s.scored} de {s.sent} enviada(s)
                  </span>
                </Kpi>
              </div>

              {s.scored === 0 ? (
                <Card style={{ padding: 20 }}>
                  <HelpText style={{ margin: 0 }}>
                    {s.sent} pesquisa(s) enviada(s), ainda sem respostas neste período.
                  </HelpText>
                </Card>
              ) : (
                <>
                  <NpsBandBar promoters={s.promoters} passives={s.passives} detractors={s.detractors} />
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 14 }}>
                    <NpsTrendChart data={data.trend} bucket={data.bucket} />
                    <NpsFunnel steps={funnel} />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14 }}>
                    <NpsDistributionChart title="Recomendação (0–10)" data={data.distribution.score} bands />
                    <NpsDistributionChart title="Equipe (1–5)" data={data.distribution.team} />
                    <NpsDistributionChart title="Espaço (1–5)" data={data.distribution.space} />
                  </div>
                </>
              )}

              {/* Por unidade */}
              <Card style={{ padding: 18, overflowX: "auto" }}>
                <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 600 }}>Por unidade</h3>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 520 }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: "#64748b", fontSize: 12 }}>
                      <th style={{ padding: "6px 8px" }}>Unidade</th>
                      <th style={{ padding: "6px 8px" }}>Enviadas</th>
                      <th style={{ padding: "6px 8px" }}>Respostas</th>
                      <th style={{ padding: "6px 8px" }}>NPS</th>
                      <th style={{ padding: "6px 8px" }}>Equipe</th>
                      <th style={{ padding: "6px 8px" }}>Espaço</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byUnit.map((u) => (
                      <tr key={u.unit_id ?? "none"} style={{ borderTop: "1px solid #e2e8f0" }}>
                        <td style={{ padding: "8px" }}>{u.name}</td>
                        <td style={{ padding: "8px" }}>{u.sent}</td>
                        <td style={{ padding: "8px" }}>{u.scored}</td>
                        <td style={{ padding: "8px", fontWeight: 700, color: npsValueColor(u.nps) }}>
                          {u.nps == null ? "—" : u.nps > 0 ? `+${u.nps}` : u.nps}
                        </td>
                        <td style={{ padding: "8px" }}>{fmt1(u.avg_team)}</td>
                        <td style={{ padding: "8px" }}>{fmt1(u.avg_space)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </>
          )}
        </>
      )}

      {/* Detratores a tratar */}
      {data && data.summary.sent > 0 && (
        <Card style={{ padding: 18 }}>
          <h3 style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 600 }}>🚨 Detratores a tratar</h3>
          <HelpText style={{ margin: "0 0 12px", fontSize: 12 }}>Notas de 0 a 6 no período, da mais recente para a mais antiga.</HelpText>
          {detractors.length === 0 ? (
            <HelpText style={{ margin: 0 }}>Nenhum detrator no período. 🎉</HelpText>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {detractors.map((r) => (
                <CommentItem key={r.id} row={r} showContact />
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Contribuições */}
      {data && data.summary.sent > 0 && (
        <Card style={{ padding: 18 }}>
          <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 600 }}>💬 Contribuições</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12, alignItems: "center" }}>
            {(["ALL", "PROMOTER", "PASSIVE", "DETRACTOR"] as const).map((b) => (
              <Button key={b} size="sm" variant={band === b ? "primary" : "secondary"} onClick={() => setBand(b)}>
                {b === "ALL" ? "Todas" : b === "PROMOTER" ? "Promotores" : b === "PASSIVE" ? "Neutros" : "Detratores"}
              </Button>
            ))}
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Buscar no texto…"
              aria-label="Buscar nas contribuições"
              style={{ flex: "1 1 200px", minHeight: 36, borderRadius: 8, border: "1px solid #cbd5e1", padding: "0 10px", font: "inherit", fontSize: 14 }}
            />
          </div>
          {comments.length === 0 && !commentsLoading ? (
            <HelpText style={{ margin: 0 }}>Nenhuma contribuição neste filtro.</HelpText>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {comments.map((r) => (
                <CommentItem key={r.id} row={r} />
              ))}
            </div>
          )}
          {hasMore && (
            <div style={{ marginTop: 12 }}>
              <Button size="sm" variant="secondary" disabled={commentsLoading} onClick={() => void loadComments(comments.length)}>
                {commentsLoading ? "Carregando…" : "Carregar mais"}
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function CommentItem({ row, showContact = false }: { row: NpsCommentRow; showContact?: boolean }) {
  return (
    <div style={{ padding: "12px 14px", borderRadius: 10, background: "#f8fafc", border: "1px solid #e2e8f0", display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 12px", fontSize: 13 }}>
        <span style={{ background: npsBandColor(row.score), color: "#fff", fontWeight: 700, borderRadius: 6, padding: "2px 8px" }}>
          {row.score}/10
        </span>
        {row.score_team != null && <span>Equipe <strong>{row.score_team}/5</strong></span>}
        {row.score_space != null && <span>Espaço <strong>{row.score_space}/5</strong></span>}
        <span style={{ color: "#64748b" }}>{row.unit_name ?? "Unidade não informada"}</span>
        <span style={{ color: "#94a3b8", marginLeft: "auto", fontSize: 12 }}>{when(row.scored_at_ms ?? row.sent_at_ms)}</span>
      </div>
      {row.feedback && (
        <div style={{ fontSize: 14, color: "#334155", fontStyle: "italic" }}>“{row.feedback}”</div>
      )}
      {showContact && (row.contact_name || row.contact_phone) && (
        <div style={{ fontSize: 13, color: "#334155" }}>
          {row.contact_name ?? "Responsável"}
          {row.contact_phone && (
            <>
              {" · "}
              <a href={waLink(row.contact_phone)} target="_blank" rel="noreferrer">
                {row.contact_phone} (abrir no WhatsApp)
              </a>
            </>
          )}
        </div>
      )}
    </div>
  );
}
