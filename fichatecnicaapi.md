# Ficha técnica — API de faturamento FaçaAmigos

**Anexo do e-mail de solicitação de integração.** Documento destinado à
equipe técnica da administração do shopping.

|                  |                                                                           |
| ---------------- | ------------------------------------------------------------------------- |
| Operação         | FaçaAmigos — playground inclusivo                                         |
| Sistema          | Sistema de gestão e caixa próprio (offline-first, servidor local na loja) |
| Versão do layout | 1.0                                                                       |
| Protocolo        | HTTPS · REST · JSON (ou CSV)                                              |
| Autenticação     | Chave de API estática, por escopo                                         |
| Escopo concedido | `FATURAMENTO_LEITURA` — somente leitura, apenas dados agregados           |
| Fuso horário     | America/Belem (UTC−3, sem horário de verão)                               |
| Moeda            | BRL, valores inteiros **em centavos**                                     |

## 1. Como se autenticar

A credencial é uma chave estática entregue pelo FaçaAmigos. Envie-a em **um**
dos dois cabeçalhos, o que for mais conveniente para o sistema de vocês:

```
Authorization: Bearer fa_shp_<prefixo>_<segredo>
```

```
X-API-Key: fa_shp_<prefixo>_<segredo>
```

Respostas de erro de autenticação:

| Código | Corpo                             | Significado                            |
| ------ | --------------------------------- | -------------------------------------- |
| 401    | `{"error":"CHAVE_AUSENTE"}`       | Nenhum dos dois cabeçalhos foi enviado |
| 401    | `{"error":"CHAVE_INVALIDA"}`      | Chave desconhecida ou malformada       |
| 401    | `{"error":"CHAVE_REVOGADA"}`      | Chave existia e foi revogada           |
| 403    | `{"error":"ESCOPO_INSUFICIENTE"}` | Chave não autorizada para faturamento  |

Toda tentativa de acesso — bem-sucedida ou não — fica registrada do nosso
lado com data, hora, IP de origem e período consultado.

## 2. Verificação de credencial

```
GET /integracao/shopping/v1/health
```

```json
{ "ok": true, "escopo": "FATURAMENTO_LEITURA", "layoutVersao": "1.0", "nowMs": 1786065516609 }
```

Não retorna nenhum valor financeiro. Serve para o shopping confirmar que a
credencial está válida sem precisar consultar faturamento.

## 3. Consulta de faturamento

```
GET /integracao/shopping/v1/faturamento?de=2026-03-01&ate=2026-03-31
```

| Parâmetro | Obrigatório | Descrição                                                    |
| --------- | ----------- | ------------------------------------------------------------ |
| `de`      | sim         | Primeiro dia do período, formato `AAAA-MM-DD`                |
| `ate`     | sim         | Último dia, inclusive. Máximo de 366 dias por consulta       |
| `formato` | não         | `json` (padrão) ou `csv`                                     |
| `unitId`  | condicional | Só necessário se a chave não estiver vinculada a uma unidade |

Se a chave for emitida vinculada a uma loja, o parâmetro `unitId` é ignorado
— o escopo da credencial prevalece sobre o parâmetro.

### Resposta (JSON)

```json
{
  "layoutVersao": "1.0",
  "loja": {
    "unidadeId": "018bcfe5-6800-790d-b959-c3de7ede5578",
    "nome": "FaçaAmigos (Parque Shopping)",
    "cnpj": "12345678000195",
    "razaoSocial": "FaçaAmigos Entretenimento Infantil LTDA",
    "luc": "L-142",
    "codigoLojista": "PSB-0142",
    "timezone": "America/Belem",
    "cutoffHoraDiaOperacional": 4
  },
  "periodo": {
    "dataInicial": "2026-03-01",
    "dataFinal": "2026-03-31",
    "brutoCentavos": 4850000,
    "descontosCentavos": 120000,
    "liquidoCentavos": 4730000,
    "cancelamentosCentavos": 18000,
    "quantidadeVendas": 812,
    "quantidadeCancelamentos": 3,
    "ticketMedioCentavos": 5825,
    "porNatureza": { "SERVICO": 4310000, "PRODUTO": 420000 },
    "porMeioPagamento": {
      "DINHEIRO": 380000,
      "PIX": 1920000,
      "CREDITO": 1650000,
      "DEBITO": 760000,
      "VOUCHER": 20000
    }
  },
  "dias": [
    {
      "data": "2026-03-01",
      "brutoCentavos": 186000,
      "descontosCentavos": 6000,
      "liquidoCentavos": 180000,
      "cancelamentosCentavos": 0,
      "quantidadeVendas": 31,
      "quantidadeCancelamentos": 0,
      "ticketMedioCentavos": 5806,
      "porNatureza": { "SERVICO": 165000, "PRODUTO": 15000 },
      "porMeioPagamento": {
        "DINHEIRO": 12000,
        "PIX": 78000,
        "CREDITO": 62000,
        "DEBITO": 28000,
        "VOUCHER": 0
      }
    }
  ],
  "moeda": "BRL",
  "unidadeValores": "CENTAVOS",
  "geradoEmMs": 1786065516609
}
```

### Resposta (CSV)

Com `formato=csv`, o retorno é `text/csv; charset=utf-8`, separador `;`,
decimal com vírgula, quebra de linha CRLF — abre direto no Excel em
português.

```
data;cnpj;luc;codigo_lojista;bruto;descontos;liquido;cancelamentos;qtd_vendas;qtd_cancelamentos;ticket_medio;servico;produto;dinheiro;pix;credito;debito;voucher
2026-03-01;12345678000195;L-142;PSB-0142;1860,00;60,00;1800,00;0,00;31;0;58,06;1650,00;150,00;120,00;780,00;620,00;280,00;0,00
```

## 4. Definição de cada campo

| Campo                   | Definição                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| `brutoCentavos`         | Preço de tabela × quantidade, **antes** de qualquer desconto                             |
| `descontosCentavos`     | Diferença entre o preço de tabela e o efetivamente cobrado (promoção, cupom, fidelidade) |
| `liquidoCentavos`       | Valor efetivamente cobrado do cliente. `bruto − descontos`                               |
| `cancelamentosCentavos` | Vendas canceladas no dia, **declaradas à parte** e não abatidas do bruto                 |
| `porNatureza.SERVICO`   | Receita de tempo de brincadeira / sessão                                                 |
| `porNatureza.PRODUTO`   | Receita de venda no balcão (meias, bebidas, souvenires)                                  |
| `porMeioPagamento`      | Valor recebido por forma de pagamento. A soma equivale ao líquido                        |
| `ticketMedioCentavos`   | `liquido ÷ quantidade de vendas`, arredondado                                            |

Garantias de consistência que o nosso sistema verifica antes de publicar
qualquer declaração:

- soma dos meios de pagamento = líquido do período;
- soma de serviço + produto = líquido do período;
- todo dia do intervalo aparece na resposta, **inclusive os sem movimento**,
  com valores zerados — nunca há lacuna de data.

## 5. Dia operacional

O campo `cutoffHoraDiaOperacional` informa a hora em que o nosso dia
operacional vira (padrão: 4h). A operação funciona das 10h às 22h; o corte
às 4h existe para que o fechamento de caixa não parta o expediente ao meio.
Se a apuração do empreendimento usar a meia-noite cheia, ajustamos essa
configuração — é um parâmetro, não uma regra fixa do sistema.

## 6. Privacidade

A interface transmite **apenas valores agregados por dia**. Nenhum registro
individual de venda, nenhum dado de criança, de responsável ou de
colaborador é exposto por esta API. Foi desenhada assim de propósito: boa
parte do nosso público é composta por crianças, várias delas com laudo, e
esse dado não deve circular além do necessário.

## 7. Disponibilidade e alternativas

O servidor roda na própria loja e depende do link do empreendimento. Se a
administração preferir **não depender da nossa disponibilidade**, temos duas
alternativas equivalentes, com o mesmo conteúdo e o mesmo layout:

1. **Envio ativo (push)** — passamos a enviar diariamente para o endereço
   que vocês indicarem, no formato que vocês definirem;
2. **Arquivo** — geramos o CSV (ou o layout de texto de vocês) e
   depositamos por SFTP ou anexamos ao portal do lojista.

Basta indicar a preferência.

## 8. Contato técnico do FaçaAmigos

[Seu nome] · [e-mail] · [telefone]
