"use client";

// @facaamigos/ui não marca seus componentes com "use client" (o pacote é
// consumido diretamente por uma SPA Vite no kiosk-ui, onde isso não é
// necessário). No Next.js App Router, qualquer Server Component que
// importasse Button/Card/Input direto do pacote tentaria renderizá-los no
// servidor e quebraria nos hooks internos (useState/useId). Este wrapper
// estabelece a fronteira de Client Component uma única vez — importar
// daqui em vez de "@facaamigos/ui" em qualquer arquivo do backoffice.
export { Button, Card, Badge, StatusBadge, Tag, Input } from "@facaamigos/ui";
