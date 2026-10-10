// node --experimental-strip-types --test supabase/functions/owner-telegram-dispatch/format.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { brl, formatGeneric, formatMessage, moneyIn, parseMoney } from "./format.ts";

const UNIT = "Faça Amigos Playground (Parque Shopping)";

// Corpos copiados de fa_kiosk_owner_notifications (produção).
const FECHAMENTO_0910 = `Estheffany Araujo Ferreira - Data: 09/10/2026, 22:23
Valor Faturado: R$ 1,342.60
Meta do dia: R$ 1,500.00 (89.5% atingida)
Total de sessões/locações: 14
Fundo de Caixa inicial: R$ 144.35
Faturamento em dinheiro: R$ 204.00
Dinheiro contado na gaveta: R$ 252.35 (esperado R$ 348.35, QUEBRA de R$ 96.00)
Fundo de Caixa para o próximo dia: R$ 252.35
Valor em Envelope: R$ 0.00
Detalhamento faturado — Dinheiro: R$ 204.00, Crédito: R$ 333.20, Débito: R$ 271.20, Pix: R$ 534.20

⚠️ Divergência no fechamento — diferença total: R$ 288.00
DEBITO: declarado R$ 367.20 vs esperado R$ 271.20 (sobra de R$ 96.00)
  sem justificativa
DINHEIRO: declarado R$ 108.00 vs esperado R$ 204.00 (falta de R$ 96.00)
  justificativa: UM VALOR DE 96 REAIS ESTA A MAIS NA MAQUININHA NO DEBITO, NO SITEMA ESTA CONTANDO MENOS (271,20)
GAVETA (contagem física): contado R$ 252.35 vs esperado R$ 348.35 (quebra de R$ 96.00)
  justificativa: UM VALOR DE 96 REAIS ESTA A MAIS NA MAQUININHA NO DEBITO, NO SITEMA ESTA CONTANDO MENOS (271,20)`;

const FECHAMENTO_SEM_META = `Ana Alice Silva Monteiro - Data: 02/09/2026, 22:10
Valor Faturado: R$ 912.80
Meta do dia: Não definida
Total de sessões/locações: 10
Fundo de Caixa inicial: R$ 106.25
Faturamento em dinheiro: R$ 346.80
Dinheiro contado na gaveta: R$ 438.65 (esperado R$ 453.05, QUEBRA de R$ 14.40)
Fundo de Caixa para o próximo dia: R$ 106.25
Valor em Envelope: R$ 332.40
Detalhamento faturado — Dinheiro: R$ 346.80, Crédito: R$ 223.20, Débito: R$ 216.00, Pix: R$ 126.80

⚠️ Divergência no fechamento — diferença total: R$ 33.80
DINHEIRO: declarado R$ 332.40 vs esperado R$ 346.80 (falta de R$ 14.40)
  justificativa: esta dando difernça pq na hora que estavamos contando o troco
PIX: declarado R$ 121.80 vs esperado R$ 126.80 (falta de R$ 5.00)
  justificativa: dando difernça pq seu bruno estava fazendo teste
GAVETA (contagem física): contado R$ 438.65 vs esperado R$ 453.05 (quebra de R$ 14.40)
  justificativa: na hora que fui finalizar estavamos contando o troco`;

const DIVERGENCIA_FECHAMENTO = `Diferença total: R$ 33.80
DINHEIRO: declarado R$ 332.40 vs esperado R$ 346.80 (falta de R$ 14.40)
  justificativa: esta dando difernça
PIX: declarado R$ 121.80 vs esperado R$ 126.80 (falta de R$ 5.00)
  justificativa: dando difernça pq seu bruno estava fazendo teste
GAVETA (contagem física): contado R$ 438.65 vs esperado R$ 453.05 (quebra de R$ 14.40)
  justificativa: na hora que fui finalizar`;

const ABERTURA = `Alessandra de Oliveira Nascimento abriu o caixa às 10:05
Fundo previsto (fechamento anterior): R$ 106.25
Fundo de Caixa contado na abertura: R$ 88.65
⚠️ FALTA de R$ 17.60 em relação ao fechamento anterior`;

const ABERTURA_SOBRA = `Alessandra de Oliveira Nascimento abriu o caixa às 09:58
Fundo previsto (fechamento anterior): R$ 0.00
Fundo de Caixa contado na abertura: R$ 1.00
⚠️ SOBRA de R$ 1.00 em relação ao fechamento anterior`;

const CANDIDATURA = `Nathália Lorena Barros Leite Rodrigues — SERVICOS_GERAIS (REMUNERADO)
Contato: 91989505304`;

const RESUMO = `Semana 07/09 a 13/09
Faturado: R$ 10,323.90 (+22.8% vs semana anterior)
Visitas/locações: 134 (+22.9% vs semana anterior)`;

/** Todas as tags abertas são fechadas e não sobra "<" ou ">" fora de tag. */
function assertValidTelegramHtml(html: string): void {
  const stack: string[] = [];
  const re = /<(\/?)([a-z]+)(?:\s[^>]*)?>/g;
  let rest = html;
  for (const m of html.matchAll(re)) {
    if (m[1]) assert.equal(stack.pop(), m[2], `tag </${m[2]}> sem par em:\n${html}`);
    else stack.push(m[2]);
  }
  assert.deepEqual(stack, [], `tags abertas sem fechar em:\n${html}`);
  rest = html.replace(re, "");
  assert.ok(!/[<>]/.test(rest), `< ou > solto em:\n${html}`);
  assert.ok(html.length <= 4096, "passou do limite do Telegram");
}

test("dinheiro: banco (en) → pt-BR", () => {
  assert.equal(parseMoney("R$ 1,342.60"), 1342.6);
  assert.equal(brl(1342.6), "R$ 1.342,60");
  assert.equal(brl(0.5), "R$ 0,50");
  assert.equal(moneyIn("falta de R$ 17.60 em relação"), "falta de R$ 17,60 em relação");
});

test("FECHAMENTO com divergência: seções, meta, tabela e leitura líquida", () => {
  const out = formatMessage("FECHAMENTO", `🏠 Fechamento ${UNIT}`, FECHAMENTO_0910);
  console.log(`\n${out}\n`);
  assertValidTelegramHtml(out);
  assert.match(out, /1️⃣ Resultado · 2️⃣ Caixa · 3️⃣ Pagamentos · 4️⃣ Divergências/);
  assert.match(out, /Faturado: <b>R\$ 1\.342,60<\/b>/);
  assert.match(out, /Meta: R\$ 1\.500,00 → <b>89,5%<\/b> 🟡 \(faltaram R\$ 157,40\)/);
  assert.match(out, /Sessões\/locações: <b>14<\/b>/);
  assert.match(out, /Contado na gaveta|contado na gaveta/i);
  assert.match(out, /Quebra: <b>R\$ 96,00<\/b>/);
  assert.match(out, /<pre>[\s\S]*Total\s+R\$ 1\.342,60[\s\S]*<\/pre>/);
  assert.match(out, /bruta \(sistema\): <b>R\$ 288,00<\/b> · líquida: <b>R\$ 0,00<\/b>/);
  // a justificativa repetida da gaveta vira referência
  assert.match(out, /mesma justificativa de Dinheiro/);
  assert.match(out, /sem justificativa/);
});

test("FECHAMENTO sem meta definida", () => {
  const out = formatMessage("FECHAMENTO", `🏠 Fechamento ${UNIT}`, FECHAMENTO_SEM_META);
  assertValidTelegramHtml(out);
  assert.match(out, /⚪ Meta: <b>não definida<\/b>/);
  assert.match(out, /líquida: <b>−R\$ 19,40<\/b> \(falta\)/);
});

test("FECHAMENTO: meta batida (variante do repo) e sem divergência", () => {
  const body = `Fulano - Data: 10/10/2026, 22:00
Valor Faturado: R$ 1,600.00
Meta do Dia: R$ 1,500.00 (🎯 META BATEDA! R$ 100.00 acima)
Total de sessões/locações: 20
Fundo de Caixa inicial: R$ 100.00
Detalhamento faturado — Dinheiro: R$ 600.00, Crédito: R$ 500.00, Débito: R$ 200.00, Pix: R$ 300.00`;
  const out = formatMessage("FECHAMENTO", "🏠 Fechamento X", body);
  assertValidTelegramHtml(out);
  assert.match(out, /<b>106,7%<\/b> 🟢 \(R\$ 100,00 acima\)/);
  assert.ok(!/4️⃣/.test(out), "sem divergência não deve ter bloco 4");
});

test("FECHAMENTO: meta baixa vira 🔴", () => {
  const body = FECHAMENTO_0910.replace("89.5% atingida", "50.0% atingida");
  assert.match(formatMessage("FECHAMENTO", "T", body), /50,0%<\/b> 🔴/);
});

test("DIVERGENCIA_FECHAMENTO", () => {
  const out = formatMessage("DIVERGENCIA_FECHAMENTO", `🏠 ⚠️ Divergência no fechamento — ${UNIT}`, DIVERGENCIA_FECHAMENTO);
  console.log(`\n${out}\n`);
  assertValidTelegramHtml(out);
  assert.match(out, /🔻 <b>💵 Dinheiro<\/b> · falta de <b>R\$ 14,40<\/b>/);
  assert.match(out, /bruta \(sistema\): <b>R\$ 33,80<\/b> · líquida: <b>−R\$ 19,40<\/b> \(falta\)/);
});

test("ABERTURA e DIVERGENCIA_ABERTURA (falta e sobra)", () => {
  for (const type of ["ABERTURA", "DIVERGENCIA_ABERTURA"]) {
    const out = formatMessage(type, `🏠 Abertura ${UNIT}`, ABERTURA);
    assertValidTelegramHtml(out);
    assert.match(out, /🔓 <b>Alessandra de Oliveira Nascimento<\/b> abriu o caixa às <b>10:05<\/b>/);
    assert.match(out, /previsto \(fechamento anterior\): <b>R\$ 106,25<\/b>/);
    assert.match(out, /⚠️ <b>FALTA de R\$ 17,60 em relação ao fechamento anterior<\/b>/);
  }
  const sobra = formatMessage("ABERTURA", "T", ABERTURA_SOBRA);
  assert.match(sobra, /💡 <b>SOBRA de R\$ 1,00/);
});

test("CANDIDATURA_TALENTOS", () => {
  const out = formatMessage("CANDIDATURA_TALENTOS", "🧑‍💼 Nova candidatura — Banco de Talentos", CANDIDATURA);
  console.log(`\n${out}\n`);
  assertValidTelegramHtml(out);
  assert.match(out, /💼 Serviços gerais · Remunerado/);
  assert.match(out, /<a href="https:\/\/wa\.me\/5591989505304">\(91\) 98950-5304<\/a>/);
});

test("RESUMO_SEMANAL com alta e queda", () => {
  const out = formatMessage("RESUMO_SEMANAL", `🏠 Resumo semanal — ${UNIT}`, RESUMO);
  assertValidTelegramHtml(out);
  assert.match(out, /Faturado: <b>R\$ 10\.323,90<\/b> 📈 <b>\+22,8%<\/b> vs semana anterior/);
  assert.match(out, /Visitas\/locações: <b>134<\/b> 📈 <b>\+22,9%<\/b>/);
  const queda = formatMessage("RESUMO_SEMANAL", "T", RESUMO.replace("+22.8%", "-5.0%"));
  assert.match(queda, /📉 <b>-5,0%<\/b>/);
});

test("OCORRENCIA_COLABORADOR", () => {
  const falta = formatMessage("OCORRENCIA_COLABORADOR", "🏠 Ocorrência — X", "Maria: Falta (1 dia)\nObs: avisou <tarde> & saiu");
  assertValidTelegramHtml(falta);
  assert.match(falta, /🚫 Falta · <b>1 dia<\/b>/);
  assert.match(falta, /avisou &lt;tarde&gt; &amp; saiu/);
  const atestado = formatMessage("OCORRENCIA_COLABORADOR", "T", "João: Atestado médico (3 dias)");
  assert.match(atestado, /🩺 Atestado médico · <b>3 dias<\/b>/);
  assert.ok(!/📝/.test(atestado));
});

test("AVALIACAO_NEGATIVA", () => {
  const out = formatMessage("AVALIACAO_NEGATIVA", "⭐ Avaliação Google baixa — X", "Nota: 2/5\nComentário: Demorou\nmuito");
  assertValidTelegramHtml(out);
  assert.match(out, /⭐⭐☆☆☆ <b>2\/5<\/b>/);
  assert.match(out, /💬 <i>Demorou\nmuito<\/i>/);
  assert.match(formatMessage("AVALIACAO_NEGATIVA", "T", "Nota: 1/5"), /⭐☆☆☆☆/);
});

test("texto desconhecido ou tipo sem formatador cai no genérico", () => {
  for (const type of ["FECHAMENTO", "ABERTURA", "RESUMO_SEMANAL", "TIPO_NOVO"]) {
    const out = formatMessage(type, "Título <x>", "Rótulo: valor\nOutra linha & mais");
    assert.equal(out, formatGeneric("Título <x>", "Rótulo: valor\nOutra linha & mais"));
    assertValidTelegramHtml(out);
  }
});

test("HTML é escapado em nomes e justificativas", () => {
  const body = FECHAMENTO_0910
    .replace("Estheffany Araujo Ferreira", "Ana <b>& Cia")
    .replace("UM VALOR DE 96 REAIS", "a < b & c >");
  assertValidTelegramHtml(formatMessage("FECHAMENTO", "T <x>", body));
});
