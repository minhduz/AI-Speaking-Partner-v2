# AI Speaking Partner — Frontend Design Language

> **Reference implementation:** `src/app/(main)/billing/`
> Every new screen should feel like a sibling of the Billing UI.

---

## 1. Design Philosophy

| Principle | Description |
|---|---|
| **Soft Minimalism** | Generous white space, no clutter, content breathes |
| **Neutral base + selective pastels** | 90% neutral surfaces, color used intentionally per-section |
| **Shadow over border** | Cards are defined by `shadow-sm`, not colored borders |
| **Single accent** | One primary color (`#8447FF`) — used sparingly for CTAs and highlights only |
| **Flat illustration** | unDraw SVGs placed as hero images in feature cards |
| **Bento Grid** | Content grouped into clearly-scoped rectangular blocks |
| **PWA / Mobile-first** | Modals slide up on mobile (`items-end`), centered on desktop (`sm:items-center`) |

---

## 2. Color Tokens

### Core Surfaces
| Token | Value | Usage |
|---|---|---|
| `page-bg` | `#F8F9FB` | Page background — cool near-white |
| `card-bg` | `#FFFFFF` | All standard cards |
| `subtle-bg` | `bg-gray-50` | Inner sub-sections, inactive states |

### Primary Accent — Electric Purple
| Token | Value | Usage |
|---|---|---|
| `primary` | `#8447FF` | Buttons, icons, progress bars, links |
| `primary-hover` | `#7C3AED` | Hover state of primary buttons |
| `primary-tint` | `#F5F0FF` | Pro plan card bg, QR detail box |
| `primary-border` | `#DDD6FE` | Pro card border (only colored border in system) |
| `primary-light` | `bg-violet-50` | Hover bg for interactive items |
| `primary-icon-bg` | `bg-violet-100` | IconBox background for purple icons |

### Semantic Pastels (per content section)
| Context | Background | Icon bg | Icon color |
|---|---|---|---|
| AI Energy / tokens | `bg-violet-50` | `bg-violet-100` | `text-[#8447FF]` |
| Sessions / progress | `bg-emerald-50` | `bg-emerald-100` | `text-emerald-600` |
| Token packs / money | items `bg-gray-50` | `bg-amber-100` | `text-amber-600` |
| Pro Love card | `bg-[#FFF0F8]` hero `bg-[#FFE4F0]` | — | `text-pink-500` |
| Upgrade card | `bg-[#EDE9FE]` hero `bg-[#DDD6FE]` | — | `text-[#8447FF]` |
| Invoices / neutral | `bg-white` | `bg-gray-100` | `text-gray-500` |

### Status Colors
| State | Color |
|---|---|
| Error / danger | `bg-rose-50 border-rose-200 text-rose-500` |
| Warning (usage >=70%) | `bg-amber-400` |
| Critical (usage >=90%) | `bg-rose-500` |
| Success | `bg-emerald-50 ring-emerald-100 text-emerald-500` |

> **Rule:** Never use raw hex values outside of `#8447FF`, `#7C3AED`, `#F5F0FF`, `#DDD6FE`, `#FFF0F8`, `#FFE4F0`, `#EDE9FE`. Everything else should be Tailwind palette classes.

---

## 3. Typography

### Font
```tsx
// layout.tsx
import { Lexend } from 'next/font/google';
const lexend = Lexend({ subsets: ['latin'], weight: ['300','400','500','600','700','800'], variable: '--font-lexend' });
```
Apply via: `font-[family-name:var(--font-lexend)]` on root layout and all modals.

### Scale
| Role | Class | Usage |
|---|---|---|
| Page heading | `text-lg font-bold text-gray-900` | Top bar title |
| Card heading | `text-xl font-bold text-gray-900` | Card H2 |
| Section label | `text-[10px] font-bold uppercase tracking-widest text-gray-400` | Field labels |
| Body | `text-sm text-gray-600` | Descriptions, feature lists |
| Secondary | `text-sm text-gray-500` | Sub-descriptions |
| Caption | `text-xs text-gray-400` | Timestamps, hints |
| Mono | `font-mono` | Transfer codes, token counts |
| Price large | `text-3xl font-bold text-gray-900` | Plan price hero |

---

## 4. Shape & Spacing

### Border Radius
| Element | Class |
|---|---|
| Cards | `rounded-3xl` |
| Buttons (primary) | `rounded-2xl` |
| Buttons (small/secondary) | `rounded-xl` |
| Sub-sections inside cards | `rounded-2xl` |
| Icon boxes | `rounded-2xl` |
| Badges / pills | `rounded-full` |
| Progress bars | `rounded-full` |

> **Rule:** Never use less than `rounded-xl` anywhere. Sharp corners are forbidden.

### Spacing
| Context | Padding |
|---|---|
| Card outer | `p-6` |
| Modal content | `p-6` or `p-7` |
| Sub-section inside card | `p-4` |
| Top bar | `px-5 pt-5 pb-4` |
| Page body | `px-4 py-5` |
| Max content width | `max-w-4xl mx-auto` |
| Grid gap | `gap-4` |

---

## 5. Shadow System

Cards use shadow **instead of** border to define edges.

```tsx
// Standard card
className="bg-white rounded-3xl shadow-sm p-6"

// Featured card
className="rounded-3xl bg-[#EDE9FE] shadow-sm overflow-hidden"

// Primary button only — gets shadow
className="shadow-md"
// Secondary buttons — no shadow
```

---

## 6. Component Patterns

### Card
```tsx
// White card (standard)
<Card>
  <CardHeader icon={<IconBox>...</IconBox>} title="Title" right={<Badge>opt</Badge>} />
</Card>

// Colored bento card — use raw div, not <Card>
<div className="rounded-3xl bg-[#EDE9FE] shadow-sm overflow-hidden flex flex-col h-full">
```

### IconBox
```tsx
// color: 'purple' | 'green' | 'amber' | 'gray'
<IconBox color="purple"><Zap className="w-4 h-4 text-[#8447FF]" /></IconBox>
```

| color | bg | Pair with |
|---|---|---|
| `purple` | `bg-violet-100` | `text-[#8447FF]` icons |
| `green` | `bg-emerald-100` | `text-emerald-600` icons |
| `amber` | `bg-amber-100` | `text-amber-600` icons |
| `gray` | `bg-gray-100` | `text-gray-500` icons |

### Badge
```tsx
<Badge variant="primary">Pro Active</Badge>   // #8447FF filled
<Badge variant="soft">Balance: 500k</Badge>   // violet-100 tint
<Badge variant="green">Active</Badge>         // emerald-100 tint
```

### Buttons
```tsx
// Primary CTA
"w-full py-4 rounded-2xl bg-[#8447FF] text-white font-bold text-sm hover:bg-[#7C3AED] active:scale-[0.98] transition-all shadow-md flex items-center justify-center gap-2"

// Secondary ghost
"w-full py-2.5 rounded-xl text-xs text-gray-500 hover:bg-violet-50 transition"

// Outline (e.g. share/referral)
"border border-pink-200 text-pink-500 rounded-2xl py-3 text-sm font-semibold hover:bg-pink-50 transition"
```

---

## 7. Layout — Bento Grid

```tsx
<div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
  <div className={hasSidebar ? 'lg:col-span-2' : 'lg:col-span-3'}>  {/* Main card */}
  <div className="lg:row-span-2">                                    {/* Sidebar card */}
  <div className={hasSidebar ? 'lg:col-span-2' : 'lg:col-span-3'}>  {/* Secondary card */}
  <div className="lg:col-span-3">                                    {/* Full-width card */}
```

### Grid state map
| User state | 2 cols (left) | 1 col (right) |
|---|---|---|
| Free | CurrentPlan + TokenPacks | UpgradeCard (row-span-2) |
| Pro | CurrentPlan + TokenPacks | ProLoveCard (row-span-2) |
| Always | Invoices (full 3 cols) | — |

---

## 8. Illustration Placement

```tsx
// Hero image pattern — always inside a colored div at top of card
<div className="w-full h-36 bg-[#DDD6FE] flex items-end justify-center overflow-hidden px-4 pt-4">
  {/* eslint-disable-next-line @next/next/no-img-element */}
  <img src="/illustration.svg" alt="..." className="h-full w-full object-contain object-bottom" />
</div>
```

| File | Card | Shown when |
|---|---|---|
| `/undraw_make-it-rain.svg` | UpgradeCard | User is Free |
| `/undraw_love.svg` | ProLoveCard | User is Pro |

**Rules:**
- `object-bottom` — character stands at the bottom edge
- Hero height: `h-36` to `h-40`
- Hero bg = slightly darker tint of card bg
- `overflow-hidden` on card ensures rounded corners clip the image

---

## 9. Modal / Overlay Pattern

```tsx
// Overlay — slides up on mobile, centered on desktop
<div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4">
  <div className="bg-white w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden font-[family-name:var(--font-lexend)] relative">
```

### 3-Step Checkout flow
```
Review (order summary + plan toggle) → QR (scan + transfer details) → Success (confetti + animation)
```

### Rules
- X close button **always visible** — never block exit
- QR step: add text-only "Cancel payment" at bottom (low prominence)
- Success: confetti + staged reveal animation
- Backdrop click closes (all steps)

---

## 10. Animation & Interaction

### Micro-interactions
| Element | Class |
|---|---|
| Primary button press | `active:scale-[0.98]` |
| Usage bar fill | `transition-all duration-700` |
| All color/opacity changes | `transition` or `transition-all` |

### Staged reveal (success modal)
```
100ms  → Icon scale in       (scale-50 → scale-100, opacity-0 → 100)
500ms  → Free→Pro badge      (translate-y-3 → 0)
900ms  → Headline + body     (translate-y-3 → 0)
1300ms → CTA button          (translate-y-3 → 0)
```

### Confetti
- Canvas-based, no external library
- 100 particles, colors: `['#8447FF','#C4B5FD','#8CFFDA','#FFB2E6','#FCD34D','#60A5FA','#F9A8D4']`
- Physics: gravity `+0.35`, air resistance `*0.99`, fade out via alpha

---

## 11. Icons

**Library:** `lucide-react` exclusively. No emoji in UI code.

| Context | Icon |
|---|---|
| AI tokens | `Zap` |
| Sessions | `Target` |
| Pro / premium | `Crown` |
| Reset / time | `Clock` |
| Token pack | `Package` |
| Invoice | `Receipt` |
| Payment | `CreditCard` |
| Download | `Download` |
| Error | `AlertCircle` |
| Success | `CheckCircle2` |
| Loading | `Loader2` + `animate-spin` |
| Back | `ArrowLeft` |
| Close | `X` |
| Share | `Share2` |
| Love | `Heart` + `fill-pink-500` |
| Upgrade | `Sparkles` |
| QR | `QrCode` |
| Savings | `TrendingUp` |

---

## 12. Do's and Don'ts

### Do
- Use `shadow-sm` to define cards (not colored borders)
- Use `rounded-3xl` on cards, `rounded-2xl` on buttons
- Apply Lexend on every new page: `font-[family-name:var(--font-lexend)]`
- Apply pastel tints at **section level**, not item level
- Keep all CTAs `#8447FF` — one accent throughout
- Place illustrations with `object-bottom` at card top
- Write all UI strings in **English**
- Use `items-end sm:items-center` on modals for mobile sheet UX

### Don't
- Don't use borders as primary card separators
- Don't use more than one accent color family per screen
- Don't use gradients — flat solid pastels only
- Don't use `#D972FF`, `#FFB2E6`, `#FFFFE8` — deprecated palette
- Don't use emoji icons — use Lucide components
- Don't use `rounded-lg` or smaller on cards
- Don't block modal close — X always visible
- Don't mix languages in UI strings

---

## 13. File Structure Reference

```
src/app/(main)/[feature]/
├── page.tsx                ← State + data fetching + grid layout only
└── _components/
    ├── ui.tsx              ← Primitives: UsageBar, Badge, Card, CardHeader, IconBox, ErrorBanner
    ├── cards.tsx           ← Bento cards
    └── modals.tsx          ← Overlays: 3-step flow, Confetti, staged animation

public/
└── *.svg                   ← unDraw illustrations (copy here from /illustration/)
```

---

## 14. Quick Reference Cheatsheet

```tsx
// Page wrapper
<div className="flex-1 flex flex-col bg-[#F8F9FB] overflow-hidden font-[family-name:var(--font-lexend)]">

// Top bar
<div className="flex-shrink-0 bg-white border-b border-gray-200 px-5 pt-5 pb-4 flex items-center gap-3">

// Standard card
<div className="bg-white rounded-3xl shadow-sm p-6">

// Colored bento card
<div className="rounded-3xl bg-[#EDE9FE] shadow-sm p-6">

// Primary button
<button className="w-full py-4 rounded-2xl bg-[#8447FF] text-white font-bold text-sm hover:bg-[#7C3AED] active:scale-[0.98] transition-all shadow-md">

// Section label
<p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">

// Modal overlay
<div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4">
  <div className="bg-white w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden font-[family-name:var(--font-lexend)] relative">
```
