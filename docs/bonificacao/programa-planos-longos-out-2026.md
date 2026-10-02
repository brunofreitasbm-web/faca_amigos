# Bônus de Planos Longos — Playground (Parque Shopping)

Início: **06/10/2026**, junto da recalibração do piloto de bonificação. Convive com o bônus de meta do dia (`programa-bonificacao-set-2026.md`) e não o substitui.
Para a equipe, use `manual-venda-planos-longos.md`: ele traz só a técnica de venda (método, script e trilha de treinamento), sem nada de bonificação. As regras de bônus da Parte 1 são passadas à equipe à parte.

---

## Parte 1 — Regras

Bônus **fixo por unidade vendida**, não por valor. Valores configuráveis pelo Owner por unidade.

| Produto | Bônus por unidade | % do preço com cupom | Escada no mês | Prêmio da escada |
|---|---|---|---|---|
| 2 horas (plano) | R$ 3 | 1,6% de R$ 192 | 12 | + R$ 15 |
| Day Use (pacote) | R$ 10 | 3,7% de R$ 270 | 2 | + R$ 10 |
| Porto Seguro (pacote) | R$ 25 | 3,0% de R$ 840 | 1 | + R$ 15 |

- **Teto próprio: R$ 100 por operador por mês**, fora dos R$ 200 do bônus de meta e produtos. 0 = sem teto.
- **Sem travas de caixa.** A trava de abertura e de fechamento continua zerando só o bônus de meta do dia. Venda consultiva não deve ser punida por atraso de abertura. Ponto a confirmar com o dono.
- Pago na folha do mês seguinte. Placar toda segunda no grupo.

### O que conta e para quem

| Produto | Como o sistema identifica | Quem leva |
|---|---|---|
| 2 horas | Sessão com plano cadastrado na regra, pedido pago, sem uso de saldo de pacote | Operador do check-in |
| Day Use, Porto Seguro | Linha em `fa_kiosk_guardian_packages` do pacote cadastrado na regra | Operador logado na venda; se não houver, quem fechou o pedido |

- Conta **por criança**. Irmãos no mesmo pedido de 2 horas são 2 unidades.
- Sessão paga por saldo de pacote **não** conta como 2 horas. O pacote já contou na venda.
- Pedido estornado tira a unidade, exceto pacote vendido no check-in ou por troca de plano (ver limitações).
- A regra editada no meio do mês vale para o mês inteiro. A configuração não é versionada, como no programa atual.

### Limitações conhecidas

- **Pacote vendido no check-in ou por troca de plano não tem pedido próprio.** O pedido nasce no checkout. Se ele for estornado, a linha do pacote continua contando.
- **2 horas por troca de plano no Painel** conta para quem fez o check-in, não para quem trocou. O upgrade não grava operador.
- **Pedido que fecha no mês seguinte** não entra no mês da sessão. É a mesma limitação da receita atual.
- **Pacote de outra unidade** conta na unidade e no dia da compra, onde quer que seja usado.

---

## Parte 2 — Simulação (para o dono)

Por operador, por mês, valores nominais.

| Cenário | 2 h | Day Use | Porto Seguro | Bônus unitário | Escadas | Total |
|---|---|---|---|---|---|---|
| Hoje, sem mudar nada | 3 | 0 | 0 | R$ 9 | 0 | **R$ 9** |
| Provável | 8 | 1 | 0 | R$ 34 | 0 | **R$ 34** |
| Bateu tudo | 12 | 2 | 1 | R$ 81 | R$ 40 | R$ 121, **teto R$ 100** |

Custo máximo: R$ 200 por mês para 2 operadores. Com encargos (×1,5): cerca de R$ 300.

Receita incremental no cenário "bateu tudo", 2 operadores. As premissas são hipóteses a validar:

| Item | Cálculo | Valor |
|---|---|---|
| 2 h no lugar de 1 h | 18 upgrades × R$ 84 (192 − 108) | + R$ 1.512 |
| Day Use | 4 vendas × R$ 270 | R$ 1.080 |
| Porto Seguro | 2 vendas × R$ 840 | R$ 1.680 |
| **Total** | | **≈ R$ 4.300** |

Atenção: Day Use e Porto Seguro nem sempre são receita nova. Quem compra Day Use provavelmente gastaria R$ 190 a R$ 270 em 2 horas. Quem compra Porto Seguro trocaria visitas avulsas por pré-pagamento. O ganho real é menor que o total acima. Só o 2 horas é upgrade de ticket quase puro.

**Regra de recalibração:** se em 2 semanas nenhum operador passar de 4 unidades de 2 horas, baixar a escada de 12 para 8. Se todos bateram em 2 semanas, subir.

---

## Parte 3 — Diagnóstico (kiosk, 28/08 a 29/09/2026, Playground)

### Mix de planos

| Plano | Sessões | Participação |
|---|---|---|
| 30 minutos | 361 | 67% |
| 1 hora | 164 | 30% |
| **2 horas** | **6** | **1,1%** |
| Pago com crédito de criança | 8 | 1,5% |
| **Total** | **539** | |

No sistema antigo (jun–jul, 1.014 sessões pagas) o 2 horas era 2%. Caiu, não subiu.

### Os seis planos de 2 horas do kiosk

Todos de sexta a domingo, entre 14h e 19h. Quatro caíram no piloto (Alessandra 3, Ana Alice 1).

### Preços reais, com cupom de 40%

| Produto | Tabela | Com 40% | Alternativa no plano de baixo |
|---|---|---|---|
| 30 min | R$ 100 | R$ 60 | — |
| 1 h | R$ 180 | R$ 108 | 30 min + 30 min de excedente = R$ 114 |
| 2 h | R$ 320 | R$ 192 | 1 h + 60 min de excedente = R$ 216 |
| Day Use (10 h, mesmo dia) | R$ 450 | R$ 270 | 2 h + 45 min de excedente = R$ 273 |
| Porto Seguro (10 h, 30 dias) | R$ 1.400 | R$ 840 | 10 × 1 h = R$ 1.080 |

Excedente: R$ 3,00 por minuto de tabela, R$ 1,80 com cupom. A renovação pelo celular do responsável (60 min por R$ 96) reduz a economia real do 2 horas para algo entre R$ 12 e R$ 24.

### Por que Day Use e Porto Seguro vendem pouco

**Não é falta de script.** O produto tem mercado pequeno:

- **Day Use:** só compensa contra 2 horas a partir de 2h45 de permanência. O plano de 2 horas tem mediana de 120 min e p90 de 192 min. Zero vendidos, 6 recusas registradas pelo motor VIP.
- **Porto Seguro:** exige 4 ou mais visitas por mês. De 433 crianças no período, 70 vieram 2 vezes ou mais e **7 vieram 4 ou mais**. Uma venda (R$ 700, meia inclusiva), 2 recusas.
- **Plano de 1 hora:** mediana de 60 min, p90 de 85 min. Só 7 de 164 passaram de 90 minutos. A maioria das famílias não fica além do plano.

O programa paga por venda, então paga mais pelos produtos mais raros. As metas mensais de Day Use (2) e Porto Seguro (1) foram calibradas para serem alcançáveis com poucas vendas. O dono decidiu manter os produtos como estão. Se o Day Use continuar em zero após 30 dias, reestruturar o produto (por exemplo 4 horas, sem o teto de 10) antes de aumentar o bônus.

### Calibração do piloto atual (para comparação)

Dias-operador em que a meta de faturamento foi batida: **6 de 22 (27%)**. Meta batida em 4 dias, supermeta em 2. Bônus de "45% de 1 hora" batido em 1 dia. A regra do piloto manda reduzir as metas em 10% quando menos de 30% dos dias batem.

---

## Como apurar

- **No aplicativo:** Gerencial > Metas configura as regras (seção "Bônus de Planos Longos"). Gerencial > Bonificação mostra por operador as unidades vendidas, o bônus de planos e o total do mês. Minha Bonificação mostra o placar ao operador.
- **No Supabase:** `apuracao_bonificacao.sql` traz as colunas `planos_2h`, `pacotes` e `bonus_planos` por dia e, ao final, o "Resumo mensal — planos longos" com escada e teto próprio. Ajuste o período em `params` de cada consulta.
- **A lógica** está em `apps/kiosk-ui/src/lib/apuracaoBonificacao.ts` (`apurarBonificacaoPorDia` e `agregarPorOperador`), com testes em `apuracaoBonificacao.test.ts`. O SQL e o TypeScript precisam ficar em sincronia.

## Como publicar

1. Aplicar as duas migrations de `supabase/migrations/20260930100000_fa_bonus_plan_rules.sql` e `20260930100001_fa_bonus_plan_rules_seed.sql`. A segunda semeia o Playground do Parque Shopping com os valores da Parte 1.
2. Publicar o aplicativo. **Nesta ordem:** o aplicativo novo lê a tabela de regras e a coluna de vendedor, e falha nas telas de bonificação se elas ainda não existirem.
3. Conferir em Gerencial > Metas > "Bônus de Planos Longos" se as três regras e o teto de R$ 100 aparecem.
4. Fazer um check-in com pacote e conferir `sold_by_employee_id` e `business_date` em `fa_kiosk_guardian_packages`.

Reverter é seguro: desmarcar as regras em Gerencial > Metas zera o bônus sem apagar nada.
