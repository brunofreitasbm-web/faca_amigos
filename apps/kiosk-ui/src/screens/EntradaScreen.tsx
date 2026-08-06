import { useEffect, useState } from "react";
import { Card, Button, Input, Tag } from "@facaamigos/ui";
import { Api } from "../api/client.js";
import type { Asset, ChildMatch, Plan } from "../api/client.js";
import { useAppState } from "../state/AppState.js";
import { normalizePhoneE164 } from "@facaamigos/domain";
import { WristbandPrintModal } from "../components/WristbandPrintModal.js";

import type { WristbandData } from "../components/WristbandPrintModal.js";
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
  const activity = unit?.kind === "QUIOSQUE" ? "CARRINHO" : "PLAYGROUND";

  const [plans, setPlans] = useState<Plan[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [planId, setPlanId] = useState<string | null>(null);
  const [assetId, setAssetId] = useState<string | null>(null);

  const [childName, setChildName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [guardianName, setGuardianName] = useState("");
  const [phone, setPhone] = useState("");
  const [matches, setMatches] = useState<ChildMatch[]>([]);
  const [matchedChild, setMatchedChild] = useState<ChildMatch | null>(null);

  const [selectedSensoryTags, setSelectedSensoryTags] = useState<string[]>([]);
  const [customNotes, setCustomNotes] = useState("");
  const [couponCode, setCouponCode] = useState("");
  
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [printData, setPrintData] = useState<WristbandData | null>(null);

  useEffect(() => {
    if (!unit) return;
    setPlanId(null);
    Api.plans(unit.id, activity).then(setPlans);
    if (activity === "CARRINHO") Api.assets(unit.id).then(setAssets);
  }, [unit, activity]);

  // Autocomplete ao vivo — por nome da criança OU telefone do responsável
  useEffect(() => {
    const query = childName.length >= 2 ? childName : phone.length >= 4 ? phone : "";
    if (!query) {
      setMatches([]);
      return;
    }
    const handle = setTimeout(() => {
      Api.searchChildren(query).then(setMatches);
    }, 250);
    return () => clearTimeout(handle);
  }, [childName, phone]);

  function pickMatch(match: ChildMatch) {
    setMatchedChild(match);
    setChildName(match.full_name);
    setBirthDate(match.birth_date);
    if (match.phone_e164) setPhone(match.phone_e164);
    setMatches([]);
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
        guardian: { fullName: guardianName, phoneE164: normalizedPhone },
        couponCode: couponCode || undefined,
      });

      setResult(`Check-in realizado com sucesso! Pulseira código #${res.wristbandCode}`);
      
      // Abrir o modal de impressão da pulseira
      setPrintData({
        wristbandCode: res.wristbandCode,
        childName,
        guardianName,
        phone,
        planName: selectedPlan?.name,
        notes: notesSummary || undefined,
        entryTime: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
      });

      // Limpar formulário
      setChildName("");
      setBirthDate("");
      setGuardianName("");
      setPhone("");
      setSelectedSensoryTags([]);
      setCustomNotes("");
      setMatchedChild(null);
      setPlanId(null);
      setAssetId(null);
      setCouponCode("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao fazer check-in");
    } finally {
      setSubmitting(false);
    }
  }

  if (!unit) return null;

  return (
    <div style={{ maxWidth: "720px", margin: "0 auto", padding: "24px", display: "flex", flexDirection: "column", gap: "20px" }}>
      <h1 style={{ fontFamily: "var(--font-display)", margin: 0 }}>Entrada — {unit.name}</h1>

      <section>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: "20px" }}>1. Plano de Permanência</h2>
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
          {plans.map((plan) => (
            <Card
              key={plan.id}
              onClick={() => setPlanId(plan.id)}
              style={{
                cursor: "pointer",
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
            </Card>
          ))}
        </div>
      </section>

      {activity === "CARRINHO" && (
        <section>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "20px" }}>Carrinho</h2>
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
            label="Nome da criança"
            placeholder="Digite o nome da criança..."
            value={childName}
            onChange={(e) => { setChildName(e.target.value); setMatchedChild(null); }}
          />
          {matches.length > 0 && (
            <div className="match-suggestions" style={{ position: "absolute", zIndex: 10, background: "var(--surface-card)", border: "1px solid var(--border-subtle)", borderRadius: "12px", width: "100%", boxShadow: "var(--shadow-md)" }}>
              {matches.map((m) => (
                <div key={m.id} onClick={() => pickMatch(m)} style={{ padding: "10px 14px", cursor: "pointer", borderBottom: "1px solid var(--border-subtle)" }}>
                  <strong>{m.full_name}</strong> {m.phone_e164 ? `— ${m.phone_e164}` : ""}
                </div>
              ))}
            </div>
          )}
        </div>

        {matchedChild && <Tag color="var(--color-teal)">criança já cadastrada — dados preenchidos</Tag>}
        
        <Input label="Data de nascimento" type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
        <Input label="Nome do responsável" placeholder="Nome do pai, mãe ou acompanhante" value={guardianName} onChange={(e) => setGuardianName(e.target.value)} />
        <Input label="WhatsApp do responsável" placeholder="+5591999999999" value={phone} onChange={(e) => setPhone(e.target.value)} />
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
        <Input label="Cupom de Desconto / Parceria (opcional)" value={couponCode} onChange={(e) => setCouponCode(e.target.value.toUpperCase())} />
      </section>

      {error && <p style={{ color: "var(--color-error)", margin: 0, fontWeight: "bold" }}>{error}</p>}
      {result && <p style={{ color: "var(--color-teal)", margin: 0, fontWeight: "bold" }}>{result}</p>}

      <Button
        variant="primary"
        size="lg"
        disabled={submitting || !planId || !childName || !guardianName || !phone || !birthDate}
        onClick={submit}
        style={{ borderRadius: "9999px", padding: "16px" }}
      >
        Confirmar entrada & Imprimir Pulseira 🖨️
      </Button>

      {printData && (
        <WristbandPrintModal
          data={printData}
          onClose={() => setPrintData(null)}
        />
      )}
    </div>
  );
}

