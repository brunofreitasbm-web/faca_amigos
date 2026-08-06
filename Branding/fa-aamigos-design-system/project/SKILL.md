---
name: facaamigos-design
description: Use this skill to generate well-branded interfaces and assets for FaçaAmigos (Playground Inclusivo), either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the README.md file within this skill, and explore the other available files.
If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out of `assets/` and create static HTML files for the user to view. If working on production code, you can copy assets and read the rules here to become an expert in designing with this brand.
If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

Key brand decisions to always follow:
- Language: Brazilian Portuguese (pt-BR), casual "você" register
- Primary color: Hot pink #F0196B; secondary: teal #2ECFB5; accent: yellow #FFE234
- Display font: Fredoka One (bubbly headlines); Body font: Nunito
- The marketing/info app (the original reference material) is dark (#141414 bg); marketing posts are full-bleed photo + bold text overlay. The **operator kiosk** (apps/kiosk-ui) is deliberately **light** — a real product decision, not an oversight — because it's the densest, most text-heavy screen the staff reads all day. Follow whichever surface you're building for; don't force dark onto the kiosk.
- All buttons/badges are fully rounded (pill). No sharp corners anywhere.
- Circle buttons use a conic gradient ring (--gradient-ring): purple→pink→orange→yellow
- Tone: warm, playful, direct; never corporate; always inclusive
