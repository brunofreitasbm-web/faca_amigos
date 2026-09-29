import { supabase } from "./client.js";

/**
 * Porta de entrada do Hub de Gestão (gestao.institutofacaamigos.com.br).
 *
 * O hub gera, com a service role, um magic link que nunca é enviado por
 * e-mail e abre `/sso?token_hash=…` aqui. É o mesmo mecanismo do login por
 * PIN (`login-pin` + verifyOtp em terminalAuth.ts): o token é de uso único e
 * vira uma sessão real do Supabase Auth, então `auth.uid()`, RLS e
 * capacidades seguem valendo normalmente.
 *
 * Precisa rodar ANTES do primeiro render: o AppState restaura o colaborador
 * a partir de `getSession()` só uma vez, na montagem.
 */
export async function consumeHubSsoTicket(): Promise<void> {
  if (window.location.pathname !== "/sso") return;
  const tokenHash = new URLSearchParams(window.location.search).get("token_hash");
  // Tira o token da barra de endereço e do histórico antes de qualquer coisa.
  window.history.replaceState(null, "", "/");
  if (!tokenHash) return;

  const { error } = await supabase().auth.verifyOtp({ token_hash: tokenHash, type: "email" });
  if (error) console.error("[sso] ticket do Hub de Gestão recusado:", error.message);
}
