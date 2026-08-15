import { useEffect, useState } from "react";
import { Button, Card, Input, Select, Tabs, HelpText, Modal, Tag } from "@facaamigos/ui";
import { generateEscPosReceipt } from "@facaamigos/domain";
import { Api } from "../api/client.js";
import type {
  Asset,
  BonusRule,
  Coupon,
  Employee,
  LoyaltyRule,
  Package,
  Plan,
  Product,
  ProductFiscal,
  FiscalTerminalStatus,
  UnitFiscal,
} from "../api/client.js";
import { useAppState } from "../state/AppState.js";
import { useToast } from "../state/ToastContext.js";
import { useAuth } from "../auth/AuthContext.js";
import { RequireCapability } from "../auth/RequireCapability.js";
import { ROLE_LABEL, ROLE_DESCRIPTION, FUNCTION_OPTIONS, type Capability } from "../auth/capabilities.js";
import { EmployeeAuthGate } from "../components/EmployeeAuthGate.js";
import type { TerminalEmployee } from "../lib/supabase/terminalAuth.js";
import { WristbandLabelPreview } from "../components/WristbandLabelPreview.js";
import { WristbandPrintModal } from "../components/WristbandPrintModal.js";
import { EspelhoPontoModal } from "../components/EspelhoPontoModal.js";
import { WristbandQRCode, generateWristbandQRCodeDataUrl } from "../components/WristbandQRCode.js";
import { buildAcessoRapidoPosterHtml, printContract } from "../contract/contractTemplate.js";
import { money } from "../format.js";

type Tab =
  | "PLANOS"
  | "PACOTES"
  | "PRODUTOS"
  | "CUPONS"
  | "FIDELIDADE"
  | "META"
  | "FROTA"
  | "PONTO"
  | "UNIDADE"
  | "FISCAL"
  | "TERMOS"
  | "IMPRESSORAS";

/**
 * Capacidade exigida por aba. Assim como em auth/screens.ts, o
 * `Record<Tab, Capability>` faz o build quebrar se uma aba nova nascer sem
 * declarar o que exige — o modo de falha natural seria ela nascer aberta.
 *
 * Todas exigem no mínimo `config.write` (Owner); as de baixo têm capacidade
 * própria porque o dano de errar nelas é de outra natureza: dado fiscal, o
 * texto que o responsável aceita — e o Espelho de Ponto, que é a única aba
 * deste grupo aberta ao Líder (GERENTE), não só ao Owner: gerar o ponto de
 * terceiros é atribuição de liderança de turno, não de dono do negócio.
 *
 * Cadastro de colaborador (antes "COLABORADORES" aqui) mudou de lugar: vive
 * só no módulo Gerencial agora, porque um colaborador não pertence a uma
 * unidade só — é lá que se escolhe em qual(is) ele atua.
 */
const TAB_CAPABILITY: Record<Tab, Capability> = {
  PLANOS: "config.write",
  PACOTES: "config.write",
  PRODUTOS: "config.write",
  CUPONS: "config.write",
  FIDELIDADE: "config.write",
  META: "config.write",
  FROTA: "config.write",
  IMPRESSORAS: "config.write",
  PONTO: "relatorio.ponto",
  UNIDADE: "config.unit.write",
  FISCAL: "config.fiscal.write",
  TERMOS: "config.terms.write",
};

export function ConfiguracoesScreen() {
  const { unit } = useAppState();
  const { can } = useAuth();
  const isQuiosque = unit?.kind === "QUIOSQUE";
  const [tab, setTab] = useState<Tab>("PLANOS");

  if (!unit) return null;

  const allTabs: { value: Tab; label: string }[] = [
    { value: "PLANOS", label: "Planos de Preços" },
    { value: "PACOTES", label: "Pacotes" },
    { value: "PRODUTOS", label: "Produtos" },
    { value: "CUPONS", label: "Cupons" },
    { value: "FIDELIDADE", label: "Fidelidade" },
    { value: "META", label: "Meta" },
    ...(isQuiosque ? ([{ value: "FROTA" as const, label: "Frota" }]) : []),
    { value: "PONTO", label: "Espelho de Ponto" },
    { value: "UNIDADE", label: "Unidade" },
    { value: "FISCAL", label: "Dados Fiscais" },
    { value: "TERMOS", label: "Termos de Uso" },
    { value: "IMPRESSORAS", label: "Impressoras" },
  ];
  const tabs = allTabs.filter((t) => can(TAB_CAPABILITY[t.value]));

  const TAB_HELP: Record<Tab, string> = {
    PLANOS: "Cadastre os planos de permanência que aparecem na tela de Entrada — nome, preço, duração e o que cobrar se passar do tempo.",
    PACOTES:
      "Pacotes de horas oferecidos como upgrade ao cliente VIP no check-in. Quem escolhe qual oferecer é o sistema: o pacote de valor imediatamente acima do que a família já gastou no mês, e só se ele baixar o custo por hora dela.",
    PRODUTOS: "Cadastre os itens vendidos avulsos no PDV (loja/lanchonete) e o estoque disponível de cada um.",
    CUPONS: "Crie códigos de desconto ou parceria que o operador pode aplicar na tela de Entrada.",
    FIDELIDADE: "Defina recompensas automáticas para clientes recorrentes — ex.: a cada 10 visitas, uma entrada grátis.",
    META: "Configure a meta de faturamento do dia, o horário de fechamento e as regras de bônus para a equipe.",
    FROTA: "Cadastre os carrinhos do Circuito (nome, cor, emoji e foto) e marque quando um estiver em manutenção.",
    PONTO: "Gere e imprima o espelho de ponto mensal de qualquer colaborador, com as marcações do mês e linha para assinatura.",
    UNIDADE: "Dados da unidade: nome, fuso, virada do dia operacional e o que aparece no cabeçalho do cupom.",
    FISCAL: "Dados do emitente para NFC-e (produtos) e o cadastro de NFS-e (serviço). Confira com seu contador antes de ligar a emissão.",
    TERMOS: "Texto que o responsável aceita no check-in. Alterações ficam registradas na trilha de auditoria.",
    IMPRESSORAS: "Informe o nome das impressoras de pulseira e de cupom instaladas neste terminal.",
  };

  return (
    <div style={{ padding: "24px", maxWidth: "900px", margin: "0 auto" }}>
      <h1 style={{ fontFamily: "var(--font-display)" }}>Configurações</h1>
      <HelpText>Ajustes da operação — o que é cadastrado aqui aparece depois nas outras telas do sistema.</HelpText>
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      <HelpText style={{ margin: "12px 0" }}>{TAB_HELP[tab]}</HelpText>

      {/* Cada painel é guardado individualmente, e não só a tela inteira: as
          abas têm capacidades diferentes entre si, e o estado `tab` sobrevive
          a uma troca de colaborador no terminal. */}
      <div role="tabpanel">
        <RequireCapability capability={TAB_CAPABILITY[tab]}>
          {tab === "PLANOS" && <PlanosTab unitId={unit.id} activity={isQuiosque ? "CARRINHO" : "PLAYGROUND"} />}
          {tab === "PACOTES" && <PacotesTab unitId={unit.id} activity={isQuiosque ? "CARRINHO" : "PLAYGROUND"} />}
          {tab === "PRODUTOS" && <ProdutosTab unitId={unit.id} />}
          {tab === "CUPONS" && <CuponsTab unitId={unit.id} />}
          {tab === "FIDELIDADE" && <FidelidadeTab unitId={unit.id} isQuiosque={isQuiosque} />}
          {tab === "META" && <MetaTab unitId={unit.id} />}
          {tab === "FROTA" && isQuiosque && <FrotaTab unitId={unit.id} />}
          {tab === "PONTO" && <EspelhoPontoTab unitId={unit.id} />}
          {tab === "UNIDADE" && <UnidadeTab unitId={unit.id} />}
          {tab === "FISCAL" && <FiscalTab unitId={unit.id} />}
          {tab === "TERMOS" && <TermosTab unitId={unit.id} />}
          {tab === "IMPRESSORAS" && <ImpressorasTab unitId={unit.id} />}
        </RequireCapability>
      </div>
    </div>
  );
}

function MetaTab({ unitId }: { unitId: string }) {
  const toast = useToast();
  const { employee } = useAppState();
  const isOwner = employee?.role === "ADMIN";

  const [goalReais, setGoalReais] = useState("0");
  const [savingGoal, setSavingGoal] = useState(false);
  
  const [rules, setRules] = useState<BonusRule[]>([]);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [ruleDescription, setRuleDescription] = useState("");
  const [ruleValueReais, setRuleValueReais] = useState("0");
  const [busyRule, setBusyRule] = useState(false);
  
  const [closingTime, setClosingTime] = useState("");
  const [savingClosingTime, setSavingClosingTime] = useState(false);

  function loadGoal() {
    Api.unitSetting(unitId, "daily_goal_cents").then((r) => setGoalReais(((Number(r.value) || 0) / 100).toString()));
  }
  function loadRules() {
    Api.bonusRules(unitId).then(setRules);
  }
  function loadClosingTime() {
    Api.unitSetting(unitId, "closing_time").then((r) => setClosingTime(r.value ?? ""));
  }
  useEffect(loadGoal, [unitId]);
  useEffect(loadRules, [unitId]);
  useEffect(loadClosingTime, [unitId]);

  // As 4 funções abaixo eram só `try { await api() } finally { setBusy(false) }`
  // — sem catch e sem nenhum retorno visual em caso de sucesso. Salvar a
  // meta do dia e falhar era indistinguível de salvar e dar certo: o
  // operador tocava "Salvar", nada mudava na tela, e não tinha como saber
  // qual dos dois aconteceu. toast.success/error cobre os dois lados.

  async function saveGoal() {
    setSavingGoal(true);
    try {
      await Api.setUnitSetting(unitId, "daily_goal_cents", String(Math.round(Number(goalReais) * 100)));
      toast.success("Meta diária salva.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar a meta.");
    } finally {
      setSavingGoal(false);
    }
  }

  function startEditRule(r: BonusRule) {
    setEditingRuleId(r.id);
    setRuleDescription(r.description);
    setRuleValueReais((r.rewardValueCents / 100).toFixed(2));
  }

  function cancelEditRule() {
    setEditingRuleId(null);
    setRuleDescription("");
    setRuleValueReais("0");
  }

  async function saveRule() {
    setBusyRule(true);
    try {
      const payload = {
        description: ruleDescription,
        rewardValueCents: Math.round(Number(ruleValueReais) * 100),
      };

      if (editingRuleId) {
        await Api.updateBonusRule(editingRuleId, payload);
        toast.success("Regra de bonificação atualizada.");
      } else {
        await Api.createBonusRule({ unitId, ...payload });
        toast.success("Regra de bonificação criada.");
      }
      cancelEditRule();
      loadRules();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar a regra.");
    } finally {
      setBusyRule(false);
    }
  }

  async function handleToggleActiveRule(r: BonusRule) {
    if (!window.confirm(`Deseja realmente ${r.active ? "inativar/excluir" : "reativar"} a regra "${r.description}"?`)) return;
    try {
      await Api.setBonusRuleActive(r.id, !r.active);
      toast.success(r.active ? "Regra removida com sucesso." : "Regra reativada.");
      loadRules();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível alterar a regra.");
    }
  }

  async function saveClosingTime() {
    setSavingClosingTime(true);
    try {
      await Api.setUnitSetting(unitId, "closing_time", closingTime);
      toast.success("Horário de fechamento salvo.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar o horário de fechamento.");
    } finally {
      setSavingClosingTime(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <Card style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
        <h2 title="Meta de faturamento do dia, usada na barra de progresso do Painel">Meta diária de faturamento</h2>
        <Input
          label="Meta do dia (R$)"
          type="number"
          value={goalReais}
          onChange={(e) => setGoalReais(e.target.value)}
          title="Valor de faturamento que a unidade deve atingir hoje"
        />
        <Button variant="primary" disabled={savingGoal} onClick={saveGoal} title="Salvar a meta diária de faturamento">
          Salvar meta
        </Button>
      </Card>

      <Card style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
        <h2 title="Se faltar menos tempo até este horário do que a duração de um plano, a venda desse plano é bloqueada">
          Encerramento Inteligente de Turno
        </h2>
        <label>Horário de fechamento do shopping</label>
        <input
          type="time"
          value={closingTime}
          onChange={(e) => setClosingTime(e.target.value)}
          title="Planos que não caibam até este horário deixam de ser vendidos automaticamente"
          style={{ padding: "10px", borderRadius: "12px", border: "1px solid var(--border-subtle)" }}
        />
        <Button variant="primary" disabled={savingClosingTime} onClick={saveClosingTime} title="Salvar o horário de fechamento">
          Salvar horário
        </Button>
      </Card>

      <Card style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 title="Recompensas para o colaborador quando a meta diária é batida">
            {editingRuleId ? "Editar Regra de Bonificação" : "Regras de Bonificação"}
          </h2>
          {editingRuleId && (
            <Button variant="secondary" onClick={cancelEditRule} disabled={busyRule}>
              Cancelar Edição
            </Button>
          )}
        </div>
        <Input
          label="Descrição"
          placeholder="Ex: Bônus para o turno ao bater a meta"
          value={ruleDescription}
          onChange={(e) => setRuleDescription(e.target.value)}
          title="Descreva a regra de bonificação para o colaborador"
        />
        <Input
          label="Valor (R$)"
          type="number"
          value={ruleValueReais}
          onChange={(e) => setRuleValueReais(e.target.value)}
          title="Valor da bonificação em reais"
        />
        <Button variant="primary" disabled={busyRule || !ruleDescription} onClick={saveRule} title={editingRuleId ? "Salvar regra" : "Criar nova regra"}>
          {editingRuleId ? "Salvar regra" : "Criar regra"}
        </Button>
        {rules.map((r) => (
          <Card key={r.id} style={{ padding: "12px", display: "flex", justifyContent: "space-between", alignItems: "center", opacity: r.active ? 1 : 0.5 }}>
            <span>{r.description}</span>
            <span style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <strong>{money(r.rewardValueCents)}</strong>
              <Button variant="secondary" onClick={() => startEditRule(r)} disabled={busyRule}>
                Editar
              </Button>
              {r.active ? (
                <Button variant="secondary" style={isOwner ? { color: "#d32f2f", borderColor: "#d32f2f" } : undefined} onClick={() => handleToggleActiveRule(r)} disabled={busyRule}>
                  {isOwner ? "Excluir" : "Inativar"}
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => handleToggleActiveRule(r)} disabled={busyRule}>
                  Reativar
                </Button>
              )}
            </span>
          </Card>
        ))}
      </Card>

      {/* Os Termos de Uso saíram daqui para a aba própria "Termos de Uso":
          eram gravados com `setUnitSetting` (upsert direto, exige só
          config.write) enquanto a aba nova grava por `fa_config_set_terms`
          (exige config.terms.write e audita o texto). Manter os dois
          caminhos abertos para a mesma chave anularia a capacidade
          específica — o Owner salvaria por um lado ou pelo outro, com
          registros diferentes. */}
    </div>
  );
}

// Nome de cada hex da paleta — os seletores de cor (plano e carrinho)
// eram 6 botões redondos sem nenhum nome: nem aria-label, nem title, só
// a cor de fundo. Sem isso um leitor de tela anuncia "botão", 6 vezes
// seguidas, sem dizer qual é qual.
const COLOR_NAMES: Record<string, string> = {
  "#2ECFB5": "Teal",
  "#F0196B": "Rosa",
  "#FFE234": "Amarelo",
  "#FF7A00": "Laranja",
  "#A020EE": "Roxo",
  "#1A3F35": "Verde-escuro",
};

const PLAN_COLOR_OPTIONS = ["#2ECFB5", "#F0196B", "#FFE234", "#FF7A00", "#A020EE", "#1A3F35"];

function PlanosTab({ unitId, activity }: { unitId: string; activity: "PLAYGROUND" | "CARRINHO" }) {
  const toast = useToast();
  const { employee } = useAppState();
  const isOwner = employee?.role === "ADMIN";
  
  const [plans, setPlans] = useState<Plan[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  const [name, setName] = useState("");
  const [valueReais, setValueReais] = useState("0");
  const [durationValue, setDurationValue] = useState("15");
  const [durationUnit, setDurationUnit] = useState<"MINUTO" | "HORA">("MINUTO");
  const [overageReais, setOverageReais] = useState("1");
  const [color, setColor] = useState(PLAN_COLOR_OPTIONS[0]!);
  const [busy, setBusy] = useState(false);

  function load() {
    Api.plans(unitId, activity, false).then(setPlans);
  }
  useEffect(load, [unitId, activity]);

  function startEdit(p: Plan) {
    setEditingId(p.id);
    setName(p.name);
    setValueReais((p.valueCents / 100).toFixed(2));
    setDurationValue(String(p.durationValue));
    setDurationUnit(p.durationUnit);
    setOverageReais((p.overageCentsPerMinute / 100).toFixed(2));
    setColor(p.color);
  }

  function cancelEdit() {
    setEditingId(null);
    setName("");
    setValueReais("0");
    setDurationValue("15");
    setDurationUnit("MINUTO");
    setOverageReais("1");
    setColor(PLAN_COLOR_OPTIONS[0]!);
  }

  async function save() {
    setBusy(true);
    try {
      const payload = {
        name,
        valueCents: Math.round(Number(valueReais) * 100),
        durationValue: Number(durationValue),
        durationUnit,
        overageCentsPerMinute: Math.round(Number(overageReais) * 100),
        color,
      };

      if (editingId) {
        await Api.updatePlan(editingId, payload);
        toast.success("Plano atualizado.");
      } else {
        await Api.createPlan({ unitId, activity, ...payload });
        toast.success("Plano criado.");
      }
      cancelEdit();
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar o plano.");
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleActive(p: Plan) {
    if (!window.confirm(`Deseja realmente ${p.active ? "inativar/excluir" : "reativar"} o plano "${p.name}"?`)) return;
    setBusy(true);
    try {
      await Api.setPlanActive(p.id, !p.active);
      toast.success(p.active ? "Plano removido com sucesso." : "Plano reativado.");
      load();
    } catch (err) {
      toast.error("Erro ao alterar o plano.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Card style={{ padding: "16px", marginBottom: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "18px", margin: "0 0 4px" }}>
            {editingId ? "Editar plano" : "Novo plano"}
          </h2>
          {editingId && (
            <Button variant="secondary" onClick={cancelEdit} disabled={busy}>
              Cancelar Edição
            </Button>
          )}
        </div>
        <Input label="Nome" value={name} onChange={(e) => setName(e.target.value)} />
        <Input label="Valor (R$)" type="number" value={valueReais} onChange={(e) => setValueReais(e.target.value)} />
        <div style={{ display: "flex", gap: "8px" }}>
          <Input label="Duração" type="number" value={durationValue} onChange={(e) => setDurationValue(e.target.value)} />
          <Select label="Unidade" value={durationUnit} onChange={(e) => setDurationUnit(e.target.value as "MINUTO" | "HORA")}>
            <option value="MINUTO">minuto(s)</option>
            <option value="HORA">hora(s)</option>
          </Select>
        </div>
        <Input
          label="Excedente por minuto (R$)"
          type="number"
          value={overageReais}
          onChange={(e) => setOverageReais(e.target.value)}
          title="Valor cobrado por minuto quando a criança fica no espaço além da duração do plano"
        />
        <div>
          <label>Cor no Painel</label>
          <div style={{ display: "flex", gap: "4px" }}>
            {PLAN_COLOR_OPTIONS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={`Cor ${COLOR_NAMES[c] ?? c}`}
                aria-pressed={color === c}
                title={COLOR_NAMES[c] ?? c}
                style={{ width: "28px", height: "28px", borderRadius: "50%", background: c, border: color === c ? "3px solid var(--color-dark)" : "1px solid var(--border-subtle)" }}
              />
            ))}
          </div>
        </div>
        <Button variant="primary" disabled={busy || !name} onClick={save}>
          {editingId ? "Salvar plano" : "Criar plano"}
        </Button>
      </Card>

      {plans.map((p) => (
        <Card key={p.id} style={{ padding: "12px", marginBottom: "8px", display: "flex", justifyContent: "space-between", alignItems: "center", opacity: p.active ? 1 : 0.5 }}>
          <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ width: "14px", height: "14px", borderRadius: "50%", background: p.color, display: "inline-block" }} />
            {p.name} — {p.durationValue} {p.durationUnit.toLowerCase()}
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span>
              {money(p.valueCents)} + {money(p.overageCentsPerMinute)}/min excedente
            </span>
            <Button variant="secondary" onClick={() => startEdit(p)} disabled={busy}>
              Editar
            </Button>
            {p.active ? (
              <Button variant="secondary" style={isOwner ? { color: "#d32f2f", borderColor: "#d32f2f" } : undefined} onClick={() => handleToggleActive(p)} disabled={busy}>
                {isOwner ? "Excluir" : "Inativar"}
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => handleToggleActive(p)} disabled={busy}>
                Reativar
              </Button>
            )}
          </span>
        </Card>
      ))}
    </div>
  );
}

/**
 * Pacotes de horas + calibragem do motor de cross-selling.
 *
 * As duas coisas moram na mesma aba porque são a mesma decisão: um
 * pacote só existe para ser oferecido, e o limiar de quem recebe a
 * oferta é o outro lado da mesma moeda. Separá-los faria o Owner
 * cadastrar preços numa tela e descobrir noutra por que ninguém está
 * vendo a oferta.
 */
function PacotesTab({ unitId, activity }: { unitId: string; activity: "PLAYGROUND" | "CARRINHO" }) {
  const toast = useToast();
  const { employee } = useAppState();
  const isOwner = employee?.role === "ADMIN";

  const [packages, setPackages] = useState<Package[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [priceReais, setPriceReais] = useState("0");
  const [includedHours, setIncludedHours] = useState("10");
  const [validityDays, setValidityDays] = useState("30");
  const [benefitText, setBenefitText] = useState("");
  const [color, setColor] = useState("#FF7A00");
  const [busy, setBusy] = useState(false);

  const [vipVisits, setVipVisits] = useState("4");
  const [windowDays, setWindowDays] = useState("30");
  const [cooldownDays, setCooldownDays] = useState("15");
  const [savingRules, setSavingRules] = useState(false);

  function load() {
    Api.packages(unitId, false).then(setPackages).catch(() => {});
  }
  useEffect(load, [unitId]);

  useEffect(() => {
    Api.unitSetting(unitId, "upsell_vip_visits").then((r) => setVipVisits(r.value ?? "4")).catch(() => {});
    Api.unitSetting(unitId, "upsell_vip_window_days").then((r) => setWindowDays(r.value ?? "30")).catch(() => {});
    Api.unitSetting(unitId, "upsell_cooldown_days").then((r) => setCooldownDays(r.value ?? "15")).catch(() => {});
  }, [unitId]);

  const priceCents = Math.round(Number(priceReais) * 100);
  const includedMinutes = Math.round(Number(includedHours) * 60);
  // Prévia do custo/hora enquanto o Owner digita: é o número que decide se
  // o pacote chega a ser oferecido (o motor só propõe pacote que BAIXA o
  // custo/hora do cliente). Sem a prévia, um pacote caro demais é
  // cadastrado, some da tela e ninguém entende o porquê.
  const hourlyCents = includedMinutes > 0 ? Math.round((priceCents * 60) / includedMinutes) : 0;

  function startEdit(p: Package) {
    setEditingId(p.id);
    setName(p.name);
    setPriceReais((p.priceCents / 100).toFixed(2));
    setIncludedHours(String(p.includedMinutes / 60));
    setValidityDays(String(p.validityDays));
    setBenefitText(p.benefitText);
    setColor(p.color);
  }

  function cancelEdit() {
    setEditingId(null);
    setName("");
    setPriceReais("0");
    setIncludedHours("10");
    setValidityDays("30");
    setBenefitText("");
    setColor("#FF7A00");
  }

  async function save() {
    setBusy(true);
    try {
      const payload = {
        name,
        priceCents,
        includedMinutes,
        validityDays: Math.max(1, Math.round(Number(validityDays))),
        benefitText: benefitText.trim(),
        color,
      };

      if (editingId) {
        await Api.updatePackage(editingId, payload);
        toast.success("Pacote atualizado.");
      } else {
        await Api.createPackage({ unitId, activity, ...payload });
        toast.success("Pacote criado.");
      }
      cancelEdit();
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar o pacote.");
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleActive(pkg: Package) {
    if (!window.confirm(`Deseja realmente ${pkg.active ? "inativar/excluir" : "reativar"} o pacote "${pkg.name}"?`)) return;
    try {
      await Api.setPackageActive(pkg.id, !pkg.active);
      toast.success(pkg.active ? "Pacote removido com sucesso." : "Pacote reativado.");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível alterar o pacote.");
    }
  }

  async function saveRules() {
    setSavingRules(true);
    try {
      await Promise.all([
        Api.setUnitSetting(unitId, "upsell_vip_visits", String(Math.max(1, Math.round(Number(vipVisits))))),
        Api.setUnitSetting(unitId, "upsell_vip_window_days", String(Math.max(1, Math.round(Number(windowDays))))),
        Api.setUnitSetting(unitId, "upsell_cooldown_days", String(Math.max(0, Math.round(Number(cooldownDays))))),
      ]);
      toast.success("Regras do motor VIP salvas.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar as regras.");
    } finally {
      setSavingRules(false);
    }
  }

  const canCreate = Boolean(name.trim()) && Boolean(benefitText.trim()) && priceCents > 0 && includedMinutes > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <Card style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "10px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2>{editingId ? "Editar pacote" : "Novo pacote"}</h2>
          {editingId && (
            <Button variant="secondary" onClick={cancelEdit} disabled={busy}>
              Cancelar Edição
            </Button>
          )}
        </div>
        <HelpText>
          O valor cheio é a âncora: o cliente paga só a diferença entre ele e o que já gastou no mês. O benefício é lido
          em voz alta pelo operador, então escreva a frase exata — ex.: “2 horas extras e um lanche”.
        </HelpText>
        <Input label="Nome do pacote" placeholder="Ex.: Pacote Amigo 10h" value={name} onChange={(e) => setName(e.target.value)} />
        <Input
          label="Valor de tabela (R$)"
          type="number"
          value={priceReais}
          onChange={(e) => setPriceReais(e.target.value)}
          title="Preço cheio do pacote — é contra ele que o gasto do mês do cliente é comparado"
        />
        <Input
          label="Horas incluídas"
          type="number"
          step="0.5"
          value={includedHours}
          onChange={(e) => setIncludedHours(e.target.value)}
          title="Total de horas de brincadeira que o pacote dá"
        />
        <Input
          label="Validade (dias)"
          type="number"
          value={validityDays}
          onChange={(e) => setValidityDays(e.target.value)}
          title="Por quantos dias o saldo de horas continua valendo depois da compra"
        />
        <Input
          label="Benefício (frase do script de venda)"
          placeholder="Ex.: 2 horas extras e um lanche por visita"
          value={benefitText}
          onChange={(e) => setBenefitText(e.target.value)}
        />
        <div>
          <label>Cor do pacote</label>
          <div style={{ display: "flex", gap: "4px" }}>
            {PLAN_COLOR_OPTIONS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={`Cor ${COLOR_NAMES[c] ?? c}`}
                aria-pressed={color === c}
                title={COLOR_NAMES[c] ?? c}
                style={{ width: "28px", height: "28px", borderRadius: "50%", background: c, border: color === c ? "3px solid var(--color-dark)" : "1px solid var(--border-subtle)" }}
              />
            ))}
          </div>
        </div>
        {includedMinutes > 0 && priceCents > 0 && (
          <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
            Custo por hora deste pacote: <strong>{money(hourlyCents)}</strong> — ele só será oferecido a quem hoje paga
            mais do que isso por hora.
          </div>
        )}
        <Button variant="primary" disabled={busy || !canCreate} onClick={save}>
          {editingId ? "Salvar pacote" : "Criar pacote"}
        </Button>
      </Card>

      {packages.map((p) => {
        const hourly = Math.round((p.priceCents * 60) / p.includedMinutes);
        return (
          <Card
            key={p.id}
            style={{ padding: "12px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", opacity: p.active ? 1 : 0.5 }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
              <span style={{ width: "14px", height: "14px", borderRadius: "50%", background: p.color, display: "inline-block", flexShrink: 0 }} />
              <span>
                <strong>{p.name}</strong>
                <br />
                <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                  {(p.includedMinutes / 60).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h · {p.validityDays} dias ·{" "}
                  {p.benefitText}
                </span>
              </span>
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: "12px", flexShrink: 0 }}>
              <span style={{ textAlign: "right" }}>
                <strong>{money(p.priceCents)}</strong>
                <br />
                <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>{money(hourly)}/h</span>
              </span>
              <Button variant="secondary" onClick={() => startEdit(p)} disabled={busy}>
                Editar
              </Button>
              {p.active ? (
                <Button variant="secondary" style={isOwner ? { color: "#d32f2f", borderColor: "#d32f2f" } : undefined} onClick={() => handleToggleActive(p)} disabled={busy}>
                  {isOwner ? "Excluir" : "Inativar"}
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => handleToggleActive(p)} disabled={busy}>
                  Reativar
                </Button>
              )}
            </span>
          </Card>
        );
      })}

      <Card style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "10px" }}>
        <h2>Regras do motor VIP</h2>
        <HelpText>
          Quem recebe a oferta e por quanto tempo ela para de aparecer depois de uma recusa. O padrão é 4 visitas em 30
          dias e 15 dias de espera.
        </HelpText>
        <Input
          label="Visitas para virar VIP"
          type="number"
          value={vipVisits}
          onChange={(e) => setVipVisits(e.target.value)}
          title="Número de check-ins dentro da janela que faz a criança receber o selo VIP e a oferta"
        />
        <Input
          label="Janela de contagem (dias)"
          type="number"
          value={windowDays}
          onChange={(e) => setWindowDays(e.target.value)}
          title="Período móvel em que as visitas são contadas — 30 dias significa 'nos últimos 30 dias', não 'neste mês'"
        />
        <Input
          label="Espera após recusa (dias)"
          type="number"
          value={cooldownDays}
          onChange={(e) => setCooldownDays(e.target.value)}
          title="Quantos dias a oferta fica bloqueada para o responsável que recusou"
        />
        <Button variant="primary" disabled={savingRules} onClick={saveRules}>
          Salvar regras
        </Button>
      </Card>

      <QuickUpsellCard unitId={unitId} />
    </div>
  );
}

/**
 * Cross-sell rápido de item único (ex.: "Água") — diferente do motor de
 * pacotes acima: sem script nem ancoragem, é só "oferecer X por R$Y" ao
 * escolher um plano longo o bastante na Entrada. O produto ofertado é
 * qualquer um já cadastrado em Produtos; sem produto escolhido aqui, o
 * gatilho simplesmente não aparece no balcão.
 */
function QuickUpsellCard({ unitId }: { unitId: string }) {
  const toast = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState("");
  const [triggerMinutes, setTriggerMinutes] = useState("60");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Api.products(unitId).then(setProducts).catch(() => {});
    Api.unitSetting(unitId, "upsell_quick_product_id").then((r) => setProductId(r.value ?? "")).catch(() => {});
    Api.unitSetting(unitId, "upsell_quick_trigger_minutes").then((r) => setTriggerMinutes(r.value ?? "60")).catch(() => {});
  }, [unitId]);

  async function save() {
    setSaving(true);
    try {
      await Promise.all([
        Api.setUnitSetting(unitId, "upsell_quick_product_id", productId),
        Api.setUnitSetting(unitId, "upsell_quick_trigger_minutes", String(Math.max(1, Math.round(Number(triggerMinutes))))),
      ]);
      toast.success("Cross-sell rápido salvo.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "10px" }}>
      <h2>Cross-sell rápido</h2>
      <HelpText>
        Ao escolher um plano com pelo menos os minutos configurados abaixo, a Entrada oferece este produto para
        adicionar direto na comanda da criança — cobrado junto no fechamento.
      </HelpText>
      <Select label="Produto oferecido" value={productId} onChange={(e) => setProductId(e.target.value)}>
        <option value="">Nenhum (gatilho desligado)</option>
        {products.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} — {money(p.price_cents)}
          </option>
        ))}
      </Select>
      <Input
        label="A partir de quantos minutos de plano"
        type="number"
        value={triggerMinutes}
        onChange={(e) => setTriggerMinutes(e.target.value)}
        title="Planos com duração igual ou maior a este valor mostram o gatilho de oferta"
      />
      <Button variant="primary" disabled={saving} onClick={save}>
        Salvar
      </Button>
    </Card>
  );
}

function ProdutosTab({ unitId }: { unitId: string }) {
  const toast = useToast();
  const { employee } = useAppState();
  const isOwner = employee?.role === "ADMIN";

  const [products, setProducts] = useState<Product[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [priceReais, setPriceReais] = useState("0");
  const [stock, setStock] = useState("0");
  const [emoji, setEmoji] = useState("🛍️");
  const [busy, setBusy] = useState(false);

  function load() {
    Api.products(unitId, false).then(setProducts);
  }
  useEffect(load, [unitId]);

  function startEdit(p: Product) {
    setEditingId(p.id);
    setName(p.name);
    setPriceReais((p.price_cents / 100).toFixed(2));
    setStock(String(p.stock));
    setEmoji(p.emoji ?? "🛍️");
  }

  function cancelEdit() {
    setEditingId(null);
    setName("");
    setPriceReais("0");
    setStock("0");
    setEmoji("🛍️");
  }

  async function save() {
    setBusy(true);
    try {
      const payload = {
        name,
        emoji,
        priceCents: Math.round(Number(priceReais) * 100),
        stock: Number(stock),
      };
      
      if (editingId) {
        await Api.updateProduct(editingId, payload);
        toast.success("Produto atualizado.");
      } else {
        await Api.createProduct({ unitId, ...payload });
        toast.success("Produto criado.");
      }
      cancelEdit();
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar o produto.");
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleActive(p: Product) {
    if (!window.confirm(`Deseja realmente ${p.active ? "inativar/excluir" : "reativar"} o produto "${p.name}"?`)) return;
    try {
      await Api.setProductActive(p.id, !p.active);
      toast.success(p.active ? "Produto removido com sucesso." : "Produto reativado.");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível alterar o produto.");
    }
  }

  return (
    <div>
      <Card style={{ padding: "16px", marginBottom: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "18px", margin: "0 0 4px" }}>
            {editingId ? "Editar produto" : "Novo produto"}
          </h2>
          {editingId && (
            <Button variant="secondary" onClick={cancelEdit} disabled={busy}>
              Cancelar Edição
            </Button>
          )}
        </div>
        <Input label="Emoji" value={emoji} onChange={(e) => setEmoji(e.target.value)} />
        <Input label="Nome" value={name} onChange={(e) => setName(e.target.value)} />
        <Input label="Preço (R$)" type="number" value={priceReais} onChange={(e) => setPriceReais(e.target.value)} />
        <Input label="Estoque" type="number" value={stock} onChange={(e) => setStock(e.target.value)} />
        <Button variant="primary" disabled={busy || !name} onClick={save}>
          {editingId ? "Salvar produto" : "Criar produto"}
        </Button>
      </Card>
      {products.map((p) => (
        <Card key={p.id} style={{ padding: "12px", marginBottom: "8px", display: "flex", justifyContent: "space-between", alignItems: "center", opacity: p.active ? 1 : 0.5 }}>
          <span>
            {p.emoji} {p.name}
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span>
              {money(p.price_cents)} — {p.stock} un.
            </span>
            <Button variant="secondary" onClick={() => startEdit(p)} disabled={busy}>
              Editar
            </Button>
            {p.active ? (
              <Button variant="secondary" style={isOwner ? { color: "#d32f2f", borderColor: "#d32f2f" } : undefined} onClick={() => handleToggleActive(p)} disabled={busy}>
                {isOwner ? "Excluir" : "Inativar"}
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => handleToggleActive(p)} disabled={busy}>
                Reativar
              </Button>
            )}
          </span>
        </Card>
      ))}
    </div>
  );
}

function CuponsTab({ unitId }: { unitId: string }) {
  const toast = useToast();
  const { employee } = useAppState();
  const isOwner = employee?.role === "ADMIN";

  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [code, setCode] = useState("");
  const [kind, setKind] = useState<Coupon["kind"]>("MINUTOS_EXTRA");
  const [value, setValue] = useState("10");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  function load() {
    Api.coupons(unitId).then(setCoupons);
  }
  useEffect(load, [unitId]);

  function startEdit(c: Coupon) {
    setEditingId(c.id);
    setCode(c.code);
    setKind(c.kind);
    setValue(String(c.value));
    setDescription(c.description ?? "");
  }

  function cancelEdit() {
    setEditingId(null);
    setCode("");
    setKind("MINUTOS_EXTRA");
    setValue("10");
    setDescription("");
  }

  async function save() {
    setBusy(true);
    try {
      const payload = {
        code,
        kind,
        value: Number(value),
        description: description || undefined,
      };

      if (editingId) {
        await Api.updateCoupon(editingId, payload);
        toast.success("Cupom atualizado.");
      } else {
        await Api.createCoupon({ unitId, ...payload });
        toast.success("Cupom criado.");
      }
      cancelEdit();
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar o cupom.");
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleActive(c: Coupon) {
    if (!window.confirm(`Deseja realmente ${c.active ? "inativar/excluir" : "reativar"} o cupom "${c.code}"?`)) return;
    try {
      await Api.setCouponActive(c.id, !c.active);
      toast.success(c.active ? "Cupom removido com sucesso." : "Cupom reativado.");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível alterar o cupom.");
    }
  }

  return (
    <div>
      <Card style={{ padding: "16px", marginBottom: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "18px", margin: "0 0 4px" }}>
            {editingId ? "Editar cupom" : "Novo cupom"}
          </h2>
          {editingId && (
            <Button variant="secondary" onClick={cancelEdit} disabled={busy}>
              Cancelar Edição
            </Button>
          )}
        </div>
        <Input label="Código" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
        <Select label="Tipo" value={kind} onChange={(e) => setKind(e.target.value as Coupon["kind"])}>
          <option value="MINUTOS_EXTRA">Minutos extras</option>
          <option value="DESCONTO_PCT">Desconto %</option>
          <option value="DESCONTO_VALOR">Desconto em R$</option>
        </Select>
        <Input label="Valor" type="number" value={value} onChange={(e) => setValue(e.target.value)} />
        <Input label="Descrição" value={description} onChange={(e) => setDescription(e.target.value)} />
        <Button variant="primary" disabled={busy || !code} onClick={save}>
          {editingId ? "Salvar cupom" : "Criar cupom"}
        </Button>
      </Card>
      {coupons.map((c) => (
        <Card key={c.id} style={{ padding: "12px", marginBottom: "8px", display: "flex", justifyContent: "space-between", alignItems: "center", opacity: c.active ? 1 : 0.5 }}>
          <span>
            <strong>{c.code}</strong> — {c.kind} ({c.value}) — usado {c.used_count}× {c.description ? `— ${c.description}` : ""}
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <Button variant="secondary" onClick={() => startEdit(c)} disabled={busy}>
              Editar
            </Button>
            {c.active ? (
              <Button variant="secondary" style={isOwner ? { color: "#d32f2f", borderColor: "#d32f2f" } : undefined} onClick={() => handleToggleActive(c)} disabled={busy}>
                {isOwner ? "Excluir" : "Inativar"}
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => handleToggleActive(c)} disabled={busy}>
                Reativar
              </Button>
            )}
          </span>
        </Card>
      ))}
    </div>
  );
}

function FidelidadeTab({ unitId, isQuiosque }: { unitId: string; isQuiosque: boolean }) {
  const toast = useToast();
  const [rules, setRules] = useState<LoyaltyRule[]>([]);
  const [triggerVisits, setTriggerVisits] = useState("10");
  const [rewardKind, setRewardKind] = useState<LoyaltyRule["rewardKind"]>("ENTRADA_GRATIS");
  const [rewardValue, setRewardValue] = useState("1");
  const [busy, setBusy] = useState(false);

  function load() {
    Api.loyaltyRules(unitId).then(setRules);
  }
  useEffect(load, [unitId]);

  async function create() {
    setBusy(true);
    try {
      await Api.createLoyaltyRule({
        unitId,
        activity: isQuiosque ? "CARRINHO" : "PLAYGROUND",
        triggerVisits: Number(triggerVisits),
        rewardKind,
        rewardValue: Number(rewardValue),
      });
      load();
      toast.success("Regra de fidelidade criada.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível criar a regra de fidelidade.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Card style={{ padding: "16px", marginBottom: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: "18px", margin: "0 0 4px" }}>Nova regra</h2>
        <Input label="A cada X visitas" type="number" value={triggerVisits} onChange={(e) => setTriggerVisits(e.target.value)} />
        <Select label="Recompensa" value={rewardKind} onChange={(e) => setRewardKind(e.target.value as LoyaltyRule["rewardKind"])}>
          <option value="ENTRADA_GRATIS">Entrada grátis</option>
          <option value="DESCONTO_PCT">Desconto %</option>
          <option value="MINUTOS_EXTRA">Minutos extras</option>
        </Select>
        <Input label="Valor" type="number" value={rewardValue} onChange={(e) => setRewardValue(e.target.value)} />
        <Button variant="primary" disabled={busy} onClick={create}>
          Criar regra
        </Button>
      </Card>
      {rules.map((r) => (
        <Card key={r.id} style={{ padding: "12px", marginBottom: "8px" }}>
          A cada {r.triggerVisits} visitas ({r.activity}) → {r.rewardKind} ({r.rewardValue})
        </Card>
      ))}
    </div>
  );
}

const CART_EMOJI_OPTIONS = ["🚙", "🚗", "🏎️", "🏍️", "🏁", "🚜", "🛺", "🚕"];
const CART_COLOR_OPTIONS = ["#F0196B", "#2ECFB5", "#FFE234", "#1A3F35", "#FF7A00", "#A020EE"];

const CART_PHOTO_ACCEPT = "image/jpeg,image/png";

function FrotaTab({ unitId }: { unitId: string }) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState(CART_EMOJI_OPTIONS[0]!);
  const [color, setColor] = useState(CART_COLOR_OPTIONS[0]!);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photoBusyFor, setPhotoBusyFor] = useState<string | null>(null);

  function load() {
    Api.assets(unitId).then(setAssets);
  }
  useEffect(load, [unitId]);

  function pickPhoto(file: File | null) {
    setError(null);
    if (!file) {
      setPhotoFile(null);
      setPhotoPreview(null);
      return;
    }
    if (file.type !== "image/jpeg" && file.type !== "image/png") {
      setError("A foto precisa ser um arquivo JPG ou PNG.");
      return;
    }
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const photoUrl = photoFile ? await Api.uploadAssetPhoto(unitId, photoFile) : null;
      await Api.createAsset({ unitId, name, emoji, color, maintenanceThresholdHours: 200, photoUrl });
      setName("");
      pickPhoto(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar o carrinho.");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(id: string, status: Asset["status"]) {
    await Api.setAssetStatus(id, status);
    load();
  }

  async function replacePhoto(asset: Asset, file: File | null) {
    if (!file) return;
    if (file.type !== "image/jpeg" && file.type !== "image/png") {
      setError("A foto precisa ser um arquivo JPG ou PNG.");
      return;
    }
    setPhotoBusyFor(asset.id);
    setError(null);
    try {
      const photoUrl = await Api.uploadAssetPhoto(unitId, file);
      await Api.setAssetPhoto(asset.id, photoUrl);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível trocar a foto.");
    } finally {
      setPhotoBusyFor(null);
    }
  }

  return (
    <div>
      <Card style={{ padding: "16px", marginBottom: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: "18px", margin: "0 0 4px" }}>Novo carrinho</h2>
        <Input label="Nome" value={name} onChange={(e) => setName(e.target.value)} />
        <div>
          <label>Emoji</label>
          <div style={{ display: "flex", gap: "4px" }}>
            {CART_EMOJI_OPTIONS.map((em) => (
              <Button
                key={em}
                variant={emoji === em ? "primary" : "ghost"}
                size="sm"
                onClick={() => setEmoji(em)}
                aria-pressed={emoji === em}
                aria-label={`Usar ${em} para este carrinho`}
              >
                {em}
              </Button>
            ))}
          </div>
        </div>
        <div>
          <label>Cor</label>
          <div style={{ display: "flex", gap: "4px" }}>
            {CART_COLOR_OPTIONS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={`Cor ${COLOR_NAMES[c] ?? c}`}
                aria-pressed={color === c}
                title={COLOR_NAMES[c] ?? c}
                style={{ width: "28px", height: "28px", borderRadius: "50%", background: c, border: color === c ? "3px solid var(--color-dark)" : "1px solid var(--border-subtle)" }}
              />
            ))}
          </div>
        </div>
        <div>
          <label>Foto do carrinho (opcional — JPG ou PNG)</label>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "4px" }}>
            {photoPreview && (
              <img src={photoPreview} alt="Pré-visualização" style={{ width: "56px", height: "56px", objectFit: "cover", borderRadius: "12px", border: "1px solid var(--border-subtle)" }} />
            )}
            <input type="file" accept={CART_PHOTO_ACCEPT} onChange={(e) => pickPhoto(e.target.files?.[0] ?? null)} />
          </div>
        </div>
        {error && <p style={{ color: "var(--color-error-text)", margin: 0 }}>{error}</p>}
        <Button variant="primary" loading={busy} disabled={busy || !name} onClick={create}>
          Criar carrinho
        </Button>
      </Card>

      {assets.map((a) => (
        <Card key={a.id} style={{ padding: "12px", marginBottom: "8px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {a.photo_url ? (
              <img src={a.photo_url} alt={a.name} style={{ width: "40px", height: "40px", objectFit: "cover", borderRadius: "10px", border: "1px solid var(--border-subtle)" }} />
            ) : (
              <span style={{ fontSize: "24px" }}>{a.emoji}</span>
            )}
            <span>
              {a.name} — {a.status} — {Math.round(a.odometer_minutes / 60)}h de uso
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <label style={{ fontSize: "12px", color: "var(--text-secondary)", cursor: "pointer" }} title="Trocar a foto deste carrinho">
              {photoBusyFor === a.id ? "Enviando…" : "🖼️ Trocar foto"}
              {/* .sr-only em vez de display:none: display:none tira o
                  input da ordem de tabulação — o upload de foto virava
                  mouse-only. .sr-only esconde visualmente mas mantém
                  focável, então Tab + Enter ainda abre o seletor de
                  arquivo do sistema. */}
              <input
                type="file"
                accept={CART_PHOTO_ACCEPT}
                className="sr-only"
                disabled={photoBusyFor === a.id}
                onChange={(e) => replacePhoto(a, e.target.files?.[0] ?? null)}
              />
            </label>
            <Button variant="ghost" size="sm" onClick={() => setStatus(a.id, "DISPONIVEL")}>
              disponível
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setStatus(a.id, "MANUTENCAO")}>
              manutenção
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}

const CONTRACT_TYPE_LABEL: Record<NonNullable<Employee["contract_type"]>, string> = {
  CLT: "CLT",
  ESTAGIO: "Estágio",
  AUTONOMO: "Autônomo",
};

/**
 * Aba própria para o Espelho de Ponto — separada de Colaboradores porque a
 * capacidade é outra (`relatorio.ponto`, concedida ao Líder) e a de
 * Colaboradores exige `config.employees.write` (só Owner). Um Líder de
 * turno gerando o espelho de ponto de terceiros é rotina; cadastrar ou
 * desligar colaborador não é — misturar as duas na mesma aba abriria a
 * segunda para quem só deveria ter a primeira.
 */
function EspelhoPontoTab({ unitId }: { unitId: string }) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [espelhoTarget, setEspelhoTarget] = useState<Employee | null>(null);

  useEffect(() => {
    // Escopo por unidade: esta tela é a versão de Configurações (por
    // unidade) do espelho de ponto, usada pelo Líder — que só deve ver
    // colaboradores da própria unidade. A visão cross-unit já existe
    // separadamente em Gerencial > Colaboradores > 📄 Ponto (Owner).
    Api.allEmployees().then((all) => setEmployees(all.filter((e) => e.unitIds?.includes(unitId))));
  }, [unitId]);

  return (
    <div>
      <HelpText style={{ marginBottom: "12px" }}>Toque num colaborador para gerar o espelho de ponto do mês desejado.</HelpText>
      {employees.map((e) => (
        <Card
          key={e.id}
          onClick={() => setEspelhoTarget(e)}
          style={{ padding: "12px", marginBottom: "8px", cursor: "pointer", opacity: e.active === false ? 0.5 : 1, display: "flex", justifyContent: "space-between", alignItems: "center" }}
        >
          <span>
            <strong>{e.full_name}</strong> — {ROLE_LABEL[e.role]}
            {e.position && <span style={{ color: "var(--text-muted)" }}> · {e.position}</span>}
          </span>
          <span aria-hidden>📄</span>
        </Card>
      ))}
      {employees.length === 0 && <p style={{ color: "var(--text-muted)" }}>Nenhum colaborador cadastrado.</p>}

      {espelhoTarget && <EspelhoPontoModal employee={espelhoTarget} onClose={() => setEspelhoTarget(null)} />}
    </div>
  );
}

/**
 * Nome exato da impressora tal como aparece no Windows (Painel de
 * Controle > Dispositivos e Impressoras) — não é uma lista buscada do
 * sistema operacional (o navegador não expõe isso a uma página web), é o
 * que o print bridge local (apps/kiosk) recebe para mandar o trabalho de
 * impressão direto pra fila do driver certo via Electron, sem diálogo.
 */
// Dados fictícios só para a visualização rápida abaixo — não representam
// nenhuma sessão ou venda real, existem só para o operador conferir o
// layout que vai sair na impressora antes de precisar de um check-in de
// verdade.
const SAMPLE_WRISTBAND = {
  wristbandCode: "A1B2C3",
  childName: "Nome da Criança",
  guardianName: "Nome do Responsável",
  phone: "(11) 99999-9999",
  planName: "Plano 2 horas",
  notes: undefined as string | undefined,
};

const SAMPLE_RECEIPT = generateEscPosReceipt({
  title: "Comprovante de Check-in",
  unitName: "Unidade Exemplo",
  employeeName: "Atendente Exemplo",
  code: "PED-000123",
  items: [
    { description: "Plano 2 horas", quantity: 1, amountCents: 6000 },
    { description: "Meia de antiderrapante", quantity: 1, amountCents: 1500 },
  ],
  totalCents: 7500,
  payments: [{ method: "Cartão de Crédito", amountCents: 7500 }],
});

const COMMON_WRISTBAND_PRINTERS = [
  "Apptech T271U",
  "Gainscha GS-2208D",
  "Zebra ZD220",
  "Zebra GC420t",
  "Argox OS-214plus",
  "Elgin L42 Pro",
];

const COMMON_RECEIPT_PRINTERS = [
  "Apptech T271U",
  "Elgin i9",
  "Elgin i8",
  "Bematech MP-4200 TH",
  "Epson TM-T20",
  "Daruma DR800",
  "POS-80",
];

function ImpressorasTab({ unitId }: { unitId: string }) {
  const toast = useToast();
  const [wristbandPrinter, setWristbandPrinter] = useState("");
  const [receiptPrinter, setReceiptPrinter] = useState("");
  const [saving, setSaving] = useState<"WRISTBAND" | "RECEIPT" | null>(null);
  const [testingReceipt, setTestingReceipt] = useState(false);
  const [testingWristband, setTestingWristband] = useState(false);
  const [showWristbandTestModal, setShowWristbandTestModal] = useState(false);

  useEffect(() => {
    Api.unitSetting(unitId, "printer_wristband").then((r) => setWristbandPrinter(r.value ?? ""));
    Api.unitSetting(unitId, "printer_receipt").then((r) => setReceiptPrinter(r.value ?? ""));
  }, [unitId]);

  async function save(kind: "WRISTBAND" | "RECEIPT") {
    setSaving(kind);
    try {
      const key = kind === "WRISTBAND" ? "printer_wristband" : "printer_receipt";
      await Api.setUnitSetting(unitId, key, kind === "WRISTBAND" ? wristbandPrinter : receiptPrinter);
      toast.success("Impressora salva com sucesso.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar a impressora.");
    } finally {
      setSaving(null);
    }
  }

  async function testReceiptPrint() {
    setTestingReceipt(true);
    try {
      await Api.queuePrintJob(unitId, "RECEIPT", {
        title: "Teste de Impressão",
        unitName: "Unidade FaçaAmigos",
        employeeName: "Operador Kiosk",
        code: "TESTE-T271U",
        items: [
          { description: "Cupom de Teste Apptech T271U", quantity: 1, amountCents: 0 },
          { description: "Verificação de Enquadramento", quantity: 1, amountCents: 0 },
        ],
        totalCents: 0,
        payments: [{ method: "Teste do Sistema", amountCents: 0 }],
        customerInfo: { childName: "Criança Teste", guardianName: "Responsável Teste" },
        footerNote: "Teste de enquadramento 80mm OK!",
      });
      toast.success("Cupom de teste enviado para a fila de impressão!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível enviar cupom de teste.");
    } finally {
      setTestingReceipt(false);
    }
  }

  async function testWristbandPrint() {
    setTestingWristband(true);
    try {
      await Api.queuePrintJob(unitId, "WRISTBAND", {
        wristbandCode: "TESTE-01",
        childName: "Criança Teste",
        guardianName: "Responsável Teste",
        phone: "(11) 99999-9999",
        planName: "Plano Teste 1h",
        notes: "Teste de enquadramento OK",
        entryTime: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
      });
      toast.success("Pulseira de teste enviada para a fila de impressão!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível enviar pulseira de teste.");
    } finally {
      setTestingWristband(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <p style={{ color: "var(--text-muted)", fontSize: "13px", margin: 0 }}>
        Digite ou selecione o nome exato da impressora como ela aparece instalada no Windows deste terminal (Painel de Controle &gt; Dispositivos e Impressoras). O print bridge local usa esse nome para
        imprimir direto, sem abrir diálogo nenhum na tela.
      </p>

      {/* IMPRESSORA DE PULSEIRAS */}
      <Card style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: "16px", margin: "0 0 4px" }}>Impressora de Pulseiras</h2>
        <Input placeholder="Ex: Gainscha GS-2208D, Zebra ZD220" value={wristbandPrinter} onChange={(e) => setWristbandPrinter(e.target.value)} />
        
        <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: "12px", color: "var(--text-muted)", fontWeight: 600 }}>Clique para escolher:</span>
          {COMMON_WRISTBAND_PRINTERS.map((model) => (
            <Button
              key={model}
              variant={wristbandPrinter === model ? "primary" : "ghost"}
              size="sm"
              onClick={() => setWristbandPrinter(model)}
            >
              + {model}
            </Button>
          ))}
        </div>

        <div style={{ display: "flex", gap: "8px", marginTop: "4px", flexWrap: "wrap" }}>
          <Button variant="primary" size="sm" loading={saving === "WRISTBAND"} onClick={() => save("WRISTBAND")}>
            Salvar Impressora
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setShowWristbandTestModal(true)}>
            🖨️ Abrir Diálogo / Imprimir Pulseira de Teste
          </Button>
          <Button variant="ghost" size="sm" loading={testingWristband} onClick={testWristbandPrint} title="Enviar job diretamente para a fila de impressão do Electron (print bridge)">
            ⚡ Enviar para Fila de Impressão
          </Button>
        </div>

        {showWristbandTestModal && (
          <WristbandPrintModal
            data={SAMPLE_WRISTBAND}
            onClose={() => setShowWristbandTestModal(false)}
          />
        )}
      </Card>

      {/* IMPRESSORA DE CUPONS NÃO FISCAIS */}
      <Card style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: "16px", margin: "0 0 4px" }}>Impressora de Cupons Não Fiscais (80mm / Apptech T271U)</h2>
        <Input placeholder="Ex: Apptech T271U, Elgin i9, POS-80" value={receiptPrinter} onChange={(e) => setReceiptPrinter(e.target.value)} />
        
        <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: "12px", color: "var(--text-muted)", fontWeight: 600 }}>Clique para escolher:</span>
          {COMMON_RECEIPT_PRINTERS.map((model) => (
            <Button
              key={model}
              variant={receiptPrinter === model ? "primary" : "ghost"}
              size="sm"
              onClick={() => setReceiptPrinter(model)}
            >
              + {model}
            </Button>
          ))}
        </div>

        <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
          <Button variant="primary" size="sm" loading={saving === "RECEIPT"} onClick={() => save("RECEIPT")}>
            Salvar Impressora
          </Button>
          <Button variant="secondary" size="sm" loading={testingReceipt} onClick={testReceiptPrint}>
            🖨️ Enviar Cupom de Teste
          </Button>
        </div>
      </Card>

      {/* VISUALIZAÇÃO RÁPIDA */}
      <div>
        <h2 style={{ margin: "0 0 4px 0", fontSize: "16px" }}>Visualização rápida de impressão</h2>
        <p style={{ color: "var(--text-muted)", fontSize: "13px", margin: "0 0 12px 0" }}>
          Layout em tempo real — mostra o enquadramento exato de 42 colunas como sairá na impressora Apptech T271U.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <Card style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
            <h3 style={{ margin: 0, fontSize: "13px", color: "var(--text-muted)" }}>Pulseira (Gainscha / Zebra — 20mm × 270mm)</h3>
            <div
              style={{
                background: "#ffffff",
                color: "#141414",
                padding: "8px 16px",
                borderRadius: "12px",
                border: "2px dashed var(--border-subtle)",
                fontFamily: "var(--font-body)",
                overflowX: "auto",
              }}
            >
              <WristbandLabelPreview data={SAMPLE_WRISTBAND} entryTime="14:32" />
            </div>
          </Card>
          <Card style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
            <h3 style={{ margin: 0, fontSize: "13px", color: "var(--text-muted)" }}>Cupom não fiscal (Apptech T271U / 80mm - 42 Colunas)</h3>
            <pre
              style={{
                background: "#ffffff",
                color: "#141414",
                padding: "12px",
                borderRadius: "12px",
                border: "2px dashed var(--border-subtle)",
                fontFamily: '"Consolas", "Courier New", monospace',
                fontSize: "11px",
                lineHeight: "1.25",
                fontWeight: 600,
                whiteSpace: "pre",
                maxHeight: "340px",
                overflowX: "auto",
                overflowY: "auto",
                margin: 0,
              }}
            >
              {SAMPLE_RECEIPT.text}
            </pre>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Unidade
// ---------------------------------------------------------------------------
// Migrada de apps/backoffice/src/app/(app)/unidades/page.tsx. A escrita não é
// mais um UPDATE direto na tabela: passa por fa_config_update_unit, que confere
// config.unit.write no servidor e audita a alteração.
function UnidadeTab({ unitId }: { unitId: string }) {
  const toast = useToast();
  const { units } = useAppState();
  const unit = units.find((u) => u.id === unitId);

  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("America/Belem");
  const [cutoffHour, setCutoffHour] = useState("4");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!unit) return;
    setName(unit.name);
    setCutoffHour(String(unit.business_day_cutoff_hour ?? 4));
    setAddress(unit.address ?? "");
    setPhone(unit.phone ?? "");
  }, [unit?.id]);

  async function save() {
    setSaving(true);
    try {
      await Api.updateUnit(unitId, {
        name,
        timezone,
        businessDayCutoffHour: Number(cutoffHour),
        address: address || null,
        phone: phone || null,
      });
      toast.success("Dados da unidade salvos. Recarregue a página para ver o nome no cabeçalho.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar a unidade.");
    } finally {
      setSaving(false);
    }
  }

  // Mesmo endereço público usado no QR de acompanhamento (EntradaScreen) e
  // no pareamento de celular/tablet (ConnectDeviceModal) — no Electron
  // local, window.location.origin é 127.0.0.1, que o celular de quem
  // escaneia o cartaz na entrada não alcança.
  const envAppUrl = import.meta.env.VITE_PUBLIC_APP_URL as string | undefined;
  const isLocalOrigin = ["127.0.0.1", "localhost"].includes(window.location.hostname);
  const publicAppOrigin = envAppUrl ?? (isLocalOrigin ? undefined : window.location.origin);
  const acessoRapidoUrl = publicAppOrigin ? `${publicAppOrigin.replace(/\/$/, "")}/?acesso-rapido=${unitId}` : null;
  const [printingPoster, setPrintingPoster] = useState(false);

  async function printPoster() {
    if (!acessoRapidoUrl || !unit) return;
    setPrintingPoster(true);
    try {
      const qrDataUrl = await generateWristbandQRCodeDataUrl(acessoRapidoUrl, 480);
      printContract(buildAcessoRapidoPosterHtml({ unitName: unit.name, qrDataUrl, url: acessoRapidoUrl }));
    } finally {
      setPrintingPoster(false);
    }
  }

  if (!unit) return <HelpText>Unidade não encontrada.</HelpText>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <Card style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: "18px", margin: 0 }}>Identificação</h2>
        <Input label="Nome da unidade" value={name} onChange={(e) => setName(e.target.value)} />
        <Input
          label="Tipo"
          value={unit.kind === "QUIOSQUE" ? "Quiosque (Circuito)" : "Loja (Playground)"}
          disabled
          title="O tipo define quais telas e planos a unidade usa; mudá-lo depois invalidaria as sessões e planos já cadastrados, por isso não é editável."
        />
        <Select label="Fuso horário" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
          <option value="America/Belem">America/Belem (Pará)</option>
          <option value="America/Sao_Paulo">America/Sao_Paulo</option>
          <option value="America/Manaus">America/Manaus</option>
          <option value="America/Fortaleza">America/Fortaleza</option>
        </Select>
        <Input
          label="Hora da virada do dia operacional"
          type="number"
          value={cutoffHour}
          onChange={(e) => setCutoffHour(e.target.value)}
        />
        <HelpText>
          Uma venda feita às 2h da manhã ainda conta no movimento do dia anterior até esta hora. Com 4, o dia
          operacional vai das 4h de um dia às 3h59 do seguinte — é o que faz o fechamento de caixa da madrugada bater.
        </HelpText>
      </Card>

      <Card style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: "18px", margin: 0 }}>Cabeçalho do cupom</h2>
        <HelpText>O que sai impresso no topo do comprovante entregue ao responsável.</HelpText>
        <Input label="Endereço" value={address} onChange={(e) => setAddress(e.target.value)} />
        <Input label="Telefone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <HelpText>
          O CNPJ do cupom vem da aba Dados Fiscais — é o mesmo do emitente da nota, e ter dois campos para digitá-lo
          é o caminho mais curto para eles divergirem.
        </HelpText>
      </Card>

      <Card style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "10px" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: "18px", margin: 0 }}>QR Code de Acesso Rápido</h2>
        <HelpText>
          Cartaz para fixar na entrada da unidade: o responsável escaneia, preenche os dados da criança e do
          responsável pelo próprio celular, escolhe o plano e aceita os Termos de Uso — os dados já chegam prontos
          para o educador só confirmar a entrada no Painel.
        </HelpText>
        {acessoRapidoUrl ? (
          <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
            <WristbandQRCode value={acessoRapidoUrl} size={120} />
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <HelpText style={{ margin: 0, wordBreak: "break-all" }}>{acessoRapidoUrl}</HelpText>
              <Button variant="secondary" loading={printingPoster} disabled={printingPoster} onClick={printPoster} style={{ alignSelf: "flex-start" }}>
                🖨️ Imprimir cartaz (A4)
              </Button>
            </div>
          </div>
        ) : (
          <HelpText>
            Este computador está rodando no endereço local ({window.location.origin}), que o celular do responsável
            não alcança. Defina <code>VITE_PUBLIC_APP_URL</code> (URL do deploy na Vercel) no build para o QR
            funcionar aqui — o mesmo endereço já usado em "Conectar celular ou tablet" e no QR de acompanhamento.
          </HelpText>
        )}
      </Card>

      <Button variant="primary" disabled={saving || !name} onClick={save}>
        Salvar unidade
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dados Fiscais
// ---------------------------------------------------------------------------
const CRT_OPTIONS = [
  { value: 1, label: "1 — Simples Nacional" },
  { value: 2, label: "2 — Simples Nacional, excesso de sublimite" },
  { value: 3, label: "3 — Regime Normal" },
];

const ORIGEM_OPTIONS = [
  { value: 0, label: "0 — Nacional" },
  { value: 1, label: "1 — Estrangeira, importação direta" },
  { value: 2, label: "2 — Estrangeira, adquirida no mercado interno" },
];

const HEARTBEAT_STALE_MS = 30 * 60 * 1000;

function FiscalTab({ unitId }: { unitId: string }) {
  const toast = useToast();
  const [fiscal, setFiscal] = useState<UnitFiscal | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [products, setProducts] = useState<ProductFiscal[]>([]);
  const [status, setStatus] = useState<FiscalTerminalStatus[]>([]);
  const [saving, setSaving] = useState(false);

  function load() {
    Api.unitFiscal(unitId)
      .then((f) => {
        setFiscal(f);
        setForm({
          cnpj: f.cnpj ?? "",
          razaoSocial: f.razao_social ?? "",
          nomeFantasia: f.nome_fantasia ?? "",
          inscricaoEstadual: f.inscricao_estadual ?? "",
          inscricaoMunicipal: f.inscricao_municipal ?? "",
          cnaePrincipal: f.cnae_principal ?? "",
          crt: String(f.crt ?? 1),
          endLogradouro: f.end_logradouro ?? "",
          endNumero: f.end_numero ?? "",
          endComplemento: f.end_complemento ?? "",
          endBairro: f.end_bairro ?? "",
          endMunicipioIbge: f.end_municipio_ibge ?? "1501402",
          endUf: f.end_uf ?? "PA",
          endCep: f.end_cep ?? "",
          fone: f.fone ?? "",
          fiscalAmbiente: f.fiscal_ambiente ?? "HOMOLOGACAO",
          fiscalEnabled: String(f.fiscal_enabled ?? false),
          nfceSerie: String(f.nfce_serie ?? 1),
          nfceCscId: f.nfce_csc_id ?? "",
          nfceQrcodeUrlConsulta: f.nfce_qrcode_url_consulta ?? "",
          nfseItemListaServico: f.nfse_item_lista_servico ?? "",
          nfseCodigoTributacaoMunicipio: f.nfse_codigo_tributacao_municipio ?? "",
          nfseAliquotaIssBp: String(f.nfse_aliquota_iss_bp ?? 0),
          nfseIssRetido: String(f.nfse_iss_retido ?? false),
          nfseRegimeEspecial: String(f.nfse_regime_especial ?? 6),
          nfseSerieRps: f.nfse_serie_rps ?? "1",
          nfseAmbiente: f.nfse_ambiente ?? "HOMOLOGACAO",
          nfseEnabled: String(f.nfse_enabled ?? false),
        });
      })
      .catch(() => toast.error("Não foi possível carregar os dados fiscais."));
    Api.productsFiscal(unitId)
      .then(setProducts)
      .catch(() => setProducts([]));
    Api.fiscalTerminalStatus(unitId)
      .then(setStatus)
      .catch(() => setStatus([]));
  }
  useEffect(load, [unitId]);

  function set(key: string, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save() {
    setSaving(true);
    try {
      await Api.updateUnitFiscal(unitId, form);
      toast.success("Dados fiscais salvos.");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar os dados fiscais.");
    } finally {
      setSaving(false);
    }
  }

  if (!fiscal) return <HelpText>Carregando…</HelpText>;

  const nowMs = Date.now();
  const missingNcm = products.filter((p) => !p.ncm);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <Card style={{ padding: "16px" }}>
        <HelpText>
          Confira estes dados com seu contador antes de ligar a emissão. Nada aqui é segredo: o token do CSC e o
          certificado A1 (.pfx) ficam só no cofre do PC do balcão, nunca no sistema.
        </HelpText>
      </Card>

      <Card style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: "18px", margin: 0 }}>Emitente</h2>
        <Input label="CNPJ" value={form.cnpj ?? ""} onChange={(e) => set("cnpj", e.target.value)} />
        <Input label="Razão social" value={form.razaoSocial ?? ""} onChange={(e) => set("razaoSocial", e.target.value)} />
        <Input label="Nome fantasia" value={form.nomeFantasia ?? ""} onChange={(e) => set("nomeFantasia", e.target.value)} />
        <Input label="Inscrição estadual" value={form.inscricaoEstadual ?? ""} onChange={(e) => set("inscricaoEstadual", e.target.value)} />
        <Input label="Inscrição municipal" value={form.inscricaoMunicipal ?? ""} onChange={(e) => set("inscricaoMunicipal", e.target.value)} />
        <Input label="CNAE principal" value={form.cnaePrincipal ?? ""} onChange={(e) => set("cnaePrincipal", e.target.value)} />
        <Select label="Regime tributário (CRT)" value={form.crt ?? "1"} onChange={(e) => set("crt", e.target.value)}>
          {CRT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </Card>

      <Card style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: "18px", margin: 0 }}>Endereço do emitente</h2>
        <Input label="Logradouro" value={form.endLogradouro ?? ""} onChange={(e) => set("endLogradouro", e.target.value)} />
        <Input label="Número" value={form.endNumero ?? ""} onChange={(e) => set("endNumero", e.target.value)} />
        <Input label="Complemento" value={form.endComplemento ?? ""} onChange={(e) => set("endComplemento", e.target.value)} />
        <Input label="Bairro" value={form.endBairro ?? ""} onChange={(e) => set("endBairro", e.target.value)} />
        <Input label="Código IBGE do município" value={form.endMunicipioIbge ?? ""} onChange={(e) => set("endMunicipioIbge", e.target.value)} />
        <Input label="UF" value={form.endUf ?? ""} onChange={(e) => set("endUf", e.target.value.toUpperCase().slice(0, 2))} />
        <Input label="CEP" value={form.endCep ?? ""} onChange={(e) => set("endCep", e.target.value)} />
        <Input label="Telefone" value={form.fone ?? ""} onChange={(e) => set("fone", e.target.value)} />
      </Card>

      <Card style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: "18px", margin: 0 }}>NFC-e — venda de produtos</h2>
        <HelpText>
          Nota de mercadoria (modelo 65). No Pará a autorização é feita pela SVRS desde que a SEFA-PA desativou os
          webservices próprios — o que continua estadual é a inscrição, o credenciamento e o CSC.
        </HelpText>
        <Select label="Ambiente" value={form.fiscalAmbiente ?? "HOMOLOGACAO"} onChange={(e) => set("fiscalAmbiente", e.target.value)}>
          <option value="HOMOLOGACAO">Homologação (teste, sem valor fiscal)</option>
          <option value="PRODUCAO">Produção (nota válida)</option>
        </Select>
        <Input label="Série" type="number" value={form.nfceSerie ?? "1"} onChange={(e) => set("nfceSerie", e.target.value)} />
        <Input label="ID do CSC (ex.: 000001)" value={form.nfceCscId ?? ""} onChange={(e) => set("nfceCscId", e.target.value)} />
        <Input label="URL de consulta do QR Code" value={form.nfceQrcodeUrlConsulta ?? ""} onChange={(e) => set("nfceQrcodeUrlConsulta", e.target.value)} />
        <Select label="Emissão de NFC-e" value={form.fiscalEnabled ?? "false"} onChange={(e) => set("fiscalEnabled", e.target.value)}>
          <option value="false">Desligada</option>
          <option value="true">Ligada</option>
        </Select>
        <HelpText>
          Só ligue depois de uma semana inteira emitindo em homologação sem rejeição. Com a emissão ligada e um
          produto sem NCM, a venda continua acontecendo normalmente — o documento é que fica bloqueado para correção,
          nunca o caixa.
        </HelpText>
        {missingNcm.length > 0 && form.fiscalEnabled === "true" && (
          <p style={{ color: "var(--color-error-text)", margin: 0 }}>
            {missingNcm.length} produto(s) sem NCM: {missingNcm.map((p) => p.name).join(", ")}.
          </p>
        )}
      </Card>

      <Card style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: "18px", margin: 0 }}>NFS-e — sessões de brincar</h2>
        <HelpText>
          Nota de serviço (ISS, Prefeitura de Belém). Esta aba guarda o CADASTRO; a emissão automática ainda não
          existe no sistema — ligar a chave abaixo registra a intenção e não emite nada por si só.
        </HelpText>
        <Input label="Item da lista de serviços (LC 116)" value={form.nfseItemListaServico ?? ""} onChange={(e) => set("nfseItemListaServico", e.target.value)} />
        <Input label="Código de tributação do município" value={form.nfseCodigoTributacaoMunicipio ?? ""} onChange={(e) => set("nfseCodigoTributacaoMunicipio", e.target.value)} />
        <Input
          label="Alíquota de ISS (%)"
          type="number"
          step="0.01"
          value={((Number(form.nfseAliquotaIssBp ?? 0) || 0) / 100).toString()}
          onChange={(e) => set("nfseAliquotaIssBp", String(Math.round(Number(e.target.value) * 100)))}
        />
        <Select label="ISS retido na fonte" value={form.nfseIssRetido ?? "false"} onChange={(e) => set("nfseIssRetido", e.target.value)}>
          <option value="false">Não</option>
          <option value="true">Sim</option>
        </Select>
        <Input label="Regime especial de tributação" type="number" value={form.nfseRegimeEspecial ?? "6"} onChange={(e) => set("nfseRegimeEspecial", e.target.value)} />
        <Input label="Série do RPS" value={form.nfseSerieRps ?? "1"} onChange={(e) => set("nfseSerieRps", e.target.value)} />
        <Select label="Ambiente" value={form.nfseAmbiente ?? "HOMOLOGACAO"} onChange={(e) => set("nfseAmbiente", e.target.value)}>
          <option value="HOMOLOGACAO">Homologação</option>
          <option value="PRODUCAO">Produção</option>
        </Select>
        <Select label="Emissão de NFS-e" value={form.nfseEnabled ?? "false"} onChange={(e) => set("nfseEnabled", e.target.value)}>
          <option value="false">Desligada</option>
          <option value="true">Ligada (quando a emissão existir)</option>
        </Select>
      </Card>

      <Button variant="primary" disabled={saving} onClick={save}>
        Salvar dados fiscais
      </Button>

      <Card style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: "18px", margin: 0 }}>Tributação por produto</h2>
        <HelpText>Sem NCM, CFOP e CSOSN preenchidos, a NFC-e do item é rejeitada pela SEFAZ.</HelpText>
        {products.length === 0 && <HelpText>Nenhum produto cadastrado nesta unidade.</HelpText>}
        {products.map((p) => (
          <ProdutoFiscalRow key={p.id} product={p} onSaved={load} />
        ))}
      </Card>

      <Card style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: "18px", margin: 0 }}>Emissor no PC do balcão</h2>
        {status.length === 0 && <HelpText>Nenhum terminal reportou ainda.</HelpText>}
        {status.map((s) => {
          const ageMs = nowMs - s.last_heartbeat_ms;
          const stale = ageMs > HEARTBEAT_STALE_MS;
          const certExpired = s.cert_not_after_ms != null && s.cert_not_after_ms < nowMs;
          return (
            <Card key={s.terminal_id} style={{ padding: "12px" }}>
              <strong>{s.terminal_id}</strong> · {s.environment ?? "—"}
              <div style={{ fontSize: "13px", color: stale ? "var(--color-error-text)" : "var(--text-secondary)" }}>
                {stale ? `Sem contato há ${Math.round(ageMs / 60000)} min` : "Ativo"}
                {certExpired && " · certificado vencido"}
                {!s.csc_configured && " · CSC não configurado"}
                {s.last_error && ` · último erro: ${s.last_error}`}
              </div>
            </Card>
          );
        })}
      </Card>
    </div>
  );
}

function ProdutoFiscalRow({ product, onSaved }: { product: ProductFiscal; onSaved: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ncm, setNcm] = useState(product.ncm ?? "");
  const [cest, setCest] = useState(product.cest ?? "");
  const [cfop, setCfop] = useState(product.cfop ?? "5102");
  const [csosn, setCsosn] = useState(product.csosn ?? "102");
  const [origem, setOrigem] = useState(String(product.origem ?? 0));
  const [unidadeComercial, setUnidadeComercial] = useState(product.unidade_comercial ?? "UN");
  const [gtin, setGtin] = useState(product.gtin ?? "SEM GTIN");
  const [pisCst, setPisCst] = useState(product.pis_cst ?? "49");
  const [cofinsCst, setCofinsCst] = useState(product.cofins_cst ?? "49");

  async function save() {
    setSaving(true);
    try {
      await Api.updateProductFiscal(product.id, {
        ncm,
        cest,
        cfop,
        csosn,
        origem: Number(origem),
        unidadeComercial,
        gtin,
        pisCst,
        cofinsCst,
      });
      toast.success(`Tributação de ${product.name} salva.`);
      setOpen(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card style={{ padding: "12px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>
          <strong>{product.name}</strong>{" "}
          {product.ncm ? (
            <span style={{ color: "var(--text-muted)" }}>NCM {product.ncm}</span>
          ) : (
            <span style={{ color: "var(--color-error-text)" }}>sem NCM</span>
          )}
        </span>
        <Button variant="ghost" size="sm" onClick={() => setOpen((o) => !o)}>
          {open ? "fechar" : "editar"}
        </Button>
      </div>
      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "8px" }}>
          <Input label="NCM" value={ncm} onChange={(e) => setNcm(e.target.value)} />
          <Input label="CEST (se houver)" value={cest} onChange={(e) => setCest(e.target.value)} />
          <Input label="CFOP" value={cfop} onChange={(e) => setCfop(e.target.value)} />
          <Input label="CSOSN" value={csosn} onChange={(e) => setCsosn(e.target.value)} />
          <Select label="Origem" value={origem} onChange={(e) => setOrigem(e.target.value)}>
            {ORIGEM_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <Input label="Unidade comercial" value={unidadeComercial} onChange={(e) => setUnidadeComercial(e.target.value)} />
          <Input label="GTIN / código de barras" value={gtin} onChange={(e) => setGtin(e.target.value)} />
          <Input label="CST PIS" value={pisCst} onChange={(e) => setPisCst(e.target.value)} />
          <Input label="CST COFINS" value={cofinsCst} onChange={(e) => setCofinsCst(e.target.value)} />
          <HelpText style={{ margin: 0 }}>
            04 = monofásico, revenda a alíquota zero (bebidas frias). 49 = outras operações — o padrão para itens que
            não são monofásicos. Confirme com o contador antes de mudar.
          </HelpText>
          <Button variant="primary" disabled={saving} onClick={save}>
            Salvar tributação
          </Button>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Termos de Uso
// ---------------------------------------------------------------------------
// Aba própria, e não um campo dentro de Meta: é o texto que o responsável
// aceita no check-in, então alterá-lo tem efeito jurídico. Grava por
// fa_config_set_terms, que exige config.terms.write e guarda o texto INTEIRO na
// trilha de auditoria — a pergunta que importa depois é "o que exatamente foi
// aceito naquele dia", não "mudou alguma coisa".
function TermosTab({ unitId }: { unitId: string }) {
  const toast = useToast();
  const [terms, setTerms] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Api.unitSetting(unitId, "terms_of_use")
      .then((r) => setTerms(r.value ?? ""))
      .finally(() => setLoaded(true));
  }, [unitId]);

  async function save() {
    setSaving(true);
    try {
      await Api.setTerms(unitId, terms);
      toast.success("Termos de uso salvos.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar os termos de uso.");
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return <HelpText>Carregando…</HelpText>;

  return (
    <Card style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
      <h2 style={{ fontFamily: "var(--font-display)", fontSize: "18px", margin: 0 }}>Termos de Uso</h2>
      <HelpText>
        Texto impresso no comprovante de entrada e apresentado ao responsável no check-in. Cada alteração fica
        registrada com autor, data e o texto completo.
      </HelpText>
      <textarea
        value={terms}
        onChange={(e) => setTerms(e.target.value)}
        rows={16}
        aria-label="Texto dos Termos de Uso"
        style={{
          width: "100%",
          padding: "10px",
          borderRadius: "12px",
          border: "1px solid var(--border-subtle)",
          fontFamily: "inherit",
          lineHeight: 1.5,
        }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>{terms.length} caracteres</span>
        <Button variant="primary" disabled={saving} onClick={save}>
          Salvar termos
        </Button>
      </div>
    </Card>
  );
}

