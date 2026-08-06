# @facaamigos/kiosk-ui

SPA React que fala diretamente com o Supabase (unidades, planos, check-in,
painel em tempo real, PDV, caixa, ponto) — não depende mais de um servidor
local para funcionar em outro dispositivo que não seja o totem físico.

## Rodando localmente

```bash
cp .env.example .env.local
pnpm --filter @facaamigos/kiosk-ui dev
```

## O que ainda depende do servidor local (`apps/kiosk`)

Nem tudo foi migrado para o Supabase ainda — os fluxos abaixo continuam
batendo em `/api/...` via o proxy do Vite (`vite.config.ts`) e só
funcionam com `apps/kiosk` rodando local:

- `RelatorioScreen` (relatórios de vendas, visitas, aniversariantes, turnos, uso de ativos, folha de ponto)
- Criar/desativar funcionário em `ConfiguracoesScreen` (exige a API admin do Supabase Auth com `service_role`, que não pode rodar no navegador)

Se publicar este app sozinho na Vercel sem migrar esses dois pontos, essas
telas especificamente não vão funcionar — o resto (entrada, painel,
check-in/checkout, PDV, caixa, ponto) já funciona 100% contra o Supabase.

## Deploy no Vercel

1. Import o repositório no Vercel.
2. Root Directory: `apps/kiosk-ui`.
3. Framework preset: Vite (detectado automaticamente).
4. Environment Variables: copie os valores de `.env.example`
   (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`).
5. Deploy.
