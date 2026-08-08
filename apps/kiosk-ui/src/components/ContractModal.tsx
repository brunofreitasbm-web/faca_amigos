import { useEffect, useState } from "react";
import { Button, Input, Modal, HelpText, Tag } from "@facaamigos/ui";
import { formatCpf, formatPhoneBr } from "@facaamigos/domain";
import { Api } from "../api/client.js";
import { useAppState } from "../state/AppState.js";
import { useToast } from "../state/ToastContext.js";
import { money } from "../format.js";
import {
  DEFAULT_CONTRACT_TEMPLATE,
  buildContractHtml,
  fillContractTemplate,
  formatPlanoHoras,
  printContract,
} from "../contract/contractTemplate.js";

/**
 * Contrato dos planos acima de 2h (banco de horas).
 *
 * Aparece depois do check-in confirmado: o operador completa os dados
 * pessoais do Responsável Contratante (RG e endereço — o resto já veio do
 * cadastro), o sistema salva no cadastro do responsável (não pede de novo
 * na próxima vez) e imprime o contrato em A4, com timbre FaçaAmigos da
 * unidade, em duas vias para assinatura.
 *
 * O texto vem do modelo editável no Gerencial > Contrato
 * ('hour_bank_contract_template'); sem personalização, vale a minuta
 * padrão de src/contract/contractTemplate.ts.
 */
export function ContractModal({
  guardianId,
  childName,
  plan,
  onClose,
}: {
  guardianId: string;
  childName: string;
  plan: { name: string; valueCents: number; minutes: number };
  onClose: () => void;
}) {
  const { unit } = useAppState();
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [cpf, setCpf] = useState("");
  const [phone, setPhone] = useState("");
  const [rg, setRg] = useState("");
  const [email, setEmail] = useState("");
  const [addressLine, setAddressLine] = useState("");
  const [addressCity, setAddressCity] = useState("");
  const [addressState, setAddressState] = useState("");
  const [addressZip, setAddressZip] = useState("");

  useEffect(() => {
    Api.guardianContractInfo(guardianId)
      .then((g) => {
        setFullName(g.fullName ?? "");
        setCpf(g.cpf ? formatCpf(g.cpf) : "");
        setPhone(g.phone ? formatPhoneBr(g.phone) : "");
        setRg(g.rg ?? "");
        setEmail(g.email ?? "");
        setAddressLine(g.addressLine ?? "");
        setAddressCity(g.addressCity ?? "");
        setAddressState(g.addressState ?? "");
        setAddressZip(g.addressZip ?? "");
      })
      .catch(() => setError("Não foi possível carregar o cadastro do responsável."))
      .finally(() => setLoading(false));
  }, [guardianId]);

  const missing = !rg.trim()
    ? "Informe o RG do Contratante"
    : !addressLine.trim()
      ? "Informe o endereço do Contratante"
      : !addressCity.trim()
        ? "Informe a cidade"
        : !addressState.trim()
          ? "Informe a UF"
          : null;

  async function saveAndPrint() {
    if (!unit || missing) return;
    setBusy(true);
    setError(null);
    try {
      // Salva no cadastro primeiro: na próxima contratação os dados já
      // vêm preenchidos, e o contrato impresso é fiel ao que ficou salvo.
      await Api.updateGuardianContractInfo({
        guardianId,
        rg: rg.trim(),
        email: email.trim() || undefined,
        addressLine: addressLine.trim(),
        addressCity: addressCity.trim(),
        addressState: addressState.trim().toUpperCase(),
        addressZip: addressZip.trim() || undefined,
      });

      const [templateRes, validityRes] = await Promise.all([
        Api.unitSetting(unit.id, "hour_bank_contract_template").catch(() => ({ value: null as string | null })),
        Api.unitSetting(unit.id, "hour_bank_validity_days").catch(() => ({ value: null as string | null })),
      ]);
      const template = templateRes.value || DEFAULT_CONTRACT_TEMPLATE;
      const validityDays = validityRes.value || "45";

      const endereco = [
        addressLine.trim(),
        [addressCity.trim(), addressState.trim().toUpperCase()].filter(Boolean).join("/"),
        addressZip.trim() ? `CEP ${addressZip.trim()}` : "",
      ]
        .filter(Boolean)
        .join(", ");

      const data = {
        unitName: unit.name,
        unitCnpj: unit.cnpj ?? "",
        unitAddress: unit.address ?? "",
        unitPhone: unit.phone ?? "",
        contratanteNome: fullName,
        contratanteCpf: cpf,
        contratanteRg: rg.trim(),
        contratanteEndereco: endereco,
        contratanteTelefone: phone,
        contratanteEmail: email.trim() || "—",
        criancaNome: childName,
        planoNome: plan.name,
        planoHoras: formatPlanoHoras(plan.minutes),
        planoValor: money(plan.valueCents).replace("R$", "").trim(),
        validadeBancoDias: validityDays,
        cidadeUf: [addressCity.trim(), addressState.trim().toUpperCase()].filter(Boolean).join("/") || unit.name,
      };

      printContract(buildContractHtml(fillContractTemplate(template, data), data));
      toast.success("Contrato enviado para impressão em 2 vias (A4).");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível gerar o contrato.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="📄 Contrato — plano acima de 2h" onClose={onClose} closeOnBackdrop={false} maxWidth="480px">
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        <HelpText>
          Complete os dados pessoais do <strong>Responsável Contratante</strong> para imprimir o contrato de prestação
          de serviços do plano <strong>{plan.name}</strong> ({formatPlanoHoras(plan.minutes)} —{" "}
          {money(plan.valueCents)}), com o banco de horas garantido em contrato. Os dados ficam salvos para as próximas
          visitas.
        </HelpText>

        {loading ? (
          <Tag color="var(--color-teal)">Carregando cadastro…</Tag>
        ) : (
          <>
            <div style={{ padding: "10px 12px", border: "1px solid var(--border-subtle)", borderRadius: "12px", fontSize: "13px" }}>
              <strong>{fullName}</strong>
              <br />
              <span style={{ color: "var(--text-muted)" }}>
                {cpf ? `CPF ${cpf}` : "CPF não informado"}
                {phone ? ` · ${phone}` : ""}
              </span>
            </div>

            <Input label="RG" placeholder="Número do RG e órgão emissor" value={rg} onChange={(e) => setRg(e.target.value)} />
            <Input
              label="Endereço (rua, número, bairro)"
              placeholder="Ex.: Av. Júlio César, 100, Val-de-Cans"
              value={addressLine}
              onChange={(e) => setAddressLine(e.target.value)}
            />
            <div style={{ display: "flex", gap: "8px" }}>
              <Input label="Cidade" value={addressCity} onChange={(e) => setAddressCity(e.target.value)} style={{ flex: 2 }} />
              <Input label="UF" maxLength={2} value={addressState} onChange={(e) => setAddressState(e.target.value.toUpperCase())} style={{ flex: 1 }} />
              <Input label="CEP (opcional)" inputMode="numeric" value={addressZip} onChange={(e) => setAddressZip(e.target.value)} style={{ flex: 2 }} />
            </div>
            <Input label="E-mail (opcional)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />

            {error && <p style={{ color: "var(--color-error-text)", margin: 0, fontWeight: "bold" }}>{error}</p>}

            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "6px" }}>
              <Button variant="ghost" onClick={onClose} disabled={busy}>
                Agora não
              </Button>
              <Button
                variant="primary"
                onClick={saveAndPrint}
                loading={busy}
                disabled={busy || Boolean(missing)}
                title={missing ?? "Salvar os dados e imprimir o contrato em A4 para assinatura"}
                style={{ borderRadius: "9999px" }}
              >
                🖨️ Salvar e imprimir contrato
              </Button>
            </div>
            {missing && <span style={{ fontSize: "12px", color: "var(--text-muted)", textAlign: "right" }}>{missing}</span>}
          </>
        )}
      </div>
    </Modal>
  );
}
