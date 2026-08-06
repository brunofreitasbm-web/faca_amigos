# FaçaAmigos Design System

> **Playground Inclusivo** — a children's inclusive indoor playground based in Brazil.

FaçaAmigos is a physical entertainment space where children of all abilities play together. The brand emphasises joy, inclusion, safety and belonging. The primary audience is Brazilian families with young children; communication is always in Portuguese (pt-BR).

---

## Sources

The following materials were used to build this design system. No external Figma or GitHub access was given; all inference is from the files below.

| File | Content |
| --- | --- |
| `uploads/Logotipo.png` | Official brand logo (full lockup with tagline) |
| `uploads/WhatsApp Image 2026-06-29 at 12.53.21.jpeg` | Mobile app screenshot — home screen category navigation |
| `uploads/WhatsApp Image 2026-06-29 at 12.53.39.jpeg` | Social media post — "Horários" (opening hours) |
| `uploads/WhatsApp Image 2026-06-29 at 12.54.15.jpeg` | Social media post — "Curta sem Preocupação" |

Copies are in `assets/`.

---

## Products

| Product | Description |
| --- | --- |
| **Mobile App** | Dark-themed info app. Visitors check hours, location, FAQ, and inclusion info via large circular category buttons. |
| **Social / Marketing** | Vibrant photo-forward posts. Full-bleed photography, bubbly display type, bright overlaid text. |

---

## CONTENT FUNDAMENTALS

### Language & Tone

- **Language:** Brazilian Portuguese (pt-BR) exclusively.
- **Register:** Casual and warm. Uses **você** (second-person singular) to speak directly to the visitor — "te esperando", "você curte", "a gente cuida".
- **Personality:** Energetic, encouraging, inclusive. Like an enthusiastic friend, not a corporate brand.
- **Punctuation:** Exclamation marks used freely ("todos os dias!", "se divertir!"). Never stiff or formal.
- **Sentence case:** Headlines are generally sentence case in Portuguese ("te esperando todos os dias!") not title case.
- **Length:** Short, punchy. One idea per phrase. Never padded.

### Copy Examples

- `"Horários — das 10h às 22h"` → direct, time-formatted, no fluff
- `"te esperando todos os dias!"` → lowercase, personal, inviting
- `"Você curte e a gente cuida da diversão da criançada!"` → first + second person split
- `"Curta sem Preocupação"` → imperative + reassurance
- `"Mais tempo para brincar e se divertir"` → benefit-led sub-copy

### Emoji & Special Characters

- **Emoji:** Not used in UI or logo. May appear occasionally in social captions but not part of the core brand.
- **Cedilla (ç) and accents** are always rendered correctly — never stripped ("Faça", "Inclusão", "Localização").

---

## VISUAL FOUNDATIONS

### Color

The palette is bold, primary and saturated. No pastels; no muted earth tones.

| Token | Hex | Use |
| --- | --- | --- |
| `--color-pink` | `#F0196B` | Primary action, "Amigos" in logo, CTA buttons |
| `--color-teal` | `#2ECFB5` | Secondary, logo mark, Dúvidas button |
| `--color-amber` | `#C99020` | Logo mark golden shape |
| `--color-yellow` | `#FFE234` | Marketing display headlines |
| `--color-dark` | `#1A3F35` | "Faça" in logo, dark text on light bg |
| `--color-bg-app` | `#141414` | App dark background |

**Gradient Ring** (`--gradient-ring`): A conic gradient cycling purple → pink → orange → yellow → back, used as a decorative border ring on app circle buttons. It intentionally recalls Instagram Stories rings but shifted toward warm brand tones.

### Typography

- **Display / Headlines:** `Fredoka One` — inherently heavy, single weight, very rounded terminals. Used for big marketing text ("Horários", "Curta sem Preocupação").
- **Body / UI:** `Nunito` — clean, rounded, versatile. Used in the logo wordmark, app labels, body copy. Weights 400–900.
- **Tagline / Subhead:** Nunito Bold, wide letter-spacing (`--tracking-widest`), ALL CAPS. See "PLAYGROUND INCLUSIVO" in logo.

> ⚠️ **Font substitution:** Fredoka One and Nunito are Google Fonts approximations. If the brand uses proprietary fonts, please provide .ttf/.otf files.

### Backgrounds

- **App:** Near-black `#141414`. No gradients, no texture — pure dark.
- **Cards (app):** Slightly lighter `#262626`.
- **Marketing posts:** Full-bleed photography always. Text overlaid directly on photo using bold color. Warm, golden-toned imagery preferred (children playing in natural/warm lighting).
- **Accent corners:** Yellow diagonal shape cut into corners of marketing posts (see `marketing-curta.jpeg`).

### Animation & Motion

- **Transitions:** Fast and snappy (`150–250ms`). Bounce easing (`--transition-bounce`) on interactive elements for playful feel.
- **No infinite loops** on UI content.
- **Press state:** Slight scale down (`scale(0.95)`) with color darkening.
- **Hover state:** Slight brightness increase or scale up (`scale(1.03)`).

### Borders & Corners

- **Buttons:** Fully rounded pill shape (`border-radius: 9999px`).
- **Cards:** Large radius (`24px`).
- **Circle buttons (app):** Perfect circle (`50%`) with gradient ring border.
- **No sharp corners** anywhere in the brand.

### Cards

- On dark: `background: #262626`, `border-radius: 24px`, soft shadow.
- On light: white background, larger shadow (`--shadow-lg`).
- No border-only cards; always a filled background.

### Shadows

- Colored shadows on primary elements: `--shadow-pink` (pink glow) and `--shadow-teal` (teal glow).
- Neutral shadows elsewhere.

### Imagery

- **Children at play** — diverse, joyful, candid.
- **Warm color grade** — golden hour tones, slightly warm-shifted.
- Never clinical or stock-photo sterile.

### Spacing

- 4px base grid.
- Mobile app uses generous padding (`20px` page gutters).
- Circle buttons in app: `~88–96px` diameter.

---

## ICONOGRAPHY

No custom icon font or SVG sprite was provided. Based on app screenshots:

- **Circle icons:** The app uses solid-color filled circles (no glyphs inside) as the primary navigation metaphor. Color = the semantic category color. Label sits below.
- **Logo mark:** Acts as a decorative brand icon — not used as a navigational glyph.
- **No emoji as icons** in the UI.
- **Recommendation:** Use [Phosphor Icons](https://phosphoricons.com/) (CDN available, rounded style, matches brand warmth) if glyphs are needed. Load via `<script src="https://unpkg.com/@phosphor-icons/web"></script>`.

---

## File Index

```
styles.css                    ← Global CSS entry point (import this)
tokens/
  fonts.css                   ← Google Fonts @import
  colors.css                  ← All color tokens
  typography.css              ← Type scale, weights, families
  spacing.css                 ← Spacing scale + layout tokens
  effects.css                 ← Radii, shadows, gradients, transitions
assets/
  Logo.jpg                    ← Official brand logo
  app-screenshot-home.jpeg    ← App home screen reference
  marketing-horarios.jpeg     ← Marketing post reference
  marketing-curta.jpeg        ← Marketing post reference
components/core/
  Button                      ← Primary, secondary, ghost pill buttons
  CircleButton                ← App-style gradient-ring circle button
  Card                        ← Content card (dark + light variants)
  Badge                       ← Status / category badge
  Tag                         ← Small inline label chip
  Input                       ← Text input field
  Avatar                      ← User avatar circle
guidelines/
  (specimen cards for Design System tab)
ui_kits/app/
  index.html                  ← Interactive mobile app prototype
SKILL.md                      ← Agent skill definition
readme.md                     ← This file
```
