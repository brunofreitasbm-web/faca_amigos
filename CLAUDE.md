# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

FaçaAmigos is the operating system for an inclusive playground (Parque Shopping Belém): counter/kiosk operation (check-in, real-time panel, PDV/POS, cash register, NFC-e fiscal receipts, time clock) plus a management ("Gerencial") back office. See `ESPECIFICACOES_SISTEMA.md` for the full functional spec and `plano-negocio-facaamigos.md` for the business plan.

## Commands

Monorepo managed with **pnpm workspaces** + **Turborepo** (Node >=22, pnpm 11.20.0).

```bash
pnpm install
pnpm exec turbo run typecheck test lint   # whole repo, respects task dependency graph
pnpm build / pnpm dev / pnpm lint / pnpm test / pnpm typecheck   # same tasks via root scripts
```

Scope a task to one package (name from its `package.json`, e.g. `@facaamigos/domain`, `@facaamigos/kiosk`, `@facaamigos/kiosk-ui`):

```bash
pnpm --filter @facaamigos/domain test
pnpm --filter @facaamigos/kiosk-ui dev
```

Run a single test file (each package uses Vitest directly, no turbo needed):

```bash
pnpm --filter @facaamigos/kiosk exec vitest run test/api.spec.ts
```

Kiosk desktop app (Electron):

```bash
pnpm --filter @facaamigos/kiosk dev:server      # Fastify server only, tsx watch
pnpm --filter @facaamigos/kiosk start:electron  # bundle + launch Electron shell
pnpm dist:kiosk                                  # full Windows build (builds kiosk-ui, bundles, electron-builder)
```

Formatting: `pnpm format` / `pnpm format:check` (Prettier over the whole tree).

Icons: `pnpm icons` regenerates app icons from source assets (`scripts/generate-icons.mjs`).

## Architecture

```
apps/
  kiosk/          Electron main + local Fastify server (D2: single writer for the time clock)
  kiosk-ui/       React 19 SPA — the actual operator/admin UI, served to both Electron and LAN tablets
packages/
  contracts/      Zod DTOs — single source of truth for data shapes shared by kiosk-ui, apps/kiosk, and Supabase
  domain/         Pure business rules: pricing, loyalty, RBAC, time/session logic, printer formatting. No node:*, no fetch, no direct Date.now() — must stay testable without I/O.
  db-local/       SQLite persistence + migrations + repositories used by apps/kiosk's local server
  fiscal/         NFC-e engine: chave de acesso, XML (modelo 65), XMLDSig signing, QR code, DANFE. nfce/transport.ts is the only file that changes if the SEFAZ transport implementation changes.
  ui/             Design system (tokens + React components) shared by kiosk-ui
  config/         Shared ESLint/TypeScript/Vitest presets, imported by every package's own config
supabase/         Postgres migrations, RLS policies, PL/pgSQL RPCs, and Edge Functions (cloud backend)
```

### Where the UI actually gets its data

`apps/kiosk-ui` talks **directly to Supabase** (`src/lib/supabase/client.ts`) for almost everything — units, plans, check-in, the real-time panel, PDV, cash register, time clock. It is not gated behind the local server anymore for those flows.

Two flows still require `apps/kiosk` (the local Fastify server) or its `/api` proxy (`vite.config.ts` proxies `/api` and `/ws` to `127.0.0.1:7317` in dev):
- `RelatorioScreen` (sales/visits/birthdays/shifts/asset-usage/timecard reports)
- Creating/deactivating an employee in `ConfiguracoesScreen` (needs the Supabase Auth admin API with `service_role`, which can't run in the browser)

If `kiosk-ui` is deployed standalone (e.g. Vercel) without also migrating those two, only those specific screens won't work — everything else runs against Supabase alone.

### apps/kiosk internals

- `src/server/` — Fastify app: HTTP API, WebSocket tick channel, TLS for LAN tablets, business-date logic.
- `src/main/` — Electron main process: window/splash, raw thermal printing bridge, preload.
- `src/fiscal/` — local NFC-e contingency: cert vault, heartbeat, claim flow (wraps `packages/fiscal`).

### Data/version conventions

- `pnpm-workspace.yaml` pins shared dependency versions (`react`, `typescript`, `vitest`, `zod`, `eslint`) via the `catalog:` mechanism — packages reference `catalog:` instead of a version, so these never drift between `kiosk-ui`, `ui`, and the rest.
- `tsconfig.base.json` is strict (`strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `verbatimModuleSyntax`) — new packages should extend it via `@facaamigos/config`'s exported tsconfigs rather than loosening these.
- `.npmrc` forces `node-linker=hoisted` because electron-builder breaks on pnpm's default symlinked node_modules.

### Not part of the workspace

`LandingPage/` and `facaamigos-landing-publicar-v2/` are standalone static HTML/CSS/JS marketing sites (no build step, no `package.json`) — unrelated to the `apps/*`/`packages/*` pnpm workspace and deployed separately.

## Sales-oriented content (cross-sell / upsell)

Whenever creating, writing, or presenting anything customer- or operator-facing — screens, receipts, notifications, marketing copy, reports, presentations — always build in a cross-sell/upsell angle. Prefer suggestions the operator or customer clearly sees and can act on or ignore, surfaced at the moment they're relevant to the journey, never disguised as something else and never blocking the primary task:

- Check-in / PDV: suggest relevant add-ons (e.g. meia antiderrapante, bebida) alongside the main purchase.
- End of session / near time limit: offer a time or plan upgrade before checkout.
- Recurring visits (3rd+ visit, birthdays, etc.): highlight VIP packages, coupons, or loyalty rewards.
- Reports/dashboards for staff: surface upsell opportunities as data (e.g. "clientes elegíveis para upgrade hoje"), not as copy aimed at the child/guardian.

Do not implement dark patterns: no hidden/pre-checked upsells, no manipulating cognitive biases to obscure price or consent, no pressure tactics — this business serves children (including neurodivergent children) and their guardians, so offers must stay transparent and easy to decline. When a request implies something manipulative or deceptive, flag it and propose the transparent alternative instead of implementing it as asked.

## Project-specific working agreement (DEV_LEIGO)

Per `.agents/AGENTS.md` / `DEV_LEIGO.md`: the user driving this repo is non-technical. When given loose feedback or ideas ("quero isso", "notei aquilo"), the expected response is a structured technical brief (Contexto / Objetivo / Requisitos de UI-UX / Requisitos técnicos-funcionais / Critérios de aceite) — not a direct implementation — unless they explicitly ask to implement. Every generated brief ends with the note that implementation decisions are left to the dev/AI, since the user only judges the final UX/behavior. This applies to feature requests; it does not override explicit direct implementation requests.
