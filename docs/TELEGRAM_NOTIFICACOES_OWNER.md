# Notificações do Owner via Telegram

Terceiro canal da fila `fa_kiosk_owner_notifications`, ao lado do push e do
e-mail (cada um com a sua marca: `sent_at_ms`, `emailed_at_ms`,
`telegram_sent_at_ms`). Ligar o Telegram não altera os outros canais.

- Migration: `supabase/migrations/20261010042613_fa_owner_telegram.sql`
- Edge Function: `supabase/functions/owner-telegram-dispatch` (cron a cada minuto)
- Tipos enviados: ABERTURA, FECHAMENTO, DIVERGENCIA_ABERTURA,
  DIVERGENCIA_FECHAMENTO, CANDIDATURA_TALENTOS, RESUMO_SEMANAL,
  OCORRENCIA_COLABORADOR, AVALIACAO_NEGATIVA. ACOMPANHAMENTO_17H/20H ficam fora.

## Configuração (uma vez)

1. No Telegram, falar com `@BotFather` → `/newbot` → guardar o token.
2. Criar um grupo **privado** do Owner e adicionar o bot.
3. Mandar uma mensagem no grupo e abrir
   `https://api.telegram.org/bot<TOKEN>/getUpdates` para ler `chat.id`
   (grupos têm id negativo, ex. `-1001234567890`).
4. Cadastrar os secrets da Edge Function `owner-telegram-dispatch`:
   `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID`.
5. Aplicar a migration e fazer o deploy da function.

Sem os secrets a function responde 500 a cada minuto e nada é enviado — as
notificações ficam na fila (o claim só acontece depois da checagem dos secrets).

## Comportamento

- Falha transitória (rede, 429, 5xx): a notificação volta à fila e é tentada
  no minuto seguinte.
- Falha permanente (outro 4xx, ex. chat inválido): registrada em log e **não**
  reenviada.
- A foto do envelope (FECHAMENTO) vai como mensagem separada logo após o texto.

## Privacidade

Valores de caixa e foto do envelope passam a existir no Telegram. Mantenha o
grupo privado e revise os membros.

## E-mail desligado

O cron `fa-owner-email-dispatch` foi desligado (migration
`20261010130000_fa_owner_email_dispatch_off.sql`); o Owner recebe pelo
Telegram e pelo push. Para religar o e-mail, reagende o cron como em
`20260829000004_fa_owner_email_dispatch_timeout.sql` — e antes marque o
acúmulo como enviado (`emailed_at_ms`), senão a primeira rodada manda tudo
de uma vez.

## Grupo promovido a supergrupo

Se o Telegram responder `group chat was upgraded to a supergroup chat`, o
`chat_id` mudou. A resposta do cron (`net._http_response`) traz
`novo TELEGRAM_CHAT_ID: -100...`; atualize o secret. As notificações ficam
na fila e saem na rodada seguinte.

## Telegram v2 (resumos, botões, limiar)

Aplicado direto na produção em 2026-10-10 (por brunofreitasbm@gmail.com) e
exportado para cá sem alterações em `20261010045759` a `20261010045919`
(`owner_telegram_v2_*`) e `supabase/functions/owner-telegram-webhook`.

- **Limiar de divergência:** `fa_owner_telegram_config` (`divergence_threshold`,
  hoje R$ 20,00). Divergência abaixo do limiar não vira alerta avulso no
  Telegram (continua no corpo do fechamento e no resumo do dia).
  `fa_owner_telegram_claim_due` foi reescrita para isso e hoje envia: abertura,
  fechamento, divergências (acima do limiar), candidatura, ocorrência,
  avaliação negativa, `RESUMO_DIARIO` e `RESUMO_SEMANAL_CONSOLIDADO`. O
  `RESUMO_SEMANAL` antigo não é mais enviado ao Telegram.
- **Resumos:** `RESUMO_DIARIO` (todo dia 23:30, Belém) e
  `RESUMO_SEMANAL_CONSOLIDADO` (segunda 07:00), por cron a cada 5 min
  (`fa-owner-report-diario`, `fa-owner-report-semanal-consolidado`).
- **Botões:** `fa_owner_divergence_status` guarda Conferido / Pedir
  justificativa / Pendência por divergência; o clique chega em
  `owner-telegram-webhook`.
- **Pendente de alinhamento:** a `owner-telegram-dispatch` deployada (esta, v6)
  **não** registra o webhook nem manda os botões; o comentário do webhook diz
  que isso é feito pelo dispatch. Se uma versão nova do dispatch for deployada
  por outra sessão, ela substitui `format.ts` e o formato das mensagens.
- **Regra de sobra:** `20261010052328_fa_sobra_caixa_nao_e_divergencia.sql`
  (aplicada depois das v2) faz só a falta virar divergência, e `amount_cents`
  passa a medir só falta.
