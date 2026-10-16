// vite.config.ts
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { defineConfig } from "file:///C:/Users/bruno/Documents/Projetos/APP%20PLAYFa%C3%A7a%20Amigos/node_modules/.pnpm/vite@5.4.21_@types+node@22.20.1_terser@5.49.2/node_modules/vite/dist/node/index.js";
import react from "file:///C:/Users/bruno/Documents/Projetos/APP%20PLAYFa%C3%A7a%20Amigos/node_modules/.pnpm/@vitejs+plugin-react@4.7.0__36b21331fa31dbba8460d2d93d1ba4e0/node_modules/@vitejs/plugin-react/dist/index.js";
import { VitePWA } from "file:///C:/Users/bruno/Documents/Projetos/APP%20PLAYFa%C3%A7a%20Amigos/node_modules/.pnpm/vite-plugin-pwa@0.20.5_supp_fcc297c93f52da1cb69e10d9ceaee287/node_modules/vite-plugin-pwa/dist/index.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
var __vite_injected_original_import_meta_url = "file:///C:/Users/bruno/Documents/Projetos/APP%20PLAYFa%C3%A7a%20Amigos/apps/kiosk-ui/vite.config.ts";
var kioskPackageJson = fileURLToPath(new URL("../kiosk/package.json", __vite_injected_original_import_meta_url));
var appVersion = JSON.parse(readFileSync(kioskPackageJson, "utf-8")).version;
function shortSha() {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: fileURLToPath(new URL(".", __vite_injected_original_import_meta_url)) }).toString().trim();
  } catch {
    return "dev";
  }
}
function generateVersionJsonPlugin(version, sha) {
  const content = JSON.stringify({ version, buildSha: sha, timestamp: Date.now() }, null, 2);
  return {
    name: "generate-version-json",
    buildStart() {
      try {
        const publicDir = resolve(fileURLToPath(new URL(".", __vite_injected_original_import_meta_url)), "public");
        mkdirSync(publicDir, { recursive: true });
        writeFileSync(resolve(publicDir, "version.json"), content);
      } catch (e) {
        console.warn("Falha ao escrever public/version.json:", e);
      }
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: content
      });
    }
  };
}
var vite_config_default = defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __BUILD_SHA__: JSON.stringify(shortSha())
  },
  plugins: [
    generateVersionJsonPlugin(appVersion, shortSha()),
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
        // json/bin: manifests e pesos dos modelos do face-api.js em
        // public/models, self-hosted de propósito (ver faceRecognition.ts)
        // para o reconhecimento facial funcionar offline/com internet
        // instável no local. Sem isso o SW nunca precacheava os modelos e
        // o fetch falhava direto ("Load failed") quando a rede caía.
        globPatterns: ["**/*.{js,css,html,svg,png,woff2,json,bin}"],
        // face_recognition_model.bin tem ~6.44MB — o limite de 4MB padrão
        // excluía esse arquivo do precache mesmo com o glob correto.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJDOlxcXFxVc2Vyc1xcXFxicnVub1xcXFxEb2N1bWVudHNcXFxcUHJvamV0b3NcXFxcQVBQIFBMQVlGYVx1MDBFN2EgQW1pZ29zXFxcXGFwcHNcXFxca2lvc2stdWlcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIkM6XFxcXFVzZXJzXFxcXGJydW5vXFxcXERvY3VtZW50c1xcXFxQcm9qZXRvc1xcXFxBUFAgUExBWUZhXHUwMEU3YSBBbWlnb3NcXFxcYXBwc1xcXFxraW9zay11aVxcXFx2aXRlLmNvbmZpZy50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vQzovVXNlcnMvYnJ1bm8vRG9jdW1lbnRzL1Byb2pldG9zL0FQUCUyMFBMQVlGYSVDMyVBN2ElMjBBbWlnb3MvYXBwcy9raW9zay11aS92aXRlLmNvbmZpZy50c1wiO2ltcG9ydCB7IHJlYWRGaWxlU3luYyB9IGZyb20gXCJub2RlOmZzXCI7XHJcbmltcG9ydCB7IGV4ZWNTeW5jIH0gZnJvbSBcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiO1xyXG5pbXBvcnQgeyBmaWxlVVJMVG9QYXRoIH0gZnJvbSBcIm5vZGU6dXJsXCI7XHJcbmltcG9ydCB7IGRlZmluZUNvbmZpZyB9IGZyb20gXCJ2aXRlXCI7XHJcbmltcG9ydCByZWFjdCBmcm9tIFwiQHZpdGVqcy9wbHVnaW4tcmVhY3RcIjtcclxuaW1wb3J0IHsgVml0ZVBXQSB9IGZyb20gXCJ2aXRlLXBsdWdpbi1wd2FcIjtcclxuXHJcbi8vIFZlcnNcdTAwRTNvIGV4aWJpZGEgbm8gYmFkZ2UgZGlzY3JldG8gKFZlcnNpb25CYWRnZS50c3gpOiB1c2EgYSBtZXNtYSB2ZXJzXHUwMEUzb1xyXG4vLyBkbyBhcHBzL2tpb3NrIChvIG5cdTAwRkFtZXJvIHF1ZSBkZSBmYXRvIFx1MDBFOSBidW1wYWRvIGEgY2FkYSByZWxlYXNlLCB2ZXJcclxuLy8gc2NyaXB0cy9yZWxlYXNlLWtpb3NrLm1qcykgXHUyMDE0IGtpb3NrLXVpIG5cdTAwRTNvIHRlbSB2ZXJzaW9uYW1lbnRvIHByXHUwMEYzcHJpby5cclxuY29uc3Qga2lvc2tQYWNrYWdlSnNvbiA9IGZpbGVVUkxUb1BhdGgobmV3IFVSTChcIi4uL2tpb3NrL3BhY2thZ2UuanNvblwiLCBpbXBvcnQubWV0YS51cmwpKTtcclxuY29uc3QgYXBwVmVyc2lvbiA9IEpTT04ucGFyc2UocmVhZEZpbGVTeW5jKGtpb3NrUGFja2FnZUpzb24sIFwidXRmLThcIikpLnZlcnNpb24gYXMgc3RyaW5nO1xyXG5cclxuZnVuY3Rpb24gc2hvcnRTaGEoKTogc3RyaW5nIHtcclxuICB0cnkge1xyXG4gICAgcmV0dXJuIGV4ZWNTeW5jKFwiZ2l0IHJldi1wYXJzZSAtLXNob3J0IEhFQURcIiwgeyBjd2Q6IGZpbGVVUkxUb1BhdGgobmV3IFVSTChcIi5cIiwgaW1wb3J0Lm1ldGEudXJsKSkgfSlcclxuICAgICAgLnRvU3RyaW5nKClcclxuICAgICAgLnRyaW0oKTtcclxuICB9IGNhdGNoIHtcclxuICAgIHJldHVybiBcImRldlwiO1xyXG4gIH1cclxufVxyXG5cclxuaW1wb3J0IHsgd3JpdGVGaWxlU3luYywgbWtkaXJTeW5jIH0gZnJvbSBcIm5vZGU6ZnNcIjtcclxuaW1wb3J0IHsgcmVzb2x2ZSB9IGZyb20gXCJub2RlOnBhdGhcIjtcclxuXHJcbmZ1bmN0aW9uIGdlbmVyYXRlVmVyc2lvbkpzb25QbHVnaW4odmVyc2lvbjogc3RyaW5nLCBzaGE6IHN0cmluZykge1xyXG4gIGNvbnN0IGNvbnRlbnQgPSBKU09OLnN0cmluZ2lmeSh7IHZlcnNpb24sIGJ1aWxkU2hhOiBzaGEsIHRpbWVzdGFtcDogRGF0ZS5ub3coKSB9LCBudWxsLCAyKTtcclxuICByZXR1cm4ge1xyXG4gICAgbmFtZTogXCJnZW5lcmF0ZS12ZXJzaW9uLWpzb25cIixcclxuICAgIGJ1aWxkU3RhcnQoKSB7XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgY29uc3QgcHVibGljRGlyID0gcmVzb2x2ZShmaWxlVVJMVG9QYXRoKG5ldyBVUkwoXCIuXCIsIGltcG9ydC5tZXRhLnVybCkpLCBcInB1YmxpY1wiKTtcclxuICAgICAgICBta2RpclN5bmMocHVibGljRGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcclxuICAgICAgICB3cml0ZUZpbGVTeW5jKHJlc29sdmUocHVibGljRGlyLCBcInZlcnNpb24uanNvblwiKSwgY29udGVudCk7XHJcbiAgICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgICBjb25zb2xlLndhcm4oXCJGYWxoYSBhbyBlc2NyZXZlciBwdWJsaWMvdmVyc2lvbi5qc29uOlwiLCBlKTtcclxuICAgICAgfVxyXG4gICAgfSxcclxuICAgIGdlbmVyYXRlQnVuZGxlKCkge1xyXG4gICAgICB0aGlzLmVtaXRGaWxlKHtcclxuICAgICAgICB0eXBlOiBcImFzc2V0XCIsXHJcbiAgICAgICAgZmlsZU5hbWU6IFwidmVyc2lvbi5qc29uXCIsXHJcbiAgICAgICAgc291cmNlOiBjb250ZW50LFxyXG4gICAgICB9KTtcclxuICAgIH0sXHJcbiAgfTtcclxufVxyXG5cclxuLy8gRDEgZG8gcGxhbm86IG1lc21hIFNQQSBwYXJhIG8gRWxlY3Ryb24gKDEyNy4wLjAuMTo3MzE3KSBlIHBhcmEgb3NcclxuLy8gdGFibGV0cyBkYSBMQU4uIEVtIGRldiwgbyBwcm94eSBldml0YSBDT1JTIGVudHJlIG8gVml0ZSAoNTE3MykgZSBvXHJcbi8vIHNlcnZpZG9yIEZhc3RpZnkgbG9jYWwgKGFwcHMva2lvc2spLlxyXG4vL1xyXG4vLyBQV0E6IG8gZGVwbG95IGRhIFZlcmNlbCAoSFRUUFMpIFx1MDBFOSBvIHF1ZSBvcyBjZWx1bGFyZXMvdGFibGV0cyBpbnN0YWxhbS5cclxuLy8gTyBzZXJ2aWNlIHdvcmtlciBcdTAwRTkgcmVnaXN0cmFkbyBtYW51YWxtZW50ZSBlbSBzcmMvcHdhLnRzIFx1MjAxNCBOVU5DQSBuYVxyXG4vLyBvcmlnZW0gbG9jYWwgZG8gRWxlY3Ryb24gKDEyNy4wLjAuMSBcdTAwRTkgc2VjdXJlIGNvbnRleHQgZSBvIFNXIGNvbmdlbGFyaWFcclxuLy8gdW1hIHNoZWxsIGFudGlnYSBubyBkZXNrdG9wIGFwXHUwMEYzcyB1cGRhdGVzKS5cclxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcclxuICBkZWZpbmU6IHtcclxuICAgIF9fQVBQX1ZFUlNJT05fXzogSlNPTi5zdHJpbmdpZnkoYXBwVmVyc2lvbiksXHJcbiAgICBfX0JVSUxEX1NIQV9fOiBKU09OLnN0cmluZ2lmeShzaG9ydFNoYSgpKSxcclxuICB9LFxyXG4gIHBsdWdpbnM6IFtcclxuICAgIGdlbmVyYXRlVmVyc2lvbkpzb25QbHVnaW4oYXBwVmVyc2lvbiwgc2hvcnRTaGEoKSksXHJcbiAgICByZWFjdCgpLFxyXG4gICAgVml0ZVBXQSh7XHJcbiAgICAgIHJlZ2lzdGVyVHlwZTogXCJhdXRvVXBkYXRlXCIsXHJcbiAgICAgIGluamVjdFJlZ2lzdGVyOiBudWxsLFxyXG4gICAgICBpbmNsdWRlQXNzZXRzOiBbXCJmYXZpY29uLnBuZ1wiLCBcImljb25zL2FwcGxlLXRvdWNoLWljb24ucG5nXCJdLFxyXG4gICAgICBtYW5pZmVzdDoge1xyXG4gICAgICAgIGlkOiBcIi9cIixcclxuICAgICAgICBuYW1lOiBcIkZhXHUwMEU3YUFtaWdvc1wiLFxyXG4gICAgICAgIHNob3J0X25hbWU6IFwiRmFcdTAwRTdhQW1pZ29zXCIsXHJcbiAgICAgICAgZGVzY3JpcHRpb246IFwiUGxheWdyb3VuZCBJbmNsdXNpdm8gXHUyMDE0IG9wZXJhXHUwMEU3XHUwMEUzb1wiLFxyXG4gICAgICAgIGxhbmc6IFwicHQtQlJcIixcclxuICAgICAgICBzdGFydF91cmw6IFwiL1wiLFxyXG4gICAgICAgIHNjb3BlOiBcIi9cIixcclxuICAgICAgICBkaXNwbGF5OiBcInN0YW5kYWxvbmVcIixcclxuICAgICAgICBvcmllbnRhdGlvbjogXCJhbnlcIixcclxuICAgICAgICB0aGVtZV9jb2xvcjogXCIjRjAxOTZCXCIsXHJcbiAgICAgICAgYmFja2dyb3VuZF9jb2xvcjogXCIjMTQxNDE0XCIsXHJcbiAgICAgICAgaWNvbnM6IFtcclxuICAgICAgICAgIHsgc3JjOiBcIi9pY29ucy9wd2EtMTkyLnBuZ1wiLCBzaXplczogXCIxOTJ4MTkyXCIsIHR5cGU6IFwiaW1hZ2UvcG5nXCIgfSxcclxuICAgICAgICAgIHsgc3JjOiBcIi9pY29ucy9wd2EtNTEyLnBuZ1wiLCBzaXplczogXCI1MTJ4NTEyXCIsIHR5cGU6IFwiaW1hZ2UvcG5nXCIgfSxcclxuICAgICAgICAgIHsgc3JjOiBcIi9pY29ucy9tYXNrYWJsZS01MTIucG5nXCIsIHNpemVzOiBcIjUxMng1MTJcIiwgdHlwZTogXCJpbWFnZS9wbmdcIiwgcHVycG9zZTogXCJtYXNrYWJsZVwiIH0sXHJcbiAgICAgICAgXSxcclxuICAgICAgfSxcclxuICAgICAgd29ya2JveDoge1xyXG4gICAgICAgIHNraXBXYWl0aW5nOiB0cnVlLFxyXG4gICAgICAgIGNsaWVudHNDbGFpbTogdHJ1ZSxcclxuICAgICAgICBjbGVhbnVwT3V0ZGF0ZWRDYWNoZXM6IHRydWUsXHJcbiAgICAgICAgLy8gSGFuZGxlciBkZSBXZWIgUHVzaCAoYWxlcnRhIGVtIHNlZ3VuZG8gcGxhbm8gZG8gcGFpbmVsIGRvXHJcbiAgICAgICAgLy8gcmVzcG9uc1x1MDBFMXZlbCkgXHUyMDE0IGdlbmVyYXRlU1cgblx1MDBFM28gcGVybWl0ZSBldmVudG9zIGN1c3RvbSBubyBjb25maWcsXHJcbiAgICAgICAgLy8gZW50XHUwMEUzbyBpc3NvIGluamV0YSB1bSBpbXBvcnRTY3JpcHRzKCkgYXBvbnRhbmRvIHBybyBhcnF1aXZvIGVtXHJcbiAgICAgICAgLy8gcHVibGljL3B1c2gtc3cuanMgZGVudHJvIGRvIHN3LmpzIGdlcmFkby5cclxuICAgICAgICBpbXBvcnRTY3JpcHRzOiBbXCJwdXNoLXN3LmpzXCJdLFxyXG4gICAgICAgIG5hdmlnYXRlRmFsbGJhY2s6IFwiL2luZGV4Lmh0bWxcIixcclxuICAgICAgICBuYXZpZ2F0ZUZhbGxiYWNrRGVueWxpc3Q6IFsvXlxcL2FwaVxcLy8sIC9eXFwvd3MvXSxcclxuICAgICAgICAvLyBqc29uL2JpbjogbWFuaWZlc3RzIGUgcGVzb3MgZG9zIG1vZGVsb3MgZG8gZmFjZS1hcGkuanMgZW1cclxuICAgICAgICAvLyBwdWJsaWMvbW9kZWxzLCBzZWxmLWhvc3RlZCBkZSBwcm9wXHUwMEYzc2l0byAodmVyIGZhY2VSZWNvZ25pdGlvbi50cylcclxuICAgICAgICAvLyBwYXJhIG8gcmVjb25oZWNpbWVudG8gZmFjaWFsIGZ1bmNpb25hciBvZmZsaW5lL2NvbSBpbnRlcm5ldFxyXG4gICAgICAgIC8vIGluc3RcdTAwRTF2ZWwgbm8gbG9jYWwuIFNlbSBpc3NvIG8gU1cgbnVuY2EgcHJlY2FjaGVhdmEgb3MgbW9kZWxvcyBlXHJcbiAgICAgICAgLy8gbyBmZXRjaCBmYWxoYXZhIGRpcmV0byAoXCJMb2FkIGZhaWxlZFwiKSBxdWFuZG8gYSByZWRlIGNhXHUwMEVEYS5cclxuICAgICAgICBnbG9iUGF0dGVybnM6IFtcIioqLyoue2pzLGNzcyxodG1sLHN2Zyxwbmcsd29mZjIsanNvbixiaW59XCJdLFxyXG4gICAgICAgIC8vIGZhY2VfcmVjb2duaXRpb25fbW9kZWwuYmluIHRlbSB+Ni40NE1CIFx1MjAxNCBvIGxpbWl0ZSBkZSA0TUIgcGFkclx1MDBFM29cclxuICAgICAgICAvLyBleGNsdVx1MDBFRGEgZXNzZSBhcnF1aXZvIGRvIHByZWNhY2hlIG1lc21vIGNvbSBvIGdsb2IgY29ycmV0by5cclxuICAgICAgICBtYXhpbXVtRmlsZVNpemVUb0NhY2hlSW5CeXRlczogOCAqIDEwMjQgKiAxMDI0LFxyXG4gICAgICAgIC8vIEdvb2dsZSBGb250cyBlbSBydW50aW1lIGNhY2hlIChvZmZsaW5lIGFwXHUwMEYzcyBvIHByaW1laXJvIGxvYWQpLlxyXG4gICAgICAgIC8vIFNlbSBoYW5kbGVyIHBhcmEgKi5zdXBhYmFzZS5jbyBkZSBwcm9wXHUwMEYzc2l0bzogYXV0aC9yZWFsdGltZS9SUENcclxuICAgICAgICAvLyBwYXNzYW0gZGlyZXRvLCBudW5jYSBjYWNoZWFkb3MuXHJcbiAgICAgICAgcnVudGltZUNhY2hpbmc6IFtcclxuICAgICAgICAgIHtcclxuICAgICAgICAgICAgdXJsUGF0dGVybjogL15odHRwczpcXC9cXC9mb250c1xcLmdvb2dsZWFwaXNcXC5jb21cXC8uKi8sXHJcbiAgICAgICAgICAgIGhhbmRsZXI6IFwiU3RhbGVXaGlsZVJldmFsaWRhdGVcIixcclxuICAgICAgICAgICAgb3B0aW9uczogeyBjYWNoZU5hbWU6IFwiZ29vZ2xlLWZvbnRzLWNzc1wiIH0sXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgICAge1xyXG4gICAgICAgICAgICB1cmxQYXR0ZXJuOiAvXmh0dHBzOlxcL1xcL2ZvbnRzXFwuZ3N0YXRpY1xcLmNvbVxcLy4qLyxcclxuICAgICAgICAgICAgaGFuZGxlcjogXCJDYWNoZUZpcnN0XCIsXHJcbiAgICAgICAgICAgIG9wdGlvbnM6IHtcclxuICAgICAgICAgICAgICBjYWNoZU5hbWU6IFwiZ29vZ2xlLWZvbnRzLXdvZmZcIixcclxuICAgICAgICAgICAgICBleHBpcmF0aW9uOiB7IG1heEVudHJpZXM6IDIwLCBtYXhBZ2VTZWNvbmRzOiAzMTUzNjAwMCB9LFxyXG4gICAgICAgICAgICAgIGNhY2hlYWJsZVJlc3BvbnNlOiB7IHN0YXR1c2VzOiBbMCwgMjAwXSB9LFxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgfSxcclxuICAgICAgICBdLFxyXG4gICAgICB9LFxyXG4gICAgfSksXHJcbiAgXSxcclxuICBzZXJ2ZXI6IHtcclxuICAgIGhvc3Q6IHRydWUsXHJcbiAgICBwb3J0OiA1MTczLFxyXG4gICAgcHJveHk6IHtcclxuICAgICAgXCIvYXBpXCI6IFwiaHR0cDovLzEyNy4wLjAuMTo3MzE3XCIsXHJcbiAgICAgIFwiL3dzXCI6IHsgdGFyZ2V0OiBcIndzOi8vMTI3LjAuMC4xOjczMTdcIiwgd3M6IHRydWUgfSxcclxuICAgIH0sXHJcbiAgfSxcclxufSk7XHJcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBb1osU0FBUyxvQkFBb0I7QUFDamIsU0FBUyxnQkFBZ0I7QUFDekIsU0FBUyxxQkFBcUI7QUFDOUIsU0FBUyxvQkFBb0I7QUFDN0IsT0FBTyxXQUFXO0FBQ2xCLFNBQVMsZUFBZTtBQWtCeEIsU0FBUyxlQUFlLGlCQUFpQjtBQUN6QyxTQUFTLGVBQWU7QUF4QnFPLElBQU0sMkNBQTJDO0FBVTlTLElBQU0sbUJBQW1CLGNBQWMsSUFBSSxJQUFJLHlCQUF5Qix3Q0FBZSxDQUFDO0FBQ3hGLElBQU0sYUFBYSxLQUFLLE1BQU0sYUFBYSxrQkFBa0IsT0FBTyxDQUFDLEVBQUU7QUFFdkUsU0FBUyxXQUFtQjtBQUMxQixNQUFJO0FBQ0YsV0FBTyxTQUFTLDhCQUE4QixFQUFFLEtBQUssY0FBYyxJQUFJLElBQUksS0FBSyx3Q0FBZSxDQUFDLEVBQUUsQ0FBQyxFQUNoRyxTQUFTLEVBQ1QsS0FBSztBQUFBLEVBQ1YsUUFBUTtBQUNOLFdBQU87QUFBQSxFQUNUO0FBQ0Y7QUFLQSxTQUFTLDBCQUEwQixTQUFpQixLQUFhO0FBQy9ELFFBQU0sVUFBVSxLQUFLLFVBQVUsRUFBRSxTQUFTLFVBQVUsS0FBSyxXQUFXLEtBQUssSUFBSSxFQUFFLEdBQUcsTUFBTSxDQUFDO0FBQ3pGLFNBQU87QUFBQSxJQUNMLE1BQU07QUFBQSxJQUNOLGFBQWE7QUFDWCxVQUFJO0FBQ0YsY0FBTSxZQUFZLFFBQVEsY0FBYyxJQUFJLElBQUksS0FBSyx3Q0FBZSxDQUFDLEdBQUcsUUFBUTtBQUNoRixrQkFBVSxXQUFXLEVBQUUsV0FBVyxLQUFLLENBQUM7QUFDeEMsc0JBQWMsUUFBUSxXQUFXLGNBQWMsR0FBRyxPQUFPO0FBQUEsTUFDM0QsU0FBUyxHQUFHO0FBQ1YsZ0JBQVEsS0FBSywwQ0FBMEMs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
