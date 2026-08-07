-- Script idempotente para garantir/redefinir um colaborador Administrador com PIN 000000 no Supabase.
-- Executar no SQL Editor do Supabase Dashboard (https://supabase.com/dashboard/project/ivjvpdzsfjdpyabbzzuj/sql).

DO $$
DECLARE
  v_user_id uuid;
  v_emp_id uuid;
BEGIN
  -- 1. Obter ou criar usuário em auth.users
  SELECT auth_user_id INTO v_user_id
  FROM fa_kiosk_employees
  WHERE role = 'ADMIN' AND auth_user_id IS NOT NULL
  LIMIT 1;

  IF v_user_id IS NULL THEN
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, is_super_admin, created_at, updated_at
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
      'admin-dev@kiosk.internal', crypt('000000', gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', '{}', FALSE, now(), now()
    ) RETURNING id INTO v_user_id;
  ELSE
    UPDATE auth.users SET encrypted_password = crypt('000000', gen_salt('bf')) WHERE id = v_user_id;
  END IF;

  -- 2. Obter ou criar colaborador em fa_kiosk_employees
  SELECT id INTO v_emp_id
  FROM fa_kiosk_employees
  WHERE role = 'ADMIN'
  LIMIT 1;

  IF v_emp_id IS NULL THEN
    INSERT INTO fa_kiosk_employees (auth_user_id, full_name, role, active)
    VALUES (v_user_id, 'Admin Dev', 'ADMIN', true)
    RETURNING id INTO v_emp_id;
  ELSE
    UPDATE fa_kiosk_employees
    SET auth_user_id = v_user_id, active = true
    WHERE id = v_emp_id;
  END IF;

  -- 3. Inserir ou atualizar credenciais de PIN (000000)
  INSERT INTO fa_kiosk_local_credentials (employee_id, pin_hash)
  VALUES (v_emp_id, crypt('000000', gen_salt('bf')))
  ON CONFLICT (employee_id) DO UPDATE
  SET pin_hash = crypt('000000', gen_salt('bf'));

  RAISE NOTICE 'PIN 000000 configurado com sucesso para o colaborador admin ID: %', v_emp_id;
END $$;
