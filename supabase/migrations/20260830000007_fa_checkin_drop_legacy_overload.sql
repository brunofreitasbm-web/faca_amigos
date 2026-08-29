-- Remove o overload legado de fa_checkin (15 parâmetros, sem p_device_id),
-- deixado no banco desde antes de 20260828210000_fa_print_jobs_origin_device.sql
-- ter adicionado esse parâmetro. O cliente (apps/kiosk-ui) sempre chama
-- fa_checkin passando p_device_id, então esse overload não é mais
-- alcançável — mas, por existir, também não recebeu o corte de venda de
-- planos 15min antes do fechamento (20260830000006), o que criava uma
-- inconsistência caso algo ainda o chamasse pela assinatura antiga.
drop function if exists public.fa_checkin(
  text, uuid, text, uuid, uuid, jsonb, jsonb, text, uuid,
  text, text[], boolean, uuid, int, uuid
);
