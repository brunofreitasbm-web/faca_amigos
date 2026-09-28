import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, HelpText, Input, Tag } from "@facaamigos/ui";
import { formatPhoneBr } from "@facaamigos/domain";
import { Api } from "../../../api/client.js";
import type { CrmContact, CrmMessage, CrmStage, CrmTemplate } from "../../../api/client.js";
import { RequireCapability } from "../../../auth/RequireCapability.js";
import { useAuth } from "../../../auth/AuthContext.js";
import { useToast } from "../../../state/ToastContext.js";
import { useConfirm } from "../../../state/ConfirmContext.js";

const POLL_MS = 10_000;
/** Mesma janela aplicada no servidor (crm-whatsapp-send); aqui só desabilita o botão. */
const WINDOW_MS = 24 * 60 * 60 * 1000;

const STAGES: { value: CrmStage; label: string }[] = [
  { value: "NOVO", label: "Novo" },
  { value: "EM_CONVERSA", label: "Em conversa" },
  { value: "INTERESSADO", label: "Interessado" },
  { value: "CLIENTE", label: "Cliente" },
  { value: "INATIVO", label: "Inativo" },
];

const STATUS_ICON: Record<CrmMessage["status"], string> = {
  received: "",
  queued: "🕓",
  sent: "✓",
  delivered: "✓✓",
  read: "✓✓",
  failed: "⚠️",
  undelivered: "⚠️",
};

function timeLabel(ms: number): string {
  const d = new Date(ms);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function contactTitle(c: CrmContact): string {
  return c.name || formatPhoneBr(c.phone_e164.replace(/^\+55/, "")) || c.phone_e164;
}

/**
 * Gerencial > Equipe & Clientes > CRM WhatsApp.
 *
 * Caixa de entrada + funil do WhatsApp do Playground e do Circuito. Todo
 * dado entra pela Edge Function crm-whatsapp-webhook (Twilio) e sai por
 * crm-whatsapp-send; esta tela só lê e edita a ficha do contato. Atualiza
 * por polling (mesmo padrão de TerminaisVozTab) — o realtime já está
 * publicado na migration caso se queira trocar depois.
 */
export function CrmWhatsappTab() {
  return (
    <RequireCapability capability="crm.read">
      <CrmContent />
    </RequireCapability>
  );
}

function CrmContent() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const canWrite = can("crm.write");

  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [templates, setTemplates] = useState<CrmTemplate[]>([]);
  const [messages, setMessages] = useState<CrmMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<CrmStage | "TODOS">("TODOS");
  const [draft, setDraft] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [notes, setNotes] = useState("");
  const threadEnd = useRef<HTMLDivElement>(null);

  const selected = useMemo(() => contacts.find((c) => c.id === selectedId) ?? null, [contacts, selectedId]);

  const loadContacts = useCallback(async () => {
    try {
      setContacts(await Api.crmContacts());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao carregar contatos");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadContacts();
    Api.crmTemplates().then(setTemplates).catch(() => setTemplates([]));
    const t = setInterval(() => void loadContacts(), POLL_MS);
    return () => clearInterval(t);
  }, [loadContacts]);

  // Conversa aberta: carrega ao selecionar e reatualiza no mesmo ritmo.
  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    const load = () => Api.crmMessages(selectedId).then((m) => active && setMessages(m)).catch(() => undefined);
    void load();
    const t = setInterval(load, POLL_MS);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [selectedId]);

  useEffect(() => {
    threadEnd.current?.scrollIntoView({ block: "end" });
  }, [messages.length, selectedId]);

  useEffect(() => {
    setNotes(selected?.notes ?? "");
    setDraft("");
    setTemplateId("");
    setVariables({});
    // Só ao trocar de contato — não ao chegar mensagem nova (apagaria o rascunho).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  function open(c: CrmContact) {
    setSelectedId(c.id);
    if (c.unread_count > 0) {
      Api.crmMarkRead(c.id).then(() => setContacts((prev) => prev.map((x) => (x.id === c.id ? { ...x, unread_count: 0 } : x)))).catch(() => undefined);
    }
  }

  const filtered = contacts.filter((c) => {
    if (stageFilter !== "TODOS" && c.stage !== stageFilter) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (c.name ?? "").toLowerCase().includes(q) || c.phone_e164.includes(q.replace(/\D/g, "") || "\u0000");
  });

  const unreadTotal = contacts.reduce((n, c) => n + c.unread_count, 0);
  const windowOpen = selected?.last_inbound_ms != null && Date.now() - selected.last_inbound_ms < WINDOW_MS;
  const template = templates.find((t) => t.id === templateId) ?? null;

  async function patchContact(patch: Parameters<typeof Api.crmUpdateContact>[1]) {
    if (!selected) return;
    try {
      await Api.crmUpdateContact(selected.id, patch);
      setContacts((prev) => prev.map((c) => (c.id === selected.id ? { ...c, ...patch } : c)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar");
    }
  }

  async function sendNps(ids: string[], scope: string) {
    if (ids.length === 0) return;
    const ok = await confirm({
      title: "Enviar pesquisa de NPS?",
      message: `${scope} receberá(ão) a pergunta de 0 a 10 pelo WhatsApp (${ids.length} contato${ids.length > 1 ? "s" : ""}). Quem já recebeu nos últimos 30 dias ou pediu para não receber é pulado automaticamente.`,
      confirmLabel: "Enviar NPS",
    });
    if (!ok) return;
    setSending(true);
    try {
      const r = await Api.crmSendNps(ids.slice(0, 100));
      toast.success(
        `NPS enviado a ${r.sent}` +
          (r.skippedRecent ? ` · ${r.skippedRecent} já pesquisado(s) há menos de 30 dias` : "") +
          (r.skippedOptOut ? ` · ${r.skippedOptOut} sem opt-in` : "") +
          (r.failed ? ` · ${r.failed} falha(s)` : ""),
      );
      void loadContacts();
      if (selectedId) setMessages(await Api.crmMessages(selectedId));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao enviar NPS");
    } finally {
      setSending(false);
    }
  }

  async function send() {
    if (!selected || sending) return;
    setSending(true);
    try {
      if (template) {
        await Api.crmSend({ contactId: selected.id, templateId: template.id, variables });
      } else {
        await Api.crmSend({ contactId: selected.id, body: draft });
      }
      setDraft("");
      setTemplateId("");
      setVariables({});
      setMessages(await Api.crmMessages(selected.id));
      void loadContacts();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao enviar");
    } finally {
      setSending(false);
    }
  }

  const canSend = canWrite && !!selected && selected.opt_in && (template ? true : windowOpen && draft.trim().length > 0);

  return (
    <div>
      <div style={{ marginBottom: "16px" }}>
        <h2 style={{ fontFamily: "var(--font-display)", margin: 0, fontSize: "20px" }}>💬 CRM WhatsApp</h2>
        <HelpText style={{ margin: 0 }}>
          Conversas do Playground e do Circuito. {loading ? "carregando…" : `${contacts.length} contato(s) · ${unreadTotal} não lida(s)`}
        </HelpText>
      </div>

      {/* Funil: contagem por etapa, também serve de filtro */}
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "12px" }}>
        <Button size="sm" variant={stageFilter === "TODOS" ? "primary" : "secondary"} onClick={() => setStageFilter("TODOS")}>
          Todos ({contacts.length})
        </Button>
        {STAGES.map((s) => (
          <Button key={s.value} size="sm" variant={stageFilter === s.value ? "primary" : "secondary"} onClick={() => setStageFilter(s.value)}>
            {s.label} ({contacts.filter((c) => c.stage === s.value).length})
          </Button>
        ))}
      </div>

      {canWrite && filtered.length > 0 && (
        <div style={{ marginBottom: "12px" }}>
          <Button size="sm" variant="secondary" disabled={sending} onClick={() => void sendNps(filtered.slice(0, 100).map((c) => c.id), "Os contatos filtrados")}>
            ⭐ Enviar NPS aos {Math.min(filtered.length, 100)} contato(s) listado(s)
          </Button>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 340px) 1fr", gap: "12px", alignItems: "start" }}>
        {/* Lista */}
        <Card style={{ padding: "8px", maxHeight: "70vh", overflowY: "auto" }}>
          <Input placeholder="Buscar nome ou telefone" value={search} onChange={(e) => setSearch(e.target.value)} />
          {!loading && filtered.length === 0 && (
            <HelpText style={{ padding: "16px 8px" }}>
              {contacts.length === 0
                ? "Nenhuma conversa ainda. Quando um cliente escrever para o número do WhatsApp, ela aparece aqui."
                : "Nenhum contato neste filtro."}
            </HelpText>
          )}
          {filtered.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => open(c)}
              aria-current={c.id === selectedId}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "10px 8px",
                border: 0,
                borderBottom: "1px solid var(--border-subtle)",
                background: c.id === selectedId ? "var(--surface-alt, rgba(0,0,0,0.05))" : "transparent",
                cursor: "pointer",
                color: "inherit",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
                <strong style={{ fontSize: "14px" }}>{contactTitle(c)}</strong>
                <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>{c.last_message_ms ? timeLabel(c.last_message_ms) : ""}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", marginTop: "2px" }}>
                <span style={{ fontSize: "13px", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {c.last_message_preview ?? "—"}
                </span>
                {c.unread_count > 0 && <Tag color="var(--color-success)">{c.unread_count}</Tag>}
              </div>
              <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                {c.fa_crm_channels?.label} · {STAGES.find((s) => s.value === c.stage)?.label}
                {!c.opt_in && " · 🚫 não receber"}
              </div>
            </button>
          ))}
        </Card>

        {/* Conversa */}
        <Card style={{ padding: "12px", minHeight: "50vh" }}>
          {!selected ? (
            <HelpText>Selecione uma conversa à esquerda.</HelpText>
          ) : (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", marginBottom: "8px" }}>
                <div>
                  <strong style={{ fontSize: "16px" }}>{contactTitle(selected)}</strong>
                  <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                    {selected.phone_e164} · {selected.fa_crm_channels?.label}
                    {selected.guardian_id && " · cadastro no kiosk"}
                  </div>
                </div>
                {canWrite && (
                  <Button size="sm" variant="secondary" disabled={sending || !selected.opt_in} onClick={() => void sendNps([selected.id], contactTitle(selected))}>
                    ⭐ Enviar NPS
                  </Button>
                )}
                <select
                  aria-label="Etapa do funil"
                  value={selected.stage}
                  disabled={!canWrite}
                  onChange={(e) => void patchContact({ stage: e.target.value as CrmStage })}
                  style={{ height: "36px", borderRadius: "8px", padding: "0 8px" }}
                >
                  {STAGES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ maxHeight: "40vh", overflowY: "auto", padding: "8px", background: "var(--surface-alt, rgba(0,0,0,0.03))", borderRadius: "8px" }}>
                {messages.map((m) => (
                  <div key={m.id} style={{ display: "flex", justifyContent: m.direction === "OUT" ? "flex-end" : "flex-start", marginBottom: "6px" }}>
                    <div
                      style={{
                        maxWidth: "75%",
                        padding: "8px 12px",
                        borderRadius: "12px",
                        background: m.direction === "OUT" ? "var(--color-teal, #2ECFB5)" : "var(--surface, #fff)",
                        color: m.direction === "OUT" ? "#0b2b26" : "inherit",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        fontSize: "14px",
                      }}
                    >
                      {m.body}
                      {m.media.length > 0 && <div style={{ fontSize: "12px", opacity: 0.7 }}>📎 {m.media.length} anexo(s) — abrir no WhatsApp</div>}
                      <div style={{ fontSize: "11px", opacity: 0.65, textAlign: "right" }}>
                        {timeLabel(m.created_at_ms)} {m.direction === "OUT" && (m.status === "read" ? <span style={{ color: "#1a73e8" }}>{STATUS_ICON[m.status]}</span> : STATUS_ICON[m.status])}
                        {m.error && <span title={m.error}> {m.error}</span>}
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={threadEnd} />
              </div>

              {canWrite && (
                <div style={{ marginTop: "10px" }}>
                  {!selected.opt_in ? (
                    <HelpText>🚫 Este cliente pediu para não receber mensagens. O envio está bloqueado.</HelpText>
                  ) : (
                    <>
                      {!windowOpen && (
                        <HelpText>
                          ⏳ Fora da janela de 24h do WhatsApp: só é possível enviar um template aprovado.
                          {templates.length === 0 && " Nenhum template cadastrado ainda."}
                        </HelpText>
                      )}
                      {templates.length > 0 && (
                        <select
                          aria-label="Template"
                          value={templateId}
                          onChange={(e) => {
                            setTemplateId(e.target.value);
                            setVariables({});
                          }}
                          style={{ height: "36px", borderRadius: "8px", padding: "0 8px", marginBottom: "6px", maxWidth: "100%" }}
                        >
                          <option value="">Mensagem livre</option>
                          {templates.map((t) => (
                            <option key={t.id} value={t.id}>
                              Template: {t.name}
                            </option>
                          ))}
                        </select>
                      )}
                      {template ? (
                        <div>
                          <HelpText>{template.preview}</HelpText>
                          {Array.from({ length: template.variable_count }, (_, i) => String(i + 1)).map((n) => (
                            <Input
                              key={n}
                              placeholder={`Variável {{${n}}}`}
                              value={variables[n] ?? ""}
                              onChange={(e) => setVariables((v) => ({ ...v, [n]: e.target.value }))}
                            />
                          ))}
                        </div>
                      ) : (
                        <textarea
                          aria-label="Mensagem"
                          rows={3}
                          maxLength={1600}
                          disabled={!windowOpen}
                          placeholder={windowOpen ? "Escreva sua resposta…" : "Janela de 24h fechada"}
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          style={{ width: "100%", borderRadius: "8px", padding: "8px", font: "inherit", resize: "vertical" }}
                        />
                      )}
                      <div style={{ marginTop: "6px" }}>
                        <Button variant="teal" loading={sending} disabled={!canSend} onClick={() => void send()}>
                          Enviar
                        </Button>
                      </div>
                    </>
                  )}

                  <div style={{ marginTop: "14px" }}>
                    <label style={{ fontSize: "12px", color: "var(--text-muted)" }} htmlFor="crm-notes">
                      Notas internas (o cliente não vê)
                    </label>
                    <textarea
                      id="crm-notes"
                      rows={2}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      onBlur={() => notes !== (selected.notes ?? "") && void patchContact({ notes })}
                      style={{ width: "100%", borderRadius: "8px", padding: "8px", font: "inherit", resize: "vertical" }}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
