# Chat interno colaborador ↔ Owner (via Telegram)

O colaborador escreve pelo botão flutuante de chat no tablet do quiosque; os admins (Bruno e
Isabella) recebem num grupo do Telegram e respondem ali mesmo, sem abrir o app. Tudo fica gravado em
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
3. Reação do bot na resposta do admin: 👍 = gravada no sistema; 👀 = o colaborador já abriu o chat.
   (O Telegram só aceita um conjunto fixo de emojis de reação; ✅ não está nele.)
4. No tablet: botão flutuante na borda esquerda com selo piscante e contagem de respostas não
   lidas; a tela de PIN mostra "Há mensagens novas do Owner no chat" (sem nomes).
5. Mensagem que falhar no Telegram é reenviada por varredura a cada 2 min (até 24 h).

Status que o colaborador vê: *Enviando… → Enviada → Entregue aos donos* (a mensagem chegou ao
Telegram dele). "Lido pelo Owner" não existe: o Telegram não informa isso.

## Ativação (uma vez)

Os admins do chat são **Bruno e Isabella**, num **grupo privado do Telegram** com o bot. Todos veem
as mensagens e as respostas um do outro, e o botão tocado por um vira "Bruno: Recebi · 14:32" para os dois.

1. No Telegram, falar com `@BotFather` → `/newbot` (ou `/revoke` no bot existente para trocar um token
   que vazou) → guardar o token. Em `/setprivacy` deixe **Enable** (o padrão): respostas e botões
   chegam ao bot sem ele ler o grupo todo.
2. Criar um grupo **privado** só com Bruno e Isabella e adicionar o bot.
3. Cada admin manda `/id` **em conversa direta com o bot** e anota o número (ex.: `6728797176`).
4. Descobrir o id do grupo (negativo, ex.: `-1001234567890`): depois do webhook ativo, mande `/id` no
   grupo, ou use o erro `migrate_to_chat_id` do Telegram se ele virar supergrupo.
5. Secrets das **duas** Edge Functions novas: `CHAT_TELEGRAM_BOT_TOKEN` e `CHAT_TELEGRAM_CHAT_ID`
   (o id do grupo; para conversa direta de um admin só, use o id dele).
6. Aplicar a migration e publicar `chat-telegram-notify` e `chat-telegram-webhook` (`verify_jwt = false`).
7. Cadastrar os admins (quem lê todas as conversas e responde):
   ```sql
   insert into fa_chat_admins (employee_id, tg_user_id) values
     ('<uuid Bruno>', <tg id Bruno>), ('<uuid Isabella>', <tg id Isabella>)
   on conflict (employee_id) do update set tg_user_id = excluded.tg_user_id;
   ```
   Sem `tg_user_id` o admin lê tudo no app, mas ainda não consegue responder pelo Telegram.
8. Em até 2 min o cron `fa-chat-telegram-sweep` registra o webhook sozinho (`setWebhook` com `message` e
   `callback_query`). Para forçar, chame `chat-telegram-notify` com `{}`.

Sem os secrets, `chat-telegram-notify` responde 500 e as mensagens ficam no banco; saem sozinhas
depois de configurar.

## Um grupo por unidade

Cada unidade pode ter o seu próprio grupo do Telegram (Bruno, Isabella e o bot). A mensagem de um funcionário
vai para o grupo da **unidade em que ele está logado**; o grupo padrão (secret `CHAT_TELEGRAM_CHAT_ID`) recebe as
mensagens de quem não tem unidade (ex.: um admin sem unidade escolhida) e de unidades sem grupo cadastrado.

Para ligar uma unidade ao seu grupo:
1. Crie o grupo, adicione o `@ZoeFA_bot` e mande `/id@ZoeFA_bot` nele. O bot responde "Id deste chat: -100…".
2. Cadastre:
   ```sql
   insert into fa_chat_unit_groups (unit_id, tg_chat_id) values ('<uuid da unidade>', -100...)
   on conflict (unit_id) do update set tg_chat_id = excluded.tg_chat_id;
   ```
   (`select id, name from fa_kiosk_units;` lista as unidades.) O bot passa a aceitar respostas desse grupo na hora.

## Respondendo com texto livre

Sob cada mensagem há o botão **✍️ Responder por texto**. Ao tocar, o bot abre uma caixa "Bruno, digite abaixo a
resposta para Maria (unidade) e envie"; o que você digitar ali vai para a Maria. Deslizar a mensagem do funcionário
(Responder) continua funcionando. Texto solto no grupo, sem uma dessas duas formas, é ignorado de propósito: os
admins também conversam entre si ali.

## Segurança

- Só responde quem estiver em `fa_chat_admins.tg_user_id`, **e** só dentro de um chat autorizado (grupo padrão ou grupo de unidade). Estar no
  grupo não basta: se alguém não-admin entrar, pode ler, mas as respostas e os botões dele são ignorados.
  Mantenha o grupo só com os admins, porque o grupo mostra o conteúdo das conversas.
- `/id` responde a qualquer pessoa o **próprio** id; não concede acesso.
- O webhook confere o header `X-Telegram-Bot-Api-Secret-Token` (derivado do token do bot).
- Quem lê todas as conversas é a lista `fa_chat_admins`, não o papel ADMIN: um ADMIN fora da lista
  (ex.: Guimelly) não lê nem escreve nas conversas dos colaboradores.
- Colaborador só lê e escreve na própria conversa (RLS + RPC `fa_chat_send`); as funções que gravam
  como Owner (`fa_chat_owner_reply`, `fa_chat_insert_message`) só aceitam `service_role`.
- Anexos: bucket privado `fa-chat-attachments`, pasta = id da conversa, acesso por URL assinada.
- O Telegram passa a guardar uma cópia do conteúdo das conversas. Os colaboradores veem o aviso
  fixo "As conversas ficam gravadas no sistema" no topo do painel.

## Admins também usam o botão

O botão de chat aparece para todos com a permissão `chat.usar`, inclusive Bruno e Isabella. Quando um
admin escreve por ele, é a conversa do próprio admin: chega ao grupo do Telegram com o nome dele,
como a de qualquer colaborador, e qualquer admin pode responder ali.

## Limites conhecidos

- Sem push para o colaborador: a resposta do Owner só aparece quando alguém logar no tablet
  (por isso o selo piscante e a dica na tela de PIN). Se virar problema, o próximo passo é push
  por colaborador.
- Foto do Owner pelo Telegram não é repassada (só texto e botões).
- O colaborador vê "Owner" em qualquer resposta; quem respondeu (Bruno ou Isabella) fica gravado no banco
  (`sender_employee_id`) e no botão do Telegram, mas não aparece no painel do tablet.
- Versão celular do login (`MobileLogin`) não mostra a dica de mensagens novas.
