import { Input } from "@/components/design-system";
import { createClient } from "@/lib/supabase/server";
import { DataTable } from "@/components/DataTable";
import { EntityForm } from "@/components/EntityForm";
import { LabeledSelect } from "@/components/LabeledSelect";
import { PageTitle, SectionTitle } from "@/components/Typography";
import { createUnit } from "../actions";

interface Unit {
  id: string;
  name: string;
  kind: string;
  timezone: string;
}

export default async function UnidadesPage() {
  const supabase = await createClient();
  const { data: units } = await supabase
    .from("fa_kiosk_units")
    .select("id, name, kind, timezone")
    .order("created_at", { ascending: false });

  return (
    <div>
      <PageTitle>Unidades</PageTitle>

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
    </div>
  );
}
