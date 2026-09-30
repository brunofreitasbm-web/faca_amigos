// "Olhar FaçaAmigos" em PDF (A4) com a marca FaçaAmigos, desenhado com
// pdf-lib (puro JS — a Edge Function não tem Chromium). Fontes e logo vêm de
// brandAssets.ts em base64.
//
// O que vem da IA (`SessionReportDoc`) é só prosa. Os itens observados e os
// níveis (pílulas) vêm de `answers` + catálogo — fato, nunca da IA. A nota de
// blindagem é fixa e sempre impressa (1ª página em caixa + rodapé em todas).

import { PDFDocument, type PDFFont, type PDFPage, type RGB, rgb } from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";
import { FREDOKA_B64, LOGO_PNG_B64, NUNITO_BOLD_B64, NUNITO_REG_B64 } from "./assets/brandAssets.ts";
import {
  SESSION_REPORT_CATALOG,
  SESSION_REPORT_DISCLAIMER,
  SESSION_REPORT_DISCLAIMER_SHORT,
  SESSION_REPORT_DOC_TITLE,
  SESSION_REPORT_GROUP_KEY,
  SESSION_REPORT_GROUP_NAME,
  type EmployeeSector,
  type SessionReportAnswers,
  type SessionReportLevel,
} from "./sessionReportCatalog.ts";

/** Documento gerado pela IA (ou pelo fallback determinístico). Chaves de área só quando há itens. */
export interface SessionReportDoc {
  titulo: string;
  abertura: string;
  areas: Partial<Record<"movimento" | "convivencia" | "autonomia" | "atencao", string>>;
  fechamento: string;
  destaque_whatsapp: string;
}

export interface SessionReportPdfInput {
  childFirst: string;
  /** Ex.: "30 de setembro de 2026" */
  dateLabel: string;
  minutes: number;
  unitLabel: string;
  answers: SessionReportAnswers;
  observacao: string | null;
  report: SessionReportDoc;
}

const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

const PINK = rgb(0xf0 / 255, 0x19 / 255, 0x6b / 255);
const TEAL = rgb(0x2e / 255, 0xcf / 255, 0xb5 / 255);
const YELLOW = rgb(1, 0xe2 / 255, 0x34 / 255);
const DARK = rgb(0x1a / 255, 0x3f / 255, 0x35 / 255);
const MUTED = rgb(0.42, 0.47, 0.46);
const SOFT = rgb(0.97, 0.98, 0.98);
const WHITE = rgb(1, 1, 1);

const A4_W = 595.28;
const A4_H = 841.89;
const M = 48; // margem
const W = A4_W - 2 * M;
const FOOTER_H = 34;

const LEVEL_STYLE: Record<SessionReportLevel, { label: string; fill: RGB; text: RGB }> = {
  AUTONOMO: { label: "Fez com autonomia", fill: TEAL, text: DARK },
  DESENVOLVENDO: { label: "Em desenvolvimento", fill: YELLOW, text: DARK },
  APOIO: { label: "Com apoio", fill: PINK, text: WHITE },
};

/** Fontes de PDF não têm emoji; remove pictogramas e normaliza espaços. */
export function stripForPdf(text: string): string {
  return text
    .replace(/\p{Extended_Pictographic}|️|‍/gu, "")
    .replace(/[\t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxW) line = candidate;
      else {
        if (line) out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

/** Retângulo com cantos arredondados (pdf-lib não tem nativo). `y` é a base. */
function roundedRect(page: PDFPage, x: number, y: number, w: number, h: number, r: number, color: RGB) {
  const d =
    `M${r},0 H${w - r} A${r},${r} 0 0 1 ${w},${r} V${h - r} A${r},${r} 0 0 1 ${w - r},${h} ` +
    `H${r} A${r},${r} 0 0 1 0,${h - r} V${r} A${r},${r} 0 0 1 ${r},0 Z`;
  page.drawSvgPath(d, { x, y: y + h, color });
}

export async function buildSessionReportPdf(input: SessionReportPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(`${SESSION_REPORT_DOC_TITLE} — ${input.childFirst}`);
  doc.setAuthor("FaçaAmigos");
  doc.setSubject(SESSION_REPORT_DISCLAIMER_SHORT);

  const display = await doc.embedFont(b64(FREDOKA_B64), { subset: true });
  const body = await doc.embedFont(b64(NUNITO_REG_B64), { subset: true });
  const bold = await doc.embedFont(b64(NUNITO_BOLD_B64), { subset: true });
  const logo = await doc.embedPng(b64(LOGO_PNG_B64));

  let page!: PDFPage;
  let y = 0;
  let pageNo = 0;

  const footer = (p: PDFPage, n: number) => {
    p.drawLine({ start: { x: M, y: FOOTER_H + 10 }, end: { x: A4_W - M, y: FOOTER_H + 10 }, thickness: 0.6, color: rgb(0.88, 0.9, 0.9) });
    const txt = stripForPdf(SESSION_REPORT_DISCLAIMER_SHORT);
    p.drawText(txt, { x: M, y: FOOTER_H - 4, size: 7.5, font: body, color: MUTED });
    const pn = `${n}`;
    p.drawText(pn, { x: A4_W - M - body.widthOfTextAtSize(pn, 8), y: FOOTER_H - 4, size: 8, font: body, color: MUTED });
  };

  const newPage = () => {
    page = doc.addPage([A4_W, A4_H]);
    pageNo += 1;
    const third = A4_W / 3;
    page.drawRectangle({ x: 0, y: A4_H - 8, width: third, height: 8, color: PINK });
    page.drawRectangle({ x: third, y: A4_H - 8, width: third, height: 8, color: TEAL });
    page.drawRectangle({ x: 2 * third, y: A4_H - 8, width: third + 1, height: 8, color: YELLOW });
    const lw = pageNo === 1 ? 170 : 110;
    const lh = lw * (logo.height / logo.width);
    page.drawImage(logo, { x: M - 6, y: A4_H - 28 - lh, width: lw, height: lh });
    y = A4_H - 28 - lh - (pageNo === 1 ? 14 : 8);
    footer(page, pageNo);
  };

  const ensure = (need: number) => {
    if (y - need < FOOTER_H + 22) newPage();
  };

  const paragraph = (text: string, font: PDFFont, size: number, color: RGB = DARK, gapAfter = size * 0.7) => {
    const lh = size * 1.48;
    for (const line of wrap(stripForPdf(text), font, size, W)) {
      ensure(lh);
      page.drawText(line, { x: M, y, size, font, color });
      y -= lh;
    }
    y -= gapAfter;
  };

  const heading = (text: string, size: number, color: RGB) => {
    ensure(size * 1.6);
    page.drawText(stripForPdf(text), { x: M, y, size, font: display, color });
    y -= size * 1.5;
  };

  const pill = (level: SessionReportLevel, x: number, baseline: number) => {
    const s = LEVEL_STYLE[level];
    const size = 8.5;
    const pw = bold.widthOfTextAtSize(s.label, size) + 14;
    const ph = 15;
    roundedRect(page, x, baseline - 4, pw, ph, ph / 2, s.fill);
    page.drawText(s.label, { x: x + 7, y: baseline, size, font: bold, color: s.text });
    return pw;
  };

  // ── Página 1: cabeçalho ──
  newPage();
  page.drawText(SESSION_REPORT_DOC_TITLE, { x: M, y, size: 28, font: display, color: PINK });
  y -= 30;
  paragraph(`${input.childFirst}  ·  ${input.dateLabel}  ·  ${input.minutes} minutos de brincadeira  ·  ${input.unitLabel}`, body, 10.5, MUTED, 14);

  heading(input.report.titulo, 19, DARK);
  paragraph(input.report.abertura, body, 11.5);

  // ── Nota de blindagem (caixa, sempre na 1ª página, logo após a abertura) ──
  {
    const text = stripForPdf(SESSION_REPORT_DISCLAIMER.replace("{crianca}", input.childFirst));
    const size = 9;
    const lh = size * 1.45;
    const lines = wrap(text, body, size, W - 24);
    const boxH = lines.length * lh + 22;
    ensure(boxH + 6);
    roundedRect(page, M, y - boxH + 10, W, boxH, 8, SOFT);
    page.drawRectangle({ x: M, y: y - boxH + 10, width: 4, height: boxH, color: TEAL });
    let ly = y - 8;
    page.drawText("Sobre este registro", { x: M + 12, y: ly, size: 9.5, font: bold, color: DARK });
    ly -= lh + 1;
    for (const line of lines) {
      page.drawText(line, { x: M + 12, y: ly, size, font: body, color: rgb(0.28, 0.33, 0.32) });
      ly -= lh;
    }
    y = y - boxH + 10 - 30;
  }

  // ── Áreas: itens observados (fato) + prosa da IA ──
  for (const sec of SESSION_REPORT_CATALOG) {
    const items = sec.items.filter((i) => input.answers[i.key] != null);
    if (items.length === 0) continue;
    ensure(70);
    heading(SESSION_REPORT_GROUP_NAME[sec.sector as EmployeeSector], 15, TEAL);
    for (const item of items) {
      ensure(20);
      const pw = pill(input.answers[item.key]!, M, y);
      const label = stripForPdf(item.label);
      const maxW = W - pw - 10;
      const size = 11;
      const line = body.widthOfTextAtSize(label, size) <= maxW ? label : wrap(label, body, size, maxW)[0]!;
      page.drawText(line, { x: M + pw + 10, y, size, font: body, color: DARK });
      y -= 20;
    }
    y -= 4;
    const prose = input.report.areas[SESSION_REPORT_GROUP_KEY[sec.sector as EmployeeSector]];
    if (prose) paragraph(prose, body, 11.5);
  }

  if (input.observacao) {
    ensure(40);
    heading("O que a equipe reparou", 15, TEAL);
    paragraph(input.observacao, body, 11.5);
  }

  ensure(40);
  heading("Até a próxima brincadeira", 15, PINK);
  paragraph(input.report.fechamento, body, 11.5);

  // Legenda das pílulas
  ensure(30);
  y -= 4;
  let lx = M;
  for (const level of ["AUTONOMO", "DESENVOLVENDO", "APOIO"] as const) {
    lx += pill(level, lx, y) + 10;
  }
  y -= 22;
  paragraph(
    "Os marcadores acima descrevem apenas como a brincadeira aconteceu neste dia. Toda criança tem seu ritmo, e cada visita é um dia diferente.",
    body,
    9,
    MUTED,
  );

  return doc.save();
}
