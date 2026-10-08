/* ==========================================================================
   IBSS — Landing page behaviour
   --------------------------------------------------------------------------
   Contents
     0  Configuration            ← EDIT THESE TWO VALUES BEFORE GOING LIVE
     1  Utilities
     2  Countdown (session-scoped, self-resetting)
     3  Scroll reveal
     4  Sticky bottom CTA
     5  Meta Pixel (PageView / InitiateCheckout / Purchase)
     6  Pack selection + live order summary
     7  Order form: validation, submit, success state
     8  FAQ accordion
   No dependencies. ES2019. Defensive: every module bails out silently if its
   markup is absent, so the file is safe to load on any page.
   ========================================================================== */
(function () {
  'use strict';

  /* ========================================================================
     0 — CONFIGURATION
     ======================================================================== */

  var CONFIG = {
    /* Paste your Google Apps Script Web App URL here. It must end in /exec.
       Deploy the script with access set to "Anyone".
       Until this is set, the page shows a setup warning and will NOT send
       orders anywhere. */
    FORM_ENDPOINT: 'PASTE_YOUR_APPS_SCRIPT_EXEC_URL_HERE',

    /* Meta (Facebook) Pixel ID — digits only, e.g. '123456789012345'.
       Leave empty to disable all Pixel traffic. */
    META_PIXEL_ID: '',

    /* How long the countdown runs, per visitor session.
       Resets for each new session — this is a session offer, not a fake
       ever-dwindling number. */
    COUNTDOWN_MINUTES: 45,

    /* Scarcity copy is driven by this single value so the page never shows
       two different numbers. Must reflect real remaining stock. */
    STOCK_LEFT: 7
  };

  /* ========================================================================
     1 — UTILITIES
     ======================================================================== */

  var $ = function (sel, root) {
    return (root || document).querySelector(sel);
  };
  var $$ = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };

  var reduceMotion = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false };

  /** Tracks which Pixel events already fired, so none double-counts. */
  var fired = {};

  /** True while FORM_ENDPOINT is still the placeholder. */
  var endpointReady = function () {
    var url = CONFIG.FORM_ENDPOINT;
    return (
      typeof url === 'string' &&
      /^https:\/\/\S+\/exec$/.test(url) &&
      url.indexOf('PASTE_') === -1
    );
  };

  /** Safe storage — Safari private mode throws on sessionStorage writes. */
  var store = {
    get: function (key) {
      try {
        return window.sessionStorage.getItem(key);
      } catch (e) {
        return null;
      }
    },
    set: function (key, value) {
      try {
        window.sessionStorage.setItem(key, value);
      } catch (e) {
        /* storage unavailable — countdown simply restarts on reload */
      }
    }
  };

  /* ========================================================================
     2 — COUNTDOWN
     The deadline is stored in sessionStorage, so a refresh does not reset the
     clock mid-visit, but a brand-new session always starts a fresh window.
     ======================================================================== */

  function initCountdown() {
    var topbar = $('[data-countdown]');
    var clock = $('[data-clock]');
    if (!topbar && !clock) return;

    var KEY = 'ibss_deadline';
    var DURATION = CONFIG.COUNTDOWN_MINUTES * 60 * 1000;

    function readDeadline() {
      var now = Date.now();
      var stored = parseInt(store.get(KEY), 10);
      if (!stored || isNaN(stored) || stored - now <= 0) {
        stored = now + DURATION;
        store.set(KEY, String(stored));
      }
      return stored;
    }

    var deadline = readDeadline();

    function pad(n) {
      return (n < 10 ? '0' : '') + n;
    }

    /* Compare against the rendered text rather than a keyed cache: the clock
       spans share no id, so a cache keyed on el.id would collide and skip
       updates whenever two units happened to hold the same value. */
    function write(el, value) {
      if (el && el.textContent !== value) el.textContent = value;
    }

    function tick() {
      var remaining = deadline - Date.now();

      if (remaining <= 0) {
        // Session window elapsed: restart it rather than showing 00:00:00
        // forever. Keeps the offer live without inventing false urgency.
        deadline = Date.now() + DURATION;
        store.set(KEY, String(deadline));
        remaining = DURATION;
      }

      var totalSeconds = Math.floor(remaining / 1000);
      var hours = Math.floor(totalSeconds / 3600);
      var minutes = Math.floor((totalSeconds % 3600) / 60);
      var seconds = totalSeconds % 60;

      write(topbar, pad(hours) + ':' + pad(minutes) + ':' + pad(seconds));

      if (clock) {
        write($('[data-clk="h"]'), pad(hours));
        write($('[data-clk="m"]'), pad(minutes));
        write($('[data-clk="s"]'), pad(seconds));
      }
    }

    tick();
    window.setInterval(tick, 1000);
  }

  /* ========================================================================
     3 — SCROLL REVEAL
     ======================================================================== */

  function initReveal() {
    var items = $$('.reveal');
    if (!items.length) return;

    // No IntersectionObserver, or reduced motion: show everything at once.
    if (!('IntersectionObserver' in window) || reduceMotion.matches) {
      items.forEach(function (el) {
        el.classList.add('is-in');
      });
      return;
    }

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-in');
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.08 }
    );

    items.forEach(function (el) {
      observer.observe(el);
    });
  }

  /* ========================================================================
     4 — STICKY BOTTOM CTA
     Slides in once the hero has scrolled away, and hides again at the order
     form so it never covers the submit button.
     ======================================================================== */

  function initStickyCta() {
    var bar = $('[data-sticky-cta]');
    var hero = $('[data-hero]');
    if (!bar || !hero) return;

    document.body.classList.add('has-sticky');

    if (!('IntersectionObserver' in window)) {
      bar.classList.add('is-visible');
      return;
    }

    var heroGone = false;
    var formVisible = false;

    function sync() {
      bar.classList.toggle('is-visible', heroGone && !formVisible);
    }

    new IntersectionObserver(
      function (entries) {
        heroGone = !entries[0].isIntersecting;
        sync();
      },
      { threshold: 0 }
    ).observe(hero);

    var order = $('#order');
    if (order) {
      new IntersectionObserver(
        function (entries) {
          formVisible = entries[0].isIntersecting;
          sync();
        },
        { threshold: 0.34 }
      ).observe(order);
    }
  }

  /* ========================================================================
     5 — META PIXEL
     Only injected when an ID is configured, so an unconfigured page makes
     zero third-party requests.
     ======================================================================== */

  function initPixel() {
    if (!CONFIG.META_PIXEL_ID) return;

    /* Standard Meta Pixel bootstrap. */
    !(function (f, b, e, v, n, t, s) {
      if (f.fbq) return;
      n = f.fbq = function () {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      };
      if (!f._fbq) f._fbq = n;
      n.push = n;
      n.loaded = true;
      n.version = '2.0';
      n.queue = [];
      t = b.createElement(e);
      t.async = true;
      t.src = v;
      s = b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t, s);
    })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');

    window.fbq('init', CONFIG.META_PIXEL_ID);
    window.fbq('track', 'PageView');
    fired.PageView = true;
  }

  /** Fire a Pixel event once per page view. Never throws. */
  function track(event, params) {
    if (fired[event]) return;
    fired[event] = true;
    try {
      if (window.fbq) window.fbq('track', event, params || {});
    } catch (e) {
      /* ad blockers — never let tracking break the order flow */
    }
  }

  /* ========================================================================
     6 — PACK SELECTION + LIVE ORDER SUMMARY
     ======================================================================== */

  var PACKS = {
    p1: { qty: 1, price: 249, name: 'علبة واحدة — 30 كبسولة', tag: 'للتجربة' },
    p2: { qty: 2, price: 299, name: 'علبتين — 60 كبسولة', tag: 'الأكثر اختياراً' },
    p3: { qty: 3, price: 365, name: '3 علب — 90 كبسولة', tag: 'أفضل قيمة' }
  };

  var state = { pack: 'p2' };

  function selectedPack() {
    return PACKS[state.pack] || PACKS.p2;
  }

  function formatPrice(value) {
    return value + ' درهم';
  }

  function initPacks() {
    /* The offer-stack cards and the order-form radios live in different
       places in the DOM, so the browser treats them as two separate radio
       groups. We bind both to one piece of JS state instead. */
    var inputs = $$('input[data-pack-input]');
    if (!inputs.length) return;

    inputs.forEach(function (input) {
      if (input.checked) state.pack = input.value;
      input.addEventListener('change', function () {
        if (!input.checked) return;
        choosePack(input.value);
      });
    });

    // Initial paint: mirror the default selection into both groups.
    choosePack(state.pack);
  }

  /** Select a pack by id — the single entry point for every pack control. */
  function choosePack(id) {
    if (!PACKS[id]) return;
    state.pack = id;

    $$('input[data-pack-input]').forEach(function (input) {
      input.checked = input.value === id;
    });

    // The offer-stack cards highlight via a class on the wrapper, since the
    // native input is visually hidden.
    $$('[data-pack-card]').forEach(function (card) {
      card.classList.toggle(
        'is-selected',
        card.getAttribute('data-pack-card') === id
      );
    });

    var pack = selectedPack();
    var summaryPack = $('[data-summary-pack]');
    var summaryTotal = $('[data-summary-total]');
    var summaryQty = $('[data-summary-qty]');
    var stickyPrice = $('[data-sticky-price]');

    if (summaryPack) summaryPack.textContent = pack.name;
    if (summaryTotal) summaryTotal.textContent = formatPrice(pack.price);
    if (summaryQty) summaryQty.textContent = pack.qty + ' علبة';
    if (stickyPrice) stickyPrice.textContent = formatPrice(pack.price);

    /* Savings is measured against buying single boxes at the 1-box price.
       There is one note per pack card — six in total across the offer stack
       and the form — so each is resolved against its own card rather than
       writing to whichever happens to come first in the document. */
    var saving = pack.qty * PACKS.p1.price - pack.price;
    $$('[data-pack-save]').forEach(function (note) {
      var card = note.closest('[data-pack-card]');
      var isSelected = card && card.getAttribute('data-pack-card') === id;
      var show = isSelected && saving > 0;
      note.textContent = show ? 'كتوفري ' + saving + ' درهم' : '';
      note.hidden = !show;
    });
  }

  /* ========================================================================
     7 — ORDER FORM
     ======================================================================== */

  var PHONE_RE = /^(\+212|0)([5-7])\d{8}$/;

  /** Strip spaces, dashes, dots and parens; keep a leading +. */
  function normalisePhone(raw) {
    var value = String(raw || '').replace(/[\s\-().]/g, '');
    return value;
  }

  function setError(field, message) {
    if (!field) return;
    var wrap = field.closest('.field') || field.closest('.form-fieldset');
    if (!wrap) return;

    wrap.classList.add('has-error');
    field.setAttribute('aria-invalid', 'true');

    var box = $('.field__error', wrap);
    if (box) {
      if (message) box.querySelector('span').textContent = message;
      box.hidden = false;
    }
  }

  function clearError(field) {
    if (!field) return;
    var wrap = field.closest('.field') || field.closest('.form-fieldset');
    if (!wrap) return;

    wrap.classList.remove('has-error');
    field.removeAttribute('aria-invalid');

    var box = $('.field__error', wrap);
    if (box) box.hidden = true;
  }

  function validateName(value) {
    var v = String(value || '').trim();
    if (v.length < 3) return 'كتبي الاسم الكامل باش نأكدو الطلب.';
    if (!/^[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFFa-zA-Z\s'’\-\.]+$/.test(v)) {
      return 'الاسم خاصو يكون بالحروف.';
    }
    return '';
  }

  function validateCity(value) {
    var v = String(value || '').trim();
    if (v.length < 2) return 'كتبي المدينة باش نوصلو الطلب.';
    return '';
  }

  function validatePhone(value) {
    var v = normalisePhone(value);
    if (!v) return 'رقم الهاتف ضروري باش نعيطو ليك.';
    if (!PHONE_RE.test(v)) return 'الرقم ماشي صحيح. مثال: 0612345678 ولا +212612345678';
    return '';
  }

  function initForm() {
    var form = $('#orderForm');
    if (!form) return;

    var card = $('#orderCard');
    var submitBtn = $('#submitBtn');
    var nameInput = $('#fullName');
    var phoneInput = $('#phone');
    var cityInput = $('#city');
    var packFieldset = form.querySelector('.form-fieldset');

    var fields = [
      { el: nameInput, validate: validateName, event: 'blur' },
      { el: phoneInput, validate: validatePhone, event: 'blur' },
      { el: cityInput, validate: validateCity, event: 'blur' }
    ];

    /* -- InitiateCheckout on first form interaction ---------------------- */
    var checkoutFired = false;
    function firstInteraction() {
      if (checkoutFired) return;
      checkoutFired = true;
      track('InitiateCheckout', {
        content_name: 'مكمل غذائي — روتين الراحة الهضمية',
        content_category: 'supplement',
        currency: 'MAD',
        value: selectedPack().price,
        num_items: selectedPack().qty
      });
    }

    ['focusin', 'input', 'change'].forEach(function (evt) {
      form.addEventListener(evt, firstInteraction, { once: false });
    });

    /* -- Live validation ------------------------------------------------- */
    fields.forEach(function (field) {
      if (!field.el) return;

      field.el.addEventListener('blur', function () {
        if (!field.el.value.trim()) {
          clearError(field.el);
          return;
        }
        var message = field.validate(field.el.value);
        if (message) setError(field.el, message);
        else clearError(field.el);
      });

      // Clear the error as soon as the user starts fixing it.
      field.el.addEventListener('input', function () {
        var wrap = field.el.closest('.field');
        if (wrap && wrap.classList.contains('has-error')) clearError(field.el);
      });
    });

    // Phone: keep only digits and a leading + while typing.
    if (phoneInput) {
      phoneInput.addEventListener('input', function () {
        var cleaned = phoneInput.value
          .replace(/[^\d+]/g, '')
          .replace(/(?!^)\+/g, '');
        if (cleaned !== phoneInput.value) phoneInput.value = cleaned;
      });
    }

    /* -- Submit ---------------------------------------------------------- */
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      firstInteraction();

      /* Honeypot: a real customer can never see or fill this field. If it has
         a value, quietly show the success state without sending anything, so
         the bot gets no signal that it was blocked. */
      var trap = form.querySelector('.hp input');
      if (trap && trap.value) {
        succeed({
          name: nameInput.value.trim() || '—',
          phone: normalisePhone(phoneInput.value) || '—',
          city: cityInput.value.trim() || '—',
          pack: selectedPack().name,
          qty: selectedPack().qty,
          total: selectedPack().price
        });
        return;
      }

      var invalid = null;

      fields.forEach(function (field) {
        if (!field.el) return;
        var message = field.validate(field.el.value);
        if (message) {
          setError(field.el, message);
          if (!invalid) invalid = field.el;
        } else {
          clearError(field.el);
        }
      });

      // A pack is always selected by default, but never assume.
      var packInput = form.querySelector('input[name="pack"]:checked');
      if (!packInput && packFieldset) {
        setError(packFieldset, 'اختاري الباقة اللي بغيتي.');
        if (!invalid) invalid = packFieldset;
      } else if (packFieldset) {
        clearError(packFieldset);
      }

      if (invalid) {
        invalid.focus({ preventScroll: true });
        invalid.scrollIntoView({
          behavior: reduceMotion.matches ? 'auto' : 'smooth',
          block: 'center'
        });
        return;
      }

      send();
    });

    /* -- Network ---------------------------------------------------------- */
    function send() {
      var pack = selectedPack();
      var payload = {
        name: nameInput.value.trim(),
        phone: normalisePhone(phoneInput.value),
        city: cityInput.value.trim(),
        pack: pack.name,
        packId: state.pack,
        qty: pack.qty,
        total: pack.price,
        currency: 'MAD',
        page: window.location.href,
        submittedAt: new Date().toISOString()
      };

      setLoading(true);

      if (!endpointReady()) {
        // No endpoint configured. Do NOT pretend the order was transmitted —
        // surface the setup problem instead of silently losing customers.
        setLoading(false);
        showSetupWarning(true);
        console.error(
          '[IBSS] Order not sent: CONFIG.FORM_ENDPOINT is still the placeholder. ' +
            'Set it to your Google Apps Script /exec URL in assets/js/app.js.'
        );
        return;
      }

      fetch(CONFIG.FORM_ENDPOINT, {
        method: 'POST',
        // text/plain avoids a CORS preflight, which Apps Script cannot answer.
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      })
        .then(function (response) {
          if (!response.ok) throw new Error('HTTP ' + response.status);
          return response.json().catch(function () {
            // Apps Script sometimes returns non-JSON; a 200 is good enough.
            return { ok: true };
          });
        })
        .then(function (data) {
          if (data && data.ok === false) {
            throw new Error(data.error || 'rejected');
          }
          succeed(payload);
        })
        .catch(function (error) {
          setLoading(false);
          showSendError(error);
        });
    }

    function setLoading(isLoading) {
      if (!submitBtn) return;
      submitBtn.disabled = isLoading;
      submitBtn.setAttribute('aria-busy', isLoading ? 'true' : 'false');
      var label = $('[data-btn-label]', submitBtn);
      if (label) {
        if (isLoading) {
          if (!submitBtn.dataset.idleLabel) {
            submitBtn.dataset.idleLabel = label.textContent;
          }
          label.textContent = 'كنصيفطو الطلب…';
        } else if (submitBtn.dataset.idleLabel) {
          label.textContent = submitBtn.dataset.idleLabel;
        }
      }
    }

    function showSendError(error) {
      console.error('[IBSS] Order failed:', error);
      var box = $('#sendError');
      if (box) box.hidden = false;
      if (submitBtn) submitBtn.focus({ preventScroll: true });
      if (box) box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function succeed(payload) {
      document.body.classList.add('is-engaged');

      // Recap
      var map = {
        '[data-out-name]': payload.name,
        '[data-out-phone]': payload.phone,
        '[data-out-city]': payload.city,
        '[data-out-pack]': payload.pack,
        '[data-out-total]': formatPrice(payload.total)
      };
      Object.keys(map).forEach(function (sel) {
        var el = $(sel);
        if (el) el.textContent = map[sel];
      });

      var orderId = $('#orderId');
      if (orderId) {
        // Human-readable, non-guessable-enough reference for the support call.
        orderId.textContent =
          'رقم الطلب: IBSS-' +
          new Date().toISOString().slice(2, 10).replace(/-/g, '') +
          '-' +
          Math.random().toString(36).slice(2, 6).toUpperCase();
      }

      if (card) {
        card.classList.add('is-done');
        var heading = $('.success__title');
        if (heading) {
          heading.setAttribute('tabindex', '-1');
          heading.focus({ preventScroll: true });
        }
        card.scrollIntoView({
          behavior: reduceMotion.matches ? 'auto' : 'smooth',
          block: 'start'
        });
      }

      track('Purchase', {
        currency: 'MAD',
        value: payload.total,
        num_items: payload.qty,
        content_name: payload.pack,
        content_category: 'supplement'
      });
    }

    /* -- Setup warning ---------------------------------------------------- */
    function showSetupWarning(show) {
      var box = $('#setupWarning');
      if (box) box.hidden = !show;
    }

    /* -- Offer-stack "خدي هادي" buttons ---------------------------------- */
    $$('[data-choose-pack]').forEach(function (button) {
      button.addEventListener('click', function () {
        choosePack(button.getAttribute('data-choose-pack'));
        firstInteraction();
      });
    });

    /* Keyboard shortcut: the sticky CTA and offer buttons scroll to the form
       and pre-select. Focus is moved to the form heading for screen readers,
       without yanking the on-screen keyboard open on mobile. */
    $$('[data-goto-order]').forEach(function (link) {
      link.addEventListener('click', function () {
        var target = $('#order');
        if (!target) return;
        window.setTimeout(function () {
          var heading = $('.form-card .form__title') || nameInput;
          if (heading && heading.focus) {
            heading.setAttribute('tabindex', '-1');
            heading.focus({ preventScroll: true });
          }
        }, reduceMotion.matches ? 0 : 420);
      });
    });

    if (!endpointReady()) showSetupWarning(true);
  }

  /* ========================================================================
     8 — FAQ ACCORDION
     Native <details> keeps this keyboard- and screen-reader-accessible for
     free; JS only enforces one-open-at-a-time on wide screens.
     ======================================================================== */

  function initFaq() {
    var items = $$('.faq__item');
    if (items.length < 2) return;

    items.forEach(function (item) {
      item.addEventListener('toggle', function () {
        if (!item.open) return;
        // Accordion behaviour only where there is room to scroll past it.
        if (window.innerWidth < 768) return;
        items.forEach(function (other) {
          if (other !== item) other.open = false;
        });
      });
    });
  }

  /* ========================================================================
     9 — STOCK COUNT
     One value drives every scarcity line on the page, so the page can never
     contradict itself. Keep CONFIG.STOCK_LEFT honest.
     ======================================================================== */

  function initStock() {
    var nodes = $$('[data-stock]');
    if (!nodes.length) return;
    nodes.forEach(function (node) {
      node.textContent = String(CONFIG.STOCK_LEFT);
    });
  }

  /* ========================================================================
     10 — MISC: stop pulsing once the visitor has engaged
     ======================================================================== */

  function initEngagement() {
    var mark = function () {
      document.body.classList.add('is-engaged');
    };

    /* Only real intent counts. Binding this to a global pointerdown would
       stop the CTA pulse on the visitor's first scroll gesture — i.e. before
       they ever saw it. */
    $$('.btn, [data-goto-order]').forEach(function (el) {
      el.addEventListener('click', mark, { once: true });
    });

    var form = $('#orderForm');
    if (form) {
      ['focusin', 'input'].forEach(function (evt) {
        form.addEventListener(evt, mark, { once: true });
      });
    }
  }

  /* ========================================================================
     BOOT
     ======================================================================== */

  function boot() {
    initStock();
    initCountdown();
    initReveal();
    initStickyCta();
    initPixel();
    initPacks();
    initForm();
    initFaq();
    initEngagement();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
