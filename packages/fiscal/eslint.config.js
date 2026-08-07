// @ts-check
import base from "@facaamigos/config/eslint-base";

// Ao contrário de packages/domain, este pacote PRECISA de node:crypto (SHA-1
// do QR Code, XMLDSig) — por isso usa o preset base, não o domain (que
// proíbe node:*). A fronteira de pureza aqui é outra: nada de rede, nada de
// disco. Só criptografia local e montagem de string/XML.
export default base;
