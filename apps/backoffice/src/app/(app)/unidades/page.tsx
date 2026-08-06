import { createClient } from "@/lib/supabase/server";
import { createUnit } from "../actions";

export default async function UnidadesPage() {
  const supabase = await createClient();
  const { data: units } = await supabase
    .from("fa_kiosk_units")
    .select("id, name, kind, timezone")
    .order("created_at", { ascending: false });

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Unidades</h1>
      <table>
        <thead>
          <tr>
            <th>Nome</th>
            <th>Tipo</th>
            <th>Fuso</th>
          </tr>
        </thead>
        <tbody>
          {(units ?? []).map((u) => (
            <tr key={u.id}>
              <td>{u.name}</td>
              <td>{u.kind}</td>
              <td>{u.timezone}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ fontSize: 15, marginTop: 32 }}>Nova unidade</h2>
      <form action={createUnit} style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <input name="name" placeholder="Nome" required />
        <select name="kind" required defaultValue="LOJA">
          <option value="LOJA">Loja</option>
          <option value="QUIOSQUE">Quiosque</option>
        </select>
        <button type="submit">Adicionar</button>
      </form>
    </div>
  );
}
