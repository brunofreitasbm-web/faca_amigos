"use client";

import { useActionState } from "react";
import { signIn } from "./actions";

export default function LoginPage() {
  const [error, formAction, pending] = useActionState(signIn, undefined);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <form
        action={formAction}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          width: 320,
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: 24,
        }}
      >
        <h1 style={{ fontSize: 18, margin: "0 0 8px" }}>FaçaAmigos — Back-office</h1>
        <p style={{ fontSize: 13, color: "var(--text-muted, #888)", margin: "0 0 4px" }}>
          Painel de gestão — use o e-mail e senha da sua conta de colaborador.
        </p>
        <input name="email" type="email" placeholder="E-mail" required autoComplete="email" />
        <input
          name="password"
          type="password"
          placeholder="Senha"
          required
          autoComplete="current-password"
        />
        {error && <p style={{ color: "#ff6b6b", fontSize: 13, margin: 0 }}>{error}</p>}
        <button type="submit" disabled={pending}>
          {pending ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </main>
  );
}
