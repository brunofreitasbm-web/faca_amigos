// Formatação das mensagens do Owner no Telegram (HTML do Bot API).
//
// O banco gera o texto de cada notificação (fa_owner_report_build_*); aqui só
// interpretamos esse texto por rótulos e remontamos com seções, emojis e
// índice. Qualquer coisa que não bata com o esperado devolve null e cai no
// formatGeneric — mudar o texto no banco nunca faz uma mensagem sumir, só
// volta ao layout simples.
//
// Módulo puro (sem Deno/Supabase) para rodar em teste com Node:
//   node --experimental-strip-types --test format.test.ts

const MONEY = /R\$\s*-?\d[\d,]*(?:\.\d+)?/g;
const MONEY_ONE = "R\\$\\s*-?\\d[\\d,]*(?:\\.\\d+)?";

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** "R$ 1,342.60" (formato do banco) → 1342.6 */
export function parseMoney(s: string): number | null {
  const m = s.match(/R\$\s*(-?\d[\d,]*(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** 1342.6 → "R$ 1.342,60" */
export function brl(n: number): string {
  const [int, dec] = Math.abs(n).toFixed(2).split(".");
  return `${n < 0 ? "-" : ""}R$ ${int.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${dec}`;
}

function brlSigned(n: number): string {
  if (Math.abs(n) < 0.005) return brl(0);
  return `${n > 0 ? "+" : "−"}${brl(Math.abs(n))}`;
}

/** Troca todo "R$ 1,342.60" do texto por "R$ 1.342,60". */
export function moneyIn(s: string): string {
  return s.replace(MONEY, (m) => {
    const n = parseMoney(m);
    return n === null ? m : brl(n);
  });
}

function pct(n: number, signed = false): string {
  return `${signed && n > 0 ? "+" : ""}${n.toFixed(1).replace(".", ",")}%`;
}

// Texto do banco → HTML seguro, com valores em reais no padrão brasileiro.
const t = (s: string): string => esc(moneyIn(s));

function lineValue(lines: string[], re: RegExp): RegExpMatchArray | null {
  for (const l of lines) {
    const m = l.trim().match(re);
    if (m) return m;
  }
  return null;
}

const NUM = ["0️⃣", "1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣"];

// ───────────────────────── genérico (fallback) ─────────────────────────

function formatBodyGeneric(body: string): string {
  const out: string[] = [];
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line) continue;

    const dashSplit = line.split(" — ");
    if (dashSplit.length === 2 && dashSplit[1].includes(": ")) {
      const [prefix, rest] = dashSplit;
      out.push(`\n<b>${esc(prefix)}</b>`);
      for (const item of rest.split(", ")) {
        const idx = item.indexOf(": ");
        if (idx === -1) out.push(esc(item));
        else out.push(`${esc(item.slice(0, idx))}: <b>${esc(item.slice(idx + 2))}</b>`);
      }
      continue;
    }

    const idx = line.indexOf(": ");
    const label = idx > 0 ? line.slice(0, idx) : "";
    if (idx > 0 && idx < 40 && !label.includes(" - ")) {
      out.push(`${esc(label)}: <b>${esc(line.slice(idx + 2))}</b>`);
    } else {
      out.push(esc(line));
    }
  }
  return out.join("\n");
}

export function formatGeneric(title: string, body: string): string {
  return `<b>${esc(title)}</b>\n\n${formatBodyGeneric(body)}`;
}

// ───────────────────────── divergências ─────────────────────────

type Div = {
  name: string;
  gaveta: boolean;
  declared: number | null;
  expected: number | null;
  /** negativo = falta/quebra, positivo = sobra */
  diff: number;
  just: string | null | undefined;
};

const METHOD_LABEL: Record<string, string> = {
  DINHEIRO: "💵 Dinheiro",
  DEBITO: "💳 Débito",
  CREDITO: "💳 Crédito",
  PIX: "⚡ Pix",
};

function parseDivergences(lines: string[]): { entries: Div[]; total: number | null; rest: string[] } {
  const entries: Div[] = [];
  const rest: string[] = [];
  let total: number | null = null;
  let last: Div | null = null;

  const method = new RegExp(
    `^([^:]+?):\\s*declarado\\s+(${MONEY_ONE})\\s+vs\\s+esperado\\s+(${MONEY_ONE})\\s*\\((falta|sobra) de (${MONEY_ONE})\\)`,
    "i",
  );
  const gaveta = new RegExp(
    `^GAVETA[^:]*:\\s*contado\\s+(${MONEY_ONE})\\s+vs\\s+esperado\\s+(${MONEY_ONE})\\s*\\((quebra|falta|sobra) de (${MONEY_ONE})\\)`,
    "i",
  );
  const totalRe = new RegExp(`(?:diferença|falta|sobra)\\s+total:\\s*(${MONEY_ONE})`, "i");

  for (const raw of lines) {
    const l = raw.trim();
    if (!l) continue;

    const g = l.match(gaveta);
    if (g) {
      const amount = parseMoney(g[4]) ?? 0;
      last = {
        name: "GAVETA",
        gaveta: true,
        declared: parseMoney(g[1]),
        expected: parseMoney(g[2]),
        diff: g[3].toLowerCase() === "sobra" ? amount : -amount,
        just: undefined,
      };
      entries.push(last);
      continue;
    }
    const m = l.match(method);
    if (m) {
      const amount = parseMoney(m[5]) ?? 0;
      last = {
        name: m[1].trim(),
        gaveta: false,
        declared: parseMoney(m[2]),
        expected: parseMoney(m[3]),
        diff: m[4].toLowerCase() === "sobra" ? amount : -amount,
        just: undefined,
      };
      entries.push(last);
      continue;
    }
    const j = l.match(/^justificativa:\s*(.*)$/i);
    if (j && last) {
      last.just = j[1].trim() || null;
      continue;
    }
    if (/^sem justificativa/i.test(l) && last) {
      last.just = null;
      continue;
    }
    const tt = l.match(totalRe);
    if (tt && total === null) {
      total = parseMoney(tt[1]);
      continue;
    }
    rest.push(l);
  }
  return { entries, total, rest };
}

function renderDivergences(entries: Div[], total: number | null, rest: string[]): string {
  const out: string[] = [];
  const seen = new Map<string, string>();

  for (const e of entries) {
    const label = e.gaveta ? "🗄️ Gaveta (contagem física)" : (METHOD_LABEL[e.name.toUpperCase()] ?? `🔸 ${e.name}`);
    const kind = e.diff < 0 ? (e.gaveta ? "quebra" : "falta") : "sobra";
    const mark = e.diff < 0 ? "🔻" : "🔺";
    out.push(`${mark} <b>${esc(label)}</b> · ${kind} de <b>${brl(Math.abs(e.diff))}</b>`);
    if (e.declared !== null && e.expected !== null) {
      const what = e.gaveta ? ["contado", "esperado"] : ["declarado", "esperado"];
      out.push(`     ${what[0]} ${brl(e.declared)} · ${what[1]} ${brl(e.expected)}`);
    }
    if (e.just) {
      const key = e.just.toLowerCase();
      const prev = seen.get(key);
      out.push(prev ? `     📝 <i>mesma justificativa de ${esc(prev)}</i>` : `     📝 <i>${esc(e.just)}</i>`);
      if (!prev) seen.set(key, label.replace(/^\S+\s/, ""));
    } else if (e.just === null) {
      out.push(`     📝 <i>sem justificativa</i>`);
    }
  }

  // "diferença total" do banco soma o módulo de cada linha, então conta o
  // mesmo erro mais de uma vez (ex.: R$ 96 no débito, no dinheiro e na gaveta).
  // A líquida soma com sinal só os meios de pagamento (a gaveta é o reflexo).
  const pay = entries.filter((e) => !e.gaveta);
  const parts: string[] = [];
  if (total !== null) parts.push(`bruta (sistema): <b>${brl(total)}</b>`);
  if (pay.length > 0) {
    const net = pay.reduce((s, e) => s + e.diff, 0);
    const word = Math.abs(net) < 0.005 ? "" : net < 0 ? " (falta)" : " (sobra)";
    parts.push(`líquida: <b>${brlSigned(net)}</b>${word}`);
  }
  if (parts.length > 0) out.push(`\n🧾 ${parts.join(" · ")}`);

  for (const r of rest) out.push(t(r));
  return out.join("\n");
}

// ───────────────────────── fechamento ─────────────────────────

function metaLine(metaText: string, faturado: number | null): string {
  if (/n[ãa]o definida/i.test(metaText)) return "⚪ Meta: <b>não definida</b>";
  const meta = parseMoney(metaText);
  if (meta === null || meta <= 0) return `🎯 Meta: ${t(metaText)}`;

  let p: number | null = null;
  const explicit = metaText.match(/([\d.]+)%\s*atingida/i);
  if (explicit) p = Number(explicit[1]);
  else if (faturado !== null) p = (faturado / meta) * 100;
  if (p === null || !Number.isFinite(p)) return `🎯 Meta: ${t(metaText)}`;

  const dot = p >= 100 ? "🟢" : p >= 80 ? "🟡" : "🔴";
  let tail = "";
  if (faturado !== null) {
    tail = faturado >= meta
      ? ` (${brl(faturado - meta)} acima)`
      : ` (faltaram ${brl(meta - faturado)})`;
  }
  return `🎯 Meta: ${brl(meta)} → <b>${pct(p)}</b> ${dot}${tail}`;
}

function caixaEmoji(label: string): string {
  if (/contad/i.test(label)) return "✋";
  if (/esperad/i.test(label)) return "🧮";
  if (/pr[óo]ximo dia/i.test(label)) return "➡️";
  if (/envelope/i.test(label)) return "✉️";
  if (/em dinheiro/i.test(label)) return "💵";
  if (/inicial|abertura/i.test(label)) return "🔹";
  return "🔸";
}

function renderCaixaLine(line: string): string[] {
  const contado = line.match(
    new RegExp(
      `^(.*?):\\s*(${MONEY_ONE})\\s*\\(esperado (${MONEY_ONE}),\\s*(quebra|sobra)(?: de (${MONEY_ONE}))?\\)`,
      "i",
    ),
  );
  if (contado) {
    const sobra = contado[4].toLowerCase() === "sobra";
    const amount = contado[5] ? parseMoney(contado[5]) : null;
    const rows = [
      `✋ ${esc(contado[1].trim())}: <b>${brl(parseMoney(contado[2]) ?? 0)}</b>`,
      `🧮 Esperado: ${brl(parseMoney(contado[3]) ?? 0)}`,
    ];
    rows.push(
      amount === null
        ? `${sobra ? "💡 Sobra" : "⚠️ Quebra"}`
        : `${sobra ? "🔺 Sobra" : "🔻 Quebra"}: <b>${brl(amount)}</b> ${sobra ? "💡" : "⚠️"}`,
    );
    return rows;
  }
  const idx = line.indexOf(": ");
  if (idx <= 0) return [`🔸 ${t(line)}`];
  const label = line.slice(0, idx);
  return [`${caixaEmoji(label)} ${esc(label)}: <b>${t(line.slice(idx + 2))}</b>`];
}

function formatFechamento(title: string, body: string): string | null {
  const all = body.split("\n");
  const divAt = all.findIndex((l) => /^\s*(⚠️|💡)\s*(Divergência|Informação de sobra)/i.test(l));
  const main = (divAt >= 0 ? all.slice(0, divAt) : all).map((l) => l.trim()).filter(Boolean);
  const divLines = divAt >= 0 ? all.slice(divAt) : [];

  const head = lineValue(main, /^(.*?) - Data:\s*(.+)$/);
  const fat = lineValue(main, /^Valor Faturado:\s*(.+)$/i);
  const det = lineValue(main, /^Detalhamento faturado\s*[—-]\s*(.+)$/i);
  if (!head || !fat || !det) return null;

  const faturado = parseMoney(fat[1]);
  if (faturado === null) return null;

  const meta = lineValue(main, /^Meta do dia:\s*(.+)$/i);
  const sess = lineValue(main, /^Total de sessões\/locações:\s*(\d+)/i);

  const consumed = /^(.*? - Data:|Valor Faturado:|Meta do dia:|Total de sessões\/locações:|Detalhamento faturado)/i;
  const caixa = main.filter((l) => !consumed.test(l));

  const items = det[1].split(", ").map((i) => i.match(new RegExp(`^([^:]+):\\s*(${MONEY_ONE})$`)));
  if (items.some((i) => i === null)) return null;
  const rows = (items as RegExpMatchArray[]).map((m) => ({ label: m[1].trim(), value: parseMoney(m[2]) ?? 0 }));
  const sum = rows.reduce((s, r) => s + r.value, 0);

  const wl = Math.max(...rows.map((r) => r.label.length), 5);
  const vals = [...rows.map((r) => brl(r.value)), brl(faturado)];
  const wv = Math.max(...vals.map((v) => v.length));
  const tbl = rows.map((r, i) => `${r.label.padEnd(wl)}  ${vals[i].padStart(wv)}`);
  tbl.push("─".repeat(wl + 2 + wv), `${"Total".padEnd(wl)}  ${brl(faturado).padStart(wv)}`);

  const div = divLines.length ? parseDivergences(divLines) : null;
  const hasDiv = div !== null && div.entries.length > 0;
  const sobraOnly = hasDiv && /Informação de sobra/i.test(divLines[0]);

  const index = ["1️⃣ Resultado", "2️⃣ Caixa", "3️⃣ Pagamentos"];
  if (hasDiv) index.push(`4️⃣ ${sobraOnly ? "Sobras" : "Divergências"}`);

  const out: string[] = [
    `<b>${esc(title)}</b>`,
    `👤 ${esc(head[1].trim())} · 📅 ${esc(head[2].trim().replace(", ", " às "))}`,
    "",
    `<b>📑 Índice</b>`,
    index.join(" · "),
    "",
    `<b>${NUM[1]} 📊 RESULTADO DO DIA</b>`,
    `💰 Faturado: <b>${brl(faturado)}</b>`,
  ];
  if (meta) out.push(metaLine(meta[1], faturado));
  if (sess) out.push(`🎟️ Sessões/locações: <b>${sess[1]}</b>`);

  if (caixa.length > 0) {
    out.push("", `<b>${NUM[2]} 🗄️ CAIXA E GAVETA</b>`);
    for (const l of caixa) out.push(...renderCaixaLine(l));
  }

  out.push("", `<b>${NUM[3]} 💳 FORMAS DE PAGAMENTO</b>`, `<pre>${esc(tbl.join("\n"))}</pre>`);
  if (Math.abs(sum - faturado) > 0.01) {
    out.push(`⚠️ A soma dos meios (${brl(sum)}) difere do faturado.`);
  }

  if (hasDiv && div) {
    out.push(
      "",
      `<b>${NUM[4]} ${sobraOnly ? "💡 SOBRAS" : "⚠️ DIVERGÊNCIAS"}</b> (${div.entries.length} ${div.entries.length === 1 ? "item" : "itens"})`,
      renderDivergences(div.entries, div.total, div.rest.filter((r) => !/^(⚠️|💡)/.test(r))),
    );
  }
  return out.join("\n");
}

function formatDivergenciaFechamento(title: string, body: string): string | null {
  const { entries, total, rest } = parseDivergences(body.split("\n"));
  if (entries.length === 0) return null;
  return [`<b>${esc(title)}</b>`, "", renderDivergences(entries, total, rest)].join("\n");
}

// ───────────────────────── abertura ─────────────────────────

function formatAbertura(title: string, body: string): string | null {
  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
  const who = lineValue(lines, /^(.*) abriu o caixa às (\d{1,2}:\d{2})/);
  const prev = lineValue(lines, /^Fundo previsto[^:]*:\s*(.+)$/i);
  const cont = lineValue(lines, /^Fundo de Caixa contado[^:]*:\s*(.+)$/i);
  if (!who || !prev || !cont) return null;

  const used = /^(.* abriu o caixa às|Fundo previsto|Fundo de Caixa contado)/i;
  const extra = lines.filter((l) => !used.test(l));

  const out = [
    `<b>${esc(title)}</b>`,
    "",
    `🔓 <b>${esc(who[1].trim())}</b> abriu o caixa às <b>${who[2]}</b>`,
    "",
    `🧮 Fundo previsto (fechamento anterior): <b>${t(prev[1])}</b>`,
    `✋ Fundo contado na abertura: <b>${t(cont[1])}</b>`,
  ];
  for (const l of extra) {
    const falta = /\bFALTA\b/i.test(l);
    const sobra = /\bSOBRA\b/i.test(l);
    const clean = l.replace(/^(⚠️|💡)\s*/, "");
    out.push(`${falta ? "⚠️" : sobra ? "💡" : "🔸"} <b>${t(clean)}</b>`);
  }
  return out.join("\n");
}

// ───────────────────────── demais tipos ─────────────────────────

const CARGO: Record<string, string> = { SERVICOS_GERAIS: "Serviços gerais" };

function words(s: string): string {
  const lower = s.replace(/_/g, " ").trim().toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function phoneLine(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 13) return `📞 ${esc(raw)}`;
  const intl = digits.startsWith("55") && digits.length >= 12 ? digits : `55${digits}`;
  const local = intl.slice(2);
  const shown = local.length === 11
    ? `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`
    : `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return `📞 <a href="https://wa.me/${intl}">${shown}</a>`;
}

function formatCandidatura(title: string, body: string): string | null {
  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
  const first = lines[0]?.match(/^(.+?) — ([A-Z0-9_ ]+?)(?: \(([A-Z0-9_ ]+)\))?$/);
  const contato = lineValue(lines, /^Contato:\s*(.+)$/i);
  if (!first) return null;

  const out = [
    `<b>${esc(title)}</b>`,
    "",
    `🙋 <b>${esc(first[1].trim())}</b>`,
    `💼 ${esc(CARGO[first[2].trim()] ?? words(first[2]))}${first[3] ? ` · ${esc(words(first[3]))}` : ""}`,
  ];
  if (contato) out.push(phoneLine(contato[1].trim()));
  for (const l of lines.slice(1)) if (!/^Contato:/i.test(l)) out.push(t(l));
  return out.join("\n");
}

function trend(v: number): string {
  return v > 0 ? "📈" : v < 0 ? "📉" : "➖";
}

function formatResumoSemanal(title: string, body: string): string | null {
  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
  const sem = lineValue(lines, /^Semana\s+(.+)$/i);
  const fat = lineValue(lines, /^Faturado:\s*(.+)$/i);
  const vis = lineValue(lines, /^Visitas\/locações:\s*(\d+)(.*)$/i);
  if (!sem || !fat || !vis) return null;

  const money = parseMoney(fat[1]);
  if (money === null) return null;
  const variation = (s: string): string => {
    const m = s.match(/([+-]?\d+(?:\.\d+)?)%/);
    if (!m) return "";
    const n = Number(m[1]);
    return ` ${trend(n)} <b>${pct(n, true)}</b> vs semana anterior`;
  };

  const used = /^(Semana|Faturado:|Visitas\/locações:)/i;
  const out = [
    `<b>${esc(title)}</b>`,
    "",
    `📅 Semana <b>${esc(sem[1].trim())}</b>`,
    `💰 Faturado: <b>${brl(money)}</b>${variation(fat[1])}`,
    `🎟️ Visitas/locações: <b>${vis[1]}</b>${variation(vis[2])}`,
  ];
  for (const l of lines) if (!used.test(l)) out.push(t(l));
  return out.join("\n");
}

function formatOcorrencia(title: string, body: string): string | null {
  const lines = body.split("\n");
  const first = lines[0]?.trim().match(/^(.+): (Atestado médico|Falta) \((\d+) dias?\)$/);
  if (!first) return null;
  const atestado = first[2] === "Atestado médico";
  const n = Number(first[3]);
  const obsAt = lines.findIndex((l) => /^\s*Obs:/i.test(l));
  const obs = obsAt >= 0 ? [lines[obsAt].replace(/^\s*Obs:\s*/i, ""), ...lines.slice(obsAt + 1)].join("\n").trim() : "";

  const out = [
    `<b>${esc(title)}</b>`,
    "",
    `👤 <b>${esc(first[1].trim())}</b>`,
    `${atestado ? "🩺 Atestado médico" : "🚫 Falta"} · <b>${n} ${n === 1 ? "dia" : "dias"}</b>`,
  ];
  if (obs) out.push(`📝 <i>${esc(obs)}</i>`);
  return out.join("\n");
}

function formatAvaliacao(title: string, body: string): string | null {
  const lines = body.split("\n");
  const nota = lines[0]?.trim().match(/^Nota:\s*(\d)\s*\/\s*5/i);
  if (!nota) return null;
  const n = Math.min(5, Number(nota[1]));
  const cAt = lines.findIndex((l) => /^\s*Coment[áa]rio:/i.test(l));
  const comment = cAt >= 0
    ? [lines[cAt].replace(/^\s*Coment[áa]rio:\s*/i, ""), ...lines.slice(cAt + 1)].join("\n").trim()
    : "";

  const out = [`<b>${esc(title)}</b>`, "", `${"⭐".repeat(n)}${"☆".repeat(5 - n)} <b>${n}/5</b>`];
  if (comment) out.push(`💬 <i>${esc(comment)}</i>`);
  return out.join("\n");
}

// ───────────────────────── entrada ─────────────────────────

const FORMATTERS: Record<string, (title: string, body: string) => string | null> = {
  FECHAMENTO: formatFechamento,
  DIVERGENCIA_FECHAMENTO: formatDivergenciaFechamento,
  ABERTURA: formatAbertura,
  DIVERGENCIA_ABERTURA: formatAbertura,
  CANDIDATURA_TALENTOS: formatCandidatura,
  RESUMO_SEMANAL: formatResumoSemanal,
  OCORRENCIA_COLABORADOR: formatOcorrencia,
  AVALIACAO_NEGATIVA: formatAvaliacao,
};

/** Mensagem em HTML do Telegram; nunca lança — cai no formato genérico. */
export function formatMessage(reportType: string, title: string, body: string): string {
  try {
    const out = FORMATTERS[reportType]?.(title, body);
    if (out) return out;
  } catch {
    // cai no genérico
  }
  return formatGeneric(title, body);
}
