"use strict";
/**
 * FaçaAmigos — Protótipo clicável (Fase 0)
 * ─────────────────────────────────────────────────────────────────
 * Terceira rodada de ajustes, a pedido da operação:
 *
 *   - menu "Configurações" único, com sub-abas que mudam conforme a
 *     unidade atual (Loja vs Quiosque) — Planos, Cupom de Desconto,
 *     Fidelidade, Colaboradores, Movimentação de Caixa (relatório),
 *     Produtos e Unidade são tenant-wide (mesma base nos dois pontos);
 *     Planos, Frota e Unidade mostram dado PRÓPRIO de cada ponto;
 *   - Cartão Fidelidade: regras configuráveis (ex. "a cada 10 visitas
 *     no playground, ganha 1 grátis"), progresso por criança, alerta
 *     de recompensa disponível na Entrada;
 *   - Entrada com autocomplete incremental: digitando CPF, WhatsApp ou
 *     nome da criança, o sistema já sugere o cadastro correspondente
 *     sem re-renderizar a tela inteira a cada tecla;
 *   - trocar o plano de uma sessão já em andamento, recalculando o
 *     valor a pagar automaticamente (o cálculo já era ao vivo — só
 *     faltava o botão para mudar o planId no meio do caminho);
 *   - popups descritivos nas ações que têm consequência (excluir,
 *     trocar de plano, resgatar recompensa) — não em toda ação trivial
 *     como selecionar um card, o que atrapalharia mais que ajudaria.
 *
 * Continua sem persistir nada, sem hardware real, sem backend.
 */

// ═══════════════════════════════════════════════════════════════════
// Utilidades
// ═══════════════════════════════════════════════════════════════════

function uid(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}
function money(cents) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function pad2(n) {
  return String(n).padStart(2, "0");
}
function formatElapsed(ms) {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h > 0 ? pad2(h) + ":" : ""}${pad2(m)}:${pad2(s)}`;
}
function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2600);
}
function fmtTime(ms) {
  return new Date(ms).toLocaleTimeString("pt-BR");
}
function onlyDigits(str) {
  return String(str ?? "").replace(/\D/g, "");
}

/**
 * Popup descritivo genérico para ações com consequência (excluir,
 * trocar de plano, resgatar recompensa). Não usado para ações triviais
 * (selecionar um card, trocar de aba) — isso atrapalharia mais do que
 * ajudaria.
 */
function confirmAction({ title, description, confirmLabel = "Confirmar", danger = false, onConfirm }) {
  window.__confirmActionCallback = onConfirm;
  openModal(`
    <h2>${escapeHtml(title)}</h2>
    <p class="desc">${description}</p>
    <div class="actions">
      <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
      <button class="btn ${danger ? "btn-dark" : "btn-primary"}" onclick="window.__confirmActionCallback(); closeModal();">${escapeHtml(confirmLabel)}</button>
    </div>
  `);
}

// ═══════════════════════════════════════════════════════════════════
// Planos de preço (configuráveis, por unidade)
// ═══════════════════════════════════════════════════════════════════

function seedPlans() {
  return {
    PLAYGROUND: [
      { id: uid("plan"), name: "30 minutos", valueCents: 6000, durationValue: 30, durationUnit: "MINUTO", overageCentsPerMinute: 180 },
      { id: uid("plan"), name: "1 hora", valueCents: 10800, durationValue: 1, durationUnit: "HORA", overageCentsPerMinute: 180 },
      { id: uid("plan"), name: "2 horas", valueCents: 19200, durationValue: 2, durationUnit: "HORA", overageCentsPerMinute: 180 },
      { id: uid("plan"), name: "Day Use (5h)", valueCents: 27000, durationValue: 5, durationUnit: "HORA", overageCentsPerMinute: 180 },
    ],
    CARRINHO: [
      { id: uid("plan"), name: "15 minutos", valueCents: 3000, durationValue: 15, durationUnit: "MINUTO", overageCentsPerMinute: 100 },
      { id: uid("plan"), name: "30 minutos", valueCents: 5500, durationValue: 30, durationUnit: "MINUTO", overageCentsPerMinute: 100 },
    ],
  };
}
function planDurationMinutes(plan) {
  return plan.durationUnit === "HORA" ? plan.durationValue * 60 : plan.durationValue;
}
function findPlan(activity, planId) {
  return STATE.plans[activity].find((p) => p.id === planId) || null;
}
function computeSessionTiming(plan, session, nowMs) {
  const elapsedMs = Math.max(0, nowMs - session.checkinAtMs);
  const durationMs = planDurationMinutes(plan) * 60000;
  const overMs = Math.max(0, elapsedMs - durationMs - 60000);
  const overMinutes = Math.ceil(overMs / 60000);
  const overCents = overMinutes * plan.overageCentsPerMinute;
  const liveTotalCents = plan.valueCents + overCents;
  let phase;
  if (overMinutes > 0) phase = "EXCEDENTE";
  else if (elapsedMs < durationMs * 0.8) phase = "VERDE";
  else phase = "AMARELO";
  return { elapsedMs, durationMs, overMinutes, overCents, liveTotalCents, phase };
}
function quoteForSession(session, nowMs) {
  const plan = findPlan(session.activity, session.planId);
  const t = computeSessionTiming(plan, session, nowMs);
  const lines = [{ label: `${session.childName} — ${plan.name}`, cents: plan.valueCents }];
  if (t.overMinutes > 0) lines.push({ label: `Excedente (${t.overMinutes} min × ${money(plan.overageCentsPerMinute)})`, cents: t.overCents });
  let totalCents = t.liveTotalCents;
  if (session.couponDiscountCents) {
    const applied = Math.min(session.couponDiscountCents, totalCents);
    lines.push({ label: `Cupom ${session.couponCode || ""}`, cents: -applied });
    totalCents -= applied;
  }
  if (session.freeFromLoyalty) {
    lines.push({ label: "Cortesia — resgate de fidelidade", cents: -totalCents });
    totalCents = 0;
  }
  return { plan, timing: t, lines, totalCents: Math.max(0, totalCents) };
}

// ═══════════════════════════════════════════════════════════════════
// Produtos, cupons, fidelidade, colaboradores — tenant-wide
// ═══════════════════════════════════════════════════════════════════

const CART_EMOJI_OPTIONS = ["🚙", "🚗", "🏎️", "🏍️", "🏁", "🚜", "🛺", "🚕", "🛻", "🏇"];
const CART_COLOR_OPTIONS = ["#F0196B", "#2ECFB5", "#FFE234", "#C99020", "#1A3F35", "#3A4149", "#A020EE", "#FF7A00"];
const PRODUCT_EMOJI_OPTIONS = ["💧", "🧦", "🧃", "🥐", "🍫", "🎈", "🧢", "🍭"];
const DEFAULT_CARRINHOS = [
  { name: "Buggy Azul", emoji: "🏎️", color: "#2ECFB5" },
  { name: "Moto Verde", emoji: "🏍️", color: "#1A3F35" },
  { name: "Kart Laranja", emoji: "🏁", color: "#FF7A00" },
  { name: "Trator Roxo", emoji: "🚜", color: "#A020EE" },
];

function seedProducts() {
  return [
    { id: uid("prod"), name: "Água mineral", description: "Garrafa 500ml", emoji: "💧", price: 500, stock: 40 },
    { id: uid("prod"), name: "Meia antiderrapante", description: "Tamanho único infantil", emoji: "🧦", price: 1500, stock: 25 },
    { id: uid("prod"), name: "Suco natural", description: "Copo 300ml", emoji: "🧃", price: 800, stock: 30 },
    { id: uid("prod"), name: "Salgado", description: "Coxinha ou risole", emoji: "🥐", price: 700, stock: 20 },
  ];
}

function seedCoupons() {
  return [{ id: uid("coup"), code: "AMIGO10", kind: "MINUTOS_EXTRA", value: 10, maxUses: 999, usedCount: 0, active: true, description: "10 minutos extras — avaliação no Google" }];
}

function seedLoyaltyRules() {
  return [{ id: uid("loy"), description: "A cada 10 visitas no playground, ganha 1 entrada grátis", activity: "PLAYGROUND", triggerVisits: 10, rewardKind: "ENTRADA_GRATIS", rewardValue: 1 }];
}

function seedEmployees() {
  return [];
}

// ═══════════════════════════════════════════════════════════════════
// Estado
// ═══════════════════════════════════════════════════════════════════

const STATE = {
  currentUnit: "LOJA",
  currentScreen: "checkin",
  offlineSimulated: false,
  configTab: "planos",

  plans: seedPlans(),
  products: seedProducts(),
  coupons: seedCoupons(),
  loyaltyRules: seedLoyaltyRules(),
  employees: seedEmployees(),

  // Registro de crianças/responsáveis — fonte do autocomplete e do
  // progresso de fidelidade. Pertence ao tenant, não à unidade (a
  // mesma criança frequenta Loja e Quiosque).
  children: [],

  units: {
    LOJA: makeUnitState("LOJA"),
    QUIOSQUE: makeUnitState("QUIOSQUE"),
    GRAOPARA: makeUnitState("GRAOPARA"),
  },

  checkinDraft: makeCheckinDraft("LOJA"),
  selection: [],
  closeModal: null,
  pdvCart: [],
  pdvMethod: null,

  // Bater Ponto — NSR (Número Sequencial de Registro) precisa ser
  // sequencial e nunca reaproveitado, mesmo que um registro pareça
  // errado depois (Portaria MTP 671/2021). Por isso é append-only:
  // não existe "excluir marcação" neste protótipo, de propósito.
  pontoRecords: [],
  nsrCounter: 0,
  pontoSelectedEmployeeId: null,
  relatorioTab: "vendas",
};

function makeUnitState(unit) {
  return {
    unit,
    sessions: [],
    assets: unit === "QUIOSQUE" ? DEFAULT_CARRINHOS.map((c) => ({ id: uid("asset"), ...c, status: "DISPONIVEL", sessionId: null, totalUsedMinutes: 0 })) : [],
    shift: null,
    shiftHistory: [],
    ticketCounter: 0,
    termsText: unit === "QUIOSQUE" ? "Uso exclusivo de crianças acompanhadas por responsável. Proibido exceder a lotação do carrinho. A operação não se responsabiliza por objetos pessoais deixados no veículo." : "",
    maintenanceThresholdHours: 40,
    dailyGoalCents: 150000, // R$1.500 — editável em Configurações > Unidade
    unitInfo: {
      name: unit === "QUIOSQUE" ? "FaçaAmigos — Circuito (Parque Shopping)" : unit === "GRAOPARA" ? "FaçaAmigos — Playground (Bosque Grão-Pará)" : "FaçaAmigos — Playground (Parque Shopping)",
      address: unit === "GRAOPARA" ? "Shopping Bosque Grão-Pará — Belém/PA" : "Parque Shopping Belém — Belém/PA",
      openTime: "10:00",
      closeTime: "22:00",
      certFileName: "",
      certPassword: "",
    },
  };
}

function makeCheckinDraft(unit) {
  return {
    childId: null, // preenchido quando um match do autocomplete é escolhido
    childName: "",
    birthDate: "",
    guardianName: "",
    guardianPhone: "",
    guardianCpf: "",
    activity: unit === "QUIOSQUE" ? "CARRINHO" : "PLAYGROUND",
    assetId: null,
    planId: null,
    couponCode: "",
    couponApplied: null, // {id, code, discountCents}
    applyLoyaltyReward: false,
  };
}

function unitState() {
  return STATE.units[STATE.currentUnit];
}
function activityForUnit() {
  return STATE.currentUnit === "QUIOSQUE" ? "CARRINHO" : "PLAYGROUND";
}

// ═══════════════════════════════════════════════════════════════════
// Navegação
// ═══════════════════════════════════════════════════════════════════

const NAV_ITEMS = [
  { screen: "checkin", label: "Entrada" },
  { screen: "dashboard", label: "Painel" },
  { screen: "pdv", label: "PDV" },
  { screen: "caixa", label: "Caixa" },
  { screen: "ponto", label: "Ponto" },
  { screen: "relatorio", label: "Relatório" },
  { screen: "config", label: "Configurações" },
];

function setScreen(screen) {
  STATE.currentScreen = screen;
  render();
}
function setUnit(unit) {
  STATE.currentUnit = unit;
  STATE.checkinDraft = makeCheckinDraft(unit);
  STATE.selection = [];
  STATE.pdvCart = [];
  STATE.pdvMethod = null;
  STATE.configTab = "planos";
  render();
}
function render() {
  document.querySelectorAll("#unit-switch button").forEach((b) => b.classList.toggle("active", b.dataset.unit === STATE.currentUnit));
  document.getElementById("offline-banner").classList.toggle("show", STATE.offlineSimulated);

  const nav = document.getElementById("nav-tabs");
  nav.innerHTML = NAV_ITEMS.map((i) => `<button data-screen="${i.screen}" class="${STATE.currentScreen === i.screen ? "active" : ""}">${i.label}</button>`).join("");

  const mount = document.getElementById("screen");
  switch (STATE.currentScreen) {
    case "checkin": mount.innerHTML = renderCheckin(); break;
    case "dashboard": mount.innerHTML = renderDashboard(); break;
    case "pdv": mount.innerHTML = renderPdv(); break;
    case "caixa": mount.innerHTML = renderCaixa(); break;
    case "ponto": mount.innerHTML = renderPonto(); break;
    case "relatorio": mount.innerHTML = renderRelatorio(); break;
    case "config": mount.innerHTML = renderConfig(); break;
    default: mount.innerHTML = "";
  }
}

// ═══════════════════════════════════════════════════════════════════
// TELA — Entrada (com autocomplete e cupom)
// ═══════════════════════════════════════════════════════════════════

function renderCheckin() {
  const d = STATE.checkinDraft;
  const us = unitState();
  const isQuiosque = STATE.currentUnit === "QUIOSQUE";
  const plans = STATE.plans[activityForUnit()];
  const reward = d.childId ? findRedeemableReward(d.childId, activityForUnit()) : null;

  return `
    <h1>Entrada</h1>
    <p class="lede">${isQuiosque ? "Módulo Quiosque (Circuito)" : "Módulo Loja (Playground)"} — comece digitando o nome, WhatsApp ou CPF: se a criança já visitou antes, o cadastro aparece pra você escolher.</p>

    <div class="grid-2">
      <div class="panel">
        <div class="field">
          <label>Nome da criança</label>
          <input type="text" id="f-childName" value="${escapeHtml(d.childName)}" placeholder="Ex.: Helena Souza" oninput="onCheckinFieldInput('childName', this.value)" autocomplete="off" />
        </div>
        <div id="match-suggestions" class="match-suggestions"></div>

        <div class="field">
          <label>Data de nascimento</label>
          <input type="date" value="${d.birthDate}" oninput="STATE.checkinDraft.birthDate=this.value" />
        </div>
        <div class="field">
          <label>Nome do responsável</label>
          <input type="text" value="${escapeHtml(d.guardianName)}" placeholder="Ex.: Ana Souza" oninput="STATE.checkinDraft.guardianName=this.value" />
        </div>
        <div class="field">
          <label>CPF do responsável</label>
          <input type="text" id="f-guardianCpf" value="${escapeHtml(d.guardianCpf)}" placeholder="000.000.000-00" oninput="onCheckinFieldInput('guardianCpf', this.value)" />
        </div>
        <div class="field">
          <label>WhatsApp do responsável</label>
          <input type="tel" id="f-guardianPhone" value="${escapeHtml(d.guardianPhone)}" placeholder="(91) 98250-1215" oninput="onCheckinFieldInput('guardianPhone', this.value)" />
        </div>
        ${d.childId ? `<p class="hint">📎 cadastro carregado — os campos foram preenchidos automaticamente ${renderVisitBadge(STATE.children.find((c) => c.id === d.childId))}</p>` : ""}
      </div>

      <div class="panel">
        <div class="field">
          <label>Atividade</label>
          ${
            isQuiosque
              ? `<div class="grid-3" style="gap:10px">
                  ${us.assets.map((a) => {
                    const disabled = a.status !== "DISPONIVEL";
                    const selected = d.assetId === a.id;
                    return `<div class="activity-card ${selected ? "selected" : ""} ${disabled ? "disabled" : ""}" ${disabled ? "" : `onclick="selectAsset('${a.id}')"`} style="${selected ? `border-color:${a.color}` : ""}">
                      <span class="emoji">${a.emoji}</span>
                      <span class="name">${escapeHtml(a.name)}</span>
                      <div style="margin-top:6px"><span class="status-badge" data-phase="${a.status === "DISPONIVEL" ? "VERDE" : a.status === "EM_USO" ? "VERMELHO" : "AMARELO"}" style="font-size:10px;padding:3px 8px">${assetStatusLabel(a.status)}</span></div>
                    </div>`;
                  }).join("")}
                </div>`
              : `<div class="activity-card selected" style="max-width:220px"><span class="emoji">🏰</span><span class="name">Playground</span></div>`
          }
        </div>

        <div class="field">
          <label>Plano</label>
          ${plans.length === 0 ? `<p class="hint">Nenhum plano cadastrado — configure em <strong>Configurações</strong>.</p>` : `<div class="grid-2" style="gap:10px">${plans.map((p) => renderPlanCard(p, d.planId === p.id, `selectPlan('${p.id}')`)).join("")}</div>`}
        </div>

        <div class="field">
          <label>Cupom de desconto (opcional)</label>
          <div style="display:flex;gap:8px">
            <input type="text" id="f-coupon" value="${escapeHtml(d.couponCode)}" placeholder="Ex.: AMIGO10" oninput="STATE.checkinDraft.couponCode=this.value.toUpperCase()" style="flex:1" />
            <button class="btn btn-secondary btn-sm" onclick="applyCouponToDraft()">Aplicar</button>
          </div>
          ${d.couponApplied ? `<p class="hint" style="color:var(--status-verde-text)">✓ ${escapeHtml(d.couponApplied.code)} aplicado — ${describeCouponEffect(d.couponApplied)}</p>` : ""}
        </div>
      </div>
    </div>

    ${
      reward
        ? `<div class="reward-banner">
            <p>🎁 Esta criança tem uma recompensa disponível: <strong>${escapeHtml(describeLoyaltyReward(reward))}</strong></p>
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600">
              <input type="checkbox" ${d.applyLoyaltyReward ? "checked" : ""} onchange="STATE.checkinDraft.applyLoyaltyReward=this.checked;render()" style="width:18px;height:18px;accent-color:var(--color-teal)" />
              Aplicar agora
            </label>
          </div>`
        : ""
    }

    <div class="panel" style="margin-top:var(--space-6)">
      <button class="btn btn-primary btn-lg btn-block" ${canSubmitCheckin(d) && !STATE.offlineSimulated ? "" : "disabled"} onclick="submitCheckin()">
        Confirmar entrada e imprimir cupom
      </button>
      ${
        STATE.offlineSimulated
          ? `<p class="hint" style="text-align:center;margin-top:8px">Servidor local fora do ar — sem entrada até religar.</p>`
          : !canSubmitCheckin(d)
            ? `<p class="hint" style="text-align:center;margin-top:8px">${checkinBlockReason(d)}</p>`
            : ""
      }
    </div>
  `;
}

function renderPlanCard(plan, selected, onclick) {
  return `<div class="plan-card ${selected ? "selected" : ""}" onclick="${onclick}">
    <p class="plan-name">${escapeHtml(plan.name)}</p>
    <p class="plan-value">${money(plan.valueCents)}</p>
    <p class="plan-meta">${plan.durationValue} ${plan.durationUnit === "HORA" ? (plan.durationValue > 1 ? "horas" : "hora") : "minutos"} · excedente ${money(plan.overageCentsPerMinute)}/min</p>
  </div>`;
}
function assetStatusLabel(status) {
  return { DISPONIVEL: "disponível", EM_USO: "em uso", REVISAO_OBRIGATORIA: "revisão obrigatória" }[status] || status;
}
function canSubmitCheckin(d) {
  return (
    d.childName.trim().length >= 2 &&
    d.birthDate &&
    d.guardianName.trim().length >= 2 &&
    d.guardianPhone.replace(/\D/g, "").length >= 10 &&
    d.planId &&
    (activityForUnit() !== "CARRINHO" || d.assetId)
  );
}
function checkinBlockReason(d) {
  if (activityForUnit() === "CARRINHO" && !d.assetId) return "Selecione um carrinho disponível.";
  if (!d.planId) return "Selecione um plano.";
  return "Preencha nome da criança, nascimento, responsável e WhatsApp.";
}
function selectAsset(assetId) {
  STATE.checkinDraft.assetId = assetId;
  render();
}
function selectPlan(planId) {
  STATE.checkinDraft.planId = planId;
  render();
}

// ── Autocomplete: atualização cirúrgica, sem re-render da tela inteira ──
// (a mesma lição do bug do campo de WhatsApp na rodada anterior: trocar
// o innerHTML da tela a cada tecla derruba o foco do input.)

function onCheckinFieldInput(field, value) {
  STATE.checkinDraft[field] = value;
  STATE.checkinDraft.childId = null; // qualquer edição manual invalida o match anterior
  updateMatchSuggestions();
}

function updateMatchSuggestions() {
  const box = document.getElementById("match-suggestions");
  if (!box) return;
  const d = STATE.checkinDraft;
  const nameQ = d.childName.trim().toLowerCase();
  const phoneQ = onlyDigits(d.guardianPhone);
  const cpfQ = onlyDigits(d.guardianCpf);

  if (nameQ.length < 3 && phoneQ.length < 4 && cpfQ.length < 4) {
    box.innerHTML = "";
    return;
  }

  const matches = STATE.children.filter((c) => {
    const byName = nameQ.length >= 3 && c.childName.toLowerCase().includes(nameQ);
    const byPhone = phoneQ.length >= 4 && onlyDigits(c.guardianPhone).includes(phoneQ);
    const byCpf = cpfQ.length >= 4 && onlyDigits(c.guardianCpf).includes(cpfQ);
    return byName || byPhone || byCpf;
  }).slice(0, 5);

  if (matches.length === 0) {
    box.innerHTML = "";
    return;
  }

  box.innerHTML = matches.map((c) => `
    <div class="suggestion-item" onclick="selectMatchedChild('${c.id}')">
      <strong>${escapeHtml(c.childName)} ${renderVisitBadge(c)}</strong>
      <span>Resp.: ${escapeHtml(c.guardianName)} · ${escapeHtml(c.guardianPhone)}</span>
    </div>
  `).join("");
}

function selectMatchedChild(childId) {
  const c = STATE.children.find((x) => x.id === childId);
  if (!c) return;
  const d = STATE.checkinDraft;
  d.childId = c.id;
  d.childName = c.childName;
  d.birthDate = c.birthDate;
  d.guardianName = c.guardianName;
  d.guardianPhone = c.guardianPhone;
  d.guardianCpf = c.guardianCpf;
  document.getElementById("match-suggestions").innerHTML = "";
  render();
}

// ── Cupom ──

function describeCouponEffect(coupon) {
  if (coupon.kind === "MINUTOS_EXTRA") return `${coupon.value} minutos extras`;
  if (coupon.kind === "DESCONTO_PCT") return `${coupon.value}% de desconto`;
  return `${money(coupon.value)} de desconto`;
}
function applyCouponToDraft() {
  const d = STATE.checkinDraft;
  const code = d.couponCode.trim().toUpperCase();
  const coupon = STATE.coupons.find((c) => c.code === code && c.active && c.usedCount < c.maxUses);
  if (!coupon) {
    toast("Cupom inválido, esgotado ou inativo");
    return;
  }
  d.couponApplied = coupon;
  toast(`Cupom ${coupon.code} aplicado`);
  render();
}

// ── Submissão ──

function findOrCreateChild(d) {
  if (d.childId) {
    const c = STATE.children.find((x) => x.id === d.childId);
    if (c) return c;
  }
  const existingByPhone = STATE.children.find((c) => onlyDigits(c.guardianPhone) === onlyDigits(d.guardianPhone) && c.childName.toLowerCase() === d.childName.trim().toLowerCase());
  if (existingByPhone) return existingByPhone;
  const child = {
    id: uid("child"),
    childName: d.childName.trim(),
    birthDate: d.birthDate,
    guardianName: d.guardianName.trim(),
    guardianPhone: d.guardianPhone,
    guardianCpf: d.guardianCpf,
    visitsByActivity: { PLAYGROUND: 0, CARRINHO: 0 },
    redeemableRewards: [], // [{ruleId, earnedAtMs}]
    visitLog: [], // [{activity, atMs}] — histórico para calcular frequência em janela móvel
  };
  STATE.children.push(child);
  return child;
}

function totalVisits(child) {
  return (child.visitsByActivity.PLAYGROUND || 0) + (child.visitsByActivity.CARRINHO || 0);
}

function findRedeemableReward(childId, activity) {
  const c = STATE.children.find((x) => x.id === childId);
  if (!c || c.redeemableRewards.length === 0) return null;
  const entry = c.redeemableRewards.find((r) => {
    const rule = STATE.loyaltyRules.find((ru) => ru.id === r.ruleId);
    return rule && (rule.activity === activity || rule.activity === "AMBOS");
  });
  if (!entry) return null;
  return STATE.loyaltyRules.find((r) => r.id === entry.ruleId);
}

function describeLoyaltyReward(rule) {
  if (rule.rewardKind === "ENTRADA_GRATIS") return "Entrada grátis";
  if (rule.rewardKind === "DESCONTO_PCT") return `${rule.rewardValue}% de desconto`;
  return `${rule.rewardValue} minutos extras`;
}

function registerVisitAndCheckLoyalty(child, activity) {
  child.visitsByActivity[activity] = (child.visitsByActivity[activity] || 0) + 1;
  child.visitLog.push({ activity, atMs: Date.now() });
  const visits = child.visitsByActivity[activity];
  for (const rule of STATE.loyaltyRules) {
    if (rule.activity !== activity && rule.activity !== "AMBOS") continue;
    if (rule.triggerVisits > 0 && visits % rule.triggerVisits === 0) {
      child.redeemableRewards.push({ ruleId: rule.id, earnedAtMs: Date.now() });
      toast(`🎉 ${child.childName} atingiu ${visits} visitas — ${describeLoyaltyReward(rule)} disponível`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// Frequência de visitante — selo mostrado na Entrada.
//
// Categorias (a pedido: "acima de 3 visitas em 2 meses, pisca em
// vermelho" — as demais foram antecipadas para dar uma progressão
// coerente, não só o gatilho pedido):
//
//   NOVA        primeira visita — sem selo (nada a mostrar ainda)
//   RECORRENTE  2ª+ visita, mas ≤3 nos últimos 2 meses — selo neutro
//   FREQUENTE   >3 visitas nos últimos 2 meses — selo VERMELHO piscando
//               (pedido explícito: chama atenção do operador)
//   VIP         >8 visitas nos últimos 2 meses — selo dourado, sem
//               piscar (frequência tão alta que já não é "alerta",
//               é reconhecimento — tratamento visual deliberadamente
//               diferente do FREQUENTE)
//
// Os limiares (3, 8) e a janela (60 dias ~ 2 meses) estão fixos no
// código por ora. Se a operação quiser ajustá-los sem depender de
// código, é natural migrar isso para Configurações > Fidelidade — a
// mesma tela que já configura as regras de recompensa.
// ═══════════════════════════════════════════════════════════════════

const FREQUENCY_WINDOW_MS = 60 * 24 * 60 * 60 * 1000; // ~2 meses
const FREQUENCY_TIER_FREQUENTE = 3;
const FREQUENCY_TIER_VIP = 8;

function visitTier(child) {
  const total = totalVisits(child);
  if (total === 0) return null;
  const recentVisits = child.visitLog.filter((v) => Date.now() - v.atMs <= FREQUENCY_WINDOW_MS).length;
  if (recentVisits > FREQUENCY_TIER_VIP) return { tier: "VIP", label: `VIP — ${total} visitas`, blink: false };
  if (recentVisits > FREQUENCY_TIER_FREQUENTE) return { tier: "FREQUENTE", label: `${total} visitas`, blink: true };
  return { tier: "RECORRENTE", label: `${total} visita${total > 1 ? "s" : ""}`, blink: false };
}

function renderVisitBadge(child) {
  const t = visitTier(child);
  if (!t) return "";
  if (t.tier === "VIP") return `<span class="vip-badge">⭐ ${escapeHtml(t.label)}</span>`;
  if (t.tier === "FREQUENTE") return `<span class="status-badge blinking" data-phase="VERMELHO">🔁 ${escapeHtml(t.label)}</span>`;
  return `<span class="status-badge" data-phase="VERDE" style="background:var(--color-gray-300);color:#fff">${escapeHtml(t.label)}</span>`;
}

function submitCheckin() {
  const d = STATE.checkinDraft;
  if (!canSubmitCheckin(d)) return;
  const us = unitState();
  const activity = activityForUnit();
  const now = Date.now();

  const child = findOrCreateChild(d);
  const usedReward = d.applyLoyaltyReward ? findRedeemableReward(child.id, activity) : null;
  if (usedReward) {
    const idx = child.redeemableRewards.findIndex((r) => r.ruleId === usedReward.id);
    if (idx !== -1) child.redeemableRewards.splice(idx, 1);
  }

  const ticketNumber = ++us.ticketCounter;
  const session = {
    id: uid("sess"),
    childId: child.id,
    childName: d.childName,
    birthDate: d.birthDate,
    guardianName: d.guardianName,
    guardianPhone: d.guardianPhone,
    guardianCpf: d.guardianCpf,
    activity,
    assetId: d.assetId,
    planId: d.planId,
    planHistory: [],
    checkinAtMs: now,
    status: "ATIVA",
    ticketNumber,
    couponId: d.couponApplied ? d.couponApplied.id : null,
    couponCode: d.couponApplied ? d.couponApplied.code : null,
    couponDiscountCents: couponDiscountCentsFor(d.couponApplied, findPlan(activity, d.planId)),
    freeFromLoyalty: Boolean(usedReward),
  };
  us.sessions.push(session);

  if (d.couponApplied) d.couponApplied.usedCount++;

  registerVisitAndCheckLoyalty(child, activity);

  if (activity === "CARRINHO") {
    const asset = us.assets.find((a) => a.id === d.assetId);
    asset.status = "EM_USO";
    asset.sessionId = session.id;
  }

  showPrintPreview(us, session);
  STATE.checkinDraft = makeCheckinDraft(STATE.currentUnit);
  toast(`Entrada registrada — ticket #${ticketNumber}`);
}

function couponDiscountCentsFor(coupon, plan) {
  if (!coupon || !plan) return 0;
  if (coupon.kind === "DESCONTO_FIXO") return coupon.value;
  if (coupon.kind === "DESCONTO_PCT") return Math.round((plan.valueCents * coupon.value) / 100);
  if (coupon.kind === "MINUTOS_EXTRA") return Math.round((coupon.value * plan.overageCentsPerMinute));
  return 0;
}

function showPrintPreview(us, session) {
  const plan = findPlan(session.activity, session.planId);
  const lines = [
    `╔════════════════════════════╗`,
    `  ENTRADA — FaçaAmigos — #${session.ticketNumber}`,
    `  ${session.childName}`,
    `  Responsável: ${session.guardianName}`,
    `  WhatsApp: ${session.guardianPhone}`,
    `  Plano: ${plan.name} — ${money(plan.valueCents)}`,
    `  Horário: ${fmtTime(session.checkinAtMs)}`,
    `╚════════════════════════════╝`,
  ];
  if (session.couponCode) lines.push(`  Cupom aplicado: ${session.couponCode}`);
  if (session.freeFromLoyalty) lines.push(`  Cortesia de fidelidade aplicada`);
  if (session.activity === "CARRINHO" && us.termsText.trim()) lines.push("", "TERMOS DE USO DO CARRINHO:", us.termsText.trim());
  const receipt = lines.join("\n");

  openModal(`
    <h2>Impressão simulada</h2>
    <p class="desc">Em produção isso vira um print_job real na térmica. Aqui é só uma prévia.</p>
    <div class="print-preview">${escapeHtml(receipt)}</div>
    <div class="actions"><button class="btn btn-primary" onclick="closeModal()">Fechar</button></div>
  `);
}

// ═══════════════════════════════════════════════════════════════════
// TELA — Painel
// ═══════════════════════════════════════════════════════════════════

function renderDashboard() {
  const us = unitState();
  const now = Date.now();
  const active = us.sessions.filter((s) => s.status === "ATIVA");

  const body =
    STATE.currentUnit === "QUIOSQUE"
      ? `<h1>Painel da frota</h1><p class="lede">Isolamento visual: esta tela só existe no Quiosque.</p><div class="grid-auto">${us.assets.map((a) => renderAssetCard(us, a, now)).join("")}</div>`
      : `<h1>Painel do parque</h1><p class="lede">Isolamento visual: esta tela só existe na Loja.</p>${
          active.length === 0
            ? `<div class="empty-state"><span class="emoji">🧸</span>Nenhuma criança no playground agora.</div>`
            : `<div class="grid-auto">${active.map((s) => renderSessionCard(us, s, now)).join("")}</div>`
        }`;

  return body + renderFloatingBar();
}
function renderFloatingBar() {
  if (STATE.selection.length === 0) return "";
  return `<div class="floating-bar">
    <span>${STATE.selection.length} selecionado(s)</span>
    <button class="btn btn-teal btn-sm" onclick="openCloseModal([...STATE.selection])">Fechar seleção</button>
    <button class="btn btn-ghost btn-sm" style="color:#fff" onclick="clearSelection()">Cancelar</button>
  </div>`;
}
function toggleSelection(sessionId) {
  const idx = STATE.selection.indexOf(sessionId);
  if (idx === -1) STATE.selection.push(sessionId);
  else STATE.selection.splice(idx, 1);
  render();
}
function clearSelection() {
  STATE.selection = [];
  render();
}

function renderAssetCard(us, asset, now) {
  const session = asset.sessionId ? us.sessions.find((s) => s.id === asset.sessionId && s.status === "ATIVA") : null;
  const selected = session && STATE.selection.includes(session.id);
  let inner;
  let blinking = false;

  if (session) {
    const q = quoteForSession(session, now);
    blinking = q.timing.phase === "EXCEDENTE";
    inner = `
      <p class="meta" style="margin:0 0 6px">${escapeHtml(session.childName)}</p>
      <div class="timer">${formatElapsed(q.timing.elapsedMs)}</div>
      <span class="status-badge" data-phase="${q.timing.phase}">${phaseLabel(q.timing.phase)}</span>
      <p class="live-total">${money(q.totalCents)}</p>
      <button class="btn btn-ghost btn-sm" style="border:1px solid var(--border-subtle);margin-top:6px" onclick="event.stopPropagation();openPlanChangeModal('${session.id}')">Trocar plano</button>
    `;
  } else if (asset.status === "REVISAO_OBRIGATORIA") {
    inner = `<p class="meta" style="margin:0 0 6px">Fora de operação</p><span class="status-badge" data-phase="AMARELO">revisão obrigatória</span><p class="hint" style="margin-top:6px">${Math.round(asset.totalUsedMinutes / 60)}h de uso acumuladas</p>`;
  } else {
    inner = `<span class="status-badge" data-phase="VERDE" style="background:var(--color-gray-300);color:#fff">disponível</span>`;
  }

  return `<div class="asset-card ${blinking ? "blinking" : ""}" data-status="${asset.status}" ${session ? `onclick="toggleSelection('${session.id}')"` : ""} style="${session ? "cursor:pointer" : ""}">
    <div class="photo" style="background:${session || asset.status === "REVISAO_OBRIGATORIA" ? "" : asset.color + "22"}">${asset.emoji}</div>
    <div class="body">
      <p class="name">${escapeHtml(asset.name)} ${selected ? "✅" : ""}</p>
      ${inner}
    </div>
  </div>`;
}

function renderSessionCard(us, session, now) {
  const q = quoteForSession(session, now);
  const selected = STATE.selection.includes(session.id);
  return `<div class="session-card selectable ${selected ? "selected" : ""} ${q.timing.phase === "EXCEDENTE" ? "blinking" : ""}" data-phase="${q.timing.phase}" onclick="toggleSelection('${session.id}')">
    <div class="select-mark">✓</div>
    <p class="child-name">${escapeHtml(session.childName)}</p>
    <p class="meta">${escapeHtml(q.plan.name)} · resp. ${escapeHtml(session.guardianName)}</p>
    <div class="timer">${formatElapsed(q.timing.elapsedMs)}</div>
    <span class="status-badge" data-phase="${q.timing.phase}">${phaseLabel(q.timing.phase)}</span>
    <p class="live-total">${money(q.totalCents)}</p>
    <button class="btn btn-ghost btn-sm" style="border:1px solid var(--border-subtle);margin-top:6px" onclick="event.stopPropagation();openPlanChangeModal('${session.id}')">Trocar plano</button>
  </div>`;
}
function phaseLabel(phase) {
  return { VERDE: "● no plano", AMARELO: "◆ perto do teto", EXCEDENTE: "✕ excedente" }[phase] || phase;
}

// ── Troca de plano em sessão ativa ──

function openPlanChangeModal(sessionId) {
  const us = unitState();
  const session = us.sessions.find((s) => s.id === sessionId);
  if (!session) return;
  const now = Date.now();
  const currentQuote = quoteForSession(session, now);
  const options = STATE.plans[session.activity].filter((p) => p.id !== session.planId);

  openModal(`
    <h2>Trocar plano — ${escapeHtml(session.childName)}</h2>
    <p class="desc">Plano atual: <strong>${escapeHtml(currentQuote.plan.name)}</strong> — valor a pagar agora: <strong>${money(currentQuote.totalCents)}</strong>. Escolha o novo plano; o valor recalcula automaticamente pelo tempo já decorrido.</p>
    ${options.length === 0 ? '<p class="hint">Não há outro plano cadastrado para esta atividade.</p>' : options.map((p) => {
      const preview = quoteForSession({ ...session, planId: p.id }, now);
      return `<div class="plan-change-option" onclick="confirmPlanChange('${session.id}', '${p.id}')">
        <span>${escapeHtml(p.name)}</span>
        <span class="arrow-total">${money(preview.totalCents)}</span>
      </div>`;
    }).join("")}
    <div class="actions"><button class="btn btn-secondary" onclick="closeModal()">Cancelar</button></div>
  `);
}

function confirmPlanChange(sessionId, newPlanId) {
  const us = unitState();
  const session = us.sessions.find((s) => s.id === sessionId);
  const oldPlan = findPlan(session.activity, session.planId);
  const newPlan = findPlan(session.activity, newPlanId);
  closeModal();
  confirmAction({
    title: "Confirmar troca de plano",
    description: `Trocar de <strong>${escapeHtml(oldPlan.name)}</strong> para <strong>${escapeHtml(newPlan.name)}</strong>? O valor a pagar passa a ser calculado pelo novo plano a partir de agora.`,
    confirmLabel: "Trocar plano",
    onConfirm: () => {
      session.planHistory.push({ fromPlanId: session.planId, toPlanId: newPlanId, atMs: Date.now() });
      session.planId = newPlanId;
      toast(`Plano trocado para ${newPlan.name}`);
      render();
    },
  });
}

// ═══════════════════════════════════════════════════════════════════
// Popup de Saída
// ═══════════════════════════════════════════════════════════════════

function openCloseModal(sessionIds) {
  STATE.closeModal = { unit: unitState(), sessionIds, cart: [], method: null, cash: "", tef: { status: "idle" } };
  refreshCloseModal();
}
function refreshCloseModal() {
  document.getElementById("modal-root").innerHTML = renderCloseModalHtml();
}
function renderCloseModalHtml() {
  const cm = STATE.closeModal;
  const now = Date.now();
  const sessions = cm.sessionIds.map((id) => cm.unit.sessions.find((s) => s.id === id)).filter(Boolean);
  const quotes = sessions.map((s) => quoteForSession(s, now));
  const sessionsTotal = quotes.reduce((sum, q) => sum + q.totalCents, 0);
  const cartTotal = cm.cart.reduce((sum, p) => sum + p.price, 0);
  const grandTotal = sessionsTotal + cartTotal;

  const received = Math.round(parseFloat(cm.cash || "0") * 100) || 0;
  const change = cm.method === "DINHEIRO" ? Math.max(0, received - grandTotal) : 0;
  const canFinalize = cm.method === "DINHEIRO" ? received >= grandTotal : Boolean(cm.method);

  const tefOverlay =
    cm.tef.status === "idle"
      ? ""
      : `<div class="tef-overlay ${cm.tef.status}">
          ${cm.tef.status === "sending" ? `<div class="tef-spinner"></div><p><strong>Enviando ${money(grandTotal)} para a maquininha…</strong></p><p style="font-size:13px;opacity:0.75">Aguardando confirmação do pinpad. Não feche esta tela.</p>` : ""}
          ${cm.tef.status === "approved" ? `<p style="font-size:40px">✅</p><p><strong>Pagamento aprovado</strong></p><p style="font-size:13px;opacity:0.75">Saída liberada.</p><button class="btn btn-primary" onclick="confirmFinalizeClose()">Concluir saída</button>` : ""}
          ${cm.tef.status === "declined" ? `<p style="font-size:40px">❌</p><p><strong>Pagamento recusado pela maquininha</strong></p><button class="btn btn-secondary" onclick="resetTef()">Tentar novamente</button>` : ""}
        </div>`;

  return `<div class="modal-backdrop"><div class="modal" style="max-width:560px;position:relative">
    ${tefOverlay}
    <h2>Saída — ${sessions.length === 1 ? escapeHtml(sessions[0].childName) : `${sessions.length} crianças`}</h2>
    <p class="desc">${sessions.map((s) => escapeHtml(s.childName)).join(", ")}</p>

    ${quotes.map((q, i) => `
      <div class="close-line">
        <div><span class="who">${escapeHtml(sessions[i].childName)}</span><br/><span class="sub">${escapeHtml(q.plan.name)} · ${formatElapsed(q.timing.elapsedMs)} decorridos</span></div>
        <strong>${money(q.totalCents)}</strong>
      </div>
    `).join("")}

    <div style="margin:var(--space-4) 0">
      <p class="hint" style="margin-bottom:6px">Adicionar produto (opcional)</p>
      <div class="grid-3" style="gap:6px">
        ${STATE.products.filter((p) => p.stock > 0).map((p) => `<div class="activity-card" style="padding:8px" onclick="addToCloseCart('${p.id}')"><span class="emoji" style="font-size:18px">${p.emoji}</span><span class="name" style="font-size:11px">${escapeHtml(p.name)}</span></div>`).join("")}
      </div>
      ${cm.cart.length > 0 ? cm.cart.map((c) => `<div class="cart-line"><span>${escapeHtml(c.name)}</span><span>${money(c.price)}</span></div>`).join("") : ""}
    </div>

    <div class="quote-line total"><span>Total</span><span id="close-grand-total">${money(grandTotal)}</span></div>

    <p class="hint" style="margin:var(--space-3) 0 6px">Forma de pagamento</p>
    <div class="payment-methods">
      ${["DINHEIRO", "PIX", "CREDITO", "DEBITO"].map((m) => `<button class="${cm.method === m ? "selected" : ""}" onclick="selectCloseMethod('${m}')">${m}</button>`).join("")}
    </div>

    ${cm.method === "DINHEIRO" ? `
      <div class="field" style="max-width:260px">
        <label>Valor recebido</label>
        <input type="number" step="0.01" value="${cm.cash}" oninput="updateCloseCash(this.value, ${grandTotal})" />
      </div>
      <p class="hint">Troco: <strong id="close-change">${money(change)}</strong></p>
    ` : ""}

    <div class="actions">
      <button class="btn btn-secondary" onclick="closeCloseModal()">Cancelar</button>
      <button class="btn btn-primary" ${canFinalize ? "" : "disabled"} onclick="startCloseFinalize(${grandTotal})">
        ${cm.method === "CREDITO" || cm.method === "DEBITO" ? "Cobrar na maquininha" : "Finalizar saída"}
      </button>
    </div>
    ${
      cm.method === "CREDITO" || cm.method === "DEBITO"
        ? `<p style="text-align:center;margin-top:10px"><a href="#" style="font-size:12px;color:var(--text-muted)" onclick="event.preventDefault();simulateTefDecline()">(teste) simular recusa da maquininha</a></p>`
        : ""
    }
  </div></div>`;
}
function addToCloseCart(productId) {
  const p = STATE.products.find((x) => x.id === productId);
  STATE.closeModal.cart.push(p);
  refreshCloseModal();
}
function selectCloseMethod(method) {
  STATE.closeModal.method = method;
  refreshCloseModal();
}
function updateCloseCash(value, grandTotal) {
  STATE.closeModal.cash = value;
  const received = Math.round(parseFloat(value || "0") * 100) || 0;
  const change = Math.max(0, received - grandTotal);
  const el = document.getElementById("close-change");
  if (el) el.textContent = money(change);
  const finalizeBtn = document.querySelector(".modal .actions .btn-primary");
  if (finalizeBtn) finalizeBtn.disabled = received < grandTotal;
}
function closeCloseModal() {
  STATE.closeModal = null;
  document.getElementById("modal-root").innerHTML = "";
}
function startCloseFinalize(grandTotal) {
  const cm = STATE.closeModal;
  if (cm.method === "DINHEIRO" || cm.method === "PIX") {
    finalizeCloseSessions(grandTotal);
    return;
  }
  cm.tef.status = "sending";
  refreshCloseModal();
  setTimeout(() => {
    cm.tef.status = "approved";
    cm.tef.grandTotal = grandTotal;
    refreshCloseModal();
  }, 1800);
}
function simulateTefDecline() {
  const cm = STATE.closeModal;
  cm.tef.status = "sending";
  refreshCloseModal();
  setTimeout(() => {
    cm.tef.status = "declined";
    refreshCloseModal();
  }, 1200);
}
function resetTef() {
  STATE.closeModal.tef = { status: "idle" };
  refreshCloseModal();
}
function confirmFinalizeClose() {
  finalizeCloseSessions(STATE.closeModal.tef.grandTotal);
}
function finalizeCloseSessions(grandTotal) {
  const cm = STATE.closeModal;
  const us = cm.unit;
  const now = Date.now();
  const transactionId = uid("tx");
  const childNames = [];

  for (const sessionId of cm.sessionIds) {
    const session = us.sessions.find((s) => s.id === sessionId);
    if (!session || session.status !== "ATIVA") continue;
    const q = quoteForSession(session, now);
    session.status = "FINALIZADA";
    session.checkoutAtMs = now;
    childNames.push(session.childName);

    if (session.activity === "CARRINHO") {
      const asset = us.assets.find((a) => a.id === session.assetId);
      asset.totalUsedMinutes += Math.ceil(q.timing.elapsedMs / 60000);
      const thresholdMinutes = us.maintenanceThresholdHours * 60;
      asset.status = asset.totalUsedMinutes >= thresholdMinutes ? "REVISAO_OBRIGATORIA" : "DISPONIVEL";
      asset.sessionId = null;
      if (asset.status === "REVISAO_OBRIGATORIA") toast(`${asset.name} atingiu ${us.maintenanceThresholdHours}h — revisão obrigatória`);
    }
  }

  for (const p of cm.cart) {
    const product = STATE.products.find((x) => x.id === p.id);
    if (product) product.stock = Math.max(0, product.stock - 1);
  }

  ensureShiftOpen(us);
  us.shift.orders.push({ id: transactionId, totalCents: grandTotal, method: cm.method, at: now, label: childNames.join(", ") || "Saída" });
  if (cm.method === "DINHEIRO") logDrawerOpen(us, transactionId, "SAÍDA — pagamento em dinheiro");
  // Métrica de cross-sell (rodapé "Meta do Dia"): conta o atendimento
  // (fechamento de sessão) e se ele incluiu produto adicional.
  us.shift.attendanceCount++;
  if (cm.cart.length > 0) us.shift.attendanceWithCrossSellCount++;

  STATE.selection = STATE.selection.filter((id) => !cm.sessionIds.includes(id));
  STATE.closeModal = null;
  document.getElementById("modal-root").innerHTML = "";
  toast(`Saída concluída — ${money(grandTotal)} via ${cm.method}`);
  render();
}

// ═══════════════════════════════════════════════════════════════════
// TELA — PDV
// ═══════════════════════════════════════════════════════════════════

/**
 * Rodapé de metas (gamificação leve): meta do dia e taxa de cross-sell,
 * sempre visível durante a operação, sem exigir nenhuma ação do
 * operador — a ideia é condicionar a oferta de produto adicional a
 * cada atendimento sem o gerente precisar cobrar isso na mão. A meta
 * em si (dailyGoalCents) é editável em Configurações > Unidade — não
 * aqui, para não misturar "ver o placar" com "configurar o placar".
 */
function renderGoalFooter(us) {
  if (!us.shift) return "";
  const totalToday = us.shift.orders.reduce((s, o) => s + o.totalCents, 0);
  const goal = us.dailyGoalCents || 0;
  const goalPct = goal > 0 ? Math.min(100, Math.round((totalToday / goal) * 100)) : 0;
  const crossSellPct = us.shift.attendanceCount > 0 ? Math.round((us.shift.attendanceWithCrossSellCount / us.shift.attendanceCount) * 100) : 0;
  return `
    <div class="goal-footer">
      <div class="goal-item">
        <div class="goal-label"><span>Meta do dia</span><span>${money(totalToday)} / ${money(goal)}</span></div>
        <div class="goal-bar"><div class="goal-bar-fill ${goalPct >= 100 ? "over" : ""}" style="width:${goalPct}%"></div></div>
      </div>
      <div class="goal-item">
        <div class="goal-label"><span>Cross-sell (produtos por atendimento)</span><span>${crossSellPct}% (${us.shift.attendanceWithCrossSellCount}/${us.shift.attendanceCount})</span></div>
        <div class="goal-bar"><div class="goal-bar-fill" style="width:${crossSellPct}%"></div></div>
      </div>
    </div>
  `;
}

function renderPdv() {
  const total = STATE.pdvCart.reduce((s, p) => s + p.price, 0);
  return `
    <h1>PDV — venda avulsa</h1>
    <div class="grid-2">
      <div class="panel">
        <div class="grid-3" style="gap:10px">
          ${STATE.products.map((p) => `<div class="activity-card product-card ${p.stock <= 0 ? "out-of-stock" : ""}" ${p.stock > 0 ? `onclick="addToPdvCart('${p.id}')"` : ""}><span class="emoji">${p.emoji}</span><span class="name">${escapeHtml(p.name)}</span><div class="price">${money(p.price)}</div><div class="hint">${p.stock > 0 ? `${p.stock} em estoque` : "sem estoque"}</div></div>`).join("")}
        </div>
      </div>
      <div class="panel">
        <h2 style="margin-top:0;font-family:var(--font-display);font-weight:400;font-size:var(--text-md);color:var(--color-dark)">Comanda</h2>
        ${STATE.pdvCart.length === 0 ? '<p class="hint">Nenhum item ainda.</p>' : STATE.pdvCart.map((p, i) => `<div class="cart-line"><span>${escapeHtml(p.name)}</span><span>${money(p.price)} <button class="btn btn-ghost btn-sm" onclick="removeFromPdvCart(${i})">✕</button></span></div>`).join("")}
        <div class="quote-line total"><span>Total</span><span>${money(total)}</span></div>

        <p class="hint" style="margin:var(--space-3) 0 6px">Forma de pagamento</p>
        <div class="payment-methods">
          ${["DINHEIRO", "PIX", "CREDITO", "DEBITO"].map((m) => `<button class="${STATE.pdvMethod === m ? "selected" : ""}" onclick="STATE.pdvMethod='${m}';render()">${m}</button>`).join("")}
        </div>

        <button class="btn btn-primary btn-block" style="margin-top:12px" ${STATE.pdvCart.length === 0 || !STATE.pdvMethod ? "disabled" : ""} onclick="finalizePdvSale(${total})">Finalizar venda</button>
      </div>
    </div>
    ${renderGoalFooter(unitState())}
  `;
}
function addToPdvCart(productId) {
  const p = STATE.products.find((x) => x.id === productId);
  if (!p || p.stock <= 0) return;
  STATE.pdvCart.push(p);
  render();
}
function removeFromPdvCart(index) {
  STATE.pdvCart.splice(index, 1);
  render();
}
function finalizePdvSale(total) {
  const us = unitState();
  ensureShiftOpen(us);
  const transactionId = uid("tx");
  us.shift.orders.push({ id: transactionId, totalCents: total, method: STATE.pdvMethod, at: Date.now(), label: "Venda avulsa (PDV)" });
  if (STATE.pdvMethod === "DINHEIRO") logDrawerOpen(us, transactionId, "PDV — venda avulsa em dinheiro");
  for (const p of STATE.pdvCart) {
    const product = STATE.products.find((x) => x.id === p.id);
    if (product) product.stock = Math.max(0, product.stock - 1);
  }
  STATE.pdvCart = [];
  STATE.pdvMethod = null;
  toast(`Venda avulsa registrada — ${money(total)}`);
  render();
}

// ═══════════════════════════════════════════════════════════════════
// TELA — Caixa
// ═══════════════════════════════════════════════════════════════════

function ensureShiftOpen(us) {
  if (!us.shift || us.shift.status !== "ABERTO") {
    us.shift = { openedAtMs: Date.now(), openingFloatCents: 0, movements: [], orders: us.shift ? us.shift.orders : [], drawerLog: us.shift ? us.shift.drawerLog : [], status: "ABERTO", attendanceCount: 0, attendanceWithCrossSellCount: 0 };
  }
}
function logDrawerOpen(us, transactionId, reason) {
  ensureShiftOpen(us);
  us.shift.drawerLog.push({ transactionId, atMs: Date.now(), reason });
}
function computeMethodTotals(shift) {
  const totals = { DINHEIRO: shift.openingFloatCents, PIX: 0, CREDITO: 0, DEBITO: 0 };
  for (const o of shift.orders) totals[o.method] = (totals[o.method] || 0) + o.totalCents;
  for (const m of shift.movements) {
    if (m.kind === "SANGRIA") totals.DINHEIRO -= m.amountCents;
    if (m.kind === "SUPRIMENTO") totals.DINHEIRO += m.amountCents;
  }
  return totals;
}

function renderCaixa() {
  const us = unitState();
  const shift = us.shift;

  if (!shift) {
    return `
      <h1>Caixa</h1>
      <p class="lede">Não há turno aberto${STATE.currentUnit === "QUIOSQUE" ? " no Quiosque" : " na Loja"}. Cada ponto tem turno e fechamento próprios.</p>
      <div class="panel" style="max-width:360px">
        <div class="field"><label>Troco inicial</label><input type="number" step="0.01" id="opening-float" placeholder="0,00" /></div>
        <button class="btn btn-primary btn-block" onclick="openShift()">Abrir turno</button>
      </div>
    `;
  }
  if (shift.status === "FECHADO") return renderShiftClosed(shift);

  const totals = computeMethodTotals(shift);
  const totalDia = shift.orders.reduce((sum, o) => sum + o.totalCents, 0);

  return `
    <h1>Caixa — turno aberto</h1>
    <p class="lede">Aberto às ${fmtTime(shift.openedAtMs)} · ${shift.orders.length} venda(s). Faturamento visível o tempo todo — o fechamento não é cego.</p>

    <div class="method-stats">
      <div class="method-stat"><div class="label">Dinheiro (em caixa)</div><div class="value">${money(totals.DINHEIRO)}</div></div>
      <div class="method-stat"><div class="label">PIX</div><div class="value">${money(totals.PIX)}</div></div>
      <div class="method-stat"><div class="label">Crédito</div><div class="value">${money(totals.CREDITO)}</div></div>
      <div class="method-stat"><div class="label">Débito</div><div class="value">${money(totals.DEBITO)}</div></div>
    </div>
    <p class="hint" style="margin:-10px 0 20px">Faturamento do dia: <strong>${money(totalDia)}</strong></p>

    <div class="grid-2">
      <div class="panel">
        <h2 style="margin-top:0;font-family:var(--font-display);font-weight:400;font-size:var(--text-md);color:var(--color-dark)">Movimentos</h2>
        <div style="display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap">
          <button class="btn btn-secondary btn-sm" onclick="openCashMovementModal('SANGRIA')">Sangria</button>
          <button class="btn btn-secondary btn-sm" onclick="openCashMovementModal('SUPRIMENTO')">Suprimento</button>
          <button class="btn btn-ghost btn-sm" style="border:1px solid var(--border-subtle)" onclick="openDrawerOpenModal()">Abrir gaveta (sem venda)</button>
        </div>
        ${shift.movements.length === 0 ? '<p class="hint">Nenhum movimento ainda.</p>' : shift.movements.map((m) => `<div class="cart-line"><span>${m.kind === "SANGRIA" ? "🔻" : "🔺"} ${m.kind} — ${escapeHtml(m.reason)}</span><span>${money(m.amountCents)}</span></div>`).join("")}

        <h2 style="font-family:var(--font-display);font-weight:400;font-size:var(--text-md);color:var(--color-dark)">Log de abertura de gaveta</h2>
        <p class="hint" style="margin-top:-8px">ID da transação + horário exato — cruze com o CFTV em caso de divergência.</p>
        ${
          shift.drawerLog.length === 0
            ? '<p class="hint">Nenhuma abertura registrada.</p>'
            : `<table class="drawer-log-table"><thead><tr><th>Horário</th><th>Transação</th><th>Motivo</th></tr></thead><tbody>
                ${[...shift.drawerLog].reverse().map((l) => `<tr><td>${fmtTime(l.atMs)}</td><td class="mono">${l.transactionId || "—"}</td><td>${escapeHtml(l.reason)}</td></tr>`).join("")}
               </tbody></table>`
        }
      </div>

      <div class="panel">
        <h2 style="margin-top:0;font-family:var(--font-display);font-weight:400;font-size:var(--text-md);color:var(--color-dark)">Fechamento</h2>
        <p class="hint" style="margin-bottom:var(--space-4)">O valor esperado já está visível acima. Confira o dinheiro contado fisicamente e registre — sem etapa oculta.</p>
        <div class="field"><label>Dinheiro contado</label><input type="number" step="0.01" id="counted-DINHEIRO" placeholder="${(totals.DINHEIRO / 100).toFixed(2)}" /></div>
        <button class="btn btn-primary btn-block" onclick="closeShift()">Fechar turno</button>
      </div>
    </div>
    ${renderGoalFooter(us)}
  `;
}
function openShift() {
  const us = unitState();
  const val = Math.round(parseFloat(document.getElementById("opening-float").value || "0") * 100);
  us.shift = { openedAtMs: Date.now(), openingFloatCents: val, movements: [], orders: [], drawerLog: [], status: "ABERTO", attendanceCount: 0, attendanceWithCrossSellCount: 0 };
  render();
}
const REASON_PRESETS = {
  SANGRIA: ["Depósito no cofre", "Pagamento a fornecedor", "Retirada para banco"],
  SUPRIMENTO: ["Reforço de troco", "Troco inicial extra"],
  DRAWER: ["Troco para cliente", "Conferência de caixa"],
};

function openCashMovementModal(kind) {
  openModal(`
    <h2>${kind === "SANGRIA" ? "Sangria (retirada)" : "Suprimento (entrada de troco)"}</h2>
    <div class="field"><label>Valor</label><input type="number" step="0.01" id="mov-amount" placeholder="0,00" /></div>
    <div class="field">
      <label>Motivo</label>
      <div class="reason-chips">${REASON_PRESETS[kind].map((r) => `<button type="button" onclick="document.getElementById('mov-reason').value='${escapeHtml(r)}'">${escapeHtml(r)}</button>`).join("")}</div>
      <input type="text" id="mov-reason" placeholder="Ou digite outro motivo" />
    </div>
    <div class="actions">
      <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="confirmCashMovement('${kind}')">Confirmar</button>
    </div>
  `);
}
function confirmCashMovement(kind) {
  const amount = Math.round(parseFloat(document.getElementById("mov-amount").value || "0") * 100);
  const reason = document.getElementById("mov-reason").value.trim() || "(sem motivo informado)";
  if (amount <= 0) { toast("Informe um valor maior que zero"); return; }
  const us = unitState();
  const transactionId = uid("tx");
  us.shift.movements.push({ id: transactionId, kind, amountCents: amount, reason, at: Date.now() });
  logDrawerOpen(us, transactionId, `${kind} — ${reason}`);
  closeModal();
  render();
}
function openDrawerOpenModal() {
  openModal(`
    <h2>Abrir gaveta sem venda</h2>
    <p class="desc">Fica registrado no log com horário exato, para cruzar com o CFTV se precisar.</p>
    <div class="field">
      <label>Motivo</label>
      <div class="reason-chips">${REASON_PRESETS.DRAWER.map((r) => `<button type="button" onclick="document.getElementById('drawer-reason').value='${escapeHtml(r)}'">${escapeHtml(r)}</button>`).join("")}</div>
      <input type="text" id="drawer-reason" placeholder="Ou digite outro motivo" />
    </div>
    <div class="actions">
      <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="confirmDrawerOpen()">Registrar abertura</button>
    </div>
  `);
}
function confirmDrawerOpen() {
  const reason = document.getElementById("drawer-reason").value.trim() || "(sem motivo informado)";
  logDrawerOpen(unitState(), null, `Abertura manual — ${reason}`);
  closeModal();
  toast("Abertura de gaveta registrada");
  render();
}
function closeShift() {
  const us = unitState();
  const shift = us.shift;
  const totals = computeMethodTotals(shift);
  const counted = Math.round(parseFloat(document.getElementById("counted-DINHEIRO").value || "0") * 100);
  const diff = counted ? counted - totals.DINHEIRO : 0;
  shift.status = "FECHADO";
  shift.closedAtMs = Date.now();
  shift.countedCash = counted || totals.DINHEIRO;
  shift.diffCash = diff;
  us.shiftHistory.push(shift);
  render();
}
function startNewShift() {
  unitState().shift = null;
  render();
}
function renderShiftClosed(shift) {
  const totals = computeMethodTotals(shift);
  const expectedCash = shift.countedCash - shift.diffCash;
  const diffClass = shift.diffCash === 0 ? "diff-zero" : shift.diffCash > 0 ? "diff-pos" : "diff-neg";
  return `
    <h1>Turno fechado</h1>
    <p class="lede">Fechado às ${fmtTime(shift.closedAtMs)}.</p>
    <div class="panel">
      <table class="diff-table">
        <thead><tr><th>Método</th><th>Total</th></tr></thead>
        <tbody>
          <tr><td>PIX</td><td>${money(totals.PIX)}</td></tr>
          <tr><td>Crédito</td><td>${money(totals.CREDITO)}</td></tr>
          <tr><td>Débito</td><td>${money(totals.DEBITO)}</td></tr>
          <tr><td>Dinheiro esperado</td><td>${money(expectedCash)}</td></tr>
          <tr><td>Dinheiro contado</td><td>${money(shift.countedCash)}</td></tr>
          <tr><td>Diferença</td><td class="${diffClass}">${shift.diffCash >= 0 ? "+" : ""}${money(shift.diffCash)}</td></tr>
        </tbody>
      </table>
      <button class="btn btn-secondary" style="margin-top:16px" onclick="startNewShift()">Abrir novo turno</button>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════════
// TELA — Configurações (sub-abas por unidade)
// ═══════════════════════════════════════════════════════════════════

function configTabsFor(unit) {
  const base = [
    { id: "planos", label: "Planos de Preço" },
    ...(unit === "QUIOSQUE" ? [{ id: "frota", label: "Frota" }] : []),
    { id: "cupons", label: "Cupom de Desconto" },
    { id: "fidelidade", label: "Fidelidade" },
    { id: "colaboradores", label: "Colaboradores" },
    { id: "caixa-relatorio", label: "Movimentação de Caixa" },
    { id: "produtos", label: "Produtos" },
    { id: "unidade", label: "Unidade" },
  ];
  return base;
}

function setConfigTab(tab) {
  STATE.configTab = tab;
  render();
}

function renderConfig() {
  const tabs = configTabsFor(STATE.currentUnit);
  if (!tabs.find((t) => t.id === STATE.configTab)) STATE.configTab = "planos";

  let body;
  switch (STATE.configTab) {
    case "planos": body = renderConfigPlanos(); break;
    case "frota": body = renderConfigFrota(); break;
    case "cupons": body = renderConfigCupons(); break;
    case "fidelidade": body = renderConfigFidelidade(); break;
    case "colaboradores": body = renderConfigColaboradores(); break;
    case "caixa-relatorio": body = renderConfigCaixaRelatorio(); break;
    case "produtos": body = renderConfigProdutos(); break;
    case "unidade": body = renderConfigUnidade(); break;
    default: body = "";
  }

  return `
    <h1>Configurações</h1>
    <p class="lede">${STATE.currentUnit === "QUIOSQUE" ? "Módulo Quiosque (Circuito)" : "Módulo Loja (Playground)"} — Planos, Frota e Unidade são específicos deste ponto; as demais abas são compartilhadas com o outro ponto.</p>
    <div class="config-tabs">
      ${tabs.map((t) => `<button class="${STATE.configTab === t.id ? "active" : ""}" onclick="setConfigTab('${t.id}')">${t.label}</button>`).join("")}
    </div>
    ${body}
  `;
}

// ── Planos (unit-scoped) ──

function renderConfigPlanos() {
  const activity = activityForUnit();
  const plans = STATE.plans[activity];
  return `
    <div class="panel">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-4)">
        <h2 style="margin:0;font-family:var(--font-display);font-weight:400;font-size:var(--text-md);color:var(--color-dark)">Planos — ${activity === "CARRINHO" ? "Circuito" : "Playground"}</h2>
        <button class="btn btn-primary btn-sm" onclick="openPlanForm('${activity}')">+ Novo plano</button>
      </div>
      ${plans.length === 0 ? '<p class="hint">Nenhum plano cadastrado.</p>' : `<div class="grid-3">${plans.map((p) => `
        <div class="plan-card">
          <p class="plan-name">${escapeHtml(p.name)}</p>
          <p class="plan-value">${money(p.valueCents)}</p>
          <p class="plan-meta">${p.durationValue} ${p.durationUnit === "HORA" ? "hora(s)" : "minuto(s)"} · excedente ${money(p.overageCentsPerMinute)}/min</p>
          <div class="plan-actions">
            <button class="btn btn-secondary btn-sm" onclick="openPlanForm('${activity}', '${p.id}')">Editar</button>
            <button class="btn btn-ghost btn-sm" onclick="confirmDeletePlan('${activity}', '${p.id}')">Excluir</button>
          </div>
        </div>
      `).join("")}</div>`}
    </div>
  `;
}
function openPlanForm(activity, planId) {
  const existing = planId ? findPlan(activity, planId) : null;
  const p = existing || { name: "", valueCents: 0, durationValue: 30, durationUnit: "MINUTO", overageCentsPerMinute: 0 };
  openModal(`
    <h2>${existing ? "Editar plano" : "Novo plano"}</h2>
    <div class="field"><label>Nome</label><input type="text" id="plan-name" value="${escapeHtml(p.name)}" placeholder="Ex.: 30 minutos" /></div>
    <div class="field"><label>Valor (R$)</label><input type="number" step="0.01" id="plan-value" value="${(p.valueCents / 100).toFixed(2)}" /></div>
    <div class="grid-2" style="gap:12px">
      <div class="field"><label>Tempo</label><input type="number" id="plan-duration" value="${p.durationValue}" min="1" /></div>
      <div class="field"><label>Unidade</label>
        <select id="plan-unit">
          <option value="MINUTO" ${p.durationUnit === "MINUTO" ? "selected" : ""}>Minuto(s)</option>
          <option value="HORA" ${p.durationUnit === "HORA" ? "selected" : ""}>Hora(s)</option>
        </select>
      </div>
    </div>
    <div class="field"><label>Minuto excedente (R$)</label><input type="number" step="0.01" id="plan-overage" value="${(p.overageCentsPerMinute / 100).toFixed(2)}" /></div>
    <div class="actions">
      <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="savePlan('${activity}', ${existing ? `'${existing.id}'` : "null"})">Salvar</button>
    </div>
  `);
}
function savePlan(activity, planId) {
  const name = document.getElementById("plan-name").value.trim();
  const valueCents = Math.round(parseFloat(document.getElementById("plan-value").value || "0") * 100);
  const durationValue = parseInt(document.getElementById("plan-duration").value || "0", 10);
  const durationUnit = document.getElementById("plan-unit").value;
  const overageCentsPerMinute = Math.round(parseFloat(document.getElementById("plan-overage").value || "0") * 100);
  if (!name || valueCents <= 0 || durationValue <= 0) { toast("Preencha nome, valor e tempo corretamente"); return; }
  if (planId) {
    Object.assign(findPlan(activity, planId), { name, valueCents, durationValue, durationUnit, overageCentsPerMinute });
  } else {
    STATE.plans[activity].push({ id: uid("plan"), name, valueCents, durationValue, durationUnit, overageCentsPerMinute });
  }
  closeModal();
  toast("Plano salvo");
  render();
}
function confirmDeletePlan(activity, planId) {
  const plan = findPlan(activity, planId);
  confirmAction({
    title: "Excluir plano",
    description: `Excluir o plano <strong>${escapeHtml(plan.name)}</strong>? Sessões já em andamento com este plano não são afetadas, mas ele deixa de aparecer na Entrada.`,
    confirmLabel: "Excluir",
    danger: true,
    onConfirm: () => {
      STATE.plans[activity] = STATE.plans[activity].filter((p) => p.id !== planId);
      render();
    },
  });
}

// ── Frota (Quiosque) ──

function renderConfigFrota() {
  const us = unitState();
  return `
    <div class="panel" style="margin-bottom:var(--space-6)">
      <div class="field">
        <label>Termos de uso dos carrinhos (impresso no cupom de entrada)</label>
        <textarea id="terms-text" style="width:100%;min-height:90px;border-radius:var(--radius-input);border:1.5px solid var(--border-subtle);padding:12px;font-family:inherit;font-size:var(--text-sm)" onblur="STATE.units.QUIOSQUE.termsText=this.value;toast('Termos salvos')">${escapeHtml(us.termsText)}</textarea>
      </div>
      <div class="field" style="max-width:280px">
        <label>Manutenção preventiva a cada (horas de uso)</label>
        <input type="number" min="1" value="${us.maintenanceThresholdHours}" onchange="updateMaintenanceThreshold(this.value)" />
        <span class="hint">Ao atingir o limite, o carrinho vira "Revisão Obrigatória" no painel automaticamente.</span>
      </div>
    </div>
    <div class="grid-3">${us.assets.map((a) => renderFleetCard(a, us.maintenanceThresholdHours)).join("")}</div>
  `;
}
function updateMaintenanceThreshold(value) {
  const us = unitState();
  us.maintenanceThresholdHours = Math.max(1, parseInt(value, 10) || 1);
  const thresholdMinutes = us.maintenanceThresholdHours * 60;
  us.assets.forEach((a) => { if (a.status !== "EM_USO" && a.totalUsedMinutes >= thresholdMinutes) a.status = "REVISAO_OBRIGATORIA"; });
  render();
}
function renderFleetCard(asset, maintenanceThresholdHours) {
  const hours = (asset.totalUsedMinutes / 60).toFixed(1);
  return `
    <div class="fleet-card" data-status="${asset.status}">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <div style="width:48px;height:48px;border-radius:12px;background:${asset.color}22;display:flex;align-items:center;justify-content:center;font-size:26px">${asset.emoji}</div>
        <div>
          <input type="text" value="${escapeHtml(asset.name)}" style="border:none;background:transparent;font-weight:700;font-size:15px;padding:2px 0;width:100%" oninput="renameAsset('${asset.id}', this.value)" />
          <span class="status-badge" data-phase="${asset.status === "DISPONIVEL" ? "VERDE" : asset.status === "EM_USO" ? "VERMELHO" : "AMARELO"}" style="font-size:10px;padding:2px 8px">${assetStatusLabel(asset.status)}</span>
        </div>
      </div>
      <p class="hint" style="margin-bottom:4px">Modelo / foto</p>
      <div class="emoji-picker" style="margin-bottom:10px">${CART_EMOJI_OPTIONS.map((e) => `<button class="${asset.emoji === e ? "selected" : ""}" onclick="setAssetEmoji('${asset.id}', '${e}')">${e}</button>`).join("")}</div>
      <p class="hint" style="margin-bottom:4px">Cor</p>
      <div class="color-swatches" style="margin-bottom:10px">${CART_COLOR_OPTIONS.map((c) => `<div class="color-swatch ${asset.color === c ? "selected" : ""}" style="background:${c}" onclick="setAssetColor('${asset.id}', '${c}')"></div>`).join("")}</div>
      <p class="hint">${hours}h de uso acumuladas de ${maintenanceThresholdHours}h</p>
      ${asset.status === "REVISAO_OBRIGATORIA" ? `<button class="btn btn-teal btn-sm btn-block" style="margin-top:8px" onclick="confirmMarkAssetReviewed('${asset.id}')">Marcar como revisado</button>` : ""}
    </div>
  `;
}
function renameAsset(assetId, value) {
  const asset = unitState().assets.find((a) => a.id === assetId);
  if (asset) asset.name = value;
}
function setAssetEmoji(assetId, emoji) {
  unitState().assets.find((a) => a.id === assetId).emoji = emoji;
  render();
}
function setAssetColor(assetId, color) {
  unitState().assets.find((a) => a.id === assetId).color = color;
  render();
}
function confirmMarkAssetReviewed(assetId) {
  const asset = unitState().assets.find((a) => a.id === assetId);
  confirmAction({
    title: "Marcar como revisado",
    description: `Confirma que <strong>${escapeHtml(asset.name)}</strong> passou pela manutenção? O contador de horas volta a zero.`,
    confirmLabel: "Confirmar revisão",
    onConfirm: () => {
      asset.totalUsedMinutes = 0;
      asset.status = "DISPONIVEL";
      toast(`${asset.name} marcado como revisado`);
      render();
    },
  });
}

// ── Cupom de Desconto (tenant-wide) ──

function renderConfigCupons() {
  return `
    <div class="panel">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-4)">
        <h2 style="margin:0;font-family:var(--font-display);font-weight:400;font-size:var(--text-md);color:var(--color-dark)">Cupons de desconto</h2>
        <button class="btn btn-primary btn-sm" onclick="openCouponForm()">+ Novo cupom</button>
      </div>
      ${STATE.coupons.length === 0 ? '<p class="hint">Nenhum cupom cadastrado.</p>' : `
        <table class="data-table">
          <thead><tr><th>Código</th><th>Efeito</th><th>Usos</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${STATE.coupons.map((c) => `<tr>
              <td><strong>${escapeHtml(c.code)}</strong><br/><span class="hint">${escapeHtml(c.description || "")}</span></td>
              <td>${describeCouponEffect(c)}</td>
              <td>${c.usedCount} / ${c.maxUses}</td>
              <td><span class="status-badge" data-phase="${c.active ? "VERDE" : "VERMELHO"}" style="font-size:11px">${c.active ? "ativo" : "inativo"}</span></td>
              <td>
                <button class="btn btn-secondary btn-sm" onclick="openCouponForm('${c.id}')">Editar</button>
                <button class="btn btn-ghost btn-sm" onclick="confirmDeleteCoupon('${c.id}')">Excluir</button>
              </td>
            </tr>`).join("")}
          </tbody>
        </table>
      `}
    </div>
  `;
}
function openCouponForm(couponId) {
  const existing = couponId ? STATE.coupons.find((c) => c.id === couponId) : null;
  const c = existing || { code: "", kind: "DESCONTO_PCT", value: 10, maxUses: 100, active: true, description: "" };
  openModal(`
    <h2>${existing ? "Editar cupom" : "Novo cupom"}</h2>
    <div class="field"><label>Código</label><input type="text" id="coup-code" value="${escapeHtml(c.code)}" placeholder="Ex.: AMIGO10" style="text-transform:uppercase" /></div>
    <div class="field"><label>Descrição</label><input type="text" id="coup-desc" value="${escapeHtml(c.description)}" placeholder="Ex.: avaliação no Google" /></div>
    <div class="grid-2" style="gap:12px">
      <div class="field"><label>Tipo</label>
        <select id="coup-kind">
          <option value="DESCONTO_PCT" ${c.kind === "DESCONTO_PCT" ? "selected" : ""}>Desconto %</option>
          <option value="DESCONTO_FIXO" ${c.kind === "DESCONTO_FIXO" ? "selected" : ""}>Desconto fixo (R$)</option>
          <option value="MINUTOS_EXTRA" ${c.kind === "MINUTOS_EXTRA" ? "selected" : ""}>Minutos extras</option>
        </select>
      </div>
      <div class="field"><label>Valor</label><input type="number" step="0.01" id="coup-value" value="${c.value}" /></div>
    </div>
    <div class="field"><label>Usos máximos</label><input type="number" id="coup-maxuses" value="${c.maxUses}" min="1" /></div>
    <div class="field"><label><input type="checkbox" id="coup-active" ${c.active ? "checked" : ""} style="width:18px;height:18px;accent-color:var(--color-pink);margin-right:6px;vertical-align:middle" /> Ativo</label></div>
    <div class="actions">
      <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="saveCoupon(${existing ? `'${existing.id}'` : "null"})">Salvar</button>
    </div>
  `);
}
function saveCoupon(couponId) {
  const code = document.getElementById("coup-code").value.trim().toUpperCase();
  const description = document.getElementById("coup-desc").value.trim();
  const kind = document.getElementById("coup-kind").value;
  const value = parseFloat(document.getElementById("coup-value").value || "0");
  const maxUses = parseInt(document.getElementById("coup-maxuses").value || "1", 10);
  const active = document.getElementById("coup-active").checked;
  if (!code) { toast("Informe um código"); return; }
  if (couponId) {
    Object.assign(STATE.coupons.find((c) => c.id === couponId), { code, description, kind, value, maxUses, active });
  } else {
    STATE.coupons.push({ id: uid("coup"), code, description, kind, value, maxUses, usedCount: 0, active });
  }
  closeModal();
  toast("Cupom salvo");
  render();
}
function confirmDeleteCoupon(couponId) {
  const c = STATE.coupons.find((x) => x.id === couponId);
  confirmAction({
    title: "Excluir cupom",
    description: `Excluir o cupom <strong>${escapeHtml(c.code)}</strong>? Ele deixa de poder ser aplicado em novas entradas.`,
    confirmLabel: "Excluir",
    danger: true,
    onConfirm: () => { STATE.coupons = STATE.coupons.filter((x) => x.id !== couponId); render(); },
  });
}

// ── Fidelidade (tenant-wide) ──

function renderConfigFidelidade() {
  const childrenWithRewards = STATE.children.filter((c) => c.redeemableRewards.length > 0);
  return `
    <div class="panel" style="margin-bottom:var(--space-6)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-4)">
        <h2 style="margin:0;font-family:var(--font-display);font-weight:400;font-size:var(--text-md);color:var(--color-dark)">Regras do cartão fidelidade</h2>
        <button class="btn btn-primary btn-sm" onclick="openLoyaltyForm()">+ Nova regra</button>
      </div>
      ${STATE.loyaltyRules.length === 0 ? '<p class="hint">Nenhuma regra cadastrada.</p>' : STATE.loyaltyRules.map((r) => `
        <div class="cart-line">
          <span>${escapeHtml(r.description)} <span class="hint">(${r.activity === "AMBOS" ? "Loja e Circuito" : r.activity === "CARRINHO" ? "Circuito" : "Loja"})</span></span>
          <span>
            <button class="btn btn-secondary btn-sm" onclick="openLoyaltyForm('${r.id}')">Editar</button>
            <button class="btn btn-ghost btn-sm" onclick="confirmDeleteLoyaltyRule('${r.id}')">Excluir</button>
          </span>
        </div>
      `).join("")}
    </div>
    <div class="panel">
      <h2 style="margin-top:0;font-family:var(--font-display);font-weight:400;font-size:var(--text-md);color:var(--color-dark)">Recompensas pendentes de resgate</h2>
      ${childrenWithRewards.length === 0 ? '<p class="hint">Nenhuma no momento.</p>' : `
        <table class="data-table">
          <thead><tr><th>Criança</th><th>Visitas</th><th>Recompensa</th></tr></thead>
          <tbody>
            ${childrenWithRewards.map((c) => c.redeemableRewards.map((rw) => {
              const rule = STATE.loyaltyRules.find((r) => r.id === rw.ruleId);
              return `<tr><td>${escapeHtml(c.childName)}</td><td>${totalVisits(c)}</td><td>${rule ? escapeHtml(describeLoyaltyReward(rule)) : "(regra removida)"}</td></tr>`;
            }).join("")).join("")}
          </tbody>
        </table>
      `}
    </div>
  `;
}
function openLoyaltyForm(ruleId) {
  const existing = ruleId ? STATE.loyaltyRules.find((r) => r.id === ruleId) : null;
  const r = existing || { description: "", activity: "PLAYGROUND", triggerVisits: 10, rewardKind: "ENTRADA_GRATIS", rewardValue: 1 };
  openModal(`
    <h2>${existing ? "Editar regra" : "Nova regra de fidelidade"}</h2>
    <div class="field"><label>Descrição</label><input type="text" id="loy-desc" value="${escapeHtml(r.description)}" placeholder="Ex.: a cada 10 visitas, ganha 1 grátis" /></div>
    <div class="grid-2" style="gap:12px">
      <div class="field"><label>Atividade</label>
        <select id="loy-activity">
          <option value="PLAYGROUND" ${r.activity === "PLAYGROUND" ? "selected" : ""}>Loja (Playground)</option>
          <option value="CARRINHO" ${r.activity === "CARRINHO" ? "selected" : ""}>Circuito (Carrinho)</option>
          <option value="AMBOS" ${r.activity === "AMBOS" ? "selected" : ""}>Ambos</option>
        </select>
      </div>
      <div class="field"><label>A cada quantas visitas</label><input type="number" id="loy-visits" value="${r.triggerVisits}" min="1" /></div>
    </div>
    <div class="grid-2" style="gap:12px">
      <div class="field"><label>Recompensa</label>
        <select id="loy-kind">
          <option value="ENTRADA_GRATIS" ${r.rewardKind === "ENTRADA_GRATIS" ? "selected" : ""}>Entrada grátis</option>
          <option value="DESCONTO_PCT" ${r.rewardKind === "DESCONTO_PCT" ? "selected" : ""}>Desconto %</option>
          <option value="MINUTOS_EXTRA" ${r.rewardKind === "MINUTOS_EXTRA" ? "selected" : ""}>Minutos extras</option>
        </select>
      </div>
      <div class="field"><label>Valor</label><input type="number" id="loy-value" value="${r.rewardValue}" /></div>
    </div>
    <div class="actions">
      <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="saveLoyaltyRule(${existing ? `'${existing.id}'` : "null"})">Salvar</button>
    </div>
  `);
}
function saveLoyaltyRule(ruleId) {
  const description = document.getElementById("loy-desc").value.trim();
  const activity = document.getElementById("loy-activity").value;
  const triggerVisits = parseInt(document.getElementById("loy-visits").value || "0", 10);
  const rewardKind = document.getElementById("loy-kind").value;
  const rewardValue = parseFloat(document.getElementById("loy-value").value || "0");
  if (!description || triggerVisits <= 0) { toast("Preencha a descrição e o número de visitas"); return; }
  if (ruleId) {
    Object.assign(STATE.loyaltyRules.find((r) => r.id === ruleId), { description, activity, triggerVisits, rewardKind, rewardValue });
  } else {
    STATE.loyaltyRules.push({ id: uid("loy"), description, activity, triggerVisits, rewardKind, rewardValue });
  }
  closeModal();
  toast("Regra salva");
  render();
}
function confirmDeleteLoyaltyRule(ruleId) {
  const r = STATE.loyaltyRules.find((x) => x.id === ruleId);
  confirmAction({
    title: "Excluir regra de fidelidade",
    description: `Excluir <strong>${escapeHtml(r.description)}</strong>? Recompensas já conquistadas continuam resgatáveis, mas novas visitas não geram mais essa recompensa.`,
    confirmLabel: "Excluir",
    danger: true,
    onConfirm: () => { STATE.loyaltyRules = STATE.loyaltyRules.filter((x) => x.id !== ruleId); render(); },
  });
}

// ── Colaboradores (tenant-wide) ──

function renderConfigColaboradores() {
  return `
    <div class="panel">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-4)">
        <h2 style="margin:0;font-family:var(--font-display);font-weight:400;font-size:var(--text-md);color:var(--color-dark)">Colaboradores</h2>
        <button class="btn btn-primary btn-sm" onclick="openEmployeeForm()">+ Novo colaborador</button>
      </div>
      ${STATE.employees.length === 0 ? '<p class="hint">Nenhum colaborador cadastrado.</p>' : `
        <table class="data-table">
          <thead><tr><th>Nome</th><th>Cargo</th><th>PIS</th><th>Telefone</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${STATE.employees.map((e) => `<tr>
              <td>${escapeHtml(e.name)}</td><td>${escapeHtml(e.role)}</td><td class="mono">${escapeHtml(e.pis)}</td><td>${escapeHtml(e.phone)}</td>
              <td><span class="status-badge" data-phase="${e.active ? "VERDE" : "VERMELHO"}" style="font-size:11px">${e.active ? "ativo" : "inativo"}</span></td>
              <td><button class="btn btn-secondary btn-sm" onclick="openEmployeeForm('${e.id}')">Editar</button>
                  <button class="btn btn-ghost btn-sm" onclick="confirmDeleteEmployee('${e.id}')">Excluir</button></td>
            </tr>`).join("")}
          </tbody>
        </table>
      `}
      <p class="hint" style="margin-top:12px">PIS/NIS e CPF ficam registrados porque a Portaria MTP nº 671/2021 exige identificação do trabalhador nos registros de ponto (ver aba <strong>Ponto</strong> no menu principal).</p>
    </div>
  `;
}
function openEmployeeForm(employeeId) {
  const existing = employeeId ? STATE.employees.find((e) => e.id === employeeId) : null;
  const e = existing || { name: "", role: "Operador de caixa", phone: "", pis: "", cpf: "", active: true };
  openModal(`
    <h2>${existing ? "Editar colaborador" : "Novo colaborador"}</h2>
    <div class="field"><label>Nome</label><input type="text" id="emp-name" value="${escapeHtml(e.name)}" /></div>
    <div class="field"><label>Cargo</label><input type="text" id="emp-role" value="${escapeHtml(e.role)}" /></div>
    <div class="grid-2" style="gap:12px">
      <div class="field"><label>PIS/NIS</label><input type="text" id="emp-pis" value="${escapeHtml(e.pis)}" placeholder="000.00000.00-0" /></div>
      <div class="field"><label>CPF</label><input type="text" id="emp-cpf" value="${escapeHtml(e.cpf)}" placeholder="000.000.000-00" /></div>
    </div>
    <div class="field"><label>Telefone</label><input type="tel" id="emp-phone" value="${escapeHtml(e.phone)}" /></div>
    <div class="field"><label><input type="checkbox" id="emp-active" ${e.active ? "checked" : ""} style="width:18px;height:18px;accent-color:var(--color-pink);margin-right:6px;vertical-align:middle" /> Ativo</label></div>
    <div class="actions">
      <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="saveEmployee(${existing ? `'${existing.id}'` : "null"})">Salvar</button>
    </div>
  `);
}
function saveEmployee(employeeId) {
  const name = document.getElementById("emp-name").value.trim();
  const role = document.getElementById("emp-role").value.trim();
  const pis = document.getElementById("emp-pis").value.trim();
  const cpf = document.getElementById("emp-cpf").value.trim();
  const phone = document.getElementById("emp-phone").value.trim();
  const active = document.getElementById("emp-active").checked;
  if (!name) { toast("Informe o nome"); return; }
  if (employeeId) {
    Object.assign(STATE.employees.find((e) => e.id === employeeId), { name, role, pis, cpf, phone, active });
  } else {
    STATE.employees.push({ id: uid("emp"), name, role, pis, cpf, phone, active });
  }
  closeModal();
  toast("Colaborador salvo");
  render();
}
function confirmDeleteEmployee(employeeId) {
  const e = STATE.employees.find((x) => x.id === employeeId);
  confirmAction({
    title: "Excluir colaborador",
    description: `Excluir <strong>${escapeHtml(e.name)}</strong> do cadastro?`,
    confirmLabel: "Excluir",
    danger: true,
    onConfirm: () => { STATE.employees = STATE.employees.filter((x) => x.id !== employeeId); render(); },
  });
}

// ── Movimentação de Caixa — relatório (tenant-wide, com filtros) ──

function collectCashEvents() {
  const events = [];
  for (const unitKey of ["LOJA", "QUIOSQUE"]) {
    const us = STATE.units[unitKey];
    const shifts = [...us.shiftHistory, ...(us.shift ? [us.shift] : [])];
    for (const shift of shifts) {
      for (const o of shift.orders) events.push({ unit: unitKey, atMs: o.at, type: "VENDA", method: o.method, amountCents: o.totalCents, label: o.label || "", transactionId: o.id });
      for (const m of shift.movements) events.push({ unit: unitKey, atMs: m.at, type: m.kind, method: "DINHEIRO", amountCents: m.amountCents, label: m.reason, transactionId: m.id });
    }
  }
  return events.sort((a, b) => b.atMs - a.atMs);
}

function renderConfigCaixaRelatorio() {
  const f = STATE.caixaReportFilter || { unit: "TODAS", type: "TODOS", method: "TODOS", search: "" };
  STATE.caixaReportFilter = f;

  let events = collectCashEvents();
  if (f.unit !== "TODAS") events = events.filter((e) => e.unit === f.unit);
  if (f.type !== "TODOS") events = events.filter((e) => e.type === f.type);
  if (f.method !== "TODOS") events = events.filter((e) => e.method === f.method);
  if (f.search.trim()) {
    const q = f.search.trim().toLowerCase();
    events = events.filter((e) => e.label.toLowerCase().includes(q) || (e.transactionId || "").toLowerCase().includes(q));
  }
  const total = events.filter((e) => e.type === "VENDA").reduce((s, e) => s + e.amountCents, 0);

  return `
    <div class="panel">
      <h2 style="margin-top:0;font-family:var(--font-display);font-weight:400;font-size:var(--text-md);color:var(--color-dark)">Relatório de movimentação de caixa</h2>
      <div class="filter-bar">
        <div class="field"><label>Unidade</label>
          <select onchange="STATE.caixaReportFilter.unit=this.value;render()">
            <option value="TODAS" ${f.unit === "TODAS" ? "selected" : ""}>Todas</option>
            <option value="LOJA" ${f.unit === "LOJA" ? "selected" : ""}>Loja</option>
            <option value="QUIOSQUE" ${f.unit === "QUIOSQUE" ? "selected" : ""}>Quiosque</option>
          </select>
        </div>
        <div class="field"><label>Tipo</label>
          <select onchange="STATE.caixaReportFilter.type=this.value;render()">
            <option value="TODOS" ${f.type === "TODOS" ? "selected" : ""}>Todos</option>
            <option value="VENDA" ${f.type === "VENDA" ? "selected" : ""}>Venda</option>
            <option value="SANGRIA" ${f.type === "SANGRIA" ? "selected" : ""}>Sangria</option>
            <option value="SUPRIMENTO" ${f.type === "SUPRIMENTO" ? "selected" : ""}>Suprimento</option>
          </select>
        </div>
        <div class="field"><label>Método</label>
          <select onchange="STATE.caixaReportFilter.method=this.value;render()">
            <option value="TODOS" ${f.method === "TODOS" ? "selected" : ""}>Todos</option>
            <option value="DINHEIRO" ${f.method === "DINHEIRO" ? "selected" : ""}>Dinheiro</option>
            <option value="PIX" ${f.method === "PIX" ? "selected" : ""}>PIX</option>
            <option value="CREDITO" ${f.method === "CREDITO" ? "selected" : ""}>Crédito</option>
            <option value="DEBITO" ${f.method === "DEBITO" ? "selected" : ""}>Débito</option>
          </select>
        </div>
        <div class="field"><label>Rastrear (transação ou nome)</label><input type="text" value="${escapeHtml(f.search)}" oninput="STATE.caixaReportFilter.search=this.value;renderCaixaReportTableOnly()" placeholder="Ex.: tx-a1b2c3 ou Helena" /></div>
      </div>
      <p class="hint" style="margin-bottom:10px">Total em vendas no recorte filtrado: <strong>${money(total)}</strong> · ${events.length} registro(s)</p>
      <div id="caixa-report-table">${renderCaixaReportRows(events)}</div>
    </div>
  `;
}
function renderCaixaReportRows(events) {
  if (events.length === 0) return '<p class="hint">Nenhum registro para este filtro.</p>';
  return `<table class="data-table">
    <thead><tr><th>Horário</th><th>Unidade</th><th>Tipo</th><th>Método</th><th>Descrição</th><th class="num">Valor</th></tr></thead>
    <tbody>
      ${events.map((e) => `<tr>
        <td>${fmtTime(e.atMs)}</td>
        <td>${e.unit === "QUIOSQUE" ? "Quiosque" : "Loja"}</td>
        <td>${e.type}</td>
        <td>${e.method}</td>
        <td>${escapeHtml(e.label)} <span class="hint mono">${e.transactionId || ""}</span></td>
        <td class="num">${money(e.amountCents)}</td>
      </tr>`).join("")}
    </tbody>
  </table>`;
}
// Busca em texto: atualização cirúrgica da tabela, sem re-renderizar
// os selects de filtro (mesma lição do campo de WhatsApp).
function renderCaixaReportTableOnly() {
  const f = STATE.caixaReportFilter;
  let events = collectCashEvents();
  if (f.unit !== "TODAS") events = events.filter((e) => e.unit === f.unit);
  if (f.type !== "TODOS") events = events.filter((e) => e.type === f.type);
  if (f.method !== "TODOS") events = events.filter((e) => e.method === f.method);
  if (f.search.trim()) {
    const q = f.search.trim().toLowerCase();
    events = events.filter((e) => e.label.toLowerCase().includes(q) || (e.transactionId || "").toLowerCase().includes(q));
  }
  const box = document.getElementById("caixa-report-table");
  if (box) box.innerHTML = renderCaixaReportRows(events);
}

// ── Produtos (tenant-wide) ──

function renderConfigProdutos() {
  return `
    <div class="panel">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-4)">
        <h2 style="margin:0;font-family:var(--font-display);font-weight:400;font-size:var(--text-md);color:var(--color-dark)">Produtos</h2>
        <button class="btn btn-primary btn-sm" onclick="openProductForm()">+ Novo produto</button>
      </div>
      <div class="grid-3">
        ${STATE.products.map((p) => `
          <div class="plan-card product-card-admin">
            <span class="status-badge stock-badge" data-phase="${p.stock > 5 ? "VERDE" : p.stock > 0 ? "AMARELO" : "VERMELHO"}" style="font-size:10px">${p.stock} un.</span>
            <p style="font-size:32px;margin:0 0 6px">${p.emoji}</p>
            <p class="plan-name">${escapeHtml(p.name)}</p>
            <p class="plan-meta">${escapeHtml(p.description)}</p>
            <p class="plan-value">${money(p.price)}</p>
            <div class="plan-actions">
              <button class="btn btn-secondary btn-sm" onclick="openProductForm('${p.id}')">Editar</button>
              <button class="btn btn-ghost btn-sm" onclick="confirmDeleteProduct('${p.id}')">Excluir</button>
            </div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}
function openProductForm(productId) {
  const existing = productId ? STATE.products.find((p) => p.id === productId) : null;
  const p = existing || { name: "", description: "", emoji: PRODUCT_EMOJI_OPTIONS[0], price: 0, stock: 0 };
  openModal(`
    <h2>${existing ? "Editar produto" : "Novo produto"}</h2>
    <div class="field"><label>Nome</label><input type="text" id="prod-name" value="${escapeHtml(p.name)}" /></div>
    <div class="field"><label>Descrição</label><input type="text" id="prod-desc" value="${escapeHtml(p.description)}" /></div>
    <p class="hint" style="margin-bottom:4px">Foto</p>
    <div class="emoji-picker" id="prod-emoji-picker" style="margin-bottom:12px" data-selected="${p.emoji}">
      ${PRODUCT_EMOJI_OPTIONS.map((e) => `<button type="button" class="${p.emoji === e ? "selected" : ""}" onclick="selectProductEmoji(this, '${e}')">${e}</button>`).join("")}
    </div>
    <div class="grid-2" style="gap:12px">
      <div class="field"><label>Preço (R$)</label><input type="number" step="0.01" id="prod-price" value="${(p.price / 100).toFixed(2)}" /></div>
      <div class="field"><label>Estoque</label><input type="number" id="prod-stock" value="${p.stock}" min="0" /></div>
    </div>
    <div class="actions">
      <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="saveProduct(${existing ? `'${existing.id}'` : "null"})">Salvar</button>
    </div>
  `);
}
function selectProductEmoji(btn, emoji) {
  const picker = document.getElementById("prod-emoji-picker");
  picker.dataset.selected = emoji;
  picker.querySelectorAll("button").forEach((b) => b.classList.remove("selected"));
  btn.classList.add("selected");
}
function saveProduct(productId) {
  const name = document.getElementById("prod-name").value.trim();
  const description = document.getElementById("prod-desc").value.trim();
  const emoji = document.getElementById("prod-emoji-picker").dataset.selected;
  const price = Math.round(parseFloat(document.getElementById("prod-price").value || "0") * 100);
  const stock = parseInt(document.getElementById("prod-stock").value || "0", 10);
  if (!name || price <= 0) { toast("Preencha nome e preço"); return; }
  if (productId) {
    Object.assign(STATE.products.find((p) => p.id === productId), { name, description, emoji, price, stock });
  } else {
    STATE.products.push({ id: uid("prod"), name, description, emoji, price, stock });
  }
  closeModal();
  toast("Produto salvo");
  render();
}
function confirmDeleteProduct(productId) {
  const p = STATE.products.find((x) => x.id === productId);
  confirmAction({
    title: "Excluir produto",
    description: `Excluir <strong>${escapeHtml(p.name)}</strong> do catálogo?`,
    confirmLabel: "Excluir",
    danger: true,
    onConfirm: () => { STATE.products = STATE.products.filter((x) => x.id !== productId); render(); },
  });
}

// ── Unidade (unit-scoped, com "certificado" simulado) ──

function renderConfigUnidade() {
  const us = unitState();
  const info = us.unitInfo;
  return `
    <div class="panel" style="max-width:520px">
      <h2 style="margin-top:0;font-family:var(--font-display);font-weight:400;font-size:var(--text-md);color:var(--color-dark)">Geral</h2>
      <div class="field"><label>Nome da unidade</label><input type="text" value="${escapeHtml(info.name)}" onblur="STATE.units.${STATE.currentUnit}.unitInfo.name=this.value" /></div>
      <div class="field"><label>Endereço</label><input type="text" value="${escapeHtml(info.address)}" onblur="STATE.units.${STATE.currentUnit}.unitInfo.address=this.value" /></div>
      <div class="grid-2" style="gap:12px">
        <div class="field"><label>Abertura</label><input type="time" value="${info.openTime}" onchange="STATE.units.${STATE.currentUnit}.unitInfo.openTime=this.value" /></div>
        <div class="field"><label>Fechamento</label><input type="time" value="${info.closeTime}" onchange="STATE.units.${STATE.currentUnit}.unitInfo.closeTime=this.value" /></div>
      </div>
      <div class="field" style="max-width:220px">
        <label>Meta diária de faturamento (R$)</label>
        <input type="number" step="0.01" value="${(us.dailyGoalCents / 100).toFixed(2)}" onblur="STATE.units.${STATE.currentUnit}.dailyGoalCents=Math.round(parseFloat(this.value||'0')*100)" />
        <span class="hint">Aparece no rodapé do PDV e do Caixa durante a operação — não editável por lá, de propósito.</span>
      </div>

      <h2 style="font-family:var(--font-display);font-weight:400;font-size:var(--text-md);color:var(--color-dark)">Certificado digital (emissão de NFe)</h2>
      <p class="hint" style="margin-bottom:10px">Simulado neste protótipo — nenhum arquivo é enviado a lugar nenhum. No sistema real, o certificado nunca sai do processo principal do Electron no PC do caixa.</p>
      <div class="field">
        <label>Arquivo (.pfx / .p12)</label>
        <input type="file" accept=".pfx,.p12" onchange="onCertificateSelected(this.files[0])" />
        ${info.certFileName ? `<span class="hint">📎 ${escapeHtml(info.certFileName)}</span>` : ""}
      </div>
      <div class="field"><label>Senha do certificado</label><input type="password" value="${escapeHtml(info.certPassword)}" onblur="STATE.units.${STATE.currentUnit}.unitInfo.certPassword=this.value" /></div>
    </div>
  `;
}
function onCertificateSelected(file) {
  if (!file) return;
  unitState().unitInfo.certFileName = file.name;
  toast(`Certificado "${file.name}" selecionado (simulado)`);
  render();
}

// ═══════════════════════════════════════════════════════════════════
// TELA — Ponto (100% clicável: operação do dia a dia não deve exigir
// digitação. Cadastrar um colaborador novo — com PIS/CPF — é ação de
// gestão e continua em Configurações > Colaboradores, onde digitar é
// aceitável.)
//
// Aviso de conformidade: isto é uma maquete. Um Registrador Eletrônico
// de Ponto (REP) de verdade precisa seguir a Portaria MTP nº 671/2021
// (que atualizou a Portaria 1.510/2009) — identificação do empregador
// e do trabalhador em cada marcação, NSR sequencial e sem lacunas,
// geração de AFD/AEJ para fiscalização, e no caso de REP-P (software),
// determinados requisitos de auditoria. Nenhuma dessas obrigações está
// certificada aqui — é só o desenho de tela.
// ═══════════════════════════════════════════════════════════════════

const PONTO_TYPES = [
  { type: "ENTRADA", label: "Entrada", cls: "btn-entrada", icon: "🟢" },
  { type: "INICIO_INTERVALO", label: "Início intervalo", cls: "btn-intervalo-inicio", icon: "🟡" },
  { type: "FIM_INTERVALO", label: "Fim intervalo", cls: "btn-intervalo-fim", icon: "🔵" },
  { type: "SAIDA", label: "Saída", cls: "btn-saida", icon: "🔴" },
];

function renderPonto() {
  const activeEmployees = STATE.employees.filter((e) => e.active);
  const selected = STATE.pontoSelectedEmployeeId ? STATE.employees.find((e) => e.id === STATE.pontoSelectedEmployeeId) : null;

  if (!selected) {
    return `
      <h1>Bater ponto</h1>
      <p class="lede">Toque no seu nome para registrar o ponto. Nada para digitar.</p>
      ${
        activeEmployees.length === 0
          ? `<div class="empty-state"><span class="emoji">🪪</span>Nenhum colaborador ativo cadastrado.<br/><span class="hint">Cadastre em Configurações → Colaboradores.</span></div>`
          : `<div class="employee-picker">${activeEmployees.map((e) => `
              <div class="activity-card" onclick="STATE.pontoSelectedEmployeeId='${e.id}';render()">
                <span class="emoji">🪪</span>
                <span class="name">${escapeHtml(e.name)}</span>
                <p class="hint" style="margin:4px 0 0">${escapeHtml(e.role)}</p>
              </div>
            `).join("")}</div>`
      }
    `;
  }

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayRecords = STATE.pontoRecords.filter((r) => r.employeeId === selected.id && r.atMs >= todayStart.getTime()).sort((a, b) => a.atMs - b.atMs);

  return `
    <h1>Bater ponto — ${escapeHtml(selected.name)}</h1>
    <p class="lede">PIS ${escapeHtml(selected.pis || "não cadastrado")} · <a href="#" onclick="event.preventDefault();STATE.pontoSelectedEmployeeId=null;render()">trocar colaborador</a></p>

    <div class="ponto-actions">
      ${PONTO_TYPES.map((t) => `<button class="${t.cls}" onclick="registerPonto('${selected.id}', '${t.type}')"><span style="font-size:28px">${t.icon}</span>${t.label}</button>`).join("")}
    </div>

    <div class="panel">
      <h2 style="margin-top:0;font-family:var(--font-display);font-weight:400;font-size:var(--text-md);color:var(--color-dark)">Marcações de hoje</h2>
      ${todayRecords.length === 0 ? '<p class="hint">Nenhuma marcação ainda hoje.</p>' : `
        <table class="data-table">
          <thead><tr><th>Horário</th><th>Tipo</th><th>NSR</th></tr></thead>
          <tbody>${todayRecords.map((r) => `<tr><td>${fmtTime(r.atMs)}</td><td>${ponteTypeLabel(r.type)}</td><td class="mono">${r.nsr}</td></tr>`).join("")}</tbody>
        </table>
      `}
    </div>
  `;
}

function ponteTypeLabel(type) {
  return (PONTO_TYPES.find((t) => t.type === type) || {}).label || type;
}

function registerPonto(employeeId, type) {
  const employee = STATE.employees.find((e) => e.id === employeeId);
  STATE.nsrCounter++;
  STATE.pontoRecords.push({ id: uid("ponto"), employeeId, type, atMs: Date.now(), nsr: STATE.nsrCounter });
  toast(`${employee.name} — ${ponteTypeLabel(type)} registrada às ${fmtTime(Date.now())}`);
  render();
}

// ═══════════════════════════════════════════════════════════════════
// TELA — Relatório (área de gestão: tabelas e filtros são bem-vindos
// aqui, ao contrário das telas de operação do dia a dia)
// ═══════════════════════════════════════════════════════════════════

const RELATORIO_TABS = [
  { id: "vendas", label: "Vendas" },
  { id: "criancas", label: "Crianças" },
  { id: "ponto-gerencial", label: "Folha de Ponto Gerencial" },
  { id: "faturamento", label: "Faturamento" },
  { id: "visitas", label: "Visitas" },
];

function setRelatorioTab(tab) {
  STATE.relatorioTab = tab;
  render();
}

function renderRelatorio() {
  let body;
  switch (STATE.relatorioTab) {
    case "vendas": body = renderRelVendas(); break;
    case "criancas": body = renderRelCriancas(); break;
    case "ponto-gerencial": body = renderRelFolhaPonto(); break;
    case "faturamento": body = renderRelFaturamento(); break;
    case "visitas": body = renderRelVisitas(); break;
    default: body = "";
  }
  return `
    <h1>Relatório</h1>
    <p class="lede">Dados dos dois pontos (Loja e Quiosque) consolidados. Só existem enquanto a aba do navegador estiver aberta — este protótipo não persiste nada.</p>
    <div class="config-tabs">${RELATORIO_TABS.map((t) => `<button class="${STATE.relatorioTab === t.id ? "active" : ""}" onclick="setRelatorioTab('${t.id}')">${t.label}</button>`).join("")}</div>
    ${body}
  `;
}

// ── Vendas ──

function renderRelVendas() {
  const events = collectCashEvents().filter((e) => e.type === "VENDA");
  const total = events.reduce((s, e) => s + e.amountCents, 0);
  return `
    <div class="panel">
      <p class="hint" style="margin-bottom:10px">${events.length} venda(s) · total ${money(total)}</p>
      ${events.length === 0 ? '<p class="hint">Nenhuma venda registrada.</p>' : `
        <table class="data-table">
          <thead><tr><th>Horário</th><th>Unidade</th><th>Método</th><th>Descrição</th><th class="num">Valor</th></tr></thead>
          <tbody>${events.map((e) => `<tr><td>${fmtTime(e.atMs)}</td><td>${e.unit === "QUIOSQUE" ? "Quiosque" : "Loja"}</td><td>${e.method}</td><td>${escapeHtml(e.label)}</td><td class="num">${money(e.amountCents)}</td></tr>`).join("")}</tbody>
        </table>
      `}
    </div>
  `;
}

// ── Crianças (filtro por mês de aniversário) ──

const MONTH_NAMES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

function renderRelCriancas() {
  const filter = STATE.relCriancasMonth ?? "TODOS";
  let children = STATE.children;
  if (filter !== "TODOS") {
    const monthIdx = parseInt(filter, 10);
    children = children.filter((c) => c.birthDate && new Date(c.birthDate + "T00:00:00").getMonth() === monthIdx);
  }
  return `
    <div class="panel">
      <div class="filter-bar">
        <div class="field"><label>Mês de aniversário</label>
          <select onchange="STATE.relCriancasMonth=this.value;render()">
            <option value="TODOS" ${filter === "TODOS" ? "selected" : ""}>Todos os meses</option>
            ${MONTH_NAMES.map((m, i) => `<option value="${i}" ${filter === String(i) ? "selected" : ""}>${m}</option>`).join("")}
          </select>
        </div>
      </div>
      <p class="hint" style="margin-bottom:10px">${children.length} criança(s) — útil para campanha de aniversário no WhatsApp.</p>
      ${children.length === 0 ? '<p class="hint">Nenhuma criança neste recorte.</p>' : `
        <table class="data-table">
          <thead><tr><th>Criança</th><th>Nascimento</th><th>Responsável</th><th>WhatsApp</th><th class="num">Visitas</th></tr></thead>
          <tbody>${children.map((c) => `<tr><td>${escapeHtml(c.childName)} ${renderVisitBadge(c)}</td><td>${c.birthDate ? new Date(c.birthDate + "T00:00:00").toLocaleDateString("pt-BR") : "—"}</td><td>${escapeHtml(c.guardianName)}</td><td>${escapeHtml(c.guardianPhone)}</td><td class="num">${totalVisits(c)}</td></tr>`).join("")}</tbody>
        </table>
      `}
    </div>
  `;
}

// ── Folha de Ponto Gerencial (filtro por mês) ──

function renderRelFolhaPonto() {
  const now = new Date();
  const filter = STATE.relPontoMonth ?? `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
  const [fy, fm] = filter.split("-").map(Number);

  const recordsInMonth = STATE.pontoRecords.filter((r) => {
    const d = new Date(r.atMs);
    return d.getFullYear() === fy && d.getMonth() + 1 === fm;
  });

  return `
    <div class="panel">
      <div class="filter-bar">
        <div class="field"><label>Mês</label><input type="month" value="${filter}" onchange="STATE.relPontoMonth=this.value;render()" /></div>
      </div>
      ${STATE.employees.length === 0 ? '<p class="hint">Nenhum colaborador cadastrado.</p>' : STATE.employees.map((e) => {
        const records = recordsInMonth.filter((r) => r.employeeId === e.id).sort((a, b) => a.atMs - b.atMs);
        return `
          <div style="margin-bottom:var(--space-5)">
            <p style="font-weight:700;margin:0 0 6px">${escapeHtml(e.name)} <span class="hint">PIS ${escapeHtml(e.pis || "—")} · ${records.length} marcação(ões) no mês</span></p>
            ${records.length === 0 ? '<p class="hint">Sem marcações neste mês.</p>' : `
              <table class="data-table">
                <thead><tr><th>Data</th><th>Horário</th><th>Tipo</th><th>NSR</th></tr></thead>
                <tbody>${records.map((r) => `<tr><td>${new Date(r.atMs).toLocaleDateString("pt-BR")}</td><td>${fmtTime(r.atMs)}</td><td>${ponteTypeLabel(r.type)}</td><td class="mono">${r.nsr}</td></tr>`).join("")}</tbody>
              </table>
            `}
          </div>
        `;
      }).join("")}
    </div>
  `;
}

// ── Faturamento (agregado — distinto do log bruto de Movimentação de Caixa) ──

function renderRelFaturamento() {
  const events = collectCashEvents().filter((e) => e.type === "VENDA");
  const total = events.reduce((s, e) => s + e.amountCents, 0);

  const byUnit = { LOJA: 0, QUIOSQUE: 0 };
  const byMethod = { DINHEIRO: 0, PIX: 0, CREDITO: 0, DEBITO: 0 };
  for (const e of events) {
    byUnit[e.unit] = (byUnit[e.unit] || 0) + e.amountCents;
    byMethod[e.method] = (byMethod[e.method] || 0) + e.amountCents;
  }

  return `
    <div class="panel" style="margin-bottom:var(--space-6)">
      <p class="hint">Faturamento total no período disponível na sessão</p>
      <p style="font-size:32px;font-weight:800;color:var(--color-dark);margin:4px 0 0">${money(total)}</p>
    </div>
    <div class="grid-2">
      <div class="panel">
        <h2 style="margin-top:0;font-family:var(--font-display);font-weight:400;font-size:var(--text-md);color:var(--color-dark)">Por unidade</h2>
        <div class="method-stats" style="grid-template-columns:1fr 1fr">
          <div class="method-stat"><div class="label">Loja</div><div class="value">${money(byUnit.LOJA)}</div></div>
          <div class="method-stat"><div class="label">Quiosque</div><div class="value">${money(byUnit.QUIOSQUE)}</div></div>
        </div>
      </div>
      <div class="panel">
        <h2 style="margin-top:0;font-family:var(--font-display);font-weight:400;font-size:var(--text-md);color:var(--color-dark)">Por método</h2>
        <div class="method-stats">
          <div class="method-stat"><div class="label">Dinheiro</div><div class="value">${money(byMethod.DINHEIRO)}</div></div>
          <div class="method-stat"><div class="label">PIX</div><div class="value">${money(byMethod.PIX)}</div></div>
          <div class="method-stat"><div class="label">Crédito</div><div class="value">${money(byMethod.CREDITO)}</div></div>
          <div class="method-stat"><div class="label">Débito</div><div class="value">${money(byMethod.DEBITO)}</div></div>
        </div>
      </div>
    </div>
  `;
}

// ── Visitas ──

function renderRelVisitas() {
  const ranked = [...STATE.children].sort((a, b) => totalVisits(b) - totalVisits(a));
  const totalPlayground = STATE.children.reduce((s, c) => s + (c.visitsByActivity.PLAYGROUND || 0), 0);
  const totalCarrinho = STATE.children.reduce((s, c) => s + (c.visitsByActivity.CARRINHO || 0), 0);
  return `
    <div class="panel" style="margin-bottom:var(--space-6)">
      <div class="method-stats" style="grid-template-columns:1fr 1fr">
        <div class="method-stat"><div class="label">Visitas — Playground</div><div class="value">${totalPlayground}</div></div>
        <div class="method-stat"><div class="label">Visitas — Circuito</div><div class="value">${totalCarrinho}</div></div>
      </div>
    </div>
    <div class="panel">
      <h2 style="margin-top:0;font-family:var(--font-display);font-weight:400;font-size:var(--text-md);color:var(--color-dark)">Ranking de visitas por criança</h2>
      ${ranked.length === 0 ? '<p class="hint">Nenhuma visita registrada.</p>' : `
        <table class="data-table">
          <thead><tr><th>Criança</th><th class="num">Playground</th><th class="num">Circuito</th><th class="num">Total</th></tr></thead>
          <tbody>${ranked.map((c) => `<tr><td>${escapeHtml(c.childName)} ${renderVisitBadge(c)}</td><td class="num">${c.visitsByActivity.PLAYGROUND || 0}</td><td class="num">${c.visitsByActivity.CARRINHO || 0}</td><td class="num">${totalVisits(c)}</td></tr>`).join("")}</tbody>
        </table>
      `}
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════════
// Modal genérico + toggles de topo
// ═══════════════════════════════════════════════════════════════════

function openModal(html) {
  document.getElementById("modal-root").innerHTML = `<div class="modal-backdrop" onclick="if(event.target===this) closeModal()"><div class="modal">${html}</div></div>`;
}
function closeModal() {
  document.getElementById("modal-root").innerHTML = "";
}
function toggleOffline() {
  STATE.offlineSimulated = !STATE.offlineSimulated;
  render();
}

// ═══════════════════════════════════════════════════════════════════
// Inicialização
// ═══════════════════════════════════════════════════════════════════

document.getElementById("unit-switch").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-unit]");
  if (btn) setUnit(btn.dataset.unit);
});
document.getElementById("nav-tabs").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-screen]");
  if (btn) setScreen(btn.dataset.screen);
});

setInterval(() => {
  if (STATE.currentScreen === "dashboard") render();
  if (STATE.closeModal) refreshCloseModal();
}, 1000);

render();
