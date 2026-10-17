# MCP FaçaAmigos (somente leitura)

Servidor MCP em `https://<dominio-vercel>/mcp` (Streamable HTTP, stateless, só `POST`).
Código: `apps/kiosk-ui/api/mcp.ts`, `api/_mcp/`. Dados: RPCs `fa_mcp_*` em
`supabase/migrations/20261017120000_fa_mcp_readonly.sql`.

## O que ele expõe

Somente **agregados**; nenhuma RPC seleciona nome, CPF ou nascimento de criança/responsável,
nem texto livre (comentário de NPS, observações).

| Tool | Conteúdo |
|---|---|
| `listar_unidades` | IDs e nomes das unidades |
| `faturamento` | Pedidos pagos por dia/unidade e por forma de pagamento |
| `sessoes` | Check-ins por plano, duração média, dia da semana e hora |
| `ocupacao_agora` | Sessões ativas / aguardando pagamento agora |
| `caixa` | Turnos: esperado vs. declarado, sangrias, suprimentos |
| `produtos` | Vendas do PDV e estoque |
| `metas` | Meta diária vs. realizado |
| `nps` | NPS, promotores/neutros/detratores, médias |
| `fidelidade` | Pacotes vendidos, créditos em aberto, cupons |

Valores monetários saem em `*_cents` e `*_reais`.

## Criar uma chave

```sh
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  node scripts/mcp-create-key.mjs "Bruno - Claude" [unit_id,unit_id]
```

Só o hash SHA-256 é gravado. Para revogar: `update fa_mcp_api_keys set revoked_at = now() where label = '...'`.

## Conectar

**Claude Code**
```sh
claude mcp add --transport http facaamigos https://<dominio>/mcp --header "Authorization: Bearer <chave>"
```

**Claude Desktop** (`claude_desktop_config.json`; conectores remotos pela UI exigem OAuth, que este servidor não implementa)
```json
{ "mcpServers": { "facaamigos": {
  "command": "npx",
  "args": ["-y", "mcp-remote", "https://<dominio>/mcp", "--header", "Authorization:${FA_AUTH}"],
  "env": { "FA_AUTH": "Bearer <chave>" }
} } }
```

**Gemini CLI** (`~/.gemini/settings.json`)
```json
{ "mcpServers": { "facaamigos": {
  "httpUrl": "https://<dominio>/mcp",
  "headers": { "Authorization": "Bearer <chave>" }
} } }
```

## Limitações

- **App Gemini (gemini.google.com)**: não permite adicionar servidor MCP remoto arbitrário. Use Gemini CLI ou o SDK/AI Studio.
- **claude.ai web/celular**: exigiria OAuth 2.1; não implementado.
- Os dados saem para os servidores da Anthropic/Google nas conversas: por isso só agregados.
