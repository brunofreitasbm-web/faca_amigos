-- Exclusão de veículos descontinuados: Fusca Amarelo e Jipe Rosa
update fa_kiosk_sessions set asset_id = null where asset_id in (select id from fa_kiosk_assets where name in ('Fusca Amarelo', 'Jipe Rosa'));
delete from fa_kiosk_assets where name in ('Fusca Amarelo', 'Jipe Rosa');
