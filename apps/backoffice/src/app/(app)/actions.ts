"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function createUnit(formData: FormData) {
  const supabase = await createClient();
  await supabase.from("fa_kiosk_units").insert({
    name: String(formData.get("name")),
    kind: String(formData.get("kind")),
  });
  revalidatePath("/unidades");
}

export async function createPlan(formData: FormData) {
  const supabase = await createClient();
  await supabase.from("fa_kiosk_plans").insert({
    unit_id: String(formData.get("unit_id")),
    activity: String(formData.get("activity")),
    name: String(formData.get("name")),
    value_cents: Math.round(Number(formData.get("value")) * 100),
    duration_value: Number(formData.get("duration_value")),
    duration_unit: String(formData.get("duration_unit")),
    overage_cents_per_minute: Math.round(Number(formData.get("overage") || 0) * 100),
  });
  revalidatePath("/planos");
}

export async function createProduct(formData: FormData) {
  const supabase = await createClient();
  await supabase.from("fa_kiosk_products").insert({
    unit_id: String(formData.get("unit_id")),
    name: String(formData.get("name")),
    price_cents: Math.round(Number(formData.get("price")) * 100),
    stock: Number(formData.get("stock") || 0),
  });
  revalidatePath("/produtos");
}

export async function createEmployee(formData: FormData) {
  const supabase = await createClient();
  await supabase.from("fa_kiosk_employees").insert({
    full_name: String(formData.get("full_name")),
    role: String(formData.get("role")),
  });
  revalidatePath("/funcionarios");
}
