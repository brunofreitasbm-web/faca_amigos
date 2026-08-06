import { useEffect, useState } from "react";
import { Button, Card, Input, Tabs } from "@facaamigos/ui";
import { Api } from "../api/client.js";
import type { Asset, BonusRule, Coupon, Employee, LoyaltyRule, Plan, Product } from "../api/client.js";
import { useAppState } from "../state/AppState.js";
import { useToast } from "../state/ToastContext.js";
import { EmployeeAuthGate } from "../components/EmployeeAuthGate.js";
import type { TerminalEmployee } from "../lib/supabase/terminalAuth.js";
import { money } from "../format.js";

type Tab = "PLANOS" | "PRODUTOS" | "CUPONS" | "FIDELIDADE" | "META" | "FROTA" | "COLABORADORES";

export function ConfiguracoesScreen() {
  const { unit } = useAppState();
  const isQuiosque = unit?.kind === "QUIOSQUE";
  const [tab, setTab] = useState<Tab>("PLANOS");

  if (!unit) return null;

  const tabs: { value: Tab; label: string }[] = [
    { value: "PLANOS", label: "Planos de Preços" },
    { value: "PRODUTOS", label: "Produtos" },
    { value: "CUPONS", label: "Cupons" },
    { value: "FIDELIDADE", label: "Fidelidade" },
    { value: "META", label: "Meta" },
    ...(isQuiosque ? ([{ value: "FROTA", label: "Frota" }] as const) : []),
    { value: "COLABORADORES", label: "Colaboradores" },
  ];

  return (
    <div style={{ padding: "24px", maxWidth: "900px", margin: "0 auto" }}>
      <h1 style={{ fontFamily: "var(--font-display)" }}>Configurações</h1>
      <Tabs value={tab} onChange={setTab} tabs={tabs} />

      <div role="tabpanel">
        {tab === "PLANOS" && <PlanosTab unitId={unit.id} activity={isQuiosque ? "CARRINHO" : "PLAYGROUND"} />}
        {tab === "PRODUTOS" && <ProdutosTab unitId={unit.id} />}
        {tab === "CUPONS" && <CuponsTab unitId={unit.id} />}
        {tab === "FIDELIDADE" && <FidelidadeTab unitId={unit.id} isQuiosque={isQuiosque} />}
        {tab === "META" && <MetaTab unitId={unit.id} isQuiosque={isQuiosque} />}
        {tab === "FROTA" && isQuiosque && <FrotaTab unitId={unit.id} />}
        {tab === "COLABORADORES" && <ColaboradoresTab />}
      </div>
    </div>
  );
}

function MetaTab({ unitId, isQuiosque }: { unitId: string; isQuiosque: boolean }) {
  const toast = useToast();
  const [goalReais, setGoalReais] = useState("0");
  const [savingGoal, setSavingGoal] = useState(false);
  const [rules, setRules] = useState<BonusRule[]>([]);
  const [ruleDescription, setRuleDescription] = useState("");
  const [ruleValueReais, setRuleValueReais] = useState("0");
  const [busyRule, setBusyRule] = useState(false);
  const [termsOfUse, setTermsOfUse] = useState("");
  const [savingTerms, setSavingTerms] = useState(false);
  const [closingTime, setClosingTime] = useState("");
  const [savingClosingTime, setSavingClosingTime] = useState(false);

  function loadGoal() {
    Api.unitSetting(unitId, "daily_goal_cents").then((r) => setGoalReais(((Number(r.value) || 0) / 100).toString()));
  }
  function loadRules() {
    Api.bonusRules(unitId).then(setRules);
  }
  function loadTerms() {
    if (isQuiosque) Api.unitSetting(unitId, "terms_of_use").then((r) => setTermsOfUse(r.value ?? ""));
  }
  function loadClosingTime() {
    Api.unitSetting(unitId, "closing_time").then((r) => setClosingTime(r.value ?? ""));
  }
  useEffect(loadGoal, [unitId]);
  useEffect(loadRules, [unitId]);
  useEffect(loadTerms, [unitId, isQuiosque]);
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

  async function createRule() {
    setBusyRule(true);
    try {
      await Api.createBonusRule({ unitId, description: ruleDescription, rewardValueCents: Math.round(Number(ruleValueReais) * 100) });
      setRuleDescription("");
      loadRules();
      toast.success("Regra de bonificação criada.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível criar a regra.");
    } finally {
      setBusyRule(false);
    }
  }

  async function saveTerms() {
    setSavingTerms(true);
    try {
      await Api.setUnitSetting(unitId, "terms_of_use", termsOfUse);
      toast.success("Termos de uso salvos.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar os termos de uso.");
    } finally {
      setSavingTerms(false);
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
        <h2 title="Recompensas para o colaborador quando a meta diária é batida">Regras de Bonificação</h2>
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
        <Button variant="primary" disabled={busyRule || !ruleDescription} onClick={createRule} title="Criar nova regra de bonificação">
          Criar regra
        </Button>
        {rules.map((r) => (
          <Card key={r.id} style={{ padding: "12px", display: "flex", justifyContent: "space-between" }}>
            <span>{r.description}</span>
            <strong>{money(r.rewardValueCents)}</strong>
          </Card>
        ))}
      </Card>

      {isQuiosque && (
        <Card style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
          <h2 title="Texto impresso no cupom não fiscal de entrada do módulo Circuito">Termos de Uso (Circuito)</h2>
          <label>Texto dos Termos de Uso</label>
          <textarea
            value={termsOfUse}
            onChange={(e) => setTermsOfUse(e.target.value)}
            rows={6}
            title="Texto que aparecerá impresso no cupom não fiscal de cada entrada do Circuito"
            style={{ width: "100%", padding: "10px", borderRadius: "12px", border: "1px solid var(--border-subtle)", fontFamily: "inherit" }}
          />
          <Button variant="primary" disabled={savingTerms} onClick={saveTerms} title="Salvar os Termos de Uso">
            Salvar Termos de Uso
          </Button>
        </Card>
      )}
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
  const [plans, setPlans] = useState<Plan[]>([]);
  const [name, setName] = useState("");
  const [valueReais, setValueReais] = useState("0");
  const [durationValue, setDurationValue] = useState("15");
  const [durationUnit, setDurationUnit] = useState<"MINUTO" | "HORA">("MINUTO");
  const [overageReais, setOverageReais] = useState("1");
  const [color, setColor] = useState(PLAN_COLOR_OPTIONS[0]!);
  const [busy, setBusy] = useState(false);

  function load() {
    Api.plans(unitId, activity).then(setPlans);
  }
  useEffect(load, [unitId, activity]);

  async function create() {
    setBusy(true);
    try {
      await Api.createPlan({
        unitId,
        activity,
        name,
        valueCents: Math.round(Number(valueReais) * 100),
        durationValue: Number(durationValue),
        durationUnit,
        overageCentsPerMinute: Math.round(Number(overageReais) * 100),
        color,
      });
      setName("");
      load();
      toast.success("Plano criado.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível criar o plano.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Card style={{ padding: "16px", marginBottom: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
        <h2>Novo plano</h2>
        <Input label="Nome" value={name} onChange={(e) => setName(e.target.value)} />
        <Input label="Valor (R$)" type="number" value={valueReais} onChange={(e) => setValueReais(e.target.value)} />
        <div style={{ display: "flex", gap: "8px" }}>
          <Input label="Duração" type="number" value={durationValue} onChange={(e) => setDurationValue(e.target.value)} />
          <div>
            <label>Unidade</label>
            <select value={durationUnit} onChange={(e) => setDurationUnit(e.target.value as "MINUTO" | "HORA")}>
              <option value="MINUTO">minuto(s)</option>
              <option value="HORA">hora(s)</option>
            </select>
          </div>
        </div>
        <Input label="Excedente por minuto (R$)" type="number" value={overageReais} onChange={(e) => setOverageReais(e.target.value)} />
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
        <Button variant="primary" disabled={busy || !name} onClick={create}>
          Criar plano
        </Button>
      </Card>

      {plans.map((p) => (
        <Card key={p.id} style={{ padding: "12px", marginBottom: "8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ width: "14px", height: "14px", borderRadius: "50%", background: p.color, display: "inline-block" }} />
            {p.name} — {p.durationValue} {p.durationUnit.toLowerCase()}
          </span>
          <span>
            {money(p.valueCents)} + {money(p.overageCentsPerMinute)}/min excedente
          </span>
        </Card>
      ))}
    </div>
  );
}

function ProdutosTab({ unitId }: { unitId: string }) {
  const toast = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [name, setName] = useState("");
  const [priceReais, setPriceReais] = useState("0");
  const [stock, setStock] = useState("0");
  const [emoji, setEmoji] = useState("🛍️");
  const [busy, setBusy] = useState(false);

  function load() {
    Api.products(unitId).then(setProducts);
  }
  useEffect(load, [unitId]);

  async function create() {
    setBusy(true);
    try {
      await Api.createProduct({ unitId, name, emoji, priceCents: Math.round(Number(priceReais) * 100), stock: Number(stock) });
      setName("");
      load();
      toast.success("Produto criado.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível criar o produto.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Card style={{ padding: "16px", marginBottom: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
        <h2>Novo produto</h2>
        <Input label="Emoji" value={emoji} onChange={(e) => setEmoji(e.target.value)} />
        <Input label="Nome" value={name} onChange={(e) => setName(e.target.value)} />
        <Input label="Preço (R$)" type="number" value={priceReais} onChange={(e) => setPriceReais(e.target.value)} />
        <Input label="Estoque" type="number" value={stock} onChange={(e) => setStock(e.target.value)} />
        <Button variant="primary" disabled={busy || !name} onClick={create}>
          Criar produto
        </Button>
      </Card>
      {products.map((p) => (
        <Card key={p.id} style={{ padding: "12px", marginBottom: "8px", display: "flex", justifyContent: "space-between" }}>
          <span>
            {p.emoji} {p.name}
          </span>
          <span>
            {money(p.price_cents)} — {p.stock} un.
          </span>
        </Card>
      ))}
    </div>
  );
}

function CuponsTab({ unitId }: { unitId: string }) {
  const toast = useToast();
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [code, setCode] = useState("");
  const [kind, setKind] = useState<Coupon["kind"]>("MINUTOS_EXTRA");
  const [value, setValue] = useState("10");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  function load() {
    Api.coupons(unitId).then(setCoupons);
  }
  useEffect(load, [unitId]);

  async function create() {
    setBusy(true);
    try {
      await Api.createCoupon({ unitId, code, kind, value: Number(value), description: description || undefined });
      setCode("");
      load();
      toast.success("Cupom criado.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível criar o cupom.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Card style={{ padding: "16px", marginBottom: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
        <h2>Novo cupom</h2>
        <Input label="Código" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
        <div>
          <label>Tipo</label>
          <select value={kind} onChange={(e) => setKind(e.target.value as Coupon["kind"])}>
            <option value="MINUTOS_EXTRA">Minutos extras</option>
            <option value="DESCONTO_PCT">Desconto %</option>
            <option value="DESCONTO_VALOR">Desconto em R$</option>
          </select>
        </div>
        <Input label="Valor" type="number" value={value} onChange={(e) => setValue(e.target.value)} />
        <Input label="Descrição" value={description} onChange={(e) => setDescription(e.target.value)} />
        <Button variant="primary" disabled={busy || !code} onClick={create}>
          Criar cupom
        </Button>
      </Card>
      {coupons.map((c) => (
        <Card key={c.id} style={{ padding: "12px", marginBottom: "8px" }}>
          <strong>{c.code}</strong> — {c.kind} ({c.value}) — usado {c.used_count}× {c.description ? `— ${c.description}` : ""}
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
        <h2>Nova regra</h2>
        <Input label="A cada X visitas" type="number" value={triggerVisits} onChange={(e) => setTriggerVisits(e.target.value)} />
        <div>
          <label>Recompensa</label>
          <select value={rewardKind} onChange={(e) => setRewardKind(e.target.value as LoyaltyRule["rewardKind"])}>
            <option value="ENTRADA_GRATIS">Entrada grátis</option>
            <option value="DESCONTO_PCT">Desconto %</option>
            <option value="MINUTOS_EXTRA">Minutos extras</option>
          </select>
        </div>
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
        <h2>Novo carrinho</h2>
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

function ColaboradoresTab() {
  const toast = useToast();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [admin, setAdmin] = useState<TerminalEmployee | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<Employee["role"]>("OPERADOR");
  const [cpf, setCpf] = useState("");
  const [email, setEmail] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [admissionDate, setAdmissionDate] = useState("");
  const [position, setPosition] = useState("");
  const [contractType, setContractType] = useState<NonNullable<Employee["contract_type"]>>("CLT");
  const [weeklyHours, setWeeklyHours] = useState("44");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    Api.allEmployees().then(setEmployees);
  }
  useEffect(load, []);

  function resetForm() {
    setFullName("");
    setCpf("");
    setEmail("");
    setBirthDate("");
    setAdmissionDate("");
    setPosition("");
    setContractType("CLT");
    setWeeklyHours("44");
    setRole("OPERADOR");
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await Api.createEmployee({
        fullName,
        role,
        cpf,
        email,
        birthDate,
        admissionDate,
        position,
        contractType,
        weeklyHoursContracted: Number(weeklyHours),
      });
      setTemporaryPassword(res.temporaryPassword);
      resetForm();
      setShowForm(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar colaborador");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(emp: Employee) {
    try {
      await Api.setEmployeeActive(emp.id, !emp.active);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível atualizar o colaborador");
    }
  }

  const formValid = fullName && cpf && email && birthDate && admissionDate && position && Number(weeklyHours) > 0;

  return (
    <div>
      {temporaryPassword && (
        <Card style={{ padding: "16px", marginBottom: "16px", border: "2px solid var(--color-amber)" }}>
          <strong>⚠️ Anote e entregue ao colaborador — esta senha só aparece uma vez:</strong>
          <div style={{ fontFamily: "monospace", fontSize: "18px", margin: "8px 0" }}>{temporaryPassword}</div>
          <p style={{ margin: 0, fontSize: "13px", color: "var(--text-muted)" }}>
            Ele deve entrar com e-mail e esta senha na tela de Ponto (ou Login) e escolher um PIN — a senha pode ser trocada depois.
          </p>
          <Button variant="ghost" size="sm" onClick={() => setTemporaryPassword(null)}>
            ok, já anotei
          </Button>
        </Card>
      )}

      {!showForm && !admin && (
        <Button variant="primary" onClick={() => setShowForm(true)} style={{ marginBottom: "16px" }}>
          + Novo colaborador
        </Button>
      )}

      {showForm && !admin && (
        <Card style={{ padding: "16px", marginBottom: "16px" }}>
          <p style={{ marginTop: 0, color: "var(--text-muted)" }}>Só um ADMIN pode cadastrar colaborador — confirme sua conta.</p>
          <EmployeeAuthGate requireRole="ADMIN" onAuthenticated={setAdmin} onCancel={() => setShowForm(false)} />
        </Card>
      )}

      {showForm && admin && (
        <Card style={{ padding: "16px", marginBottom: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
          <h2>Novo colaborador</h2>
          <Input label="Nome completo" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          <Input label="CPF" value={cpf} onChange={(e) => setCpf(e.target.value)} />
          <Input label="E-mail (vira a conta de login)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Input label="Data de nascimento" type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
          <Input label="Data de admissão" type="date" value={admissionDate} onChange={(e) => setAdmissionDate(e.target.value)} />
          <Input label="Cargo / função" value={position} onChange={(e) => setPosition(e.target.value)} />
          <div>
            <label>Tipo de contrato</label>
            <select value={contractType} onChange={(e) => setContractType(e.target.value as typeof contractType)}>
              <option value="CLT">CLT</option>
              <option value="ESTAGIO">Estágio</option>
              <option value="AUTONOMO">Autônomo</option>
            </select>
          </div>
          <Input label="Jornada semanal contratada (horas)" type="number" value={weeklyHours} onChange={(e) => setWeeklyHours(e.target.value)} />
          <div>
            <label>Papel</label>
            <select value={role} onChange={(e) => setRole(e.target.value as Employee["role"])}>
              <option value="OPERADOR">Operador</option>
              <option value="GERENTE">Gerente</option>
              <option value="ADMIN">Admin</option>
            </select>
          </div>
          {error && <p style={{ color: "var(--color-error-text)" }}>{error}</p>}
          <div style={{ display: "flex", gap: "8px" }}>
            <Button variant="primary" disabled={busy || !formValid} onClick={create}>
              Criar colaborador
            </Button>
            <Button variant="ghost" onClick={() => { setShowForm(false); setAdmin(null); }}>
              cancelar
            </Button>
          </div>
        </Card>
      )}

      {employees.map((e) => (
        <Card key={e.id} style={{ padding: "12px", marginBottom: "8px", opacity: e.active === false ? 0.5 : 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <strong>{e.full_name}</strong> — {e.role}
              {e.position && <span style={{ color: "var(--text-muted)" }}> · {e.position}</span>}
              {e.contract_type && <span style={{ color: "var(--text-muted)" }}> · {CONTRACT_TYPE_LABEL[e.contract_type]}</span>}
              {e.admission_date && <span style={{ color: "var(--text-muted)" }}> · admitido em {new Date(e.admission_date).toLocaleDateString("pt-BR")}</span>}
            </div>
            <Button variant="ghost" size="sm" onClick={() => toggleActive(e)}>
              {e.active === false ? "reativar" : "desativar"}
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
