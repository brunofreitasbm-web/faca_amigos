import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// D1 do plano: mesma SPA para o Electron (127.0.0.1:7317) e para os
// tablets da LAN. Em dev, o proxy evita CORS entre o Vite (5173) e o
// servidor Fastify local (apps/kiosk).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:7317",
      "/ws": { target: "ws://127.0.0.1:7317", ws: true },
    },
  },
});
