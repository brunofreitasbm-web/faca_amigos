import { createClient } from "@/lib/supabase/server";
import { createEmployee } from "../actions";

export default async function FuncionariosPage() {
  const supabase = await createClient();
  const { data: employees } = await supabase
    .from("fa_kiosk_employees")
    .select("id, full_name, role, active")
    .order("created_at", { ascending: false });

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Funcionários</h1>
      <table>
        <thead>
          <tr>
            <th>Nome</th>
            <th>Função</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {(employees ?? []).map((e) => (
            <tr key={e.id}>
              <td>{e.full_name}</td>
              <td>{e.role}</td>
              <td>{e.active ? "Ativo" : "Inativo"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ fontSize: 15, marginTop: 32 }}>Novo funcionário</h2>
      <form action={createEmployee} style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <input name="full_name" placeholder="Nome completo" required />
        <select name="role" required defaultValue="OPERADOR">
          <option value="OPERADOR">Operador</option>
          <option value="GERENTE">Gerente</option>
          <option value="ADMIN">Admin</option>
        </select>
        <button type="submit">Adicionar</button>
      </form>
    </div>
  );
}
