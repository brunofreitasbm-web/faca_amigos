import { useEffect, useState } from "react";
import { Card, Button, Input, Tag } from "@facaamigos/ui";
import { Api } from "../api/client.js";
import type { Asset, ChildMatch, Plan } from "../api/client.js";
import { useAppState } from "../state/AppState.js";
import { money } from "../format.js";

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

  const [couponCode, setCouponCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!unit) return;
    setPlanId(null);
    Api.plans(unit.id, activity).then(setPlans);
    if (activity === "CARRINHO") Api.assets(unit.id).then(setAssets);
  }, [unit, activity]);

  // Autocomplete ao vivo (princípio: digitar o mínimo) — bate por nome da criança OU telefone do responsável.
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

  async function submit() {
    if (!unit || !employee || !planId) return;
    if (activity === "CARRINHO" && !assetId) {
      setError("Selecione um carrinho");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await Api.checkin({
        unitId: unit.id,
        activity,
        assetId: assetId ?? undefined,
        planId,
        employeeId: employee.id,
        child: { id: matchedChild?.id, fullName: childName, birthDate, inclusiveEligible: false },
        guardian: { fullName: guardianName, phoneE164: phone },
        couponCode: couponCode || undefined,
      });
      setResult(`Check-in feito! Pulseira ${res.wristbandCode}`);
      setChildName("");
      setBirthDate("");
      setGuardianName("");
      setPhone("");
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
      <h1 style={{ fontFamily: "var(--font-display)" }}>Entrada — {unit.name}</h1>

      <section>
        <h2>Plano</h2>
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
          {plans.map((plan) => (
            <Card
              key={plan.id}
              onClick={() => setPlanId(plan.id)}
              style={{
                cursor: "pointer",
                padding: "16px",
                minWidth: "160px",
                border: planId === plan.id ? "2px solid var(--color-primary)" : "1px solid var(--border-subtle)",
              }}
            >
              <strong>{plan.name}</strong>
              <div>{money(plan.valueCents)}</div>
            </Card>
          ))}
        </div>
      </section>

      {activity === "CARRINHO" && (
        <section>
          <h2>Carrinho</h2>
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            {assets.map((asset) => (
              <Card
                key={asset.id}
                onClick={() => asset.status === "DISPONIVEL" && setAssetId(asset.id)}
                style={{
                  cursor: asset.status === "DISPONIVEL" ? "pointer" : "not-allowed",
                  opacity: asset.status === "DISPONIVEL" ? 1 : 0.4,
                  padding: "16px",
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
        <h2>Criança e responsável</h2>
        <div style={{ position: "relative" }}>
          <Input label="Nome da criança" value={childName} onChange={(e) => { setChildName(e.target.value); setMatchedChild(null); }} />
          {matches.length > 0 && (
            <div className="match-suggestions" style={{ position: "absolute", zIndex: 10, background: "var(--surface-card)", border: "1px solid var(--border-subtle)", borderRadius: "8px", width: "100%" }}>
              {matches.map((m) => (
                <div key={m.id} onClick={() => pickMatch(m)} style={{ padding: "8px 12px", cursor: "pointer" }}>
                  {m.full_name} {m.phone_e164 ? `— ${m.phone_e164}` : ""}
                </div>
              ))}
            </div>
          )}
        </div>
        {matchedChild && <Tag color="var(--color-teal)">criança já cadastrada — dados preenchidos</Tag>}
        <Input label="Data de nascimento" type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
        <Input label="Nome do responsável" value={guardianName} onChange={(e) => setGuardianName(e.target.value)} />
        <Input label="WhatsApp do responsável" placeholder="+5591999999999" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <Input label="Cupom (opcional)" value={couponCode} onChange={(e) => setCouponCode(e.target.value.toUpperCase())} />
      </section>

      {error && <p style={{ color: "var(--color-error)" }}>{error}</p>}
      {result && <p style={{ color: "var(--color-teal)" }}>{result}</p>}

      <Button
        variant="primary"
        size="lg"
        disabled={submitting || !planId || !childName || !guardianName || !phone || !birthDate}
        onClick={submit}
      >
        Confirmar entrada
      </Button>
    </div>
  );
}
