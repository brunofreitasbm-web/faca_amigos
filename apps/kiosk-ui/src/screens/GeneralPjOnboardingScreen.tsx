import { useEffect, useState } from "react";
import { Button, BrandLockup, Card, HelpText, Input, Checkbox, Modal } from "@facaamigos/ui";
import { Api } from "../api/client.js";
import { useFaceCapture } from "../hooks/useFaceCapture.js";

type Status = "loading" | "invalid" | "ready" | "done";

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function FaceCaptureModal({
  onClose,
  onCaptured,
}: {
  onClose: () => void;
  onCaptured: (descriptor: number[], base64: string, previewUrl: string) => void;
}) {
  const [consent, setConsent] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const { videoRef, ready, starting, error, start, stop, capture } = useFaceCapture();

  async function handleStart() {
    setCaptureError(null);
    await start();
  }

  async function handleCapture() {
    setCapturing(true);
    setCaptureError(null);
    try {
      const result = await capture();
      if (!result) {
        setCaptureError("Não identificamos um rosto visível. Centralize seu rosto na moldura e tente novamente.");
        setCapturing(false);
        return;
      }
      const base64 = await blobToBase64(result.photo);
      const previewUrl = URL.createObjectURL(result.photo);
      stop();
      onCaptured(result.descriptor, base64, previewUrl);
      onClose();
    } catch (err) {
      setCaptureError(err instanceof Error ? err.message : "Erro ao capturar biometria facial.");
      setCapturing(false);
    }
  }

  return (
    <Modal
      title="Autocaptação de Biometria Facial - Prestador PJ"
      onClose={() => {
        stop();
        onClose();
      }}
      maxWidth="480px"
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <HelpText>
          Posicione seu rosto dentro da moldura para registrar a biometria facial. Seu registro será utilizado para a
          identificação rápida e confirmação de presença no check-in de prestação de serviços.
        </HelpText>

        {!ready && !starting && (
          <Checkbox
            label="Autorizo o uso da minha imagem e biometria facial para identificação biométrica no registro de prestação de serviços."
            checked={consent}
            onChange={setConsent}
          />
        )}

        {(error || captureError) && (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <p style={{ color: "var(--color-error-text)", margin: 0, fontSize: "14px", fontWeight: "bold" }}>
              {captureError || error}
            </p>
            <Button variant="ghost" size="sm" onClick={handleStart} style={{ alignSelf: "flex-start" }}>
              🔄 Tentar novamente
            </Button>
          </div>
        )}

        {(starting || ready) && (
          <div
            style={{
              position: "relative",
              width: "100%",
              height: "280px",
              borderRadius: "16px",
              overflow: "hidden",
              background: "#000",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
            }}
          >
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                transform: "scaleX(-1)",
                display: ready ? "block" : "none",
              }}
            />

            {starting && (
              <div style={{ color: "#fff", display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "14px", fontWeight: 500 }}>📷 Inicializando câmera e IA…</span>
              </div>
            )}

            {ready && (
              <div
                style={{
                  position: "absolute",
                  top: "50%",
                  left: "50%",
                  transform: "translate(-50%, -50%)",
                  width: "150px",
                  height: "190px",
                  borderRadius: "50%",
                  border: "3px dashed rgba(255, 255, 255, 0.85)",
                  boxShadow: "0 0 24px rgba(0,0,0,0.6)",
                  pointerEvents: "none",
                }}
              />
            )}
          </div>
        )}

        {ready ? (
          <Button variant="primary" size="lg" loading={capturing} disabled={capturing} onClick={handleCapture}>
            ⚡ Capturar Rosto Agora
          </Button>
        ) : (
          !starting && (
            <Button variant="primary" size="lg" loading={starting} disabled={!consent || starting} onClick={handleStart}>
              📸 Ligar Câmera para Registro
            </Button>
          )
        )}
      </div>
    </Modal>
  );
}

/**
 * Tela pública de auto-cadastro para Prestador de Serviço PJ.
 * URL: ?cadastro-pj=<unitId>.<token>
 */
export function GeneralPjOnboardingScreen({ unitId, token }: { unitId: string; token: string }) {
  const [status, setStatus] = useState<Status>("loading");
  const [unitName, setUnitName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [fullName, setFullName] = useState("");
  const [razaoSocial, setRazaoSocial] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [cpf, setCpf] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [pixKey, setPixKey] = useState("");
  const [pin, setPin] = useState("");
  const [legalTermAccepted, setLegalTermAccepted] = useState(false);

  const [faceDescriptor, setFaceDescriptor] = useState<number[] | null>(null);
  const [facePhotoBase64, setFacePhotoBase64] = useState<string | null>(null);
  const [facePhotoPreviewUrl, setFacePhotoPreviewUrl] = useState<string | null>(null);
  const [showFaceModal, setShowFaceModal] = useState(false);

  useEffect(() => {
    Api.generalInviteInfo(unitId, token)
      .then((data) => {
        setUnitName(data.unitName);
        setStatus("ready");
      })
      .catch(() => setStatus("invalid"));
  }, [unitId, token]);

  const cpfDigits = cpf.replace(/\D/g, "");
  const cnpjDigits = cnpj.replace(/\D/g, "");
  const phoneDigits = phone.replace(/\D/g, "");
  const emailValid = !email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const cpfValid = !cpf || cpfDigits.length === 11;
  const cnpjValid = !cnpj || cnpjDigits.length === 14;
  const phoneValid = !phone || phoneDigits.length === 10 || phoneDigits.length === 11;
  const formValid = Boolean(
    fullName.trim().length >= 2 &&
    pin.length === 6 &&
    legalTermAccepted &&
    cpfValid &&
    cnpjValid &&
    emailValid &&
    phoneValid
  );

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await Api.generalOnboardingComplete({
        unitId,
        token,
        fullName: fullName.trim(),
        role: "PRESTADOR_PJ",
        contractType: "PJ",
        razaoSocial: razaoSocial.trim() || undefined,
        cnpj: cnpjDigits || undefined,
        cpf: cpfDigits || undefined,
        email: email.trim() || undefined,
        phone: phoneDigits || undefined,
        birthDate: birthDate || undefined,
        pixKey: pixKey.trim() || undefined,
        pin,
        faceDescriptor: faceDescriptor ?? undefined,
        facePhotoBase64: facePhotoBase64 ?? undefined,
      });
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível concluir o auto-cadastro PJ");
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
          Este link de auto-cadastro de prestador PJ não é válido ou foi alterado. Peça um novo link à administração da unidade.
        </p>
      </div>
    );
  }

  if (status === "done") {
    return (
      <div style={{ maxWidth: "480px", margin: "80px auto", textAlign: "center", display: "flex", flexDirection: "column", gap: "12px" }}>
        <BrandLockup size="md" style={{ justifyContent: "center" }} />
        <h1 style={{ fontFamily: "var(--font-display)" }}>✓ Auto-Cadastro PJ Concluído!</h1>
        <p style={{ color: "var(--text-muted)" }}>
          Seus dados de Prestador de Serviço foram registrados com sucesso. Você já pode registrar seu check-in/presença no terminal informando o seu nome e o PIN cadastrado.
        </p>
        <Button
          variant="primary"
          onClick={() => {
            window.location.href = window.location.pathname;
          }}
          style={{ borderRadius: "9999px" }}
        >
          Ir para a tela inicial ➔
        </Button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "780px", margin: "0 auto", padding: "clamp(16px, 3vw, 32px)", display: "flex", flexDirection: "column", gap: "20px" }}>
      <div style={{ textAlign: "center" }}>
        <BrandLockup size="md" style={{ justifyContent: "center", marginBottom: "12px" }} />
        <h1 style={{ fontFamily: "var(--font-display)", margin: 0, fontSize: "24px" }}>
          Cadastro de Prestador de Serviço (PJ)
        </h1>
        {unitName && (
          <p style={{ margin: "6px 0 0 0", color: "var(--text-secondary)", fontWeight: "bold" }}>
            Unidade: {unitName}
          </p>
        )}
        <HelpText style={{ marginTop: "6px" }}>
          Preencha os dados da sua empresa/pessoa jurídica para registrar e acompanhar sua prestação de serviços no Faça Amigos.
        </HelpText>
      </div>

      {error && (
        <div style={{ background: "rgba(255, 0, 0, 0.1)", color: "var(--color-error-text)", padding: "12px 16px", borderRadius: "12px", fontSize: "14px" }}>
          ⚠️ {error}
        </div>
      )}

      <Card style={{ padding: "20px", borderRadius: "18px", display: "flex", flexDirection: "column", gap: "16px" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: "17px", margin: 0 }}>
          1. Identificação do Profissional e Pessoa Jurídica
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px" }}>
          <Input label="Nome completo do profissional *" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          <Input label="Razão Social / Nome da Empresa" placeholder="Ex: Silva Serviços ME" value={razaoSocial} onChange={(e) => setRazaoSocial(e.target.value)} />
          <Input label="CNPJ da Empresa" placeholder="00.000.000/0000-00" value={cnpj} onChange={(e) => setCnpj(e.target.value)} error={cnpj && !cnpjValid ? "CNPJ deve ter 14 dígitos" : undefined} />
          <Input label="CPF do Responsável" placeholder="000.000.000-00" value={cpf} onChange={(e) => setCpf(e.target.value.replace(/\D/g, "").slice(0, 11))} error={cpf && !cpfValid ? "CPF precisa ter 11 dígitos" : undefined} />
          <Input label="E-mail profissional" type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={email && !emailValid ? "E-mail inválido" : undefined} />
          <Input label="Telefone / WhatsApp com DDD" placeholder="(91) 99999-9999" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 11))} error={phone && !phoneValid ? "Telefone precisa ter 10 ou 11 dígitos" : undefined} />
          <Input label="Data de nascimento" type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
          <Input label="Chave PIX para faturamento / pagamentos" placeholder="CPF/CNPJ/E-mail/Telefone" value={pixKey} onChange={(e) => setPixKey(e.target.value)} />
        </div>
      </Card>

      <Card style={{ padding: "20px", borderRadius: "18px", display: "flex", flexDirection: "column", gap: "16px" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: "17px", margin: 0 }}>
          2. Definição do PIN de Acesso ao Terminal
        </h2>
        <Input
          label="Escolha um PIN de acesso (6 dígitos numéricos) *"
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          maxLength={6}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
          error={pin && pin.length !== 6 ? "O PIN deve conter exatamente 6 dígitos numéricos" : undefined}
        />
        <HelpText>Este PIN será digitado no terminal da unidade para confirmar seu início e término de atendimento.</HelpText>
      </Card>

      <Card style={{ padding: "20px", borderRadius: "18px", display: "flex", flexDirection: "column", gap: "16px" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: "17px", margin: 0 }}>
          3. Reconhecimento Facial (Opcional - Check-in Rápido Touchless)
        </h2>
        <HelpText>
          Cadastre sua face para autorizar o registro por reconhecimento facial no terminal sem precisar digitar o PIN.
        </HelpText>

        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          {facePhotoPreviewUrl ? (
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <img
                src={facePhotoPreviewUrl}
                alt="Face cadastrada"
                style={{ width: "64px", height: "64px", borderRadius: "50%", objectFit: "cover", border: "2px solid var(--color-success)" }}
              />
              <div>
                <p style={{ margin: 0, fontWeight: "bold", color: "var(--color-success)" }}>✓ Biometria facial cadastrada</p>
                <Button variant="ghost" size="sm" onClick={() => setShowFaceModal(true)} style={{ marginTop: "4px" }}>
                  Recapturar foto
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="secondary" onClick={() => setShowFaceModal(true)}>
              📸 Capturar biometria facial agora
            </Button>
          )}
        </div>
      </Card>

      <Card style={{ padding: "20px", borderRadius: "18px", display: "flex", flexDirection: "column", gap: "16px", background: "var(--surface-subtle)" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: "17px", margin: 0, color: "var(--text-primary)" }}>
          4. Termo de Prestação de Serviços Autônoma
        </h2>

        <div style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.5, background: "var(--surface-card)", padding: "12px", borderRadius: "8px", border: "1px solid var(--border-color)" }}>
          Declaro expressamente que presto serviços de forma autônoma e eventual como Pessoa Jurídica/Prestador Independente, sem subordinação jurídica, exclusividade ou vínculo empregatício de qualquer natureza com a empresa Faça Amigos. Reconheço que este registro no sistema se destina exclusivamente à medição de horas e presença para conferência contratual e faturamento de documentos fiscais.
        </div>

        <Checkbox
          label="Declaro que li e aceito os termos da prestação autônoma de serviços e confirmo a veracidade dos dados informados."
          checked={legalTermAccepted}
          onChange={setLegalTermAccepted}
        />
      </Card>

      <Button
        variant="primary"
        size="lg"
        loading={busy}
        disabled={!formValid || busy}
        onClick={submit}
        style={{ borderRadius: "9999px", width: "100%", marginTop: "8px" }}
      >
        Concluir Auto-Cadastro PJ ➔
      </Button>

      {showFaceModal && (
        <FaceCaptureModal
          onClose={() => setShowFaceModal(false)}
          onCaptured={(descriptor, base64, previewUrl) => {
            setFaceDescriptor(descriptor);
            setFacePhotoBase64(base64);
            setFacePhotoPreviewUrl(previewUrl);
          }}
        />
      )}
    </div>
  );
}
