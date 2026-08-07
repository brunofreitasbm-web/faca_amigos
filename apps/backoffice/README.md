# @facaamigos/backoffice — DESATIVADO

> ⚠️ **Este app está sendo desligado.** Toda a administração foi consolidada em
> **Configurações**, dentro do `apps/kiosk-ui`, com controle de acesso de 3 níveis
> (Operador / Líder / Owner) validado no servidor. Nada novo deve ser adicionado aqui.

## Por que ele ainda existe no repositório

Só como referência das telas migradas, até o deployment ser removido do Vercel. O código
continua funcional, mas nenhuma tela dele é a fonte da verdade da operação.

## O que PRECISA ser feito para desativar de verdade

Remover o link do kiosk-ui não desativa nada — o deployment é alcançável por URL direta.
Enquanto ele existir, é um bypass completo do RBAC do kiosk-ui: as telas deste app escrevem
direto nas tabelas, sem passar pelas RPCs `fa_config_*`.

1. **Remover o projeto do Vercel** (`vercel remove`, ou deletar pelo painel).
   Até lá, o guard de autenticação em `src/lib/supabase/middleware.ts` está **ativo** de novo —
   ele estava comentado, o que deixava o painel administrativo público na internet.
2. **Rotacionar a publishable key** do Supabase depois de aplicar a migration
   `20260807000003_fa_security_hardening.sql`. A chave atual circulou em bundle público
   enquanto as policies `to anon` estavam abertas.
3. **Auditar policies residuais** criadas direto no dashboard, fora do repositório:
   ```sql
   select schemaname, tablename, policyname, roles, cmd
     from pg_policies where schemaname = 'public' order by tablename;
   ```
   O que não estiver declarado em `supabase/migrations/` é porta dos fundos invisível no código.
4. Remover `apps/backoffice` do `pnpm-workspace.yaml` e apagar o diretório.

## Onde cada tela foi parar

| Backoffice | kiosk-ui |
|---|---|
| `/unidades` | Configurações › Unidade |
| `/planos` | Configurações › Planos de Preços |
| `/produtos` | Configurações › Produtos (fiscal em › Dados Fiscais) |
| `/cupons` | Configurações › Cupons |
| `/funcionarios` | Configurações › Colaboradores |
| `/fiscal` | Configurações › Dados Fiscais |
| `/configuracoes` | Configurações › Meta / Unidade / Termos de Uso |
| `/relatorios`, `/dashboard` | Relatório (visível a partir de Líder) |
