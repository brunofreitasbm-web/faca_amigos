-- Semeia as chaves de API para a integração do shopping Bosque Grão-Pará
-- (/integracao/shopping/v1/*) para a plataforma Esphera / Napp.

insert into fa_shopping_api_keys (unit_id, key_hash, label)
values
  (
    '5fc99a57-81ee-4232-a105-1fcb4634cef4',
    encode(extensions.digest('fa_shp_graopara_homolog_4a5b6c7d', 'sha256'), 'hex'),
    'Playground (Bosque Grão-Pará) — homologação'
  ),
  (
    '5fc99a57-81ee-4232-a105-1fcb4634cef4',
    encode(extensions.digest('fa_shp_prod_graopara_2e4d6f8a', 'sha256'), 'hex'),
    'Playground (Bosque Grão-Pará) — produção'
  )
on conflict (key_hash) do nothing;
