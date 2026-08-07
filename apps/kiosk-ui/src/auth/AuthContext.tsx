import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { supabase } from "../lib/supabase/client.js";
import type { Capability } from "./capabilities.js";

/**
 * Capacidades do colaborador logado, lidas da view `fa_kiosk_my_capabilities`.
 *
 * ⚠️ Nada aqui é segurança. Esta camada existe só para não mostrar ao
 * Operador uma porta que não abre — qualquer pessoa pode editar o estado no
 * navegador e revelar a tela. O que de fato protege são as policies de RLS e
 * as RPCs `fa_config_*`, que checam `fa_kiosk_can()` no servidor a cada
 * chamada. Se esta camada e o servidor divergirem, o servidor ganha, e o
 * sintoma é um erro "sem permissão" na tela — nunca um vazamento.
 */
interface AuthValue {
  capabilities: ReadonlySet<Capability>;
  can: (capability: Capability) => boolean;
  /** true enquanto as capacidades da sessão atual ainda não chegaram. */
  loading: boolean;
  /** Reconsulta — usado depois de um login por PIN dentro de um gate. */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

async function fetchCapabilities(): Promise<Set<Capability>> {
  const { data, error } = await supabase().from("fa_kiosk_my_capabilities").select("capability");
  // Falha de rede não pode liberar nada: conjunto vazio = nenhum acesso.
  if (error || !data) return new Set();
  return new Set(data.map((row: { capability: string }) => row.capability as Capability));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [capabilities, setCapabilities] = useState<ReadonlySet<Capability>>(new Set());
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data } = await supabase().auth.getSession();
    if (!data.session) {
      setCapabilities(new Set());
      setLoading(false);
      return;
    }
    setCapabilities(await fetchCapabilities());
    setLoading(false);
  }, []);

  useEffect(() => {
    // Reagir a onAuthStateChange (e não só carregar uma vez) é o que faz
    // trocar de colaborador no terminal trocar de fato as permissões — sem
    // isso, o Owner que saiu deixaria o menu Configurações aberto para o
    // Operador que entrou depois.
    const { data: subscription } = supabase().auth.onAuthStateChange((_event, session) => {
      if (!session) {
        setCapabilities(new Set());
        setLoading(false);
        return;
      }
      setLoading(true);
      void fetchCapabilities().then((caps) => {
        setCapabilities(caps);
        setLoading(false);
      });
    });

    void refresh();
    return () => subscription.subscription.unsubscribe();
  }, [refresh]);

  const value = useMemo<AuthValue>(
    () => ({
      capabilities,
      can: (capability: Capability) => capabilities.has(capability),
      loading,
      refresh,
    }),
    [capabilities, loading, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth precisa estar dentro de <AuthProvider>");
  return ctx;
}

/** Atalho para o caso comum de só querer o booleano. */
export function useCan(capability: Capability): boolean {
  return useAuth().can(capability);
}
