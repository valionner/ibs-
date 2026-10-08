# assets/img — upload slots

The page ships with **no product visual**, on purpose. Every image position is a
clean square placeholder you replace with a real photo.

## Rules

- **1:1 square, 1080 × 1080.** The containers use `aspect-ratio: 1 / 1`, so any
  other ratio gets cropped.
- **JPG, ideally < 150 KB.** Run it through an image compressor first.
- **Always lazy-load** except the hero (`loading="eager"`).
- **Always set `width` / `height` and a real Arabic `alt`.** The width/height
  stop the page from jumping as images arrive; the alt is what a screen reader
  and Google see.
- Never render a bottle or capsule in the placeholder itself — the brief calls
  for an empty stage, and the owner supplies the official pack shot.

## The six slots

| `data-slot`        | Section | Suggested file            | Notes |
|--------------------|---------|---------------------------|-------|
| `product-hero`     | 2 Hero  | `product-hero.jpg`        | First thing seen. `loading="eager"`, `fetchpriority="high"`. |
| `woman-ahead`      | 4 Two women | `woman-ahead.jpg`     | She who started. Green-tinted card. |
| `woman-waiting`    | 4 Two women | `woman-waiting.jpg`   | Still waiting. Faded card. |
| `face-public`      | 6 Hidden laugh | `face-public.jpg`   | Top half of the split square (green). |
| `face-private`     | 6 Hidden laugh | `face-private.jpg`  | Bottom half of the split square (grey). |
| `product-detail`   | 8 Product | `product-detail.jpg`    | Pack shot beside the ingredient cards. |

Sections 10 and 11 have no image slots by design.

## How to fill a slot

Find the `data-slot="…"` block in `index.html` and replace the placeholder
element's children with an `<img>`, adding `is-filled` to the stage:

```html
<!-- before -->
<div class="stage" data-slot="product-detail">
  <svg class="stage__icon" aria-hidden="true"><use href="#i-image"/></svg>
  <span class="stage__label">بلاصة صورة المنتج الرسمية</span>
  <span class="stage__meta">مربع 1:1 — 1080 × 1080</span>
</div>

<!-- after -->
<div class="stage is-filled" data-slot="product-detail">
  <img src="assets/img/product-detail.jpg"
       alt="علبة المنتج — 30 كبسولة"
       width="1080" height="1080" loading="lazy" decoding="async">
</div>
```

`is-filled` removes the dashed border and the label, and makes the image fill
the square via `object-fit: cover`.

## Photos of people

Sections 4 and 6 compare two women. Only use photos you have the right to use,
and prefer real customers over stock. If you use stock, avoid images that imply
a medical result. Crop so the subject's face stays centred in the square.

## Then check your work

```
node tools/validate.js
```

It fails the build if an `<img>` sneaks into a section that should only hold a
placeholder, and if any asset path is dead.
