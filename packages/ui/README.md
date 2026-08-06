# @facaamigos/ui

Design system da FaçaAmigos, portado de
[`Branding/fa-aamigos-design-system/`](../../Branding/fa-aamigos-design-system/)
para uso em produção (`apps/kiosk-ui` e `apps/backoffice`). Este pacote é a
fonte de verdade para tokens e componentes — a pasta `Branding/` continua
existindo só como referência de marca (README, guidelines, protótipo
original), não é mais importada por código.

## O que mudou na adaptação (e por quê)

O design system original foi extraído de um **app mobile dark**
(`--color-bg-app: #141414`) e de posts de marketing full-bleed. As telas
operacionais do quiosque (check-in, dashboards, PDV, caixa) usam **light
mode** — decisão do usuário, por prioridade de operação sob luz de
shopping. Três ajustes concretos, nenhum cosmético:

1. **Superfícies e texto light** (`tokens/colors.css`, bloco final) —
   `--surface-page`, `--surface-card`, `--text-primary` etc., construídos
   em cima da escala de neutros que já existia, sem inventar cor nova.

2. **Contraste do rosa primário.** `#F0196B` sobre branco mede **4.15:1**
   — passa WCAG AA-large (botão pill, ícone ≥24px, texto ≥18px) mas fica
   abaixo do limiar AA para texto normal (4.5:1). Regra aplicada em todo
   componente: `--color-primary` só em elemento grande; texto pequeno e
   link usam `--color-primary-hover` (`#C8155A`, 5.66:1). Ver `Button.tsx`
   e `Badge.tsx`.

3. **Semáforo operacional é paleta própria** (`tokens/status.css`), não
   reaproveitamento dos tokens de marca. Duas razões: `--color-warning` e
   `--color-error` são a mesma cor na paleta original, e o modelo de
   domínio tem **4 fases** (`VERDE | AMARELO | VERMELHO | EXCEDENTE`), não
   3 — a nota original do plano de arquitetura falava em "trio", mas o
   tipo real em `packages/domain` (seção 6 do plano) tem quatro estados, e
   VERMELHO (prazo estourando) e EXCEDENTE (já em cobrança de excedente)
   precisam ser visualmente distintos. Todos os 8 pares texto/fundo do
   semáforo foram verificados a ≥4.5:1 (WCAG AA) e têm teste de regressão
   em `test/status.spec.ts` — ver o comentário no topo do arquivo sobre
   por que "são cores diferentes" não é a mesma coisa que "têm contraste
   alto entre si" (contraste é luminância relativa, não matiz).

Mantido sem alteração: Fredoka One em display, Nunito em corpo/UI, cantos
sempre arredondados (pill em botão, 24px em card), transições
150–250ms, tom pt-BR casual ("você").

## Estrutura

```
src/
  tokens/
    fonts.css        ← import do Google Fonts (inalterado da fonte)
    colors.css        ← paleta de marca + superfícies/texto light (novo)
    status.css         ← semáforo operacional (novo, não existia na fonte)
    typography.css    ← inalterado
    spacing.css       ← inalterado
    effects.css       ← inalterado (radii, sombras, gradiente do anel)
    contrast.ts       ← cálculo de contraste WCAG, usado pelo teste de status
  components/
    Button.tsx        ← portado de Button.jsx, tipado
    Card.tsx           ← portado de Card.jsx, padrão trocado para light
    Badge.tsx          ← portado de Badge.jsx, variante `neutral` reescrita p/ light
    StatusBadge.tsx    ← NOVO — não existe na fonte. Ver abaixo.
    Tag.tsx             ← portado de Tag.jsx, reescrito para light (fonte era dark-only)
    Input.tsx          ← portado de Input.jsx, padrão trocado para `variant="light"`
  styles.css          ← ponto de entrada único (@import de tudo + reset mínimo)
  index.ts            ← barrel export
```

**Não portados nesta fase:** `Avatar` e `CircleButton` — são específicos do
app mobile de marca (navegação por círculo com anel gradiente,
`~88–96px`), sem uso identificado nas telas operacionais do quiosque
mapeadas no plano. Portar quando (e se) surgir uma tela real que precise.

## `StatusBadge` — por que é um componente novo

O plano de arquitetura exige, para o painel de acompanhamento: *"nunca
codificar estado só por cor — cada card leva ícone + rótulo textual"*.
Isso não é seguro como convenção de uso de um `Badge` genérico — é fácil
esquecer. `StatusBadge` torna a violação impossível: recebe `phase` e
sempre renderiza glifo + rótulo pt-BR juntos, nunca cor sozinha.

```tsx
import { StatusBadge } from "@facaamigos/ui";

<StatusBadge phase="AMARELO" detail="04:02" />
// ● renderiza: ◆ acabando 04:02
```

## Uso

```tsx
import "@facaamigos/ui/styles.css"; // uma vez, no entrypoint do app
import { Button, Card, StatusBadge } from "@facaamigos/ui";
```

## Verificação

```
pnpm --filter @facaamigos/ui typecheck
pnpm --filter @facaamigos/ui test        # inclui a suíte de contraste WCAG
pnpm --filter @facaamigos/ui lint
```
