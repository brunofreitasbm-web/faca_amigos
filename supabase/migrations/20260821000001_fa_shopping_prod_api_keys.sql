-- Semeia as chaves de API de produção para a integração do shopping
-- (/integracao/shopping/v1/*) para Playground e Parque Circuito.

insert into fa_shopping_api_keys (unit_id, key_hash, label)
values
  (
    '11111111-1111-1111-1111-111111111111',
    encode(extensions.digest('fa_shp_prod_playground_9a8f7e6d', 'sha256'), 'hex'),
    'Playground (Parque Shopping) — produção'
  ),
  (
    'e43ba7a8-bd5f-47ad-b81d-dae7ea19d504',
    encode(extensions.digest('fa_shp_prod_circuito_3b2c1a0f', 'sha256'), 'hex'),
    'Parque Circuito — produção'
  )
on conflict (key_hash) do nothing;
