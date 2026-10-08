# IBSS — Landing page (Moroccan Darija, RTL, mobile-first)

A single-product, single-page COD landing page for a digestive-comfort food
supplement sold in Morocco. Arabic (Moroccan Darija), RTL, no framework, no
build step, no dependencies.

```
index.html               semantic RTL markup, inline critical CSS, inline SVG sprite
assets/css/tokens.css    design tokens (colour, type, space, motion)
assets/css/base.css      reset, typography, buttons, cards, callouts, reveal
assets/css/components.css  the 13 sections, sticky bars, order form
assets/js/app.js         countdown, packs, validation, submit, Pixel, reveal, sticky CTA
assets/fonts/            self-hosted Cairo (variable, Arabic + Latin)
assets/img/              image upload slots — see assets/img/README.md
backend/apps-script/     Google Apps Script order intake
tools/validate.js        pre-deploy sanity checks
```

## Before you go live (2 required steps)

### 1. Connect the order form

The form posts to a Google Apps Script Web App. Full instructions are at the
top of [`backend/apps-script/Code.gs`](backend/apps-script/Code.gs); the short
version:

1. Create a Google Sheet with a tab named `Orders`.
2. Extensions → Apps Script → paste `Code.gs` → set `NOTIFY_EMAIL`.
3. Deploy → New deployment → **Web app**, *Execute as: Me*, *Who has access:
   Anyone*. Copy the `/exec` URL.
4. Paste it into `assets/js/app.js`:

```js
FORM_ENDPOINT: 'https://script.google.com/macros/s/AKfy…/exec',
```

Until this is set the page shows a loud amber **setup warning** and refuses to
pretend an order was sent. That is deliberate: a silently unconfigured form
loses real customers.

### 2. Replace the placeholders

| Placeholder | Where |
|---|---|
| `[اسم المنتج]` | section 8 heading + lead, footer brand, footer copyright |
| `المكوّن 01/02/03`, `الكمية: X` | section 8 ingredient cards — copy them off the official label |
| the three testimonials | section 10 — **only real ones**; otherwise delete the section |
| six image slots | see [`assets/img/README.md`](assets/img/README.md) |

## Configuration

Everything else lives in the `CONFIG` block at the top of `assets/js/app.js`:

```js
FORM_ENDPOINT:    'PASTE_YOUR_APPS_SCRIPT_EXEC_URL_HERE',
META_PIXEL_ID:    '',   // digits only; empty = no Pixel requests at all
COUNTDOWN_MINUTES: 45,  // session offer length, per visitor
STOCK_LEFT:        7    // drives every "باقي X بلايص" line on the page
```

- **`META_PIXEL_ID`** — empty by default, so the page makes **zero** third-party
  requests until you set it. Events fired: `PageView` on load,
  `InitiateCheckout` on first form interaction, `Purchase` on success. Each
  fires at most once per page view.
- **`STOCK_LEFT`** — one number feeds all three scarcity mentions (hero,
  offer note, sticky bar), so the page can never contradict itself.
  **Keep it honest**: it must reflect real remaining stock.

## Honesty / compliance rules baked in

These are not decoration — the page is built so it cannot drift:

- The countdown lives in `sessionStorage`. A refresh does not reset it mid-visit,
  and a new session starts a fresh window. It is a session offer, not a fake
  ever-dwindling number.
- No cure, treat, or heal wording. The validator fails the build on
  `كيعلج / كيشفي / كيداوي`.
- Two medical disclaimers survive any edit: the green callout in section 7 and
  the footer health warning.
- `[اسم المنتج]` is styled with a dotted underline so unreplaced spots are
  obvious while drafting.
- Testimonials carry a comment: real quotes only, or drop the section.

## The 13 sections

1. Sticky top bar — live countdown
2. Hero — badged H1, product stage, trust row
3. Time cost — loss-aversion anchor + large clock
4. Two women — social contrast, split 50/50
5. Recognize — three mirror cards
6. Hidden laugh — split square visual
7. Education — 5-step gut-brain flow + medical callout
8. Product — stage, three ingredient cards, honesty + fact list
9. Offer stack — value table, guarantee, three radio packs
10. Testimonials — three quotes
11. Risk reduction — 3 steps + reassurance
12. FAQ — six accordions (`<details>`, works without JS)
13. Final push + order form, success state

Plus: sticky bottom CTA (mobile only) and the footer.

## Editing

No build step. Edit the files, refresh the browser. To preview locally:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Do not open `index.html` via `file://` — the font and stylesheet paths need a
server, and `sessionStorage` behaves inconsistently.

### Regenerating the critical CSS

The `<style>` block in `index.html` is a hand-extracted subset of
`tokens.css` + `base.css` (tokens, reset, topbar, hero, stage, button). If you
change a token or a hero rule, mirror it there too, or the first paint flashes
unstyled. The values are intentionally identical, so there is no override.

### Fonts

Cairo is self-hosted as two variable-font subsets (~63 KB total) covering
weights 200–1000:

- `cairo-arabic-wght.woff2` — Arabic
- `cairo-latin-wght.woff2` — Latin (digits, "PDF", "COD")

Latin is declared first so Latin glyphs resolve there and Arabic falls through
to the Arabic subset. Both are preloaded. Licensed under the SIL Open Font
License — see `assets/fonts/OFL.txt`.

To swap in different weights, pull `@fontsource-variable/cairo` and replace the
two files; the `@font-face` rules need no change.

## Checks

```bash
node tools/validate.js
```

Static analysis. Fails on: broken sprite references, JS hooks with no matching
markup, HTML classes with no CSS, unused CSS, page weight over 300 KB, missing
`lang="ar" dir="rtl"`, French copy, cure/treat/heal wording, a missing medical
or footer disclaimer, a missing order form or city datalist, any `<img>` tag in
a placeholder-only section, and fewer than 40 cities.

Current status: **0 failures, 1 warning** (the warning is the phrase
`كيعالج هاد الإشارات` in section 7 — the spec's own gut-brain wording meaning
"the brain processes signals", not a treatment claim).

```bash
npm install --no-save jsdom
node tools/test-behaviour.js
```

Behavioural suite: runs the real `index.html` + `app.js` in jsdom and asserts
the interactive logic end to end — **53 assertions, all passing**. Covers the
countdown (including `sessionStorage` reuse and the top bar/clock staying in
sync), pack selection syncing both radio groups and the live summary, the
Moroccan phone rule against valid and invalid numbers, every validation error
path, a full submit → success-state round trip including the POST payload and
order reference, the honeypot, and — importantly — that an **unconfigured
endpoint never fakes a successful order**.

Both are dev-only; the page itself needs no npm and no build step.

## Technical notes

- **RTL** via `<html lang="ar" dir="rtl">`. Numbers, prices and the phone field
  carry `dir="ltr"` islands so the bidi algorithm never reorders them.
- **Contrast** — every pairing was measured: white on `#0F6B3E` is 6.58:1,
  on `#0A3A2A` 12.72:1, muted `#5A6B60` on white 5.67:1, alert `#C0392B` with
  white 5.44:1. Two rules follow from the numbers:
  `--green-500` is **never** used for text (4.37:1 — fails AA), and scarcity
  badges are **solid red with white text**, never red text on green (1.21:1).
- **Scarcity badge** markup is `.eyebrow--alert` / `.pack__ribbon--alert`.
- **Progressive enhancement** — an inline script adds `.js` to `<html>` before
  first paint. The scroll-reveal rule is scoped to `.js`, so with JavaScript
  disabled the full page renders instead of a screen of blanks.
- **Accessibility** — skip link, 44px touch targets, visible focus rings
  (white on green surfaces), `role="alert"` on validation errors,
  `aria-describedby` wiring, ARIA labels on icon-only controls, native
  `<details>` for the FAQ, and honouring `prefers-reduced-motion`.
- **Page weight** ~200 KB including fonts.

## Known trade-offs

- **Sticky CTA copy.** The brief specified `بغيت نطلب دابا` for the mobile bar,
  but its own strict copy rule bans `بغيت` in CTAs in favour of ownership verbs
  (`خدي` / `بداي` / `أكد`). The rule won: the button reads **`خدي الطلب دابا`**.
  Change it in `index.html` if the literal string was intended.
- **FAQ answer 5** was given in MSA in the brief; it is now Darija
  (`نعم، كتقدر تشوف المنتوج وتتحقق منو قبل ما تخلص`) to match the language rule.
- **Pack radios** exist twice (offer stack + form). Separate DOM positions make
  them separate browser radio groups, so `app.js` binds both to one piece of
  state keyed by `data-pack-input` — a choice in either place updates the other
  and the live summary.
- The offer-stack packs use a label overlay (`::after`) rather than wrapping the
  card in a `<label>`, so the `خدي هادي` button is not nested inside a label.
