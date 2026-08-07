/**
 * Declaração de faturamento ao shopping — montagem e serialização.
 *
 * Funções puras: recebem as linhas cruas do banco e devolvem o
 * documento que a administração do empreendimento vai ler. Zero
 * acesso a banco, zero relógio — o que entra determina o que sai, e
 * por isso dá para testar cada centavo.
 *
 * O formato aqui é o *nosso* formato canônico. Quando a administração
 * responder com o layout dela (ver docs/integracao-shopping/), a
 * tradução vira uma função nova neste mesmo arquivo — o agregado não
 * muda. Essa separação é deliberada: layout de shopping muda por
 * decisão de terceiro, e não queremos que isso mexa na apuração.
 */

export type MeioPagamento = "DINHEIRO" | "PIX" | "CREDITO" | "DEBITO" | "VOUCHER";
export type NaturezaReceita = "SERVICO" | "PRODUTO";

export interface LinhaFaturamentoDia {
  businessDate: string;
  ordersCount: number;
  grossCents: number;
  netCents: number;
}

export interface LinhaNatureza {
  businessDate: string;
  itemNature: NaturezaReceita;
  netCents: number;
}

export interface LinhaMeioPagamento {
  businessDate: string;
  method: MeioPagamento;
  totalCents: number;
}

export interface LinhaCancelamento {
  businessDate: string;
  cancelledCount: number;
  cancelledCents: number;
}

export interface FaturamentoDia {
  /** Dia operacional (AAAA-MM-DD), com o cutoff da unidade já aplicado — não é o dia do relógio. */
  data: string;
  /** Preço de tabela × quantidade, antes de qualquer desconto. */
  brutoCentavos: number;
  descontosCentavos: number;
  /** Bruto − descontos. É o valor efetivamente cobrado do cliente. */
  liquidoCentavos: number;
  cancelamentosCentavos: number;
  quantidadeVendas: number;
  quantidadeCancelamentos: number;
  ticketMedioCentavos: number;
  porNatureza: Record<NaturezaReceita, number>;
  porMeioPagamento: Record<MeioPagamento, number>;
}

export interface FaturamentoPeriodo {
  dataInicial: string;
  dataFinal: string;
  brutoCentavos: number;
  descontosCentavos: number;
  liquidoCentavos: number;
  cancelamentosCentavos: number;
  quantidadeVendas: number;
  quantidadeCancelamentos: number;
  ticketMedioCentavos: number;
  porNatureza: Record<NaturezaReceita, number>;
  porMeioPagamento: Record<MeioPagamento, number>;
}

export interface IdentificacaoLoja {
  unidadeId: string;
  nome: string;
  cnpj: string | null;
  razaoSocial: string | null;
  luc: string | null;
  codigoLojista: string | null;
  timezone: string;
  /** Hora de corte do dia operacional. Vai na declaração porque explica por que 23h50 de domingo pode cair no domingo. */
  cutoffHoraDiaOperacional: number;
}

export interface DeclaracaoFaturamento {
  /** Versão do nosso layout. Muda quando um campo sai ou muda de significado — nunca quando um campo novo entra. */
  layoutVersao: string;
  loja: IdentificacaoLoja;
  periodo: FaturamentoPeriodo;
  dias: FaturamentoDia[];
  moeda: "BRL";
  /** Todos os valores são inteiros em centavos, sem ponto flutuante em nenhum ponto do caminho. */
  unidadeValores: "CENTAVOS";
  geradoEmMs: number;
}

export const LAYOUT_VERSAO = "1.0";

const MEIOS: readonly MeioPagamento[] = ["DINHEIRO", "PIX", "CREDITO", "DEBITO", "VOUCHER"];
const NATUREZAS: readonly NaturezaReceita[] = ["SERVICO", "PRODUTO"];

function zerosPorMeio(): Record<MeioPagamento, number> {
  return { DINHEIRO: 0, PIX: 0, CREDITO: 0, DEBITO: 0, VOUCHER: 0 };
}

function zerosPorNatureza(): Record<NaturezaReceita, number> {
  return { SERVICO: 0, PRODUTO: 0 };
}

export interface EntradaDeclaracao {
  loja: IdentificacaoLoja;
  dataInicial: string;
  dataFinal: string;
  dias: LinhaFaturamentoDia[];
  naturezas: LinhaNatureza[];
  meiosPagamento: LinhaMeioPagamento[];
  cancelamentos: LinhaCancelamento[];
  geradoEmMs: number;
}

/**
 * Junta as quatro consultas num documento único.
 *
 * Dias sem movimento aparecem zerados em vez de sumirem: um intervalo
 * com buraco levanta a pergunta "faltou enviar?" na administração, e
 * responder isso por e-mail custa mais caro do que carregar a linha.
 */
export function montarDeclaracao(entrada: EntradaDeclaracao): DeclaracaoFaturamento {
  const porData = new Map<string, FaturamentoDia>();

  for (const data of listarDatas(entrada.dataInicial, entrada.dataFinal)) {
    porData.set(data, {
      data,
      brutoCentavos: 0,
      descontosCentavos: 0,
      liquidoCentavos: 0,
      cancelamentosCentavos: 0,
      quantidadeVendas: 0,
      quantidadeCancelamentos: 0,
      ticketMedioCentavos: 0,
      porNatureza: zerosPorNatureza(),
      porMeioPagamento: zerosPorMeio(),
    });
  }

  // Uma linha fora do intervalo pedido é ignorada em silêncio: o
  // recorte do documento é o período declarado, não o que o banco
  // devolveu.
  const dia = (data: string): FaturamentoDia | undefined => porData.get(data);

  for (const linha of entrada.dias) {
    const alvo = dia(linha.businessDate);
    if (!alvo) continue;
    alvo.brutoCentavos = linha.grossCents;
    alvo.liquidoCentavos = linha.netCents;
    alvo.descontosCentavos = linha.grossCents - linha.netCents;
    alvo.quantidadeVendas = linha.ordersCount;
  }

  for (const linha of entrada.naturezas) {
    const alvo = dia(linha.businessDate);
    if (!alvo) continue;
    alvo.porNatureza[linha.itemNature] += linha.netCents;
  }

  for (const linha of entrada.meiosPagamento) {
    const alvo = dia(linha.businessDate);
    if (!alvo) continue;
    alvo.porMeioPagamento[linha.method] += linha.totalCents;
  }

  for (const linha of entrada.cancelamentos) {
    const alvo = dia(linha.businessDate);
    if (!alvo) continue;
    alvo.cancelamentosCentavos = linha.cancelledCents;
    alvo.quantidadeCancelamentos = linha.cancelledCount;
  }

  for (const alvo of porData.values()) {
    alvo.ticketMedioCentavos =
      alvo.quantidadeVendas > 0 ? Math.round(alvo.liquidoCentavos / alvo.quantidadeVendas) : 0;
  }

  const dias = [...porData.values()].sort((a, b) => a.data.localeCompare(b.data));

  return {
    layoutVersao: LAYOUT_VERSAO,
    loja: entrada.loja,
    periodo: totalizarPeriodo(entrada.dataInicial, entrada.dataFinal, dias),
    dias,
    moeda: "BRL",
    unidadeValores: "CENTAVOS",
    geradoEmMs: entrada.geradoEmMs,
  };
}

export function totalizarPeriodo(
  dataInicial: string,
  dataFinal: string,
  dias: FaturamentoDia[],
): FaturamentoPeriodo {
  const porNatureza = zerosPorNatureza();
  const porMeioPagamento = zerosPorMeio();
  let brutoCentavos = 0;
  let descontosCentavos = 0;
  let liquidoCentavos = 0;
  let cancelamentosCentavos = 0;
  let quantidadeVendas = 0;
  let quantidadeCancelamentos = 0;

  for (const d of dias) {
    brutoCentavos += d.brutoCentavos;
    descontosCentavos += d.descontosCentavos;
    liquidoCentavos += d.liquidoCentavos;
    cancelamentosCentavos += d.cancelamentosCentavos;
    quantidadeVendas += d.quantidadeVendas;
    quantidadeCancelamentos += d.quantidadeCancelamentos;
    for (const n of NATUREZAS) porNatureza[n] += d.porNatureza[n];
    for (const m of MEIOS) porMeioPagamento[m] += d.porMeioPagamento[m];
  }

  return {
    dataInicial,
    dataFinal,
    brutoCentavos,
    descontosCentavos,
    liquidoCentavos,
    cancelamentosCentavos,
    quantidadeVendas,
    quantidadeCancelamentos,
    ticketMedioCentavos: quantidadeVendas > 0 ? Math.round(liquidoCentavos / quantidadeVendas) : 0,
    porNatureza,
    porMeioPagamento,
  };
}

const ISO_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;

function ehBissexto(ano: number): boolean {
  return (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
}

function diasNoMes(ano: number, mes: number): number {
  if (mes === 2) return ehBissexto(ano) ? 29 : 28;
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mes - 1]!;
}

/**
 * Datas ISO inclusivas entre início e fim.
 *
 * Aritmética de calendário na mão em vez de `Date`: o pacote domain
 * proíbe `Date` por lint (o relógio tem que ser injetado), e usar
 * `Date` só para caminhar dia a dia arrastaria fuso horário para
 * dentro de uma conta que é puramente de calendário — a origem
 * clássica do relatório que pula ou duplica um dia na virada.
 *
 * Intervalo invertido ou malformado devolve lista vazia; o teto de
 * 4000 iterações existe só para nenhum chamador futuro conseguir
 * travar o kiosk com um intervalo absurdo.
 */
export function listarDatas(dataInicial: string, dataFinal: string): string[] {
  const inicio = ISO_DATA.exec(dataInicial);
  const fim = ISO_DATA.exec(dataFinal);
  if (!inicio || !fim || dataFinal < dataInicial) return [];

  let ano = Number(inicio[1]);
  let mes = Number(inicio[2]);
  let dia = Number(inicio[3]);
  if (mes < 1 || mes > 12 || dia < 1 || dia > diasNoMes(ano, mes)) return [];

  const datas: string[] = [];
  const MAX_DIAS = 4000;
  for (let i = 0; i < MAX_DIAS; i++) {
    const iso = `${String(ano).padStart(4, "0")}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
    if (iso > dataFinal) break;
    datas.push(iso);

    dia += 1;
    if (dia > diasNoMes(ano, mes)) {
      dia = 1;
      mes += 1;
      if (mes > 12) {
        mes = 1;
        ano += 1;
      }
    }
  }
  return datas;
}

/** 12345 -> "123,45". Formato decimal brasileiro, sem separador de milhar (planilha não gosta). */
export function centavosParaDecimalBr(centavos: number): string {
  const negativo = centavos < 0;
  const abs = Math.abs(centavos);
  const inteiros = Math.floor(abs / 100);
  const resto = String(abs % 100).padStart(2, "0");
  return `${negativo ? "-" : ""}${inteiros},${resto}`;
}

/**
 * CSV ponto-e-vírgula com decimal por vírgula — o dialeto que o Excel
 * em português abre com dois cliques. Um shopping que aceita arquivo
 * costuma aceitar exatamente isso; layouts posicionais (TXT de largura
 * fixa) ganham uma função irmã quando soubermos o layout exato.
 */
export function declaracaoParaCsv(declaracao: DeclaracaoFaturamento): string {
  const cabecalho = [
    "data",
    "cnpj",
    "luc",
    "codigo_lojista",
    "bruto",
    "descontos",
    "liquido",
    "cancelamentos",
    "qtd_vendas",
    "qtd_cancelamentos",
    "ticket_medio",
    "servico",
    "produto",
    ...MEIOS.map((m) => m.toLowerCase()),
  ];

  const linhas = declaracao.dias.map((d) =>
    [
      d.data,
      declaracao.loja.cnpj ?? "",
      declaracao.loja.luc ?? "",
      declaracao.loja.codigoLojista ?? "",
      centavosParaDecimalBr(d.brutoCentavos),
      centavosParaDecimalBr(d.descontosCentavos),
      centavosParaDecimalBr(d.liquidoCentavos),
      centavosParaDecimalBr(d.cancelamentosCentavos),
      String(d.quantidadeVendas),
      String(d.quantidadeCancelamentos),
      centavosParaDecimalBr(d.ticketMedioCentavos),
      centavosParaDecimalBr(d.porNatureza.SERVICO),
      centavosParaDecimalBr(d.porNatureza.PRODUTO),
      ...MEIOS.map((m) => centavosParaDecimalBr(d.porMeioPagamento[m])),
    ].join(";"),
  );

  // CRLF: layout de arquivo trocado com sistema de terceiro em
  // Windows quebra menos assim, e leitor de Unix ignora o \r.
  return [cabecalho.join(";"), ...linhas].join("\r\n") + "\r\n";
}

export interface ProblemaDeclaracao {
  campo: string;
  mensagem: string;
}

/**
 * Confere o que o shopping vai cobrar antes de ele cobrar. Não
 * bloqueia a geração — devolve a lista de pendências para a tela
 * mostrar, porque durante a implantação é normal ainda não ter o
 * código de lojista em mãos.
 */
export function conferirDeclaracao(declaracao: DeclaracaoFaturamento): ProblemaDeclaracao[] {
  const problemas: ProblemaDeclaracao[] = [];
  const { loja } = declaracao;

  if (!loja.cnpj)
    problemas.push({ campo: "cnpj", mensagem: "CNPJ da unidade não cadastrado em Configurações." });
  if (!loja.razaoSocial)
    problemas.push({
      campo: "razaoSocial",
      mensagem: "Razão social não cadastrada em Configurações.",
    });
  if (!loja.luc)
    problemas.push({ campo: "luc", mensagem: "LUC (código da loja no contrato) não cadastrada." });
  if (!loja.codigoLojista)
    problemas.push({
      campo: "codigoLojista",
      mensagem: "Código de lojista do sistema do shopping não cadastrado.",
    });

  const somaMeios = MEIOS.reduce((s, m) => s + declaracao.periodo.porMeioPagamento[m], 0);
  if (somaMeios !== declaracao.periodo.liquidoCentavos) {
    problemas.push({
      campo: "porMeioPagamento",
      mensagem: `Soma dos meios de pagamento (${centavosParaDecimalBr(somaMeios)}) diverge do líquido (${centavosParaDecimalBr(declaracao.periodo.liquidoCentavos)}). Há venda paga sem pagamento registrado, ou pagamento em venda não fechada.`,
    });
  }

  const somaNaturezas = NATUREZAS.reduce((s, n) => s + declaracao.periodo.porNatureza[n], 0);
  if (somaNaturezas !== declaracao.periodo.liquidoCentavos) {
    problemas.push({
      campo: "porNatureza",
      mensagem: "Soma de serviço + produto diverge do líquido do período.",
    });
  }

  return problemas;
}
