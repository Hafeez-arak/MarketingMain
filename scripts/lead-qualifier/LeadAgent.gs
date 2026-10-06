/**
 * ARAK lead agent <-> the website enquiries Sheet.
 *
 * Paste this as a NEW file named LeadAgent.gs in the Sheet's Apps Script
 * project (Extensions -> Apps Script -> + -> Script). Leave Code.gs, the form
 * endpoint, exactly as it is. Steps: docs/LEADS-SETUP.md in the marketing app.
 *
 * Every 5 minutes, on Google's servers (your computer can be off), it sends
 * the rows that have no AI verdict yet to the lead agent and writes back two
 * cells per row: "AI verdict" and "AI reason". It never touches any other
 * column, Status included. A row the agent could not settle stays blank and
 * is sent again next time. Columns are found by their header, so moving them
 * around is fine.
 */

var LEAD_AGENT_URL = 'https://marketing-main-ten.vercel.app/api/leads/website';
// Lead Agent page -> Connection -> Website Sheet key. Keep it out of anything public.
var LEAD_AGENT_KEY = 'PASTE-THE-WEBSITE-SHEET-KEY-HERE';

var LEAD_SHEET = 'Enquiries';
var VERDICT_HEADER = 'AI verdict';
var REASON_HEADER = 'AI reason';
var LEAD_BATCH = 20; // the agent reads at most 20 rows per call

/** Run once, by hand: adds the two columns and starts the 5-minute timer. */
function installLeadAgent() {
  uninstallLeadAgent();
  ScriptApp.newTrigger('checkLeads').timeBased().everyMinutes(5).create();
  leadColumns_(leadSheet_());
  checkLeads();
  console.log('Lead agent installed: checking every 5 minutes.');
}

/** Stops the timer. The columns and what is in them stay. */
function uninstallLeadAgent() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'checkLeads') ScriptApp.deleteTrigger(t);
  });
}

function leadSheet_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LEAD_SHEET);
  if (!sheet) throw new Error('No "' + LEAD_SHEET + '" tab in this Sheet.');
  return sheet;
}

/** Column numbers by header; adds the two AI columns after the last header if missing. */
function leadColumns_(sheet) {
  var width = Math.max(sheet.getLastColumn(), 1);
  var headers = sheet.getRange(1, 1, 1, width).getDisplayValues()[0].map(function (h) { return String(h).trim(); });
  // New columns go after the last column holding ANY data, not the last
  // named one: on Arak's Sheet a salesperson had typed notes into an
  // unnamed column after Status, and the first version put "AI verdict" on
  // top of it.
  var last = width;
  [VERDICT_HEADER, REASON_HEADER].forEach(function (name) {
    if (headers.indexOf(name) === -1) {
      last += 1;
      sheet.getRange(1, last).setValue(name).setFontWeight('bold');
      headers[last - 1] = name;
    }
  });
  var col = {};
  headers.forEach(function (h, i) { if (h) col[h] = i + 1; });
  return col;
}

/** The timer calls this. Safe to run by hand too. */
function checkLeads() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return; // a previous run is still going
  try {
    var sheet = leadSheet_();
    var col = leadColumns_(sheet);
    var lastRow = sheet.getLastRow();
    var width = sheet.getLastColumn();
    var data = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, width).getDisplayValues() : [];
    var cell = function (r, name) { return col[name] ? String(r[col[name] - 1] || '') : ''; };

    var rows = [];
    for (var i = 0; i < data.length && rows.length < LEAD_BATCH; i++) {
      var r = data[i];
      if (cell(r, VERDICT_HEADER)) continue;
      if (!cell(r, 'Brief') && !cell(r, 'Email')) continue;
      rows.push({
        row: i + 2,
        received: cell(r, 'Received'), name: cell(r, 'Name'), company: cell(r, 'Company'),
        email: cell(r, 'Email'), phone: cell(r, 'Phone'), projectType: cell(r, 'Project type'),
        brief: cell(r, 'Brief'), lang: cell(r, 'Language'),
      });
    }

    // Called even with nothing new: that is how the Lead Agent page knows
    // the timer is alive.
    var res = UrlFetchApp.fetch(LEAD_AGENT_URL, {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify({ key: LEAD_AGENT_KEY, rows: rows }),
    });
    var body = {};
    try { body = JSON.parse(res.getContentText()); } catch (e) { /* not JSON */ }
    if (res.getResponseCode() !== 200 || !body.ok) {
      console.error('Lead agent answered ' + res.getResponseCode() + ': ' + (body.error || res.getContentText().slice(0, 300)));
      return;
    }
    if (body.off) return;

    // Write back, but only to a row that is still the same enquiry: someone
    // may have sorted or inserted rows while the agent was reading.
    var byRow = {};
    rows.forEach(function (x) { byRow[x.row] = x; });
    (body.results || []).forEach(function (out) {
      if (!out.cells || !byRow[out.row]) return;
      var now = sheet.getRange(out.row, 1, 1, width).getDisplayValues()[0];
      var sent = byRow[out.row];
      if (cell(now, 'Received') !== sent.received || cell(now, 'Email') !== sent.email) return;
      if (cell(now, VERDICT_HEADER)) return;
      sheet.getRange(out.row, col[VERDICT_HEADER]).setValue(out.cells[0]);
      sheet.getRange(out.row, col[REASON_HEADER]).setValue(out.cells[1]);
    });
  } finally {
    lock.releaseLock();
  }
}
