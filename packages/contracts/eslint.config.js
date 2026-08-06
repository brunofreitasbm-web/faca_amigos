// @ts-check
import domain from "@facaamigos/config/eslint-domain";

// packages/contracts é puro pela mesma razão que packages/domain (D5):
// os DTOs precisam ser importáveis por Deno (Edge Functions) e pelo
// navegador do tablet, não só pelo Electron main.
export default domain;
