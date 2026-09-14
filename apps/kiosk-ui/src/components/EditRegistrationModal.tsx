import { useState, useEffect } from "react";
import { Button, Input, Modal, HelpText } from "@facaamigos/ui";
import { formatCpf, formatPhoneBr } from "@facaamigos/domain";
import { Api } from "../api/client.js";
import { useToast } from "../state/ToastContext.js";

export interface EditRegistrationModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  initialData: {
    guardianId?: string | null;
    childId?: string | null;
    sessionId?: string | null;
    guardianName?: string;
    guardianPhone?: string;
    guardianCpf?: string;
    childName?: string;
  };
}

export function EditRegistrationModal({ open, onClose, onSaved, initialData }: EditRegistrationModalProps) {
  const toast = useToast();
  const [guardianName, setGuardianName] = useState("");
  const [guardianPhone, setGuardianPhone] = useState("");
  const [guardianCpf, setGuardianCpf] = useState("");
  const [childName, setChildName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setGuardianName(initialData.guardianName || "");
      setGuardianPhone(initialData.guardianPhone ? formatPhoneBr(initialData.guardianPhone) : "");
      setGuardianCpf(initialData.guardianCpf ? formatCpf(initialData.guardianCpf) : "");
      setChildName(initialData.childName || "");
      setError(null);
    }
  }, [open, initialData]);

  const cleanCpf = guardianCpf.replace(/\D/g, "");
  const cleanPhone = guardianPhone.replace(/\D/g, "");

  const isCpfValid = !cleanCpf || cleanCpf.length === 11;
  const isPhoneValid = !cleanPhone || cleanPhone.length >= 10;
  const canSave = Boolean(guardianName.trim() && childName.trim() && isCpfValid && isPhoneValid);

  async function handleSave() {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      await Api.updateCustomerRegistration({
        guardianId: initialData.guardianId,
        childId: initialData.childId,
        sessionId: initialData.sessionId,
        guardianName: guardianName.trim(),
        guardianPhone: cleanPhone,
        guardianCpf: cleanCpf,
        childName: childName.trim(),
      });
      toast.success("Dados cadastrais atualizados com sucesso!");
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao atualizar dados cadastrais.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <Modal title="✏️ Editar Dados Cadastrais" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px", minWidth: "320px", maxWidth: "480px" }}>
        <HelpText style={{ margin: 0 }}>
          Edite abaixo os dados do responsável e da criança. As alterações serão gravadas no cadastro e refletidas no atendimento atual.
        </HelpText>

        <Input
          label="Nome do Responsável"
          placeholder="Ex: João da Silva"
          value={guardianName}
          onChange={(e) => setGuardianName(e.target.value)}
        />

        <Input
          label="Telefone (WhatsApp)"
          placeholder="(00) 00000-0000"
          value={guardianPhone}
          onChange={(e) => setGuardianPhone(formatPhoneBr(e.target.value))}
          error={guardianPhone && !isPhoneValid ? "Informe um número de telefone válido" : undefined}
        />

        <Input
          label="CPF do Responsável"
          placeholder="000.000.000-00"
          value={guardianCpf}
          onChange={(e) => setGuardianCpf(formatCpf(e.target.value))}
          error={guardianCpf && !isCpfValid ? "CPF deve possuir 11 dígitos" : undefined}
        />

        <Input
          label="Nome da Criança"
          placeholder="Ex: Pedrinho"
          value={childName}
          onChange={(e) => setChildName(e.target.value)}
        />

        {error && (
          <div style={{ color: "var(--color-danger, #e53935)", fontSize: "13px", fontWeight: "bold" }}>
            ⚠️ {error}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px", marginTop: "12px" }}>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={!canSave || busy}>
            {busy ? "Salvando..." : "Salvar Alterações"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
