# @facaamigos/backoffice

Back-office web (Fase 2 do plano) — administração em nuvem de unidades, planos, produtos e
funcionários. Next.js (App Router) + Supabase, feito para deploy no Vercel.

O quiosque (`apps/kiosk` + `apps/kiosk-ui`) continua offline-first e não depende deste app; este
back-office é uma superfície de gestão separada, hoje sem sincronização automática com o SQLite
local do quiosque.

## Banco de dados

Usa o projeto Supabase existente `ivjvpdzsfjdpyabbzzuj` (compartilhado com outro app da mesma
organização). Todas as tabelas deste app usam o prefixo `fa_kiosk_` para não colidir com as
tabelas do outro sistema. RLS habilitada em todas — apenas usuários autenticados (Supabase Auth)
leem/escrevem.

Para dar acesso a alguém: crie o usuário em Authentication → Users no painel do Supabase (ou via
`supabase.auth.admin.createUser`). Não há cadastro público nesta versão.

## Rodando localmente

```bash
cp .env.example .env.local
pnpm --filter @facaamigos/backoffice dev
```

## Deploy no Vercel

1. Import o repositório no Vercel.
2. Root Directory: `apps/backoffice`.
3. Framework preset: Next.js (detectado automaticamente).
4. Environment Variables: copie os valores de `.env.example`
   (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`).
5. Deploy.
