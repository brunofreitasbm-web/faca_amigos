import { ROLE_LABEL, type Role } from "../../../auth/capabilities.js";
import { money } from "../../../format.js";

/** Rótulo amigável por código de `action` — ver os triggers/RPCs que escrevem em `fa_kiosk_audit_log`. */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  PONTO_ENTRADA: "Ponto: entrada",
  PONTO_SAIDA: "Ponto: saída",
  PONTO_INTERVALO_INICIO: "Ponto: início de intervalo",
  PONTO_INTERVALO_FIM: "Ponto: fim de intervalo",
  ENTRADA_CHECKIN: "Check-in de criança",
  SAIDA_CHECKOUT: "Check-out de criança",
  SESSAO_CANCELADA: "Sessão cancelada",
  CAIXA_TURNO_ABERTO: "Abertura de turno de caixa",
  CAIXA_TURNO_FECHADO: "Fechamento de turno de caixa",
  CAIXA_TROCO_INICIAL: "Troco inicial lançado",
  CAIXA_SANGRIA: "Sangria de caixa",
  CAIXA_SUPRIMENTO: "Suprimento de caixa",
  CAIXA_AJUSTE: "Ajuste de caixa",
  CAIXA_ENVELOPE_RECOLHIDO: "Envelope de caixa recolhido",
  CONFIG_UNIT_CREATE: "Unidade criada",
  CONFIG_UNIT_UPDATE: "Unidade editada",
  CONFIG_FISCAL_UPDATE: "Dados fiscais da unidade editados",
  CONFIG_PRODUCT_FISCAL_UPDATE: "Dados fiscais de produto editados",
  CONFIG_TERMS_UPDATE: "Termos de uso editados",
  CONFIG_EMPLOYEE_ROLE_CHANGE: "Papel de colaborador alterado",
  CONFIG_EMPLOYEE_ACTIVE_CHANGE: "Colaborador ativado/desativado",
  CONFIG_EMPLOYEE_UNITS_SET: "Unidades do colaborador alteradas",
  CONFIG_RBAC_CAPABILITY_ROLE_CHANGE: "Permissão de capacidade alterada",
  CONFIG_RESET_VISIT_COUNTER: "Contador de visitas reiniciado",
  CONFIG_EMPLOYEE_GENERAL_INVITE_COMPLETE: "Convite geral concluído (colaborador)",
  CONFIG_EMPLOYEE_PIN_RESET: "PIN de colaborador redefinido",
  CONFIG_EMPLOYEE_ONBOARDING_INVITE_COMPLETE: "Onboarding de colaborador concluído",
  CONFIG_EMPLOYEE_CREATE: "Colaborador criado",
  CONFIG_FISCAL_CERTIFICATE_UPLOAD: "Certificado fiscal enviado",
  AUTH_STEP_UP_PIN_OK: "Confirmação de PIN (ação sensível)",
  AUTH_LOGIN_PIN_OK: "Login com PIN",
  FACE_ENROLLED: "Reconhecimento facial cadastrado",
};

/** Some codes never seen ainda caem aqui: "SESSAO_CANCELADA" -> "Sessao cancelada" (title-case bruto). */
export function auditActionLabel(action: string): string {
  return (
    AUDIT_ACTION_LABELS[action] ??
    action
      .toLowerCase()
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  );
}

export interface AuditDetailContext {
  employeeName: (id: unknown) => string | null;
  unitName: (id: unknown) => string | null;
}

function fmtMs(ms: unknown): string | null {
  const n = Number(ms);
  if (!Number.isFinite(n)) return null;
  return new Date(n).toLocaleString("pt-BR");
}

function roleLabel(role: unknown): string | null {
  if (typeof role !== "string") return null;
  return ROLE_LABEL[role as Role] ?? role;
}

/** Traduz `details_json` para linhas legíveis; o que não é coberto some da tela mas continua no "ver JSON técnico". */
export function formatAuditDetails(
  action: string,
  details: Record<string, unknown> | null | undefined,
  ctx: AuditDetailContext,
): string[] {
  if (!details) return [];
  const d = details;
  const lines: string[] = [];

  const unit = ctx.unitName(d.unitId);
  if (unit) lines.push(`Unidade: ${unit}`);

  switch (action) {
    case "PONTO_ENTRADA":
    case "PONTO_SAIDA":
    case "PONTO_INTERVALO_INICIO":
    case "PONTO_INTERVALO_FIM": {
      const at = fmtMs(d.atMs);
      if (at) lines.push(`Registrado em: ${at}`);
      if (d.nsr) lines.push(`NSR: ${d.nsr}`);
      const registeredBy = ctx.employeeName(d.registeredByEmployeeId);
      if (registeredBy) lines.push(`Registrado por: ${registeredBy}`);
      break;
    }
    case "ENTRADA_CHECKIN":
      if (d.childName) lines.push(`Criança: ${d.childName}`);
      if (d.activity) lines.push(`Atividade: ${d.activity}`);
      break;
    case "SAIDA_CHECKOUT":
    case "SESSAO_CANCELADA":
      if (d.childName) lines.push(`Criança: ${d.childName}`);
      break;
    case "CAIXA_TURNO_ABERTO":
      if (typeof d.openingCashCents === "number") lines.push(`Fundo de caixa contado na abertura: ${money(d.openingCashCents)}`);
      if (typeof d.expectedOpeningCashCents === "number") lines.push(`Fundo previsto (fechamento anterior): ${money(d.expectedOpeningCashCents)}`);
      if (typeof d.openingDivergenceCents === "number" && d.openingDivergenceCents !== 0) {
        lines.push(
          d.openingDivergenceCents > 0
            ? `⚠ Sobra na abertura: ${money(d.openingDivergenceCents)}`
            : `⚠ Falta na abertura: ${money(Math.abs(d.openingDivergenceCents))}`,
        );
      }
      break;
    case "CAIXA_TURNO_FECHADO":
      if (typeof d.countedCashCents === "number") lines.push(`Dinheiro contado na gaveta: ${money(d.countedCashCents)}`);
      if (typeof d.drawerExpectedCents === "number") lines.push(`Esperado na gaveta: ${money(d.drawerExpectedCents)}`);
      if (typeof d.cashBreakCents === "number" && d.cashBreakCents !== 0) {
        lines.push(d.cashBreakCents > 0 ? `⚠ Sobra: ${money(d.cashBreakCents)}` : `⚠ Quebra: ${money(Math.abs(d.cashBreakCents))}`);
      }
      if (typeof d.nextDayFloatCents === "number") lines.push(`Fundo para o próximo dia: ${money(d.nextDayFloatCents)}`);
      if (typeof d.envelopeCents === "number") lines.push(`Envelope: ${money(d.envelopeCents)}`);
      break;
    case "CAIXA_TROCO_INICIAL":
    case "CAIXA_SANGRIA":
    case "CAIXA_SUPRIMENTO":
    case "CAIXA_AJUSTE":
    case "CAIXA_ENVELOPE_RECOLHIDO":
      if (typeof d.amountCents === "number") lines.push(`Valor: ${money(d.amountCents)}`);
      if (d.reason) lines.push(`Motivo: ${d.reason}`);
      if (d.envelopeNumber) lines.push(`Envelope nº: ${d.envelopeNumber}`);
      break;
    case "CONFIG_EMPLOYEE_ROLE_CHANGE": {
      const emp = ctx.employeeName(d.employeeId);
      if (emp) lines.push(`Colaborador: ${emp}`);
      const from = roleLabel(d.from);
      const to = roleLabel(d.to);
      if (from && to) lines.push(`De "${from}" para "${to}"`);
      break;
    }
    case "CONFIG_RBAC_CAPABILITY_ROLE_CHANGE": {
      if (d.capability) lines.push(`Capacidade: ${d.capability}`);
      const from = roleLabel(d.from);
      const to = roleLabel(d.to);
      if (from && to) lines.push(`De "${from}" para "${to}"`);
      break;
    }
    case "CONFIG_EMPLOYEE_ACTIVE_CHANGE": {
      const emp = ctx.employeeName(d.employeeId);
      if (emp) lines.push(`Colaborador: ${emp}`);
      lines.push(d.active ? "Status: ativado" : "Status: desativado");
      break;
    }
    case "CONFIG_EMPLOYEE_UNITS_SET": {
      const emp = ctx.employeeName(d.employeeId);
      if (emp) lines.push(`Colaborador: ${emp}`);
      const ids = Array.isArray(d.unitIds) ? d.unitIds : [];
      const names = ids.map((id) => ctx.unitName(id) ?? String(id)).join(", ");
      lines.push(names ? `Unidades: ${names}` : "Unidades: nenhuma");
      break;
    }
    case "CONFIG_TERMS_UPDATE":
      lines.push("Texto completo dos novos termos disponível em \"ver JSON técnico\"");
      break;
    case "CONFIG_FISCAL_CERTIFICATE_UPLOAD":
    case "FACE_ENROLLED": {
      const emp = ctx.employeeName(d.employeeId);
      if (emp) lines.push(`Colaborador: ${emp}`);
      break;
    }
    default:
      break;
  }
  return lines;
}
