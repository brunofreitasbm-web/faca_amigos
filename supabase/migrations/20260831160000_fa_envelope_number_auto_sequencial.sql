-- Número do envelope deixa de ser digitado pelo operador (campo livre sujeito
-- a erro de digitação e a números repetidos entre unidades) e passa a ser
-- gerado pelo servidor: sequência global (independente da unidade),
-- começando em 01, sem repetir (sem wraparound — cada envelope tem um
-- número único; passa de 2 dígitos naturalmente após o 99º).
create sequence if not exists fa_kiosk_envelope_number_seq start 1;

create or replace function fa_next_envelope_number()
returns text as $$
  select lpad(nextval('fa_kiosk_envelope_number_seq')::text, 2, '0');
$$ language sql security definer set search_path = public, pg_temp;

revoke execute on function fa_next_envelope_number() from public, anon;
grant execute on function fa_next_envelope_number() to authenticated;
