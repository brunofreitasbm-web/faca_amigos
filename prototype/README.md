# Protótipo clicável — Fase 0

Maquete estática (HTML + CSS + JS puro, sem build, sem backend) das telas
operacionais do sistema FaçaAmigos. Existe para validar o fluxo **com a
equipe do balcão** antes de escrever qualquer regra de negócio real —
critério de aceite: a equipe compara contra o que hoje incomoda no
SafePlay, não "está bonito".

## Como abrir

Mais simples — dois cliques:

1. Abra `index.html` diretamente no navegador (duplo clique no arquivo).

Se o navegador bloquear o `@import` de CSS entre pastas por política local
(raro, mas acontece em alguns ambientes corporativos), sirva por um
servidor estático simples a partir da raiz do projeto:

```
npx serve .
# abra http://localhost:3000/prototype/
```

## O que dá para testar

- **Dois pontos independentes** — alterne Loja/Quiosque no topo. Cada um
  tem suas próprias sessões e seu próprio turno de caixa; fechar o caixa
  de um não afeta o outro.
- **Check-in** — formulário reduzido, seleção visual de carrinho (só no
  Quiosque, com status disponível/em uso), consentimentos **separados**
  (o botão só libera com o termo de uso aceito), Day Use com teto
  configurável.
- **Painel** — isolamento visual por unidade (Loja mostra playground,
  Quiosque mostra frota), timer ao vivo, semáforo de 4 fases
  (verde/âmbar/vermelho/excedente) com ícone + rótulo, nunca só cor.
- **Check-out** — pareamento de dois códigos (pulseira + ticket); dá para
  simular tanto o caminho feliz quanto o mismatch (botão "bipar código
  errado"); sugestão de upgrade de pacote que **não se aplica sozinha**;
  exceção de ticket perdido com PIN + justificativa.
- **PDV** — venda avulsa de produtos, sem vínculo com sessão.
- **Caixa** — abrir turno, sangria/suprimento, e o fechamento **cego**:
  o sistema só revela o valor esperado depois que você declara o
  contado.
- **"Simular queda de servidor"** (botão no topo) — mostra o banner de
  contingência e bloqueia novos check-ins, como descrito na seção 5.1 do
  plano de arquitetura.

## O que este protótipo NÃO é

Não persiste nada (recarregar a página zera o estado), não fala com
impressora nem leitor de QR de verdade (a "impressão" é um texto em
tela, o "bipe" é um botão), não se conecta a banco ou nuvem. A lógica de
cotação (`quoteCheckout` em `app.js`) é uma versão simplificada do
algoritmo real de `packages/domain` — os casos centrais (tolerância,
fração, Day Use, sugestão de upgrade) foram verificados com valores
conhecidos antes de considerar a maquete pronta, mas não é o motor de
produção nem tem a suíte de ~70 casos que a Fase 1 exige.

## Tokens

`styles.css` importa os tokens de `../packages/ui/src/tokens/` — os
mesmos que a SPA real vai usar, não uma cópia solta. Se o visual daqui
mudar, é porque o token mudou lá, e vice-versa.
