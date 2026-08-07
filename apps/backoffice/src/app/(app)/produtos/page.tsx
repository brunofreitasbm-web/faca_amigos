import { Badge, Card, Input } from "@/components/design-system";
import { createClient } from "@/lib/supabase/server";
import { DataTable } from "@/components/DataTable";
import { EntityForm } from "@/components/EntityForm";
import { LabeledSelect } from "@/components/LabeledSelect";
import { PageTitle, SectionTitle } from "@/components/Typography";
import { createProduct, updateProductFiscal } from "../actions";

interface Product {
  id: string;
  name: string;
  price_cents: number;
  stock: number;
  ncm: string | null;
  cfop: string | null;
  csosn: string | null;
  fiscal_ready: boolean | null;
  fa_kiosk_units: { name: string } | null;
}

interface ProductFiscal {
  id: string;
  name: string;
  ncm: string | null;
  cest: string | null;
  cfop: string | null;
  csosn: string | null;
  origem: number | null;
  unidade_comercial: string | null;
  gtin: string | null;
  pis_cst: string | null;
  cofins_cst: string | null;
  fiscal_ready: boolean | null;
}

export default async function ProdutosPage() {
  const supabase = await createClient();
  const [{ data: products }, { data: units }, { data: productsFiscal }] = await Promise.all([
    supabase
      .from("fa_kiosk_products")
      .select("id, name, price_cents, stock, ncm, cfop, csosn, fiscal_ready, fa_kiosk_units(name)")
      .order("created_at", { ascending: false }),
    supabase.from("fa_kiosk_units").select("id, name"),
    supabase
      .from("fa_kiosk_products")
      .select("id, name, ncm, cest, cfop, csosn, origem, unidade_comercial, gtin, pis_cst, cofins_cst, fiscal_ready")
      .order("name"),
  ]);

  return (
    <div>
      <PageTitle>Produtos</PageTitle>

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
          { key: "ncm", header: "NCM", render: (p) => p.ncm ?? "—" },
          { key: "cfop", header: "CFOP", render: (p) => p.cfop ?? "—" },
          { key: "csosn", header: "CSOSN", render: (p) => p.csosn ?? "—" },
          {
            key: "fiscal",
            header: "Fiscal",
            render: (p) =>
              p.fiscal_ready ? (
                <Badge variant="green">pronto para NFC-e</Badge>
              ) : (
                <Badge variant="amber">faltam dados fiscais</Badge>
              ),
          },
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

      <SectionTitle>Tributação para NFC-e</SectionTitle>
      <p
        style={{
          fontFamily: "var(--font-body)",
          fontSize: "14px",
          color: "var(--text-muted)",
          marginTop: "-8px",
          marginBottom: "var(--space-4)",
        }}
      >
        NCM, CFOP e CSOSN vêm do contador (checklist da Fase 0 do plano fiscal) — sem eles a SEFAZ
        rejeita a nota, e o produto fica marcado &quot;faltam dados fiscais&quot; acima.
      </p>

      {((productsFiscal as ProductFiscal[] | null) ?? []).map((p) => (
        <Card
          key={p.id}
          variant="light"
          title={`${p.name}${p.fiscal_ready ? " ✓" : ""}`}
          style={{ marginBottom: "var(--space-4)" }}
        >
          <EntityForm action={updateProductFiscal} submitLabel="Salvar tributação">
            <input type="hidden" name="product_id" value={p.id} />
            <Input name="ncm" label="NCM (8 dígitos)" defaultValue={p.ncm ?? ""} />
            <Input name="cest" label="CEST (se houver ST)" defaultValue={p.cest ?? ""} />
            <Input name="cfop" label="CFOP" defaultValue={p.cfop ?? "5102"} />
            <Input name="csosn" label="CSOSN" defaultValue={p.csosn ?? "102"} />
            <LabeledSelect label="Origem da mercadoria" name="origem" defaultValue={String(p.origem ?? 0)}>
              <option value="0">0 — Nacional</option>
              <option value="1">1 — Estrangeira, importação direta</option>
              <option value="2">2 — Estrangeira, adquirida no mercado interno</option>
            </LabeledSelect>
            <Input name="unidade_comercial" label="Unidade comercial" defaultValue={p.unidade_comercial ?? "UN"} />
            <Input name="gtin" label="GTIN/código de barras" defaultValue={p.gtin ?? "SEM GTIN"} />
            <Input name="pis_cst" label="CST do PIS" defaultValue={p.pis_cst ?? "49"} />
            <Input name="cofins_cst" label="CST da COFINS" defaultValue={p.cofins_cst ?? "49"} />
          </EntityForm>
        </Card>
      ))}
    </div>
  );
}
