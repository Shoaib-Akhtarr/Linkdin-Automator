# Axiom — Style Reference
> Terminal window at midnight — flat black canvas, monospaced text, and one orange cursor blinking

**Theme:** dark

Source measurements are normalized; roles and recommendations are interpreted. Font summary lists are independent, not paired by position. HTML examples are reconstructions, not source components.

Axiom is a terminal-grade dark interface where every glyph is monospaced, every surface is near-black, and one warm orange does all the chromatic work. The design language borrows from code editors and CLI tools — no gradients, almost no shadows, no rounded softness — instead layering information through subtle shifts in dark neutrals (from #000000 canvas to #191919 cards to #202020 borders) so the UI reads like a well-formatted log file. BerkeleyMono carries the entire voice, from hero headlines to nav labels, giving the product an engineering-native feel that signals audience before it signals brand. Orange appears as a precise tool: the primary CTA fill, the log-bar visualization, and a 2px left border that marks editorial case-study cards — never decorative, always functional.

## Colors

| Name | Value | Role |
|------|-------|------|
| Void | `#000000` | Page background, nav fill, terminal surface |
| Carbon | `#111111` | Primary surface, card base, hero canvas |
| Graphite | `#191919` | Elevated card background, case-study card fill |
| Iron | `#202020` | Hairline borders, dividers, subtle separation |
| Slate | `#3a3a3a` | Muted borders, icon strokes, secondary lines |
| Pewter | `#505050` | Subtle dividers, decorative rules |
| Steel | `#606060` | Tertiary text, icon detail, inactive labels |
| Ash | `#7e7e7e` | Muted helper text, small annotations |
| Fog | `#b4b4b4` | Secondary text, label text, muted body |
| Chalk | `#d9d9d9` | Light borders, stroke detail on icons |
| Paper | `#eeeeee` | Primary text, nav links, heading fill, button text |
| Ember | `#da5c2c` | Orange supporting accent for decorative details and low-frequency emphasis. Primary CTA fill & active accents |

## Typography

### BerkeleyMono / JetBrains Mono — Universal typeface — headlines, body, nav, buttons, code, table cells, logo. Weight 400 carries prose and UI labels; weight 700 is reserved for emphasis and primary CTAs. The monospaced geometry unifies the brand and signals engineering audience. Every line of text, including navigation and button labels, sits in this monospaced grid — there is no proportional fallback for content.
- **Substitute:** JetBrains Mono, IBM Plex Mono, Fira Code
- **Weights:** 400, 700
- **Sizes:** 12px, 13px, 14px, 16px, 18px, 20px, 24px, 32px
- **Line height:** 1.0–1.71
- **Letter spacing:** normal

### Inter — Secondary text layer — small icon labels, fine print, tertiary annotations where proportional letterforms reduce visual density below the mono baseline
- **Substitute:** system-ui, -apple-system, Segoe UI
- **Weights:** 400
- **Sizes:** 12px, 14px, 16px
- **Line height:** 1.33–1.50

### Type Scale

| Role | Family | Weight | Size | Line Height | Letter Spacing |
|------|--------|--------|------|-------------|----------------|
| caption | — | — | 12px | 1.5 | 0px |
| body | — | — | 14px | 1.71 | 0px |
| heading-sm | — | — | 18px | 1.56 | 0px |
| heading | — | — | 20px | 1.4 | 0px |
| heading-lg | — | — | 24px | 1.33 | 0px |
| display | — | — | 32px | 1.25 | 0px |

## Spacing & Layout

**Base unit:** 8px
**Density:** comfortable

- **Page max-width:** 1400px
- **Section gap:** 40px
- **Card padding:** 24px - 32px
- **Element gap:** 16px

### Border Radius

- **tags / pills:** 9999px (under 32px)
- **cards:** 2px
- **icons:** 9999px
- **inputs:** 2px
- **buttons:** 2px

## Components & Visual Language

- **Surfaces:** Void (`#000000`), Carbon (`#111111`), Graphite (`#191919`), Iron (`#202020`).
- **Borders:** Hairline 1px solid `#202020` or `#3a3a3a`.
- **Primary CTA:** `#da5c2c` background, `#eeeeee` text, 2px radius, no shadow.
- **Ghost CTA:** Transparent, 1px `#3a3a3a` border, `#eeeeee` text, 2px radius.
- **Accents:** Active items get a 2px solid `#da5c2c` indicator or border.
- **Zero Gradients, Zero Heavy Drop-Shadows:** Pure flat surfaces with crisp borders.
