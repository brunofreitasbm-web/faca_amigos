/**
 * Contrato de prestação de serviços — planos acima de 2h (banco de horas).
 *
 * O texto é um MODELO com placeholders `{{CHAVE}}`, editável no Gerencial
 * (aba Contrato) e salvo por unidade em fa_kiosk_app_settings
 * ('hour_bank_contract_template'). Este arquivo guarda o modelo padrão —
 * usado quando a unidade nunca personalizou o dela — e o preenchimento.
 *
 * A minuta foi redigida para equilibrar os dois lados, como pede o CDC:
 * resguarda o FaçaAmigos (limites de responsabilidade legítimos, regras
 * de permanência e retirada, excedente informado) sem cláusulas que a
 * lei considera abusivas (art. 51 do CDC) — validade e condições do
 * banco de horas explícitas, rescisão com reembolso proporcional e foro
 * do domicílio do consumidor.
 */

export const CONTRACT_PLACEHOLDERS: { key: string; label: string }[] = [
  { key: "UNIDADE_NOME", label: "Nome da unidade" },
  { key: "UNIDADE_CNPJ", label: "CNPJ da unidade" },
  { key: "UNIDADE_ENDERECO", label: "Endereço da unidade" },
  { key: "UNIDADE_TELEFONE", label: "Telefone da unidade" },
  { key: "CONTRATANTE_NOME", label: "Nome do responsável (Contratante)" },
  { key: "CONTRATANTE_CPF", label: "CPF do Contratante" },
  { key: "CONTRATANTE_RG", label: "RG do Contratante" },
  { key: "CONTRATANTE_ENDERECO", label: "Endereço completo do Contratante" },
  { key: "CONTRATANTE_TELEFONE", label: "WhatsApp do Contratante" },
  { key: "CONTRATANTE_EMAIL", label: "E-mail do Contratante" },
  { key: "CRIANCA_NOME", label: "Nome da criança" },
  { key: "PLANO_NOME", label: "Nome do plano contratado" },
  { key: "PLANO_HORAS", label: "Carga horária do plano (ex.: 3 horas)" },
  { key: "PLANO_VALOR", label: "Valor do plano (R$)" },
  { key: "VALIDADE_BANCO_DIAS", label: "Validade do banco de horas em dias" },
  { key: "DATA_EXTENSO", label: "Data por extenso" },
  { key: "CIDADE_UF", label: "Cidade/UF da assinatura" },
];

export const DEFAULT_CONTRACT_TEMPLATE = `CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE RECREAÇÃO INFANTIL — PLANO {{PLANO_NOME}}

CONTRATADA: {{UNIDADE_NOME}}, pessoa jurídica de direito privado, inscrita no CNPJ sob o nº {{UNIDADE_CNPJ}}, com estabelecimento em {{UNIDADE_ENDERECO}}, telefone {{UNIDADE_TELEFONE}}, doravante denominada simplesmente CONTRATADA.

CONTRATANTE: {{CONTRATANTE_NOME}}, portador(a) do CPF nº {{CONTRATANTE_CPF}} e do RG nº {{CONTRATANTE_RG}}, residente e domiciliado(a) em {{CONTRATANTE_ENDERECO}}, telefone/WhatsApp {{CONTRATANTE_TELEFONE}}, e-mail {{CONTRATANTE_EMAIL}}, responsável legal ou acompanhante autorizado da criança {{CRIANCA_NOME}}, doravante denominado(a) simplesmente CONTRATANTE.

As partes celebram o presente contrato de prestação de serviços, que se regerá pelas cláusulas seguintes e pela legislação aplicável, em especial o Código de Defesa do Consumidor (Lei nº 8.078/1990), o Estatuto da Criança e do Adolescente (Lei nº 8.069/1990) e a Lei Geral de Proteção de Dados (Lei nº 13.709/2018).

CLÁUSULA 1ª — DO OBJETO
1.1. O objeto deste contrato é a prestação, pela CONTRATADA, de serviços de recreação infantil supervisionada em espaço de playground inclusivo, em favor da criança indicada pelo CONTRATANTE, na modalidade do plano {{PLANO_NOME}}, com carga horária total de {{PLANO_HORAS}}, pelo valor de R$ {{PLANO_VALOR}}.
1.2. O serviço compreende o acesso ao espaço de recreação, a supervisão da equipe de monitores da CONTRATADA e os cuidados inclusivos informados pelo CONTRATANTE no ato do cadastro.

CLÁUSULA 2ª — DO BANCO DE HORAS
2.1. As horas do plano contratado não precisam ser utilizadas integralmente no dia da contratação: o tempo não utilizado fica registrado em sistema como crédito ("banco de horas") vinculado à criança.
2.2. O banco de horas tem validade de {{VALIDADE_BANCO_DIAS}} dias corridos, contados da data de cada visita que gerar crédito, e pode ser utilizado em QUALQUER unidade de playground da CONTRATADA, sem custo adicional de transferência.
2.3. O prazo de validade e o saldo disponível serão informados ao CONTRATANTE no comprovante impresso de cada visita e poderão ser consultados no balcão de qualquer unidade, a qualquer tempo.
2.4. Esgotado o saldo durante uma visita, os minutos excedentes serão cobrados pela tarifa de minuto excedente do plano de origem, vigente e informada na contratação — nunca pelo valor integral de um novo plano sem anuência do CONTRATANTE.
2.5. O crédito do banco de horas é pessoal e intransferível, vinculado à criança beneficiária, e não é conversível em dinheiro, ressalvada a hipótese de rescisão prevista na Cláusula 6ª.

CLÁUSULA 3ª — DAS OBRIGAÇÕES DA CONTRATADA
3.1. Manter equipe treinada para a supervisão das crianças durante a permanência no espaço, inclusive quanto aos cuidados inclusivos e sensoriais informados no cadastro.
3.2. Manter o espaço, brinquedos e equipamentos em condições adequadas de higiene, conservação e segurança.
3.3. Somente liberar a saída da criança mediante apresentação do comprovante de guarda (QR Code/PIN) ou conferência de documento de responsável autorizado, conforme protocolo de segurança registrado em sistema.
3.4. Comunicar imediatamente o CONTRATANTE, pelo telefone informado, sobre qualquer incidente, mal-estar ou necessidade da criança durante a permanência.

CLÁUSULA 4ª — DAS OBRIGAÇÕES DO CONTRATANTE
4.1. Prestar informações verdadeiras e completas no cadastro, em especial sobre saúde, alergias, necessidades sensoriais e pessoas autorizadas a retirar a criança.
4.2. Permanecer acessível pelo telefone informado durante todo o período de permanência da criança.
4.3. Observar as regras de uso e convivência do espaço, afixadas no estabelecimento, que integram este contrato.
4.4. Retirar a criança até o horário de fechamento do estabelecimento; o tempo que exceder o plano ou o saldo será cobrado conforme a tarifa de excedente informada (item 2.4).

CLÁUSULA 5ª — DA RESPONSABILIDADE
5.1. A CONTRATADA responde, na forma da lei, pelos danos causados à criança por falha na prestação do serviço, nos termos do art. 14 do Código de Defesa do Consumidor.
5.2. A CONTRATADA não se responsabiliza por objetos pessoais deixados no espaço fora do guarda-volumes, nem por incidentes decorrentes de informação de saúde relevante omitida no cadastro, sem prejuízo dos direitos legais do consumidor.

CLÁUSULA 6ª — DO CANCELAMENTO E DA RESCISÃO
6.1. Contratações realizadas fora do estabelecimento comercial (por telefone ou meio eletrônico) podem ser canceladas em até 7 (sete) dias corridos, com devolução integral, nos termos do art. 49 do Código de Defesa do Consumidor.
6.2. O CONTRATANTE poderá rescindir este contrato a qualquer tempo, dentro do prazo de validade do banco de horas, com devolução proporcional ao saldo de horas não utilizado, deduzido o valor das horas efetivamente usufruídas pela tarifa do próprio plano contratado — sem multa.
6.3. Créditos não utilizados dentro do prazo de validade previsto no item 2.2, sem pedido de rescisão, serão considerados usufruídos, dada a natureza de reserva de capacidade do serviço, condição que o CONTRATANTE declara conhecer e aceitar.

CLÁUSULA 7ª — DA PROTEÇÃO DE DADOS (LGPD)
7.1. Os dados pessoais do CONTRATANTE e da criança serão tratados exclusivamente para a execução deste contrato, a segurança da criança e as obrigações legais da CONTRATADA, nos termos da Lei nº 13.709/2018, não sendo compartilhados com terceiros para fins comerciais sem consentimento expresso.

CLÁUSULA 8ª — DO FORO
8.1. Fica eleito o foro do domicílio do CONTRATANTE para dirimir quaisquer controvérsias oriundas deste contrato, nos termos do art. 101, I, do Código de Defesa do Consumidor.

E por estarem justas e acordadas, as partes assinam o presente instrumento em 2 (duas) vias de igual teor.

{{CIDADE_UF}}, {{DATA_EXTENSO}}.


_______________________________________________
CONTRATANTE: {{CONTRATANTE_NOME}}
CPF: {{CONTRATANTE_CPF}}


_______________________________________________
CONTRATADA: {{UNIDADE_NOME}}
CNPJ: {{UNIDADE_CNPJ}}
`;

export interface ContractData {
  unitName: string;
  unitCnpj: string;
  unitAddress: string;
  unitPhone: string;
  contratanteNome: string;
  contratanteCpf: string;
  contratanteRg: string;
  contratanteEndereco: string;
  contratanteTelefone: string;
  contratanteEmail: string;
  criancaNome: string;
  planoNome: string;
  planoHoras: string;
  planoValor: string;
  validadeBancoDias: string;
  cidadeUf: string;
}

export function formatPlanoHoras(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} minutos`;
  if (m === 0) return `${h} hora${h > 1 ? "s" : ""}`;
  return `${h}h${String(m).padStart(2, "0")}`;
}

export function fillContractTemplate(template: string, data: ContractData): string {
  const now = new Date();
  const dataExtenso = now.toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" });
  const values: Record<string, string> = {
    UNIDADE_NOME: data.unitName || "FAÇA AMIGOS BRINQUEDOTECA LTDA",
    UNIDADE_CNPJ: data.unitCnpj || "66.318.630/0001-17",
    UNIDADE_ENDERECO: data.unitAddress || "Rod. Augusto Montenegro, 4300 - Parque Shopping Belém, Piso PSB01003, Parque Verde, Belém/PA - CEP 66635-110",
    UNIDADE_TELEFONE: data.unitPhone || "(91) 98250-1215",
    CONTRATANTE_NOME: data.contratanteNome,
    CONTRATANTE_CPF: data.contratanteCpf,
    CONTRATANTE_RG: data.contratanteRg,
    CONTRATANTE_ENDERECO: data.contratanteEndereco,
    CONTRATANTE_TELEFONE: data.contratanteTelefone,
    CONTRATANTE_EMAIL: data.contratanteEmail,
    CRIANCA_NOME: data.criancaNome,
    PLANO_NOME: data.planoNome,
    PLANO_HORAS: data.planoHoras,
    PLANO_VALOR: data.planoValor,
    VALIDADE_BANCO_DIAS: data.validadeBancoDias,
    DATA_EXTENSO: dataExtenso,
    CIDADE_UF: data.cidadeUf || "Belém/PA",
  };
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (whole, key: string) => values[key] ?? whole);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Página A4 do contrato com timbre FaçaAmigos da unidade: faixa tricolor
 * da marca, lockup "Faça/Amigos" (Fredoka One + cores oficiais), tagline
 * e dados da unidade. Impressa pelo diálogo do navegador — contrato para
 * assinatura pede A4, não bobina térmica de 80mm.
 */
export function buildContractHtml(contractText: string, data: ContractData): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8">
    <title>Contrato de Prestação de Serviços — FaçaAmigos</title>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Fredoka+One&family=Nunito:wght@400;700;800&display=swap');
      @page { size: A4; margin: 18mm 16mm; }
      html, body { margin: 0; padding: 0; background: #fff; color: #1a1a1a; font-family: "Nunito", "Segoe UI", Arial, sans-serif; font-size: 11.5px; line-height: 1.55; }
      .brand-bar { height: 6px; border-radius: 9999px; background: linear-gradient(90deg, #F0196B 0%, #F0196B 45%, #2ECFB5 45%, #2ECFB5 78%, #FFE234 78%, #FFE234 100%); margin-bottom: 14px; }
      .letterhead { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-bottom: 12px; border-bottom: 1.5px solid #2ECFB5; margin-bottom: 16px; }
      .lockup { font-family: "Fredoka One", "Nunito", sans-serif; font-size: 30px; line-height: 1; }
      .lockup .faca { color: #1A3F35; }
      .lockup .amigos { color: #F0196B; }
      .tagline { font-family: "Nunito", sans-serif; font-weight: 800; font-size: 9px; letter-spacing: 0.35em; color: #1A3F35; text-transform: uppercase; margin-top: 4px; }
      .unit-info { text-align: right; font-size: 10px; color: #333; }
      .unit-info strong { display: block; font-size: 12px; color: #1A3F35; }
      pre.contract { font-family: inherit; white-space: pre-wrap; word-wrap: break-word; margin: 0; }
      .footer { margin-top: 18px; padding-top: 8px; border-top: 1px dashed #bbb; font-size: 9px; color: #777; display: flex; justify-content: space-between; }
    </style>
  </head>
  <body>
    <div class="brand-bar"></div>
    <div class="letterhead">
      <div>
        <div class="lockup"><span class="faca">Faça</span><span class="amigos">Amigos</span></div>
        <div class="tagline">Playground Inclusivo</div>
      </div>
      <div class="unit-info">
        <strong>${escapeHtml(data.unitName)}</strong>
        CNPJ ${escapeHtml(data.unitCnpj)}<br>
        ${escapeHtml(data.unitAddress)}<br>
        ${escapeHtml(data.unitPhone)}
      </div>
    </div>
    <pre class="contract">${escapeHtml(contractText)}</pre>
    <div class="footer">
      <span>FaçaAmigos — Playground Inclusivo · ${escapeHtml(data.unitName)}</span>
      <span>Via do Contratante / Via da Contratada</span>
    </div>
  </body>
</html>`;
}

/**
 * Cartaz A4 do QR Code de Acesso Rápido — fixado na entrada da unidade.
 * `qrDataUrl` já vem pronto (ver generateWristbandQRCodeDataUrl em
 * WristbandQRCode.tsx); esta função só monta a página impressa, reusando
 * o mesmo timbre/paleta do contrato para os dois saírem consistentes.
 */
export function buildAcessoRapidoPosterHtml(data: { unitName: string; qrDataUrl: string; url: string }): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8">
    <title>QR Code de Acesso Rápido — FaçaAmigos</title>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Fredoka+One&family=Nunito:wght@400;700;800&display=swap');
      @page { size: A4; margin: 16mm; }
      html, body { margin: 0; padding: 0; background: #fff; color: #1a1a1a; font-family: "Nunito", "Segoe UI", Arial, sans-serif; }
      .brand-bar { height: 8px; border-radius: 9999px; background: linear-gradient(90deg, #F0196B 0%, #F0196B 45%, #2ECFB5 45%, #2ECFB5 78%, #FFE234 78%, #FFE234 100%); margin-bottom: 28px; }
      .lockup { font-family: "Fredoka One", "Nunito", sans-serif; font-size: 44px; line-height: 1; text-align: center; }
      .lockup .faca { color: #1A3F35; }
      .lockup .amigos { color: #F0196B; }
      .tagline { font-family: "Nunito", sans-serif; font-weight: 800; font-size: 13px; letter-spacing: 0.35em; color: #1A3F35; text-transform: uppercase; text-align: center; margin-top: 6px; }
      .title { text-align: center; font-family: "Fredoka One", sans-serif; font-size: 30px; color: #1A3F35; margin: 40px 0 8px; }
      .subtitle { text-align: center; font-size: 16px; color: #333; margin: 0 0 32px; }
      .qr-frame { display: flex; justify-content: center; margin: 0 0 32px; }
      .qr-frame img { width: 260px; height: 260px; border: 6px solid #2ECFB5; border-radius: 24px; padding: 16px; }
      .steps { max-width: 480px; margin: 0 auto; font-size: 15px; line-height: 1.7; color: #1a1a1a; }
      .steps li { margin-bottom: 6px; }
      .unit-name { text-align: center; margin-top: 40px; font-size: 13px; color: #777; }
    </style>
  </head>
  <body>
    <div class="brand-bar"></div>
    <div class="lockup"><span class="faca">Faça</span><span class="amigos">Amigos</span></div>
    <div class="tagline">Playground Inclusivo</div>

    <div class="title">📱 Acesso Rápido</div>
    <p class="subtitle">Aponte a câmera do celular para o QR Code abaixo</p>

    <div class="qr-frame"><img src="${data.qrDataUrl}" alt="QR Code de Acesso Rápido"></div>
    <p style="text-align:center; font-size:11px; color:#999; margin:-24px 0 32px; word-break:break-all;">${escapeHtml(data.url)}</p>

    <ol class="steps">
      <li>Preencha os dados da criança e do responsável;</li>
      <li>Escolha o plano desejado;</li>
      <li>Leia e aceite os Termos de Uso;</li>
      <li>Dirija-se ao balcão — os dados já estarão prontos para o educador confirmar a entrada.</li>
    </ol>

    <div class="unit-name">${data.unitName}</div>
  </body>
</html>`;
}

/** Abre o diálogo de impressão do navegador com o contrato em A4 (iframe oculto). */
export function printContract(html: string): void {
  let iframe = document.getElementById("fa-contract-print-iframe") as HTMLIFrameElement | null;
  if (!iframe) {
    iframe = document.createElement("iframe");
    iframe.id = "fa-contract-print-iframe";
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.style.visibility = "hidden";
    document.body.appendChild(iframe);
  }
  const doc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!doc) return;
  doc.open();
  doc.write(html);
  doc.close();
  // Espera as fontes do timbre carregarem antes de abrir o diálogo.
  setTimeout(() => {
    try {
      iframe?.contentWindow?.focus();
      iframe?.contentWindow?.print();
    } catch (err) {
      console.error("Erro ao imprimir o contrato:", err);
    }
  }, 400);
}
