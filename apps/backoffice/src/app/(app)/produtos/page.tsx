import { createClient } from "@/lib/supabase/server";
import { createProduct } from "../actions";

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
      <h1 style={{ marginTop: 0 }}>Produtos</h1>
      <table>
        <thead>
          <tr>
            <th>Nome</th>
            <th>Preço</th>
            <th>Estoque</th>
            <th>Unidade</th>
          </tr>
        </thead>
        <tbody>
          {(products ?? []).map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td>R$ {(p.price_cents / 100).toFixed(2)}</td>
              <td>{p.stock}</td>
              <td>{(p.fa_kiosk_units as unknown as { name: string } | null)?.name}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ fontSize: 15, marginTop: 32 }}>Novo produto</h2>
      <form action={createProduct} style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <select name="unit_id" required>
          {(units ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <input name="name" placeholder="Nome" required />
        <input name="price" type="number" step="0.01" placeholder="Preço (R$)" required />
        <input name="stock" type="number" placeholder="Estoque" />
        <button type="submit">Adicionar</button>
      </form>
    </div>
  );
}
