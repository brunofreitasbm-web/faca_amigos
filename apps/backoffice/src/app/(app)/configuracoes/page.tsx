import { Card, Input } from "@/components/design-system";
import { createClient } from "@/lib/supabase/server";
import { upsertAppSetting, updateUnitSettings, updateUnitReceiptInfo } from "../actions";
import { DataTable } from "@/components/DataTable";
import { EntityForm } from "@/components/EntityForm";
import { LabeledSelect } from "@/components/LabeledSelect";
import { PageTitle } from "@/components/Typography";

const SETTING_LABEL: Record<string, string> = {
  daily_goal_cents: "Meta diária de faturamento (centavos)",
  terms_of_use: "Termos de uso exibidos no check-in",
  closing_time: "Horário de fechamento",
};

interface AppSetting {
  unit_id: string;
  key: string;
  value: string;
}

export default async function ConfiguracoesPage() {
  const supabase = await createClient();
  const [{ data: units }, { data: settings }] = await Promise.all([
    supabase
      .from("fa_kiosk_units")
      .select("id, name, timezone, business_day_cutoff_hour, address, phone, cnpj")
      .order("name"),
    supabase.from("fa_kiosk_app_settings").select("unit_id, key, value"),
  ]);

  return (
    <div>
      <PageTitle description="Personalização do sistema por unidade: fuso horário, horário de corte do dia e ajustes gerais como meta diária e termos de uso.">
        Configurações
      </PageTitle>

      {(units ?? []).map((u) => {
        const unitSettings = ((settings ?? []) as AppSetting[]).filter(
          (s) => s.unit_id === u.id,
        );
        return (
          <Card key={u.id} variant="light" title={u.name} style={{ marginBottom: "var(--space-5)" }}>
            <h3
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "13px",
                fontWeight: "var(--weight-semibold)" as unknown as number,
                color: "var(--text-secondary)",
              }}
            >
              Fuso horário e fechamento do dia
            </h3>
            <div style={{ marginBottom: "var(--space-4)" }}>
              <EntityForm action={updateUnitSettings} submitLabel="Salvar">
                <input type="hidden" name="unit_id" value={u.id} />
                <Input name="timezone" label="Fuso horário" defaultValue={u.timezone} />
                <Input
                  name="business_day_cutoff_hour"
                  type="number"
                  min={0}
                  max={23}
                  label="Hora de corte do dia"
                  title="Hora (0-23) em que o dia operacional vira o próximo — usada nos relatórios e no fechamento de caixa, não precisa ser meia-noite"
                  defaultValue={u.business_day_cutoff_hour}
                />
              </EntityForm>
            </div>

            <h3
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "13px",
                fontWeight: "var(--weight-semibold)" as unknown as number,
                color: "var(--text-secondary)",
              }}
            >
              Dados para o cupom não fiscal (timbre)
            </h3>
            <div style={{ marginBottom: "var(--space-4)" }}>
              <EntityForm action={updateUnitReceiptInfo} submitLabel="Salvar">
                <input type="hidden" name="unit_id" value={u.id} />
                <Input name="address" label="Endereço" defaultValue={u.address ?? ""} />
                <Input name="phone" label="Telefone" defaultValue={u.phone ?? ""} />
                <Input name="cnpj" label="CNPJ" defaultValue={u.cnpj ?? ""} />
              </EntityForm>
            </div>

            <h3
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "13px",
                fontWeight: "var(--weight-semibold)" as unknown as number,
                color: "var(--text-secondary)",
              }}
            >
              Ajustes gerais
            </h3>
            {unitSettings.length > 0 && (
              <div style={{ marginBottom: "var(--space-3)" }}>
                <DataTable<AppSetting>
                  columns={[
                    {
                      key: "label",
                      header: "Ajuste",
                      render: (s) => SETTING_LABEL[s.key] ?? s.key,
                    },
                    { key: "value", header: "Valor atual", render: (s) => s.value },
                  ]}
                  rows={unitSettings}
                  rowKey={(s) => s.key}
                />
              </div>
            )}
            <EntityForm action={upsertAppSetting} submitLabel="Salvar">
              <input type="hidden" name="unit_id" value={u.id} />
              <LabeledSelect label="Ajuste" name="key" required defaultValue="daily_goal_cents">
                {Object.entries(SETTING_LABEL).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </LabeledSelect>
              <Input name="value" label="Valor" required />
            </EntityForm>
          </Card>
        );
      })}
    </div>
  );
}
