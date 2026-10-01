-- Move a chave x-sync-key do job hotmart-sync-15min (jobid 10) do texto puro do comando agendado para o Vault,
-- no mesmo padrão do job eventos-dispatch (ops_key). O valor não aparece nesta migration: é extraído do próprio
-- comando agendado dentro do banco. IMPORTANTE: a chave antiga ficou exposta em texto puro e deve ser rotacionada;
-- depois da rotação basta atualizar o segredo 'hotmart_sync_key' no Vault (e o valor esperado pela function).
do $$
declare
  v_key text;
  v_cmd text;
begin
  select (regexp_match(command, '"x-sync-key":"([^"]+)"'))[1] into v_key from cron.job where jobid = 10;
  if v_key is null then
    raise notice 'job 10 já não tem chave literal; nada a fazer';
    return;
  end if;

  if not exists (select 1 from vault.secrets where name = 'hotmart_sync_key') then
    perform vault.create_secret(v_key, 'hotmart_sync_key', 'x-sync-key do job hotmart-sync-15min (movida do comando do cron)');
  end if;

  -- Garante que o valor guardado no Vault é idêntico ao que estava no cron antes de trocar o comando.
  if (select decrypted_secret from vault.decrypted_secrets where name = 'hotmart_sync_key') is distinct from v_key then
    raise exception 'valor no Vault difere da chave do cron; abortando sem alterar o job';
  end if;

  v_cmd := $cmd$select net.http_post(url:='https://ivjvpdzsfjdpyabbzzuj.supabase.co/functions/v1/hotmart-sync?run=1', headers:=jsonb_build_object('Content-Type','application/json','x-sync-key',(select decrypted_secret from vault.decrypted_secrets where name = 'hotmart_sync_key')), body:='{}'::jsonb, timeout_milliseconds:=30000);$cmd$;
  perform cron.alter_job(10, command := v_cmd);
end $$;
