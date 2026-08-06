import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@facaamigos/ui/styles.css";
import { App } from "./App.js";
import { AppStateProvider } from "./state/AppState.js";
import { SystemStatusOverlay } from "./components/SystemStatusOverlay.js";
import { flushOfflineQueue } from "./lib/supabase/offlineQueue.js";

window.addEventListener("online", () => void flushOfflineQueue());
setInterval(() => void flushOfflineQueue(), 30_000);
void flushOfflineQueue();

const container = document.getElementById("root");
if (!container) throw new Error("#root não encontrado");

createRoot(container).render(
  <StrictMode>
    <AppStateProvider>
      <App />
    </AppStateProvider>
    <SystemStatusOverlay />
  </StrictMode>,
);
