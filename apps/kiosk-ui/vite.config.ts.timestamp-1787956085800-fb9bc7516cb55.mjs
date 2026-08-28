// vite.config.ts
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { defineConfig } from "file:///C:/Users/bruno/Documents/Projetos/Fa%C3%A7a%20Amigos/node_modules/.pnpm/vite@5.4.21_@types+node@22.20.1_terser@5.49.2/node_modules/vite/dist/node/index.js";
import react from "file:///C:/Users/bruno/Documents/Projetos/Fa%C3%A7a%20Amigos/node_modules/.pnpm/@vitejs+plugin-react@4.7.0__36b21331fa31dbba8460d2d93d1ba4e0/node_modules/@vitejs/plugin-react/dist/index.js";
import { VitePWA } from "file:///C:/Users/bruno/Documents/Projetos/Fa%C3%A7a%20Amigos/node_modules/.pnpm/vite-plugin-pwa@0.20.5_supp_fcc297c93f52da1cb69e10d9ceaee287/node_modules/vite-plugin-pwa/dist/index.js";
var __vite_injected_original_import_meta_url = "file:///C:/Users/bruno/Documents/Projetos/Fa%C3%A7a%20Amigos/apps/kiosk-ui/vite.config.ts";
var kioskPackageJson = fileURLToPath(new URL("../kiosk/package.json", __vite_injected_original_import_meta_url));
var appVersion = JSON.parse(readFileSync(kioskPackageJson, "utf-8")).version;
function shortSha() {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: fileURLToPath(new URL(".", __vite_injected_original_import_meta_url)) }).toString().trim();
  } catch {
    return "dev";
  }
}
var vite_config_default = defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __BUILD_SHA__: JSON.stringify(shortSha())
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: null,
      includeAssets: ["favicon.png", "icons/apple-touch-icon.png"],
      manifest: {
        id: "/",
        name: "Fa\xE7aAmigos",
        short_name: "Fa\xE7aAmigos",
        description: "Playground Inclusivo \u2014 opera\xE7\xE3o",
        lang: "pt-BR",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "any",
        theme_color: "#F0196B",
        background_color: "#141414",
        icons: [
          { src: "/icons/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ]
      },
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // Handler de Web Push (alerta em segundo plano do painel do
        // responsável) — generateSW não permite eventos custom no config,
        // então isso injeta um importScripts() apontando pro arquivo em
        // public/push-sw.js dentro do sw.js gerado.
        importScripts: ["push-sw.js"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/ws/],
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // Google Fonts em runtime cache (offline após o primeiro load).
        // Sem handler para *.supabase.co de propósito: auth/realtime/RPC
        // passam direto, nunca cacheados.
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/,
            handler: "StaleWhileRevalidate",
            options: { cacheName: "google-fonts-css" }
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-woff",
              expiration: { maxEntries: 20, maxAgeSeconds: 31536e3 },
              cacheableResponse: { statuses: [0, 200] }
            }
          }
        ]
      }
    })
  ],
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:7317",
      "/ws": { target: "ws://127.0.0.1:7317", ws: true }
    }
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJDOlxcXFxVc2Vyc1xcXFxicnVub1xcXFxEb2N1bWVudHNcXFxcUHJvamV0b3NcXFxcRmFcdTAwRTdhIEFtaWdvc1xcXFxhcHBzXFxcXGtpb3NrLXVpXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCJDOlxcXFxVc2Vyc1xcXFxicnVub1xcXFxEb2N1bWVudHNcXFxcUHJvamV0b3NcXFxcRmFcdTAwRTdhIEFtaWdvc1xcXFxhcHBzXFxcXGtpb3NrLXVpXFxcXHZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9DOi9Vc2Vycy9icnVuby9Eb2N1bWVudHMvUHJvamV0b3MvRmElQzMlQTdhJTIwQW1pZ29zL2FwcHMva2lvc2stdWkvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyByZWFkRmlsZVN5bmMgfSBmcm9tIFwibm9kZTpmc1wiO1xuaW1wb3J0IHsgZXhlY1N5bmMgfSBmcm9tIFwibm9kZTpjaGlsZF9wcm9jZXNzXCI7XG5pbXBvcnQgeyBmaWxlVVJMVG9QYXRoIH0gZnJvbSBcIm5vZGU6dXJsXCI7XG5pbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tIFwidml0ZVwiO1xuaW1wb3J0IHJlYWN0IGZyb20gXCJAdml0ZWpzL3BsdWdpbi1yZWFjdFwiO1xuaW1wb3J0IHsgVml0ZVBXQSB9IGZyb20gXCJ2aXRlLXBsdWdpbi1wd2FcIjtcblxuLy8gVmVyc1x1MDBFM28gZXhpYmlkYSBubyBiYWRnZSBkaXNjcmV0byAoVmVyc2lvbkJhZGdlLnRzeCk6IHVzYSBhIG1lc21hIHZlcnNcdTAwRTNvXG4vLyBkbyBhcHBzL2tpb3NrIChvIG5cdTAwRkFtZXJvIHF1ZSBkZSBmYXRvIFx1MDBFOSBidW1wYWRvIGEgY2FkYSByZWxlYXNlLCB2ZXJcbi8vIHNjcmlwdHMvcmVsZWFzZS1raW9zay5tanMpIFx1MjAxNCBraW9zay11aSBuXHUwMEUzbyB0ZW0gdmVyc2lvbmFtZW50byBwclx1MDBGM3ByaW8uXG5jb25zdCBraW9za1BhY2thZ2VKc29uID0gZmlsZVVSTFRvUGF0aChuZXcgVVJMKFwiLi4va2lvc2svcGFja2FnZS5qc29uXCIsIGltcG9ydC5tZXRhLnVybCkpO1xuY29uc3QgYXBwVmVyc2lvbiA9IEpTT04ucGFyc2UocmVhZEZpbGVTeW5jKGtpb3NrUGFja2FnZUpzb24sIFwidXRmLThcIikpLnZlcnNpb24gYXMgc3RyaW5nO1xuXG5mdW5jdGlvbiBzaG9ydFNoYSgpOiBzdHJpbmcge1xuICB0cnkge1xuICAgIHJldHVybiBleGVjU3luYyhcImdpdCByZXYtcGFyc2UgLS1zaG9ydCBIRUFEXCIsIHsgY3dkOiBmaWxlVVJMVG9QYXRoKG5ldyBVUkwoXCIuXCIsIGltcG9ydC5tZXRhLnVybCkpIH0pXG4gICAgICAudG9TdHJpbmcoKVxuICAgICAgLnRyaW0oKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIFwiZGV2XCI7XG4gIH1cbn1cblxuLy8gRDEgZG8gcGxhbm86IG1lc21hIFNQQSBwYXJhIG8gRWxlY3Ryb24gKDEyNy4wLjAuMTo3MzE3KSBlIHBhcmEgb3Ncbi8vIHRhYmxldHMgZGEgTEFOLiBFbSBkZXYsIG8gcHJveHkgZXZpdGEgQ09SUyBlbnRyZSBvIFZpdGUgKDUxNzMpIGUgb1xuLy8gc2Vydmlkb3IgRmFzdGlmeSBsb2NhbCAoYXBwcy9raW9zaykuXG4vL1xuLy8gUFdBOiBvIGRlcGxveSBkYSBWZXJjZWwgKEhUVFBTKSBcdTAwRTkgbyBxdWUgb3MgY2VsdWxhcmVzL3RhYmxldHMgaW5zdGFsYW0uXG4vLyBPIHNlcnZpY2Ugd29ya2VyIFx1MDBFOSByZWdpc3RyYWRvIG1hbnVhbG1lbnRlIGVtIHNyYy9wd2EudHMgXHUyMDE0IE5VTkNBIG5hXG4vLyBvcmlnZW0gbG9jYWwgZG8gRWxlY3Ryb24gKDEyNy4wLjAuMSBcdTAwRTkgc2VjdXJlIGNvbnRleHQgZSBvIFNXIGNvbmdlbGFyaWFcbi8vIHVtYSBzaGVsbCBhbnRpZ2Egbm8gZGVza3RvcCBhcFx1MDBGM3MgdXBkYXRlcykuXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xuICBkZWZpbmU6IHtcbiAgICBfX0FQUF9WRVJTSU9OX186IEpTT04uc3RyaW5naWZ5KGFwcFZlcnNpb24pLFxuICAgIF9fQlVJTERfU0hBX186IEpTT04uc3RyaW5naWZ5KHNob3J0U2hhKCkpLFxuICB9LFxuICBwbHVnaW5zOiBbXG4gICAgcmVhY3QoKSxcbiAgICBWaXRlUFdBKHtcbiAgICAgIHJlZ2lzdGVyVHlwZTogXCJhdXRvVXBkYXRlXCIsXG4gICAgICBpbmplY3RSZWdpc3RlcjogbnVsbCxcbiAgICAgIGluY2x1ZGVBc3NldHM6IFtcImZhdmljb24ucG5nXCIsIFwiaWNvbnMvYXBwbGUtdG91Y2gtaWNvbi5wbmdcIl0sXG4gICAgICBtYW5pZmVzdDoge1xuICAgICAgICBpZDogXCIvXCIsXG4gICAgICAgIG5hbWU6IFwiRmFcdTAwRTdhQW1pZ29zXCIsXG4gICAgICAgIHNob3J0X25hbWU6IFwiRmFcdTAwRTdhQW1pZ29zXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIlBsYXlncm91bmQgSW5jbHVzaXZvIFx1MjAxNCBvcGVyYVx1MDBFN1x1MDBFM29cIixcbiAgICAgICAgbGFuZzogXCJwdC1CUlwiLFxuICAgICAgICBzdGFydF91cmw6IFwiL1wiLFxuICAgICAgICBzY29wZTogXCIvXCIsXG4gICAgICAgIGRpc3BsYXk6IFwic3RhbmRhbG9uZVwiLFxuICAgICAgICBvcmllbnRhdGlvbjogXCJhbnlcIixcbiAgICAgICAgdGhlbWVfY29sb3I6IFwiI0YwMTk2QlwiLFxuICAgICAgICBiYWNrZ3JvdW5kX2NvbG9yOiBcIiMxNDE0MTRcIixcbiAgICAgICAgaWNvbnM6IFtcbiAgICAgICAgICB7IHNyYzogXCIvaWNvbnMvcHdhLTE5Mi5wbmdcIiwgc2l6ZXM6IFwiMTkyeDE5MlwiLCB0eXBlOiBcImltYWdlL3BuZ1wiIH0sXG4gICAgICAgICAgeyBzcmM6IFwiL2ljb25zL3B3YS01MTIucG5nXCIsIHNpemVzOiBcIjUxMng1MTJcIiwgdHlwZTogXCJpbWFnZS9wbmdcIiB9LFxuICAgICAgICAgIHsgc3JjOiBcIi9pY29ucy9tYXNrYWJsZS01MTIucG5nXCIsIHNpemVzOiBcIjUxMng1MTJcIiwgdHlwZTogXCJpbWFnZS9wbmdcIiwgcHVycG9zZTogXCJtYXNrYWJsZVwiIH0sXG4gICAgICAgIF0sXG4gICAgICB9LFxuICAgICAgd29ya2JveDoge1xuICAgICAgICBza2lwV2FpdGluZzogdHJ1ZSxcbiAgICAgICAgY2xpZW50c0NsYWltOiB0cnVlLFxuICAgICAgICBjbGVhbnVwT3V0ZGF0ZWRDYWNoZXM6IHRydWUsXG4gICAgICAgIC8vIEhhbmRsZXIgZGUgV2ViIFB1c2ggKGFsZXJ0YSBlbSBzZWd1bmRvIHBsYW5vIGRvIHBhaW5lbCBkb1xuICAgICAgICAvLyByZXNwb25zXHUwMEUxdmVsKSBcdTIwMTQgZ2VuZXJhdGVTVyBuXHUwMEUzbyBwZXJtaXRlIGV2ZW50b3MgY3VzdG9tIG5vIGNvbmZpZyxcbiAgICAgICAgLy8gZW50XHUwMEUzbyBpc3NvIGluamV0YSB1bSBpbXBvcnRTY3JpcHRzKCkgYXBvbnRhbmRvIHBybyBhcnF1aXZvIGVtXG4gICAgICAgIC8vIHB1YmxpYy9wdXNoLXN3LmpzIGRlbnRybyBkbyBzdy5qcyBnZXJhZG8uXG4gICAgICAgIGltcG9ydFNjcmlwdHM6IFtcInB1c2gtc3cuanNcIl0sXG4gICAgICAgIG5hdmlnYXRlRmFsbGJhY2s6IFwiL2luZGV4Lmh0bWxcIixcbiAgICAgICAgbmF2aWdhdGVGYWxsYmFja0RlbnlsaXN0OiBbL15cXC9hcGlcXC8vLCAvXlxcL3dzL10sXG4gICAgICAgIGdsb2JQYXR0ZXJuczogW1wiKiovKi57anMsY3NzLGh0bWwsc3ZnLHBuZyx3b2ZmMn1cIl0sXG4gICAgICAgIG1heGltdW1GaWxlU2l6ZVRvQ2FjaGVJbkJ5dGVzOiA0ICogMTAyNCAqIDEwMjQsXG4gICAgICAgIC8vIEdvb2dsZSBGb250cyBlbSBydW50aW1lIGNhY2hlIChvZmZsaW5lIGFwXHUwMEYzcyBvIHByaW1laXJvIGxvYWQpLlxuICAgICAgICAvLyBTZW0gaGFuZGxlciBwYXJhICouc3VwYWJhc2UuY28gZGUgcHJvcFx1MDBGM3NpdG86IGF1dGgvcmVhbHRpbWUvUlBDXG4gICAgICAgIC8vIHBhc3NhbSBkaXJldG8sIG51bmNhIGNhY2hlYWRvcy5cbiAgICAgICAgcnVudGltZUNhY2hpbmc6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICB1cmxQYXR0ZXJuOiAvXmh0dHBzOlxcL1xcL2ZvbnRzXFwuZ29vZ2xlYXBpc1xcLmNvbVxcLy4qLyxcbiAgICAgICAgICAgIGhhbmRsZXI6IFwiU3RhbGVXaGlsZVJldmFsaWRhdGVcIixcbiAgICAgICAgICAgIG9wdGlvbnM6IHsgY2FjaGVOYW1lOiBcImdvb2dsZS1mb250cy1jc3NcIiB9LFxuICAgICAgICAgIH0sXG4gICAgICAgICAge1xuICAgICAgICAgICAgdXJsUGF0dGVybjogL15odHRwczpcXC9cXC9mb250c1xcLmdzdGF0aWNcXC5jb21cXC8uKi8sXG4gICAgICAgICAgICBoYW5kbGVyOiBcIkNhY2hlRmlyc3RcIixcbiAgICAgICAgICAgIG9wdGlvbnM6IHtcbiAgICAgICAgICAgICAgY2FjaGVOYW1lOiBcImdvb2dsZS1mb250cy13b2ZmXCIsXG4gICAgICAgICAgICAgIGV4cGlyYXRpb246IHsgbWF4RW50cmllczogMjAsIG1heEFnZVNlY29uZHM6IDMxNTM2MDAwIH0sXG4gICAgICAgICAgICAgIGNhY2hlYWJsZVJlc3BvbnNlOiB7IHN0YXR1c2VzOiBbMCwgMjAwXSB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgfSxcbiAgICB9KSxcbiAgXSxcbiAgc2VydmVyOiB7XG4gICAgaG9zdDogdHJ1ZSxcbiAgICBwb3J0OiA1MTczLFxuICAgIHByb3h5OiB7XG4gICAgICBcIi9hcGlcIjogXCJodHRwOi8vMTI3LjAuMC4xOjczMTdcIixcbiAgICAgIFwiL3dzXCI6IHsgdGFyZ2V0OiBcIndzOi8vMTI3LjAuMC4xOjczMTdcIiwgd3M6IHRydWUgfSxcbiAgICB9LFxuICB9LFxufSk7XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQTBYLFNBQVMsb0JBQW9CO0FBQ3ZaLFNBQVMsZ0JBQWdCO0FBQ3pCLFNBQVMscUJBQXFCO0FBQzlCLFNBQVMsb0JBQW9CO0FBQzdCLE9BQU8sV0FBVztBQUNsQixTQUFTLGVBQWU7QUFMcU4sSUFBTSwyQ0FBMkM7QUFVOVIsSUFBTSxtQkFBbUIsY0FBYyxJQUFJLElBQUkseUJBQXlCLHdDQUFlLENBQUM7QUFDeEYsSUFBTSxhQUFhLEtBQUssTUFBTSxhQUFhLGtCQUFrQixPQUFPLENBQUMsRUFBRTtBQUV2RSxTQUFTLFdBQW1CO0FBQzFCLE1BQUk7QUFDRixXQUFPLFNBQVMsOEJBQThCLEVBQUUsS0FBSyxjQUFjLElBQUksSUFBSSxLQUFLLHdDQUFlLENBQUMsRUFBRSxDQUFDLEVBQ2hHLFNBQVMsRUFDVCxLQUFLO0FBQUEsRUFDVixRQUFRO0FBQ04sV0FBTztBQUFBLEVBQ1Q7QUFDRjtBQVVBLElBQU8sc0JBQVEsYUFBYTtBQUFBLEVBQzFCLFFBQVE7QUFBQSxJQUNOLGlCQUFpQixLQUFLLFVBQVUsVUFBVTtBQUFBLElBQzFDLGVBQWUsS0FBSyxVQUFVLFNBQVMsQ0FBQztBQUFBLEVBQzFDO0FBQUEsRUFDQSxTQUFTO0FBQUEsSUFDUCxNQUFNO0FBQUEsSUFDTixRQUFRO0FBQUEsTUFDTixjQUFjO0FBQUEsTUFDZCxnQkFBZ0I7QUFBQSxNQUNoQixlQUFlLENBQUMsZUFBZSw0QkFBNEI7QUFBQSxNQUMzRCxVQUFVO0FBQUEsUUFDUixJQUFJO0FBQUEsUUFDSixNQUFNO0FBQUEsUUFDTixZQUFZO0FBQUEsUUFDWixhQUFhO0FBQUEsUUFDYixNQUFNO0FBQUEsUUFDTixXQUFXO0FBQUEsUUFDWCxPQUFPO0FBQUEsUUFDUCxTQUFTO0FBQUEsUUFDVCxhQUFhO0FBQUEsUUFDYixhQUFhO0FBQUEsUUFDYixrQkFBa0I7QUFBQSxRQUNsQixPQUFPO0FBQUEsVUFDTCxFQUFFLEtBQUssc0JBQXNCLE9BQU8sV0FBVyxNQUFNLFlBQVk7QUFBQSxVQUNqRSxFQUFFLEtBQUssc0JBQXNCLE9BQU8sV0FBVyxNQUFNLFlBQVk7QUFBQSxVQUNqRSxFQUFFLEtBQUssMkJBQTJCLE9BQU8sV0FBVyxNQUFNLGFBQWEsU0FBUyxXQUFXO0FBQUEsUUFDN0Y7QUFBQSxNQUNGO0FBQUEsTUFDQSxTQUFTO0FBQUEsUUFDUCxhQUFhO0FBQUEsUUFDYixjQUFjO0FBQUEsUUFDZCx1QkFBdUI7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLFFBS3ZCLGVBQWUsQ0FBQyxZQUFZO0FBQUEsUUFDNUIsa0JBQWtCO0FBQUEsUUFDbEIsMEJBQTBCLENBQUMsWUFBWSxPQUFPO0FBQUEsUUFDOUMsY0FBYyxDQUFDLGtDQUFrQztBQUFBLFFBQ2pELCtCQUErQixJQUFJLE9BQU87QUFBQTtBQUFBO0FBQUE7QUFBQSxRQUkxQyxnQkFBZ0I7QUFBQSxVQUNkO0FBQUEsWUFDRSxZQUFZO0FBQUEsWUFDWixTQUFTO0FBQUEsWUFDVCxTQUFTLEVBQUUsV0FBVyxtQkFBbUI7QUFBQSxVQUMzQztBQUFBLFVBQ0E7QUFBQSxZQUNFLFlBQVk7QUFBQSxZQUNaLFNBQVM7QUFBQSxZQUNULFNBQVM7QUFBQSxjQUNQLFdBQVc7QUFBQSxjQUNYLFlBQVksRUFBRSxZQUFZLElBQUksZUFBZSxRQUFTO0FBQUEsY0FDdEQsbUJBQW1CLEVBQUUsVUFBVSxDQUFDLEdBQUcsR0FBRyxFQUFFO0FBQUEsWUFDMUM7QUFBQSxVQUNGO0FBQUEsUUFDRjtBQUFBLE1BQ0Y7QUFBQSxJQUNGLENBQUM7QUFBQSxFQUNIO0FBQUEsRUFDQSxRQUFRO0FBQUEsSUFDTixNQUFNO0FBQUEsSUFDTixNQUFNO0FBQUEsSUFDTixPQUFPO0FBQUEsTUFDTCxRQUFRO0FBQUEsTUFDUixPQUFPLEVBQUUsUUFBUSx1QkFBdUIsSUFBSSxLQUFLO0FBQUEsSUFDbkQ7QUFBQSxFQUNGO0FBQ0YsQ0FBQzsiLAogICJuYW1lcyI6IFtdCn0K
