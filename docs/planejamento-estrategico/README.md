# Planejamento Estratégico de Cultura — Ecossistema Faça Amigos

Pasta de trabalho do planejamento estratégico de missão, visão, valores e cultura do ecossistema
(Playground Parque Shopping, Circuito, Playground Grão-Pará, Clínica, Instituto e o que vier).

## Etapas

| Etapa | O que é | Status |
|---|---|---|
| 1. Entrevista dos sócios (rodada 1) | Mesmo questionário, 48 itens, respondido às cegas por Bruno e Isabella | Publicado como artefato no claude.ai (set/2026) |
| 2. Mapa de convergência e divergência | Comparação item a item das duas respostas; separa alinhado, divergente e ponto cego | Depois das duas respostas |
| 3. Rodada 2 (curta) | Só sobre os itens divergentes: decisão forçada com argumento | Depois do mapa |
| 4. Planejamento de cultura v0.1 | Missão revisada, visão 2031, valores com comportamentos observáveis e o que se sacrifica por eles, regras de decisão entre sócios, núcleo comum vs. variável por unidade, roadmap 90 dias, indicadores com baseline e meta | Depois da rodada 2 |

## Arquivos

- `entrevista-socios.html` — página publicada como artefato (fonte de verdade da rodada 1).
- `entrevista-socios.itens.json` — os 48 itens e os 8 blocos, para leitura e análise sem abrir o HTML.

## Desenho do instrumento (rodada 1)

**Por que um único questionário, às cegas.** O objetivo não é coletar duas opiniões; é medir onde os
sócios concordam sem saber e divergem sem saber. Isso só funciona com o mesmo instrumento, respondido
sem conversa prévia.

**Ordem dos blocos e o motivo.**

1. **A · Propósito** — leitura atual do negócio e da missão de jan/2026, antes de qualquer lista.
2. **C · Valores declarados** — primeiro nas próprias palavras (sem lista), depois ranking de 8 candidatos,
   descarte e aposta sobre o outro. Vem *antes* dos trade-offs para capturar valores declarados
   sem contaminação.
3. **B · Escolhas difíceis** — 10 escalas de 6 pontos (sem meio) entre dois polos e 2 cenários de escolha
   única. Cada item ancora numa tensão real encontrada nos sistemas e documentos: 98% das sessões com
   desconto, bônus por faturamento do turno, plano de R$103k vs. R$58k reais, digitalização de protocolos
   sem licença, triagem gratuita como funil, investidor externo. Valores *revelados*. A distância entre C e B
   é o dado central.
4. **D · Histórias** — 4 incidentes críticos (orgulho, traição de valor, discordância entre sócios,
   demitir/promover contra os números).
5. **E · Cultura no chão** — 8 afirmações com escala "hoje" e no máximo 3 marcadas como prioridade 12 meses.
6. **F · Sociedade e decisão** — quem decide hoje vs. quem deveria (7 temas), cotas 100% vs. operação,
   horas/semana, o que se perde primeiro se ABM/Cacau Show/clínica puxarem, sucessão, desempate,
   pró-labore, acordo de saída.
7. **G · Unidades** — núcleo vs. periférico, inegociáveis transversais, o Circuito expressa a missão?,
   o que não cruza entre playground e clínica, palavra final clínica.
8. **H · Fechamento** — missão e visão em uma frase, 3 palavras que quer / não quer ouvir, calibração
   (chance de bater com o outro) e pergunta que faltou.

**Itens com dado embutido** (b2, b3, b11, f3) perguntam também "esse dado era novidade para você?".
A assimetria de informação entre os sócios é ela mesma uma das tensões a planejar.

**Tempo estimado:** 55 a 65 minutos. Pode ser feito em duas ou três sentadas; cada resposta é salva.

## Como funciona a página

- Artefato claude.ai com banco (`db`) e identidade (`user`). Cada sócio grava apenas o próprio documento
  `respostas/<id-do-usuário>`; regras: `respostas` lê/escreve só admin, `respostas/{self}` lê/escreve
  o próprio Contributor.
- **Compartilhar a Isabella como Contributor**, nunca Editor (Editor lê os dois documentos). Ela precisa
  abrir logada na organização do Bruno; link público não grava.
- O dono do artefato consegue ler os dois documentos por contrato da plataforma. A cegueira é
  verificável pelas datas: Bruno responde e envia **primeiro**; o `enviado_em` dele deve ser anterior ao
  `iniciado_em` dela. Claude confere as marcas antes de analisar.
- Se o banco não estiver disponível (consentimento negado, fora da organização), a página salva só no
  navegador e, ao final, mostra um bloco de texto para copiar e enviar.
- Depois de enviado, o documento trava na página (`status: "enviado"`).

## Leitura das respostas (Claude)

`ArtifactData` → `list` na coleção `respostas`. Cada documento: `respondente`, `versao`, `status`,
`answers` (chave = id do item; itens com dado embutido têm também `<id>_novidade`), `iniciado_em`,
`atualizado_em`, `enviado_em`.
