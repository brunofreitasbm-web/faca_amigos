import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Checkbox, HelpText, Input, Tag } from "@facaamigos/ui";
import { Card } from "../GCard.js";
import { formatPhoneBr } from "@facaamigos/domain";
import { Api } from "../../../api/client.js";
import type { CrmContact, CrmMessage, CrmStage, CrmTemplate, UnitSettingKey } from "../../../api/client.js";
import { RequireCapability } from "../../../auth/RequireCapability.js";
import { useAuth } from "../../../auth/AuthContext.js";
import { useToast } from "../../../state/ToastContext.js";
import { useConfirm } from "../../../state/ConfirmContext.js";
import { supabase } from "../../../lib/supabase/client.js";

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

interface OptinStats {
  status: "PAUSED" | "RUNNING";
  dailyCap: number;
  dailyTarget: number | null;
  deadlineDays: number;
  deadlineDay: number | null;
  pausedReason: string | null;
  sentToday: number;
  sent: number;
  accepted: number;
  declined: number;
  pending: number;
  withConsent: number;
}

/**
 * Campanha de opt-in da base atual (só Owner, crm.admin): um pedido de
 * autorização por responsável, das 8h às 20h, com meta diária em rampa (30 no
 * 1º dia, sobe enquanto pouca gente pede PARAR, teto `dailyCap`) para fechar a
 * fila em `deadlineDays` dias. Nasce pausada; pausa sozinha se >3% pedirem
 * PARAR. Ver migrations fa_crm_optin_campaign e fa_crm_optin_pacing e a Edge
 * Function crm-optin-dispatch.
 */
function OptinCampaignCard() {
  const toast = useToast();
  const confirm = useConfirm();
  const [stats, setStats] = useState<OptinStats | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase().rpc("fa_crm_optin_stats");
    if (!error) setStats(data as OptinStats);
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  async function setStatus(next: "RUNNING" | "PAUSED") {
    if (next === "RUNNING") {
      const ok = await confirm({
        title: "Iniciar a campanha de autorização?",
        message: `Serão enviadas mensagens pelo WhatsApp a responsáveis que ainda não autorizaram contato, dos que visitaram mais recentemente, das 8h às 20h. Começa com 30 por dia e acelera (até ${stats?.dailyCap ?? 150}) enquanto pouca gente pede PARAR, para terminar a fila em ${stats?.deadlineDays ?? 15} dias. Pausa sozinha se muita gente pedir PARAR.`,
        confirmLabel: "Iniciar",
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const { error } = await supabase().rpc("fa_crm_optin_set_status", { p_status: next });
      if (error) throw new Error(error.message);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao alterar a campanha");
    } finally {
      setBusy(false);
    }
  }

  if (!stats) return null;
  const running = stats.status === "RUNNING";
  return (
    <Card style={{ padding: "12px", marginBottom: "12px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
        <div>
          <strong>🤝 Campanha de autorização (base atual)</strong>{" "}
          <Tag color={running ? "var(--color-success)" : "var(--border-subtle)"}>{running ? "Em andamento" : "Pausada"}</Tag>
          <HelpText style={{ margin: 0 }}>
            Hoje: {stats.sentToday}/{stats.dailyTarget ?? "—"}
            {stats.deadlineDay != null && ` · dia ${stats.deadlineDay} de ${stats.deadlineDays}`} · enviados {stats.sent} · aceitaram{" "}
            {stats.accepted} · pediram PARAR {stats.declined} · na fila {stats.pending} · com autorização {stats.withConsent}
          </HelpText>
          {stats.pausedReason && !running && <HelpText style={{ margin: 0, color: "var(--color-error)" }}>⚠️ {stats.pausedReason}</HelpText>}
        </div>
        <Button size="sm" variant={running ? "secondary" : "primary"} loading={busy} onClick={() => void setStatus(running ? "PAUSED" : "RUNNING")}>
          {running ? "Pausar" : "Iniciar"}
        </Button>
      </div>
    </Card>
  );
}

/**
 * Campanha de opt-in de MARKETING (só Owner, crm.admin): pergunta separada da
 * autorização geral, só para quem já autorizou contato — alimenta
 * fa_kiosk_guardians.marketing_consent_at_ms, exigido pelas ações de
 * upsell/cross-sell/aniversário/VIP/winback do catálogo. Mesmo desenho da
 * campanha geral: nasce pausada, máx. 20/dia, freio automático.
 */
function MarketingOptinCampaignCard() {
  const toast = useToast();
  const confirm = useConfirm();
  const [stats, setStats] = useState<OptinStats | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase().rpc("fa_crm_marketing_optin_stats");
    if (!error) setStats(data as OptinStats);
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  async function setStatus(next: "RUNNING" | "PAUSED") {
    if (next === "RUNNING") {
      const ok = await confirm({
        title: "Iniciar a campanha de opt-in de marketing?",
        message: `Serão enviadas mensagens pelo WhatsApp a quem já autorizou contato, perguntando se aceita receber ofertas: no máximo ${stats?.dailyCap ?? 20} por dia, das 10h às 20h. Pausa sozinha se muita gente pedir PARAR.`,
        confirmLabel: "Iniciar",
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const { error } = await supabase().rpc("fa_crm_marketing_optin_set_status", { p_status: next });
      if (error) throw new Error(error.message);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao alterar a campanha");
    } finally {
      setBusy(false);
    }
  }

  if (!stats) return null;
  const running = stats.status === "RUNNING";
  return (
    <Card style={{ padding: "12px", marginBottom: "12px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
        <div>
          <strong>🛍️ Campanha de opt-in de marketing</strong>{" "}
          <Tag color={running ? "var(--color-success)" : "var(--border-subtle)"}>{running ? "Em andamento" : "Pausada"}</Tag>
          <HelpText style={{ margin: 0 }}>
            Hoje: {stats.sentToday}/{stats.dailyCap} · enviados {stats.sent} · aceitaram {stats.accepted} · pediram PARAR {stats.declined} · na fila{" "}
            {stats.pending} · com consentimento de marketing {stats.withConsent}
          </HelpText>
          {stats.pausedReason && !running && <HelpText style={{ margin: 0, color: "var(--color-error)" }}>⚠️ {stats.pausedReason}</HelpText>}
        </div>
        <Button size="sm" variant={running ? "secondary" : "primary"} loading={busy} onClick={() => void setStatus(running ? "PAUSED" : "RUNNING")}>
          {running ? "Pausar" : "Iniciar"}
        </Button>
      </div>
    </Card>
  );
}

interface LifecycleStatRow {
  kind: string;
  sent: number;
  replied: number;
  converted: number;
  converted_cents: number;
}

interface LifecycleKindDef {
  kind: string;
  settingKey: UnitSettingKey;
  label: string;
  category: "Utility" | "Marketing";
}

/**
 * As 10 ações do catálogo de upsell/cross-sell/LTV/retenção (12 kinds, winback
 * tem 2 toques). Cada uma só dispara de verdade quando: (1) o template
 * aprovado existir no Twilio para o purpose, e (2) para as de categoria
 * Marketing, o responsável tiver marketing_consent_at_ms (campanha de opt-in
 * de marketing acima). O toggle aqui liga/desliga em todas as unidades juntas
 * — mais simples que gerenciar unidade por unidade e como a Meta cobra por
 * categoria, não por unidade.
 */
const LIFECYCLE_KINDS: LifecycleKindDef[] = [
  { kind: "EXPIRACAO", settingKey: "crm_lc_expiracao", label: "Recarga antes de acabar (pacote/saldo/banco de horas)", category: "Utility" },
  { kind: "RELATORIO_CUPOM", settingKey: "crm_lc_relatorio_cupom", label: "Cupom de retorno no relatório de sessão", category: "Utility" },
  { kind: "PREMIO_FIDELIDADE", settingKey: "crm_lc_premio_fidelidade", label: "Lembrete de prêmio de fidelidade não resgatado", category: "Utility" },
  { kind: "NPS_PROMOTOR", settingKey: "crm_lc_nps_promotor", label: "NPS nota alta → convite de avaliação no Google", category: "Utility" },
  { kind: "NPS_DETRATOR", settingKey: "crm_lc_nps_detrator", label: "NPS nota baixa → aviso de contato humano", category: "Utility" },
  { kind: "UPSELL_PACOTE", settingKey: "crm_lc_upsell_pacote", label: "Oferta de pacote pós-visita avulsa", category: "Marketing" },
  { kind: "DEGRAU_2H", settingKey: "crm_lc_degrau_2h", label: "Oferta do plano de 2 horas (após plano curto com excedente/renovação)", category: "Marketing" },
  { kind: "DEGRAU_PORTO", settingKey: "crm_lc_degrau_porto", label: "Oferta Porto Seguro (3+ visitas em 30 dias)", category: "Marketing" },
  { kind: "DEGRAU_DAYUSE", settingKey: "crm_lc_degrau_dayuse", label: "Oferta Day Use (quintas, 2+ visitas em 60 dias)", category: "Marketing" },
  { kind: "CROSS_ATIVIDADE", settingKey: "crm_lc_cross_atividade", label: "Convite Playground ↔ Circuito", category: "Marketing" },
  { kind: "CROSS_IRMAO", settingKey: "crm_lc_cross_irmao", label: "Convite para o irmão que não frequenta", category: "Marketing" },
  { kind: "ANIVERSARIO", settingKey: "crm_lc_aniversario", label: "Mensagem de aniversário automática", category: "Marketing" },
  { kind: "VIP", settingKey: "crm_lc_vip", label: "Reconhecimento de status VIP", category: "Marketing" },
  { kind: "WINBACK_1", settingKey: "crm_lc_winback_1", label: "Winback — 1º toque (30-90 dias sem visitar)", category: "Marketing" },
  { kind: "WINBACK_2", settingKey: "crm_lc_winback_2", label: "Winback — 2º toque (com cupom)", category: "Marketing" },
];

function LifecycleCampaignsCard() {
  const toast = useToast();
  const [units, setUnits] = useState<{ id: string }[]>([]);
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [stats, setStats] = useState<Record<string, LifecycleStatRow>>({});
  const [busyKind, setBusyKind] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [unitList, statRows] = await Promise.all([
        Api.units(),
        supabase().rpc("fa_crm_automation_stats", { p_days: 30 }),
      ]);
      setUnits(unitList);
      const statsByKind: Record<string, LifecycleStatRow> = {};
      for (const row of (statRows.data ?? []) as LifecycleStatRow[]) statsByKind[row.kind] = row;
      setStats(statsByKind);

      if (unitList.length) {
        const flagEntries = await Promise.all(
          LIFECYCLE_KINDS.map(async (def) => {
            const row = await Api.unitSetting(unitList[0]!.id, def.settingKey);
            return [def.kind, row.value === "1"] as const;
          }),
        );
        setFlags(Object.fromEntries(flagEntries));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao carregar automações");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(def: LifecycleKindDef, next: boolean) {
    setBusyKind(def.kind);
    try {
      // Liga/desliga em todas as unidades juntas.
      await Promise.all(units.map((u) => Api.setUnitSetting(u.id, def.settingKey, next ? "1" : "0")));
      setFlags((prev) => ({ ...prev, [def.kind]: next }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao alterar a automação");
    } finally {
      setBusyKind(null);
    }
  }

  if (loading) return null;
  return (
    <Card style={{ padding: "12px", marginBottom: "12px" }}>
      <details>
      <summary style={{ cursor: "pointer" }}><strong>🚀 Automações de ciclo de vida (upsell, cross-sell, LTV, retenção)</strong></summary>
      <HelpText style={{ margin: "4px 0 12px" }}>
        Últimos 30 dias. Cada uma só envia quando o template correspondente estiver aprovado no Twilio; as de categoria Marketing também exigem o
        aceite de ofertas do responsável (campanha de opt-in de marketing acima).
      </HelpText>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {LIFECYCLE_KINDS.map((def) => {
          const s = stats[def.kind];
          return (
            <div
              key={def.kind}
              style={{
                display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap",
                padding: "6px 0", borderBottom: "1px solid var(--border-subtle)",
              }}
            >
              <div style={{ minWidth: "260px" }}>
                <Checkbox
                  checked={Boolean(flags[def.kind])}
                  onChange={(v) => void toggle(def, v)}
                  label={def.label}
                  disabled={busyKind === def.kind}
                />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <Tag color="var(--border-subtle)">{def.category}</Tag>
                <HelpText style={{ margin: 0 }}>
                  {s ? `enviados ${s.sent} · responderam ${s.replied} · converteram ${s.converted} (R$ ${(s.converted_cents / 100).toFixed(2)})` : "sem envios ainda"}
                </HelpText>
              </div>
            </div>
          );
        })}
      </div>
      </details>
    </Card>
  );
}

interface CostStatRow {
  category: string;
  period: "current" | "previous";
  sent: number;
  delivered: number;
  read_count: number;
  failed: number;
  priced: number;
  price_total: number;
  price_unit: string | null;
}

const COST_CATEGORY_LABEL: Record<string, string> = {
  UTILITY: "Utilidade",
  MARKETING: "Marketing",
  AUTHENTICATION: "Autenticação",
  SERVICE: "Conversa (janela 24h)",
  DESCONHECIDA: "Sem categoria",
};

const COST_DAYS = 30;

/**
 * Entrega e custo do WhatsApp por categoria de template (só Owner, crm.admin).
 * O preço é o informado pela Twilio por mensagem (preenchido horas depois da
 * entrega por crm-whatsapp-cost-sync); cada linha traz o comparativo com os
 * {COST_DAYS} dias anteriores.
 */
function WhatsappCostCard() {
  const [rows, setRows] = useState<CostStatRow[] | null>(null);

  useEffect(() => {
    void supabase()
      .rpc("fa_crm_whatsapp_cost_stats", { p_days: COST_DAYS })
      .then(({ data, error }) => {
        if (!error) setRows(((data ?? []) as CostStatRow[]).map((r) => ({ ...r, price_total: Number(r.price_total) })));
      });
  }, []);

  if (!rows) return null;
  const categories = [...new Set(rows.map((r) => r.category))].sort();
  const pick = (cat: string, period: "current" | "previous") => rows.find((r) => r.category === cat && r.period === period);
  const unit = rows.find((r) => r.price_unit)?.price_unit ?? "USD";
  const money = (v: number) => `${unit} ${v.toFixed(2)}`;
  const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");
  const delta = (cur: number, prev: number) => (prev > 0 ? `${cur >= prev ? "+" : ""}${Math.round(((cur - prev) / prev) * 100)}% vs ${COST_DAYS}d anteriores` : "sem período anterior");

  return (
    <Card style={{ padding: "12px", marginBottom: "12px" }}>
      <strong>💸 Custo e entrega do WhatsApp (últimos {COST_DAYS} dias)</strong>
      {categories.length === 0 ? (
        <HelpText style={{ margin: 0 }}>Nenhum envio no período.</HelpText>
      ) : (
        categories.map((cat) => {
          const cur = pick(cat, "current");
          const prev = pick(cat, "previous");
          return (
            <HelpText key={cat} style={{ margin: "4px 0 0" }}>
              <strong>{COST_CATEGORY_LABEL[cat] ?? cat}</strong>: {cur?.sent ?? 0} enviadas ({delta(cur?.sent ?? 0, prev?.sent ?? 0)}) · entregues{" "}
              {pct(cur?.delivered ?? 0, cur?.sent ?? 0)} · lidas {pct(cur?.read_count ?? 0, cur?.sent ?? 0)} · falhas {cur?.failed ?? 0} · custo{" "}
              {money(cur?.price_total ?? 0)} ({delta(cur?.price_total ?? 0, prev?.price_total ?? 0)})
              {cur && cur.priced < cur.sent - cur.failed && ` · ${cur.sent - cur.failed - cur.priced} aguardando preço`}
            </HelpText>
          );
        })
      )}
    </Card>
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
      <div style={{ marginBottom: "8px" }}>
        <HelpText style={{ margin: 0 }}>
          Conversas do Playground e do Circuito. {loading ? "carregando…" : `${contacts.length} contato(s) · ${unreadTotal} não lida(s)`}
        </HelpText>
      </div>

      {can("crm.admin") && (
        <div className="g-cards g-cards-wide" style={{ alignItems: "start", marginBottom: "12px" }}>
          <OptinCampaignCard />
          <MarketingOptinCampaignCard />
          <LifecycleCampaignsCard />
          <WhatsappCostCard />
        </div>
      )}

      {/* Funil: contagem por etapa, também serve de filtro */}
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "8px", alignItems: "center" }}>
        <Button size="sm" variant={stageFilter === "TODOS" ? "primary" : "secondary"} onClick={() => setStageFilter("TODOS")}>
          Todos ({contacts.length})
        </Button>
        {STAGES.map((s) => (
          <Button key={s.value} size="sm" variant={stageFilter === s.value ? "primary" : "secondary"} onClick={() => setStageFilter(s.value)}>
            {s.label} ({contacts.filter((c) => c.stage === s.value).length})
          </Button>
        ))}
        {canWrite && filtered.length > 0 && (
          <Button size="sm" variant="secondary" disabled={sending} style={{ marginLeft: "auto" }} onClick={() => void sendNps(filtered.slice(0, 100).map((c) => c.id), "Os contatos filtrados")}>
            ⭐ Enviar NPS aos {Math.min(filtered.length, 100)} contato(s) listado(s)
          </Button>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 340px) 1fr", gap: "12px", alignItems: "start" }}>
        {/* Lista */}
        <Card style={{ maxHeight: "calc(100vh - 260px)", overflowY: "auto" }}>
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
