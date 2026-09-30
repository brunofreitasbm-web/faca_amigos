// Abre o PDF do "Olhar FaçaAmigos" para o responsável, a partir do link do
// WhatsApp: /session-report-view?t=<token>.
//
// verify_jwt = false (config.toml): quem abre é a família no navegador, sem
// sessão. A autorização é o token aleatório de 256 bits gravado UMA vez no
// relatório (fa_kiosk_session_reports.public_token). O bucket é privado; a
// function troca o token por uma signed URL de 1h e redireciona.
//
// Token inválido/ausente vai para o site público: a URL de amostra que a Meta
// testa na aprovação do template precisa resolver para uma página real.

import { createClient } from "jsr:@supabase/supabase-js@2";

const HOME = "https://institutofacaamigos.com.br";
const TOKEN_RE = /^[A-Za-z0-9_-]{40,64}$/;

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("t") ?? "";
  if (req.method !== "GET" || !TOKEN_RE.test(token)) return Response.redirect(HOME, 302);

  // Preview de link do WhatsApp (quando o link vai no corpo, não no botão) não
  // conta como o responsável ter aberto.
  const ua = req.headers.get("user-agent") ?? "";
  const count = !/whatsapp|facebookexternalhit|bot|crawler|preview/i.test(ua);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: path, error } = await admin.rpc("fa_session_report_register_view", { p_token: token, p_count: count });
  if (error || !path) return Response.redirect(HOME, 302);

  const { data } = await admin.storage.from("relatorios-sessao").createSignedUrl(path as string, 3600);
  if (!data?.signedUrl) return Response.redirect(HOME, 302);

  return new Response(null, { status: 302, headers: { Location: data.signedUrl, "Cache-Control": "no-store" } });
});
