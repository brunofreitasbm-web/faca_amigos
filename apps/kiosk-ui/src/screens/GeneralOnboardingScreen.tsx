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
      title="Autocaptação de Biometria Facial"
      onClose={() => {
        stop();
        onClose();
      }}
      maxWidth="480px"
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <HelpText>
          Posicione seu rosto dentro da moldura para registrar a biometria facial. Seu registro será utilizado para a
          confirmação rápida da jornada de trabalho (controle de frequência).
        </HelpText>

        {!ready && !starting && (
          <Checkbox
            label="Autorizo o uso da minha imagem e biometria facial para identificação biométrica e registro de jornada."
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
        faceDescriptor: faceDescriptor || undefined,
        facePhotoBase64: facePhotoBase64 || undefined,
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
          Seus dados e registro facial foram salvos. Você já pode entrar no sistema com o seu nome e o PIN que escolheu.
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
          Preencha seus dados abaixo, cadastre seu rosto para o controle de frequência e escolha seu PIN de acesso.
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

      {/* Card de Cadastrar Rosto (Biometria Facial) */}
      <Card style={{ padding: "20px", borderRadius: "18px", background: "var(--surface-subtle, #f8fafc)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
            <div>
              <h3 style={{ margin: 0, fontSize: "16px", fontWeight: "bold" }}>Biometria Facial (Recomendado)</h3>
              <p style={{ margin: "4px 0 0 0", fontSize: "13px", color: "var(--text-muted)" }}>
                Cadastre seu rosto para o registro de frequência ultrarrápido por reconhecimento facial no quiosque.
              </p>
            </div>
            {facePhotoPreviewUrl ? (
              <span
                style={{
                  fontSize: "12px",
                  fontWeight: "bold",
                  color: "var(--color-success-text, #15803d)",
                  background: "#dcfce7",
                  padding: "4px 10px",
                  borderRadius: "9999px",
                }}
              >
                ✓ Rosto Cadastrado
              </span>
            ) : (
              <span
                style={{
                  fontSize: "12px",
                  fontWeight: "bold",
                  color: "var(--text-muted)",
                  background: "var(--border-subtle, #e2e8f0)",
                  padding: "4px 10px",
                  borderRadius: "9999px",
                }}
              >
                Pendente
              </span>
            )}
          </div>

          {facePhotoPreviewUrl ? (
            <div style={{ display: "flex", alignItems: "center", gap: "16px", marginTop: "8px" }}>
              <img
                src={facePhotoPreviewUrl}
                alt="Foto do rosto capturado"
                style={{
                  width: "64px",
                  height: "64px",
                  borderRadius: "50%",
                  objectFit: "cover",
                  border: "3px solid #22c55e",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                }}
              />
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <span style={{ fontSize: "14px", fontWeight: "bold", color: "var(--text-main)" }}>
                  Biometria capturada com sucesso!
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowFaceModal(true)}
                  style={{ alignSelf: "flex-start", paddingLeft: 0, textDecoration: "underline" }}
                >
                  📸 Refazer foto do rosto
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="secondary"
              onClick={() => setShowFaceModal(true)}
              style={{
                borderRadius: "9999px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                marginTop: "4px",
                fontWeight: "bold",
              }}
            >
              📸 Cadastrar Rosto
            </Button>
          )}
        </div>
      </Card>

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

      {error && <p style={{ color: "var(--color-error-text)", margin: 0, fontWeight: "bold" }}>{error}</p>}

      <div style={{ display: "flex", gap: "10px" }}>
        <Button variant="primary" disabled={busy || !formValid} onClick={submit} style={{ borderRadius: "9999px" }}>
          {busy ? "Enviando…" : "✓ Concluir cadastro"}
        </Button>
      </div>
    </div>
  );
}

