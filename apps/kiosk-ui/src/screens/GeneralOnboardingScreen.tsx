import { useEffect, useState } from "react";
import { Button, BrandLockup, Card, HelpText, Input } from "@facaamigos/ui";
import { Api } from "../api/client.js";

type Status = "loading" | "invalid" | "ready" | "done";

/**
 * Tela pública: Link Geral fixo por unidade (ver botão "🎓 Link Geral de
 * Estagiário" na ColaboradoresTab) — quem abre ainda não tem NENHUMA conta,
 * mesmo espírito do convite individual (OnboardingInviteScreen), mas sem
 * escolha de papel/cargo/unidade: sempre ESTAGIARIO, na unidade do link. Por
 * isso vive fora do fluxo normal de login por PIN (ver App.tsx, checagem
 * do parâmetro `?cadastro-estagiario=`).
 */
export function GeneralOnboardingScreen({ unitId, token }: { unitId: string; token: string }) {
  const [status, setStatus] = useState<Status>("loading");
  const [unitName, setUnitName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [fullName, setFullName] = useState("");
  const [cpf, setCpf] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [pin, setPin] = useState("");

  useEffect(() => {
    Api.generalInviteInfo(unitId, token)
      .then((data) => {
        setUnitName(data.unitName);
        setStatus("ready");
      })
      .catch(() => setStatus("invalid"));
  }, [unitId, token]);

  const cpfDigits = cpf.replace(/\D/g, "");
  const phoneDigits = phone.replace(/\D/g, "");
  const emailValid = !email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const cpfValid = !cpf || cpfDigits.length === 11;
  const phoneValid = !phone || phoneDigits.length === 10 || phoneDigits.length === 11;
  const formValid = Boolean(fullName.trim().length >= 2 && pin.length === 6 && cpfValid && emailValid && phoneValid);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await Api.generalOnboardingComplete({
        unitId,
        token,
        fullName: fullName.trim(),
        cpf: cpfDigits || undefined,
        email: email.trim() || undefined,
        phone: phoneDigits || undefined,
        birthDate: birthDate || undefined,
        pin,
      });
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível concluir o cadastro");
    } finally {
      setBusy(false);
    }
  }

  if (status === "loading") {
    return <div style={{ padding: "80px", textAlign: "center", color: "var(--text-muted)" }}>Carregando…</div>;
  }

  if (status === "invalid") {
    return (
      <div style={{ maxWidth: "480px", margin: "80px auto", textAlign: "center", display: "flex", flexDirection: "column", gap: "12px" }}>
        <BrandLockup size="md" style={{ justifyContent: "center" }} />
        <h1 style={{ fontFamily: "var(--font-display)" }}>Link inválido</h1>
        <p style={{ color: "var(--text-muted)" }}>
          Este link de cadastro não é válido — confira com quem te enviou.
        </p>
      </div>
    );
  }

  if (status === "done") {
    return (
      <div style={{ maxWidth: "480px", margin: "80px auto", textAlign: "center", display: "flex", flexDirection: "column", gap: "12px" }}>
        <BrandLockup size="md" style={{ justifyContent: "center" }} />
        <h1 style={{ fontFamily: "var(--font-display)" }}>✓ Cadastro concluído!</h1>
        <p style={{ color: "var(--text-muted)" }}>
          Seus dados foram salvos. Você já pode entrar no sistema com o seu nome e o PIN que escolheu.
        </p>
        <Button variant="primary" onClick={() => { window.location.href = window.location.pathname; }} style={{ borderRadius: "9999px" }}>
          Ir para o login ➔
        </Button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "560px", margin: "0 auto", padding: "clamp(16px, 3vw, 32px)", display: "flex", flexDirection: "column", gap: "20px" }}>
      <div style={{ textAlign: "center" }}>
        <BrandLockup size="md" style={{ justifyContent: "center", marginBottom: "12px" }} />
        <h1 style={{ fontFamily: "var(--font-display)", margin: 0, fontSize: "24px" }}>Cadastro de Estagiário</h1>
        {unitName && (
          <p style={{ margin: "6px 0 0 0", color: "var(--text-secondary)", fontWeight: "bold" }}>{unitName}</p>
        )}
        <HelpText style={{ marginTop: "6px" }}>
          Preencha seus dados abaixo e escolha o PIN que vai usar para entrar no sistema.
        </HelpText>
      </div>

      <Card style={{ padding: "20px", borderRadius: "18px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px" }}>
          <Input label="Nome completo *" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          <Input label="CPF" placeholder="000.000.000-00" value={cpf} onChange={(e) => setCpf(e.target.value.replace(/\D/g, "").slice(0, 11))} error={cpf && !cpfValid ? "CPF precisa ter 11 dígitos" : undefined} />
          <Input label="E-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={email && !emailValid ? "E-mail inválido" : undefined} />
          <Input label="Telefone com DDD" placeholder="(91) 99999-9999" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 11))} error={phone && !phoneValid ? "Telefone precisa ter 10 ou 11 dígitos" : undefined} />
          <Input label="Data de nascimento" type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
          <Input
            label="Escolha um PIN de acesso (6 dígitos) *"
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
            error={pin && pin.length !== 6 ? "PIN deve ter 6 dígitos" : undefined}
          />
        </div>
      </Card>

      {error && <p style={{ color: "var(--color-error-text)", margin: 0, fontWeight: "bold" }}>{error}</p>}

      <div style={{ display: "flex", gap: "10px" }}>
        <Button variant="primary" disabled={busy || !formValid} onClick={submit} style={{ borderRadius: "9999px" }}>
          {busy ? "Enviando…" : "✓ Concluir cadastro"}
        </Button>
      </div>
    </div>
  );
}
