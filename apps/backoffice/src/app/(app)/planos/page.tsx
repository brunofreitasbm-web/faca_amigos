import { Input } from "@/components/design-system";
import { createClient } from "@/lib/supabase/server";
import { DataTable } from "@/components/DataTable";
import { EntityForm } from "@/components/EntityForm";
import { LabeledSelect } from "@/components/LabeledSelect";
import { PageTitle, SectionTitle } from "@/components/Typography";
import { createPlan } from "../actions";

interface Plan {
  id: string;
  name: string;
  activity: string;
  value_cents: number;
  duration_value: number;
  duration_unit: string;
  fa_kiosk_units: { name: string } | null;
}

export default async function PlanosPage() {
  const supabase = await createClient();
  const [{ data: plans }, { data: units }] = await Promise.all([
    supabase
      .from("fa_kiosk_plans")
      .select("id, name, activity, value_cents, duration_value, duration_unit, fa_kiosk_units(name)")
      .order("created_at", { ascending: false }),
    supabase.from("fa_kiosk_units").select("id, name"),
  ]);

  return (
    <div>
      <PageTitle description="Planos de permanência vendidos na tela de Entrada do balcão — preço, duração e o que cobrar se a criança passar do tempo.">Planos</PageTitle>

      <DataTable<Plan>
        columns={[
          { key: "name", header: "Nome", render: (p) => p.name },
          { key: "activity", header: "Atividade", render: (p) => p.activity },
          {
            key: "duration",
            header: "Duração",
            render: (p) => `${p.duration_value} ${p.duration_unit}`,
          },
          {
            key: "value",
            header: "Valor",
            render: (p) => `R$ ${(p.value_cents / 100).toFixed(2)}`,
          },
          { key: "unit", header: "Unidade", render: (p) => p.fa_kiosk_units?.name ?? "—" },
        ]}
        rows={(plans ?? []) as unknown as Plan[]}
        rowKey={(p) => p.id}
        emptyMessage="Nenhum plano cadastrado."
      />

      <SectionTitle>Novo plano</SectionTitle>
      <EntityForm action={createPlan} submitLabel="Adicionar">
        <LabeledSelect label="Unidade" name="unit_id" required>
          {(units ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </LabeledSelect>
        <LabeledSelect label="Atividade" name="activity" required defaultValue="PLAYGROUND">
          <option value="PLAYGROUND">Playground</option>
          <option value="CARRINHO">Carrinho</option>
        </LabeledSelect>
        <Input name="name" label="Nome" required />
        <Input name="value" type="number" step="0.01" label="Valor (R$)" required />
        <Input name="duration_value" type="number" label="Duração" required />
        <LabeledSelect label="Unidade de tempo" name="duration_unit" required defaultValue="MINUTO">
          <option value="MINUTO">Minuto</option>
          <option value="HORA">Hora</option>
        </LabeledSelect>
        <Input
          name="overage"
          type="number"
          step="0.01"
          label="Excedente/min (R$)"
          title="Valor cobrado por minuto quando a criança ficar além da duração do plano"
        />
      </EntityForm>
    </div>
  );
}
