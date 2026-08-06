# FaçaAmigos

Sistema operacional do playground inclusivo FaçaAmigos (Parque Shopping Belém) — quiosque offline-first para o balcão (Módulo Loja/Playground e Módulo Quiosque/Circuito) e back-office em nuvem.

## Estrutura

```
packages/
  config/       presets compartilhados de ESLint, TypeScript, Vitest
  contracts/    DTOs (Zod) trocados entre kiosk, tablets e nuvem
  ui/           design system — tokens e componentes React
prototype/      protótipo HTML/CSS/JS clicável (Fase 0), sem backend
plano-negocio-facaamigos.md
```

## Protótipo

Abra `prototype/index.html` direto no navegador (ou `npx serve .` a partir da raiz e acesse `/prototype/`). Sem build, sem servidor — ver `prototype/README.md` para o que dá pra testar.

## Desenvolvimento

```
pnpm install
pnpm exec turbo run typecheck test lint
```
