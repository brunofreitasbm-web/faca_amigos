# Motor de Cross-Selling (VIP + oferta de upgrade) — como funciona e como publicar

Entrega única: a migration `20260807000008_fa_upsell_vip.sql` **mais** a versão nova
do kiosk-ui. Publicar a migration sem o aplicativo é inofensivo (nada chama as
funções novas); publicar o aplicativo sem a migration quebra a busca de crianças na
tela de Entrada — ver "Ordem de publicação" no fim.

---

## 1. O que passa a acontecer no balcão

### O selo VIP

Toda criança com **4 ou mais check-ins nos últimos 30 dias** ganha o selo `★ VIP`.
São 30 dias *móveis*, não "neste mês": uma criança que veio nos dias 28, 29, 30 e 1º
é VIP no dia 1º.

O selo aparece em três lugares, sempre igual, sempre estático (não pisca):

- na lista de sugestões da busca, ao digitar o nome;
- ao lado do nome depois de a criança ser escolhida;
- no card dela no Painel, enquanto está no salão.

### A oferta

Quando o operador toca na criança e ela é VIP, aparece **acima de tudo** um card
laranja com o script pronto para ser lido em voz alta:

> Notei que a criança já nos visitou **4** vezes e o senhor(a) investiu
> **R$ 180,00** este mês. Se o senhor(a) fizer o upgrade para o **Pacote Amigão
> 10h** agora, por apenas mais **R$ 270,00**, ganha **10 horas mais uma meia
> antiderrapante de brinde**. O seu custo por hora cai de **R$ 60,00** para
> **R$ 45,00**.

Nenhum desses números é digitado por ninguém — todos vêm do banco, dos pedidos que
já foram pagos. Abaixo do texto, os quatro valores que decidem a conversa aparecem
de novo como etiquetas separadas, porque procurar um número no meio de um parágrafo
é onde o operador tropeça e o cliente percebe que está sendo lido um roteiro.

Dois botões, **do mesmo tamanho**:

| Botão | O que faz |
|---|---|
| ✓ **Upgrade Aceito (Ir para Pagamento)** | Abre a cobrança ali mesmo (PIX, crédito, débito ou dinheiro com calculadora de troco). Confirmado: gera o pedido, o pagamento, o saldo de horas do cliente e o comprovante impresso — tudo numa transação só. |
| ✕ **Recusado (Aplicar Cooldown)** | Registra a recusa e **bloqueia essa oferta para o responsável por 15 dias**. |

O botão de recusa não é um link discreto de canto de propósito: escondido, ele
simplesmente não é usado, o cooldown nunca é aplicado, e a mesma família ouve o
mesmo script na visita seguinte.

### Como o sistema escolhe o pacote

1. soma o que o **responsável** gastou em avulsos **no mês corrente** (fuso de
   Belém), direto dos pedidos já pagos;
2. procura o pacote de valor **imediatamente superior** a esse gasto;
3. só oferece se esse pacote **baixar o custo por hora** do cliente. Um pacote mais
   caro por hora contradiria a última frase do script, então ele nunca aparece.

O cliente paga a **diferença** entre o valor de tabela do pacote e o que já gastou
no mês. É exatamente o que o script promete.

### O saldo é honrado no caixa

O pacote é um saldo de minutos pré-pago. No fechamento, o tempo brincado sai do
saldo; o que passar do saldo é cobrado pela **tarifa de excedente por minuto** do
plano, não pelo preço cheio. O cupom mostra as duas linhas separadas ("Helena — 45
min do pacote" / "Além do saldo (8 min)"), porque um abatimento silencioso é
indistinguível de um erro de cobrança.

Enquanto a criança está no salão, o card do Painel mostra `🎟️ Pacote: X min de
saldo` — para o operador não estranhar quando o fechamento cobrar menos do que a
estimativa que estava na tela.

### Quando a oferta **não** aparece

| Motivo | Situação |
|---|---|
| `SEM_VIP` | menos de 4 visitas na janela |
| `COOLDOWN` | o responsável recusou há menos de 15 dias — vale para todos os filhos dele |
| `JA_TEM_PACOTE` | já comprou e ainda tem saldo |
| `SEM_GASTO_NO_MES` | nenhum avulso pago no mês: não há âncora de preço |
| `SEM_HORAS_APURADAS` | nenhuma visita fechada no mês: o custo por hora seria inventado |
| `SEM_PACOTE_SUPERIOR` | nenhum pacote acima do gasto que reduza o custo por hora |

Nenhum deles é erro. A tela simplesmente segue o check-in normal, como sempre.

---

## 2. O que o Owner precisa cadastrar antes

**Configurações → Pacotes** (só o Owner vê). Sem pelo menos um pacote cadastrado,
o motor nunca oferece nada — e não avisa, porque "não há oferta" é um estado normal.

Para cada pacote: nome, valor de tabela, horas incluídas, validade em dias e a
**frase do benefício** — ela é lida literalmente no script, então escreva como quer
ouvir ("2 horas extras e um lanche", não "benefício extra"). A tela mostra o custo
por hora do pacote enquanto você digita: é esse número que decide se ele chega a ser
oferecido.

Na mesma aba, as três regras do motor, todas com padrão pronto:

| Regra | Padrão |
|---|---|
| Visitas para virar VIP | 4 |
| Janela de contagem | 30 dias |
| Espera após recusa | 15 dias |

Monte os pacotes como uma **escada que desce**: se o avulso de 1 hora custa R$ 60,
o pacote de 5 h a R$ 250 dá R$ 50/h, o de 10 h a R$ 450 dá R$ 45/h. Uma escada que
não desce nunca aparece no balcão.

---

## 3. O que muda no banco

| Objeto | Para quê |
|---|---|
| `fa_kiosk_packages` | tabela de preços dos pacotes (**não** é `fa_kiosk_plans`, que continua sendo a permanência avulsa da visita) |
| `fa_kiosk_guardian_packages` | o que cada responsável comprou e quanto de saldo ainda tem |
| `fa_kiosk_upsell_offers` | log de conversão: uma linha por oportunidade, com os números exatos que foram ditos ao cliente, `EXIBIDA → ACEITA/RECUSADA` e o fim do cooldown |
| `fa_upsell_offer` / `fa_upsell_recusar` / `fa_upsell_vender_pacote` | as três portas do motor |
| `fa_checkout` | reescrita **com uma única adição**: o abatimento do saldo. Quem não tem pacote segue pelo caminho de código idêntico ao de hoje |
| `fa_kiosk_search_children` | passa a devolver `is_vip` e as visitas na janela |
| capacidade `venda.upsell` | nasce no Operador; Líder e Owner herdam |

Nenhuma tabela existente perde coluna e nenhum dado é reescrito. Só a tabela de
preços é editável pelo aplicativo (e só com `config.write`): as duas de movimento
não têm policy de escrita nenhuma — apenas as funções do banco gravam nelas, o que
impede um terminal de forjar uma "oferta aceita" ou de zerar o próprio cooldown.

---

## 4. Ordem de publicação

1. **A migration primeiro.** `supabase db push` (ou cole
   `20260807000008_fa_upsell_vip.sql` no SQL Editor). Sozinha ela é inerte: nada no
   aplicativo antigo chama as funções novas, e a `fa_kiosk_search_children` nova
   aceita a chamada antiga (o parâmetro da unidade tem valor padrão).
2. **Depois o kiosk-ui.** Antes disso, a tela de Entrada quebraria na busca de
   crianças, porque ela passa a esperar as colunas `is_vip` e `visits_in_window`.
3. **Por último, cadastre os pacotes** em Configurações → Pacotes.

Reverter é seguro: desative todos os pacotes (Configurações → Pacotes → Desativar) e
o motor para de oferecer imediatamente, sem tocar em nada do que já foi vendido.

---

## 5. Teste de aceitação (com o parque vazio)

1. **Sem pacote cadastrado** — busque uma criança qualquer. O check-in seguiu
   normal, sem card laranja e sem erro?
2. **Cadastre um pacote** em Configurações → Pacotes. A tela mostrou o custo por
   hora dele enquanto você digitava?
3. **Criança com menos de 4 visitas** — não deve aparecer selo nem oferta.
4. **Criança VIP** — o selo `★ VIP` apareceu na lista de busca, ao lado do nome e no
   card do Painel? Os três iguais, sem piscar?
5. **A oferta** — o card laranja apareceu **acima** do nome? Os números do texto
   batem com o que a família realmente gastou este mês?
6. **Recusa** — toque em "Recusado". Apareceu o aviso de bloqueio por 15 dias?
   Busque a mesma criança de novo: o card **não** pode voltar.
7. **Cooldown vale para o irmão** — busque outra criança do mesmo responsável. O
   card também não pode aparecer.
8. **Aceite** — em outra família VIP, toque em "Upgrade Aceito", escolha PIX e
   confirme. Saiu o comprovante com as horas e a validade? O código da venda
   apareceu no Caixa?
9. **Caixa fechado** — tente vender um upgrade sem turno aberto. Precisa recusar
   com "SEM_TURNO_ABERTO", não registrar a venda fora do caixa.
10. **O saldo é honrado** — faça um check-in dessa família e feche a saída. O card
    do Painel mostrou `🎟️ Pacote: X min de saldo`? O cupom saiu com a linha "N min
    do pacote" e o total cobrado foi menor?
11. **Não oferece duas vezes** — busque essa mesma família de novo. Não pode
    aparecer oferta enquanto houver saldo.

Se o item 10 cobrar o preço cheio mesmo com saldo, pare e me chame: é o cliente
pagando duas vezes pelo mesmo tempo.
