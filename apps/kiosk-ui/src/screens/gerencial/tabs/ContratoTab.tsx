import { useEffect, useState } from "react";
import { Button, HelpText, Select, Tag } from "@facaamigos/ui";
import { Api } from "../../../api/client.js";
import type { Unit } from "../../../api/client.js";
import { useToast } from "../../../state/ToastContext.js";
import {
  CONTRACT_PLACEHOLDERS,
  DEFAULT_CONTRACT_TEMPLATE,
  buildContractHtml,
  fillContractTemplate,
  printContract,
} from "../../../contract/contractTemplate.js";

/**
 * Gerencial > Contrato — modelo do contrato dos planos acima de 2h.
 *
 * O texto é por unidade (o timbre e o CNPJ da impressão também são): o
 * dono escolhe a unidade, edita a minuta e salva. Os campos entre chaves
 * duplas ({{ASSIM}}) são preenchidos automaticamente na Entrada, com os
 * dados do cadastro do Responsável Contratante e do plano vendido.
 */
export function ContratoTab() {
  const toast = useToast();
  const [units, setUnits] = useState<Unit[]>([]);
  const [unitId, setUnitId] = useState<string>("");
  const [template, setTemplate] = useState<string>(DEFAULT_CONTRACT_TEMPLATE);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [customized, setCustomized] = useState(false);

  useEffect(() => {
    Api.units().then((rows) => {
      setUnits(rows);
      const first = rows[0];
      if (first) setUnitId((prev) => prev || first.id);
    });
  }, []);

  useEffect(() => {
    if (!unitId) return;
    setLoading(true);
    Api.unitSetting(unitId, "hour_bank_contract_template")
      .then((r) => {
        setTemplate(r.value || DEFAULT_CONTRACT_TEMPLATE);
        setCustomized(Boolean(r.value));
      })
      .catch(() => {
        setTemplate(DEFAULT_CONTRACT_TEMPLATE);
        setCustomized(false);
      })
      .finally(() => setLoading(false));
  }, [unitId]);

  async function save() {
    if (!unitId) return;
    setSaving(true);
    try {
      await Api.setUnitSetting(unitId, "hour_bank_contract_template", template);
      setCustomized(true);
      toast.success("Modelo do contrato salvo para esta unidade.");
    } catch {
      toast.error("Não foi possível salvar o modelo.");
    } finally {
      setSaving(false);
    }
  }

  function printSample() {
    const unit = units.find((u) => u.id === unitId);
    const data = {
      unitName: unit?.name ?? "Unidade FaçaAmigos",
      unitCnpj: unit?.cnpj ?? "00.000.000/0000-00",
      unitAddress: unit?.address ?? "",
      unitPhone: unit?.phone ?? "",
      contratanteNome: "Maria Exemplo da Silva",
      contratanteCpf: "000.000.000-00",
      contratanteRg: "0000000 SSP/PA",
      contratanteEndereco: "Rua Exemplo, 100, Bairro, Belém/PA, CEP 66000-000",
      contratanteTelefone: "(91) 90000-0000",
      contratanteEmail: "maria@example.com",
      criancaNome: "Joãozinho Exemplo",
      planoNome: "Plano 3 horas",
      planoHoras: "3 horas",
      planoValor: "120,00",
      validadeBancoDias: "45",
      cidadeUf: "Belém/PA",
    };
    printContract(buildContractHtml(fillContractTemplate(template, data), data));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <HelpText>
        Este é o contrato impresso na <strong>Entrada</strong> quando a família compra um plano acima de 2h — ele
        formaliza o banco de horas (validade de 45 dias, uso em qualquer unidade) e sai em A4, com timbre FaçaAmigos e
        os dados da unidade, em 2 vias para assinatura.
      </HelpText>

      <div style={{ display: "flex", gap: "10px", alignItems: "flex-end", flexWrap: "wrap" }}>
        <Select label="Unidade" value={unitId} onChange={(e) => setUnitId(e.target.value)} style={{ minWidth: "220px" }}>
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
        {customized ? (
          <Tag color="var(--color-teal)">Modelo personalizado desta unidade</Tag>
        ) : (
          <Tag color="var(--color-amber, #C99020)">Usando o modelo padrão</Tag>
        )}
      </div>

      <textarea
        value={template}
        onChange={(e) => setTemplate(e.target.value)}
        disabled={loading}
        spellCheck={false}
        style={{
          width: "100%",
          minHeight: "480px",
          boxSizing: "border-box",
          padding: "14px",
          borderRadius: "14px",
          border: "1px solid var(--border-subtle)",
          font: "13px/1.6 'Consolas', monospace",
          resize: "vertical",
          background: "var(--surface-card)",
          color: "inherit",
        }}
      />

      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        <Button variant="primary" onClick={save} loading={saving} disabled={saving || loading || !unitId} style={{ borderRadius: "9999px" }}>
          Salvar modelo desta unidade
        </Button>
        <Button variant="secondary" onClick={printSample} disabled={loading} title="Imprime o modelo com dados fictícios para conferência">
          🖨️ Imprimir amostra
        </Button>
        <Button
          variant="ghost"
          onClick={() => setTemplate(DEFAULT_CONTRACT_TEMPLATE)}
          disabled={loading}
          title="Substitui o texto do editor pelo modelo padrão (só é gravado ao salvar)"
        >
          Restaurar modelo padrão
        </Button>
      </div>

      <details style={{ border: "1px solid var(--border-subtle)", borderRadius: "14px", padding: "12px 16px" }}>
        <summary style={{ cursor: "pointer", fontWeight: "bold", fontSize: "14px" }}>
          Campos preenchidos automaticamente
        </summary>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "6px", marginTop: "10px", fontSize: "13px" }}>
          {CONTRACT_PLACEHOLDERS.map((p) => (
            <div key={p.key}>
              <code style={{ background: "var(--surface-sunken)", padding: "1px 6px", borderRadius: "6px" }}>{"{{" + p.key + "}}"}</code>{" "}
              <span style={{ color: "var(--text-muted)" }}>{p.label}</span>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
