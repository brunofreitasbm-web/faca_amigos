import { useState, useEffect } from "react";
import { Button, Input, Modal, HelpText } from "@facaamigos/ui";
import { formatCpf, formatPhoneBr, isValidCpf, isValidPhoneBr } from "@facaamigos/domain";
import { Api } from "../api/client.js";
import { supabase } from "../lib/supabase/client.js";
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
    childBirthDate?: string | null;
    notes?: string | null;
  };
}

function calculateBirthdayDetails(birthDateStr?: string) {
  if (!birthDateStr) return null;
  const birth = new Date(birthDateStr + "T00:00:00");
  if (isNaN(birth.getTime())) return null;

  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
    age--;
  }

  const currentYearBirthday = new Date(today.getFullYear(), birth.getMonth(), birth.getDate());
  let nextBirthday = currentYearBirthday;
  const todayReset = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  
  if (currentYearBirthday < todayReset) {
    nextBirthday = new Date(today.getFullYear() + 1, birth.getMonth(), birth.getDate());
  }

  const diffTime = nextBirthday.getTime() - todayReset.getTime();
  const daysUntil = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return {
    age: Math.max(0, age),
    daysUntil,
    isSoon: daysUntil <= 30,
    isToday: daysUntil === 0,
  };
}

export function EditRegistrationModal({ open, onClose, onSaved, initialData }: EditRegistrationModalProps) {
  const toast = useToast();
  const [guardianName, setGuardianName] = useState("");
  const [guardianPhone, setGuardianPhone] = useState("");
  const [guardianCpf, setGuardianCpf] = useState("");
  const [childName, setChildName] = useState("");
  const [childBirthDate, setChildBirthDate] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingChild, setLoadingChild] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setGuardianName(initialData.guardianName || "");
      setGuardianPhone(initialData.guardianPhone ? formatPhoneBr(initialData.guardianPhone) : "");
      setGuardianCpf(initialData.guardianCpf ? formatCpf(initialData.guardianCpf) : "");
      setChildName(initialData.childName || "");
      setChildBirthDate(initialData.childBirthDate || "");
      setNotes(initialData.notes || "");
      setError(null);

      if (initialData.childId) {
        setLoadingChild(true);
        (async () => {
          try {
            const { data } = await supabase()
              .from("fa_kiosk_children")
              .select("birth_date, notes")
              .eq("id", initialData.childId)
              .maybeSingle();
            if (data) {
              if (data.birth_date) setChildBirthDate(data.birth_date);
              if (data.notes) setNotes(data.notes);
            }
          } catch {
            // Silenciosamente ignora em caso de indisponibilidade
          } finally {
            setLoadingChild(false);
          }
        })();
      }
    }
  }, [open, initialData]);

  const cleanCpf = guardianCpf.replace(/\D/g, "");
  const cleanPhone = guardianPhone.replace(/\D/g, "");

  const isCpfValid = Boolean(cleanCpf && cleanCpf.length === 11 && isValidCpf(guardianCpf));
  const isPhoneValid = Boolean(cleanPhone && cleanPhone.length >= 10 && isValidPhoneBr(guardianPhone));
  const canSave = Boolean(guardianName.trim() && childName.trim() && isCpfValid && isPhoneValid);

  const birthdayInfo = calculateBirthdayDetails(childBirthDate);

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
        childBirthDate: childBirthDate || null,
        notes: notes.trim() || null,
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
    <Modal title="✏️ Editar Cadastro & Oportunidades" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: "14px", minWidth: "320px", maxWidth: "480px" }}>
        <HelpText style={{ margin: 0 }}>
          Edite abaixo os dados do responsável e da criança. Atualize a data de nascimento para ativar campanhas de aniversário e combos promocionais.
        </HelpText>

        {birthdayInfo?.isSoon && (
          <div
            style={{
              padding: "10px 14px",
              borderRadius: "8px",
              background: "linear-gradient(135deg, #fff3e0 0%, #ffe0b2 100%)",
              border: "1px solid #ffb74d",
              color: "#e65100",
              fontSize: "13px",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <span>🎂</span>
            <div>
              <strong>{birthdayInfo.isToday ? "ANIVERSÁRIO HOJE! 🎉" : `Aniversário próximo (${birthdayInfo.daysUntil} dias)!`}</strong>
              <div style={{ fontSize: "12px", fontWeight: "normal", marginTop: "2px" }}>
                Oportunidade Comercial: Ofereça o Pacote de Festa ou Combo Especial de Aniversariante!
              </div>
            </div>
          </div>
        )}

        <Input
          label="Nome do Responsável"
          placeholder="Ex: João da Silva"
          value={guardianName}
          onChange={(e) => setGuardianName(e.target.value)}
        />

        <Input
          label="Telefone (WhatsApp) *"
          placeholder="(00) 00000-0000 (Obrigatório)"
          value={guardianPhone}
          onChange={(e) => setGuardianPhone(formatPhoneBr(e.target.value))}
          error={!cleanPhone ? "WhatsApp do responsável é obrigatório" : !isPhoneValid ? "Informe um número de WhatsApp válido" : undefined}
        />

        <Input
          label="CPF do Responsável *"
          placeholder="000.000.000-00 (Obrigatório)"
          value={guardianCpf}
          onChange={(e) => setGuardianCpf(formatCpf(e.target.value))}
          error={!cleanCpf ? "CPF do responsável é obrigatório" : !isCpfValid ? "Informe um CPF válido com 11 dígitos" : undefined}
        />

        <div style={{ borderTop: "1px solid var(--color-border, #eee)", paddingTop: "12px", marginTop: "4px" }}>
          <div style={{ fontWeight: 600, fontSize: "14px", marginBottom: "10px", color: "var(--color-text-heading, #111)" }}>
            👶 Dados da Criança {birthdayInfo && <span style={{ fontSize: "12px", color: "var(--color-muted, #666)", fontWeight: "normal" }}>({birthdayInfo.age} anos)</span>}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <Input
              label="Nome da Criança"
              placeholder="Ex: Pedrinho"
              value={childName}
              onChange={(e) => setChildName(e.target.value)}
            />

            <Input
              label="Data de Nascimento"
              type="date"
              value={childBirthDate}
              onChange={(e) => setChildBirthDate(e.target.value)}
              disabled={loadingChild}
            />

            <Input
              label="Observações / Cuidados Especiais"
              placeholder="Ex: Alergias, restrições ou preferências"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={loadingChild}
            />
          </div>
        </div>

        {error && (
          <div style={{ color: "var(--color-danger, #e53935)", fontSize: "13px", fontWeight: "bold" }}>
            ⚠️ {error}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px", marginTop: "8px" }}>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={!canSave || busy || loadingChild}>
            {busy ? "Salvando..." : "Salvar Alterações"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
