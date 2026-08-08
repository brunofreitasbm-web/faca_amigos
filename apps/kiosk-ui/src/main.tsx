import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@facaamigos/ui/styles.css";
import "./app.css";
import { App } from "./App.js";
import { AppStateProvider } from "./state/AppState.js";
import { AuthProvider } from "./auth/AuthContext.js";
import { ToastProvider } from "./state/ToastContext.js";
import { ConfirmProvider } from "./state/ConfirmContext.js";
import { SystemStatusOverlay } from "./components/SystemStatusOverlay.js";
import { flushOfflineQueue } from "./lib/supabase/offlineQueue.js";
import { setupPwa } from "./pwa.js";

setupPwa();

window.addEventListener("online", () => void flushOfflineQueue());
setInterval(() => void flushOfflineQueue(), 30_000);
void flushOfflineQueue();

import { ErrorBoundary } from "./components/ErrorBoundary.js";

const container = document.getElementById("root");
if (!container) throw new Error("#root não encontrado");

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <ConfirmProvider>
          <AuthProvider>
            <AppStateProvider>
              <App />
            </AppStateProvider>
          </AuthProvider>
          <SystemStatusOverlay />
        </ConfirmProvider>
      </ToastProvider>
    </ErrorBoundary>
  </StrictMode>,
);
