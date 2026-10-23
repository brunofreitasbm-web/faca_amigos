# Convenções de trabalho (valem para qualquer sessão de IA e para pessoas)

## Git
- Nunca commitar direto em `main`. Uma branch por tarefa, nome `tipo/assunto-curto` (ex.: `feat/export-fit`, `fix/token-sync`).
- Mensagem de commit no padrão Conventional Commits: `tipo(escopo): resumo no imperativo`, até 72 caracteres.
  Tipos: feat, fix, refactor, perf, docs, test, chore, ci.
- Abrir PR para `main`. O merge é sempre **squash**; o título do PR vira a mensagem final, então escreva-o no padrão acima.
- Atualizar a branch com `git rebase origin/main`, nunca com "Merge branch 'main' of ..." (gera ruído no histórico).
- Não criar commits de release à mão nem mexer em versão sem pedido explícito.

## Deploy
- Não rodar deploy por linha de comando (`vercel --prod`, `netlify deploy --prod` ou equivalente). Produção só muda quando o PR é mergeado em `main`.
- Para testar antes de mergear, usar o preview automático do PR.

## O que nunca entra no repositório
- Segredos: `.env*` (exceto `.env.example`), chaves, tokens, senhas.
- Dados reais: planilhas, PDFs de clientes, exportações, relatórios de vendas, contratos.
- Lixo de sessão: logs (`*.log`), `scratch*`, `_tmp*`, builds locais (`.next/`, `node_modules/`).
Se precisar de um arquivo temporário, crie fora do repositório ou apague antes do commit.

## Antes de abrir o PR
- Rodar o build e os testes do projeto (comandos no `package.json` ou no README) e corrigir o que quebrar.
- Alterar só o que a tarefa pede. Mudança fora do escopo vai em outro PR.
- Se a tarefa mexe em deploy ou variáveis de ambiente, dizer isso na descrição do PR.
