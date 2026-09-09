-- Migration de Blindagem e Hardening de Segurança (Search Path em Funções SECURITY DEFINER)
-- Garantia de prevenção contra sequestro de esquema (schema search_path hijacking) em funções com SECURITY DEFINER.

DO $$
DECLARE
    r RECORD;
BEGIN
    -- Atualizar search_path para funções com SECURITY DEFINER no esquema 'public'
    FOR r IN 
        SELECT p.proname, pg_get_function_identity_arguments(p.oid) as args
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' 
          AND p.prosecdef = true
    LOOP
        EXECUTE format('ALTER FUNCTION public.%I(%s) SET search_path = public, pg_temp;', r.proname, r.args);
    END LOOP;
END $$;
