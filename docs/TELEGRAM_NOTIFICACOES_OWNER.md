# Notificações do Owner via Telegram

Terceiro canal da fila `fa_kiosk_owner_notifications`, ao lado do push e do
e-mail (cada um com a sua marca: `sent_at_ms`, `emailed_at_ms`,
`telegram_sent_at_ms`). Ligar o Telegram não altera os outros canais.

- Migration: `supabase/migrations/20261010120000_fa_owner_telegram.sql`
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

## Desligar o e-mail depois

Quando o Telegram estiver validado: `select cron.unschedule('fa-owner-email-dispatch');`
(reversível reaplicando `20260829000004_fa_owner_email_dispatch_timeout.sql`).
