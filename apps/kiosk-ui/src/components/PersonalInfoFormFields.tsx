import { Card, HelpText, Input, Select } from "@facaamigos/ui";
import type { EmployeePersonalInfo } from "../api/client.js";

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
const UF_OPTIONS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR",
  "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
];

export const emptyPersonalInfo: EmployeePersonalInfo = {
  ctpsNumero: "", ctpsSerie: "", ctpsUf: "",
  rgNumero: "", rgOrgaoEmissor: "",
  nomeMae: "", nomePai: "",
  estadoCivil: "", escolaridade: "",
  cep: "", logradouro: "", numero: "", complemento: "", bairro: "", cidade: "", uf: "",
  emergencyContactName: "", emergencyContactPhone: "",
};

export interface BankInfo {
  bankCode: string;
  bankAgencia: string;
  bankConta: string;
  bankContaDv: string;
}

export const emptyBankInfo: BankInfo = { bankCode: "", bankAgencia: "", bankConta: "", bankContaDv: "" };

/**
 * Documentos + filiação + endereço + contato de emergência + dados
 * bancários — usado na tela pública de convite (pessoa ainda sem conta,
 * criando o cadastro do zero). Controlado: quem usa decide onde o estado
 * mora e o que fazer ao salvar.
 */
export function PersonalInfoFormFields({
  form,
  onChange,
  bankInfo,
  onBankInfoChange,
  pixKey,
  onPixKeyChange,
}: {
  form: EmployeePersonalInfo;
  onChange: <K extends keyof EmployeePersonalInfo>(key: K, value: EmployeePersonalInfo[K]) => void;
  bankInfo: BankInfo;
  onBankInfoChange: <K extends keyof BankInfo>(key: K, value: BankInfo[K]) => void;
  pixKey: string;
  onPixKeyChange: (value: string) => void;
}) {
  return (
    <>
      <Card style={{ padding: "20px", borderRadius: "18px" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: "17px", margin: "0 0 12px 0" }}>Documentos</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px" }}>
          <Input label="RG (número)" value={form.rgNumero ?? ""} onChange={(e) => onChange("rgNumero", e.target.value)} />
          <Input label="RG (órgão emissor)" placeholder="Ex: SSP-PA" value={form.rgOrgaoEmissor ?? ""} onChange={(e) => onChange("rgOrgaoEmissor", e.target.value)} />
          <Input label="CTPS (número)" value={form.ctpsNumero ?? ""} onChange={(e) => onChange("ctpsNumero", e.target.value)} />
          <Input label="CTPS (série)" value={form.ctpsSerie ?? ""} onChange={(e) => onChange("ctpsSerie", e.target.value)} />
          <Select label="CTPS (UF)" value={form.ctpsUf ?? ""} onChange={(e) => onChange("ctpsUf", e.target.value)}>
            <option value="">Selecione</option>
            {UF_OPTIONS.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
          </Select>
        </div>
      </Card>

      <Card style={{ padding: "20px", borderRadius: "18px" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: "17px", margin: "0 0 12px 0" }}>Filiação e dados pessoais</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px" }}>
          <Input label="Nome da mãe" value={form.nomeMae ?? ""} onChange={(e) => onChange("nomeMae", e.target.value)} />
          <Input label="Nome do pai (opcional)" value={form.nomePai ?? ""} onChange={(e) => onChange("nomePai", e.target.value)} />
          <Select label="Estado civil" value={form.estadoCivil ?? ""} onChange={(e) => onChange("estadoCivil", e.target.value)}>
            <option value="">Selecione</option>
            {ESTADO_CIVIL_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
          </Select>
          <Select label="Escolaridade" value={form.escolaridade ?? ""} onChange={(e) => onChange("escolaridade", e.target.value)}>
            <option value="">Selecione</option>
            {ESCOLARIDADE_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
          </Select>
        </div>
      </Card>

      <Card style={{ padding: "20px", borderRadius: "18px" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: "17px", margin: "0 0 12px 0" }}>Endereço</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "12px" }}>
          <Input label="CEP" value={form.cep ?? ""} onChange={(e) => onChange("cep", e.target.value.replace(/\D/g, "").slice(0, 8))} />
          <Input label="Logradouro" value={form.logradouro ?? ""} onChange={(e) => onChange("logradouro", e.target.value)} />
          <Input label="Número" value={form.numero ?? ""} onChange={(e) => onChange("numero", e.target.value)} />
          <Input label="Complemento" value={form.complemento ?? ""} onChange={(e) => onChange("complemento", e.target.value)} />
          <Input label="Bairro" value={form.bairro ?? ""} onChange={(e) => onChange("bairro", e.target.value)} />
          <Input label="Cidade" value={form.cidade ?? ""} onChange={(e) => onChange("cidade", e.target.value)} />
          <Select label="UF" value={form.uf ?? ""} onChange={(e) => onChange("uf", e.target.value)}>
            <option value="">Selecione</option>
            {UF_OPTIONS.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
          </Select>
        </div>
      </Card>

      <Card style={{ padding: "20px", borderRadius: "18px" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: "17px", margin: "0 0 12px 0" }}>Contato de emergência</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px" }}>
          <Input label="Nome" value={form.emergencyContactName ?? ""} onChange={(e) => onChange("emergencyContactName", e.target.value)} />
          <Input label="Telefone" placeholder="(91) 99999-9999" value={form.emergencyContactPhone ?? ""} onChange={(e) => onChange("emergencyContactPhone", e.target.value)} />
        </div>
      </Card>

      <Card style={{ padding: "20px", borderRadius: "18px" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: "17px", margin: "0 0 12px 0" }}>Dados bancários</h2>
        <HelpText style={{ marginTop: 0 }}>
          Conta corrente para depósito. O salário em si fica a cargo do Owner.
        </HelpText>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "12px", marginTop: "8px" }}>
          <Input label="Banco" placeholder="Ex: 237 - Bradesco" value={bankInfo.bankCode} onChange={(e) => onBankInfoChange("bankCode", e.target.value)} />
          <Input label="Agência" value={bankInfo.bankAgencia} onChange={(e) => onBankInfoChange("bankAgencia", e.target.value.replace(/\D/g, ""))} />
          <Input label="Conta corrente (sem dígito)" value={bankInfo.bankConta} onChange={(e) => onBankInfoChange("bankConta", e.target.value.replace(/\D/g, ""))} />
          <Input label="Dígito" maxLength={2} value={bankInfo.bankContaDv} onChange={(e) => onBankInfoChange("bankContaDv", e.target.value.replace(/\D/g, "").slice(0, 2))} />
          <Input label="Chave Pix" placeholder="CPF, e-mail, telefone ou chave aleatória" value={pixKey} onChange={(e) => onPixKeyChange(e.target.value)} />
        </div>
      </Card>
    </>
  );
}
