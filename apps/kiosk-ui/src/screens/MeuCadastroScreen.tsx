import { useEffect, useState } from "react";
import { Button, HelpText } from "@facaamigos/ui";
import { Api } from "../api/client.js";
import type { EmployeePersonalInfo } from "../api/client.js";
import { useToast } from "../state/ToastContext.js";
import { PersonalInfoFormFields, emptyPersonalInfo } from "../components/PersonalInfoFormFields.js";

export function MeuCadastroScreen({ onExit }: { onExit: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState<EmployeePersonalInfo>(emptyPersonalInfo);
  const [pixKey, setPixKey] = useState("");
  const [completedAtMs, setCompletedAtMs] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([Api.myPersonalInfo(), Api.myPix()])
      .then(([info, pix]) => {
        if (info) {
          setForm({ ...emptyPersonalInfo, ...info });
          setCompletedAtMs(info.completedAtMs ?? null);
        }
        if (pix) setPixKey(pix);
      })
      .finally(() => setLoading(false));
  }, []);

  function set<K extends keyof EmployeePersonalInfo>(key: K, value: EmployeePersonalInfo[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    setBusy(true);
    try {
      await Promise.all([Api.updateMyPersonalInfo(form), Api.updateMyPix(pixKey)]);
      setCompletedAtMs(Date.now());
      toast.success("Seus dados foram salvos.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar seus dados");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: "900px", margin: "0 auto", padding: "clamp(16px, 3vw, 32px)", display: "flex", flexDirection: "column", gap: "20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h1 style={{ fontFamily: "var(--font-display)", margin: 0, fontSize: "24px" }}>📋 Cadastro de Colaboradores</h1>
          <HelpText style={{ marginTop: "4px" }}>
            Complete os seus dados de RH. Só você tem acesso a essas informações — o Owner vê o cadastro, mas não pode
            editá-lo por aqui.
          </HelpText>
          {completedAtMs && (
            <p style={{ margin: "6px 0 0 0", fontSize: "13px", color: "var(--text-secondary)" }}>
              ✓ Preenchido em {new Date(completedAtMs).toLocaleDateString("pt-BR")}. Pode voltar aqui e corrigir quando
              quiser.
            </p>
          )}
        </div>
        <Button variant="ghost" onClick={onExit}>
          ← Voltar
        </Button>
      </div>

      {loading ? (
        <p style={{ color: "var(--text-muted)" }}>Carregando…</p>
      ) : (
        <>
          <PersonalInfoFormFields form={form} onChange={set} pixKey={pixKey} onPixKeyChange={setPixKey} />

          <div style={{ display: "flex", gap: "10px" }}>
            <Button variant="primary" disabled={busy} onClick={save} style={{ borderRadius: "9999px" }}>
              {busy ? "Salvando…" : "✓ Salvar meus dados"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
