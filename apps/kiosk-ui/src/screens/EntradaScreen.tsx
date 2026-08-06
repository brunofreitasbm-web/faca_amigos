import { useEffect, useState } from "react";
import { Card, Button, Input, Tag } from "@facaamigos/ui";
import { Api } from "../api/client.js";
import type { Asset, ChildMatch, Coupon, Plan } from "../api/client.js";
import { useAppState } from "../state/AppState.js";
import { useToast } from "../state/ToastContext.js";
import { normalizePhoneE164, normalizeCpf, isValidCpf, formatCpf, planDurationMinutes, minutesUntilClosing } from "@facaamigos/domain";
import { ReceiptPrintModal } from "../components/ReceiptPrintModal.js";

import type { ReceiptPrintPayload } from "@facaamigos/domain";
import { money } from "../format.js";

const SENSORY_TAG_OPTIONS = [
  "Sensível a Ruído Alto",
  "Usa Abafador",
  "Acompanhante / Mediador 1:1",
  "Preferência pelo Cantinho da Calma",
  "Alergia Alimentar / Cuidados Especializados",
] as const;

export function EntradaScreen() {
  const { unit, employee } = useAppState();
  const toast = useToast();
  const activity = unit?.kind === "QUIOSQUE" ? "CARRINHO" : "PLAYGROUND";

  const [plans, setPlans] = useState<Plan[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [planId, setPlanId] = useState<string | null>(null);
  const [assetId, setAssetId] = useState<string | null>(null);

  const [cpf, setCpf] = useState("");
  const [childName, setChildName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [guardianName, setGuardianName] = useState("");
  const [phone, setPhone] = useState("");
  const [matches, setMatches] = useState<ChildMatch[]>([]);
  const [matchedChild, setMatchedChild] = useState<ChildMatch | null>(null);
  const [favoriteAssetId, setFavoriteAssetId] = useState<string | null>(null);

  const [selectedSensoryTags, setSelectedSensoryTags] = useState<string[]>([]);
  const [customNotes, setCustomNotes] = useState("");
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [couponCode, setCouponCode] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receiptData, setReceiptData] = useState<ReceiptPrintPayload | null>(null);

  const [termsOfUse, setTermsOfUse] = useState<string | undefined>(undefined);
  const [lastGuardianId, setLastGuardianId] = useState<string | null>(null);
  const [closingTime, setClosingTime] = useState<string | undefined>(undefined);
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    if (!unit || unit.kind !== "QUIOSQUE") return;
    Api.unitSetting(unit.id, "terms_of_use")
      .then((r) => setTermsOfUse(r.value ?? undefined))
      .catch(() => {});
  }, [unit]);

  useEffect(() => {
    if (!unit) return;
    Api.unitSetting(unit.id, "closing_time")
      .then((r) => setClosingTime(r.value ?? undefined))
      .catch(() => {});
  }, [unit]);

  // Reavalia quais planos ainda cabem até o fechamento conforme o tempo passa.
  useEffect(() => {
    const interval = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  const remainingMinutes = closingTime ? minutesUntilClosing(nowTick, closingTime) : null;

  useEffect(() => {
    if (!unit) return;
    setPlanId(null);
    Api.plans(unit.id, activity).then(setPlans);
    Api.coupons(unit.id).then(setCoupons);
    if (activity === "CARRINHO") Api.assets(unit.id).then(setAssets);
  }, [unit, activity]);

  // Autocomplete ao vivo — por CPF, nome da criança/responsável OU telefone do responsável
  useEffect(() => {
    const cpfDigits = normalizeCpf(cpf);
    const query =
      cpfDigits.length >= 3 ? cpfDigits : guardianName.length >= 2 ? guardianName : childName.length >= 2 ? childName : phone.length >= 4 ? phone : "";
    if (!query) {
      setMatches([]);
      return;
    }
    const handle = setTimeout(() => {
      Api.searchChildren(query).then(setMatches);
    }, 250);
    return () => clearTimeout(handle);
  }, [cpf, guardianName, childName, phone]);

  function pickMatch(match: ChildMatch) {
    setMatchedChild(match);
    setChildName(match.full_name);
    setBirthDate(match.birth_date);
    if (match.phone_e164) setPhone(match.phone_e164);
    if (match.guardian_name) setGuardianName(match.guardian_name);
    if (match.cpf) setCpf(formatCpf(match.cpf));
    setMatches([]);
    setFavoriteAssetId(null);
    if (activity === "CARRINHO") {
      Api.lastAssetForChild(match.id)
        .then((r) => setFavoriteAssetId(r.assetId))
        .catch(() => {});
    }
  }

  function toggleSensoryTag(tag: string) {
    setSelectedSensoryTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }

  async function submit() {
    if (!unit || !employee || !planId) return;
    if (activity === "CARRINHO" && !assetId) {
      setError("Selecione um carrinho");
      return;
    }
    if (!isValidCpf(cpf)) {
      setError("CPF do responsável inválido");
      return;
    }
    setSubmitting(true);
    setError(null);

    const notesSummary = [
      ...selectedSensoryTags,
      customNotes.trim()
    ].filter(Boolean).join(" | ");

    const normalizedPhone = normalizePhoneE164(phone);

    try {
      const selectedPlan = plans.find((p) => p.id === planId);
      const res = await Api.checkin({
        unitId: unit.id,
        activity,
        assetId: assetId ?? undefined,
        planId,
        employeeId: employee.id,
        child: { id: matchedChild?.id, fullName: childName, birthDate, inclusiveEligible: false },
        guardian: { id: lastGuardianId ?? undefined, fullName: guardianName, cpf: normalizeCpf(cpf), phoneE164: normalizedPhone },
        couponCode: couponCode || undefined,
      });

      setResult(`Check-in realizado com sucesso! Pulseira código #${res.wristbandCode}`);

      // A pulseira NÃO imprime mais automaticamente aqui (a pedido do dono
      // — só o cupom de entrada dispara sozinho). A impressão da pulseira
      // agora é sempre manual, pelo botão 🖨️ de cada sessão no Painel.

      // Cupom não fiscal com os dados da entrada, impresso automaticamente.
      setReceiptData({
        title: "Comprovante de Check-in",
        unitName: unit.name,
        employeeName: employee.full_name,
        dateTime: new Date().toLocaleString("pt-BR"),
        items: [{ description: selectedPlan?.name ?? "Plano", amountCents: selectedPlan?.valueCents ?? 0 }],
        totalCents: selectedPlan?.valueCents ?? 0,
        customerInfo: { childName, guardianName, phone },
        footerNote: unit.kind === "QUIOSQUE" && termsOfUse ? termsOfUse : undefined,
      });

      // Mantém CPF/nome/telefone do responsável preenchidos — permite adicionar
      // outra criança do mesmo responsável sem redigitar (botão "Adicionar outra criança").
      setLastGuardianId(res.guardianId);
      setChildName("");
      setBirthDate("");
      setSelectedSensoryTags([]);
      setCustomNotes("");
      setMatchedChild(null);
      setFavoriteAssetId(null);
      setPlanId(null);
      setCouponCode("");

      if (activity === "CARRINHO" && unit) {
        const freshAssets = await Api.assets(unit.id);
        setAssets(freshAssets);
        setAssetId(freshAssets.find((a) => a.status === "DISPONIVEL")?.id ?? null);
      } else {
        setAssetId(null);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao fazer check-in";
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  function startNewGuardian() {
    setCpf("");
    setGuardianName("");
    setPhone("");
    setLastGuardianId(null);
    setResult(null);
  }

  if (!unit) return null;

  return (
    <div style={{ maxWidth: "720px", margin: "0 auto", padding: "clamp(12px, 3vw, 24px)", display: "flex", flexDirection: "column", gap: "20px" }}>
      <h1 style={{ fontFamily: "var(--font-display)", margin: 0 }}>Entrada — {unit.name}</h1>

      <section>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: "20px" }}>1. Plano de Permanência</h2>
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
          {plans.map((plan) => {
            const fits = remainingMinutes === null || planDurationMinutes(plan) <= remainingMinutes;
            return (
              <Card
                key={plan.id}
                onClick={() => fits && setPlanId(plan.id)}
                title={fits ? undefined : `Não cabe até o fechamento — faltam ${Math.max(0, remainingMinutes ?? 0)} min`}
                style={{
                  cursor: fits ? "pointer" : "not-allowed",
                  opacity: fits ? 1 : 0.4,
                  padding: "16px",
                  minWidth: "160px",
                  borderRadius: "16px",
                  border: planId === plan.id ? "2px solid var(--color-primary)" : "1px solid var(--border-subtle)",
                  background: planId === plan.id ? "rgba(240, 25, 107, 0.05)" : "var(--surface-card)",
                }}
              >
                <strong style={{ fontSize: "16px", display: "block" }}>{plan.name}</strong>
                <div style={{ fontSize: "18px", color: "var(--color-primary)", fontWeight: "bold", marginTop: "4px" }}>
                  {money(plan.valueCents)}
                </div>
                {!fits && <div style={{ fontSize: "11px", color: "var(--color-error)", fontWeight: "bold" }}>Não cabe até o fechamento</div>}
              </Card>
            );
          })}
        </div>
      </section>

      {activity === "CARRINHO" && (
        <section>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "20px" }}>Carrinho</h2>
          {favoriteAssetId &&
            (() => {
              const favorite = assets.find((a) => a.id === favoriteAssetId);
              if (!favorite || favorite.status !== "DISPONIVEL") return null;
              return (
                <Tag
                  color="var(--color-teal)"
                  title="Esta criança usou este carrinho da última vez e ele está disponível agora"
                  style={{ marginBottom: "8px", cursor: "pointer" }}
                  onClick={() => setAssetId(favorite.id)}
                >
                  {favorite.emoji} {favorite.name} está disponível — reservar o mesmo de última vez?
                </Tag>
              );
            })()}
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            {assets.map((asset) => (
              <Card
                key={asset.id}
                onClick={() => asset.status === "DISPONIVEL" && setAssetId(asset.id)}
                style={{
                  cursor: asset.status === "DISPONIVEL" ? "pointer" : "not-allowed",
                  opacity: asset.status === "DISPONIVEL" ? 1 : 0.4,
                  padding: "16px",
                  borderRadius: "16px",
                  border: assetId === asset.id ? "2px solid var(--color-primary)" : "1px solid var(--border-subtle)",
                }}
              >
                <span style={{ fontSize: "28px" }}>{asset.emoji}</span> {asset.name}
              </Card>
            ))}
          </div>
        </section>
      )}

      <section style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: "20px" }}>2. Identificação da Criança e Responsável</h2>
        <div style={{ position: "relative" }}>
          <Input
            label="CPF do responsável"
            placeholder="000.000.000-00"
            value={cpf}
            onChange={(e) => { setCpf(formatCpf(e.target.value)); setMatchedChild(null); setLastGuardianId(null); setFavoriteAssetId(null); }}
          />
          {matches.length > 0 && (
            <div className="match-suggestions" style={{ position: "absolute", zIndex: 10, background: "var(--surface-card)", border: "1px solid var(--border-subtle)", borderRadius: "12px", width: "100%", boxShadow: "var(--shadow-md)" }}>
              {matches.map((m) => (
                <div key={m.id} onClick={() => pickMatch(m)} style={{ padding: "10px 14px", cursor: "pointer", borderBottom: "1px solid var(--border-subtle)" }}>
                  <strong>{m.guardian_name ?? m.full_name}</strong>{" "}
                  {m.cpf ? `— ${formatCpf(m.cpf)}` : ""} {m.phone_e164 ? `— ${m.phone_e164}` : ""}
                  <br />
                  <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>criança: {m.full_name}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {matchedChild && <Tag color="var(--color-teal)">cadastro encontrado — dados preenchidos</Tag>}
        {cpf.length === 14 && !isValidCpf(cpf) && <Tag color="var(--color-error)">CPF inválido</Tag>}

        <Input label="Nome do responsável" placeholder="Nome do pai, mãe ou acompanhante" value={guardianName} onChange={(e) => { setGuardianName(e.target.value); setMatchedChild(null); setLastGuardianId(null); setFavoriteAssetId(null); }} />
        <Input
          label="Nome da criança"
          placeholder="Digite o nome da criança..."
          value={childName}
          onChange={(e) => { setChildName(e.target.value); setMatchedChild(null); setFavoriteAssetId(null); }}
        />
        <Input label="Data de nascimento" type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
        <Input label="WhatsApp do responsável" placeholder="+5591999999999" value={phone} onChange={(e) => { setPhone(e.target.value); setLastGuardianId(null); }} />
      </section>

      {/* Seção Inclusiva: Tags Sensoriais e Cuidados */}
      <section style={{ display: "flex", flexDirection: "column", gap: "10px", background: "var(--surface-card)", padding: "16px", borderRadius: "16px", border: "1px solid var(--border-subtle)" }}>
        <h3 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: "16px", color: "var(--color-dark)" }}>
          🧩 Cuidados Inclusivos & Tags Sensoriais
        </h3>
        <p style={{ margin: 0, fontSize: "13px", color: "var(--text-muted)" }}>
          Selecione preferências para orientar a mediação dos monitores no playground:
        </p>

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "4px" }}>
          {SENSORY_TAG_OPTIONS.map((tag) => {
            const isSelected = selectedSensoryTags.includes(tag);
            return (
              <Button
                key={tag}
                type="button"
                variant={isSelected ? "teal" : "ghost"}
                size="sm"
                onClick={() => toggleSensoryTag(tag)}
                style={{ borderRadius: "9999px" }}
              >
                {isSelected ? "✓ " : "+ "}{tag}
              </Button>
            );
          })}
        </div>

        <Input
          label="Outras observações (opcional)"
          placeholder="Ex: Alergia a corantes, brinquedo favorito..."
          value={customNotes}
          onChange={(e) => setCustomNotes(e.target.value)}
        />
      </section>

      <section>
        <label style={{ display: "block", marginBottom: "4px", fontSize: "13px", color: "var(--text-muted)" }}>Cupom de Desconto / Parceria (opcional)</label>
        <select value={couponCode} onChange={(e) => setCouponCode(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: "12px", border: "1px solid var(--border-subtle)" }}>
          <option value="">Nenhum</option>
          {coupons.map((c) => (
            <option key={c.id} value={c.code}>
              {c.code}{c.description ? ` — ${c.description}` : ""}
            </option>
          ))}
        </select>
      </section>

      {error && <p style={{ color: "var(--color-error)", margin: 0, fontWeight: "bold" }}>{error}</p>}
      {result && <p style={{ color: "var(--color-teal)", margin: 0, fontWeight: "bold" }}>{result}</p>}

      {lastGuardianId && (
        <Tag color="var(--color-teal)" title="Os dados do responsável abaixo continuam preenchidos para agilizar o cadastro de mais uma criança">
          ➕ Adicionando outra criança de {guardianName} — CPF e WhatsApp já preenchidos
        </Tag>
      )}

      <div style={{ display: "flex", gap: "8px" }}>
        <Button
          variant="primary"
          size="lg"
          loading={submitting}
          disabled={submitting || !planId || !isValidCpf(cpf) || !childName || !guardianName || !phone || !birthDate}
          onClick={submit}
          style={{ borderRadius: "9999px", padding: "16px", flex: 1 }}
          title={lastGuardianId ? "Confirmar entrada desta criança, mantendo o mesmo responsável — imprime o cupom automaticamente" : "Confirmar entrada — imprime o cupom automaticamente; a pulseira é impressa manualmente pelo Painel"}
        >
          {lastGuardianId ? "➕ Adicionar Criança" : "Confirmar Entrada"}
        </Button>
        {lastGuardianId && (
          <Button
            variant="ghost"
            size="lg"
            onClick={startNewGuardian}
            style={{ borderRadius: "9999px" }}
            title="Limpar os dados do responsável para começar o cadastro de outra família"
          >
            Novo responsável
          </Button>
        )}
      </div>

      {receiptData && (
        <ReceiptPrintModal
          data={receiptData}
          onClose={() => setReceiptData(null)}
        />
      )}
    </div>
  );
}

