-- Exclusão de veículos descontinuados: Fusca Amarelo e Jipe Rosa
delete from fa_kiosk_assets where name in ('Fusca Amarelo', 'Jipe Rosa');
