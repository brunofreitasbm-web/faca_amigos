// Validação compartilhada por general-invite-info e general-onboarding-
// complete — mesmo espírito de onboardingInvite.ts, mas o token do Link
// Geral é fixo por unidade e reutilizável, então não há `used_at`/
// `expires_at` a conferir: só existe ou não bate.

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

const GENERIC_ERROR = "Este link não é válido — confira com quem te enviou.";

export type GeneralInviteResult =
  | { ok: true; unitId: string }
  | { ok: false; error: string };

export async function validateGeneralInvite(
  adminClient: SupabaseClient,
  unitId: string,
  token: string,
): Promise<GeneralInviteResult> {
  if (!unitId || !token) return { ok: false, error: GENERIC_ERROR };

  const { data: invite, error } = await adminClient
    .from("fa_kiosk_unit_general_invites")
    .select("unit_id, token")
    .eq("unit_id", unitId)
    .maybeSingle();

  if (error || !invite || invite.token !== token) return { ok: false, error: GENERIC_ERROR };

  return { ok: true, unitId: invite.unit_id };
}
