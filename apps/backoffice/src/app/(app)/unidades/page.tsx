import { Card, Input } from "@/components/design-system";
import { createClient } from "@/lib/supabase/server";
import { DataTable } from "@/components/DataTable";
import { EntityForm } from "@/components/EntityForm";
import { LabeledSelect } from "@/components/LabeledSelect";
import { PageTitle, SectionTitle } from "@/components/Typography";
import { createUnit, updateUnitFiscal } from "../actions";

interface Unit {
  id: string;
  name: string;
  kind: string;
  timezone: string;
}

interface UnitFiscal {
  id: string;
  name: string;
  cnpj: string | null;
  razao_social: string | null;
  nome_fantasia: string | null;
  inscricao_estadual: string | null;
  cnae_principal: string | null;
  crt: number | null;
  end_logradouro: string | null;
  end_numero: string | null;
  end_complemento: string | null;
  end_bairro: string | null;
  end_municipio_ibge: string | null;
  end_uf: string | null;
  end_cep: string | null;
  fone: string | null;
  fiscal_ambiente: string | null;
  fiscal_enabled: boolean | null;
  nfce_serie: number | null;
  nfce_csc_id: string | null;
  nfce_qrcode_url_consulta: string | null;
}

export default async function UnidadesPage() {
  const supabase = await createClient();
  const [{ data: units }, { data: unitsFiscal }] = await Promise.all([
    supabase.from("fa_kiosk_units").select("id, name, kind, timezone").order("created_at", { ascending: false }),
    supabase
      .from("fa_kiosk_units")
      .select(
        "id, name, cnpj, razao_social, nome_fantasia, inscricao_estadual, cnae_principal, crt, " +
          "end_logradouro, end_numero, end_complemento, end_bairro, end_municipio_ibge, end_uf, end_cep, fone, " +
          "fiscal_ambiente, fiscal_enabled, nfce_serie, nfce_csc_id, nfce_qrcode_url_consulta",
      )
      .order("name"),
  ]);

  return (
    <div>
      <PageTitle description="Cadastro das unidades (lojas e quiosques) — cada uma aparece como um módulo separado no sistema do balcão.">Unidades</PageTitle>

      <DataTable<Unit>
        columns={[
          { key: "name", header: "Nome", render: (u) => u.name },
          { key: "kind", header: "Tipo", render: (u) => u.kind },
          { key: "timezone", header: "Fuso", render: (u) => u.timezone },
        ]}
        rows={units ?? []}
        rowKey={(u) => u.id}
        emptyMessage="Nenhuma unidade cadastrada."
      />

      <SectionTitle>Nova unidade</SectionTitle>
      <EntityForm action={createUnit} submitLabel="Adicionar">
        <Input name="name" label="Nome" required />
        <LabeledSelect label="Tipo" name="kind" required defaultValue="LOJA">
          <option value="LOJA">Loja</option>
          <option value="QUIOSQUE">Quiosque</option>
        </LabeledSelect>
      </EntityForm>

      <SectionTitle>Dados fiscais (emissão de NFC-e)</SectionTitle>
      <p
        style={{
          fontFamily: "var(--font-body)",
          fontSize: "14px",
          color: "var(--text-muted)",
          marginTop: "-8px",
          marginBottom: "var(--space-4)",
        }}
      >
        Confirme estes dados com o contador antes de ligar a emissão (Fase 0 do plano fiscal). O
        certificado digital e o token do CSC ficam só no PC do balcão — nunca aqui.
      </p>

      {(unitsFiscal as UnitFiscal[] | null ?? []).map((u) => (
        <Card key={u.id} variant="light" title={u.name} style={{ marginBottom: "var(--space-5)" }}>
          <EntityForm action={updateUnitFiscal} submitLabel="Salvar dados fiscais">
            <input type="hidden" name="unit_id" value={u.id} />

            <Input name="cnpj" label="CNPJ (só números)" defaultValue={u.cnpj ?? ""} />
            <Input name="razao_social" label="Razão social" defaultValue={u.razao_social ?? ""} />
            <Input name="nome_fantasia" label="Nome fantasia" defaultValue={u.nome_fantasia ?? ""} />
            <Input name="inscricao_estadual" label="Inscrição Estadual" defaultValue={u.inscricao_estadual ?? ""} />
            <Input name="cnae_principal" label="CNAE principal" defaultValue={u.cnae_principal ?? ""} />
            <LabeledSelect label="Regime tributário (CRT)" name="crt" defaultValue={String(u.crt ?? 1)}>
              <option value="1">1 — Simples Nacional</option>
              <option value="2">2 — Simples Nacional, excesso de sublimite</option>
              <option value="3">3 — Regime normal</option>
            </LabeledSelect>

            <Input name="end_logradouro" label="Logradouro" defaultValue={u.end_logradouro ?? ""} />
            <Input name="end_numero" label="Número" defaultValue={u.end_numero ?? ""} />
            <Input name="end_complemento" label="Complemento" defaultValue={u.end_complemento ?? ""} />
            <Input name="end_bairro" label="Bairro" defaultValue={u.end_bairro ?? ""} />
            <Input name="end_cep" label="CEP (só números)" defaultValue={u.end_cep ?? ""} />
            <Input
              name="end_municipio_ibge"
              label="Código IBGE do município"
              defaultValue={u.end_municipio_ibge ?? "1501402"}
            />
            <Input name="end_uf" label="UF" maxLength={2} defaultValue={u.end_uf ?? "PA"} />
            <Input name="fone" label="Telefone (só números)" defaultValue={u.fone ?? ""} />

            <LabeledSelect
              label="Ambiente da NFC-e"
              name="fiscal_ambiente"
              defaultValue={u.fiscal_ambiente ?? "HOMOLOGACAO"}
            >
              <option value="HOMOLOGACAO">Homologação (testes, sem valor fiscal)</option>
              <option value="PRODUCAO">Produção</option>
            </LabeledSelect>
            <LabeledSelect
              label="Emissão de NFC-e"
              name="fiscal_enabled"
              defaultValue={u.fiscal_enabled ? "true" : "false"}
            >
              <option value="false">Desligada (recomendado até homologar por uma semana)</option>
              <option value="true">Ligada — passa a emitir nota em toda venda de produto</option>
            </LabeledSelect>
            <Input name="nfce_serie" type="number" min={1} label="Série da NFC-e" defaultValue={u.nfce_serie ?? 1} />
            <Input
              name="nfce_csc_id"
              label="Identificador do CSC (ex. 000001)"
              defaultValue={u.nfce_csc_id ?? ""}
            />
            <Input
              name="nfce_qrcode_url_consulta"
              label="URL de consulta do QR Code (SEFA-PA)"
              defaultValue={u.nfce_qrcode_url_consulta ?? ""}
            />
          </EntityForm>
        </Card>
      ))}
    </div>
  );
}
