import { useEffect, useState } from "react";
import { Button, BrandLockup, Card, HelpText, Input } from "@facaamigos/ui";
import { Api } from "../api/client.js";
import type { EmployeePersonalInfo, OnboardingInviteInfo } from "../api/client.js";
import { PersonalInfoFormFields, emptyPersonalInfo, emptyBankInfo } from "../components/PersonalInfoFormFields.js";
import type { BankInfo } from "../components/PersonalInfoFormFields.js";

type Status = "loading" | "invalid" | "ready" | "done";

/**
 * Tela pública: quem abre este link ainda não tem NENHUMA conta no
 * sistema — é o cadastro do zero a partir de um convite gerado pelo Owner
 * (ver ColaboradoresTab). Por isso vive fora do fluxo normal de login por
 * PIN (ver App.tsx, checagem do parâmetro `?convite=`).
 */
export function OnboardingInviteScreen({ inviteId, token }: { inviteId: string; token: string }) {
  const [status, setStatus] = useState<Status>("loading");
  const [info, setInfo] = useState<OnboardingInviteInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [fullName, setFullName] = useState("");
  const [cpf, setCpf] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [pin, setPin] = useState("");
  const [form, setForm] = useState<EmployeePersonalInfo>(emptyPersonalInfo);
  const [bankInfo, setBankInfo] = useState<BankInfo>(emptyBankInfo);
  const [pixKey, setPixKey] = useState("");

  useEffect(() => {
    Api.onboardingInviteInfo(inviteId, token)
      .then((data) => {
        setInfo(data);
        if (data.fullNameHint) setFullName(data.fullNameHint);
        setStatus("ready");
      })
      .catch(() => setStatus("invalid"));
  }, [inviteId, token]);

  function set<K extends keyof EmployeePersonalInfo>(key: K, value: EmployeePersonalInfo[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function setBank<K extends keyof BankInfo>(key: K, value: BankInfo[K]) {
    setBankInfo((prev) => ({ ...prev, [key]: value }));
  }

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
      await Api.onboardingComplete({
        inviteId,
        token,
        fullName: fullName.trim(),
        cpf: cpfDigits || undefined,
        email: email.trim() || undefined,
        phone: phoneDigits || undefined,
        birthDate: birthDate || undefined,
        pin,
        personalInfo: form,
        pixKey: pixKey || undefined,
        bankCode: bankInfo.bankCode || undefined,
        bankAgencia: bankInfo.bankAgencia || undefined,
        bankConta: bankInfo.bankConta || undefined,
        bankContaDv: bankInfo.bankContaDv || undefined,
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
        <h1 style={{ fontFamily: "var(--font-display)" }}>Link inválido ou expirado</h1>
        <p style={{ color: "var(--text-muted)" }}>
          Este link de cadastro não é mais válido — pode já ter sido usado ou ter passado do prazo. Peça um novo
          convite ao RH.
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
    <div style={{ maxWidth: "900px", margin: "0 auto", padding: "clamp(16px, 3vw, 32px)", display: "flex", flexDirection: "column", gap: "20px" }}>
      <div style={{ textAlign: "center" }}>
        <BrandLockup size="md" style={{ justifyContent: "center", marginBottom: "12px" }} />
        <h1 style={{ fontFamily: "var(--font-display)", margin: 0, fontSize: "24px" }}>Convite de Cadastro</h1>
        <p style={{ margin: "6px 0 0 0", color: "var(--text-secondary)", fontWeight: "bold" }}>
          {info?.position}
          {info && info.unitNames.length > 0 ? ` — ${info.unitNames.join(", ")}` : ""}
        </p>
        <HelpText style={{ marginTop: "6px" }}>
          Preencha seus dados abaixo e escolha o PIN que vai usar para entrar no sistema.
        </HelpText>
      </div>

      <Card style={{ padding: "20px", borderRadius: "18px" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: "17px", margin: "0 0 12px 0" }}>Identificação e acesso</h2>
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

      <PersonalInfoFormFields form={form} onChange={set} bankInfo={bankInfo} onBankInfoChange={setBank} pixKey={pixKey} onPixKeyChange={setPixKey} />

      {error && <p style={{ color: "var(--color-error-text)", margin: 0, fontWeight: "bold" }}>{error}</p>}

      <div style={{ display: "flex", gap: "10px" }}>
        <Button variant="primary" disabled={busy || !formValid} onClick={submit} style={{ borderRadius: "9999px" }}>
          {busy ? "Enviando…" : "✓ Concluir cadastro"}
        </Button>
      </div>
    </div>
  );
}
