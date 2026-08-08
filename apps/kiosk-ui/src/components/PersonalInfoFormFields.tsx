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
// Categorias oficiais do IBGE/eSocial — não é lista livre de propósito, para
// bater com o que a folha de pagamento precisa declarar.
const RACA_COR_OPTIONS = ["Branca", "Preta", "Parda", "Amarela", "Indígena", "Prefiro não informar"];
const UF_OPTIONS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR",
  "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
];

export const emptyPersonalInfo: EmployeePersonalInfo = {
  ctpsNumero: "", ctpsSerie: "", ctpsUf: "",
  rgNumero: "", rgOrgaoEmissor: "",
  nomeMae: "", nomePai: "",
  estadoCivil: "", escolaridade: "", racaCor: "",
  cep: "", logradouro: "", numero: "", complemento: "", bairro: "", cidade: "", uf: "",
  emergencyContactName: "", emergencyContactPhone: "",
};

/**
 * Documentos + filiação + endereço + contato de emergência + Pix — usado
 * tanto no módulo "Cadastro de Colaboradores" (colaborador já logado
 * completando os próprios dados) quanto na tela pública de convite (pessoa
 * ainda sem conta, criando o cadastro do zero). Controlado: quem usa decide
 * onde o estado mora e o que fazer ao salvar.
 */
export function PersonalInfoFormFields({
  form,
  onChange,
  pixKey,
  onPixKeyChange,
}: {
  form: EmployeePersonalInfo;
  onChange: <K extends keyof EmployeePersonalInfo>(key: K, value: EmployeePersonalInfo[K]) => void;
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
          <Select label="Raça/cor" value={form.racaCor ?? ""} onChange={(e) => onChange("racaCor", e.target.value)}>
            <option value="">Selecione</option>
            {RACA_COR_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
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
          Só a chave Pix é preenchida por aqui. Salário e conta bancária completa ficam a cargo do Owner.
        </HelpText>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px", marginTop: "8px" }}>
          <Input label="Chave Pix" placeholder="CPF, e-mail, telefone ou chave aleatória" value={pixKey} onChange={(e) => onPixKeyChange(e.target.value)} />
        </div>
      </Card>
    </>
  );
}
