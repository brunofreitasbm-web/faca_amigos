// Validação compartilhada por onboarding-invite-info e onboarding-complete
// — as duas conferem o convite do mesmo jeito, porque nenhuma confia que a
// outra rodou antes (o front pode chamar só onboarding-complete direto).
//
// Trava de tentativas por convite (8, sem decaimento): a entropia do token
// (32 bytes aleatórios) já torna força bruta inviável na prática, isto é
// só uma rede de segurança extra, no mesmo espírito da escada de
// bloqueio do login-pin — aqui mais simples porque o custo de um ataque
// já é astronomicamente mais alto que adivinhar um PIN de 6 dígitos.

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import bcrypt from "npm:bcryptjs@2.4.3";

const MAX_FAILED_ATTEMPTS = 8;
const GENERIC_ERROR = "Este link não é mais válido — peça um novo convite.";

export interface OnboardingInvite {
  id: string;
  role: string;
  position: string;
  unit_ids: string[];
  full_name_hint: string | null;
  admission_date: string | null;
}

export type InviteResult =
  | { ok: true; invite: OnboardingInvite }
  | { ok: false; error: string };

export async function validateInvite(
  adminClient: SupabaseClient,
  inviteId: string,
  token: string,
): Promise<InviteResult> {
  if (!inviteId || !token) return { ok: false, error: GENERIC_ERROR };

  const { data: invite, error } = await adminClient
    .from("fa_kiosk_onboarding_invites")
    .select("id, token_hash, role, position, unit_ids, full_name_hint, admission_date, expires_at_ms, used_at_ms, failed_attempts")
    .eq("id", inviteId)
    .maybeSingle();

  if (error || !invite) return { ok: false, error: GENERIC_ERROR };
  if (invite.used_at_ms || invite.expires_at_ms < Date.now() || invite.failed_attempts >= MAX_FAILED_ATTEMPTS) {
    return { ok: false, error: GENERIC_ERROR };
  }

  const tokenOk = bcrypt.compareSync(token, invite.token_hash);
  if (!tokenOk) {
    const nextFailedAttempts = invite.failed_attempts + 1;
    const patch: Record<string, unknown> = { failed_attempts: nextFailedAttempts };
    // Ao atingir o limite, o convite é queimado imediatamente — não espera
    // outra tentativa pra virar "usado".
    if (nextFailedAttempts >= MAX_FAILED_ATTEMPTS) patch.used_at_ms = Date.now();
    await adminClient.from("fa_kiosk_onboarding_invites").update(patch).eq("id", inviteId);
    return { ok: false, error: GENERIC_ERROR };
  }

  return {
    ok: true,
    invite: {
      id: invite.id,
      role: invite.role,
      position: invite.position,
      unit_ids: invite.unit_ids,
      full_name_hint: invite.full_name_hint,
      admission_date: invite.admission_date,
    },
  };
}
