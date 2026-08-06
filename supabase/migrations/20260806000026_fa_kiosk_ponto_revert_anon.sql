-- Reverte, só nas tabelas de colaborador/ponto, o acesso anônimo liberado
-- "temporariamente" pela migration 20260806000016_fa_kiosk_temp_anon_read.
-- Motivo: com o login real voltando a ser exigido para bater ponto e para
-- cadastrar colaborador (ver EmployeeAuthGate no kiosk-ui), dado
-- trabalhista/PII (CPF, PIS, marcações de ponto) não pode continuar
-- legível por um cliente sem sessão nenhuma (`anon`).
--
-- O restante do acesso anônimo liberado na migration 16 (check-in, PDV,
-- caixa etc.) permanece intencionalmente fora deste escopo — é dívida de
-- segurança conhecida e já rastreada à parte, não resolvida aqui.

drop policy if exists fa_kiosk_read_anon_temp on fa_kiosk_employees;
drop policy if exists fa_kiosk_read_anon_temp on fa_kiosk_local_credentials;
drop policy if exists fa_kiosk_read_anon_temp on fa_kiosk_ponto_records;
drop policy if exists fa_kiosk_read_anon_temp on fa_kiosk_audit_log;
