# Programa de Bonificação — Playground e Circuito (Parque Shopping)

Piloto: **08/09 a 05/10/2026**. Recalibração das metas em 06/10 com 30 dias de kiosk.
Teto: **R$ 200 por operador por mês** (10% do salário de R$ 2.000). Apuração: `apuracao_bonificacao.sql`.

Para imprimir e entregar direto à equipe, use `manual-operadores.md` — só as regras
e exemplos, sem a simulação e o diagnóstico deste documento. As mesmas regras também
aparecem ao vivo no Painel (card **🎮 Bonificação de hoje**), calculadas em
`apps/kiosk-ui/src/bonificacao.ts`.

---

## Parte 1 — Regras (para a equipe)

### Vale para as duas unidades

1. **Só conta o que está no kiosk.** Sessão com check-in no seu PIN e pedido pago. O formulário antigo de bonificação acabou.
2. **É individual e por dia.** Quem trabalhou o dia leva o bônus do dia. A meta muda conforme o dia da semana.
3. **Duas travas. Falhou uma, o bônus do dia é zero:**
   - Caixa aberto no kiosk **até 10h15**.
   - Fechamento **sem diferença acima de R$ 20 sem justificativa**. Diferença justificada e aceita pelo dono não zera.
4. **Teto de R$ 200 no mês**, contando metas e produtos.
5. Pago na folha do mês seguinte. Placar toda segunda-feira no grupo.

### Playground — "Meta do Dia + 1 Hora"

Meta é o **faturamento do seu dia** (valor pago, já com desconto).

| Dia | Meta | Supermeta | Bateu meta | Bateu supermeta |
|---|---|---|---|---|
| Seg a qui | R$ 900 | R$ 1.100 | R$ 8 | R$ 12 |
| Sexta | R$ 1.500 | R$ 1.800 | R$ 12 | R$ 16 |
| Sábado | R$ 2.400 | R$ 2.800 | R$ 12 | R$ 16 |
| Domingo | R$ 2.200 | R$ 2.600 | R$ 12 | R$ 16 |

- Supermeta substitui a meta, não soma.
- **+ R$ 2 no dia** se 45% ou mais das sessões forem de 1 hora ou mais.
- Produto (meia, água): R$ 2 por item abaixo de R$ 40.

Exemplo: sábado com R$ 2.500 e 12 de 25 sessões de 1 h → R$ 12 + R$ 2 = **R$ 14**.

### Circuito — "Locações do Dia + Carrinho"

Meta é o **número de locações do seu dia**.

| Dia | Meta | Supermeta | Bateu meta | Bateu supermeta |
|---|---|---|---|---|
| Seg a qui | 8 | 10 | R$ 6 | R$ 10 |
| Sexta | 10 | 12 | R$ 10 | R$ 16 |
| Sábado | 22 | 27 | R$ 10 | R$ 16 |
| Domingo | 30 | 35 | R$ 10 | R$ 16 |

- **+ R$ 1 por locação acima da meta.**
- Produto vendido: **R$ 2** por item até R$ 40 (miniatura, balão, massinha) e **R$ 4** por item de R$ 49,90 ou mais (helicóptero, pick up, viatura).
- **10 produtos no mês → + R$ 10** uma vez.

Exemplos: terça com 10 locações → R$ 10 + R$ 2 = **R$ 12**. Domingo com 36 → R$ 16 + R$ 6 = **R$ 22**. Segunda com 5 → **R$ 0**.

---

## Parte 2 — Simulação (para o dono)

Base mensal de 30 dias (17 seg–qui, 4 sex, 4 sáb, 5 dom) a partir das médias por dia da semana de 19/08 a 02/09. Cada operador trabalha ~15 dias (8,5 seg–qui, 2 sex, 2 sáb, 2,5 dom).

### Quanto cada operador recebe

| Cenário | Playground | Circuito |
|---|---|---|
| Meta todo dia | R$ 146 | R$ 116 |
| Supermeta todo dia | R$ 206 → teto R$ 200 | ≈ R$ 232 → teto R$ 200 |
| Meta em 60% dos dias + supermeta em 15% | ≈ R$ 120 | ≈ R$ 115 |
| Não bateu nada | R$ 0 | R$ 0 |

### Playground — quanto entra vs quanto paga

| Cenário | Faturamento/mês | Δ vs hoje | Bônus (2 operadoras) | Bônus ÷ Δ receita |
|---|---|---|---|---|
| Hoje | R$ 38.660 | — | 0 | — |
| Meta todo dia | R$ 41.900 | **+ R$ 3.240 (+8%)** | ≈ R$ 320 | 10% |
| Supermeta todo dia | R$ 50.100 | **+ R$ 11.440 (+30%)** | R$ 400 (teto) | 3,5% |
| Provável | ≈ R$ 42.300 | + R$ 3.660 (+9%) | ≈ R$ 240 | 6,5% |

Como se chega na meta: +1 sessão/dia = + R$ 2.580/mês; 1 h de 38% para 45% das sessões (33 upgrades × R$ 48) = + R$ 1.580/mês. Os dois juntos passam da meta. Supermeta exige ≈ +3 sessões/dia.

### Circuito — quanto entra vs quanto paga

| Cenário | Locações/mês | Faturamento/mês | Δ vs hoje | Bônus (2 operadores) | Bônus ÷ Δ receita |
|---|---|---|---|---|---|
| Hoje | 355 | R$ 19.170 | — | 0 | — |
| Meta todo dia | 414 | R$ 22.356 | **+ R$ 3.190 (+17%)** | ≈ R$ 270 | 8,5% |
| Supermeta todo dia | 501 | R$ 27.054 | **+ R$ 7.880 (+41%)** | R$ 400 (teto) | 5% |
| Provável | ≈ 415 | ≈ R$ 22.400 | + R$ 3.230 (+17%) | ≈ R$ 230 | 7% |

Como se chega na meta: +2 locações em dia de semana (6 → 8) e +2 no fim de semana. A supermeta de dia de semana (10) aconteceu em 02/09; a de domingo (35) quase em 23/08 (34).

Produtos: meta de 10 itens/operador/mês = 20 na unidade ≈ + R$ 700–900/mês de receita (hoje ≈ R$ 350), pagando ≈ R$ 60–80.

### Consolidado (2 unidades, 4 operadores)

| Cenário | Faturamento/mês | Δ receita | Bônus nominal | Bônus com encargos (×1,5) | Sobra líquida |
|---|---|---|---|---|---|
| Hoje | R$ 57.830 | — | 0 | 0 | — |
| Meta todo dia | R$ 64.256 | **+ R$ 6.430 (+11%)** | R$ 590 | R$ 885 | + R$ 5.500 |
| Supermeta todo dia | R$ 77.154 | **+ R$ 19.320 (+33%)** | R$ 800 | R$ 1.200 | + R$ 18.100 |
| Provável | ≈ R$ 64.700 | + R$ 6.900 (+12%) | ≈ R$ 470 | ≈ R$ 700 | + R$ 6.200 |
| Nada batido | R$ 57.830 | 0 | 0 | 0 | 0 |

O programa custa no máximo R$ 800/mês nominal (1,4% da receita atual) e só custa isso se a receita subir 33%. O risco financeiro é zero. O risco real é meta mal calibrada.

**Regra do piloto:** se nas 2 primeiras semanas ninguém bater meta em mais de 30% dos dias, reduzir as metas em 10%. Se todo mundo bater em mais de 80% dos dias, subir 10%.

### Sobre o teto de R$ 200 e encargos

Bônus pago com habitualidade a CLT integra a remuneração (férias, 13º, FGTS, INSS): custo real ≈ R$ 280–340 por pessoa no teto. Enquadrar como **prêmio por desempenho acima do esperado** (CLT art. 457, §2º e §4º) evita a integração. Confirmar com o contador antes do primeiro pagamento.

### Sobre o carrinho (por que não R$ 5)

Na miniatura de R$ 32,90, R$ 5 é 15% do preço e, assumindo custo de R$ 15–18, entre 30% e 40% da margem bruta. Os R$ 2 propostos são 6% do preço e ≈ 11–13% da margem. Nos itens de R$ 49,90–74,90, R$ 4 é 5–8% do preço. Se o custo do carrinho passar de R$ 20, cair para R$ 1,50 / R$ 3. O custo dos produtos não está no sistema; vale cadastrar.

---

## Parte 3 — Diagnóstico dos 15 dias (19/08 a 02/09)

### Antes de qualquer meta: o que está errado

1. **Base suja.** Até 27/08 as unidades fechavam no sistema antigo e preenchiam formulário manual; o kiosk só tem dado confiável a partir de 28/08. Faltam 2 dias por unidade, há valores digitados em centavos (51800, 119190, 175480) e testes do owner em 26/08. As 991 sessões "legadas" importadas no kiosk com data 01–11/08 não batem com o formulário manual (08/08: 166 importadas vs 35 reportadas) e não servem de comparação.
2. **Meta única por unidade paga quem pega o domingo.** Domingo fatura 5–10× a segunda; cada unidade tem 2 operadores que se revezam.
3. **Playground: 98% das sessões saem com desconto.** 40% promocional em 72%, meia inclusiva em 22%. Preço real: R$ 60 (30 min) e R$ 108 (1 h). A meta de ticket cadastrada (R$ 120) não depende do operador. Os pacotes PORTO SEGURO (R$ 1.400 / 10 h = R$ 140/h) e DAY USE (R$ 450) custam mais por hora que o avulso com cupom (R$ 108/h): 0 vendidos, 5 de 5 ofertas recusadas. Reprecificar antes de bonificar pacote.
4. **Metas antigas do Circuito estão 3–4× acima da realidade** (seg–qui 20, sex 38, sáb 45, dom 40). Com o preço de R$ 25 → R$ 48, a realidade é seg–qui 2–10, sex 5–9, sáb 17–23, dom 24–34. Receita por locação dobrou, volume caiu 30%.
5. **Circuito: divergência de caixa em 4 dos 6 fechamentos no kiosk** (R$ 202, 177, 217, 352).
6. **Metas de ticket cadastradas desalinhadas:** Playground mín 60 / alvo 120 (real 98 por pedido) → sugerido 85 / 105. Circuito mín 45 / alvo 53 (real 56, já batida) → sugerido 50 / 58.

### Playground

| Dia | Sem. | Faturamento | Sessões | Fonte |
|---|---|---|---|---|
| 19/08 | qua | 786,80 | 10 | legado |
| 20/08 | qui | 1.028,50 | 14 | legado |
| 21/08 | sex | 950,60 | 9 | legado |
| 22/08 | sáb | 2.141,19 | 21 | legado |
| 23/08 | dom | 2.490,80 | 30 | legado |
| 24/08 | seg | — | — | sem fechamento |
| 25/08 | ter | 893,40 | 9 | legado |
| 26/08 | qua | 518,00 | 8 | legado ("51800"); kiosk R$ 888 = teste |
| 27/08 | qui | — | — | sem fechamento |
| 28/08 | sex | 1.928,78 | 23 | kiosk |
| 29/08 | sáb | 2.363,20 | 25 | kiosk |
| 30/08 | dom | 1.636,20 | 18 | kiosk |
| 31/08 | seg | 722,20 | 11 | kiosk |
| 01/09 | ter | 738,60 | 11 | kiosk |
| 02/09 | qua | 912,80 | 10 | kiosk |

| Indicador | Valor |
|---|---|
| Faturamento (13 dias) | R$ 17.111 (≈ R$ 18.700 com os 2 dias faltantes) |
| Média/dia | R$ 1.316 |
| Seg–qui | R$ 800/dia |
| Sex–dom | R$ 1.918/dia — 67% da receita |
| Sessões | 199 (15,3/dia) |
| Receita por sessão | R$ 86 |
| Ticket por pedido (kiosk) | R$ 98 (18% dos pedidos com 2 irmãos: R$ 168) |
| Mix | 61% 30 min · 38% 1 h · 1% 2 h |
| Desconto concedido | R$ 6.192 (≈ 40% do bruto) |
| Excedente | R$ 1.737 em 8 dias, R$ 924 de 2 sessões atípicas; normal ≈ R$ 100/dia |
| Produtos / pacotes | R$ 85 / 0 |
| Horário | Manhã morta (11–13 h: 7 sessões em 8 dias). Pico 17–18 h e 20 h |
| Pagamento | Crédito 35%, PIX 30%, débito 25%, dinheiro 10% |

Operadoras: Alessandra 17,3 sessões/dia (R$ 115/sessão), Ana Alice 9,8/dia (R$ 113/sessão). A diferença de volume é escala (Alessandra pegou sex/dom), não desempenho.

### Circuito

| Dia | Sem. | Faturamento | Locações | Fonte |
|---|---|---|---|---|
| 19/08 | qua | 288,00 | 6 | legado |
| 20/08 | qui | 240,00 | ~5 | legado |
| 21/08 | sex | 432,00 | 9 | legado |
| 22/08 | sáb | 1.191,90 | 23 | legado ("119190") |
| 23/08 | dom | 1.754,80 | 34 | legado ("175480") |
| 24/08 | seg | — | — | sem fechamento |
| 25/08 | ter | — | — | sem registro |
| 26/08 | qua | 240,00 | 5 | kiosk (caixa aberto 17h16) |
| 27/08 | qui | ~192 | 4 | formulário manual |
| 28/08 | sex | ~240 | 5 | kiosk (pedidos caíram em 29/08) |
| 29/08 | sáb | 1.064,90 | 17 | kiosk |
| 30/08 | dom | 1.409,00 | 24 | kiosk |
| 31/08 | seg | 99,00 | 2 | kiosk |
| 01/09 | ter | 444,00 | 8 | kiosk |
| 02/09 | qua | 555,00 | 10 | kiosk |

| Indicador | Valor |
|---|---|
| Faturamento (13 dias) | R$ 8.151 (≈ R$ 8.600 com os 2 dias faltantes) |
| Média/dia | R$ 627 |
| Seg–qui | R$ 294/dia (≈ 6 locações) |
| Sex–dom | R$ 1.015/dia — 75% da receita; sáb+dom = 66% |
| Locações | 152 (11,7/dia) |
| Receita por locação | R$ 54–57 (tabela R$ 48; excedente +17%) |
| Mix | Pelúcia/Jeep 20 min 64% · Carro/moto 30 min 36% |
| Produtos | R$ 95 (1 viatura R$ 74,90, 1 balão) |
| Recorrência | 61 de 63 crianças vieram 1 vez |
| Horário | Zero venda antes das 14 h em todos os dias; pico 18–20 h |
| Pagamento | PIX 55%, débito 20%, dinheiro 15%, crédito 10% |

Operadores: Dalton 12 locações/dia, Luciane 9,7/dia, ambos ≈ R$ 56/locação. Mesma leitura: diferença é escala.

Catálogo de produtos do Circuito: Miniatura carrinho R$ 32,90 (10 em estoque), Helicóptero R$ 49,90 (6), Pick Up R$ 49,90 (1), Viatura R$ 74,90 (2), balões R$ 10,90–40, massinha R$ 14,90, pilhas R$ 5.

### Fora do bônus, mas que o destrava

- Circuito abre 10 h e vende zero até 14 h: testar abertura 12 h seg–qui, ou usar a manhã para abordagem no shopping.
- Aposentar as regras de locações de julho (`fa_regras_locacoes`).
- Cadastrar o custo dos produtos no sistema para calibrar a comissão.
- Fase 2 de sistema: meta por dia da semana em `daily_goal_cents` (hoje é um valor único por unidade) para o relatório das 17h/19h/20h e o fechamento mostrarem a meta certa.

---

## Simulação retroativa: se as regras valessem de 28/08 a 02/09

| Unidade | Operador | Dias | Bônus que teria recebido | Dias zerados por trava |
|---|---|---|---|---|
| Playground | Alessandra | 3 | R$ 20 (sex 28/08: supermeta R$ 16 + 2 meias R$ 4) | 1 (dom 30/08: caixa aberto 13h16) |
| Playground | Ana Alice | 3 | R$ 12 (sáb 29/08: +R$ 2 de 1 h; qua 02/09: meta R$ 8 + R$ 2 de 1 h) | 0 |
| Circuito | Dalton | 3 | R$ 6 (ter 01/09: 8 locações = meta) | 2 (sex 28/08: sem caixa no kiosk; dom 30/08: aberto 13h36) |
| Circuito | Luciane | 3 | R$ 12 (qua 02/09: supermeta R$ 10 + 2 acima da meta) | 1 (sáb 29/08: aberto 10h21) |

Total: R$ 50 em 6 dias para 4 pessoas. Metas batidas em 4 de 12 dias-operador. Leitura: as metas estão no lugar certo (nem fáceis, nem impossíveis), e a trava de abertura teria zerado 4 dias, o que é exatamente o comportamento a corrigir.

## Como apurar

`apuracao_bonificacao.sql` roda no Supabase (somente leitura). Ajuste o período em `params`. Saída: uma linha por operador por dia com faturamento, sessões, produtos, hora de abertura, divergência, as duas travas, bônus do dia e acumulado do mês já com o teto de R$ 200. A hora de abertura é a do primeiro caixa aberto por um operador no dia (caixa do owner não conta); em dia com troca de turno, quem abriu pode não ser quem fez os check-ins. Validado contra os fechamentos de 28/08 a 02/09 (Playground 29/08 = R$ 2.363,20 / 25 sessões; Circuito 30/08 = R$ 1.389 de sessões + R$ 20 de produto = R$ 1.409 / 24 locações).
