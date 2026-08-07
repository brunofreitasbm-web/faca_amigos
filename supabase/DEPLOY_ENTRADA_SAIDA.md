# Controle de Entrada e Saída — como funciona e como publicar

Entrega única: a migration `20260807000007_fa_entrada_saida.sql` **mais** a versão
nova do kiosk-ui e do print bridge. Publicar um sem o outro não quebra a operação,
mas deixa metade do fluxo sem efeito — ver "Ordem de publicação" no fim.

---

## 1. Como o sistema passa a funcionar

### Entrada (balcão)

O operador faz três toques:

1. digita as primeiras letras do nome e toca na criança encontrada — o sistema
   preenche responsável, telefone, CPF, nascimento, o carrinho de sempre e os
   cuidados inclusivos da última visita;
2. toca no plano;
3. toca em **Confirmar entrada**.

Criança nova abre o formulário completo; irmão da mesma família reaproveita o
responsável já preenchido.

No instante em que a entrada é gravada, o banco enfileira **as duas impressões na
mesma transação**:

| Via | Fica com | Impressora | Conteúdo |
|---|---|---|---|
| Pulseira / etiqueta | a criança | Gainscha GS-2208D (270 × 20 mm) | QR, código, nome, responsável, entrada, plano, cuidados — nome e código repetidos na outra ponta, porque a faixa dá a volta no pulso |
| Recibo de guarda | os pais | térmica 80 mm (Elgin / Bematech / Epson / Daruma) | QR, código em destaque, identificação completa da criança e do responsável com CPF, entrada e saída prevista, cuidados informados, regras de retirada e linha de assinatura |

"Na mesma transação" é o ponto: ou o check-in gravou e as duas vias saem, ou nada
sai. Não existe mais o estado de uma via impressa e a outra não.

O plano continua exigindo um toque explícito — é o único campo que define quanto
a família paga, e um plano pré-selecionado "para agilizar" é como se cobra o valor
errado de alguém.

### Saída padrão (celular, QR)

Menu **Saída** no celular. A câmera abre sozinha. Ao ler a pulseira ou o recibo, a
criança aparece na tela com o valor a pagar; um toque em **Cobrar e liberar**
fecha o atendimento e imprime o comprovante.

Funciona em Android (decodificador do próprio sistema) e em iPhone (decodificador
embutido no aplicativo, já que o Safari não oferece um). Se a câmera estiver
bloqueada ou suja, o mesmo código pode ser digitado — está impresso embaixo do QR
nas duas vias.

### Saída de contingência (recibo perdido **e** etiqueta danificada)

No **Painel**, no card da criança, botão **🪪 Saída manual**. O diálogo mostra
quem está autorizado a retirar aquela criança, com CPF, para o operador conferir
contra o documento com foto em mãos. Ele escolhe quem está retirando, informa qual
documento conferiu e confirma — daí segue para o mesmo pagamento de sempre.

Retirada por quem não está no cadastro (avó, tia, motorista) **não é bloqueada** —
travar a saída de uma criança por regra de software cria um problema pior do que
resolve — mas exige justificativa escrita e fica marcada como exceção no histórico
da sessão, junto com o nome do colaborador que liberou.

---

## 2. O código de acesso

Formato impresso: `K7M2-P9QX-3B7` — 11 caracteres.

- **8 caracteres sorteados** por gerador criptográfico do banco: 32⁸ ≈ 1,1 trilhão
  de combinações. Nunca sequencial, nunca derivado da data ou de um contador.
- **3 caracteres de verificação** derivados de HMAC-SHA256 com um segredo que não
  sai do banco. Código inventado é recusado antes de qualquer consulta.
- **Alfabeto Crockford Base32** (`0-9 A-Z` sem I, L, O, U): sem os pares que se
  confundem na leitura humana, e sem o U, que evita palavrão acidental. Na
  digitação, o sistema aceita I e L no lugar de 1 e O no lugar de 0.

O QR carrega só esses 11 caracteres — nada de endereço de internet ou assinatura
embutida. Resultado medido:

| | Antes | Agora |
|---|---|---|
| Caracteres no QR | 103 | 11 |
| Versão do QR | 6 | **1** (a menor que existe) |
| Módulos | 41 × 41 | **21 × 21** |
| Correção de erro | M | **Q** (mais alta) |
| Tamanho impresso na pulseira | ~11 mm apertados | **15,8 mm** com folga na faixa de 20 mm |

Menos módulos, cada um maior, com correção de erro mais alta: é isso que dá
engate imediato na câmera e tolerância ao borrão da impressão térmica e ao vinco
da pulseira dobrada no pulso.

Pulseiras impressas **antes** desta entrega continuam sendo lidas normalmente até
a criança ir embora.

---

## 3. Correções de defeitos incluídas

Três problemas encontrados durante o trabalho, todos com efeito visível na
operação:

1. **Comprovante de saída saía com "Código: undefined".** A migration
   `...000029` reescreveu `fa_checkout` a partir de uma versão antiga e desfez, sem
   querer, o código de venda que a `...000021` tinha adicionado. Restaurado.

2. **Fechamento sem venda registrada.** Quando o fechamento falhava por qualquer
   motivo, o aplicativo marcava a sessão como finalizada por conta própria e
   inventava um código local. A criança saía, mas nenhum pedido, item ou
   pagamento era gravado: o dinheiro entrava na gaveta e sumia do sistema, e o
   turno fechava com divergência sem rastro. Removido. Erro de fechamento agora
   aparece na tela para o operador resolver. Queda de rede continua coberta pela
   fila offline, que reenvia sozinha quando a conexão volta.

3. **Cuidados inclusivos eram descartados em silêncio.** A tela de Entrada tinha o
   seletor de tags sensoriais desde o começo, mas não havia coluna no banco nem
   parâmetro para recebê-las — e o Painel e a etiqueta liam um campo que nunca era
   preenchido. Agora são gravados, impressos na pulseira e no recibo, aparecem no
   card do Painel e na tela de Saída, e vêm pré-marcados na próxima visita da
   mesma criança.

Também corrigidos, de menor impacto: a linha `TOTAL:` dos cupons saía com 43
colunas numa bobina de 42 e dobrava na impressora; e `fa_kiosk_hmac8` devolvia 64
caracteres apesar do nome.

---

## 4. O que foi verificado

- **Gerador de código**: 5.000 códigos gerados num Postgres real, com as funções
  extraídas da própria migration. Todos com 11 caracteres, todos dentro do
  alfabeto, zero colisão, distribuição uniforme entre os 32 símbolos (desvio
  máximo de 4,6%). O dígito verificador aceitou 200/200 códigos legítimos e
  recusou 195/195 adulterados, além de string vazia, texto solto, endereço de
  internet e o formato antigo da pulseira. A normalização recuperou o código
  correto em todos os erros de digitação testados (minúscula, hífen, espaço, I no
  lugar de 1, O no lugar de 0).
- **Densidade do QR**: versão 1 / 21 × 21 módulos confirmada com o mesmo gerador
  de QR que o sistema usa para imprimir.
- **Gramática do SQL**: a migration inteira passa pelo analisador oficial do
  PostgreSQL (24 comandos).
- **Aplicação**: `typecheck`, `build` e `test` passam em todos os pacotes (82
  testes só no pacote de domínio, incluindo os novos do código de acesso, da
  etiqueta e do recibo de guarda).

**O que não foi verificado, e por quê:** a migration não foi executada de ponta a
ponta contra o banco real, porque não há Postgres nem Docker nesta máquina e
aplicá-la ao projeto em produção é decisão sua, não minha. O item 5 abaixo é
justamente esse teste.

---

## 5. Ordem de publicação

### 5.1 Migration

```bash
supabase link --project-ref ivjvpdzsfjdpyabbzzuj
supabase db push
```

> A migration remove a versão antiga de `fa_checkin` de propósito
> (`drop function ... ;` no bloco 4). Sem isso o PostgreSQL criaria uma **segunda**
> `fa_checkin` em vez de substituir a primeira, e qualquer terminal com a versão
> anterior do aplicativo continuaria caindo na função velha — registrando entrada
> **sem imprimir pulseira nem recibo**. Por isso a ordem abaixo importa.

### 5.2 Aplicativo do terminal e do celular

Publique o kiosk-ui logo em seguida. Entre a migration e a publicação, terminais
com a versão antiga recebem erro ao tentar entrada — janela curta, faça fora do
horário de pico.

### 5.3 Print bridge (o programa que fica no computador do balcão)

Precisa ser reinstalado/reiniciado: é ele que passou a desenhar o QR no recibo de
guarda. Sem atualizar, o recibo sai correto mas **sem a imagem do QR** — a saída
pela pulseira e a digitação do código continuam funcionando.

Confirme em **Configurações → Impressoras** que as duas estão escolhidas:
`printer_wristband` (Gainscha) e `printer_receipt` (a de 80 mm). Se faltar
qualquer uma, a impressão daquela via falha e fica marcada como `FAILED` na fila.

### 5.4 A câmera exige endereço seguro

`https://` ou `localhost`. Num endereço `http://` comum o navegador **não libera
a câmera** — a tela de Saída avisa e cai na digitação do código. Se o celular
acessa o sistema pela rede local sem certificado, isso precisa ser resolvido antes
de contar com o fluxo por QR.

---

## 6. Teste de aceitação (15 minutos, com o parque vazio)

1. **Entrada de criança nova** — cadastre, confirme. Saem a pulseira e o recibo?
   O código impresso nas duas é o mesmo?
2. **Entrada de criança repetida** — busque pelo nome. Vieram responsável,
   telefone e os cuidados da visita anterior? Deu três toques?
3. **Saída pelo QR da pulseira** — pelo celular. A câmera abriu sozinha? Leu de
   primeira? O valor bateu com o do Painel?
4. **Saída pelo QR do recibo** — repita com a via dos pais.
5. **Código digitado** — digite `k7m2-p9qx-3b7` (minúsculo, com hífen) de uma
   criança ativa. Encontrou?
6. **Código errado** — leia o QR de qualquer outro produto. A tela disse "código
   não reconhecido" sem travar?
7. **Leitura repetida** — leia a mesma pulseira de uma criança que já saiu. Disse
   que ela já foi liberada?
8. **Saída manual** — no Painel, "🪪 Saída manual". Apareceram os responsáveis com
   CPF? Exigiu o documento? Depois, confira no botão "📋 Sessão" se ficou
   registrado quem liberou e contra qual documento.
9. **Reimpressão** — logo após uma entrada, botão "🖨️ Reimprimir". Saíram as duas
   vias de novo, com o mesmo código?
10. **Caixa fechado** — tente fechar uma saída sem turno aberto. Avisou para abrir
    o caixa, em vez de liberar a criança sem registrar a venda?

Se o item 10 liberar a criança, pare e me chame: é o defeito nº 2 acima
ressurgindo.
