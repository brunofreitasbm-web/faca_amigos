/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@facaamigos/ui"],
  // @facaamigos/ui usa imports ESM com extensão .js apontando pra fontes
  // .ts/.tsx (resolvido nativamente pelo esbuild do Vite no kiosk-ui).
  // O resolver padrão do webpack não faz esse mapeamento .js -> .ts/.tsx,
  // então precisa ser declarado explicitamente aqui.
  webpack(config) {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".js", ".ts", ".tsx"],
    };
    return config;
  },
};

export default nextConfig;
