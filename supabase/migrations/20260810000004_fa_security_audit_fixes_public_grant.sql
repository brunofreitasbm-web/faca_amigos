-- Complemento de 20260810000003: o revoke de `anon` não bastava porque
-- essas funções também tinham EXECUTE concedido a PUBLIC (`=X/postgres`
-- no ACL) — e todo role, incluindo anon, é implicitamente membro de
-- PUBLIC. Revoga de PUBLIC explicitamente.
revoke execute on function fa_collect_envelopes(text, uuid, uuid) from public;
revoke execute on function fa_units_cash_status() from public;
revoke execute on function fa_units_envelope_balance() from public;
revoke execute on function fa_record_cash_movement(text, uuid, text, integer, text, uuid, text, text) from public;

grant execute on function fa_collect_envelopes(text, uuid, uuid) to authenticated;
grant execute on function fa_units_cash_status() to authenticated;
grant execute on function fa_units_envelope_balance() to authenticated;
grant execute on function fa_record_cash_movement(text, uuid, text, integer, text, uuid, text, text) to authenticated;
