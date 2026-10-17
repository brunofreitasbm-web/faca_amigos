import { existsSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Emoji3D, renderEmoji } from "../src/components/Emoji3D.js";
import { EMOJI_3D } from "../src/components/emoji3dSet.js";

const html = (node: unknown) => renderToStaticMarkup(createElement("span", null, node as never));

describe("Emoji3D", () => {
  it("todo emoji do conjunto tem arquivo em public/emoji3d", () => {
    for (const key of EMOJI_3D) expect(existsSync(`public/emoji3d/${key}.png`), key).toBe(true);
  });

  it("troca pictográfico por imagem 3D e mantém o texto", () => {
    const out = html(renderEmoji("🎂 Aniversário"));
    expect(out).toContain('src="/emoji3d/1f382.png"');
    expect(out).toContain("Aniversário");
  });

  it("ignora o U+FE0F ao procurar o arquivo", () => {
    expect(html(createElement(Emoji3D, { e: "🖨️" }))).toContain("/emoji3d/1f5a8.png");
  });

  it("mantém ⚠ ✅ ❌ como texto", () => {
    expect(html(renderEmoji("⚠ ✅ ❌ ok"))).not.toContain("<img");
  });

  it("emoji sem arquivo cai no glifo", () => {
    expect(html(createElement(Emoji3D, { e: "🦖" }))).not.toContain("<img");
    expect(renderEmoji(undefined)).toBeUndefined();
  });
});
