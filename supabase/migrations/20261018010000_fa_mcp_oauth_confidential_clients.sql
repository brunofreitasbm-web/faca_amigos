-- Clientes OAuth confidenciais (ex.: Gemini, que pede ID e chave secreta do cliente).
-- Guarda só o SHA-256 do segredo; nulo = cliente público (PKCE sem segredo).
alter table fa_mcp_oauth_clients add column if not exists client_secret_hash text;
