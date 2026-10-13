-- Teto de marketing: no máximo 1 mensagem promocional a cada 30 dias por pessoa,
-- somando TODAS as automações (antes só o ciclo de vida se limitava — 1 por
-- semana e 3 por mês, contando só fa_crm_automation_sends — e boas-vindas,
-- fidelidade, mapeamento e opt-in de marketing passavam por fora: em out/2026 uma
-- família chegou a receber 15 mensagens de marketing, média 2,2 por contato, e a
-- Meta passou a barrar envios com o erro 63049).
--
-- O que ENTRA no teto (bloqueia e conta): ofertas e relacionamento — boas-vindas,
-- fidelidade, mapeamento, opt-in de marketing, cupom de retorno, prêmio de
-- fidelidade, upsell, degraus, cross-sell, VIP, winback e aniversário.
-- O que NÃO entra (nem bloqueia nem conta): mensagens operacionais ligadas a uma
-- sessão em andamento ou a um pedido do cliente — alerta de renovação com botões,
-- excedente, renovação aplicada, expiração de saldo, NPS, pedido de autorização,
-- relatório de sessão. Para mudar a lista, edite o array abaixo.
-- Aniversário nunca é bloqueado (acontece uma vez por ano e leva cortesia), mas
-- conta para os próximos.
--
-- "Pessoa" = mesmo telefone em qualquer canal (compara os 8 últimos dígitos, o que
-- cobre a variação com/sem o 9º dígito). Só conta envio que não falhou.
create or replace function fa_crm_can_send(p_contact_id uuid, p_category text, p_now_ms bigint, p_kind text default null)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when p_category <> 'MARKETING' then true
    when coalesce(p_kind = 'ANIVERSARIO', false) then true
    else not exists (
      select 1
      from fa_crm_messages m
      join fa_crm_templates t on t.id = m.template_id
      join fa_crm_contacts c on c.id = m.contact_id
      where m.direction = 'OUT'
        and m.created_at_ms > p_now_ms - 30 * 86400000::bigint
        and m.status not in ('failed', 'undelivered')
        and t.purpose = any (array[
          'VISITA_BOAS_VINDAS', 'VISITA_FIDELIDADE', 'MAPEAMENTO', 'OPTIN_MARKETING', 'RELATORIO_CUPOM',
          'PREMIO_FIDELIDADE', 'UPSELL_PACOTE', 'DEGRAU_2H', 'DEGRAU_PORTO', 'DEGRAU_DAYUSE',
          'CROSS_ATIVIDADE', 'CROSS_IRMAO', 'VIP', 'WINBACK', 'ANIVERSARIO'
        ])
        and right(c.phone_e164, 8) = (select right(x.phone_e164, 8) from fa_crm_contacts x where x.id = p_contact_id)
    )
  end
$$;
revoke execute on function fa_crm_can_send(uuid, text, bigint, text) from public, anon, authenticated;
grant execute on function fa_crm_can_send(uuid, text, bigint, text) to service_role;

-- A versão de 3 argumentos (usada pelo webhook para decidir a oferta de boas-vindas
-- após o aceite) passa a seguir a mesma regra.
create or replace function fa_crm_can_send(p_contact_id uuid, p_category text, p_now_ms bigint)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select fa_crm_can_send(p_contact_id, p_category, p_now_ms, null::text)
$$;
revoke execute on function fa_crm_can_send(uuid, text, bigint) from public, anon, authenticated;
grant execute on function fa_crm_can_send(uuid, text, bigint) to service_role;

-- Trava de duplicidade: true se este contato já recebeu exatamente este texto
-- (mesma criança, mesmas opções) dentro da janela. Cobre o caso de uma família
-- receber o mesmo aviso 3 a 5 vezes em 2 minutos por várias sessões da mesma criança.
create or replace function fa_crm_recent_same_body(p_contact_id uuid, p_body text, p_now_ms bigint, p_window_ms bigint default 1800000)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from fa_crm_messages m
    where m.contact_id = p_contact_id and m.direction = 'OUT'
      and m.body = p_body
      and m.status not in ('failed', 'undelivered')
      and m.created_at_ms > p_now_ms - p_window_ms
  )
$$;
revoke execute on function fa_crm_recent_same_body(uuid, text, bigint, bigint) from public, anon, authenticated;
grant execute on function fa_crm_recent_same_body(uuid, text, bigint, bigint) to service_role;
