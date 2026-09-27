import { useEffect, useMemo, useState } from "react";
import { Button, Card, DateInput, HelpText, Input, Modal, Select, Tag } from "@facaamigos/ui";
import { Api } from "../../../api/client.js";
import type { SalesCompendiumRow, VoiceTranscript } from "../../../api/client.js";
import { RequireCapability } from "../../../auth/RequireCapability.js";
import { useAppState } from "../../../state/AppState.js";
import { useToast } from "../../../state/ToastContext.js";

const PAGE_SIZE = 50;

function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}min ${s % 60}s`;
}

function monthLabel(startMs: number): string {
  return new Date(startMs).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

/** Data de hoje em ISO (AAAA-MM-DD), no fuso do navegador do balcão. */
function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** Desloca uma data ISO em N dias (aceita negativo) — usado para "dia anterior"/"próximo dia". */
function shiftDayIso(iso: string, deltaDays: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y!, m! - 1, d! + deltaDays);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

/** Início/fim (ms, meia-noite a meia-noite no fuso local) do dia calendário informado — para filtrar dia a dia, um por um. */
function dayRangeMs(iso: string): { fromMs: number; toMs: number } {
  const [y, m, d] = iso.split("-").map(Number);
  const fromMs = new Date(y!, m! - 1, d!).getTime();
  const toMs = new Date(y!, m! - 1, d! + 1).getTime();
  return { fromMs, toMs };
}

function dayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });
}

/** Início/fim (ms) do mês corrente e dos 5 anteriores, mais recente primeiro — opções do seletor de período do compêndio sob demanda. */
function lastMonths(count: number): Array<{ startMs: number; endMs: number; label: string }> {
  const now = new Date();
  const out: Array<{ startMs: number; endMs: number; label: string }> = [];
  for (let i = 0; i < count; i++) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 1));
    out.push({ startMs: start.getTime(), endMs: end.getTime(), label: monthLabel(start.getTime()) });
  }
  return out;
}

/**
 * Gerencial > Equipe & Clientes > Atendimentos Gravados — transcrições de
 * check-in/check-out (base de conhecimento de venda adicional) e o
 * Compêndio de Vendas gerado por IA para a Reunião de Alinhamento Mensal.
 * Gated por 'treinamento.transcricoes.read'; o botão de gerar compêndio
 * por 'treinamento.compendio.gerar' (só Owner — ver capabilities.ts).
 */
export function TranscricoesTab() {
  return (
    <RequireCapability capability="treinamento.transcricoes.read">
      <TranscricoesTabContent />
    </RequireCapability>
  );
}

function TranscricoesTabContent() {
  const { units } = useAppState();
  const toast = useToast();

  const [unitFilter, setUnitFilter] = useState<string>(units[0]?.id ?? "");
  const [momentoFilter, setMomentoFilter] = useState<"" | "CHECKIN" | "CHECKOUT">("");
  const [query, setQuery] = useState("");
  // Navegação dia a dia, um por um — em vez de rolar uma lista longa, o
  // gestor caminha pelo calendário e revisa cada dia isoladamente.
  const [dayFilter, setDayFilter] = useState<string>(todayIso());
  const isToday = dayFilter >= todayIso();
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<VoiceTranscript[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<VoiceTranscript | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<{
    sessions: Array<{ id: string; child_name_snapshot: string; status: string }>;
    offers: Array<{ session_id: string; outcome: string | null; offer_title: string | null }>;
  } | null>(null);

  const [compendiums, setCompendiums] = useState<SalesCompendiumRow[]>([]);
  const [loadingCompendium, setLoadingCompendium] = useState(false);
  const [generatingPeriod, setGeneratingPeriod] = useState<number | null>(null);
  const monthOptions = useMemo(() => lastMonths(6), []);
  const [pickedPeriodIdx, setPickedPeriodIdx] = useState(0);
  const [openCompendium, setOpenCompendium] = useState<SalesCompendiumRow | null>(null);

  useEffect(() => {
    if (!unitFilter && units[0]) setUnitFilter(units[0].id);
  }, [units, unitFilter]);

  useEffect(() => {
    setPage(0);
  }, [unitFilter, momentoFilter, query, dayFilter]);

  useEffect(() => {
    if (!unitFilter) return;
    setLoading(true);
    const { fromMs, toMs } = dayRangeMs(dayFilter);
    const handle = setTimeout(() => {
      Api.voiceTranscripts({
        unitId: unitFilter,
        momento: momentoFilter || undefined,
        query: query.trim() || undefined,
        fromMs,
        toMs,
        page,
        pageSize: PAGE_SIZE,
      })
        .then(({ rows: r, count: c }) => {
          setRows(r);
          setCount(c);
        })
        .catch(() => {
          setRows([]);
          setCount(0);
        })
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(handle);
  }, [unitFilter, momentoFilter, query, dayFilter, page]);

  function loadCompendiums() {
    setLoadingCompendium(true);
    Api.salesCompendiums(unitFilter || null)
      .then(setCompendiums)
      .catch(() => setCompendiums([]))
      .finally(() => setLoadingCompendium(false));
  }
  useEffect(loadCompendiums, [unitFilter]);

  function openDetail(row: VoiceTranscript) {
    setSelected(row);
    setSelectedDetail(null);
    Api.voiceTranscriptSessions(row.session_ids ?? [])
      .then(setSelectedDetail)
      .catch(() => setSelectedDetail({ sessions: [], offers: [] }));
  }

  async function generateCompendium() {
    const period = monthOptions[pickedPeriodIdx];
    if (!period) return;
    setGeneratingPeriod(pickedPeriodIdx);
    try {
      await Api.generateSalesCompendium(unitFilter || null, period.startMs, period.endMs);
      toast.success("Compêndio gerado! Já disponível na lista abaixo.");
      loadCompendiums();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível gerar o compêndio.");
    } finally {
      setGeneratingPeriod(null);
    }
  }

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: "12px", marginBottom: "16px" }}>
        <div>
          <h2 style={{ fontFamily: "var(--font-display)", margin: 0, fontSize: "20px" }}>🎙️ Atendimentos Gravados</h2>
          <HelpText style={{ margin: 0 }}>
            Transcrições de check-in e check-out para treinar a equipe de vendas. O áudio nunca fica guardado — só o texto, já sem CPF/telefone.
          </HelpText>
        </div>
        <div style={{ width: "220px" }}>
          <Select label="Unidade" value={unitFilter} onChange={(e) => setUnitFilter(e.target.value)}>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <RequireCapability capability="treinamento.compendio.gerar">
        <Card style={{ padding: "16px", marginBottom: "20px", display: "flex", flexDirection: "column", gap: "10px" }}>
          <h3 style={{ fontFamily: "var(--font-display)", fontSize: "16px", margin: 0 }}>📊 Reunião de Alinhamento Mensal</h3>
          <HelpText style={{ margin: 0 }}>
            A IA interpreta as transcrições do período e monta um resumo (pontos fortes, objeções recorrentes, atenção por operador e plano de
            ação) — gerado automaticamente todo dia 1 para o mês anterior, ou sob demanda aqui para qualquer período.
          </HelpText>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "flex-end" }}>
            <div style={{ width: "220px" }}>
              <Select label="Período" value={String(pickedPeriodIdx)} onChange={(e) => setPickedPeriodIdx(Number(e.target.value))}>
                {monthOptions.map((m, i) => (
                  <option key={i} value={i}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </div>
            <Button variant="primary" onClick={generateCompendium} loading={generatingPeriod === pickedPeriodIdx} disabled={generatingPeriod !== null}>
              Gerar compêndio deste período
            </Button>
          </div>
        </Card>
      </RequireCapability>

      {!loadingCompendium && compendiums.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "20px" }}>
          {compendiums.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setOpenCompendium(c)}
              style={{
                border: "1px solid var(--border-subtle)",
                borderRadius: "10px",
                padding: "10px 14px",
                background: "var(--surface-card)",
                cursor: "pointer",
                textAlign: "left",
                fontSize: "13px",
              }}
            >
              <strong style={{ display: "block", textTransform: "capitalize" }}>{monthLabel(c.period_start_ms)}</strong>
              <span style={{ color: "var(--text-muted)" }}>
                {c.status === "DONE" ? `${c.transcript_count} atendimentos` : c.status === "EMPTY" ? "sem atendimentos" : "falhou"}
              </span>
            </button>
          ))}
        </div>
      )}

      <Card style={{ padding: "12px", marginBottom: "16px", display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ display: "flex", gap: "6px", alignItems: "flex-end" }}>
          <Button variant="ghost" size="sm" onClick={() => setDayFilter((d) => shiftDayIso(d, -1))} title="Dia anterior" aria-label="Dia anterior">
            ← Dia anterior
          </Button>
          <div style={{ width: "170px" }}>
            <DateInput label="Dia" value={dayFilter} onChange={(iso) => iso && setDayFilter(iso)} />
          </div>
          <Button variant="ghost" size="sm" onClick={() => setDayFilter((d) => shiftDayIso(d, 1))} disabled={isToday} title="Próximo dia" aria-label="Próximo dia">
            Próximo dia →
          </Button>
          {!isToday && (
            <Button variant="secondary" size="sm" onClick={() => setDayFilter(todayIso())}>
              Hoje
            </Button>
          )}
        </div>
        <div style={{ width: "180px" }}>
          <Select label="Momento" value={momentoFilter} onChange={(e) => setMomentoFilter(e.target.value as "" | "CHECKIN" | "CHECKOUT")}>
            <option value="">Todos</option>
            <option value="CHECKIN">Check-in</option>
            <option value="CHECKOUT">Check-out</option>
          </Select>
        </div>
        <div style={{ flex: 1, minWidth: "220px" }}>
          <Input label="Buscar na transcrição" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ex.: meia antiderrapante" />
        </div>
      </Card>

      <Card style={{ padding: "8px", overflowX: "auto" }}>
        <div style={{ padding: "8px 8px 0", fontSize: "13px", color: "var(--text-muted)", textTransform: "capitalize" }}>
          {dayLabel(dayFilter)} {isToday && "· hoje"} — {loading ? "carregando…" : `${count} atendimento(s)`}
        </div>
        <table className="report-table">
          <thead>
            <tr>
              <th>Data/hora</th>
              <th>Operador</th>
              <th>Momento</th>
              <th>Duração</th>
              <th>Resultado</th>
              <th>Prévia</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} onClick={() => openDetail(r)} style={{ cursor: "pointer" }}>
                <td>{formatDateTime(r.started_at_ms)}</td>
                <td>{r.fa_kiosk_employees?.full_name ?? "—"}</td>
                <td>
                  <Tag color={r.momento === "CHECKIN" ? "var(--color-teal, #2ECFB5)" : "var(--color-primary)"}>
                    {r.momento === "CHECKIN" ? "Entrada" : "Saída"}
                  </Tag>
                </td>
                <td>{formatDuration(r.duration_ms)}</td>
                <td>{r.outcome === "SUCCESS" ? "✅ Concluído" : r.outcome === "ABANDONED" ? "↩️ Não fechou" : "⏱️ Limite atingido"}</td>
                <td style={{ maxWidth: "360px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.status === "EMPTY" ? <em style={{ color: "var(--text-muted)" }}>Sem fala reconhecida</em> : r.transcript || "—"}
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} style={{ textAlign: "center", padding: "24px", color: "var(--text-muted)" }}>
                  {isToday
                    ? 'Nenhum atendimento gravado ainda. Ligue a gravação em Configurações > Impressoras > "Gravação de atendimentos".'
                    : "Nenhum atendimento gravado neste dia para os filtros escolhidos."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {totalPages > 1 && (
          <div style={{ display: "flex", justifyContent: "center", gap: "8px", padding: "12px" }}>
            <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              ← Anterior
            </Button>
            <span style={{ fontSize: "13px", alignSelf: "center" }}>
              Página {page + 1} de {totalPages}
            </span>
            <Button variant="ghost" size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Próxima →
            </Button>
          </div>
        )}
      </Card>

      <HelpText style={{ marginTop: "12px" }}>
        Dado sensível: mostre esta tela apenas para quem precisa treinar a equipe. Não compartilhe transcrições fora da liderança.
      </HelpText>

      {selected && (
        <Modal title="Transcrição do atendimento" onClose={() => setSelected(null)} maxWidth="640px">
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", fontSize: "13px", color: "var(--text-muted)" }}>
              <span>{formatDateTime(selected.started_at_ms)}</span>
              <span>· {selected.momento === "CHECKIN" ? "Entrada" : "Saída"}</span>
              <span>· {formatDuration(selected.duration_ms)}</span>
              <span>· {selected.fa_kiosk_employees?.full_name ?? "Operador"}</span>
            </div>

            {selectedDetail && selectedDetail.sessions.length > 0 && (
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                {selectedDetail.sessions.map((s) => (
                  <Tag key={s.id}>{s.child_name_snapshot}</Tag>
                ))}
                {selectedDetail.offers.map((o, i) => (
                  <Tag key={i} color={o.outcome === "ACEITA" ? "var(--color-teal, #2ECFB5)" : "var(--border-subtle)"}>
                    {o.offer_title ?? "Oferta"}: {o.outcome ?? "sem retorno"}
                  </Tag>
                ))}
              </div>
            )}

            <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.5, fontSize: "14px", margin: 0 }}>
              {selected.status === "EMPTY" ? "Nenhuma fala reconhecida nesta gravação." : selected.transcript}
            </p>

            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                navigator.clipboard?.writeText(selected.transcript).then(() => toast.success("Texto copiado."));
              }}
              style={{ alignSelf: "flex-start" }}
            >
              Copiar texto
            </Button>
          </div>
        </Modal>
      )}

      {openCompendium && (
        <Modal title={`Compêndio de Vendas — ${monthLabel(openCompendium.period_start_ms)}`} onClose={() => setOpenCompendium(null)} maxWidth="680px">
          {openCompendium.status !== "DONE" || !openCompendium.compendium ? (
            <p>{openCompendium.status === "EMPTY" ? "Nenhum atendimento gravado neste período." : "Falha ao gerar este compêndio."}</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px", fontSize: "14px", lineHeight: 1.5 }}>
              <p style={{ margin: 0 }}>{openCompendium.compendium.resumoExecutivo}</p>

              <section>
                <h4 style={{ margin: "0 0 6px" }}>✅ Pontos fortes</h4>
                <ul style={{ margin: 0, paddingLeft: "20px" }}>
                  {openCompendium.compendium.pontosFortes.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </section>

              <section>
                <h4 style={{ margin: "0 0 6px" }}>⚠️ Objeções recorrentes</h4>
                {openCompendium.compendium.objecoesRecorrentes.map((o, i) => (
                  <div key={i} style={{ marginBottom: "8px" }}>
                    <strong>{o.objecao}</strong> ({o.frequencia}) — <span style={{ color: "var(--text-muted)" }}>{o.sugestaoResposta}</span>
                  </div>
                ))}
              </section>

              <section>
                <h4 style={{ margin: "0 0 6px" }}>💡 Ofertas mais eficazes</h4>
                {openCompendium.compendium.ofertasEficazes.map((o, i) => (
                  <div key={i} style={{ marginBottom: "8px" }}>
                    <strong>{o.oferta}</strong> — <span style={{ color: "var(--text-muted)" }}>{o.porque}</span>
                  </div>
                ))}
              </section>

              <section>
                <h4 style={{ margin: "0 0 6px" }}>👤 Por operador</h4>
                {openCompendium.compendium.porOperador.map((o, i) => (
                  <div key={i} style={{ marginBottom: "8px" }}>
                    <strong>{o.nomeOperador}</strong>
                    <div>👍 {o.destaque}</div>
                    <div>🎯 {o.pontoDeAtencao}</div>
                  </div>
                ))}
              </section>

              <section>
                <h4 style={{ margin: "0 0 6px" }}>📋 Plano de ação para a reunião</h4>
                <ol style={{ margin: 0, paddingLeft: "20px" }}>
                  {openCompendium.compendium.planoAcaoReuniao.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ol>
              </section>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
