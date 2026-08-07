import { Badge, Input } from "@/components/design-system";
import { createClient } from "@/lib/supabase/server";
import { createCoupon } from "../actions";
import { DataTable } from "@/components/DataTable";
import { EntityForm } from "@/components/EntityForm";
import { LabeledSelect } from "@/components/LabeledSelect";
import { PageTitle, SectionTitle } from "@/components/Typography";

const KIND_LABEL: Record<string, string> = {
  MINUTOS_EXTRA: "Minutos extra",
  DESCONTO_PCT: "Desconto (%)",
  DESCONTO_VALOR: "Desconto (R$)",
};

interface Coupon {
  id: string;
  code: string;
  kind: string;
  value: number;
  partner_name: string | null;
  max_uses: number | null;
  used_count: number;
  active: boolean;
  fa_kiosk_units: { name: string } | null;
}

export default async function CuponsPage() {
  const supabase = await createClient();
  const [{ data: coupons }, { data: units }] = await Promise.all([
    supabase
      .from("fa_kiosk_coupons")
      .select(
        "id, code, kind, value, partner_name, max_uses, used_count, active, description, fa_kiosk_units(name)",
      )
      .order("created_at_ms", { ascending: false }),
    supabase.from("fa_kiosk_units").select("id, name"),
  ]);

  return (
    <div>
      <PageTitle description="Códigos de desconto ou parceria que o operador pode aplicar na tela de Entrada do balcão.">Cupons</PageTitle>

      <DataTable<Coupon>
        columns={[
          { key: "code", header: "Código", render: (c) => c.code },
          { key: "kind", header: "Tipo", render: (c) => KIND_LABEL[c.kind] ?? c.kind },
          { key: "value", header: "Valor", render: (c) => c.value },
          { key: "partner", header: "Parceiro", render: (c) => c.partner_name ?? "—" },
          {
            key: "uses",
            header: "Usos",
            render: (c) => `${c.used_count}${c.max_uses ? ` / ${c.max_uses}` : ""}`,
          },
          { key: "unit", header: "Unidade", render: (c) => c.fa_kiosk_units?.name ?? "—" },
          {
            key: "status",
            header: "Status",
            render: (c) => (
              <Badge variant={c.active ? "green" : "neutral"}>
                {c.active ? "Ativo" : "Inativo"}
              </Badge>
            ),
          },
        ]}
        rows={(coupons ?? []) as unknown as Coupon[]}
        rowKey={(c) => c.id}
        emptyMessage="Nenhum cupom cadastrado."
      />

      <SectionTitle>Novo cupom</SectionTitle>
      <EntityForm action={createCoupon} submitLabel="Adicionar">
        <LabeledSelect label="Unidade" name="unit_id" required>
          {(units ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </LabeledSelect>
        <Input name="code" label="Código" required style={{ textTransform: "uppercase" }} />
        <LabeledSelect label="Tipo" name="kind" required defaultValue="DESCONTO_PCT">
          <option value="DESCONTO_PCT">Desconto (%)</option>
          <option value="DESCONTO_VALOR">Desconto (R$)</option>
          <option value="MINUTOS_EXTRA">Minutos extra</option>
        </LabeledSelect>
        <Input name="value" type="number" label="Valor" required />
        <Input name="partner_name" label="Parceiro (clínica, escola...)" />
        <Input
          name="max_uses"
          type="number"
          label="Máx. usos (0 = ilimitado)"
          title="Quantas vezes este cupom pode ser usado no total, somando todas as unidades"
        />
        <Input name="description" label="Descrição" />
      </EntityForm>
    </div>
  );
}
