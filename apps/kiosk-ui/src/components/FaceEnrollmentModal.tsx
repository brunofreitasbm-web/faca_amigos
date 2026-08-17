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
        toast.error("Não conseguimos identificar um rosto no quadro. Centralize o rosto e tente de novo.");
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

        {!ready && (
          <Checkbox
            label="Autorizo o uso da minha foto e dos dados biométricos faciais extraídos dela para confirmar minha identidade ao bater o ponto."
            checked={consent}
            onChange={setConsent}
          />
        )}

        {error && <p style={{ color: "var(--color-error-text)" }}>{error}</p>}

        {ready ? (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              style={{ width: "100%", borderRadius: "var(--radius-lg, 16px)", background: "#000", transform: "scaleX(-1)" }}
            />
            <Button variant="primary" size="lg" loading={saving} disabled={saving} onClick={handleCapture}>
              Capturar e cadastrar
            </Button>
          </>
        ) : (
          <Button variant="primary" size="lg" loading={starting} disabled={!consent || starting} onClick={handleStart}>
            Ligar câmera
          </Button>
        )}
      </div>
    </Modal>
  );
}
