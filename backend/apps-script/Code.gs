/**
 * ============================================================================
 * IBSS — Order intake for the Google Apps Script Web App
 * ============================================================================
 *
 * The landing page posts a JSON order to this script, which appends it to a
 * Google Sheet. No server, no hosting cost, no database to maintain.
 *
 * ---------------------------------------------------------------------------
 * SETUP (about 5 minutes)
 * ---------------------------------------------------------------------------
 *  1. Create a Google Sheet. Name the first tab exactly:  Orders
 *  2. Add this header row to row 1 (it must match COLUMNS below):
 *
 *       Date | Order ID | Name | Phone | City | Pack | Qty | Total | Status | Notes
 *
 *  3. In the Sheet: Extensions -> Apps Script. Delete the placeholder code and
 *     paste this whole file.
 *  4. Set NOTIFY_EMAIL below to the address that should receive each order.
 *  5. Deploy -> New deployment -> type "Web app"
 *       Execute as:      Me
 *       Who has access:  Anyone        <-- required, the page posts anonymously
 *  6. Copy the Web app URL. It ends in /exec
 *  7. Paste it into assets/js/app.js as CONFIG.FORM_ENDPOINT
 *
 * Re-deploy after every edit (Deploy -> Manage deployments -> edit -> Version:
 * New version), otherwise the live URL keeps serving the old code.
 *
 * ---------------------------------------------------------------------------
 * WHY text/plain AND NOT application/json
 * ---------------------------------------------------------------------------
 * The browser sends Content-Type: text/plain, which is a CORS "simple"
 * request. That avoids the preflight OPTIONS call, which Apps Script cannot
 * answer. Do not change the header in app.js without adding a doOptions()
 * handler here.
 * ============================================================================
 */

/** Where new orders are announced. Set to '' to disable email notifications. */
var NOTIFY_EMAIL = '';

/** Sheet tab that receives the orders. */
var SHEET_NAME = 'Orders';

/** Column order written to the sheet. Must match the header row. */
var COLUMNS = [
  'Date',
  'Order ID',
  'Name',
  'Phone',
  'City',
  'Pack',
  'Qty',
  'Total',
  'Status',
  'Notes'
];

/** Accepted Moroccan phone formats, mirroring the client-side rule. */
var PHONE_RE = /^(\+212|0)([5-7])\d{8}$/;

/**
 * Handles the order POST from the landing page.
 *
 * @param {Object} e Apps Script event; e.postData.contents holds the JSON body.
 * @return {ContentService.TextOutput} JSON: {ok:true, orderId:"..."} or {ok:false,error:"..."}
 */
function doPost(e) {
  var lock = LockService.getScriptLock();

  try {
    // Serialise writes: two customers ordering at once must not interleave.
    lock.waitLock(20000);
  } catch (lockError) {
    return respond({ ok: false, error: 'busy' });
  }

  try {
    if (!e || !e.postData || !e.postData.contents) {
      return respond({ ok: false, error: 'empty' });
    }

    var order = JSON.parse(e.postData.contents);
    var clean = sanitise(order);

    var problem = validate(clean);
    if (problem) {
      return respond({ ok: false, error: problem });
    }

    // Basic flood control: reject the same phone twice within 60 seconds.
    if (isDuplicate(clean.phone)) {
      return respond({ ok: false, error: 'duplicate' });
    }

    var orderId = writeOrder(clean);

    if (NOTIFY_EMAIL) {
      notify(clean, orderId);
    }

    return respond({ ok: true, orderId: orderId });
  } catch (error) {
    console.error('Order failed: ' + error);
    return respond({ ok: false, error: 'server' });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Lets the owner check in a browser that the deployment is live.
 * Visiting the /exec URL should show "IBSS order endpoint is running".
 */
function doGet() {
  return ContentService
    .createTextOutput('IBSS order endpoint is running')
    .setMimeType(ContentService.MimeType.TEXT);
}

/* -------------------------------------------------------------------------- */
/* helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Normalises and trims every field, and strips anything that could be a formula. */
function sanitise(order) {
  function text(value, maxLength) {
    var out = String(value == null ? '' : value).trim();
    // A leading =, +, - or @ makes Sheets treat the cell as a formula.
    if (/^[=+\-@]/.test(out)) {
      out = "'" + out;
    }
    return out.substring(0, maxLength || 120);
  }

  var qty = parseInt(order.qty, 10);
  var total = parseInt(order.total, 10);

  return {
    name: text(order.name, 80),
    phone: text(order.phone, 20).replace(/[\s\-().]/g, ''),
    city: text(order.city, 60),
    pack: text(order.pack, 60),
    qty: isNaN(qty) ? 0 : qty,
    total: isNaN(total) ? 0 : total,
    page: text(order.page, 300),
    submittedAt: text(order.submittedAt, 40)
  };
}

/** @return {string} '' when valid, otherwise a short machine-readable reason. */
function validate(order) {
  if (order.name.length < 3) return 'name';
  if (!PHONE_RE.test(order.phone)) return 'phone';
  if (order.city.length < 2) return 'city';
  if (!order.pack) return 'pack';
  if (order.qty < 1 || order.qty > 10) return 'qty';
  if (order.total < 1 || order.total > 5000) return 'total';
  return '';
}

/** True when the same phone ordered within the last 60 seconds. */
function isDuplicate(phone) {
  var sheet = getSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;

  var rows = Math.min(lastRow - 1, 20);
  var recent = sheet.getRange(lastRow - rows + 1, 1, rows, COLUMNS.length).getValues();
  var cutoff = new Date().getTime() - 60 * 1000;

  for (var i = recent.length - 1; i >= 0; i--) {
    var when = new Date(recent[i][0]).getTime();
    var stored = String(recent[i][3]).replace(/[\s\-().]/g, '');
    if (stored === phone && when > cutoff) return true;
  }
  return false;
}

/** Appends the order and returns its human-readable reference. */
function writeOrder(order) {
  var sheet = getSheet();
  var now = new Date();
  var orderId = 'IBSS-' +
    Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyMMdd') +
    '-' +
    Math.floor(1000 + Math.random() * 9000);

  sheet.appendRow([
    now,
    orderId,
    order.name,
    order.phone,
    order.city,
    order.pack,
    order.qty,
    order.total,
    'جديد', // "new" — the call centre moves this to مؤكد / ملغي
    order.page
  ]);

  return orderId;
}

/** Returns the Orders tab, creating it with headers if it is missing. */
function getSheet() {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = book.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = book.insertSheet(SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(COLUMNS);
    sheet.getRange(1, 1, 1, COLUMNS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 160);
  }
  return sheet;
}

/** Emails the order to the owner. */
function notify(order, orderId) {
  var body = [
    'طلب جديد — ' + orderId,
    '',
    'الاسم: ' + order.name,
    'الهاتف: ' + order.phone,
    'المدينة: ' + order.city,
    'الباقة: ' + order.pack,
    'المجموع: ' + order.total + ' درهم',
    '',
    'عيّط ليه/ليها باش تأكد الطلب.'
  ].join('\n');

  MailApp.sendEmail({
    to: NOTIFY_EMAIL,
    subject: 'طلب جديد ' + orderId + ' — ' + order.city,
    body: body
  });
}

/** Uniform JSON response. */
function respond(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
