import { createClient } from "@/lib/supabase/server";
import { PageTitle, SectionTitle } from "@/components/Typography";
import { LabeledSelect } from "@/components/LabeledSelect";
import { Button } from "@/components/design-system";
import { computeWorkedMinutes, monthRangeMs, type PontoKind } from "@/lib/ponto";
import { FolhaPagamentoTable, type FolhaPagamentoEmployee } from "./FolhaPagamentoTable";
import { PayrollHistory } from "./PayrollHistory";

const MONTH_LABEL = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

interface PageProps {
  searchParams: Promise<{ unitId?: string; year?: string; month?: string }>;
}

export default async function FolhaPagamentoPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const supabase = await createClient();

  const now = new Date();
  const year = Number(params.year) || now.getFullYear();
  const month = Number(params.month) || now.getMonth() + 1;

  const { data: units } = await supabase.from("fa_kiosk_units").select("id, name").order("name");
  const unitId = params.unitId || units?.[0]?.id;

  const yearOptions = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);

  if (!unitId) {
    return (
      <div>
        <PageTitle>Folha de Pagamento</PageTitle>
        <p style={{ color: "var(--text-muted)" }}>Cadastre uma unidade em "Unidades" antes de gerar a folha de pagamento.</p>
      </div>
    );
  }

  const { fromMs, toMs } = monthRangeMs(year, month);

  const [{ data: employees }, { data: payrollInfos }, { data: pontoRecords }, { data: runs }] = await Promise.all([
    supabase
      .from("fa_kiosk_employees")
      .select("id, full_name, cpf, position, weekly_hours_contracted")
      .eq("unit_id", unitId)
      .eq("active", true)
      .order("full_name"),
    supabase.from("fa_kiosk_employee_payroll_info").select("*"),
    supabase
      .from("fa_kiosk_ponto_records")
      .select("employee_id, kind, at_ms")
      .eq("unit_id", unitId)
      .gte("at_ms", fromMs)
      .lt("at_ms", toMs),
    supabase
      .from("fa_kiosk_payroll_runs")
      .select("id, year, month, total_cents, created_at_ms, fa_kiosk_payroll_items(*)")
      .eq("unit_id", unitId)
      .order("year", { ascending: false })
      .order("month", { ascending: false }),
  ]);

  const payrollInfoByEmployee = new Map((payrollInfos ?? []).map((p) => [p.employee_id as string, p]));

  const pontoByEmployee = new Map<string, { kind: PontoKind; at_ms: number }[]>();
  for (const record of pontoRecords ?? []) {
    const list = pontoByEmployee.get(record.employee_id) ?? [];
    list.push({ kind: record.kind as PontoKind, at_ms: record.at_ms });
    pontoByEmployee.set(record.employee_id, list);
  }

  const currentRun = (runs ?? []).find((r) => r.year === year && r.month === month) ?? null;

  const folhaEmployees: FolhaPagamentoEmployee[] = (employees ?? []).map((e) => {
    const info = payrollInfoByEmployee.get(e.id);
    const worked = computeWorkedMinutes(pontoByEmployee.get(e.id) ?? []);
    return {
      id: e.id,
      fullName: e.full_name,
      cpf: e.cpf,
      position: e.position,
      weeklyHoursContracted: e.weekly_hours_contracted,
      workedMinutes: worked.minutes,
      workedIncomplete: worked.incomplete,
      salaryBaseCents: info?.salary_base_cents ?? null,
      bankCode: info?.bank_code ?? null,
      bankAgencia: info?.bank_agencia ?? null,
      bankAgenciaDv: info?.bank_agencia_dv ?? null,
      bankConta: info?.bank_conta ?? null,
      bankContaDv: info?.bank_conta_dv ?? null,
      bankAccountType: info?.bank_account_type ?? null,
      pixKey: info?.pix_key ?? null,
    };
  });

  return (
    <div>
      <PageTitle description="Extrato mensal de salário e dados bancários dos colaboradores, a partir da folha de ponto — feche o mês e baixe a planilha para pagamento.">
        Folha de Pagamento
      </PageTitle>

      <form
        method="GET"
        style={{ display: "flex", gap: "var(--gap-sm)", alignItems: "flex-end", flexWrap: "wrap", marginBottom: "var(--space-5)" }}
      >
        <LabeledSelect label="Unidade" name="unitId" defaultValue={unitId}>
          {(units ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </LabeledSelect>
        <LabeledSelect label="Mês" name="month" defaultValue={String(month)}>
          {MONTH_LABEL.map((label, i) => (
            <option key={label} value={i + 1}>
              {label}
            </option>
          ))}
        </LabeledSelect>
        <LabeledSelect label="Ano" name="year" defaultValue={String(year)}>
          {yearOptions.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </LabeledSelect>
        <Button type="submit" variant="teal" size="sm">
          Aplicar
        </Button>
      </form>

      <FolhaPagamentoTable
        unitId={unitId}
        year={year}
        month={month}
        employees={folhaEmployees}
        closedRun={
          currentRun
            ? { id: currentRun.id, totalCents: currentRun.total_cents, createdAtMs: currentRun.created_at_ms, items: currentRun.fa_kiosk_payroll_items }
            : null
        }
      />

      <SectionTitle>Folhas fechadas</SectionTitle>
      <PayrollHistory runs={(runs ?? []).map((r) => ({
        id: r.id,
        year: r.year,
        month: r.month,
        monthLabel: MONTH_LABEL[r.month - 1] ?? String(r.month),
        totalCents: r.total_cents,
        createdAtMs: r.created_at_ms,
        items: r.fa_kiosk_payroll_items,
      }))} />
    </div>
  );
}
