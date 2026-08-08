"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { runAction, type ActionResult } from "@/lib/action-result";

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function createUnit(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const result = await runAction(
    () =>
      supabase.from("fa_kiosk_units").insert({
        name: String(formData.get("name")),
        kind: String(formData.get("kind")),
      }),
    "Unidade criada com sucesso.",
  );
  if (result.ok) revalidatePath("/unidades");
  return result;
}

export async function createPlan(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const result = await runAction(
    () =>
      supabase.from("fa_kiosk_plans").insert({
        unit_id: String(formData.get("unit_id")),
        activity: String(formData.get("activity")),
        name: String(formData.get("name")),
        value_cents: Math.round(Number(formData.get("value")) * 100),
        duration_value: Number(formData.get("duration_value")),
        duration_unit: String(formData.get("duration_unit")),
        overage_cents_per_minute: Math.round(Number(formData.get("overage") || 0) * 100),
      }),
    "Plano criado com sucesso.",
  );
  if (result.ok) revalidatePath("/planos");
  return result;
}

export async function createProduct(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const result = await runAction(
    () =>
      supabase.from("fa_kiosk_products").insert({
        unit_id: String(formData.get("unit_id")),
        name: String(formData.get("name")),
        price_cents: Math.round(Number(formData.get("price")) * 100),
        stock: Number(formData.get("stock") || 0),
      }),
    "Produto criado com sucesso.",
  );
  if (result.ok) revalidatePath("/produtos");
  return result;
}

export async function createEmployee(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const result = await runAction(
    () =>
      supabase.from("fa_kiosk_employees").insert({
        full_name: String(formData.get("full_name")),
        role: String(formData.get("role")),
        unit_id: String(formData.get("unit_id")),
        cpf: (formData.get("cpf") as string) || null,
        email: (formData.get("email") as string) || null,
        birth_date: (formData.get("birth_date") as string) || null,
        phone: (formData.get("phone") as string) || null,
      }),
    "Funcionário criado com sucesso.",
  );
  if (result.ok) revalidatePath("/funcionarios");
  return result;
}

export async function createCoupon(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const result = await runAction(
    () =>
      supabase.from("fa_kiosk_coupons").insert({
        unit_id: String(formData.get("unit_id")),
        code: String(formData.get("code")).toUpperCase(),
        kind: String(formData.get("kind")),
        value: Number(formData.get("value")),
        max_uses: Number(formData.get("max_uses") || 0),
        partner_name: (formData.get("partner_name") as string) || null,
        description: (formData.get("description") as string) || null,
      }),
    "Cupom criado com sucesso.",
  );
  if (result.ok) revalidatePath("/cupons");
  return result;
}

export async function upsertAppSetting(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const supabase = await createClient();
  const result = await runAction(
    () =>
      supabase.from("fa_kiosk_app_settings").upsert(
        {
          unit_id: String(formData.get("unit_id")),
          key: String(formData.get("key")),
          value: String(formData.get("value")),
          updated_at_ms: Date.now(),
        },
        { onConflict: "unit_id,key" },
      ),
    "Ajuste salvo com sucesso.",
  );
  if (result.ok) revalidatePath("/configuracoes");
  return result;
}

export async function updateUnitSettings(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const supabase = await createClient();
  const result = await runAction(
    () =>
      supabase
        .from("fa_kiosk_units")
        .update({
          timezone: String(formData.get("timezone")),
          business_day_cutoff_hour: Number(formData.get("business_day_cutoff_hour")),
        })
        .eq("id", String(formData.get("unit_id"))),
    "Configuração da unidade salva com sucesso.",
  );
  if (result.ok) revalidatePath("/configuracoes");
  return result;
}

export async function updateUnitReceiptInfo(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const supabase = await createClient();
  const result = await runAction(
    () =>
      supabase
        .from("fa_kiosk_units")
        .update({
          address: (formData.get("address") as string) || null,
          phone: (formData.get("phone") as string) || null,
          cnpj: (formData.get("cnpj") as string) || null,
        })
        .eq("id", String(formData.get("unit_id"))),
    "Dados do cupom salvos com sucesso.",
  );
  if (result.ok) revalidatePath("/configuracoes");
  return result;
}

// Campo opcional do form -> null se vazio, nunca string vazia no banco
// (Fase 1 do plano fiscal: cadastro do emitente e tributação de produto).
function optionalText(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  if (value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
}

export async function updateUnitFiscal(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const result = await runAction(
    () =>
      supabase
        .from("fa_kiosk_units")
        .update({
          cnpj: optionalText(formData, "cnpj")?.replace(/\D/g, "") ?? null,
          razao_social: optionalText(formData, "razao_social"),
          nome_fantasia: optionalText(formData, "nome_fantasia"),
          inscricao_estadual: optionalText(formData, "inscricao_estadual"),
          cnae_principal: optionalText(formData, "cnae_principal"),
          crt: Number(formData.get("crt") || 1),
          end_logradouro: optionalText(formData, "end_logradouro"),
          end_numero: optionalText(formData, "end_numero"),
          end_complemento: optionalText(formData, "end_complemento"),
          end_bairro: optionalText(formData, "end_bairro"),
          end_municipio_ibge: optionalText(formData, "end_municipio_ibge") ?? "1501402",
          end_uf: optionalText(formData, "end_uf") ?? "PA",
          end_cep: optionalText(formData, "end_cep")?.replace(/\D/g, "") ?? null,
          fone: optionalText(formData, "fone")?.replace(/\D/g, "") ?? null,
          fiscal_ambiente: String(formData.get("fiscal_ambiente") || "HOMOLOGACAO"),
          // Kill switch mestre — só liga a emissão de verdade depois de uma
          // semana inteira de homologação (ver "Verificação por fase" do
          // plano). Nunca fica true por acidente: o select vem sem
          // defaultValue de "true", tem que ser escolhido explicitamente.
          fiscal_enabled: formData.get("fiscal_enabled") === "true",
          nfce_serie: Number(formData.get("nfce_serie") || 1),
          nfce_csc_id: optionalText(formData, "nfce_csc_id"),
          nfce_qrcode_url_consulta: optionalText(formData, "nfce_qrcode_url_consulta"),
        })
        .eq("id", String(formData.get("unit_id"))),
    "Dados fiscais da unidade salvos com sucesso.",
  );
  if (result.ok) revalidatePath("/unidades");
  return result;
}

export async function updateProductFiscal(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const result = await runAction(
    () =>
      supabase
        .from("fa_kiosk_products")
        .update({
          ncm: optionalText(formData, "ncm")?.replace(/\D/g, "") ?? null,
          cest: optionalText(formData, "cest")?.replace(/\D/g, "") ?? null,
          cfop: optionalText(formData, "cfop") ?? "5102",
          csosn: optionalText(formData, "csosn") ?? "102",
          origem: Number(formData.get("origem") ?? 0),
          unidade_comercial: optionalText(formData, "unidade_comercial") ?? "UN",
          gtin: optionalText(formData, "gtin") ?? "SEM GTIN",
          pis_cst: optionalText(formData, "pis_cst") ?? "49",
          cofins_cst: optionalText(formData, "cofins_cst") ?? "49",
        })
        .eq("id", String(formData.get("product_id"))),
    "Dados fiscais do produto salvos com sucesso.",
  );
  if (result.ok) revalidatePath("/produtos");
  return result;
}

// Salário-base e dados bancários vivem em fa_kiosk_employee_payroll_info,
// separada de fa_kiosk_employees (que tem policy de leitura aberta a
// qualquer colaborador autenticado) — RLS restringe leitura/escrita aqui a
// quem tem a capacidade folha_pagamento.read/write (só Owner).
export async function updatePayrollInfo(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const salaryInput = optionalText(formData, "salary_base");
  const result = await runAction(
    () =>
      supabase.from("fa_kiosk_employee_payroll_info").upsert(
        {
          employee_id: String(formData.get("employee_id")),
          salary_base_cents: salaryInput ? Math.round(Number(salaryInput) * 100) : null,
          bank_code: optionalText(formData, "bank_code"),
          bank_agencia: optionalText(formData, "bank_agencia"),
          bank_agencia_dv: optionalText(formData, "bank_agencia_dv"),
          bank_conta: optionalText(formData, "bank_conta"),
          bank_conta_dv: optionalText(formData, "bank_conta_dv"),
          bank_account_type: optionalText(formData, "bank_account_type"),
          pix_key: optionalText(formData, "pix_key"),
          updated_at_ms: Date.now(),
        },
        { onConflict: "employee_id" },
      ),
    "Dados bancários salvos com sucesso.",
  );
  if (result.ok) revalidatePath("/folha-pagamento");
  return result;
}

export interface PayrollCloseItem {
  employeeId: string;
  fullName: string;
  cpf: string | null;
  bankCode: string | null;
  bankAgencia: string | null;
  bankAgenciaDv: string | null;
  bankConta: string | null;
  bankContaDv: string | null;
  bankAccountType: string | null;
  salaryBaseCents: number;
  adjustmentCents: number;
  adjustmentNote: string | null;
  totalCents: number;
  hoursContracted: number | null;
  hoursWorkedMinutes: number | null;
}

// Chamada direta pelo client component (não é um <form action>): a lista de
// itens revisados na tela não cabe bem num FormData. fa_kiosk_close_payroll_run
// (security definer) cria o run + todos os itens numa transação só e reforça
// folha_pagamento.write no banco, não só na UI.
export async function closePayrollRun(
  unitId: string,
  year: number,
  month: number,
  items: PayrollCloseItem[],
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("fa_kiosk_close_payroll_run", {
    p_unit_id: unitId,
    p_year: year,
    p_month: month,
    p_items: items,
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/folha-pagamento");
  return { ok: true, message: "Folha de pagamento fechada com sucesso." };
}
