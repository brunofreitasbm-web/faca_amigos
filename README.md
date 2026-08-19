# FaçaAmigos

Sistema operacional do **FaçaAmigos**, playground inclusivo no Parque Shopping (Belém/PA). Cobre PDV e controle de caixa, check-in/check-out de crianças, ponto eletrônico de colaboradores, emissão fiscal (NFC-e/NFS-e) e um back-office gerencial — tudo rodando sobre um quiosque offline-first no balcão e Supabase na nuvem.

Ver [`ESPECIFICACOES_SISTEMA.md`](ESPECIFICACOES_SISTEMA.md) para a especificação funcional completa (módulos, regras de negócio, fluxos).

## Arquitetura

Monorepo pnpm + Turborepo, uma única SPA React reaproveitada entre quiosque e tablets da loja, com Supabase como back-office/nuvem.

```
apps/
  kiosk/        Electron main + servidor Fastify local — única gravadora do ponto,
                serve a SPA para o Electron e para os tablets na mesma rede local
  kiosk-ui/     SPA React 19 (Vite) — UI do balcão/PDV e do módulo gerencial,
                servida pelo apps/kiosk

packages/
  ui/           Design system — tokens CSS e componentes React
  domain/       Regras de negócio puras (tempo, preço, fidelidade, RBAC) — sem
                node:*, sem fetch, sem Date.now() direto
  contracts/    DTOs (Zod) trocados entre kiosk, tablets, back-office e Supabase
  db-local/     SQLite local (só o PC servidor escreve) — conexão, migrations e
                repositórios das tabelas operacionais
  fiscal/       Emissão de NFC-e (chave de acesso, XML modelo 65, QR Code, DANFE,
                XMLDSig) e NFS-e Nacional — lógica testável offline
  config/       Presets compartilhados de ESLint, TypeScript, Vitest, Prettier

supabase/
  functions/    Edge Functions (Deno) — login por PIN, onboarding, convites,
                fiscal (NFS-e), webhooks (avaliações Google, vagas), etc.
  migrations/   Schema, RLS e RPCs em SQL (120+ migrations)

prototype/      Protótipo HTML/CSS/JS clicável (Fase 0), sem backend — ver
                prototype/README.md
scripts/        Build/release do instalador do kiosk, geração de ícones,
                importação de dados legados
```

### Stack

- **UI:** React 19 + TypeScript + Vite, design system próprio (`@facaamigos/ui`)
- **Quiosque:** Electron (app instalável, auto-update) + servidor Fastify local, também acessível via PWA pelos tablets da LAN
- **Nuvem:** Supabase (Postgres + RLS em todas as tabelas, Auth, Edge Functions em Deno)
- **Autenticação:** PIN local de 6 dígitos + RBAC por capacidades (papéis no banco: Operador/Gerente/Admin)
- **Fiscal:** motor próprio de NFC-e (SEFAZ/PA) e NFS-e Nacional (DPS/XML)
- **Impressão:** ESC/POS para cupons de check-in, pulseiras e comprovantes de ponto

## Desenvolvimento

```bash
pnpm install
pnpm exec turbo run typecheck test lint
```

Scripts úteis (raiz do monorepo):

```bash
pnpm dev              # turbo run dev em todos os workspaces
pnpm build            # turbo run build
pnpm dist:kiosk       # builda o instalador Electron do kiosk (kiosk + kiosk-ui + ícones)
pnpm release:kiosk    # publica nova versão do instalador no feed do auto-updater
pnpm release:all      # release completo (kiosk + demais serviços)
```

## Protótipo

Abra `prototype/index.html` direto no navegador (ou `npx serve .` a partir da raiz e acesse `/prototype/`). Sem build, sem servidor — ver [`prototype/README.md`](prototype/README.md) para o que dá pra testar. Este protótipo é a Fase 0 do produto e não reflete necessariamente o estado atual da SPA em `apps/kiosk-ui`.
