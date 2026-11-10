# Sarfli design system

How the Sarfli web app looks and behaves, so every new screen feels like the same product.
Read this before building or changing any screen. When this file and the code disagree, fix one of them —
never add a third way.

**Scope**
- **App** (`src/app/(site)/**`): sellers and buyers. Most users are on cheap Android phones, many in Arabic.
  This file is mainly about the app.
- **Admin console** (`src/app/admin/**`): English-only, desktop-first, denser. See [Admin console](#admin-console).
- **Landing page** (`src/app/(landing)/**`) has its own "colour chapters" art direction (`.taste-skill/direction.json`)
  and is **not** covered here.

Reference screens that define the patterns below: `/sell`, `/sales`, `/sales/[id]`, `/wallet`.
New screens built on them: `/buy`, `/buy/sellers`, `/buy/recharge`, `/orders/[id]`, `/selling`.

---

## 1. Principles

1. **One obvious next action per screen.** The thing the user must do now is the biggest, greenest element.
   Everything else is quieter (outline/ghost buttons, collapsed sections, "Other options").
2. **Few words, everyday words.** Short sentences in the user's language. No jargon ("ledger", "bucket", "USSD"
   never appear in the app UI).
3. **Money is always exact and always readable.** Amounts use `<Dt>`; never format money by hand.
4. **Same thing, same look, same place.** A list of orders looks like the list of sales. A status always uses a
   badge. Operators are always shown with their logo.
5. **Instant feedback.** Every tap shows a reaction on press, and every action ends with a visible result
   (toast, new status, new screen).
6. **Works in Arabic first-class.** Every layout must be correct right-to-left.

---

## 2. Color

The app is neutral (white/near-black surfaces from the coss tokens in `src/app/globals.css`) with **one brand accent:
emerald**. Light and dark mode both come from the tokens; never hard-code `white`/`black` backgrounds.

| Role | Use | Classes |
| --- | --- | --- |
| **Accent / go** | The main action, money the user receives, the active nav tab | `Button variant="go"`, `text-emerald-700 dark:text-emerald-400`, `bg-emerald-600/12` (pill) |
| **Hero amount** | The one big balance on a page (wallet) | `rounded-2xl bg-emerald-700 p-6 text-white` |
| **Needs your action** | A card or note that waits for the user | `border-amber-500/50 bg-amber-500/6` (card), `bg-amber-50 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100` (note) |
| **Status** | Only through badges | `Badge` variants `info` · `success` · `warning` · `error` · `secondary` |
| **Operator color** | Only to identify an operator (see below) | `style={{ borderColor: op.color }}` / `OperatorLogo` |
| **Text** | Body / secondary | `text-foreground` / `text-muted-foreground` |

Rules:
- **Do not introduce a second accent.** No blue/sky/violet "themes" for a section. Buy and Sell are told apart by
  structure (menu divider, page titles, icons), not by color.
- **Operator colors identify an operator, nothing else.** Allowed: the operator logo; the border of an
  *operator choice card* (`/sell` step 1, recharge operator picker); the header band of a sale/order detail
  (`/sales/[id]`, `/orders/[id]`). Not allowed: using an operator color to mean "cheapest", "selected", "warning", etc.
- Destructive actions use `Button variant="destructive"` / `text-destructive-foreground`; never red text for anything else.

---

## 3. Typography

- **Fonts:** Inter (Latin) and IBM Plex Sans Arabic (Arabic) as `--font-sans`, swapped by locale in
  `src/app/layout.tsx`; Geist Mono for references and codes. Don't add fonts to the app.
- **Scale** (use exactly these):

| Element | Classes |
| --- | --- |
| Page title (one per page) | `font-heading font-bold text-3xl tracking-tight` |
| Big question / step title | `text-balance font-heading font-bold text-2xl leading-tight` |
| Section title | `font-heading font-semibold text-xl` — use `<SectionTitle>` |
| Card title | `font-semibold` or `font-semibold text-lg` |
| Body | default size, `text-muted-foreground` for secondary lines |
| Meta (dates, refs) | `text-muted-foreground text-xs` |
| Hero amount | `font-bold text-5xl` (wallet), `text-4xl` in result cards |
| List amount | `font-semibold text-lg` (rows) / `font-bold text-2xl` (balances, prices) |

- Tight tracking (`tracking-tight`) only on page titles. Never set letter-spacing on Arabic text (it breaks the joins):
  `uppercase tracking-wide` eyebrows are fine only because uppercase is a no-op in Arabic — don't add letter-spacing elsewhere.
- References (`RS-…`, `OR-…`, `RC-…`, USSD codes) are `font-mono`. Phone numbers are `dir="ltr"` and formatted with
  `formatMsisdn`.

---

## 4. Layout and spacing

- **Page shell** (every app page):
  ```tsx
  <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
  ```
  Wizard pages (`/sell`) may use `max-w-5xl` outside and `max-w-xl` for the content column. Nothing wider.
- **Vertical rhythm:** `gap-6` between page blocks, `gap-3` inside a section (title → content), `gap-1`–`gap-1.5`
  inside a row. Don't use `gap-8` on app pages.
- **Back link** (sub-pages only): ghost button, top of the page, then the title:
  ```tsx
  <Button variant="ghost" className="-ms-2 -mb-2 h-10 self-start text-base text-muted-foreground" render={<Link href="/buy" />}>
    <ArrowLeftIcon aria-hidden="true" className="rtl:rotate-180" />…
  </Button>
  ```
- **Radius:** `rounded-2xl` for cards, lists and hero blocks; `rounded-xl` for operator logos and small inner boxes;
  `rounded-full` for badges and pills.
- **Phone first:** design at 390px wide. Nothing may scroll sideways. The fixed bottom menu needs the footer's
  `pb-20` (already in the site layout).

---

## 5. Building blocks

Use these before writing new markup. UI primitives come from coss (`src/components/ui`, see the `coss` skill);
app pieces from `src/components/app`.

| Need | Use |
| --- | --- |
| Any money amount | `<Dt millimes={…} compact />` (`compact` = no `,000` on whole dinars) |
| Something private (amounts in lists, numbers, refs, payment details) | `<Secret>` — blurred in confidential mode |
| Operator | `<OperatorLogo code name color className="size-12 rounded-xl" />` |
| Choose an operator to filter a list | `<OperatorFilter>` (equal widths; logo over name on phones) |
| Choose an operator to start a flow | Big operator choice cards with the operator-colored border (as in `/sell`) |
| Sale status | `<StatusBadge status toOrder? />` |
| Order / recharge status | `<OrderStatusBadge>`, `<RechargeStatusBadge>` |
| Seller rating | `<Rating>` |
| Order in a list | `<OrderRow>` |
| Order that waits for the user | `<ActionOrderCard>` (amber card + one go button) |
| Section heading (+ hint, + action) | `<SectionTitle>` |
| Finished / old items | `<CollapsedList>` |
| Live data | `<AutoRefresh seconds>` only while something is in progress |
| Events of a sale/order | `<Timeline>` |
| Big amount input | `<BigInput>` |

**Buttons**
- `variant="go"` — the one main action. On phones: `className="h-14 w-full text-lg sm:h-14 sm:text-lg"` for a
  page-level action, `h-12 … text-base` inside a card.
- `variant="outline"` — secondary actions (`h-11`/`h-12` on phones). `variant="ghost"` — back links, "See all".
- `variant="destructive"` — cancel/delete, always behind a confirmation dialog (`AlertDialog`) when it can't be undone.
- One `go` button per card, at most one page-level `go` button visible at a time.
- Icons: lucide, `aria-hidden="true"`, before the label; a trailing arrow (`ArrowRightIcon className="rtl:rotate-180"`)
  means "go to another screen".

---

## 6. Patterns

**List** (sales, orders, recharges, balances, withdrawals)
```tsx
<ul className="flex flex-col divide-y overflow-hidden rounded-2xl border bg-card">
  <li><Link className="flex items-center gap-4 p-4 transition-colors hover:bg-accent/60">
    <OperatorLogo … className="size-12 rounded-xl" />
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">  {/* amount line, then badge + meta line */}</div>
    <ArrowRightIcon aria-hidden="true" className="size-5 shrink-0 text-muted-foreground rtl:rotate-180" />
  </Link></li>
</ul>
```
Order inside a row: amount first, then who/what, then `badge · date · ref`. Rows that don't open anything drop the
`Link` and the arrow.

**Hero amount** — one per page at most, only for the user's own money (wallet balance).

**Detail page** (`/sales/[id]`, `/orders/[id]`): back link → operator-colored header band (logo, title, amount) →
progress (steps) → **one "what to do now" card** → details (collapsed) → timeline.

**"Needs your action"** sections come first on home pages (`/buy`, `/selling`), oldest first, as `ActionOrderCard`s.
Then "in progress" as a list, then finished items in a `CollapsedList`.

**Empty state**
```tsx
<div className="flex flex-col items-center gap-4 py-12 text-center">
  <SomeIcon aria-hidden="true" className="size-10 text-muted-foreground/60" />
  <p className="text-muted-foreground">One short sentence.</p>
  {/* optional: the go button that fixes it */}
</div>
```
Inside a page that already has content above, a single line is enough:
`<p className="py-6 text-center text-muted-foreground">…</p>`.

**Notes from the team** (withdrawal note, warnings): amber note box with an icon, never a colored full card.

**Forms:** coss `Field`/`Input`/`Select`; amounts with `BigInput`; validate inline as the user types; the submit is the
`go` button; errors come back as translated codes (see the `errors` messages) and show as a toast or inline text.

---

## 7. Navigation

- **Without marketplace access:** Sell · My sales · My balance.
- **With marketplace access:** Buy | Sell · My sales · My balance — one menu, a thin divider separates the Buy side
  from the seller side. Same style for both sides; the active tab gets the emerald pill.
- Phones: fixed bottom bar (`SellerBottomNav`), icons `size-5.5`, labels `text-xs`. Desktop: `SellerTopNav` in the header.
- Labels say what's there ("My sales", "My balance"), not generic words ("Home", "Dashboard").
- Every sub-page has a back link; no screen is a dead end.

---

## 8. Motion and feedback

Motion is short and quiet. It confirms an action; it never decorates.

- **Press feedback on everything tappable:** `active:scale-[0.97]` with
  `transition-[…,scale] duration-150 ease-out` (`0.94` for small icon pills). coss buttons already have their own pressed state.
- **Hover:** color only (`hover:bg-accent/60`), `transition-colors`. Never animate layout properties.
- **Easing:** `ease-out` for things responding to the user, 150–200ms. No bounce/overshoot in the app — nothing here
  is thrown or dragged.
- **Disclosure:** chevrons rotate 180° (`transition-transform group-open:rotate-180`).
- **Loading:** buttons use their `loading` prop; in-progress statuses use the spinning `LoaderIcon` inside the badge.
  No skeletons for content that loads with the page.
- **Results:** toasts (`toastManager`) for success/error of an action; the page itself then shows the new state.
- **Reduced motion:** decorative motion goes under `motion-safe:`; spinners and color changes may stay.

---

## 9. Arabic, French, English

- Every string comes from `messages/{en,fr,ar}.json` (same keys in all three). Admin console is English-only.
- Use logical classes only: `ms-/me-/ps-/pe-/start-/end-/text-start/text-end`. Never `ml-/mr-/pl-/pr-/left-/right-`.
- Directional icons flip: `rtl:rotate-180` on arrows and chevrons that point "forward/back".
- Numbers, phone numbers, refs and codes stay left-to-right (`dir="ltr"`) inside Arabic text.
- Check long words: "Tunisie Telecom", French labels are ~30% longer than English; let text wrap (`text-balance`)
  instead of truncating important words.

---

## 10. Accessibility

- Tap targets ≥ 44px on phones (coss buttons and badges already extend their hit area on coarse pointers).
- Decorative icons `aria-hidden="true"`; icon-only buttons need an `aria-label`.
- Current nav item / filter uses `aria-current="page"`.
- Don't convey meaning by color alone: statuses always have an icon and a label.
- Contrast: muted text only on `background`/`card`, never on colored fills.

---

## Admin console

Same tokens and components, denser and English-only.
- Page header: `<PageHeader title description actions>` (`text-2xl` semibold).
- Data in coss `Table` inside `Frame`; numbers right-aligned; statuses with `AdminStatusBadge` / market badges.
- Dashboard numbers with `<StatCard>`; relative times with `<TimeAgo>`.
- Actions through `useAdminAction` (handles toasts and error codes). Dangerous actions ask for a note and confirm.
- Any operation that moves real credit or money states what will happen in plain words before confirming.

---

## Before shipping a screen

- [ ] Built from the blocks and patterns above; no new color, font, radius or spacing value.
- [ ] One clear main action; secondary actions quieter.
- [ ] All amounts via `<Dt>`; private values in `<Secret>`.
- [ ] Checked at 390px wide in **French and Arabic**: no sideways scroll, nothing cut off, arrows flipped.
- [ ] Empty, loading, error and "nothing to do" states exist.
- [ ] Every string translated in en/fr/ar.
- [ ] Taps give feedback on press.
