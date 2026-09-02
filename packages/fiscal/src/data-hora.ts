/**
 * Data/hora local para campos fiscais (dhEmi da NFC-e/DPS, dCompet/dtIni/
 * dtFim da DPS). O bug que este módulo evita: usar `Date.getUTC*()` direto
 * produz o dia/mês errado sempre que o horário local (America/Belem,
 * UTC-03:00) já virou o dia seguinte em UTC — por exemplo 23:30 local do
 * dia 31 é 02:30 UTC do dia 1º. O layout fiscal (dhEmi, dCompet, chave de
 * acesso AAMM) precisa do dia/mês LOCAL, não do UTC.
 *
 * Implementação via `Intl.DateTimeFormat.formatToParts`, que devolve os
 * componentes da data já convertidos para o fuso pedido — sem depender de
 * nenhuma lib de timezone externa.
 */

interface WallClockParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const TIMEZONE_PADRAO = "America/Belem";

function pad(n: number, len = 2): string {
  return String(n).padStart(len, "0");
}

function wallClockParts(d: Date, timeZone: string): WallClockParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(d);

  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      map[part.type] = part.value;
    }
  }

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/**
 * Formata o instante `d` como data/hora local com offset numérico
 * (AAAA-MM-DDThh:mm:ss±hh:mm), no fuso informado (padrão America/Belem,
 * UTC-03:00). Nunca usa "Z" nem milissegundos — os layouts fiscais exigem
 * offset numérico explícito.
 */
export function formatarDataHoraFiscal(d: Date, timeZone: string = TIMEZONE_PADRAO): string {
  const { year, month, day, hour, minute, second } = wallClockParts(d, timeZone);

  // O offset é a diferença entre "o mesmo relógio de parede, mas em UTC" e
  // o instante real — reconstruindo os componentes locais como se fossem
  // UTC e comparando com o instante original.
  const comoSeFosseUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsetMin = Math.round((comoSeFosseUtc - d.getTime()) / 60000);

  const sinal = offsetMin < 0 ? "-" : "+";
  const offsetAbs = Math.abs(offsetMin);
  const offsetHoras = Math.floor(offsetAbs / 60);
  const offsetMinutos = offsetAbs % 60;

  return (
    `${pad(year, 4)}-${pad(month)}-${pad(day)}` +
    `T${pad(hour)}:${pad(minute)}:${pad(second)}` +
    `${sinal}${pad(offsetHoras)}:${pad(offsetMinutos)}`
  );
}

/** Formata o instante `d` como data local (AAAA-MM-DD), no fuso informado. */
export function formatarDataFiscal(d: Date, timeZone: string = TIMEZONE_PADRAO): string {
  const { year, month, day } = wallClockParts(d, timeZone);
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/** Ano e mês (1-12) locais do instante `d`, no fuso informado. */
export function anoMesLocal(d: Date, timeZone: string = TIMEZONE_PADRAO): { ano: number; mes: number } {
  const { year, month } = wallClockParts(d, timeZone);
  return { ano: year, mes: month };
}
