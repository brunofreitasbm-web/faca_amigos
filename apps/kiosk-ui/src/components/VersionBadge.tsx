// __APP_VERSION__/__BUILD_SHA__ são injetadas em build-time pelo `define`
// em vite.config.ts (tipadas em vite-env.d.ts) — funciona tanto no bundle
// empacotado no Electron quanto no deploy PWA da Vercel, já que os dois
// consomem o mesmo bundle JS gerado por este build.
export function VersionBadge() {
  return (
    <div
      style={{
        position: "fixed",
        bottom: "6px",
        right: "8px",
        zIndex: 1,
        fontSize: "10px",
        fontFamily: "var(--font-body)",
        color: "var(--text-muted)",
        opacity: 0.5,
        pointerEvents: "none",
        userSelect: "none",
      }}
    >
      v{__APP_VERSION__} · {__BUILD_SHA__}
    </div>
  );
}
