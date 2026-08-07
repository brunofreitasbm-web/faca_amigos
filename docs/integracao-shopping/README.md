# Integração de faturamento com o shopping — guia prático

Escrito para ser lido por quem **não** programa. Explica o que existe nesta
pasta, o que já está pronto no sistema e o que fazer, em ordem.

## O que é isso, em uma frase

Todo contrato de locação em shopping obriga a loja a declarar quanto vendeu.
Esse número entra na conta do aluguel percentual, do fundo de promoção e, em
muitos contratos, no rateio do condomínio. Hoje isso costuma ser feito à mão,
por planilha ou portal. O que foi construído aqui permite que o número saia
direto do nosso caixa, sem ninguém digitar nada.

> Vale um alerta honesto: na maioria dos contratos o **condomínio é um valor
> fixo rateado por área**, e quem varia com o faturamento é o **aluguel
> percentual** e o **fundo de promoção**. Pode ser que no nosso contrato seja
> diferente. Por isso o item 5.1 do e-mail pede a cláusula específica — vale
> confirmar antes de assumir qualquer coisa.

## Arquivos desta pasta

| Arquivo                    | Para que serve                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `email-para-o-shopping.md` | O e-mail pronto. Copie, troque o que está entre `[ ]` e envie. Tem uma versão longa e uma curta              |
| `ficha-tecnica-api.md`     | O anexo do e-mail. É o documento que o TI do shopping vai ler. Você não precisa entender — precisa só anexar |
| `README.md`                | Este guia                                                                                                    |

## O que já está pronto no sistema

Foi implementado nesta entrega:

- **Cadastro da identificação da loja** — CNPJ, razão social, LUC e código de
  lojista. São os dados que o shopping usa para saber que a declaração é
  nossa.
- **Apuração diária do faturamento** — bruto, descontos, cancelamentos,
  líquido, quantidade de vendas, ticket médio, valor por forma de pagamento e
  separação entre receita de serviço (tempo de brincadeira) e de produto
  (meia, bebida, souvenir).
- **Um endereço na internet que o shopping pode consultar**, protegido por
  uma chave de acesso que só nós emitimos.
- **Exportação em CSV** (planilha), caso o shopping prefira arquivo em vez de
  consulta automática.
- **Registro de todo acesso** — quem consultou, quando, de qual IP e qual
  período pediu. Isso é a nossa prova numa eventual discussão de "vocês não
  enviaram".
- **Conferência automática antes de declarar** — o sistema avisa se falta
  cadastrar algum dado, ou se as contas não fecham entre si.

O que **não** foi decidido — porque depende da resposta deles:

- o formato exato que a administração exige;
- se eles consultam a gente ou se a gente envia para eles;
- a periodicidade e o horário-limite.

Nada disso trava o trabalho já feito. A apuração é a mesma nos três
cenários; muda só o "envelope".

## Passo a passo

### 1. Junte os dados antes de enviar o e-mail

Preencha esta lista — todos estão no contrato de locação ou no cartão CNPJ:

- [ ] CNPJ da empresa (14 dígitos)
- [ ] Razão social exata
- [ ] **LUC** — o código da loja no contrato, algo como `L-142`. É o
      "endereço" da nossa loja dentro do empreendimento
- [ ] E-mail da administração / gerência de operações
- [ ] Seu nome, cargo e telefone

Se não achar a LUC, o e-mail funciona mesmo assim — deixe o campo em branco
e peça a confirmação no próprio texto.

### 2. Envie o e-mail

Abra `email-para-o-shopping.md`, escolha a versão longa ou a curta, troque o
que está entre colchetes e anexe `ficha-tecnica-api.md` (exporte para PDF se
preferir).

**Qual versão usar:** se você já tem contato direto com o TI do shopping,
mande a longa — economiza duas semanas de idas e vindas. Se o canal é só a
administração e você quer evitar que o e-mail seja ignorado por parecer
técnico demais, mande a curta e guarde a longa para a resposta.

### 3. Cadastre a identificação da loja no sistema

Assim que tiver CNPJ e LUC confirmados, é uma chamada ao sistema:

```
PUT /api/unidades/{unitId}/identificacao-fiscal
{
  "cnpj": "12.345.678/0001-95",
  "razaoSocial": "FaçaAmigos Entretenimento Infantil LTDA",
  "shoppingLuc": "L-142",
  "shoppingStoreCode": "PSB-0142"
}
```

Pode mandar o CNPJ com ou sem pontuação — o sistema guarda só os dígitos.

### 4. Confira a declaração antes de qualquer envio

```
GET /api/faturamento/declaracao?unitId={unitId}&de=2026-03-01&ate=2026-03-31
```

A resposta traz dois blocos: `declaracao` (os números) e `pendencias` (o que
ainda falta). **Se `pendencias` vier vazio, está pronto para declarar.** Se
vier algo, o texto diz exatamente o que resolver.

### 5. Quando o shopping responder

**Se eles quiserem consultar a nossa API:** emita uma chave de acesso.

```
POST /api/integracao/chaves
{ "employeeId": "<id de um funcionário ADMIN>",
  "nome": "Parque Shopping — declaração de faturamento",
  "unitId": "<id da unidade>" }
```

Três cuidados que importam:

1. **O segredo aparece uma única vez**, nessa resposta. Não existe jeito de
   recuperá-lo depois. Guarde no gerenciador de senhas antes de fechar a
   tela.
2. **Não mande a chave por e-mail comum.** Use cofre de senha, ou entregue
   pessoalmente. É credencial de acesso ao nosso faturamento.
3. **Sempre informe o `unitId`.** A chave fica presa àquela loja e não
   enxerga as outras, mesmo que alguém tente forçar pela URL.

Perdeu a chave, ou o contato do shopping mudou? Revogue e emita outra:

```
POST /api/integracao/chaves/{id}/revogar
```

A revogação vale na hora. A chave antiga passa a ser recusada na consulta
seguinte.

**Se eles preferirem arquivo:** peça o CSV do período e envie pelo canal que
eles indicarem.

```
GET /integracao/shopping/v1/faturamento?de=2026-03-01&ate=2026-03-31&formato=csv
```

**Se eles usarem layout próprio (TXT posicional, XML, portal específico):**
a apuração já está pronta; falta só a tradução para o formato deles. Isso é
uma função nova em
`packages/domain/src/faturamento/faturamento-shopping.ts` — pequena, e sem
mexer em nada do que já funciona.

### 6. Acompanhe

```
GET /api/integracao/acessos
```

Mostra as últimas consultas: data, rota, período pedido, IP e se deu certo.
Se o shopping reclamar de falta de envio, a resposta está aqui.

## Perguntas que provavelmente vão aparecer

**"Cancelamento entra no faturamento?"**
Hoje declaramos o cancelamento em campo separado, sem abater do bruto — é o
critério mais comum e o mais defensável em auditoria. Se o shopping exigir
abatimento, é ajuste de uma linha. Está no item 2.5 do e-mail.

**"Por que uma venda das 23h50 aparece no dia anterior?"**
Nosso dia operacional fecha às 4h da manhã, para o fechamento de caixa não
partir o expediente. O valor vai na declaração, no campo
`cutoffHoraDiaOperacional`. Se o shopping usar meia-noite cheia, mudamos o
parâmetro. Item 4.4 do e-mail.

**"O shopping vai ver dados das crianças?"**
Não. A interface entrega apenas totais por dia. Nenhum nome, nenhum CPF,
nenhum laudo, nenhum registro individual de venda atravessa essa fronteira.
Isso é decisão de projeto, não limitação técnica — e o item 6 do e-mail
deixa isso registrado por escrito com eles.

**"E se o sistema estiver fora do ar quando eles consultarem?"**
O servidor roda na loja e depende do link do shopping. A ficha técnica
oferece duas alternativas (envio ativo e arquivo) exatamente para essa
situação. Vale acordar isso desde o começo, e não no dia 30.

## Onde está o código

| O quê                          | Onde                                                                                                                                    |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Consultas de faturamento       | `packages/db-local/src/repositories/faturamento.ts`                                                                                     |
| Montagem do documento e CSV    | `packages/domain/src/faturamento/faturamento-shopping.ts`                                                                               |
| Rotas (internas e externas)    | `apps/kiosk/src/server/routes/faturamento.ts`                                                                                           |
| Chaves de acesso               | `apps/kiosk/src/server/security/api-key.ts`                                                                                             |
| Contrato publicado (validação) | `packages/contracts/src/faturamento.ts`                                                                                                 |
| Tabelas                        | `packages/db-local/src/migrations/0005_integracao_shopping.sql` e `supabase/migrations/20260806000028_fa_kiosk_integracao_shopping.sql` |
| Testes                         | `apps/kiosk/test/faturamento.spec.ts`                                                                                                   |
