# Dox Dashboard Design System — Foundations

A perceptual, token-driven design system for Dox's **admin analytics dashboard**,
modeled on LI.FI's design language (OKLCH perceptual color scales, three-tier
elevation, a single dark/light flip, a 4px spacing rhythm, calm/precise data
density) and reskinned to Dox's **green brand** (`brandPresets.primary` —
`#10B981` light / `#34D399` dark).

- **Implementation:** [`src/styles/design-system.css`](../src/styles/design-system.css)
- **Scope:** every token and class is namespaced under `.dox-dashboard`; dark
  overrides live under `.dark .dox-dashboard`. Nothing leaks into the docs site.
  There is deliberately no bare `:root` / `body` / `*` rule.
- **Usage:**
  ```tsx
  import '@/styles/design-system.css'
  export default function DashboardLayout({ children }) {
    return <div className="dox-dashboard">{children}</div>
  }
  ```
- **Tailwind v3:** consume tokens via arbitrary values —
  `bg-[color:var(--ds-surface-card)]`, `rounded-[var(--ds-radius-xl)]`,
  `shadow-[var(--ds-elev-1)]` — or inline `style`. No build changes.

## Design principles (inherited from LI.FI, reskinned)

1. **One anchor, many tones.** The brand accent is pinned to a literal hex; every
   companion (tint, border, glow, chart lead) is *derived* via
   `color-mix(in oklch, …)` / relative-color OKLCH. Change one hex → the whole
   dashboard reskins. We do **not** inherit the running app's `--dox-accent`
   (it resolves to purple under the current `secondary` preset).
2. **Perceptual scales.** Colors ramp in OKLCH so every step is an even
   perceptual jump — legible heatmaps, predictable hover depths.
3. **Reach for the tier, not the shadow.** Three elevation tiers map to physical
   depth; authors pick a tier, never hand-author box-shadows.
4. **One dark/light flip.** Only surfaces, text, status intensity, elevation
   opacity, and chart chrome change between themes. Brand + scales are shared
   (the accent bumps one step lighter on dark).
5. **Data is the star.** Tabular numerals everywhere, muted table headers,
   calm labels — chrome recedes so the numbers read.

---

## 1. Color

### Roles & tokens

| Role | Token | Light | Dark |
|---|---|---|---|
| Brand accent | `--ds-accent` | `#10B981` | `#34D399` |
| Accent (deeper) | `--ds-accent-mid` | `#059669` | `#10B981` |
| Accent (pressed) | `--ds-accent-strong` | `#047857` | `#059669` |
| On-accent text | `--ds-accent-fg` | `#ECFEF3` | `#052E1C` |
| Secondary accent | `--ds-accent-secondary` | `#8B5CF6` (violet) | `#8B5CF6` |
| Tertiary accent | `--ds-accent-tertiary` | `#F59E0B` (amber) | `#F59E0B` |

**Derived accent companions** (never hand-author these — they track the anchor):
`--ds-accent-tint` (12%), `--ds-accent-tint-hover` (18%), `--ds-accent-border`
(30%), `--ds-accent-ring` (45%), `--ds-accent-glow` (22%).

### Surfaces — four tiers (sunk → page → raised → card)

| Token | Light | Dark |
|---|---|---|
| `--ds-surface-sunk` | `#F8FAFC` | `oklch(0.150 0.024 262)` |
| `--ds-surface-page` | `#FFFFFF` | `oklch(0.170 0.028 262)` (≈`#0B1220`) |
| `--ds-surface-raised` | `#FFFFFF` | `oklch(0.205 0.030 261)` |
| `--ds-surface-card` | `#FFFFFF` | `oklch(0.235 0.030 260)` |
| `--ds-surface-tint` | slate 2.5% | text 3% |

In light mode the tiers are separated by **borders** (all white); in dark they
separate by **lightness lift** toward the viewer.

### Text — four tiers

| Token | Light | Dark | Use |
|---|---|---|---|
| `--ds-text-primary` | `oklch(0.210 0.040 258)` (≈`#0F172A`) | `#F8FAFC` | headings, KPI values |
| `--ds-text-secondary` | `oklch(0.445 …)` | `oklch(0.780 …)` | body |
| `--ds-text-muted` | `oklch(0.580 …)` | `oklch(0.620 …)` | labels, captions |
| `--ds-text-faint` | `oklch(0.680 …)` | `oklch(0.500 …)` | eyebrows, disabled |

### Borders

`--ds-border` (default hairline), `--ds-border-subtle` (8% ink over transparent —
auto-flips), `--ds-border-strong`.

### Perceptual scales (9 steps each)

- **Green `--ds-green-1..9`** — hue ~162, step 5 = brand anchor. Sequential heat,
  intensity fills, accent depth.
- **Slate `--ds-slate-1..9`** — hue ~257, step 2 ≈ `#F8FAFC`, step 3 ≈ `#E2E8F0`,
  step 9 ≈ `#0F172A`. The ink ramp behind text/border/surface tokens.

### Status / semantic — distinct hues

Success leans spring-green (152) to read apart from the **brand** green (162);
danger red (25), warn amber (75), info blue (240). Each ships a tone plus a
derived **14% bg** and **30% border** (the LI.FI alert recipe):
`--ds-success` / `-bg` / `-border`, and the same for `--ds-danger`, `--ds-warn`,
`--ds-info`. Dark variants are one step lighter to hold contrast.

### Chart / data-viz palette

- **Categorical** `--ds-series-1..8`: leads with **brand green** (1), **Dox
  violet** (2), amber (3), then evenly spaced spectral hues (blue, pink, cyan,
  coral, indigo). Brighter variants in dark.
- **Sequential** `--ds-seq-1..7`: the green scale, low→high (single-metric heat).
- **Diverging** `--ds-div-neg / -mid / -pos`: red ↔ slate ↔ green.
- **Chrome:** `--ds-chart-grid` (8% ink), `--ds-chart-axis` (= text-faint).

---

## 2. Typography

Fonts reference Dox's existing app tokens: `--ds-font-sans` (Inter),
`--ds-font-heading`, `--ds-font-mono` (IBM Plex Mono).

| Step | Size | Line-height | Token |
|---|---|---|---|
| display | 3.5rem | 1.05 | `--ds-text-display` |
| h1 | 3rem | 1.08 | `--ds-text-h1` |
| h2 | 2.25rem | 1.12 | `--ds-text-h2` |
| h3 | 1.5rem | 1.2 | `--ds-text-h3` |
| h4 | 1.25rem | 1.3 | `--ds-text-h4` |
| body-lg | 1.125rem | 1.5 | `--ds-text-body-lg` |
| body | 1rem | 1.5 | `--ds-text-body` |
| sm | 0.875rem | 1.35 | `--ds-text-sm` |
| caption | 0.75rem | 1.25 | `--ds-text-caption` |
| micro | 0.625rem | 1.2 | `--ds-text-micro` |

**Tracking:** `--ds-tracking-tighter` (-0.04em, big KPI values) → `-tight` →
`-snug` → `-normal` → `-wide` (0.06em, eyebrows) → `-wider` (0.12em).
**Weights:** `--ds-fw-regular` 400 · `-medium` 500 · `-semibold` 600 · `-bold`
700 · `-extrabold` 800. KPI values use extrabold + tracking-tighter + `lh:1` +
`tabular-nums`.

---

## 3. Spacing — 4px rhythm

`--ds-space-{0,2,4,8,12,16,20,24,28,32,40,48,56,64,80,96}` (px). Card/panel
padding = 24. Panel-head bottom margin = 20. Section vertical padding = 40.
Grid gaps = 16. Inter-slot rhythm inside a stat card = 12.

## 4. Radii

`--ds-radius-sm` 6 (chips/controls) · `-md` 8 (buttons/inputs/cells) · `-lg` 12
(nested tiles/menus) · `-xl` 16 (**cards & panels — the dashboard default**,
aliased `--ds-radius-card`) · `-full` 9999 (pills/avatars/rings). Parallels
Dox's existing `--theme-radius-*`.

## 5. Elevation — three tiers + glass

| Tier | Token | Use |
|---|---|---|
| 1 | `--ds-elev-1` | resting cards & rows |
| 2 | `--ds-elev-2` | hover, active sticky cards, tooltips |
| 3 | `--ds-elev-3` | floating — modals, popovers, dropdowns |

Light uses low-alpha slate shadows (0.06 → 0.16); dark uses deeper black
(0.35 → 0.55) **plus an inset white rim** that sells the lift. Plus
`--ds-shadow-focus` (2px ring in accent), `--ds-shadow-glass` +
`--ds-backdrop-glass` (`blur(24px) saturate(140%)`).

## 6. Motion

Durations `--ds-dur-fast` 120ms · `-base` 200ms · `-slow` 400ms. Easings
`--ds-ease-standard` (enter/move) · `-out` (decelerate, ring fills) · `-in-out`
(symmetric). Keep transitions calm and short; animate color/background/transform,
not layout.

---

## 7. Dashboard component patterns

Each pattern lists the tokens that build it. A starter class (prefixed
`.dox-dashboard`) exists in `design-system.css`; extend in JSX. All examples
assume a `.dox-dashboard` ancestor.

### Stat card — `.ds-stat-card`
The KPI atom. Vertical stack: label → value → footer.
- **Surface:** `--ds-surface-card` bg, `1px --ds-border`, `--ds-radius-xl`,
  `--ds-elev-1`, padding 24, gap 12.
- **Label** (`.ds-stat-card-label`): `--ds-text-body`, `--ds-text-muted`, weight
  regular — a calm metric name, *not* an uppercase eyebrow.
- **Value** (`.ds-stat-card-value`): `--ds-text-h2`, extrabold, `lh:1`,
  `--ds-tracking-tighter`, `--ds-text-primary`, `tabular-nums`, `nowrap`.
- **Footer** (`.ds-stat-card-footer`): `--ds-text-sm` muted; holds a delta chip.
- **Variants:** `--pos` / `--neg` (success/danger border + 1px tint ring),
  `--glow` (radial accent glow top-right, driven by `--ds-stat-accent`), `--bold`
  (solid `accent → accent-strong` gradient fill, `--ds-accent-fg` text — reserve
  for the one hero KPI), `--accent2` / `--accent3` (retint `--ds-stat-accent` to
  secondary/tertiary), `.ds-stat-card-icon` (32px accent-tint tile, radius-md).

```html
<div class="ds-stat-card ds-stat-card--pos">
  <span class="ds-stat-card-label">Monthly active readers</span>
  <span class="ds-stat-card-value">48,204</span>
  <div class="ds-stat-card-footer">
    <span class="ds-chip ds-chip--success">▲ 12.4%</span> vs last month
  </div>
</div>
```

### Metric panel — `.ds-panel` + `.ds-panel-head` / `-title` / `-sub`
The container for charts and grouped metrics.
- **Surface:** `--ds-surface-raised`, `1px --ds-border`, `--ds-radius-xl`,
  `--ds-elev-1`, padding 24.
- **Head:** flex space-between, bottom margin 20. **Title:** `--ds-text-h4`,
  semibold, heading font, `--ds-tracking-snug`. **Sub:** `--ds-text-caption`,
  `--ds-text-muted`, uppercase, `--ds-tracking-wide`.

### Section header / eyebrow — `.ds-eyebrow` + `.ds-section-title` + `.ds-section-desc`
Page-level rhythm: numbered mono eyebrow → title → description.
- **Eyebrow:** mono font, `--ds-text-caption`, semibold, uppercase,
  `--ds-tracking-wide`, `--ds-text-faint` (e.g. `01 · Summary`).
- **Title:** `--ds-text-h3`, semibold, `--ds-tracking-tight`, `--ds-text-primary`.
- **Desc:** `--ds-text-sm`, `--ds-lh-body`, `--ds-text-muted`, max-width ~60ch.
- Separate adjacent sections with a `1px --ds-border-subtle` top border and
  `--ds-space-40` vertical padding.

### Chart frame
A `.ds-panel` wrapping an SVG. Data-viz tokens do the work:
- **Series colors:** `--ds-series-1..8` for lines/bars/legend swatches
  (series-1 = brand green).
- **Area fills:** a vertical linear-gradient from `var(--ds-series-N)` at
  `0.55` opacity → `0.02` (LI.FI's `dsAreaGrad` recipe). Bars: `1` → `0.55`.
- **Grid/axis:** `--ds-chart-grid` gridlines, `--ds-chart-axis` ticks/labels
  (`--ds-text-caption`).
- **Heat/intensity:** `--ds-seq-1..7`. **+/- diverging:** `--ds-div-*`.

```html
<div class="ds-panel">
  <div class="ds-panel-head">
    <div>
      <div class="ds-panel-title">Daily page views</div>
      <div class="ds-panel-sub">Last 30 days</div>
    </div>
  </div>
  <svg viewBox="0 0 800 320" style="color: var(--ds-series-1)"> … </svg>
</div>
```

### Data table row — `.ds-table` (+ `--striped`, `.ds-num`)
- **Table:** `tabular-nums`, `border-collapse`.
- **Header cell:** height 48, muted, **regular weight, normal-case** (headers
  recede), `--ds-text-sm`, `1px --ds-border-subtle` bottom, horizontal pad 20.
- **Body cell:** height 56, `--ds-text-body`, `--ds-text-primary`, hairline
  bottom border, horizontal pad 20; last row no border.
- **Row hover:** 4% ink tint. **Striped** (`--striped`): 3% ink on even rows.
- **Numeric columns:** add `.ds-num` for right-align. Emphasis ladder: muted
  (`th`/secondary) → default (`td`) → semibold `<strong>`.

### Badge / pill — `.ds-chip` (+ tone modifiers)
Pill: inline-flex, gap 4, pad `0 12`, min-height 24, `--ds-radius-full`,
`--ds-text-caption`, semibold. Tones = single token at **12% bg + full-strength
text**: `--accent`, `--success`, `--danger`, `--warn`, `--info`, `--neutral`.
Use for status labels and **delta chips** in stat-card footers (success/danger
for ▲/▼).

### Score / progress ring — `.ds-ring` (`.ds-ring__svg` / `__track` / `__fill` / `__label`)
SVG ring driven by `--ds-ring-value` (0–100). Two `<circle pathLength="100">`:
track (`--ds-ring-track`, 10% ink) + fill (`--ds-ring-fill`, `--ds-accent`,
`stroke-linecap: round`, `dasharray: 100`, `dashoffset: calc(100 - value)`),
SVG rotated `-90deg`. Fill transitions on `--ds-dur-slow --ds-ease-out`. Sizes
via `--ds-ring-size` / `--ds-ring-stroke` (e.g. 48/10, 80/8, 96/7). Tones:
`--success` / `--warn` / `--danger`. Optional centered `.ds-ring__label`
(heading font, bold, `tabular-nums`).

```html
<div class="ds-ring ds-ring--success" style="--ds-ring-value: 72; --ds-ring-size: 96px; --ds-ring-stroke: 7;">
  <svg class="ds-ring__svg" viewBox="0 0 100 100">
    <circle class="ds-ring__track" cx="50" cy="50" r="45" pathLength="100"/>
    <circle class="ds-ring__fill"  cx="50" cy="50" r="45" pathLength="100"/>
  </svg>
  <span class="ds-ring__label">72</span>
</div>
```

### Tabs / segmented control — `.ds-segmented` + `.ds-segmented__item`
Track: inline-flex, pad 4, `--ds-surface-sunk` bg, `1px --ds-border`,
`--ds-radius-lg`. Item: transparent, pad `8 16`, `--ds-radius-md`,
`--ds-text-sm` medium, `--ds-text-muted`; hover → secondary. **Active**
(`[aria-selected="true"]` / `.is-active`): `--ds-surface-page` bg,
`--ds-text-primary`, `--ds-elev-1` (the raised "pill" indicator). Transitions on
`--ds-dur-fast --ds-ease-standard`.

### Focus — `.ds-focusable`
On `:focus-visible`, apply `--ds-shadow-focus` (2px page-colored gap + 2px accent
ring). Add to any custom interactive control for consistent, on-brand focus.

---

## Grid primitives (compose the above)

```css
.dash-grid   { display: grid; gap: var(--ds-space-16); }
.dash-grid--4 { grid-template-columns: repeat(4, minmax(0, 1fr)); } /* KPI row */
.dash-grid--2 { grid-template-columns: minmax(0,1.6fr) minmax(0,1fr); } /* hero + rail */
@media (max-width: 1100px){ .dash-grid--2{grid-template-columns:1fr} .dash-grid--4{grid-template-columns:1fr 1fr} }
@media (max-width: 700px){ .dash-grid--4{grid-template-columns:1fr} }
```

A typical dashboard: **section header** → **`dash-grid--4` of stat cards** →
**`ds-panel` chart frames** → **`ds-table` release/activity log**, each section
separated by a `--ds-border-subtle` hairline.
