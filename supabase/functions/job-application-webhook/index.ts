import { createClient } from "jsr:@supabase/supabase-js@2";
import { jsonResponse, preflight } from "../_shared/http.ts";

const OPPORTUNITY_TYPES = ["ESTAGIO", "REMUNERADO", "BOLSA"];
const MAX_RESUME_BYTES = 5 * 1024 * 1024;

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonResponse(req, { error: "corpo inválido" }, 400);
  }

  const fullName = String(form.get("full_name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim();
  const phone = String(form.get("phone") ?? "").trim();
  const course = String(form.get("course") ?? "").trim();
  const desiredArea = String(form.get("desired_area") ?? "").trim();
  const opportunityType = String(form.get("opportunity_type") ?? "").trim();
  const resume = form.get("resume");

  if (!fullName || !email || !phone || !desiredArea) {
    return jsonResponse(req, { error: "campos obrigatórios ausentes" }, 400);
  }
  if (!OPPORTUNITY_TYPES.includes(opportunityType)) {
    return jsonResponse(req, { error: "tipo de oportunidade inválido" }, 400);
  }
  if (!(resume instanceof File) || resume.type !== "application/pdf") {
    return jsonResponse(req, { error: "currículo deve ser um PDF" }, 400);
  }
  if (resume.size > MAX_RESUME_BYTES) {
    return jsonResponse(req, { error: "currículo maior que 5MB" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const resumePath = `${Date.now()}-${crypto.randomUUID()}.pdf`;
  const { error: uploadError } = await adminClient.storage
    .from("curriculos")
    .upload(resumePath, resume, { contentType: "application/pdf", upsert: false });

  if (uploadError) {
    console.error("Erro ao enviar currículo:", uploadError);
    return jsonResponse(req, { error: "falha ao enviar currículo" }, 500);
  }

  const { error: insertError } = await adminClient.from("fa_kiosk_job_applications").insert({
    full_name: fullName,
    email,
    phone,
    course: course || null,
    desired_area: desiredArea,
    opportunity_type: opportunityType,
    resume_path: resumePath,
  });

  if (insertError) {
    console.error("Erro ao registrar candidatura:", insertError);
    return jsonResponse(req, { error: "falha ao registrar candidatura" }, 500);
  }

  return jsonResponse(req, { success: true, message: "Candidatura recebida com sucesso!" });
});
