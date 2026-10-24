# Ficha técnica — API de faturamento FaçaAmigos

Documento destinado à equipe técnica da administração do shopping.

| Item             | Valor                                                                     |
| ---------------- | ------------------------------------------------------------------------- |
| Versão do layout | 1.0 (campo `layoutVersao` de toda resposta)                               |
| Protocolo        | HTTPS · REST · JSON (CSV opcional em `/faturamento`)                      |
| Autenticação     | Chave de API estática, vinculada a uma unidade                            |
| Escopo           | `FATURAMENTO_LEITURA` — somente leitura                                   |
| Fuso horário     | O da unidade, informado em `loja.timezone` (padrão `America/Belem`, UTC−3) |
| Moeda            | BRL, valores inteiros **em centavos**                                     |

## 1. Endpoints

URL base: `https://app.institutofacaamigos.com.br`

Não há subdomínio dedicado de API nem de homologação. Homologação e produção
usam o mesmo host; o que muda é a chave enviada.

| Método | Caminho                          | Função                                 |
| ------ | -------------------------------- | -------------------------------------- |
| GET    | `/integracao/shopping/v1/health` | Valida a credencial, sem dados de venda |
| GET    | `/integracao/shopping/v1/faturamento` | Faturamento consolidado por dia   |
| GET    | `/integracao/shopping/v1/vendas` | Lista de vendas, uma linha por venda    |

## 2. Autenticação

Envie a chave em **um** dos dois cabeçalhos:

```
Authorization: Bearer <chave>
```

```
X-API-Key: <chave>
```

A chave é entregue individualmente pela FaçaAmigos. Do nosso lado ela é
guardada apenas como hash (SHA-256).

| Código | Corpo                             | Significado                                  |
| ------ | --------------------------------- | -------------------------------------------- |
| 401    | `{"error":"CHAVE_AUSENTE"}`       | Nenhum dos dois cabeçalhos foi enviado       |
| 401    | `{"error":"CHAVE_INVALIDA"}`      | Chave desconhecida                           |
| 401    | `{"error":"CHAVE_REVOGADA"}`      | Chave existia e foi revogada                 |
| 403    | `{"error":"ESCOPO_INSUFICIENTE"}` | Chave sem o escopo `FATURAMENTO_LEITURA`     |

A chave está sempre vinculada a uma unidade (loja), e é ela que define quais
dados são retornados. Qualquer parâmetro `unitId` na requisição é **ignorado**.

## 3. Verificação de credencial

```
GET /integracao/shopping/v1/health
```

Resposta 200:

| Campo          | Tipo    | Descrição                                |
| -------------- | ------- | ---------------------------------------- |
| `ok`           | boolean | Sempre `true` quando a chave é aceita    |
| `escopo`       | string  | `FATURAMENTO_LEITURA`                    |
| `layoutVersao` | string  | `1.0`                                    |
| `nowMs`        | number  | Hora do servidor, epoch em milissegundos |

## 4. Parâmetros de período (`/faturamento` e `/vendas`)

| Parâmetro | Obrigatório | Descrição                                                      |
| --------- | ----------- | -------------------------------------------------------------- |
| `de`      | sim         | Primeiro dia, `AAAA-MM-DD`                                     |
| `ate`     | sim         | Último dia, **inclusive**, `AAAA-MM-DD`                        |
| `formato` | não         | Só em `/faturamento`: `json` (padrão) ou `csv`                 |

- Se `de` ou `ate` faltar: `400` com
  `{"error":"PARAMETROS_INVALIDOS","message":"Parâmetros 'de' e 'ate' são obrigatórios"}`.
- O formato das datas **não é validado** pela API: envie sempre `AAAA-MM-DD`.
- Não há limite de tamanho do período nem limite de requisições.
- Falha interna de consulta: `500` com `{"error":"ERRO_CONSULTA","message":"..."}`.

### Dia de apuração

Cada venda é atribuída ao **dia civil (00:00 a 23:59, no fuso da unidade)** do
momento de fechamento da venda (pagamento ou cancelamento). A API não usa
corte de dia operacional.

## 5. Faturamento consolidado

```
GET /integracao/shopping/v1/faturamento?de=AAAA-MM-DD&ate=AAAA-MM-DD
```

### Resposta JSON

| Campo            | Tipo   | Descrição                                       |
| ---------------- | ------ | ----------------------------------------------- |
| `layoutVersao`   | string | `1.0`                                           |
| `loja`           | objeto | Identificação da unidade (ver abaixo)           |
| `periodo`        | objeto | Totais do período inteiro (ver abaixo)          |
| `dias`           | array  | Um objeto por dia, de `de` até `ate`            |
| `moeda`          | string | `BRL`                                           |
| `unidadeValores` | string | `CENTAVOS`                                      |
| `geradoEmMs`     | number | Hora de geração, epoch em milissegundos         |

`loja`:

| Campo           | Descrição                            |
| --------------- | ------------------------------------ |
| `unidadeId`     | Identificador da unidade             |
| `nome`          | Nome da unidade                      |
| `cnpj`          | CNPJ                                 |
| `razaoSocial`   | Razão social                         |
| `luc`           | LUC                                  |
| `codigoLojista` | Código lojista                       |
| `timezone`      | Fuso da unidade (padrão `America/Belem`) |

`periodo` e cada item de `dias` têm os mesmos campos de valores. `periodo`
traz `dataInicial` e `dataFinal`; cada item de `dias` traz `data`.

| Campo                     | Tipo   | Definição                                                                       |
| ------------------------- | ------ | ------------------------------------------------------------------------------- |
| `brutoCentavos`           | number | Soma do valor das vendas pagas                                                  |
| `descontosCentavos`       | number | **Nesta versão é sempre 0** (ver nota abaixo)                                   |
| `liquidoCentavos`         | number | Soma do valor das vendas pagas, igual a `brutoCentavos`                         |
| `cancelamentosCentavos`   | number | Valor das vendas canceladas, informado à parte e **não abatido** do bruto       |
| `quantidadeVendas`        | number | Quantidade de vendas pagas                                                      |
| `quantidadeCancelamentos` | number | Quantidade de vendas canceladas                                                 |
| `ticketMedioCentavos`     | number | `liquidoCentavos ÷ quantidadeVendas`, arredondado; 0 se não houver vendas       |
| `porNatureza.SERVICO`     | number | Soma dos itens de natureza serviço (tempo de brincadeira, sessão)               |
| `porNatureza.PRODUTO`     | number | Soma dos itens de natureza produto (venda no balcão)                            |
| `porMeioPagamento`        | objeto | Valor recebido por `DINHEIRO`, `PIX`, `CREDITO`, `DEBITO` e `VOUCHER`           |

**Sobre descontos.** O valor de cada venda já é o valor efetivamente cobrado,
depois de cupons e benefícios aplicados no fechamento. O layout reserva o
campo `descontosCentavos`, mas esta versão não o preenche: ele é sempre 0 e
`brutoCentavos` é igual a `liquidoCentavos`.

**Sobre `porNatureza`.** É calculado a partir dos itens de cada venda. Quando
uma venda teve desconto aplicado sobre o total, a soma de `SERVICO` e
`PRODUTO` pode ser maior que `liquidoCentavos`. Não há garantia de igualdade.

**Sobre `porMeioPagamento`.** O fechamento da venda no caixa só é aceito se a
soma dos pagamentos for igual ao total, portanto a soma dos cinco meios
coincide com `liquidoCentavos`.

Todo dia do intervalo aparece em `dias`, inclusive os sem movimento, com
valores zerados. Exemplo de um dia sem movimento:

```json
{
  "data": "AAAA-MM-DD",
  "brutoCentavos": 0,
  "descontosCentavos": 0,
  "liquidoCentavos": 0,
  "cancelamentosCentavos": 0,
  "quantidadeVendas": 0,
  "quantidadeCancelamentos": 0,
  "ticketMedioCentavos": 0,
  "porNatureza": { "SERVICO": 0, "PRODUTO": 0 },
  "porMeioPagamento": { "DINHEIRO": 0, "PIX": 0, "CREDITO": 0, "DEBITO": 0, "VOUCHER": 0 }
}
```

### Resposta CSV

Com `formato=csv`: `text/csv; charset=utf-8`, separador `;`, decimal com
vírgula, quebra de linha CRLF, valores em reais, uma linha por dia.

Colunas, nesta ordem:

```
data;cnpj;luc;codigo_lojista;bruto;descontos;liquido;cancelamentos;qtd_vendas;qtd_cancelamentos;ticket_medio;servico;produto;dinheiro;pix;credito;debito;voucher
```

## 6. Vendas, uma linha por venda

```
GET /integracao/shopping/v1/vendas?de=AAAA-MM-DD&ate=AAAA-MM-DD
```

Parâmetros adicionais, opcionais:

| Parâmetro                  | Descrição                                                              |
| -------------------------- | ---------------------------------------------------------------------- |
| `pagina` (ou `page`)       | Número da página, começando em 1                                       |
| `limite` (ou `limit`)      | Vendas por página                                                      |

Sem `pagina` e sem `limite`, todas as vendas do período são retornadas. Se
qualquer um dos dois for enviado, o padrão é `pagina=1` e `limite=1000`.

Resposta:

| Campo          | Descrição                                                              |
| -------------- | ---------------------------------------------------------------------- |
| `layoutVersao` | `1.0`                                                                  |
| `loja`         | `unidadeId`, `nome`, `cnpj`, `luc`, `codigoLojista`                    |
| `periodo`      | `dataInicial`, `dataFinal`, `totalVendas`, `brutoCentavos`             |
| `vendas`       | Array de vendas, em ordem cronológica                                  |
| `paginacao`    | Só quando há paginação: `pagina`, `limite`, `totalPaginas`, `totalRegistros` |
| `geradoEmMs`   | Hora de geração, epoch em milissegundos                                |

Cada item de `vendas`:

| Campo           | Tipo    | Definição                                                              |
| --------------- | ------- | ---------------------------------------------------------------------- |
| `idVenda`       | string  | Identificador único da venda (UUID)                                    |
| `dataHora`      | string  | Momento de fechamento, ISO 8601 com deslocamento `-03:00`              |
| `valorCentavos` | number  | Valor total da venda                                                   |
| `cancelado`     | boolean | `true` se a venda foi cancelada                                        |
| `troca`         | boolean | Reservado; nesta versão é sempre `false`                               |

Pontos de atenção:

- A lista inclui vendas pagas e canceladas.
- `periodo.totalVendas` e `periodo.brutoCentavos` contam só vendas **não
  canceladas** e sempre cobrem o **período inteiro**, independentemente da
  página retornada.
- `paginacao.totalRegistros` conta todas as vendas do período, canceladas
  inclusive.

## 7. Privacidade e LGPD

A API entrega apenas totais consolidados e, em `/vendas`, `idVenda`,
`dataHora`, `valorCentavos`, `cancelado` e `troca`. Nenhum dado de criança,
responsável, telefone, CPF ou colaborador é exposto.

## 8. Exemplos de chamada

Defina a chave recebida na variável de ambiente `FA_API_KEY`:

```bash
export FA_API_KEY='<chave recebida da FaçaAmigos>'
```

Verificação de credencial:

```bash
curl -X GET "https://app.institutofacaamigos.com.br/integracao/shopping/v1/health" \
  -H "Authorization: Bearer $FA_API_KEY"
```

Faturamento consolidado em JSON:

```bash
curl -X GET "https://app.institutofacaamigos.com.br/integracao/shopping/v1/faturamento?de=2026-10-01&ate=2026-10-31" \
  -H "X-API-Key: $FA_API_KEY"
```

Faturamento consolidado em CSV:

```bash
curl -X GET "https://app.institutofacaamigos.com.br/integracao/shopping/v1/faturamento?de=2026-10-01&ate=2026-10-31&formato=csv" \
  -H "X-API-Key: $FA_API_KEY" -o faturamento.csv
```

Vendas, paginadas de 500 em 500:

```bash
curl -X GET "https://app.institutofacaamigos.com.br/integracao/shopping/v1/vendas?de=2026-10-01&ate=2026-10-31&pagina=1&limite=500" \
  -H "Authorization: Bearer $FA_API_KEY"
```

## 9. Segurança e limites

- Não há limite de requisições (rate limit).
- Não há restrição de acesso por IP.
- Registramos apenas a data do último uso de cada chave. Não há log
  individual de requisições nem de tentativas negadas.
- Para revogar ou trocar uma chave, contate a FaçaAmigos.

## 10. Contato técnico

Bruno Freitas · brunofreitasbm@gmail.com · (91) 98847-0999
