import { createClient } from "@/lib/supabase/server";
import { createPlan } from "../actions";

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
      <h1 style={{ marginTop: 0 }}>Planos</h1>
      <table>
        <thead>
          <tr>
            <th>Nome</th>
            <th>Atividade</th>
            <th>Duração</th>
            <th>Valor</th>
            <th>Unidade</th>
          </tr>
        </thead>
        <tbody>
          {(plans ?? []).map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td>{p.activity}</td>
              <td>
                {p.duration_value} {p.duration_unit}
              </td>
              <td>R$ {(p.value_cents / 100).toFixed(2)}</td>
              <td>{(p.fa_kiosk_units as unknown as { name: string } | null)?.name}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ fontSize: 15, marginTop: 32 }}>Novo plano</h2>
      <form
        action={createPlan}
        style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}
      >
        <select name="unit_id" required>
          {(units ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <select name="activity" required defaultValue="PLAYGROUND">
          <option value="PLAYGROUND">Playground</option>
          <option value="CARRINHO">Carrinho</option>
        </select>
        <input name="name" placeholder="Nome" required />
        <input name="value" type="number" step="0.01" placeholder="Valor (R$)" required />
        <input name="duration_value" type="number" placeholder="Duração" required />
        <select name="duration_unit" required defaultValue="MINUTO">
          <option value="MINUTO">Minuto</option>
          <option value="HORA">Hora</option>
        </select>
        <input name="overage" type="number" step="0.01" placeholder="Excedente/min (R$)" />
        <button type="submit">Adicionar</button>
      </form>
    </div>
  );
}
