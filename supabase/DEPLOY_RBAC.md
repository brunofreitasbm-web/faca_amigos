# Deploy do RBAC + hardening — ordem obrigatória

As migrations `20260807000002`…`20260807000006` e o kiosk-ui novo são **uma única
entrega**. Aplicar as migrations sem o front novo derruba o terminal; publicar o
front sem as migrations deixa o menu Configurações escondido mas ainda alcançável
por chamada direta ao PostgREST.

O motivo é o mesmo dos dois lados: hoje o terminal opera **sem sessão nenhuma**
(entrava direto com o primeiro colaborador da lista) e só funciona porque a
migration `20260806000016` abriu leitura `to anon` em 24 tabelas. As migrations
abaixo fecham isso; o front novo exige login por PIN. Um sem o outro não anda.

---

## 0. Antes de tudo (pode ir sozinho, hoje)

- [ ] **Backoffice**: o guard de autenticação em
      `apps/backoffice/src/lib/supabase/middleware.ts` foi reativado — estava
      comentado, o que deixava o painel administrativo **público na internet**.
      Publique esta correção imediatamente, mesmo que o resto espere.
- [ ] Confirme que existe **pelo menos um colaborador com `role = 'ADMIN'` e
      `active = true`**, com PIN cadastrado em `fa_kiosk_local_credentials`:

      select e.id, e.full_name, e.role, e.active, (c.employee_id is not null) as tem_pin
        from fa_kiosk_employees e
        left join fa_kiosk_local_credentials c on c.employee_id = e.id
       where e.role = 'ADMIN';

      **Se não houver, pare aqui.** Depois da migration 03 ninguém entra sem PIN,
      e criar colaborador exige um Owner autenticado — o sistema ficaria trancado
      por fora. Crie o primeiro Owner com service role antes de seguir.
- [ ] Idealmente **dois** Owners ativos. A partir da migration 03 um trigger
      recusa rebaixar/desativar o último, mas ele não cria o segundo por você.

## 1. Migrations (nesta ordem — o CLI já aplica por nome)

```bash
supabase link --project-ref ivjvpdzsfjdpyabbzzuj
supabase db push
```

| Arquivo | O que faz |
|---|---|
| `20260807000002_fa_rbac_capabilities.sql` | Matriz de capacidades, `fa_kiosk_can`, view `fa_kiosk_my_capabilities`, escrita de configuração passa de Líder para Owner |
| `20260807000003_fa_security_hardening.sql` | Revoga `anon`, fecha hash de PIN, `search_path` em toda função `security definer`, tabela de tentativas de PIN, guard do último Owner |
| `20260807000004_fa_kiosk_fiscal_nfse_cadastro.sql` | Campos de cadastro de NFS-e (só cadastro; emissão fora de escopo) |
| `20260807000005_fa_config_rpc.sql` | RPCs `fa_config_*` com checagem de capacidade + auditoria |
| `20260807000006_fa_actor_integrity.sql` | Ator derivado de `auth.uid()` por trigger; sangria/estorno/troca de plano exigem Líder |

## 2. Edge Functions

```bash
supabase functions deploy login-pin
supabase functions deploy list-employees
supabase functions deploy admin-create-employee
supabase functions deploy admin-set-employee-pin
```

Variável de ambiente nova (senão o CORS cai no fallback de localhost e o
terminal em produção não consegue logar):

```bash
supabase secrets set FUNCTIONS_ALLOWED_ORIGINS="https://app.institutofacaamigos.com.br,http://localhost:5173"
```

## 3. Front

```bash
pnpm --filter @facaamigos/kiosk-ui build
# deploy do dist/ (Vercel)
```

`VITE_BACKOFFICE_URL` foi removida do `.env` — se estiver configurada no Vercel,
apague de lá também.

## 4. Verificação (na ordem, com o terminal real)

- [ ] Terminal pede PIN. Entrar como Owner: menu mostra **todas** as telas.
- [ ] Entrar como Operador: **não** aparecem Relatório nem Configurações; em
      Caixa não aparece Sangria/Suprimento; no Painel não aparece "Mudar Plano".
- [ ] Como Operador, tentar por fora (console do navegador):
      `supabase.from('fa_kiosk_plans').update({value_cents:1}).eq('id', <id>)`
      → deve falhar. **Se passar, pare e investigue: a migration 02 não pegou.**
- [ ] Errar o PIN 5 vezes seguidas → bloqueio de 1 minuto com mensagem própria.
- [ ] Fazer um check-in e conferir que `checkin_by_employee_id` é o colaborador
      logado, mesmo que a chamada tenha mandado outro `employeeId`.
- [ ] Configurações › Dados Fiscais carrega e salva; conferir a linha
      `CONFIG_FISCAL_UPDATE` em `fa_kiosk_audit_log`.

## 5. Depois de estabilizar (não deixe pendente)

- [ ] **Remover o backoffice do Vercel** (`vercel remove`). Enquanto o
      deployment existir, ele escreve direto nas tabelas sem passar pelas RPCs —
      é um bypass do RBAC inteiro.
- [ ] **Rotacionar a publishable key** do Supabase. A atual circulou em bundle
      público durante todo o período em que as policies `to anon` estiveram
      abertas; trocar é o que encerra esse vazamento.
- [ ] **Auditar policies criadas fora do repositório** (a migration
      `20260806000009` avisa que existem policies `_temp` feitas no dashboard
      que ela não consegue derrubar):

      select tablename, policyname, roles, cmd
        from pg_policies where schemaname = 'public' order by tablename;

      O que não estiver declarado em `supabase/migrations/` é porta dos fundos
      invisível no código.
- [ ] Remover `apps/backoffice` do `pnpm-workspace.yaml` e apagar o diretório.

---

## Rollback

Se algo travar a operação, o caminho mais rápido **não** é reverter tudo — é
recriar temporariamente as policies de leitura anônima:

```sql
-- EMERGÊNCIA APENAS. Reabre leitura pública; use pelo menor tempo possível.
create policy fa_kiosk_read_anon_temp on fa_kiosk_units for select to anon using (true);
-- (repetir para as tabelas necessárias — ver a lista na migration 16)
```

Reverter a migration 02 sozinha é pior: sem ela as policies de escrita somem e
qualquer autenticado passa a escrever nas tabelas de configuração.
