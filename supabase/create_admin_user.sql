-- Script para criar um colaborador Administrador com PIN 000000 no Supabase.
-- Executar no SQL Editor do Supabase Dashboard ou via CLI.

WITH new_auth_user AS (
  INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    is_super_admin,
    created_at,
    updated_at
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    gen_random_uuid(),
    'authenticated',
    'authenticated',
    'admin-' || substring(gen_random_uuid()::text from 1 for 8) || '@kiosk.internal',
    crypt('000000', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    FALSE,
    now(),
    now()
  )
  RETURNING id
),
new_employee AS (
  INSERT INTO fa_kiosk_employees (
    auth_user_id,
    full_name,
    role,
    active
  )
  SELECT
    id,
    'Administrador',
    'ADMIN',
    true
  FROM new_auth_user
  RETURNING id
)
INSERT INTO fa_kiosk_local_credentials (
  employee_id,
  pin_hash
)
SELECT
  id,
  crypt('000000', gen_salt('bf'))
FROM new_employee;
