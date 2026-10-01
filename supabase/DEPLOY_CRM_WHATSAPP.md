# CRM WhatsApp (Playground + Circuito) — deploy

Subconta Twilio dedicada: `FacaAmigos Playground e Circuito` (SID e token em `.env.local` como `TWILIO_CRM_ACCOUNT_SID` / `TWILIO_CRM_AUTH_TOKEN`; nunca commitar).

## 1. Banco
Aplicar `migrations/20260928120000_fa_crm_whatsapp.sql` (projeto `ivjvpdzsfjdpyabbzzuj`).

## 2. Secrets das Edge Functions
```
supabase secrets set TWILIO_CRM_ACCOUNT_SID=AC... TWILIO_CRM_AUTH_TOKEN=...
```
Opcional: `CRM_WEBHOOK_PUBLIC_URL` (padrão: `https://ivjvpdzsfjdpyabbzzuj.supabase.co/functions/v1/crm-whatsapp-webhook`).
Precisa ser idêntica à URL cadastrada na Twilio — a assinatura é calculada sobre ela.

## 3. Deploy
```
supabase functions deploy crm-whatsapp-webhook   # verify_jwt=false (config.toml)
supabase functions deploy crm-whatsapp-send
```

## 4. Número (quando o chip chegar)
1. Twilio Console (subconta) > Messaging > Senders > WhatsApp senders > Self sign-up; verificar o chip por SMS/ligação.
2. Nesse sender, "Webhook URL for incoming messages" = URL do `crm-whatsapp-webhook`.
3. Cadastrar o canal:
```sql
insert into fa_crm_channels (unit_id, label, whatsapp_e164)
values ('<uuid da unidade>', 'Playground', '+5591XXXXXXXXX');
```
Para testar antes: sandbox da Twilio, `whatsapp_e164 = '+14155238886'`, `is_sandbox = true`.

## 5. Templates (mensagens fora da janela de 24h)
Criar no Twilio Content Template Builder, aguardar aprovação da Meta, e registrar:
```sql
insert into fa_crm_templates (name, content_sid, preview, variable_count)
values ('Boas-vindas', 'HX...', 'Olá {{1}}! Obrigado por visitar o FaçaAmigos 💛', 1);
```

## Permissões
`crm.read` / `crm.write`: Líder e Owner. `crm.admin` (canais/templates): Owner. Ajustáveis em Gerencial > Permissões.

## NPS por WhatsApp
A pesquisa saiu da tela pública de acompanhamento e passou a ser enviada pelo CRM (`crm-nps-send`, botão "Enviar NPS" na conversa ou em lote). A pesquisa pergunta a unidade e depois as notas (veja "NPS em etapas" abaixo). As respostas são tratadas em `crm-whatsapp-webhook` e aparecem no feed de NPS da Visão Geral Owner.

Cadastrar o template aprovado pela Meta (variável {{1}} = primeiro nome):
```sql
insert into fa_crm_templates (name, content_sid, preview, variable_count, purpose)
values ('NPS pós-visita', 'HX...', 'Olá {{1}}! Como foi sua visita ao FaçaAmigos? De 0 a 10, o quanto você nos recomendaria a um amigo? Responda só com o número. 💛', 1, 'NPS');
```
Proteções: máx. 100 contatos por envio; pula quem pediu PARAR e quem recebeu NPS nos últimos 30 dias.

### NPS em etapas, dentro do WhatsApp
Migration `20261001140000_fa_crm_nps_steps.sql`. O pai nunca sai do WhatsApp e responde digitando o número:
1. **Unidade** (pergunta do template v2; resposta = número da lista `1) … · 2) … · 3) …`);
2. **Recomendação 0-10** (o NPS oficial) → 3. **Equipe 1-5** → 4. **Espaço 1-5**;
5. **Contribuição** em texto livre (ou "não").

As perguntas 2 a 5 são mensagens livres dentro da janela aberta pela resposta do pai: só o template da primeira pergunta precisa de aprovação. Leitura das respostas em `supabase/functions/_shared/nps.ts` (testes: `deno test supabase/functions/_shared/nps.test.ts`); fluxo em `crm-whatsapp-webhook` (`handleNps`). O envio (`crm-nps-send`, `crm-nps-auto-dispatch`) grava em `fa_crm_nps_surveys.unit_options` a lista de unidades enviada, para o número digitado apontar sempre para a unidade certa.

**Template novo:** `fa_nps_pos_visita_v2` (purpose `NPS`, 2 variáveis: `{{1}}` primeiro nome, `{{2}}` lista de unidades em linha única). Crie/submeta com `crm-templates-bootstrap`; ele só ativa depois que a Meta aprovar. Enquanto não houver v2 ativo, o envio continua com o v1 (que já abre pedindo a nota 0-10): a pesquisa funciona igual, só sem a pergunta de unidade (aparece como "Não informada" no dashboard). Depois da aprovação, retire o v1 em `RETIRED`.

Ordem de deploy: aplicar a migration → publicar `crm-whatsapp-webhook`, `crm-nps-send` e `crm-nps-auto-dispatch` → front → aprovar o v2.

**Dashboard:** aba "Dashboard NPS" no Gerencial (Visão Geral & IA). Dados vêm de `fa_crm_nps_dashboard` e `fa_crm_nps_comments` (exigem `crm.read` ou `relatorio.read`; nome e telefone só com `crm.read`).

**Réguas de promotor/detrator:** `20261001150000_fa_crm_nps_lifecycle_done.sql` corrige o filtro (`status in ('SCORED','DONE')`; antes só `SCORED`). **Só aplicar depois de `20261001130000_fa_crm_offer_ladder`**, que é de onde vem a função que ela recria.

## Aviso de fim de plano + renovação por WhatsApp
Substitui o "avisar 5 min antes" (Web Push), o bloco de renovação e o card da ZoeIA da tela pública de acompanhamento. `crm-renewal-alert-dispatch` roda a cada minuto (pg_cron), avisa quem deu aceite de contato no check-in e oferece 3 opções de +min/R$ por botão de resposta rápida. O toque vira `RENOVACAO_SOLICITADA` (mesmo pedido pendente que o balcão já vê); sem cobrança automática.

1. Aplicar `migrations/20260928160000_fa_crm_renewal_alert.sql` e `supabase functions deploy crm-renewal-alert-dispatch crm-whatsapp-webhook`.
2. Template `twilio/quick-reply` aprovado pela Meta (categoria Utility), 3 botões com ID `RENOVAR_1`, `RENOVAR_2`, `RENOVAR_3` (títulos "Opção 1/2/3"). Variáveis: {{1}} responsável, {{2}} criança, {{3}} opções (ex.: `1) +15 min por R$ 30,00 · 2) +30 min por R$ 48,00 · 3) +60 min por R$ 96,00`):
```sql
insert into fa_crm_templates (name, content_sid, preview, variable_count, purpose)
values ('Aviso fim de plano', 'HX...', 'Oi {{1}}! O tempo de {{2}} termina em poucos minutos. Para continuar sem pressa: {{3}}. Toque na opção desejada.', 3, 'RENOVACAO');
```
3. Ligar por unidade (desligado por padrão):
```sql
insert into fa_kiosk_app_settings (unit_id, key, value) values ('<uuid da unidade>', 'crm_renewal_alert', '1');
```
Preços: `PLAYGROUND_OPTIONS`/`CIRCUITO_OPTIONS` na function espelham `copy.ts`/`copyCircuito.ts`; o valor enviado fica congelado em `fa_crm_renewal_alerts.options`. Push já inscrito continua disparando até a sessão acabar (a tela não inscreve mais).

## Avisos da visita (boas-vindas, fim do plano, renovação aplicada, fidelidade)
`crm-visit-notify-dispatch` roda a cada minuto (pg_cron) e leva para o WhatsApp o que a tela pública de acompanhamento já mostra. Só quem deu aceite de contato no check-in recebe; cada tipo é ligado separadamente por unidade e nasce desligado.

| Tipo | Quando sai | Flag | `purpose` do template | {{3}} |
|---|---|---|---|---|
| WELCOME | até 20 min após o check-in (plano avulso; banco de horas/pacote ficam de fora) | `crm_notify_welcome` | `VISITA_BOAS_VINDAS` | link `?acompanhar=<code>` |
| OVERAGE | teto do plano passou há até 45 min, sessão ativa, sem pedido de renovação pendente | `crm_notify_overage` | `VISITA_EXCEDENTE` | valor do minuto adicional (`R$ 3,00`) |
| RENEWAL_OK | balcão marcou `RENOVACAO_APLICADA` nos últimos 30 min | `crm_notify_renewal_ok` | `VISITA_RENOVACAO_OK` | `+30 min` |
| LOYALTY | checkout na última hora, 8ª/9ª/10ª visita do ciclo | `crm_notify_loyalty` | `VISITA_FIDELIDADE` | texto de `loyaltyMessage()` |

Variáveis comuns: {{1}} primeiro nome do responsável, {{2}} primeiro nome da criança. A Meta não aceita variável no começo nem no fim do corpo — termine o texto com uma frase fixa.

1. Aplicar `migrations/20260928180000_fa_crm_visit_notifications.sql` e `supabase functions deploy crm-visit-notify-dispatch`. Opcional: secret `PUBLIC_APP_URL` (padrão `https://app.institutofacaamigos.com.br`).
2. Cadastrar os templates aprovados (Utility para os três primeiros; fidelidade tende a ser classificada como Marketing):
```sql
insert into fa_crm_templates (name, content_sid, preview, variable_count, purpose) values
 ('Visita boas-vindas', 'HX...', 'Oi {{1}}! {{2}} já está brincando com a gente 💛 Acompanhe o tempo por aqui: {{3}} Qualquer coisa, é só chamar.', 3, 'VISITA_BOAS_VINDAS'),
 ('Visita fim do plano', 'HX...', 'Oi {{1}}! O tempo do plano de {{2}} terminou. Se quiser que ela(e) continue brincando, cada minuto adicional custa {{3}}. Fale com a nossa equipe no balcão. 💛', 3, 'VISITA_EXCEDENTE'),
 ('Visita renovação aplicada', 'HX...', 'Oi {{1}}! Tudo certo: acrescentamos {{3}} ao tempo de {{2}}. Boa diversão! 💛', 3, 'VISITA_RENOVACAO_OK');
```
3. Ligar o que quiser, por unidade:
```sql
insert into fa_kiosk_app_settings (unit_id, key, value) values ('<uuid da unidade>', 'crm_notify_welcome', '1');
```
Fidelidade: além de ligar `crm_notify_loyalty` e cadastrar o template `VISITA_FIDELIDADE`, o texto vem de `loyaltyMessage()` em `functions/crm-visit-notify-dispatch/index.ts` — enquanto ela devolver `null`, nada sai.

## Convite ao Mapeamento Comportamental (1 semana após a visita)
`crm-mapeamento-dispatch` roda de hora em hora (9h-20h de Belém) e convida o responsável, **uma única vez** (`fa_crm_mapeamento_invites.guardian_id` unique), a fazer o Mapeamento Comportamental gratuito do Instituto: o mesmo convite do banner da tela pública, agora no WhatsApp. Sai entre 7 e 9 dias depois do checkout; só quem deu aceite de contato no check-in recebe. Nasce desligado por unidade.

Variáveis: {{1}} primeiro nome do responsável · {{2}} primeiro nome da criança · {{3}} a "dor" por faixa etária (`painHook()` em `functions/crm-mapeamento-dispatch/index.ts`; enquanto devolver `null`, nada sai) · {{4}} link do teste (utm `whatsapp/crm/mapeamento/followup-7d`; secret opcional `MAPEAMENTO_URL`). A promessa do FaçaAmigos fica no texto fixo do template. A Meta não aceita variável no começo nem no fim do corpo: termine com uma frase fixa.

1. Aplicar `migrations/20260928200000_fa_crm_mapeamento_followup.sql` e `supabase functions deploy crm-mapeamento-dispatch`.
2. Cadastrar o template aprovado (categoria Marketing). Sugestão de corpo:
```sql
insert into fa_crm_templates (name, content_sid, preview, variable_count, purpose) values
 ('Convite Mapeamento 7d', 'HX...', 'Oi {{1}}! Faz uma semana que {{2}} brincou com a gente 💛 {{3}} O FaçaAmigos existe para que toda criança aprenda a fazer amigos, se expressar e crescer com segurança. E isso começa por entender como ela é. Por isso criamos o Mapeamento Comportamental: 5 minutos de perguntas e um direcionamento gratuito, feito por psicólogas. Faça aqui: {{4}} Se quiser conversar sobre o resultado, é só responder esta mensagem.', 4, 'MAPEAMENTO');
```
3. Ligar por unidade:
```sql
insert into fa_kiosk_app_settings (unit_id, key, value) values ('<uuid da unidade>', 'crm_mapeamento_followup', '1');
```
Quem respondeu PARAR continua fora (opt_in = false pula antes da trava). Recusa definitiva da Twilio marca o convite com `error` e não reenvia.

## Catálogo de upsell/cross-sell/LTV/retenção (10 ações, 1 dispatcher)
`crm-lifecycle-dispatch` roda a cada 15 min (pg_cron), só das 10h às 20h de Belém. Todas as automações abaixo compartilham a mesma tabela de envio (`fa_crm_automation_sends`) e a mesma trava de frequência (`fa_crm_can_send`: no máx. 1 marketing a cada 7 dias, 3 em 30 dias por contato — não vale para os kinds UTILITY).

**Pré-requisito que ainda falta, por produto/decisão de negócio**: os kinds MARKETING exigem `fa_kiosk_guardians.marketing_consent_at_ms` (campo novo, migration `20260929000000`), separado do aceite de avisos/pesquisa já existente. Nenhum fluxo do app preenche esse campo ainda — enquanto isso, os kinds MARKETING abaixo nunca encontram candidato. A RPC `fa_kiosk_set_marketing_consent(guardian_id, consent, employee_id)` existe e pode ser plugada num checkbox de check-in ou na campanha de opt-in quando o produto decidir como pedir esse aceite.

| Kind | Ação do catálogo | Categoria | Flag (`fa_kiosk_app_settings`) | Variáveis |
|---|---|---|---|---|
| `EXPIRACAO` | U2/R4 — recarga antes de acabar | Utility | `crm_lc_expiracao` | {{1}} responsável · {{2}} nome do saldo · {{3}} minutos restantes/validade |
| `RELATORIO_CUPOM` | C4 — cupom no relatório de sessão | Utility | `crm_lc_relatorio_cupom` | {{1}} responsável · {{2}} criança · {{3}} texto do cupom |
| `PREMIO_FIDELIDADE` | L2 — prêmio não resgatado | Utility | `crm_lc_premio_fidelidade` | {{1}} responsável · {{2}} criança |
| `NPS_PROMOTOR` | R2 — NPS ≥9 → avaliação Google | Utility | `crm_lc_nps_promotor` | {{1}} responsável · {{2}} link (secret `GOOGLE_REVIEW_URL`) |
| `NPS_DETRATOR` | R3 — NPS ≤6 → contato humano | Utility | `crm_lc_nps_detrator` | {{1}} responsável |
| `UPSELL_PACOTE` | U1 — pacote pós-visita | Marketing | `crm_lc_upsell_pacote` | {{1}} responsável · {{2}} criança |
| `CROSS_ATIVIDADE` | C1 — Playground ↔ Circuito | Marketing | `crm_lc_cross_atividade` | {{1}} responsável · {{2}} criança · {{3}} atividade convidada |
| `CROSS_IRMAO` | C2 — irmão que não vem | Marketing | `crm_lc_cross_irmao` | {{1}} responsável · {{2}} criança que frequenta |
| `ANIVERSARIO` | L3 — aniversário automático | Marketing | `crm_lc_aniversario` | {{1}} responsável · {{2}} criança |
| `VIP` | L4 — reconhecimento VIP | Marketing | `crm_lc_vip` | {{1}} responsável · {{2}} criança |
| `WINBACK` (`WINBACK_1`/`WINBACK_2`) | R1 — winback em 2 toques | Marketing | `crm_lc_winback_1` / `crm_lc_winback_2` | {{1}} responsável |

1. Aplicar `migrations/20260929000000_fa_crm_lifecycle_campaigns.sql` e `supabase functions deploy crm-lifecycle-dispatch`.
2. Cadastrar os templates aprovados (um por purpose da tabela acima):
```sql
insert into fa_crm_templates (name, content_sid, preview, variable_count, purpose) values
 ('Saldo acabando', 'HX...', 'Oi {{1}}! O saldo de {{2}} de {{3}}(a) {{4}}. Passa aqui pra garantir mais diversão! 💛', 3, 'EXPIRACAO');
 -- repetir para RELATORIO_CUPOM, PREMIO_FIDELIDADE, NPS_PROMOTOR, NPS_DETRATOR,
 -- UPSELL_PACOTE, CROSS_ATIVIDADE, CROSS_IRMAO, ANIVERSARIO, VIP, WINBACK
```
3. Ligar só o que quiser, por unidade:
```sql
insert into fa_kiosk_app_settings (unit_id, key, value) values ('<uuid da unidade>', 'crm_lc_expiracao', '1');
```
4. Para os kinds Marketing, decidir e implementar a coleta de `marketing_consent_at_ms` antes de ligar a flag — sem isso, `crm_lc_upsell_pacote` etc. nunca encontram candidato (estado seguro, mas também inútil).

Regra Meta de sempre: variável não pode abrir nem fechar o corpo do template.

## Régua de ofertas (produtos maiores, sem desconto)
Migration `20261001130000_fa_crm_offer_ladder.sql`. Substitui o UPSELL_PACOTE genérico por três degraus com produto e gatilho próprios e reescreve CROSS_ATIVIDADE, VIP e WINBACK. Todas as ofertas levam os botões **Quero saber mais** (`OFERTA_INFO`) e **Agora não** (`OFERTA_NAO`).

| Kind | Quem recebe | Produto |
|---|---|---|
| `DEGRAU_2H` | 1–18 h após sair de um plano de 30 min/1 h do Playground com excedente ou renovação | Plano de 2 horas |
| `DEGRAU_PORTO` | 3+ visitas ao Playground em 30 dias, sem pacote/crédito ativo | Porto Seguro |
| `DEGRAU_DAYUSE` | Às quintas, 2+ visitas ao Playground em 60 dias, sem pacote/crédito ativo | Day Use |
| `VIP` | 8+ visitas ao Playground em 60 dias, sem pacote/crédito ativo | Porto Seguro |
| `CROSS_ATIVIDADE` | 3+ visitas numa atividade e nenhuma na outra | Convite ao Circuito/Playground |
| `WINBACK_1/2` | Mesma regra de antes | Volta com o Olhar FaçaAmigos |

- **Uma oferta por família por rodada**, na ordem 2H > Porto > VIP > Day Use > Cross > Aniversário > Irmão > Winback (além da trava de 1 marketing a cada 7 dias).
- **"Quero saber mais"**: o webhook responde com o texto de `fa_crm_offer_info` (por kind, editável sem deploy: preços estão lá) e grava `replied_at_ms`/`reply_payload` em `fa_crm_automation_sends`.
- **"Agora não"**: tira aquele kind do responsável por 90 dias.
- A migration também corrige `fa_crm_can_send` (estouro de integer na versão aplicada em produção, que fazia o dispatcher pular **todos** os candidatos). **Depois de aplicar, os kinds com template ativo e flag ligada passam a enviar de verdade** (ex.: EXPIRACAO, NPS_PROMOTOR, NPS_DETRATOR).

Passos:
1. Aplicar a migration. Ela desliga `crm_lc_upsell_pacote`, `crm_lc_aniversario` e `crm_lc_cross_irmao`; cria `crm_lc_degrau_*` com o mesmo valor que `crm_lc_upsell_pacote` tinha em cada unidade; e desativa os templates v1 (`fa_lc_upsell_pacote`, `fa_lc_cross_atividade`, `fa_lc_vip`, `fa_lc_winback`).
2. `supabase functions deploy crm-lifecycle-dispatch crm-whatsapp-webhook crm-templates-bootstrap`.
3. Chamar `crm-templates-bootstrap` uma vez para criar e submeter os 6 templates novos (categoria Marketing). Chamar de novo depois da aprovação da Meta para ativá-los. Até lá, nenhuma oferta da régua sai: o dispatcher pula template cujo número de variáveis não bate com o do kind.
4. Revisar os textos de `fa_crm_offer_info` (preços) antes de a Meta aprovar.
