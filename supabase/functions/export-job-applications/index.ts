import { createClient } from "jsr:@supabase/supabase-js@2";
import { jsonResponse, preflight } from "../_shared/http.ts";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  // Autenticação da API externa via API Key ou Webhook Secret
  const expectedKey = Deno.env.get("TALENT_API_KEY") || Deno.env.get("WEBHOOK_SECRET");
  const providedKey = req.headers.get("x-api-key") || req.headers.get("x-webhook-secret") || req.headers.get("authorization")?.replace("Bearer ", "");

  if (expectedKey && providedKey !== expectedKey) {
    return jsonResponse(req, { error: "Acesso não autorizado: API Key inválida" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const url = new URL(req.url);

  if (req.method === "GET") {
    const statusParam = url.searchParams.get("status");
    const limit = parseInt(url.searchParams.get("limit") || "50", 10);
    const offset = parseInt(url.searchParams.get("offset") || "0", 10);

    let query = adminClient
      .from("fa_kiosk_job_applications")
      .select("*", { count: "exact" })
      .order("created_at_ms", { ascending: false })
      .range(offset, offset + limit - 1);

    if (statusParam && statusParam !== "TODOS") {
      query = query.eq("status", statusParam);
    }

    const { data, count, error } = await query;

    if (error) {
      console.error("Erro ao buscar candidaturas na API de integração:", error);
      return jsonResponse(req, { error: "Falha ao buscar candidatos" }, 500);
    }

    // Gerar URLs assinadas temporárias para download do currículo PDF
    const candidatesWithResumes = await Promise.all(
      (data || []).map(async (cand) => {
        let resumeSignedUrl: string | null = null;
        if (cand.resume_path) {
          const { data: signed } = await adminClient.storage
            .from("curriculos")
            .createSignedUrl(cand.resume_path, 60 * 60 * 24); // Válido por 24h
          resumeSignedUrl = signed?.signedUrl || null;
        }

        return {
          id: cand.id,
          full_name: cand.full_name,
          email: cand.email,
          phone: cand.phone,
          course: cand.course,
          desired_area: cand.desired_area,
          opportunity_type: cand.opportunity_type,
          status: cand.status,
          created_at_ms: cand.created_at_ms,
          created_at_iso: new Date(cand.created_at_ms).toISOString(),
          resume_url: resumeSignedUrl,
        };
      })
    );

    return jsonResponse(req, {
      success: true,
      total: count || candidatesWithResumes.length,
      limit,
      offset,
      data: candidatesWithResumes,
    });
  }

  if (req.method === "POST" || req.method === "PATCH") {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return jsonResponse(req, { error: "Corpo JSON inválido" }, 400);
    }

    const { id, status } = body;
    if (!id || !status) {
      return jsonResponse(req, { error: "Parâmetros 'id' e 'status' são obrigatórios" }, 400);
    }

    const validStatuses = ["NOVO", "LIDO", "ESPERA", "ENTREVISTA", "EM_ANALISE", "CONTATADO", "ARQUIVADO"];
    if (!validStatuses.includes(status)) {
      return jsonResponse(req, { error: `Status inválido. Use um de: ${validStatuses.join(", ")}` }, 400);
    }

    const { error: updateError } = await adminClient
      .from("fa_kiosk_job_applications")
      .update({ status })
      .eq("id", id);

    if (updateError) {
      console.error("Erro ao atualizar status do candidato:", updateError);
      return jsonResponse(req, { error: "Falha ao atualizar status" }, 500);
    }

    return jsonResponse(req, {
      success: true,
      message: `Status do candidato ${id} atualizado para ${status}`,
    });
  }

  return jsonResponse(req, { error: "Método HTTP não suportado" }, 405);
});
