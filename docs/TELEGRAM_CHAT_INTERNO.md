# Chat interno colaborador ↔ Owner (via Telegram)

O colaborador escreve pelo botão flutuante de chat no tablet do quiosque; o Owner
recebe no Telegram e responde ali mesmo, sem abrir o app. Tudo fica gravado em
`fa_kiosk_chat_messages` (append-only: ninguém edita nem apaga).

- Migration: `supabase/migrations/20261012150000_fa_kiosk_chat.sql`
- Edge Functions: `chat-telegram-notify` (aviso ao Owner) e `chat-telegram-webhook` (respostas)
- Front: `apps/kiosk-ui/src/components/ChatFab.tsx`, `ChatPanel.tsx`, `api/useChat.ts`
- **Bot próprio**, separado do bot do caixa (`owner-telegram-*`). Nada daquele fluxo foi alterado.

## Como funciona

1. Colaborador envia → trigger do banco chama `chat-telegram-notify` → o bot manda ao Owner
   "💬 Nome (Unidade) · tela X · vN: texto" com os botões **Recebi / Resolvido / Ligue para mim**.
   Foto/print vai antes, como imagem.
2. Owner responde de duas formas: toca num botão, ou usa **Responder** (deslizar) na mensagem
   do bot e digita. Mensagem solta (sem responder a uma mensagem do bot) recebe uma orientação.
3. Reação do bot na resposta do Owner: 👍 = gravada no sistema; 👀 = o colaborador já abriu o chat.
   (O Telegram só aceita um conjunto fixo de emojis de reação; ✅ não está nele.)
4. No tablet: botão flutuante na borda esquerda com selo piscante e contagem de respostas não
   lidas; a tela de PIN mostra "Há mensagens novas do Owner no chat" (sem nomes).
5. Mensagem que falhar no Telegram é reenviada por varredura a cada 2 min (até 24 h).

Status que o colaborador vê: *Enviando… → Enviada → Entregue ao Owner* (a mensagem chegou ao
Telegram dele). "Lido pelo Owner" não existe: o Telegram não informa isso.

## Ativação (uma vez)

1. No Telegram, falar com `@BotFather` → `/newbot` → guardar o token. Criar um bot **novo**.
2. Descobrir o id numérico do Owner no Telegram (ex.: falar com `@userinfobot`).
3. Abrir o bot novo e mandar `/start` (o bot só pode escrever depois disso).
4. Cadastrar os secrets nas **duas** Edge Functions novas:
   `CHAT_TELEGRAM_BOT_TOKEN` e `CHAT_TELEGRAM_OWNER_ID`.
5. Aplicar a migration e publicar `chat-telegram-notify` e `chat-telegram-webhook`
   (`verify_jwt = false`, já em `supabase/config.toml`).
6. Em até 2 min o cron `fa-chat-telegram-sweep` registra o webhook sozinho
   (`setWebhook` com `message` e `callback_query`). Para forçar, chame a função com `{}`.
7. Se houver mais de um usuário ADMIN ativo, defina quem assina as respostas:
   `insert into fa_chat_config values ('owner_employee_id', '<uuid do Owner>');`
   (com um único ADMIN ativo isso é automático).
8. Conferir as permissões em Gerencial > Permissões: `chat.usar` (todos os papéis operacionais)
   e `chat.admin` (só Owner; quem tem esta permissão não vê o botão no tablet).

Sem os secrets, `chat-telegram-notify` responde 500 e as mensagens ficam no banco; saem
sozinhas depois de configurar.

## Segurança

- Só o `from.id` igual a `CHAT_TELEGRAM_OWNER_ID` consegue responder; qualquer outro remetente
  é ignorado em silêncio. Use o bot em conversa direta, não em grupo.
- O webhook confere o header `X-Telegram-Bot-Api-Secret-Token` (derivado do token do bot).
- Colaborador só lê e escreve na própria conversa (RLS + RPC `fa_chat_send`); as funções que
  gravam como Owner (`fa_chat_owner_reply`, `fa_chat_insert_message`) só aceitam `service_role`.
- Anexos: bucket privado `fa-chat-attachments`, pasta = id da conversa, acesso por URL assinada.
- O Telegram passa a guardar uma cópia do conteúdo das conversas. Os colaboradores veem o aviso
  fixo "As conversas ficam gravadas no sistema" no topo do painel.

## Limites conhecidos

- Sem push para o colaborador: a resposta do Owner só aparece quando alguém logar no tablet
  (por isso o selo piscante e a dica na tela de PIN). Se virar problema, o próximo passo é push
  por colaborador.
- Foto do Owner pelo Telegram não é repassada (só texto e botões).
- Versão celular do login (`MobileLogin`) não mostra a dica de mensagens novas.
