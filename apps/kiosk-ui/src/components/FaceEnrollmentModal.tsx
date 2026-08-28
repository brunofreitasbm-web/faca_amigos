import { useState } from "react";
import { Button, Checkbox, HelpText, Modal } from "@facaamigos/ui";
import { Api } from "../api/client.js";
import { useFaceCapture } from "../hooks/useFaceCapture.js";
import { useToast } from "../state/ToastContext.js";

export interface FaceEnrollmentModalProps {
  employeeId: string;
  employeeName: string;
  onClose: () => void;
  onEnrolled?: () => void;
}

/**
 * Cadastro do rosto para reconhecimento facial no quiosque. Dado biométrico
 * é categoria sensível na LGPD (art. 5º, II) — por isso o consentimento
 * explícito aqui não é decoração: sem marcar a caixa, o botão de captura
 * nem aparece. A gravação em si (RPC `fa_kiosk_enroll_face`) audita quem
 * cadastrou o quê, mas o consentimento do próprio titular é capturado nesta
 * tela, antes de qualquer chamada à câmera.
 */
export function FaceEnrollmentModal({ employeeId, employeeName, onClose, onEnrolled }: FaceEnrollmentModalProps) {
  const toast = useToast();
  const [consent, setConsent] = useState(false);
  const [saving, setSaving] = useState(false);
  const { videoRef, ready, starting, error, start, stop, capture } = useFaceCapture();

  async function handleStart() {
    await start();
  }

  async function handleCapture() {
    setSaving(true);
    try {
      const result = await capture();
      if (!result) {
        toast.error("Não conseguimos identificar um rosto no quadro. Centralize o rosto na moldura e tente de novo.");
        return;
      }
      const photoPath = await Api.uploadPontoFoto(employeeId, result.photo, "enroll");
      await Api.enrollFace(employeeId, result.descriptor, photoPath);
      toast.success(`Rosto de ${employeeName} cadastrado.`);
      stop();
      onEnrolled?.();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível cadastrar o rosto.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Cadastrar rosto — ${employeeName}`} onClose={() => { stop(); onClose(); }} maxWidth="480px">
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <HelpText>
          A foto e o padrão facial extraído dela passam a ser usados como uma segunda prova de identidade ao bater
          o ponto neste quiosque, além do login/PIN.
        </HelpText>

        {!ready && !starting && (
          <Checkbox
            label="Autorizo o uso da minha foto e dos dados biométricos faciais extraídos dela para confirmar minha identidade ao bater o ponto."
            checked={consent}
            onChange={setConsent}
          />
        )}

        {error && (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <p style={{ color: "var(--color-error-text)", margin: 0 }}>{error}</p>
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
              borderRadius: "var(--radius-lg, 16px)",
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

            {/* Indicator de carregamento enquanto a câmera/modelos iniciam */}
            {starting && (
              <div style={{ color: "#fff", display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "14px", fontWeight: 500 }}>📷 Inicializando câmera e IA…</span>
              </div>
            )}

            {/* Guia oval para centralizar o rosto */}
            {ready && (
              <div
                style={{
                  position: "absolute",
                  top: "50%",
                  left: "50%",
                  transform: "translate(-50%, -50%)",
                  width: "140px",
                  height: "180px",
                  borderRadius: "50%",
                  border: "3px dashed rgba(255, 255, 255, 0.7)",
                  boxShadow: "0 0 20px rgba(0,0,0,0.5)",
                  pointerEvents: "none",
                }}
              />
            )}
          </div>
        )}

        {ready ? (
          <Button variant="primary" size="lg" loading={saving} disabled={saving} onClick={handleCapture}>
            Capturar e cadastrar
          </Button>
        ) : (
          !starting && (
            <Button variant="primary" size="lg" loading={starting} disabled={!consent || starting} onClick={handleStart}>
              Ligar câmera
            </Button>
          )
        )}
      </div>
    </Modal>
  );
}

