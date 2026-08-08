import { useEffect, useState } from "react";
import { Button, Card, HelpText, Input, Select } from "@facaamigos/ui";
import { Api } from "../api/client.js";
import type { EmployeePersonalInfo } from "../api/client.js";
import { useToast } from "../state/ToastContext.js";

const ESTADO_CIVIL_OPTIONS = ["Solteiro(a)", "Casado(a)", "União estável", "Divorciado(a)", "Viúvo(a)"];
const ESCOLARIDADE_OPTIONS = [
  "Fundamental incompleto",
  "Fundamental completo",
  "Médio incompleto",
  "Médio completo",
  "Superior incompleto",
  "Superior completo",
  "Pós-graduação",
];
// Categorias oficiais do IBGE/eSocial — não é lista livre de propósito, para
// bater com o que a folha de pagamento precisa declarar.
const RACA_COR_OPTIONS = ["Branca", "Preta", "Parda", "Amarela", "Indígena", "Prefiro não informar"];
const UF_OPTIONS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR",
  "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
];

const emptyForm: EmployeePersonalInfo = {
  ctpsNumero: "", ctpsSerie: "", ctpsUf: "",
  rgNumero: "", rgOrgaoEmissor: "",
  nomeMae: "", nomePai: "",
  estadoCivil: "", escolaridade: "", racaCor: "",
  cep: "", logradouro: "", numero: "", complemento: "", bairro: "", cidade: "", uf: "",
  emergencyContactName: "", emergencyContactPhone: "",
};

export function MeuCadastroScreen({ onExit }: { onExit: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState<EmployeePersonalInfo>(emptyForm);
  const [pixKey, setPixKey] = useState("");
  const [completedAtMs, setCompletedAtMs] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([Api.myPersonalInfo(), Api.myPix()])
      .then(([info, pix]) => {
        if (info) {
          setForm({ ...emptyForm, ...info });
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
          <Card style={{ padding: "20px", borderRadius: "18px" }}>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: "17px", margin: "0 0 12px 0" }}>Documentos</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px" }}>
              <Input label="RG (número)" value={form.rgNumero ?? ""} onChange={(e) => set("rgNumero", e.target.value)} />
              <Input label="RG (órgão emissor)" placeholder="Ex: SSP-PA" value={form.rgOrgaoEmissor ?? ""} onChange={(e) => set("rgOrgaoEmissor", e.target.value)} />
              <Input label="CTPS (número)" value={form.ctpsNumero ?? ""} onChange={(e) => set("ctpsNumero", e.target.value)} />
              <Input label="CTPS (série)" value={form.ctpsSerie ?? ""} onChange={(e) => set("ctpsSerie", e.target.value)} />
              <Select label="CTPS (UF)" value={form.ctpsUf ?? ""} onChange={(e) => set("ctpsUf", e.target.value)}>
                <option value="">Selecione</option>
                {UF_OPTIONS.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
              </Select>
            </div>
          </Card>

          <Card style={{ padding: "20px", borderRadius: "18px" }}>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: "17px", margin: "0 0 12px 0" }}>Filiação e dados pessoais</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px" }}>
              <Input label="Nome da mãe" value={form.nomeMae ?? ""} onChange={(e) => set("nomeMae", e.target.value)} />
              <Input label="Nome do pai (opcional)" value={form.nomePai ?? ""} onChange={(e) => set("nomePai", e.target.value)} />
              <Select label="Estado civil" value={form.estadoCivil ?? ""} onChange={(e) => set("estadoCivil", e.target.value)}>
                <option value="">Selecione</option>
                {ESTADO_CIVIL_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
              </Select>
              <Select label="Escolaridade" value={form.escolaridade ?? ""} onChange={(e) => set("escolaridade", e.target.value)}>
                <option value="">Selecione</option>
                {ESCOLARIDADE_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
              </Select>
              <Select label="Raça/cor" value={form.racaCor ?? ""} onChange={(e) => set("racaCor", e.target.value)}>
                <option value="">Selecione</option>
                {RACA_COR_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
              </Select>
            </div>
          </Card>

          <Card style={{ padding: "20px", borderRadius: "18px" }}>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: "17px", margin: "0 0 12px 0" }}>Endereço</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "12px" }}>
              <Input label="CEP" value={form.cep ?? ""} onChange={(e) => set("cep", e.target.value.replace(/\D/g, "").slice(0, 8))} />
              <Input label="Logradouro" value={form.logradouro ?? ""} onChange={(e) => set("logradouro", e.target.value)} />
              <Input label="Número" value={form.numero ?? ""} onChange={(e) => set("numero", e.target.value)} />
              <Input label="Complemento" value={form.complemento ?? ""} onChange={(e) => set("complemento", e.target.value)} />
              <Input label="Bairro" value={form.bairro ?? ""} onChange={(e) => set("bairro", e.target.value)} />
              <Input label="Cidade" value={form.cidade ?? ""} onChange={(e) => set("cidade", e.target.value)} />
              <Select label="UF" value={form.uf ?? ""} onChange={(e) => set("uf", e.target.value)}>
                <option value="">Selecione</option>
                {UF_OPTIONS.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
              </Select>
            </div>
          </Card>

          <Card style={{ padding: "20px", borderRadius: "18px" }}>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: "17px", margin: "0 0 12px 0" }}>Contato de emergência</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px" }}>
              <Input label="Nome" value={form.emergencyContactName ?? ""} onChange={(e) => set("emergencyContactName", e.target.value)} />
              <Input label="Telefone" placeholder="(91) 99999-9999" value={form.emergencyContactPhone ?? ""} onChange={(e) => set("emergencyContactPhone", e.target.value)} />
            </div>
          </Card>

          <Card style={{ padding: "20px", borderRadius: "18px" }}>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: "17px", margin: "0 0 12px 0" }}>Dados bancários</h2>
            <HelpText style={{ marginTop: 0 }}>
              Só a chave Pix é preenchida por aqui. Salário e conta bancária completa ficam a cargo do Owner.
            </HelpText>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px", marginTop: "8px" }}>
              <Input label="Chave Pix" placeholder="CPF, e-mail, telefone ou chave aleatória" value={pixKey} onChange={(e) => setPixKey(e.target.value)} />
            </div>
          </Card>

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
