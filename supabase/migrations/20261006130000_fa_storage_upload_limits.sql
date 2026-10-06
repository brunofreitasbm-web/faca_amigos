-- Uploads de imagem passam a sair do kiosk-ui como WebP (fallback JPEG), então
-- os buckets abaixo (antes sem restrição) aceitam WebP além de JPEG/PNG/HEIC e
-- ganham teto de tamanho igual ao do cliente (8 MiB). HEIC/HEIF continuam
-- aceitos porque o app os armazena como vieram. `ocorrencia-documentos` também
-- recebe PDF (anexo de atestado). Só afeta uploads novos.
update storage.buckets
  set file_size_limit = 8388608, -- 8 MiB
      allowed_mime_types = array['image/webp', 'image/jpeg', 'image/png', 'image/heic', 'image/heif']
  where id in ('ponto-fotos', 'crianca-fotos');

update storage.buckets
  set file_size_limit = 8388608, -- 8 MiB
      allowed_mime_types = array['image/webp', 'image/jpeg', 'image/png', 'image/heic', 'image/heif', 'application/pdf']
  where id = 'ocorrencia-documentos';
