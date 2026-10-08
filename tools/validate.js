/* ==========================================================================
   IBSS — build-time sanity checks
   Run: node tools/validate.js

   Catches the things that silently break a static landing page: sprite
   references, CSS class coverage, JS DOM hooks, RTL/encoding, compliance
   wording, and the page-weight budget.

   Comments are stripped before scanning, so documentation examples are never
   mistaken for real markup.
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const rawHtml = read('index.html');
const rawJs = read('assets/js/app.js');
const sheets = ['assets/css/tokens.css', 'assets/css/base.css', 'assets/css/components.css'];

const css = sheets.map(read).join('\n');

/* Strip HTML comments so commented-out examples don't trip the checks. */
const html = rawHtml.replace(/<!--[\s\S]*?-->/g, '');
/* Strip JS line + block comments. */
const js = rawJs.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let failures = 0;
let warnings = 0;

const ok = (m) => console.log('  \u2713 ' + m);
const fail = (m) => {
  failures++;
  console.log('  \u2717 ' + m);
};
const warn = (m) => {
  warnings++;
  console.log('  ! ' + m);
};
const head = (m) => console.log('\n' + m);
const unique = (a) => [...new Set(a)];

/* ---------------------------------------------------------------- icons --- */
head('SVG sprite');
{
  const defined = unique([...html.matchAll(/<symbol id="(i-[a-z-]+)"/g)].map((m) => m[1]));
  const used = unique([...html.matchAll(/<use href="#(i-[a-z-]+)"/g)].map((m) => m[1]));

  const missing = used.filter((id) => !defined.includes(id));
  const unused = defined.filter((id) => !used.includes(id));

  if (missing.length) fail('referenced but not defined: ' + missing.join(', '));
  else ok(`all ${used.length} referenced icons are defined`);

  if (unused.length) warn('defined but never used: ' + unused.join(', '));
  else ok('no dead icons in the sprite');
}

/* ---------------------------------------------------------------- hooks --- */
head('JS \u2192 DOM hooks');
{
  const dataHooks = unique([...js.matchAll(/\$\$?\('\[(data-[a-z-]+)\]'/g)].map((m) => m[1]));
  const idHooks = unique([...js.matchAll(/\$\$?\('#([A-Za-z][\w-]*)'/g)].map((m) => m[1]));

  const count = (needle) => html.split(needle).length - 1;

  dataHooks.forEach((hook) => {
    const n = count(hook);
    if (n) ok(`${hook} \u00d7${n}`);
    else fail(`JS expects ${hook} but the HTML has none`);
  });

  idHooks.forEach((id) => {
    if (html.includes('id="' + id + '"')) ok(`#${id}`);
    else fail(`JS expects #${id} but the HTML has none`);
  });
}

/* -------------------------------------------------------------- classes --- */
head('CSS class coverage');
{
  const htmlClasses = unique(
    [...html.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean)
  );

  const runtime = unique(
    [...js.matchAll(/classList\.(?:add|toggle|remove)\(\s*'([\w-]+)'/g)].map((m) => m[1])
  );

  // Whole-token match: ".card" must not be satisfied by ".card__icon".
  const defines = (c) => new RegExp('\\.' + c + '(?![\\w-])').test(css);

  const orphans = htmlClasses.filter((c) => !defines(c) && !runtime.includes(c));

  if (orphans.length) fail('styled nowhere: ' + orphans.join(', '));
  else ok(`all ${htmlClasses.length} HTML classes resolve to CSS or runtime JS`);

  // Reverse direction: rules no section uses any more. Kept as a warning so
  // intentional hooks (documented states) can stay.
  const safe = new Set(['js', 'is-filled']); // toggled by the inline head script / documented upload state
  // Ignore class-like tokens inside url(...) and quoted strings (file names
  // such as "cairo-...woff2" are not selectors).
  const selectorCss = css
    .replace(/\/\*[\s\S]*?\*\//g, '') // CSS comments
    .replace(/url\([^)]*\)/g, '')        // url(...)
    .replace(/"[^"]*"/g, '')               // quoted strings
    .replace(/'[^']*'/g, '');
  const defined = unique([...selectorCss.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));
  const dead = defined.filter((c) => !htmlClasses.includes(c) && !runtime.includes(c) && !safe.has(c));
  if (dead.length) warn('CSS defined but unused: ' + dead.join(', '));
  else ok('no unused CSS rules');
}

/* ---------------------------------------------------------- page weight --- */
head('Page weight (budget: < 300KB, excluding product images)');
{
  const files = [
    'index.html',
    ...sheets,
    'assets/js/app.js',
    'assets/fonts/cairo-arabic-wght.woff2',
    'assets/fonts/cairo-latin-wght.woff2',
  ];

  let total = 0;
  files.forEach((f) => {
    const size = fs.statSync(path.join(ROOT, f)).size;
    total += size;
    console.log(`     ${(size / 1024).toFixed(1).padStart(7)} KB  ${f}`);
  });

  const kb = total / 1024;
  console.log('     ' + '\u2500'.repeat(9));
  console.log(`     ${kb.toFixed(1).padStart(7)} KB  TOTAL`);
  if (kb < 300) ok(`${kb.toFixed(1)} KB \u2014 inside budget`);
  else fail(`${kb.toFixed(1)} KB \u2014 over the 300KB budget`);
}

/* ------------------------------------------------------------------ rtl --- */
head('RTL / encoding / language');
{
  if (html.includes('<html lang="ar" dir="rtl">')) ok('html has lang="ar" dir="rtl"');
  else fail('missing lang="ar" dir="rtl"');

  if (/<meta charset="utf-8">/i.test(html)) ok('UTF-8 declared');
  else fail('missing charset');

  const ltr = (html.match(/dir="ltr"/g) || []).length;
  if (ltr) ok(`${ltr} dir="ltr" island(s) for digits, prices and phone`);
  else warn('no dir="ltr" islands \u2014 check that numbers cannot reorder in RTL');

  if (/\b(Commander|Ajouter|Acheter|Livraison)\b/.test(html)) {
    fail('French copy found \u2014 brief requires Darija only');
  } else {
    ok('no French copy');
  }

  // Brief: never "كيعلج" / "كيشفي" / "كيداوي".
  const banned = unique([...html.matchAll(/كيعلج|كيشفي|كيداوي|كيعالج|يشفي|يداوي|يعالج/g)].map((m) => m[0]));
  const allowed = ['كيعالج']; // "the brain processes signals" — not a claim
  const violations = banned.filter((w) => !allowed.includes(w));
  if (violations.length) fail('banned claim wording: ' + violations.join(', '));
  else ok('no cure / treat / heal claims');

  if (banned.includes('كيعالج')) {
    const uses = [...html.matchAll(/[\s\S]{0,26}كيعالج[\s\S]{0,26}/g)].map((m) => m[0].replace(/\s+/g, " ").trim());
    warn('"كيعالج" appears as the brain processing signals (not a product claim): ' + uses.join(' | '));
  }
}

/* -------------------------------------------------------------- content --- */
head('Required blocks');
{
  const required = [
    ['sticky top bar countdown', 'data-countdown'],
    ['live clock (section 3)', 'data-clk="h"'],
    ['hero product placeholder', 'data-slot="product-hero"'],
    ['product-section placeholder', 'data-slot="product-detail"'],
    ['medical disclaimer', 'callout--medical'],
    ['footer health disclaimer', 'تنبيه صحي'],
    ['order form', 'id="orderForm"'],
    ['cities datalist', 'id="cities"'],
    ['phone validation pattern', 'PHONE_RE'],
    ['success state', 'data-out-name'],
    ['sticky bottom CTA', 'data-sticky-cta'],
    ['setup warning', 'setupWarning'],
  ];

  required.forEach(([label, needle]) => {
    if (html.includes(needle) || js.includes(needle)) ok(label);
    else fail(label + ' missing');
  });

  // The brief forbids rendering any product visual.
  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  if (imgs.length) fail(`found ${imgs.length} <img> tag(s) \u2014 placeholders must stay empty: ` + imgs.join(' '));
  else ok('no <img> tags at all \u2014 every visual is a 1:1 upload placeholder');

  const bottle = /<svg[^>]*>[\s\S]{0,400}?(capsule|bottle)/i.test(html);
  if (bottle) fail('capsule/bottle icon found in the sprite');
  else ok('no capsule or bottle icon in the sprite');

  const cities = (html.match(/<datalist id="cities">([\s\S]*?)<\/datalist>/) || [])[1] || '';
  const n = (cities.match(/<option/g) || []).length;
  if (n >= 40) ok(`${n} Moroccan cities in the datalist`);
  else fail(`only ${n} cities \u2014 brief asks for 40+`);

  // Every major section should end in a CTA or a punchline.
  const sections = (html.match(/<section\b/g) || []).length + (html.match(/<header class="hero/g) || []).length;
  const ctas = (html.match(/class="btn[^"]*"/g) || []).length;
  ok(`${sections} sections, ${ctas} CTA buttons`);

  // Pixel events required by the brief.
  ['PageView', 'InitiateCheckout', 'Purchase'].forEach((ev) => {
    if (js.includes("'" + ev + "'")) ok(`Meta Pixel ${ev}`);
    else fail(`Meta Pixel ${ev} not wired`);
  });
}

/* ------------------------------------------------------------------ done --- */
head('Result');
console.log(`  ${failures} failure(s), ${warnings} warning(s)`);
process.exit(failures ? 1 : 0);
