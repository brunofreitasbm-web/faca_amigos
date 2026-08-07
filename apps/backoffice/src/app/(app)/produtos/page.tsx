import { Input } from "@/components/design-system";
import { createClient } from "@/lib/supabase/server";
import { DataTable } from "@/components/DataTable";
import { EntityForm } from "@/components/EntityForm";
import { LabeledSelect } from "@/components/LabeledSelect";
import { PageTitle, SectionTitle } from "@/components/Typography";
import { createProduct } from "../actions";

interface Product {
  id: string;
  name: string;
  price_cents: number;
  stock: number;
  fa_kiosk_units: { name: string } | null;
}

export default async function ProdutosPage() {
  const supabase = await createClient();
  const [{ data: products }, { data: units }] = await Promise.all([
    supabase
      .from("fa_kiosk_products")
      .select("id, name, price_cents, stock, fa_kiosk_units(name)")
      .order("created_at", { ascending: false }),
    supabase.from("fa_kiosk_units").select("id, name"),
  ]);

  return (
    <div>
      <PageTitle description="Itens vendidos avulsos (loja/lanchonete) no PDV do balcão, com o estoque disponível de cada um.">Produtos</PageTitle>

      <DataTable<Product>
        columns={[
          { key: "name", header: "Nome", render: (p) => p.name },
          {
            key: "price",
            header: "Preço",
            render: (p) => `R$ ${(p.price_cents / 100).toFixed(2)}`,
          },
          { key: "stock", header: "Estoque", render: (p) => p.stock },
          { key: "unit", header: "Unidade", render: (p) => p.fa_kiosk_units?.name ?? "—" },
        ]}
        rows={(products ?? []) as unknown as Product[]}
        rowKey={(p) => p.id}
        emptyMessage="Nenhum produto cadastrado."
      />

      <SectionTitle>Novo produto</SectionTitle>
      <EntityForm action={createProduct} submitLabel="Adicionar">
        <LabeledSelect label="Unidade" name="unit_id" required>
          {(units ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </LabeledSelect>
        <Input name="name" label="Nome" required />
        <Input name="price" type="number" step="0.01" label="Preço (R$)" required />
        <Input name="stock" type="number" label="Estoque" />
      </EntityForm>
    </div>
  );
}
