# E-mail para a administração do shopping

Copie a partir de "Assunto:". Antes de enviar, troque tudo que está entre
colchetes `[ ]` — são os dados que só você tem. Se não souber algum, veja
`README.md` desta pasta, que explica onde encontrar cada um.

---

**Para:** [e-mail da administração / gerência de operações do Parque Shopping]
**Com cópia:** [e-mail do TI do shopping, se você já tiver] · [seu contador]
**Assunto:** Integração de faturamento — FaçaAmigos (LUC [XXX]) — solicitação de especificação técnica e credenciais de acesso

---

Prezados,

Sou [seu nome completo], [sócio-administrador / diretor] do **FaçaAmigos**,
operação de playground inclusivo instalada no [Parque Shopping Belém], LUC
[XXX], CNPJ [XX.XXX.XXX/0001-XX].

Estamos concluindo a implantação do nosso sistema próprio de gestão e caixa,
e gostaríamos de **automatizar a apuração e o envio do nosso faturamento**
para as rotinas mensais do empreendimento (aluguel percentual, fundo de
promoção e rateio de condomínio), substituindo a declaração manual.

O objetivo é simples: o número que vocês recebem passa a sair direto do
nosso caixa, sem digitação no meio. Isso elimina erro de transcrição,
atraso de envio e a conversa de conferência no fim do mês.

Do nosso lado a parte técnica **já está pronta**: temos uma API REST
autenticada, somente leitura, que entrega o faturamento agregado por dia
(bruto, descontos, cancelamentos, líquido, quebra por meio de pagamento e
separação entre receita de serviço e de produto). A especificação completa
está no documento anexo. Ela foi construída de forma neutra justamente para
se adaptar ao padrão de vocês — seja consumindo a nossa API, seja enviando
arquivo ou requisição para o sistema do shopping.

Para concluir a integração, precisamos das informações abaixo. Organizei em
blocos para facilitar o encaminhamento a cada área.

## 1. Modelo de integração

1.1. O shopping **consulta** o sistema do lojista (vocês chamam a nossa API),
ou **recebe** os dados (nós enviamos para um endereço de vocês)? Ou a
declaração é feita exclusivamente por um portal do lojista?

1.2. Se o shopping recebe: qual a URL de destino, o método (REST, SFTP,
webservice SOAP, upload no portal) e o formato esperado?

1.3. Se o shopping consulta: qual o endereço de IP de origem das chamadas de
vocês, para liberarmos no nosso firewall?

1.4. O empreendimento utiliza alguma plataforma de mercado para isso
(ex.: sistema de gestão de shoppings, portal do lojista de terceiro)? Se
sim, qual — para verificarmos se já existe conector pronto.

## 2. Especificação técnica e layout dos dados

2.1. Documentação técnica da interface (OpenAPI/Swagger, manual do lojista,
PDF de layout) e um **exemplo real** de requisição e de resposta.

2.2. Relação exata dos campos exigidos. Do nosso lado conseguimos entregar,
por dia: faturamento bruto, descontos concedidos, cancelamentos, faturamento
líquido, quantidade de vendas, ticket médio, valor por meio de pagamento
(dinheiro, PIX, crédito, débito, voucher) e separação entre receita de
serviço e de produto. Falta algum campo obrigatório nessa lista?

2.3. Formato do arquivo ou do corpo da requisição (JSON, XML, CSV, TXT de
largura fixa), encoding (UTF-8 ou ISO-8859-1), separador e formato de
número — valor com vírgula ou com ponto, com ou sem separador de milhar.

2.4. Como a loja é identificada no envio: LUC, CNPJ, código de lojista
interno de vocês, ou uma combinação. Se houver um código de lojista próprio
do sistema do shopping, favor informar o nosso.

2.5. Tratamento de casos específicos, para não haver divergência de critério:

- Vendas em **PIX** e em **voucher/cortesia** entram na base declarada?
- **Assinaturas e pacotes mensais**: o valor é declarado na venda ou
  proporcionalmente ao consumo?
- **Cancelamentos e estornos** devem ser abatidos do bruto ou declarados em
  campo separado? (hoje declaramos em campo separado)

2.6. É exigido vínculo com documento fiscal (NFC-e / SAT / série e número)?
Em caso positivo, em qual campo e com qual nível de detalhe.

## 3. Credenciais e segurança

3.1. Qual o método de autenticação adotado: chave de API, client_id +
client_secret, OAuth 2.0, certificado digital, ou usuário e senha de portal?

3.2. **Por qual canal seguro recebemos a credencial?** Solicitamos que a
chave **não** seja enviada por e-mail em texto aberto. Aceitamos cofre de
senha, portal com download único ou entrega presencial.

3.3. Existe política de expiração ou rotação periódica da credencial? Com
qual prazo e qual o procedimento de renovação?

3.4. Há ambiente de **homologação (sandbox)** separado do de produção? Se
sim, precisamos das duas URLs e das duas credenciais.

3.5. É necessário cadastro prévio de IP (allowlist) do nosso lado? Se sim,
informe o formato do pedido e nós encaminhamos o nosso endereço.

## 4. Periodicidade e prazos

4.1. Frequência do envio: diária, semanal ou mensal?

4.2. Horário-limite para o envio de cada dia.

4.3. Data de corte do mês para a apuração: dia 1 ao último dia do mês, ou
período contratual diferente?

4.4. Um ponto de critério que costuma gerar divergência: **operamos das 10h
às 22h**, e o nosso sistema fecha o "dia operacional" às 4h da manhã, de
modo que uma venda registrada logo após a meia-noite pertence ao dia
anterior. Se o padrão de vocês for a meia-noite cheia, ajustamos o corte —
só precisamos saber qual é.

4.5. Prazo e procedimento de **retificação**: se um cancelamento ou estorno
ocorrer depois do envio, como corrigimos a declaração já entregue?

## 5. Base contratual e conferência

5.1. Podem nos encaminhar a cláusula do contrato de locação que define a
**base de cálculo do faturamento** — o que entra e o que fica de fora?

5.2. O percentual aplicado difere conforme a natureza da receita (serviço
versus venda de produto)? Nosso sistema já separa as duas.

5.3. Como o shopping devolve o **extrato ou demonstrativo de conferência**
mensal, para batermos com o nosso relatório interno antes do vencimento?

5.4. Qual a penalidade prevista por atraso na declaração? Perguntamos para
configurar o alerta interno com folga suficiente.

## 6. Proteção de dados (LGPD)

6.1. Registramos que a nossa integração transmite **exclusivamente valores
agregados por dia**. Nenhum dado pessoal de criança, de responsável ou de
colaborador atravessa essa interface. Pedimos confirmação de que esse nível
de detalhe atende à necessidade do empreendimento.

6.2. Caso o shopping precise de qualquer informação individualizada por
venda ou por cliente, solicitamos que a **finalidade e a base legal** sejam
formalizadas por escrito, para avaliação prévia — inclusive porque parte do
nosso público é composta por crianças, o que exige cuidado adicional no
tratamento de dados.

## 7. Contatos

7.1. Nome, e-mail e telefone do **contato técnico (TI)** responsável pela
integração e do **contato de operações/comercial** responsável pela
apuração.

7.2. Canal e prazo de atendimento em caso de falha de envio — precisamos
saber para quem ligar num dia 30 à noite.

---

Nosso ambiente está pronto para testes e conseguimos **gerar uma credencial
de homologação no mesmo dia** em que vocês indicarem o modelo de integração.
Se for mais produtivo, tenho disponibilidade para uma reunião de 30 minutos
com o time de TI do empreendimento para alinhar os pontos acima de uma vez.

Fico no aguardo e agradeço desde já.

Atenciosamente,

**[Seu nome completo]**
[Cargo] — FaçaAmigos
[Telefone] · [E-mail]
CNPJ [XX.XXX.XXX/0001-XX] · LUC [XXX]

_Anexo: Ficha técnica da API de faturamento FaçaAmigos (v1)_

---

## Versão curta

Se preferir começar com algo mais leve e deixar o detalhamento para a
resposta, envie só isto:

> **Assunto:** Integração de faturamento — FaçaAmigos (LUC [XXX])
>
> Prezados,
>
> Sou [nome], do FaçaAmigos (LUC [XXX], CNPJ [XX.XXX.XXX/0001-XX]).
> Estamos implantando nosso sistema de gestão e queremos automatizar o
> envio do faturamento usado na apuração mensal, substituindo a
> declaração manual.
>
> Para isso, precisamos saber:
>
> 1. Como o shopping recebe esses dados hoje — portal, arquivo ou API?
> 2. Existe documentação técnica e layout de campos que possamos seguir?
> 3. Qual o tipo de credencial de acesso e por qual canal seguro ela é
>    entregue?
> 4. Qual a periodicidade, o horário-limite e a data de corte da apuração?
> 5. Quem é o contato técnico responsável pela integração?
>
> Do nosso lado a integração já está pronta e documentada — envio a ficha
> técnica assim que soubermos o padrão de vocês.
>
> Fico à disposição para uma conversa rápida com o time de TI.
>
> Atenciosamente,
> [Seu nome] — FaçaAmigos · [telefone]
