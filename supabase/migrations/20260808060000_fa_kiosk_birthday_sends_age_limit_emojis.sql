-- Três ajustes no módulo de aniversariantes (feedback do operador em produção):
--
-- 1. Depois que o operador manda a felicitação, o card some da tela e só
--    volta a aparecer no aniversário do ano seguinte — precisa de um
--    registro "já mandei este ano, nesta unidade" (fa_kiosk_birthday_sends).
-- 2. A partir dos 11 anos a criança não aparece mais no módulo, para
--    sempre — o parque é para o público infantil (0-10 anos); isso é um
--    corte permanente, não anual (idade só cresce, então basta filtrar
--    pela idade que a criança completa este ano).
-- 3. Todas as 1000 mensagens precisam ter emoji também no corpo (só
--    abertura e fecho tinham) — refeitas do zero (truncate + reseed).

create table if not exists fa_kiosk_birthday_sends (
  unit_id uuid not null references fa_kiosk_units(id),
  child_id uuid not null references fa_kiosk_children(id),
  year int not null,
  employee_id uuid references fa_kiosk_employees(id),
  sent_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint,
  primary key (unit_id, child_id, year)
);

alter table fa_kiosk_birthday_sends enable row level security;
-- Sem policy: só a RPC abaixo (security definer) escreve, e a leitura só
-- importa dentro de fa_kiosk_birthdays_by_unit (também security definer) —
-- mesmo padrão de fa_kiosk_role_capabilities.

create or replace function fa_kiosk_mark_birthday_sent(p_unit_id uuid, p_child_id uuid, p_employee_id uuid default null)
returns void as $$
  insert into fa_kiosk_birthday_sends (unit_id, child_id, year, employee_id)
  values (p_unit_id, p_child_id, extract(year from current_date)::int, p_employee_id)
  on conflict (unit_id, child_id, year) do nothing;
$$ language sql security definer set search_path = public, pg_temp;

revoke all on function fa_kiosk_mark_birthday_sent(uuid, uuid, uuid) from public, anon;
grant execute on function fa_kiosk_mark_birthday_sent(uuid, uuid, uuid) to authenticated;

create or replace function fa_kiosk_birthdays_by_unit(p_unit_id uuid, p_month int)
returns table (
  id uuid,
  full_name text,
  birth_date date,
  age_turning int,
  guardian_name text,
  phone_e164 text,
  day_of_month int,
  is_today boolean
) as $$
  select distinct on (c.id)
    c.id,
    c.full_name,
    c.birth_date,
    (extract(year from current_date) - extract(year from c.birth_date))::int as age_turning,
    coalesce(g.full_name, 'Responsável'),
    coalesce(g.phone_e164, ''),
    extract(day from c.birth_date)::int as day_of_month,
    extract(day from c.birth_date)::int = extract(day from current_date)::int
      and p_month = extract(month from current_date)::int as is_today
  from fa_kiosk_children c
  join fa_kiosk_sessions s on s.child_id = c.id and s.unit_id = p_unit_id
  left join fa_kiosk_child_guardians cg on cg.child_id = c.id
  left join fa_kiosk_guardians g on g.id = cg.guardian_id
  left join fa_kiosk_birthday_sends bs
    on bs.unit_id = p_unit_id and bs.child_id = c.id
   and bs.year = extract(year from current_date)::int
  where extract(month from c.birth_date)::int = p_month
    and (extract(year from current_date) - extract(year from c.birth_date))::int < 11
    and bs.child_id is null
  order by c.id, cg.is_authorized_pickup desc nulls last
$$ language sql stable security definer set search_path = public, pg_temp;

revoke all on function fa_kiosk_birthdays_by_unit(uuid, int) from public, anon;
grant execute on function fa_kiosk_birthdays_by_unit(uuid, int) to authenticated;

-- Reseed do pool de mensagens com emoji também no corpo (item 3).
truncate table fa_kiosk_birthday_messages;

insert into fa_kiosk_birthday_messages (message)
select trim(o) || ' ' || trim(b) || ' ' || trim(c)
from unnest(array[
  'Oi, {responsavel}! 🎉 Hoje é um dia especialíssimo por aí: {crianca} está completando {idade} aninhos!',
  'Que dia mais gostoso de comemorar, {responsavel}! 🎂 {crianca} chega aos {idade} anos hoje!',
  '{responsavel}, passamos aqui só para celebrar com vocês: {crianca} faz {idade} aninhos hoje! 🥳',
  'Hoje o calendário marca uma data muito querida para a gente também, {responsavel}: {crianca} está fazendo {idade} anos! ✨',
  '{responsavel}, a equipe Faça Amigos acordou pensando em uma pessoa hoje: {crianca}, que completa {idade} aninhos! 🎈',
  'Feliz aniversário para {crianca}! 🎉 {responsavel}, hoje são {idade} motivos para sorrir. 🎊',
  '{responsavel}, {crianca} está de aniversário novo: {idade} aninhos cheios de histórias, descobertas e brincadeiras! 🌈',
  'Um dia tão especial merece um recado especial, {responsavel}: {crianca} completa {idade} anos hoje! 🎁',
  '{responsavel}, hoje é dia de bolo, festa e muito carinho: {crianca} faz {idade} aninhos! 🧁',
  '{crianca} está de parabéns hoje, {responsavel}! 🎶 {idade} aninhos de muita alegria para celebrar.'
]) as o
cross join unnest(array[
  'Aqui no Faça Amigos, cada criança tem seu próprio jeito de brincar, sentir e se expressar 🧩 — e é exatamente esse jeito único que faz o nosso espaço ser tão especial. 💛',
  'A gente acredita que todo mundo merece um lugar para brincar no seu próprio ritmo, com respeito e acolhimento 🤗 — e {crianca} faz parte dessa turma tão querida. 🌟',
  'Ver {crianca} sorrindo, explorando e se divertindo do jeitinho dela 😄 é um dos maiores presentes que o Faça Amigos recebe todos os dias. 🎈',
  'Cada visita de {crianca} por aqui deixa um pouquinho de alegria espalhada pelo parque ✨ — e a gente sente muita falta quando ela não está. 🥰',
  'O Faça Amigos foi feito para ser um espaço inclusivo de verdade 🌈, onde cada criança encontra o seu cantinho de conforto e diversão — {crianca} sempre encontra o dela. 💚',
  'Nada nos deixa mais felizes 😊 do que ver famílias como a de vocês confiando no Faça Amigos para momentos tão importantes de infância. 🧡',
  'Aqui, brincar é coisa séria: respeitamos o tempo, os sentidos e as descobertas de cada criança, sempre com muito carinho 💛 — e {crianca} é parte dessa história.',
  'A turma do Faça Amigos guarda um carinho enorme por {crianca} 🥰 — e sabe muito bem o quanto cada sorriso dela ilumina o parque. ✨',
  'Acolher, incluir e celebrar cada jeito de ser criança 🌈 é o que nos move todos os dias — e {crianca} representa tudo isso muito bem. 💫',
  'Esse tipo de data nos lembra por que fazemos o que fazemos 🤍: para que cada criança, do seu jeito, tenha um lugar seguro para ser feliz. 🎈'
]) as b
cross join unnest(array[
  'Estamos com os braços abertos esperando {crianca} para uma nova visita cheia de risadas — venham comemorar com a gente! 🎠',
  'Que tal marcar uma nova visitinha ao Faça Amigos para continuar essa festa? Vamos adorar receber {crianca} de novo! 🎪',
  'A porta do Faça Amigos está sempre aberta para {crianca} vir brincar mais um pouco — esperamos vocês em breve! 🧡',
  'Separe um dia especial na agenda: {crianca} tem sempre um lugar guardado aqui para se divertir de novo com a gente! 🎡',
  'Vai ser uma alegria enorme receber {crianca} de novo por aqui — combine sua próxima visita quando quiser! 🌟',
  'Conta com a gente para o próximo capítulo de diversão de {crianca} — estamos ansiosos para essa próxima visita! 🎉',
  'O parque já está com saudade das risadas de {crianca} — venham nos visitar em breve para matar essa saudade! 🎠',
  'Que venham muitos e muitos retornos ao Faça Amigos — {crianca} é sempre muito bem-vinda(o) por aqui! 💛',
  'Combine com a família a próxima visita: tem muita brincadeira nova esperando por {crianca} aqui no parque! 🎈',
  'Feliz aniversário, {crianca}! E já fica o convite: esperamos vocês de volta muito em breve para comemorar juntos! 🎂'
]) as c;
