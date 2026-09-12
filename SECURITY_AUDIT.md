# Auditoria de Segurança — FaçaAmigos

**Escopo:** monorepo pnpm/Turborepo (`apps/kiosk` Electron+Fastify, `apps/kiosk-ui` SPA React+Vite, `packages/*`, `supabase/functions` Edge Functions Deno, `supabase/migrations` Postgres/RLS).
**Método:** leitura de código-fonte real, `git log`, `pnpm audit`. Sem execução de pentest dinâmico contra ambiente vivo.
**Data:** 2026-09-11. **Branch:** `claude/appsec-audit-checklist-t7znge`.

---

## Sumário Executivo

- **Segredo real vazado no histórico do git**: `APi Banco de talentos.txt` (raiz do repo, commit `01fa201`) contém em texto puro uma API key de produção (`e1cb947a...`) para a integração do banco de talentos. **Rotação imediata obrigatória** — o segredo está comprometido só de estar no repositório, independente de quem tem acesso a ele hoje.
- **Bypass de autenticação por fail-open** em `supabase/functions/export-job-applications/index.ts:9-14`: se a env var `TALENT_API_KEY`/`WEBHOOK_SECRET` não estiver configurada no projeto, a function **libera acesso sem checar nada**, expondo PII de candidatos (nome, e-mail, telefone) e URLs assinadas de currículo.
- **Backdoor de exfiltração de API keys** em `apps/kiosk-ui/api/secret/[id].ts:18-38`: qualquer ID contendo a substring `"018bcfe5"` — sem autenticação nenhuma — devolve chaves reais lidas de `process.env.PLAYGROUND_SHOPPING_API_KEY`/`CIRCUITO_SHOPPING_API_KEY` quando essas variáveis existem em produção.
- **IDOR em ponto eletrônico**: `POST /api/ponto` (`apps/kiosk/src/server/routes/ponto.ts:8-14`) aceita `employeeId` arbitrário no corpo sem exigir prova de identidade (PIN/sessão) — qualquer dispositivo na rede do balcão pode bater ponto em nome de qualquer colaborador, com implicação trabalhista direta (Portaria MTP 671/2021).
- **Upload público sem validação server-side** em bucket de fotos de criança (dado sensível/LGPD): policy `fa_kiosk_crianca_fotos_write_anon_temp` (`supabase/migrations/20260807000009_fa_kiosk_child_photos.sql:21-23`) permite `INSERT` ao papel `anon` sem checagem de mime-type/tamanho, e nunca foi revogada (ao contrário de policies irmãs corrigidas em `20260810000003_fa_security_audit_fixes.sql`).
- **Dependências de produção com CVEs Alta/Crítica**: `@xmldom/xmldom@0.8.10` (usado para montar XML fiscal de NFC-e em `packages/fiscal`) tem múltiplas CVEs de injeção/ReDoS; `electron@37.10.3` (runtime do quiosque) tem CVEs de sandbox/context-isolation bypass.

Pontos fortes que vale registrar (não são elogio gratuito, são evidência que reduz o escopo do problema): RLS extensivo e `fa_kiosk_can()` como fonte única de autorização (front e back), PIN com bcrypt + rate limiting progressivo por `employee_id`, CORS por allowlist nas Edge Functions, ausência de SQL concatenado, validação de schema com Zod nas rotas Fastify e nas Edge Functions críticas.

---

## 1. `.env` ou segredos rastreados no git

**[CONFORME]** para arquivos `.env` — **[VULNERÁVEL]** para outro artefato de segredo no repo.

- `git log --all --full-history -- .env .env.local .env.production` não retornou nenhum commit.
- `.gitignore:38-41` e `:117-122` ignoram `.env`, `.env.*`, com exceção explícita de `.env.example`.
- `git ls-files | grep -i "\.env"` só lista `apps/kiosk/.env.example` (template, sem valor real).

Porém, **`APi Banco de talentos.txt` (raiz do repo) está rastreado e contém um segredo real em texto puro**:

```
$ git log -1 --format="%H %ad" -- "APi Banco de talentos.txt"
01fa201e357c077337b4e36df0a764d91ce20672  Thu Sep 10 16:38:30 2026 -0300
```
Conteúdo do arquivo (linha 3, valor real redigido deste relatório — ver o arquivo no repositório para o valor completo):
```
e1cb947a4521...ec54f71f4  (chave hexadecimal de 64 caracteres)
```

- **Localização:** `APi Banco de talentos.txt:3`, commit `01fa201` ("chore: add secret API key for talent bank integration").
- **Impacto:** qualquer pessoa com acesso de leitura ao repositório (ou a um fork/clone histórico) tem a chave em mãos. Se essa chave for a mesma configurada como `TALENT_API_KEY`/`WEBHOOK_SECRET` para `export-job-applications` (ver item 15 e o `.env` correspondente), o portador consegue chamar a API de exportação de candidaturas — nome, CPF/telefone, e-mail e URL assinada do currículo de cada candidato.
- **Severidade:** Crítica.
- **Correção:**
  - Antes: arquivo commitado com o segredo em texto puro na raiz do repositório.
  - Depois:
    1. Remover o arquivo do histórico (`git filter-repo --path "APi Banco de talentos.txt" --invert-paths` ou BFG), forçar push e revogar/rotacionar a chave imediatamente no provedor (ela já deve ser considerada comprometida).
    2. Adicionar ao `.gitignore`: `*.txt` sensíveis específicos, ou melhor, mover qualquer segredo para `.env`/gerenciador de segredos e nunca versionar `.txt` de credencial.
    3. Rodar `git secrets`/`gitleaks` como pre-commit hook para pegar isso antes do próximo commit.

## 2. Chaves/API keys embutidas no bundle front-end

**[CONFORME]** para as chaves que estão de fato lá — **[INSUFICIENTE]** pela ausência de um controle que impeça a próxima chave sensível de entrar no bundle por engano.

- `apps/kiosk-ui/src/lib/supabase/client.ts:8-9` embute como fallback a **anon/publishable key** do Supabase (`sb_publishable_...`) e a URL do projeto. Isso é o uso pretendido dessas chaves (protegidas por RLS no backend), não uma vulnerabilidade por si só.
- Nenhuma `service_role`/`sb_secret_` foi encontrada em `apps/kiosk-ui/src` ou `apps/kiosk-ui/public` (`grep -rn "SERVICE_ROLE\|sb_secret_"` sem resultado).
- Risco residual: `apps/kiosk-ui/api/secret/[id].ts` (Vercel Function, roda no servidor, não no bundle do cliente) lê `process.env.PLAYGROUND_SHOPPING_API_KEY`/`CIRCUITO_SHOPPING_API_KEY` — não é "no bundle", mas é exposta via HTTP sem auth (ver item 10, mesmo achado).
- **Correção preventiva:** adicionar `gitleaks`/`trufflehog` ao CI apontando para `apps/kiosk-ui/dist` no build, para pegar qualquer chave secreta que acabe entrando no bundle por engano no futuro.

## 3. Senhas de usuário em texto puro ou hash fraco

**[CONFORME]**

- Não existe senha de usuário tradicional no sistema — a própria arquitetura documentada usa **somente PIN de colaborador**, nunca e-mail/senha visível (`supabase/functions/login-pin/index.ts:1-11`).
- O PIN é hasheado com **bcrypt** (custo 10) antes de ir para `fa_kiosk_local_credentials`:
  - Criação: `supabase/functions/admin-create-employee/index.ts:127` — `bcrypt.hashSync(body.pin, 10)`.
  - Redefinição: `supabase/functions/admin-set-employee-pin/index.ts:46` — mesma chamada.
  - Verificação: `supabase/functions/login-pin/index.ts:127` — `bcrypt.compareSync(body.pin, credentials.pin_hash)`.
- A senha interna gerada para a conta sintética do GoTrue (`admin-create-employee/index.ts:43-46`, `randomInternalPassword()`) usa `crypto.getRandomValues` de 24 bytes — não é usada para autenticar ninguém (só satisfaz o requisito do GoTrue), e nunca é devolvida ao cliente.

## 4. Tokens JWT/sessão em localStorage vs cookies HttpOnly/Secure/SameSite

**[VULNERÁVEL]**

- **Localização:** `apps/kiosk-ui/src/lib/supabase/client.ts:12-18` — `createSupabaseClient(url, key)` sem `auth.storage` customizado.
- O SDK `@supabase/supabase-js` usa por padrão `localStorage` do navegador para persistir `access_token`/`refresh_token` quando nenhum storage alternativo é passado. Isso vale tanto para a sessão real do colaborador (obtida via `verifyOtp` após `login-pin`) quanto para a sessão anônima.
- **Impacto:** qualquer XSS na SPA (ver item 13 — há `dangerouslySetInnerHTML` no código, ainda que hoje alimentado por um valor gerado internamente) permite ler `localStorage` e exfiltrar o token de sessão, assumindo a identidade do colaborador logado (inclusive Owner/Admin) sem precisar do PIN.
- **Severidade:** Média (mitigada parcialmente por não haver XSS explorável identificado nesta auditoria estática, mas o vetor de armazenamento em si é frágil).
- **Correção:**
  - Antes:
    ```ts
    client = createSupabaseClient<any, any, any>(url, key);
    ```
  - Depois — usar cookies HttpOnly via `@supabase/ssr` (fluxo de cookie compartilhado entre o Fastify local e a SPA) **ou**, mantendo o SDK client-side, ao menos isolar a sessão em um storage não acessível a scripts de terceiro (não elimina XSS, mas reduz superfície):
    ```ts
    client = createSupabaseClient<any, any, any>(url, key, {
      auth: {
        storage: secureSessionStorageAdapter, // wrapper que grava em IndexedDB isolado + expira agressivamente
        persistSession: true,
        autoRefreshToken: true,
      },
    });
    ```
    A correção estrutural real é mover a emissão/posse do token para o servidor Fastify local (`apps/kiosk/src/server`), setando um cookie `HttpOnly; Secure; SameSite=Strict` e fazendo a SPA depender só desse cookie — dado que o quiosque já serve a SPA e as APIs do mesmo processo, isso é viável sem reescrever a arquitetura.

## 5. Ausência de verificação de e-mail antes de permissões críticas

**[INSUFICIENTE/AUSENTE] — não aplicável ao modelo de autenticação, mas com lacuna real**

- Não existe fluxo de verificação de e-mail porque não existe login por e-mail: colaboradores autenticam só por PIN, com e-mail sintético nunca exposto (`admin-create-employee/index.ts:89`, `login-pin/index.ts:1-11`).
- A lacuna real está em `general-onboarding-complete`/`onboarding-complete` (convites) e em `job-application-webhook`, onde o **e-mail informado pelo usuário nunca é confirmado** antes de ser persistido e usado como identificador de contato/notificação:
  - `supabase/functions/job-application-webhook/index.ts:20,56` — `email` vem direto do formulário, sem verificação, e é gravado em `fa_kiosk_job_applications`.
- **Impacto:** baixo isoladamente (não concede permissão), mas permite spoofing de identidade em notificações e possível abuso de formulário para spam de terceiros (envio de e-mails de confirmação para endereços não controlados pelo remetente).
- **Correção:** se o produto depender de e-mail como canal de contato confiável em algum fluxo futuro (ex.: portal do responsável), adicionar double opt-in antes de qualquer ação que dependa da posse do e-mail.

## 6. Falta de requisitos mínimos de senha (comprimento/entropia)

**[CONFORME dentro do modelo, mas com lacuna de política]**

- Não há "senha" no sentido tradicional — o único segredo escolhido por humano é o PIN de 6 dígitos, validado por regex fixa em três pontos:
  - `supabase/functions/admin-create-employee/index.ts:24` — `const PIN_PATTERN = /^\d{6}$/;`
  - `supabase/functions/admin-set-employee-pin/index.ts:12` — idem.
- 6 dígitos = 10^6 combinações. Isso é reconhecido no próprio comentário do código (`login-pin/index.ts:13-18`) e mitigado por rate limiting progressivo (ver item 15).
- **Lacuna real (não coberta hoje):** nenhum dos dois endpoints rejeita PINs triviais (`000000`, `123456`, `111111`, aniversário óbvio). Combinado com o rate limit generoso no início (5 tentativas livres antes do primeiro bloqueio de 60s — `login-pin/index.ts:41`), um atacante com uma lista curta de PINs comuns testados devagar ao longo de vários dias, por vários `employee_id` obtidos da lista pública de colaboradores, tem chance não desprezível de acerto.
- **Severidade:** Baixa/Média.
- **Correção:**
  ```ts
  const WEAK_PINS = new Set(["000000","111111","222222","333333","444444","555555",
    "666666","777777","888888","999999","123456","654321","012345","121212"]);
  if (!PIN_PATTERN.test(body.pin ?? "") || WEAK_PINS.has(body.pin)) {
    return jsonResponse(req, { error: "escolha um PIN menos óbvio" }, 400);
  }
  ```
  Aplicar em `admin-create-employee/index.ts:79` e `admin-set-employee-pin/index.ts:34`.

## 7. Painel admin com OAuth vulnerável

**[INSUFICIENTE/AUSENTE] — justificativa: não há OAuth no sistema**

- Busca exaustiva por `oauth|client_secret|redirect_uri|passport` em `apps/`, `packages/`, `supabase/` não retornou nenhuma ocorrência.
- Toda autenticação do painel administrativo (Gerencial) passa pelo mesmo PIN + `fa_kiosk_can()` descrito nos itens 3 e 9 — não há login social, SSO ou qualquer client OAuth (Google, Microsoft etc.) integrado ao produto.
- Não há, portanto, superfície de `state` CSRF, callback ou validação de domínio de OAuth para avaliar. Item marcado como **AUSENTE por desenho**, não como falha corrigível — mas registrado porque, se um provedor de identidade for adicionado no futuro (o comentário de `login-pin.ts` sugere que isso nunca foi cogitado), o mesmo cuidado de `fa_kiosk_can()` como fonte única de autorização deve se estender ao novo fluxo.

## 8. Ausência de RLS/controle equivalente no banco

**[CONFORME]**

- RLS é extensivamente usado: `grep -rli "row level security" supabase/migrations` retorna 32 arquivos de migration distintos, com `CREATE POLICY` presente em pelo menos 27 arquivos, ao longo de 189 migrations.
- A autorização é centralizada em uma função `fa_kiosk_can(p_capability)` reaproveitada tanto pelas policies RLS quanto pelas Edge Functions (`supabase/functions/_shared/requireCapability.ts:1-13`), evitando a duplicação de regra que costuma causar divergência entre camadas.
- Exceção pontual identificada: a policy `fa_kiosk_crianca_fotos_write_anon_temp` sobre `storage.objects` permite `INSERT` ao papel `anon` sem nenhuma validação adicional (ver item 18) — não é ausência de RLS, é uma policy RLS **excessivamente permissiva** que nunca foi revogada.
- `20260810000003_fa_security_audit_fixes.sql:69-71` mostra que o time já identificou e corrigiu um problema de privilégio default para `anon` em auditoria anterior — evidência de maturidade de processo, mas também de que o mesmo tipo de problema (bucket `crianca-fotos`) escapou da varredura.

## 9. RBAC validado só no front-end

**[CONFORME]**

- O componente de gate de UI é explícito sobre ser só uma conveniência de UX:
  - `apps/kiosk-ui/src/auth/RequireCapability.tsx:35,57` — `if (!can(capability)) { ... }` esconde/bloqueia elementos.
  - `apps/kiosk-ui/src/auth/AuthContext.tsx:12,96` — comentário registra que "as RPCs `fa_config_*` ... checam `fa_kiosk_can()` no servidor a cada chamada", ou seja, o front nunca é a última linha de defesa.
- As Edge Functions administrativas (`admin-create-employee`, `admin-set-employee-pin`, etc.) chamam `requireCapability(req, "config.employees.write")` (`_shared/requireCapability.ts:30-59`) usando um client autenticado **como o chamador** (não service role) para que `fa_kiosk_can()` rode com o `auth.uid()` real — um usuário sem a capability recebe 403 mesmo manipulando a chamada HTTP diretamente, sem depender do front.
- Único ponto fraco real de "confiar no chamador" está fora do escopo de RBAC de papéis: é a ausência de autenticação de identidade em `POST /api/ponto` (ver item 10) — ali não é um problema de RBAC (não há verificação de *papel* insuficiente), é ausência total de autenticação de *quem* está fazendo a chamada.

## 10. IDs sequenciais/previsíveis (IDOR)

**[VULNERÁVEL]**

Dois achados distintos:

**10a — IDOR real por falta de autenticação (não por ID previsível), no ponto eletrônico:**
- **Localização:** `apps/kiosk/src/server/routes/ponto.ts:8-14`.
```ts
app.post("/api/ponto", async (req, reply) => {
  const body = parseBody(pontoBodySchema, req.body);
  const nowMs = ctx.nowMs();
  const id = uuidv7(nowMs);
  const nsr = registerPonto(ctx.db, { id, employeeId: body.employeeId, unitId: body.unitId, kind: body.kind, registeredByEmployeeId: body.registeredByEmployeeId }, nowMs);
  return reply.code(201).send({ id, nsr, atMs: nowMs });
});
```
  O schema (`apps/kiosk/src/server/schemas.ts:170-175`) só valida o **formato** dos campos (`employeeId: z.string().uuid()`), nunca se o chamador **é** esse `employeeId` ou tem PIN validado para agir em nome dele.
- **Impacto:** qualquer tablet/dispositivo que fale com o servidor Fastify local (a origem é validada por regra de IP privado — `apps/kiosk/src/server/app.ts:44-51` — não por identidade) pode registrar uma batida de ponto para **qualquer** `employeeId`, sem PIN algum. Um colaborador mal-intencionado pode bater ponto de entrada/saída por um colega ausente. Como o comentário do próprio arquivo cita a Portaria MTP 671/2021, isso tem implicação trabalhista/jurídica direta, não só técnica.
- **Severidade:** Alta.
- **Correção:**
  - Antes: endpoint aceita `employeeId` livre.
  - Depois: exigir que a requisição carregue uma prova de PIN recém-validado (reaproveitando o fluxo de `login-pin`/`STEP_UP` já existente) e comparar contra `body.employeeId`:
    ```ts
    app.post("/api/ponto", async (req, reply) => {
      const body = parseBody(pontoBodySchema, req.body);
      const stepUp = await verifyRecentPinAuth(ctx, body.employeeId, req.headers["x-ponto-auth-token"]);
      if (!stepUp.ok) return reply.code(401).send({ error: "AUTENTICACAO_NECESSARIA" });
      const nowMs = ctx.nowMs();
      const id = uuidv7(nowMs);
      const nsr = registerPonto(ctx.db, { id, employeeId: body.employeeId, unitId: body.unitId, kind: body.kind, registeredByEmployeeId: body.registeredByEmployeeId }, nowMs);
      return reply.code(201).send({ id, nsr, atMs: nowMs });
    });
    ```
    (`verifyRecentPinAuth` = token de curta duração emitido pelo próprio fluxo de login-pin, já existente no domínio.)

**10b — Backdoor de acesso por substring de ID, não relacionado a sequencialidade mas ao mesmo bug de categoria (confiar em ID exposto):**
- Ver item 17 — `apps/kiosk-ui/api/secret/[id].ts:18-38`. Qualquer requisição cujo `id` contenha `"018bcfe5"` recebe uma resposta especial contendo chaves de API reais, sem checar posse do segredo de verdade.

**Nota positiva:** a maioria das tabelas usa `uuid ... default gen_random_uuid()` (uuidv4, não sequencial) — `supabase/migrations/20260806000001_fa_kiosk_core.sql:12,29,52,67` etc. Uma exceção pontual é `fa_kiosk_birthday_messages` (`20260808040000_fa_kiosk_birthday_messages.sql:12`, `id bigint generated always as identity`), sequencial mas de baixo risco por não parecer exposta a consulta direta por ID de fora.

## 11. Concatenação de strings em SQL (SQL Injection)

**[CONFORME]**

- Buscas por concatenação de SQL (`+`, template strings com `${...}` dentro de `.prepare()`/`query()`/`execute()`) em `packages/db-local` e `supabase` não encontraram nenhuma ocorrência com entrada de usuário.
- Todas as queries encontradas usam parâmetros posicionais:
  - `packages/db-local/src/repositories/coupons.ts:34` — `.prepare("UPDATE coupons SET used_count = used_count + 1 WHERE id = ? AND (max_uses = 0 OR used_count < max_uses)")`.
  - `packages/db-local/src/repositories/products.ts:55` — `db.prepare("UPDATE products SET stock = stock + ? WHERE id = ?").run(delta, productId)`.
- No lado Supabase, o acesso é feito via `supabase-js` (`.from(...).select/insert/eq(...)`), que gera consultas parametrizadas pelo PostgREST — não há SQL cru montado a partir de string de usuário nas Edge Functions revisadas.

## 12. Ausência de validação de schema (Zod/Joi/DTO)

**[CONFORME]**

- `packages/contracts` existe especificamente para isso (DTOs Zod compartilhados entre kiosk, tablets, back-office e Supabase, conforme `README.md`).
- Rotas Fastify usam Zod explicitamente, ex.: `apps/kiosk/src/server/schemas.ts:170-175` (`pontoBodySchema`) e `parseBody(schema, req.body)` em `apps/kiosk/src/server/routes/ponto.ts:9`.
- Edge Functions críticas fazem validação manual equivalente por regex/whitelist antes de tocar o banco (`admin-create-employee/index.ts:24-27,63-81`; `admin-set-employee-pin/index.ts:12,34`; `google-review-webhook/index.ts:58,85-87,121-124`).
- Lacuna pontual: `job-application-webhook/index.ts` valida presença/tipo dos campos manualmente (linhas 19-38) mas não usa um schema formal (Zod) — funcional, porém mais fácil de esquecer uma validação ao evoluir o formulário. Não chega a ser "ausência" no sentido do checklist (há validação), por isso mantido como CONFORME com ressalva.

## 13. Renderização de dados de terceiros como HTML bruto (XSS)

**[INSUFICIENTE] — risco baixo hoje, padrão perigoso presente**

- **Localização:** `apps/kiosk-ui/src/components/WristbandQRCode.tsx:33-53` usa `dangerouslySetInnerHTML={{ __html: svgHtml }}`, onde `svgHtml` vem de `QRCode.toString(value, { type: "svg", ... })` (biblioteca `qrcode`, não HTML de terceiro não confiável). O `value` embutido no QR pode incluir um `guardian_id`/identificador vindo do banco, mas a lib `qrcode` sempre serializa como SVG válido, não repassa o `value` como HTML — o vetor de XSS clássico (dado de terceiro + `innerHTML`) não está presente aqui hoje.
- **Uso correlato:** `WristbandPrintModal.tsx:117` e `EspelhoPontoModal.tsx:228` usam `printableElement.innerHTML` para montar a janela de impressão — é o próprio DOM já renderizado pelo React sendo copiado, não uma string vinda de fora.
- **Por que não é [CONFORME] puro:** não há nenhuma sanitização (`DOMPurify` ou equivalente) documentada como política do projeto — o padrão `dangerouslySetInnerHTML` existe e, se um campo de texto livre (ex.: `comment` de avaliação Google, `body.comment` em `google-review-webhook/index.ts:67,131`) um dia for exibido no painel Gerencial via esse mesmo padrão em vez de `{comment}` do JSX, a introdução de XSS seria trivial e passaria despercebida sem uma regra de lint.
- **Severidade:** Baixa (hoje) / risco de regressão.
- **Correção preventiva:** banir `dangerouslySetInnerHTML` fora de um wrapper único que exija `DOMPurify.sanitize()`:
  ```ts
  // packages/ui/src/safeHtml.ts
  import DOMPurify from "dompurify";
  export function safeHtml(html: string) {
    return { __html: DOMPurify.sanitize(html) };
  }
  ```
  E adicionar regra de ESLint (`react/no-danger` com exceção só para `safeHtml(...)`).

## 14. Salvamento de `req.body` inteiro sem filtragem (Mass Assignment)

**[CONFORME]**

- Busca por `.insert(body)`, `.insert(req.body)`, `.update(body)` sem desestruturação não encontrou ocorrências.
- Todas as Edge Functions revisadas constroem o objeto de insert campo a campo, mesmo quando isso significa repetir código:
  - `admin-create-employee/index.ts:101-114` — cada campo do `insert()` é referenciado individualmente (`body.fullName`, `body.cpf.replace(...)`, etc.), nunca `...body`.
  - `job-application-webhook/index.ts:54-62` — mesmo padrão.
- Isso também bloqueia o vetor clássico de mass assignment "cliente manda `role: 'ADMIN'` no corpo" — `role` é validado contra whitelist (`ROLES.includes(body.role)`, `admin-create-employee/index.ts:75`) antes de ser usado, e o valor persistido é sempre o campo explícito, nunca um spread do body recebido.

## 15. Ausência de rate limiting em rotas sensíveis (login)

**[CONFORME]** para o login por PIN — **[INSUFICIENTE]** para as demais rotas administrativas/públicas.

- `login-pin` implementa rate limiting **por `employee_id`**, deliberadamente não por IP (justificado no comentário: o balcão sai por um NAT único) — `supabase/functions/login-pin/index.ts:40-56,85-106`:
  ```ts
  const LOCK_STEPS = [
    { afterFailures: 5, lockMs: 60_000 },
    { afterFailures: 8, lockMs: 5 * 60_000 },
    { afterFailures: 10, lockMs: 15 * 60_000 },
  ];
  ```
  A trava é consultada **antes** do `bcrypt.compareSync`, evitando gasto de CPU por tentativa (linha 77-87) e é persistida em `fa_kiosk_pin_attempts`, sobrevivendo a reinícios da function.
- **Lacuna:** nenhuma outra rota sensível tem rate limiting equivalente — nem `admin-set-employee-pin` (poderia ser usada para tentar `employeeId`s aleatórios até achar um válido, embora exija capability), nem `export-job-applications` (ver item 1/19, já com problema mais grave de fail-open), nem os endpoints Fastify locais (`/api/ponto`, `/api/secret/*`). Para um serviço exposto publicamente como `job-application-webhook` (formulário público de candidatura), a ausência de rate limiting permite spam/flood de uploads de currículo (até o limite de 5MB por arquivo, sem limite de quantidade de submissões por IP/tempo).
- **Severidade:** Baixa/Média (a rota mais crítica, login, está coberta).
- **Correção:** aplicar um limitador simples por IP nas Edge Functions públicas sem já ter outro controle de abuso, ex. usando uma tabela `fa_rate_limit(key, window_start, count)` e a mesma lógica de `lockMsFor` já existente em `login-pin`, reaproveitada como utilitário em `_shared/`.

## 16. CORS permissivo (`Access-Control-Allow-Origin: *`) em rotas privadas

**[CONFORME]**

- Nenhuma ocorrência de `"*"` como valor de `Access-Control-Allow-Origin` foi encontrada nas Edge Functions ou no servidor Fastify.
- `supabase/functions/_shared/http.ts:35-46` implementa allowlist explícita com fallback seguro (nega por padrão, origem não reconhecida recebe `allowed[0]` — que o navegador rejeita por não bater com a origem real da chamada):
  ```ts
  "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : allowed[0]!,
  ```
- `apps/kiosk/src/server/app.ts:44-51` restringe explicitamente a `localhost`/IPs privados RFC 1918, com o comentário do código deixando claro que isso corrige uma falha anterior (`origin: true` ecoando qualquer origem) identificada em auditoria de 2026-08-10.
- Ressalva menor: `google-review-webhook/index.ts:7-31` duplica a lógica de CORS **inline** em vez de importar `_shared/http.ts` (o comentário explica que é por limitação de bundling do deploy via MCP) — isso já causou uma pequena divergência (essa cópia tem uma lista de origens fallback mais curta que a de `_shared/http.ts`, o que é fail-safe, não fail-open). Risco é de manutenção (duas fontes de verdade), não de exposição.

## 17. Webhooks sem validação HMAC

**[INSUFICIENTE]** — usa segredo estático comparado por igualdade, não HMAC de payload; e há um caso concreto sem proteção alguma.

- O padrão do projeto para "webhooks" externos (Zapier/Make/n8n) é um segredo compartilhado no header `x-webhook-secret`, comparado com `!==` — não uma assinatura HMAC do corpo da requisição:
  - `supabase/functions/_shared/http.ts:69-80` (`requireWebhookSecret`) — falha fechado se o secret não estiver configurado (`if (!expected) return 503`), o que é o comportamento correto para "sem segredo, nega".
  - Usado por `google-review-webhook` (cópia inline, linhas 45-56).
- **Por que isso é insuficiente e não HMAC de verdade:** um shared secret estático só prova posse do segredo, não integridade do corpo da mensagem (não impede replay se o secret vazar de outra forma, e a comparação `!==` não é constant-time, abrindo uma janela teórica de timing attack). HMAC assinaria `corpo + timestamp` com uma chave, invalidando replays antigos e mensagens adulteradas mesmo que o segredo estático vaze parcialmente por log.
- **Caso concreto sem proteção nenhuma:** `supabase/functions/export-job-applications/index.ts:8-14`:
  ```ts
  const expectedKey = Deno.env.get("TALENT_API_KEY") || Deno.env.get("WEBHOOK_SECRET");
  const providedKey = req.headers.get("x-api-key") || req.headers.get("x-webhook-secret") || req.headers.get("authorization")?.replace("Bearer ", "");
  if (expectedKey && providedKey !== expectedKey) {
    return jsonResponse(req, { error: "Acesso não autorizado: API Key inválida" }, 401);
  }
  ```
  Se `expectedKey` for `undefined`/vazio (env var não configurada no projeto Supabase), a condição `expectedKey && ...` é **falsa** e a função **segue em frente sem autenticar ninguém** — o oposto do padrão fail-closed usado em `requireWebhookSecret`. Isso expõe a lista completa de candidaturas (nome, e-mail, telefone, currículo via URL assinada válida por 24h) a qualquer requisição GET não autenticada, bastando que o operador esqueça de configurar a env var (o que, dado que o segredo real vazou no git — item 1 — é plausível que nem tenha sido rotacionado/configurado corretamente).
- **Severidade:** Alta.
- **Correção:**
  - Antes:
    ```ts
    const expectedKey = Deno.env.get("TALENT_API_KEY") || Deno.env.get("WEBHOOK_SECRET");
    const providedKey = req.headers.get("x-api-key") || req.headers.get("x-webhook-secret") || req.headers.get("authorization")?.replace("Bearer ", "");
    if (expectedKey && providedKey !== expectedKey) {
      return jsonResponse(req, { error: "Acesso não autorizado: API Key inválida" }, 401);
    }
    ```
  - Depois (fail-closed, igual ao padrão já usado em `_shared/http.ts`):
    ```ts
    const expectedKey = Deno.env.get("TALENT_API_KEY") || Deno.env.get("WEBHOOK_SECRET");
    if (!expectedKey) {
      console.error("TALENT_API_KEY/WEBHOOK_SECRET não configurado — recusando por padrão seguro");
      return jsonResponse(req, { error: "endpoint não configurado" }, 503);
    }
    const providedKey = req.headers.get("x-api-key") || req.headers.get("x-webhook-secret") || req.headers.get("authorization")?.replace("Bearer ", "");
    if (!providedKey || !timingSafeEqual(providedKey, expectedKey)) {
      return jsonResponse(req, { error: "Acesso não autorizado: API Key inválida" }, 401);
    }
    ```
    (`timingSafeEqual` = comparação de tempo constante, ex. `crypto.subtle` ou `std/crypto/timing_safe_equal` do Deno std.)

## 18. Upload de arquivos sem validação (magic bytes, MIME, tamanho, path traversal)

**[VULNERÁVEL]**

- Validação de tipo/tamanho de imagem hoje é **só client-side**: `apps/kiosk-ui/src/lib/imageCompression.ts:15-22` (`assertValidImageUpload`) roda no navegador antes de chamar `.upload()` diretamente contra o Supabase Storage — um atacante que fale com a API do Storage diretamente (com a anon key, pública por natureza) ignora essa checagem por completo. Não há verificação de magic bytes em lugar nenhum do fluxo.
- **Bucket mais sensível exposto:** `crianca-fotos` (fotos de crianças, dado sensível por LGPD, conforme o próprio comentário da migration). A policy que permite escrita não exige autenticação nem valida o conteúdo:
  - **Localização:** `supabase/migrations/20260807000009_fa_kiosk_child_photos.sql:12-23`.
    ```sql
    insert into storage.buckets (id, name, public)
    values ('crianca-fotos', 'crianca-fotos', false)
    on conflict (id) do nothing;

    create policy fa_kiosk_crianca_fotos_write_anon_temp on storage.objects for insert to anon
      with check (bucket_id = 'crianca-fotos');
    ```
    Sem `allowed_mime_types`, sem `file_size_limit` na definição do bucket, e a policy só checa `bucket_id` — qualquer requisição não autenticada (`anon`) pode subir qualquer arquivo, de qualquer tamanho, para esse bucket.
  - **Confirmação de que não foi corrigido depois:** a migration `20260810000003_fa_security_audit_fixes.sql` (auditoria interna de 2026-08-10) revogou o mesmo padrão de policy `anon` para os buckets `carrinho-fotos` e `envelope-fotos` (linhas 81-89), mas **não tocou em `crianca-fotos`** — `grep -rn "fa_kiosk_crianca_fotos_write_anon_temp"` só aparece na migration original, nunca num `drop policy`.
- **Impacto:** upload arbitrário de arquivo (não necessariamente imagem) para um bucket de dados sensíveis de crianças, sem autenticação, sem limite de tamanho — abuso de armazenamento (custo), possível hospedagem de conteúdo malicioso/ilegal sob o domínio do Supabase do projeto, e nenhuma auditoria de quem fez o upload (papel `anon` não tem identidade).
- **Severidade:** Alta.
- **Correção:**
  - Antes:
    ```sql
    insert into storage.buckets (id, name, public)
    values ('crianca-fotos', 'crianca-fotos', false)
    on conflict (id) do nothing;

    create policy fa_kiosk_crianca_fotos_write_anon_temp on storage.objects for insert to anon
      with check (bucket_id = 'crianca-fotos');
    ```
  - Depois:
    ```sql
    update storage.buckets
      set file_size_limit = 8 * 1024 * 1024,
          allowed_mime_types = array['image/jpeg','image/png','image/webp']
      where id = 'crianca-fotos';

    drop policy if exists fa_kiosk_crianca_fotos_write_anon_temp on storage.objects;

    create policy fa_kiosk_crianca_fotos_write_authenticated on storage.objects
      for insert to authenticated
      with check (bucket_id = 'crianca-fotos');
    ```
    (Mesmo padrão já aplicado a `envelope-fotos` na migration de 2026-08-10 — só falta replicar aqui.) Adicionalmente, validar magic bytes no servidor (Edge Function intermediária em vez de upload direto do client) para os buckets que aceitam dado sensível.

## 19. Stack traces/erros internos expostos em produção

**[CONFORME]** no servidor Fastify local — **[INSUFICIENTE]** nas Vercel Functions.

- `apps/kiosk/src/server/app.ts:59-66` centraliza o tratamento de erro e nunca devolve `err.message`/`err.stack` para erros não esperados:
  ```ts
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ValidationError) return reply.code(err.statusCode).send({ error: "VALIDATION_ERROR", message: err.message });
    if (err instanceof ConflictError) return reply.code(err.statusCode).send({ error: "CONFLICT", message: err.message, ...err.details });
    app.log.error(err);
    return reply.code(500).send({ error: "INTERNAL_ERROR" });
  });
  ```
  Só erros de validação/conflito (mensagens deliberadamente escritas para o usuário) vazam `message`; qualquer outro erro vira `INTERNAL_ERROR` genérico, e o detalhe vai só para o log do servidor.
- Edge Functions seguem o mesmo padrão de log server-side + mensagem genérica ao cliente (`console.error(...)` seguido de `jsonResponse(req, { error: "..." }, 500)` em praticamente todas as functions revisadas).
- **Lacuna:** os handlers em `apps/kiosk-ui/api/*.ts` (Vercel Serverless Functions) não têm um error handler central — cada arquivo escreve sua própria resposta de erro. Não foi encontrado nenhum `catch` que devolvesse `err.stack` ao cliente nos arquivos revisados, mas também não há uma garantia estrutural (um `try/catch` global) contra um erro não tratado (ex.: exceção em `JSON.parse` de um payload malformado) explodir e a Vercel devolver seu próprio "Internal Server Error" com detalhes de runtime, dependendo da configuração de `NODE_ENV`. Recomenda-se envolver esses handlers com um wrapper padrão de captura de erro, igual ao `setErrorHandler` do Fastify.

## 20. Dependências desatualizadas com CVEs

**[VULNERÁVEL]**

`pnpm audit --json` (executado nesta auditoria) reportou:

```
{ "info": 0, "low": 6, "moderate": 31, "high": 47, "critical": 2 }
```

Dependências de **produção** (não apenas devDependencies de build/test) com CVEs relevantes:

- **`@xmldom/xmldom@0.8.10`** — `packages/fiscal/package.json:22`, usado para montar/parsear o XML da NFC-e (modelo 65, chave de acesso, XMLDSig) em `packages/fiscal/src`. Múltiplas advisories de severidade Alta cobrindo injeção de nome de elemento/atributo, bypass de `requireWellFormed` e ReDoS quadrático (ex. GHSA para "Element name injection via createElement() bypasses requireWellFormed", "End-tag Whitespace-Trim Regex ReDoS"). Como este pacote monta documento fiscal que é transmitido à SEFAZ, uma falha de serialização/injeção aqui tem impacto direto em conformidade fiscal, não só em disponibilidade.
  - **Correção:** atualizar para a versão corrigida mais recente do `@xmldom/xmldom` (checar changelog para breaking changes na API de parsing usada em `packages/fiscal/src/nfce`) e adicionar teste de regressão gerando um XML de NFC-e real após o bump.
- **`electron@37.10.3`** — `apps/kiosk/package.json:42`, runtime de produção do quiosque (não devDependency). CVEs de Alta severidade incluem bypass de context isolation via `Function.prototype.bind` hijack, leitura cross-origin via protocolo customizado com `supportFetchAPI`, e use-after-free em `PowerMonitor`/`WebContents`. Em um app Electron que roda com privilégios de sistema no PC do balcão, um bypass de sandbox tem impacto alto (execução de código na máquina que processa pagamento e emissão fiscal).
  - **Correção:** atualizar para a versão patch mais recente da mesma major (ou migrar de major se necessário), revisando `apps/kiosk/src/main/main.ts` quanto a `webPreferences` (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` devem estar explícitos).
- Demais achados críticos/altos (`tar`, `vitest`, `extract-zip`, `vite`, `esbuild`, `js-yaml`, `fast-uri`) aparecem majoritariamente em cadeias de **devDependencies** (`electron-builder`, `vitest`, `vite`) — risco menor por não rodarem em produção, mas ainda relevantes para a máquina de build/CI (ex.: `vitest` "arbitrary file can be read and executed" quando o UI server está ativo — não deixar essa porta aberta em ambiente de CI compartilhado).
- **Severidade consolidada:** Alta (pelas duas dependências de produção citadas).
- **Correção geral:** rodar `pnpm audit --prod` regularmente no CI (falhando o build acima de um limiar de severidade para dependências de produção) e configurar Dependabot/Renovate para os pacotes `packages/fiscal` e `apps/kiosk`.

---

## Apêndice — Checklist de remediação priorizada

| # | Item | Severidade | Ação imediata |
|---|------|-----------|----------------|
| 1 | Segredo do banco de talentos no git | Crítica | Rotacionar a chave e remover do histórico |
| 17 | `export-job-applications` fail-open | Alta | Fail-closed quando env var ausente |
| 10a | IDOR em `/api/ponto` | Alta | Exigir prova de PIN por `employeeId` |
| 18 | Bucket `crianca-fotos` sem policy segura | Alta | Replicar fix de `envelope-fotos` |
| 20 | `@xmldom/xmldom` / `electron` desatualizados | Alta | `pnpm audit --prod` + bump |
| 4 | Sessão em `localStorage` | Média | Cookie HttpOnly via `@supabase/ssr` ou servidor local |
| 6 | Sem blacklist de PIN trivial | Média | Lista de PINs proibidos |
| 13 | `dangerouslySetInnerHTML` sem sanitização central | Baixa | `DOMPurify` + lint rule |
| 15 | Sem rate limit em rotas públicas além do login | Baixa/Média | Reaproveitar `lockMsFor` em `_shared/` |
