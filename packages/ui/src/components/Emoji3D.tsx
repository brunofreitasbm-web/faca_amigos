import { Fragment, useState, type ReactNode } from "react";
import { EMOJI_3D } from "./emoji3dSet.js";

// Fluent Emoji 3D (Microsoft, MIT) servido de /emoji3d/<codepoints>.png.
// Emoji sem arquivo (ou imagem que falhou) cai de volta no glifo do sistema.
const SEQUENCE =
  /\p{Extended_Pictographic}️?(?:‍\p{Extended_Pictographic}️?)*/gu;

function emojiKey(emoji: string): string {
  return Array.from(emoji.replace(/️/g, ""), (c) => c.codePointAt(0)!.toString(16)).join("-");
}

export function Emoji3D({ e }: { e: string }) {
  const key = emojiKey(e);
  const [failed, setFailed] = useState(false);
  if (failed || !EMOJI_3D.has(key)) return <>{e}</>;
  return (
    <img
      src={`/emoji3d/${key}.png`}
      alt={e}
      draggable={false}
      onError={() => setFailed(true)}
      style={{ width: "1.2em", height: "1.2em", verticalAlign: "-0.25em", display: "inline-block" }}
    />
  );
}

/** Troca cada emoji com versão 3D de um texto por <Emoji3D>; o resto segue como texto. */
export function renderEmoji(text: string | null | undefined): ReactNode {
  if (!text) return text;
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(SEQUENCE)) {
    if (!EMOJI_3D.has(emojiKey(m[0]))) continue;
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(<Emoji3D key={m.index} e={m[0]} />);
    last = m.index + m[0].length;
  }
  if (parts.length === 0) return text;
  if (last < text.length) parts.push(text.slice(last));
  return parts.map((p, i) => <Fragment key={i}>{p}</Fragment>);
}
