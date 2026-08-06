import { Badge, DateInput, Input } from "@/components/design-system";
import { createClient } from "@/lib/supabase/server";
import { createEmployee } from "../actions";
import { DataTable } from "@/components/DataTable";
import { EntityForm } from "@/components/EntityForm";
import { LabeledSelect } from "@/components/LabeledSelect";
import { PageTitle, SectionTitle } from "@/components/Typography";

interface Employee {
  id: string;
  full_name: string;
  role: string;
  active: boolean;
  cpf: string | null;
  email: string | null;
  birth_date: string | null;
  phone: string | null;
  fa_kiosk_units: { name: string } | null;
}

export default async function FuncionariosPage() {
  const supabase = await createClient();
  const [{ data: employees }, { data: units }] = await Promise.all([
    supabase
      .from("fa_kiosk_employees")
      .select("id, full_name, role, active, cpf, email, birth_date, phone, fa_kiosk_units(name)")
      .order("created_at", { ascending: false }),
    supabase.from("fa_kiosk_units").select("id, name"),
  ]);

  return (
    <div>
      <PageTitle>Funcionários</PageTitle>

      <DataTable<Employee>
        columns={[
          { key: "name", header: "Nome", render: (e) => e.full_name },
          {
            key: "cpf",
            header: "CPF",
            render: (e) => e.cpf ?? <span style={{ color: "var(--text-muted)" }}>—</span>,
          },
          {
            key: "email",
            header: "E-mail",
            render: (e) => e.email ?? <span style={{ color: "var(--text-muted)" }}>—</span>,
          },
          {
            key: "birth_date",
            header: "Nascimento",
            render: (e) =>
              e.birth_date ? (
                new Date(e.birth_date).toLocaleDateString("pt-BR")
              ) : (
                <span style={{ color: "var(--text-muted)" }}>—</span>
              ),
          },
          {
            key: "phone",
            header: "Telefone",
            render: (e) => e.phone ?? <span style={{ color: "var(--text-muted)" }}>—</span>,
          },
          { key: "unit", header: "Unidade", render: (e) => e.fa_kiosk_units?.name ?? "—" },
          { key: "role", header: "Função", render: (e) => e.role },
          {
            key: "status",
            header: "Status",
            render: (e) => (
              <Badge variant={e.active ? "green" : "neutral"}>
                {e.active ? "Ativo" : "Inativo"}
              </Badge>
            ),
          },
        ]}
        rows={(employees ?? []) as unknown as Employee[]}
        rowKey={(e) => e.id}
        emptyMessage="Nenhum funcionário cadastrado."
      />

      <SectionTitle>Novo funcionário</SectionTitle>
      <EntityForm action={createEmployee} submitLabel="Adicionar">
        <Input name="full_name" label="Nome completo" required />
        <Input name="cpf" label="CPF" />
        <Input name="email" type="email" label="E-mail" />
        <DateInput name="birth_date" label="Nascimento" />
        <Input name="phone" label="Telefone" />
        <LabeledSelect label="Unidade" name="unit_id" required>
          {(units ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </LabeledSelect>
        <LabeledSelect label="Função" name="role" required defaultValue="OPERADOR">
          <option value="OPERADOR">Operador</option>
          <option value="GERENTE">Gerente</option>
          <option value="ADMIN">Admin</option>
        </LabeledSelect>
      </EntityForm>
    </div>
  );
}
