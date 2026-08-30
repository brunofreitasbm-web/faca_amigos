import type { ReactNode } from "react";
import { Card, HelpText } from "@facaamigos/ui";
import { useAuth } from "./AuthContext.js";
import type { Capability } from "./capabilities.js";

/**
 * Guarda um bloco de UI atrás de uma capacidade.
 *
 * Usar isto E filtrar o menu: as duas coisas, não uma. Só esconder o botão
 * deixa a tela alcançável por qualquer estado residual (um `setScreen`
 * antigo, um colaborador que trocou sem recarregar a página); só guardar
 * sem esconder mostra ao Operador uma porta que não abre.
 *
 * Nenhum dos dois é segurança — ver o comentário em AuthContext.tsx.
 */
export function RequireCapability({
  capability,
  children,
  fallback,
}: {
  /** Uma capacidade, ou uma lista — lista é "qualquer uma delas" (OR), não todas. */
  capability: Capability | Capability[];
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { can, loading } = useAuth();

  // Enquanto carrega, nega. Renderizar o conteúdo "só por um instante" até
  // as capacidades chegarem é exatamente o flash que se quer evitar.
  if (loading) {
    return (
      <div style={{ padding: "48px", textAlign: "center", color: "var(--text-muted)" }}>Carregando…</div>
    );
  }

  const allowed = Array.isArray(capability) ? capability.some((c) => can(c)) : can(capability);

  if (!allowed) {
    if (fallback !== undefined) return <>{fallback}</>;
    return (
      <div style={{ padding: "48px", maxWidth: "480px", margin: "0 auto" }}>
        <Card style={{ padding: "24px", textAlign: "center" }}>
          <h2 style={{ fontFamily: "var(--font-display)", marginTop: 0 }}>Área restrita</h2>
          {/* Sem detalhar qual permissão falta: a mensagem não deve servir
              de mapa da superfície administrativa para quem não tem acesso. */}
          <HelpText>
            Você não tem acesso a esta área. Se precisar, peça ao proprietário para liberar.
          </HelpText>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}

/** Versão inline, para esconder um botão de salvar dentro de uma aba. */
export function IfCan({ capability, children }: { capability: Capability; children: ReactNode }) {
  const { can } = useAuth();
  return can(capability) ? <>{children}</> : null;
}
