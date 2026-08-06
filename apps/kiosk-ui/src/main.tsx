import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@facaamigos/ui/styles.css";
import { App } from "./App.js";
import { AppStateProvider } from "./state/AppState.js";

const container = document.getElementById("root");
if (!container) throw new Error("#root não encontrado");

createRoot(container).render(
  <StrictMode>
    <AppStateProvider>
      <App />
    </AppStateProvider>
  </StrictMode>,
);
