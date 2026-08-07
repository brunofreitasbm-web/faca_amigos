-- Fase 1 do plano fiscal: identificação do CONSUMIDOR na NFC-e.
--
-- O PDV hoje não tem cliente nenhum: `fa_create_pdv_order` recebe só itens e
-- pagamentos, e `fa_kiosk_orders` não guarda ninguém. Não havia onde gravar a
-- resposta do clássico "CPF na nota?".
--
-- Na NFC-e, consumidor não identificado é o caso NORMAL — a nota é válida sem
-- destinatário. Por isso os três campos abaixo são opcionais e a UI pede no
-- máximo CPF e e-mail. Nada de formulário de endereço no balcão: atrasa o
-- atendimento e a SEFAZ não exige.

alter table fa_kiosk_orders add column if not exists fiscal_cpf text;
alter table fa_kiosk_orders add column if not exists fiscal_nome text;
alter table fa_kiosk_orders add column if not exists fiscal_email text;

-- Em fa_kiosk_guardians só falta e-mail (nome, telefone e CPF já existem),
-- para conseguir enviar a nota ao responsável quando a venda estiver ligada
-- a um cadastro.
alter table fa_kiosk_guardians add column if not exists email text;
