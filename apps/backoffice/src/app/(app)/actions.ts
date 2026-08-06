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
