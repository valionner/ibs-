#!/usr/bin/env node
/**
 * Behavioural test for the IBSS landing page.
 * Runs the REAL index.html + app.js in jsdom and asserts the interactive
 * logic: countdown, pack selection, validation, submit, success state.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
let JSDOM, VirtualConsole;
try {
  ({ JSDOM, VirtualConsole } = require('jsdom'));
} catch (e) {
  console.error('This suite needs jsdom:  npm install --no-save jsdom');
  process.exit(2);
}

const SRC = path.join(__dirname, '..');
const TMP = path.join(os.tmpdir(), 'ibss-behaviour');

let pass = 0;
let fail = 0;
const ok = (m) => { pass++; console.log('  \u2713 ' + m); };
const no = (m) => { fail++; console.log('  \u2717 ' + m); };
const eq = (actual, expected, label) =>
  actual === expected ? ok(`${label} = ${JSON.stringify(actual)}`)
                     : no(`${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);

/* ---- build a test copy with a live-looking endpoint + pixel id ---------- */
function buildSite(opts = {}) {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  fs.cpSync(path.join(SRC, 'assets'), path.join(TMP, 'assets'), { recursive: true });

  let js = fs.readFileSync(path.join(SRC, 'assets/js/app.js'), 'utf8');
  if (!opts.placeholder) {
    js = js.replace(/FORM_ENDPOINT: '[^']*'/, "FORM_ENDPOINT: 'https://example.com/exec'");
  }
  js = js.replace(/META_PIXEL_ID: '[^']*'/, "META_PIXEL_ID: '123456789012345'");
  fs.writeFileSync(path.join(TMP, 'assets/js/app.js'), js);

  // jsdom cannot fetch external scripts without a server, so inline app.js.
  let html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
  // NOTE: use a replacer FUNCTION. A plain string replacement would treat
  // "$$" inside app.js as an escape sequence and silently rewrite every
  // $$() helper call into $(), breaking the page under test.
  html = html.replace(
    '<script src="assets/js/app.js" defer></script>',
    () => '<script>' + js + '<\/script>'
  );
  fs.writeFileSync(path.join(TMP, 'index.html'), html);
}

async function boot(opts = {}) {
  const vc = new VirtualConsole();
  const logs = [];
  vc.on('jsdomError', (e) => logs.push('jsdomError: ' + (e.detail && e.detail.stack ? e.detail.stack : e.message)));
  vc.on('error', (...a) => logs.push('error: ' + a.join(' ')));

  const html = fs.readFileSync(path.join(TMP, 'index.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: 'http://localhost/',
    runScripts: 'dangerously',
    pretendToBeVisual: false,
    virtualConsole: vc,
  });

  // Stub network + Pixel before scripts run.
  const w = dom.window;
  // jsdom has no layout engine: scrollIntoView does not exist. Polyfill it.
  if (!w.Element.prototype.scrollIntoView) {
    w.Element.prototype.scrollIntoView = function () {};
  }
  if (!w.HTMLElement.prototype.scrollIntoView) {
    w.HTMLElement.prototype.scrollIntoView = function () {};
  }
  const calls = [];
  w.fetch = (url, init) => {
    calls.push({ url, body: init && init.body });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
  };
  w.eval("window.fbq = function(){}");

  await new Promise((r) => {
    if (w.document.readyState === 'complete') r();
    else w.addEventListener('load', r);
  });
  await new Promise((r) => setTimeout(r, 40));
  return { dom, w, d: w.document, calls, logs };
}

const watchdog = setTimeout(() => {
  console.log('\n!! timed out — partial results above');
  process.exit(1);
}, 40000);
watchdog.unref && watchdog.unref();

(async () => {
  buildSite();

  /* ===================== 0. script execution ===================== */
  console.log('\nScript execution');
  {
    const { d, logs } = await boot();
    if (d.documentElement.classList.contains('js')) ok('inline head script ran (.js class set)');
    else { no('inline head script did not run'); }
    // app.js must have rewritten the stock count to prove it executed.
    const stock = [...d.querySelectorAll('[data-stock]')].map((n) => n.textContent.trim());
    if (stock.length && stock.every((v) => v === '7')) ok('app.js ran (stock nodes rewritten)');
    else no('app.js did not run: stock = ' + JSON.stringify(stock));
    if (logs.length) { no('console errors during boot:'); logs.slice(0, 6).forEach((l) => console.log('      ' + l)); }
    else ok('no console errors during boot');
    // The LAST inline script is the injected app.js (the first is the .js marker).
    const inlineAll = [...d.querySelectorAll('script:not([src])')];
    const inlined = inlineAll[inlineAll.length - 1];
    const injected = String(inlined && inlined.textContent);
    if (injected.includes('querySelectorAll')) ok('harness check: $$ helper survived injection');
    else no('harness corrupted the $$ helper');
  }

  /* ===================== 1. countdown ===================== */
  console.log('\nCountdown');
  {
    const { w, d } = await boot();
    const bar = d.querySelector('[data-countdown]');
    const first = bar.textContent.trim();
    if (/^\d{2}:\d{2}:\d{2}$/.test(first)) ok(`top bar shows ${first}`);
    else no(`top bar format wrong: ${JSON.stringify(first)}`);

    // Must be counting DOWN from the configured 45 minutes.
    const [h, m] = first.split(':').map(Number);
    if (m > 45 || (h === 0 && m > 45)) no(`should start near 45:00, got ${first}`);
    else ok('starts inside the configured window');

    // Regression: the three clock spans share no id, so a naive el.id cache
    // skipped updates when two units held the same value (e.g. 00:00:00).
    const hh = d.querySelector('[data-clk="h"]').textContent.trim();
    const mm = d.querySelector('[data-clk="m"]').textContent.trim();
    const ss = d.querySelector('[data-clk="s"]').textContent.trim();
    ok(`clock units: ${hh} : ${mm} : ${ss}`);
    if (hh === first.slice(0, 2) && mm === first.slice(3, 5)) ok('clock agrees with top bar');
    else no('clock desynced from top bar');

    // sessionStorage persistence across a reload
    const stored = w.sessionStorage.getItem('ibss_deadline');
    if (stored && Number(stored) > Date.now()) ok('deadline persisted in sessionStorage');
    else no('deadline not persisted');

    const { d: d2 } = await boot();
    const second = d2.querySelector('[data-countdown]').textContent.trim();
    ok(`after reload the deadline is reused (${second})`);
  }

  /* ===================== 2. packs + summary ===================== */
  console.log('\nPack selection + live summary');
  {
    const { d } = await boot();
    const total = () => d.querySelector('[data-summary-total]').textContent.trim();
    const pack = () => d.querySelector('[data-summary-pack]').textContent.trim();
    const qty = () => d.querySelector('[data-summary-qty]').textContent.trim();

    eq(total(), '299 درهم', 'default total (2-pack)');
    eq(qty(), '2 علبة', 'default qty');

    // Click the 1-box card in the OFFER STACK...
    d.querySelector('#offer-p1').closest('.pack').querySelector('.pack__cta')
      .dispatchEvent(new d.defaultView.Event('click', { bubbles: true }));
    eq(total(), '249 درهم', 'offer-stack click updates summary');
    eq(pack(), 'علبة واحدة — 30 كبسولة', 'summary pack name');

    // ...and the two radio groups must agree with each other.
    eq(d.querySelector('#form-p1').checked, true, 'form radio synced to offer radio');
    eq(d.querySelector('#offer-p1').checked, true, 'offer radio checked');
    eq(d.querySelector('#form-p2').checked, false, 'stale form radio released');

    // Sticky bar price follows too.
    eq(d.querySelector('[data-sticky-price]').textContent.trim(), '249 درهم', 'sticky price follows');

    // Then pick from the FORM group and check the offer group follows back.
    const formP3 = d.querySelector('#form-p3');
    formP3.checked = true;
    formP3.dispatchEvent(new d.defaultView.Event('change', { bubbles: true }));
    eq(total(), '365 درهم', 'form radio updates summary');
    eq(d.querySelector('#offer-p3').checked, true, 'offer radio synced back');
    const sel = d.querySelectorAll('.pack.is-selected');
    eq(sel.length, 2, 'highlight applied to both groups');

    // Savings note
    const save = d.querySelector('[data-pack-card="p3"] .pack__save');
    eq(save.textContent.trim(), 'كتوفري 382 درهم', 'savings vs 3x single price');
  }

  /* ===================== 3. validation ===================== */
  console.log('\nForm validation');
  {
    const { w, d } = await boot();
    const form = d.querySelector('#orderForm');
    const submit = () => form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    const err = (id) => {
      const p = d.querySelector('#' + id);
      return p.hasAttribute('hidden') ? '' : p.textContent.trim();
    };

    // Empty submit must block and flag all three fields.
    submit();
    if (err('fullName-error')) ok('empty name blocked: ' + err('fullName-error').slice(0, 30) + '…');
    else no('empty name not blocked');
    if (err('phone-error')) ok('empty phone blocked');
    else no('empty phone not blocked');
    if (err('city-error')) ok('empty city blocked');
    else no('empty city not blocked');
    if (!d.querySelector('#orderCard').classList.contains('is-done')) ok('no success state on invalid submit');
    else no('success shown despite invalid form');

    // Moroccan phone rule ^(\+212|0)([5-7])\d{8}$
    const phone = d.querySelector('#phone');
    const good = ['0612345678', '+212612345678', '0712345678', '0522334455'];
    const bad = ['061234567', '06123456789', '0812345678', '1234567890', '+3312345678', 'ابc'];

    phone.value = '0812345678'; // 8 is not a valid Moroccan mobile prefix
    submit();
    if (err('phone-error')) ok('rejects 08… prefix');
    else no('accepted an invalid prefix');

    phone.value = '061234567';
    submit();
    if (err('phone-error')) ok('rejects 9 digits');
    else no('accepted a 9-digit number');

    phone.value = '0612345678';
    d.querySelector('#fullName').value = 'سعاد بنعلي';
    d.querySelector('#city').value = 'الدار البيضاء';
    submit();
    eq(err('phone-error'), '', 'accepts 0612345678');

    // Name guard
    d.querySelector('#fullName').value = 'س1';
    d.querySelector('#city').value = 'فاس';
    submit();
    if (err('fullName-error')) ok('rejects digits inside a name');
    else no('accepted a name containing digits');

    // Typing clears a shown error
    d.querySelector('#fullName').value = 'خديجة';
    d.querySelector('#fullName').dispatchEvent(new w.Event('input', { bubbles: true }));
    eq(err('fullName-error'), '', 'error clears while the user fixes it');
  }

  /* ===================== 4. successful submit ===================== */
  console.log('\nSubmit \u2192 success state');
  {
    const { w, d, calls } = await boot();
    const form = d.querySelector('#orderForm');
    d.querySelector('#fullName').value = 'نادية العلوي';
    d.querySelector('#phone').value = '0612345678';
    d.querySelector('#city').value = 'مراكش';
    d.querySelector('#form-p2').checked = true;

    form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 120));

    if (!calls.length) { no('nothing was POSTed'); return; }
    const sent = JSON.parse(calls[0].body);
    eq(sent.name, 'نادية العلوي', 'payload name');
    eq(sent.phone, '0612345678', 'payload phone');
    eq(sent.city, 'مراكش', 'payload city');
    eq(sent.total, 299, 'payload total');
    eq(sent.qty, 2, 'payload qty');
    eq(sent.currency, 'MAD', 'payload currency');

    if (d.querySelector('#orderCard').classList.contains('is-done')) ok('success state shown');
    else no('success state not shown');

    eq(d.querySelector('[data-out-name]').textContent.trim(), 'نادية العلوي', 'recap name');
    eq(d.querySelector('[data-out-phone]').textContent.trim(), '0612345678', 'recap phone');
    eq(d.querySelector('[data-out-city]').textContent.trim(), 'مراكش', 'recap city');
    eq(d.querySelector('[data-out-total]').textContent.trim(), '299 درهم', 'recap total');

    const id = d.querySelector('#orderId').textContent.trim();
    if (/^رقم الطلب: IBSS-\d{6}-[A-Z0-9]{4}$/.test(id)) ok('order reference generated: ' + id);
    else no('order reference malformed: ' + JSON.stringify(id));

    if (d.querySelector('.form__body').hidden || d.querySelector('.form-card').classList.contains('is-done'))
      ok('form body hidden after success');
  }

  /* ===================== 5. honeypot ===================== */
  console.log('\nHoneypot');
  {
    const { w, d, calls } = await boot();
    d.querySelector('#website').value = 'http://spam.example';
    d.querySelector('#fullName').value = 'Bot Name';
    d.querySelector('#phone').value = '0612345678';
    d.querySelector('#city').value = 'فاس';
    d.querySelector('#orderForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 80));
    eq(calls.length, 0, 'bot order never sent to the endpoint');
    if (d.querySelector('#orderCard').classList.contains('is-done')) ok('bot still sees a success screen (no signal)');
    else no('bot did not see success — it can now tell it was blocked');
  }

  /* ===================== 6. demo mode (no endpoint) ===================== */
  console.log('\nUnconfigured endpoint');
  {
    // Rebuild with the untouched placeholder endpoint. Patching the copied
    // app.js after buildSite() would do nothing: it is already inlined.
    buildSite({ placeholder: true });
    const { w, d, calls } = await boot();

    const warn = d.querySelector('#setupWarning');
    if (!warn.hasAttribute('hidden')) ok('setup warning visible on load');
    else no('setup warning not shown');

    d.querySelector('#fullName').value = 'سعاد';
    d.querySelector('#phone').value = '0612345678';
    d.querySelector('#city').value = 'سلا';
    d.querySelector('#orderForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 80));

    eq(calls.length, 0, 'no request attempted');
    if (!d.querySelector('#orderCard').classList.contains('is-done')) ok('success NOT faked \u2014 the order would have been lost');
    else no('page faked a successful order with no endpoint configured');
    if (!warn.hasAttribute('hidden')) ok('warning stays visible to prevent silent order loss');
  }

  /* ===================== 7. reveal + sticky ===================== */
  console.log('\nProgressive enhancement + sticky CTA');
  {
    const { d } = await boot();
    if (d.documentElement.classList.contains('js')) ok('<html> got the .js class before paint');
    else no('.js class missing \u2014 reveal animation would never run');
    const reveals = d.querySelectorAll('.reveal').length;
    if (reveals > 20) ok(`${reveals} elements wired for scroll reveal`);
    else no(`only ${reveals} reveal elements`);

    // IntersectionObserver is absent in jsdom: the fallback must show content.
    const visible = [...d.querySelectorAll('.reveal')].every((el) => el.classList.contains('is-in'));
    if (visible) ok('no-IntersectionObserver fallback reveals everything');
    else no('content left hidden without IntersectionObserver');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.log("\nHARNESS ERROR: " + e.stack);
  process.exit(1);
});
