/**
 * ARAK lead agent -> the leads workbook.
 *
 * Paste this into a Google Sheet (Extensions -> Apps Script), set LEADS_KEY,
 * then run installLeadsMaster once. Steps: docs/LEADS-SETUP.md, section 4.
 *
 * Two tabs, kept up to date every 5 minutes on Google's servers, with the
 * QUALIFIED and the doubtful ("Needs review", in yellow) leads from the
 * website, info@arak-sa.com and info@clb-sa.com:
 *   "New leads"     leads that arrived from 1 October 2026
 *   "Jul–Sep 2026"  leads from 1 July to 30 September 2026 (the history,
 *                   filled in by the agent's background import)
 * The team decides the yellow ones with Status. Pitches, job seekers, spam
 * and duplicates stay out; they are on the Lead Agent page.
 *
 * Laid out as a clean table by the script itself: dark frozen header, filter
 * buttons, alternating rows of equal height, newest first, "Open email"
 * links, and a coloured Status dropdown for the team.
 *
 * The script writes Received .. Link. It NEVER writes Status, Assigned to or
 * Notes: those are the team's. Rows are found by the hidden Lead ID column,
 * so sorting, filtering and moving rows is fine. One-way: what you type here
 * does not go back. Tabs from an older version ("All enquiries",
 * "Qualified") are left alone; delete them when you no longer need them.
 */

var LEADS_URL = 'https://marketing-main-ten.vercel.app/api/leads/export';
// Lead Agent page -> Connection -> Master Sheet key. Keep it out of anything public.
var LEADS_KEY = 'PASTE-THE-MASTER-SHEET-KEY-HERE';

var NEW_TAB = 'New leads';
var HISTORY_TAB = 'Jul–Sep 2026';
// The agent's "period" for each lead -> its tab.
var TAB_FOR = { 'new': NEW_TAB, 'history': HISTORY_TAB };
var HEADERS = ['Received', 'Source', 'Name', 'Company', 'Email', 'Phone', 'Brief', 'AI verdict', 'Type', 'AI reason', 'Link', 'Status', 'Assigned to', 'Notes', 'Lead ID'];
// The team's columns: never written, and a row with anything in them is never removed.
var TEAM = ['Status', 'Assigned to', 'Notes'];
// Header -> field in the lead agent's answer. Only these are ever written.
var FIELD = {
  'Received': 'received', 'Source': 'source', 'Name': 'name', 'Company': 'company', 'Email': 'email', 'Phone': 'phone',
  'Brief': 'brief', 'AI verdict': 'verdict', 'Type': 'type', 'AI reason': 'reason', 'Link': 'link', 'Lead ID': 'id',
};

// ── Look ───────────────────────────────────────────────────────────────────
var WIDTHS = {
  'Received': 130, 'Source': 190, 'Name': 150, 'Company': 170, 'Email': 210, 'Phone': 130, 'Brief': 400,
  'AI verdict': 100, 'Type': 150, 'AI reason': 300, 'Link': 95, 'Status': 130, 'Assigned to': 130, 'Notes': 240,
};
var ROW_HEIGHT = 63; // about three lines of text; click a cell to read all of it
var HEADER_BG = '#1f2a37';
var HEADER_FG = '#ffffff';
// The team's Status dropdown, and the colour each one gets.
var STATUSES = [
  ['New', '#e8f0fe', '#174ea6'],
  ['Contacted', '#fef7e0', '#7a4f01'],
  ['Quotation sent', '#e6f4ea', '#0d652d'],
  ['Won', '#b7e1c1', '#0d652d'],
  ['Lost', '#eeeeee', '#5f6368'],
  ['Not relevant', '#eeeeee', '#5f6368'],
];

/** Run once, by hand: makes both tabs, lays them out, reads every lead, and starts the 5-minute timer. */
function installLeadsMaster() {
  uninstallLeadsMaster();
  [NEW_TAB, HISTORY_TAB].forEach(function (name) { formatTab_(setupTab_(name)); });
  // A fresh read, so leads already shown on an older version's tabs also
  // land on these two.
  PropertiesService.getScriptProperties().deleteProperty('leadsCursor');
  ScriptApp.newTrigger('syncLeads').timeBased().everyMinutes(5).create();
  syncLeads();
  console.log('Leads workbook installed: updating every 5 minutes.');
}

/** Stops the timer. The tabs and everything in them stay. */
function uninstallLeadsMaster() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncLeads') ScriptApp.deleteTrigger(t);
  });
}

/** Re-reads every lead and refreshes the agent's columns. Team columns are untouched. */
function resyncLeadsMaster() {
  PropertiesService.getScriptProperties().deleteProperty('leadsCursor');
  syncLeads();
}

/** Lays both tabs out again (header, widths, colours, dropdown, filter). Safe to run any time. */
function formatLeadsMaster() {
  [NEW_TAB, HISTORY_TAB].forEach(function (name) { var s = findTab_(name); if (s) formatTab_(s); });
}

// ── Finding the tabs, even after someone renames them ──────────────────────
// Each tab carries a hidden tag saying which one it is, so renaming it
// ("New leads" -> "New leads from Oct 1st 2026") changes nothing. A tab
// without a tag yet is found by its name, or by how its name starts.
var TAB_TAG = 'arakLeadsTab';
var TAB_STARTS = {};
TAB_STARTS[NEW_TAB] = /^\s*new leads/i;
TAB_STARTS[HISTORY_TAB] = /^\s*jul/i;

function tagOf_(sheet) {
  var found = sheet.getDeveloperMetadata().filter(function (m) { return m.getKey() === TAB_TAG; });
  return found.length ? found[0].getValue() : '';
}

/** The tab for NEW_TAB or HISTORY_TAB, or null. Tags it when found by name. */
function findTab_(name) {
  var sheets = SpreadsheetApp.getActiveSpreadsheet().getSheets();
  var tagged = sheets.filter(function (s) { return tagOf_(s) === name; });
  if (tagged.length) return tagged[0];
  var untagged = sheets.filter(function (s) { return !tagOf_(s); });
  var match = untagged.filter(function (s) { return s.getName() === name; })[0]
    || untagged.filter(function (s) { return TAB_STARTS[name].test(s.getName()); })[0];
  if (match) match.addDeveloperMetadata(TAB_TAG, name);
  return match || null;
}

function setupTab_(name) {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = findTab_(name);
  if (!sheet) {
    // The first tab of a brand-new workbook is reused for "New leads".
    var first = book.getSheets()[0];
    sheet = (name === NEW_TAB && first.getLastRow() === 0 && !tagOf_(first)) ? first.setName(name) : book.insertSheet(name);
    sheet.addDeveloperMetadata(TAB_TAG, name);
  }
  var width = Math.max(sheet.getLastColumn(), 1);
  var headers = sheet.getRange(1, 1, 1, width).getDisplayValues()[0].map(function (h) { return String(h).trim(); });
  if (!headers.some(function (h) { return h; })) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    return sheet;
  }
  // An existing tab keeps its own column order; missing columns go at the end.
  var last = sheet.getLastColumn();
  HEADERS.forEach(function (h) {
    if (headers.indexOf(h) === -1) { last += 1; sheet.getRange(1, last).setValue(h); }
  });
  return sheet;
}

/**
 * The clean-table look. Applied to whole columns, so rows added later look
 * the same without being touched again.
 */
function formatTab_(sheet) {
  var col = columns_(sheet);
  var width = sheet.getLastColumn();
  var rows = sheet.getMaxRows();
  var all = sheet.getRange(1, 1, rows, width);

  // Header: dark, bold, white, frozen, a little taller.
  sheet.getRange(1, 1, 1, width)
    .setBackground(HEADER_BG).setFontColor(HEADER_FG).setFontWeight('bold')
    .setVerticalAlignment('middle').setWrap(true);
  sheet.setRowHeight(1, 36);
  sheet.setFrozenRows(1);

  // Body: top-aligned, wrapped, one font size; alternating row colours.
  sheet.getRange(2, 1, rows - 1, width).setVerticalAlignment('top').setWrap(true).setFontSize(10);
  sheet.getBandings().forEach(function (b) { b.remove(); });
  all.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, true, false)
    .setHeaderRowColor(HEADER_BG).setFirstRowColor('#ffffff').setSecondRowColor('#f5f7fa');

  // Widths; the Lead ID column stays hidden.
  Object.keys(WIDTHS).forEach(function (h) { if (col[h]) sheet.setColumnWidth(col[h], WIDTHS[h]); });
  if (col['Lead ID']) sheet.hideColumns(col['Lead ID']);
  // Colour rules, in order: the first that matches a cell wins.
  var rules = [];

  // Status: a dropdown, coloured by value (first, so it shows on any row).
  if (col['Status']) {
    var status = sheet.getRange(2, col['Status'], rows - 1, 1);
    status.setDataValidation(SpreadsheetApp.newDataValidation()
      .requireValueInList(STATUSES.map(function (s) { return s[0]; }), true).setAllowInvalid(true).build());
    STATUSES.forEach(function (s) {
      rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(s[0])
        .setBackground(s[1]).setFontColor(s[2]).setRanges([status]).build());
    });
  }

  // AI verdict: green when qualified, bold amber when doubtful; anything else
  // (a row kept for its notes after its verdict changed) in plain grey.
  if (col['AI verdict']) {
    var verdict = sheet.getRange(2, col['AI verdict'], rows - 1, 1);
    verdict.setFontColor('#5f6368');
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Qualified')
      .setBold(true).setFontColor('#0d652d').setRanges([verdict]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Needs review')
      .setBold(true).setFontColor('#8a5300').setBackground('#ffe8a3').setRanges([verdict]).build());
    // The whole row in light yellow, so a doubtful lead stands out for the team.
    var letter = columnLetter_(col['AI verdict']);
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$' + letter + '2="Needs review"')
      .setBackground('#fff8e1').setRanges([sheet.getRange(2, 1, rows - 1, width)]).build());
  }
  sheet.setConditionalFormatRules(rules);

  // Filter buttons on the header.
  if (!sheet.getFilter()) all.createFilter();

  // Equal row heights for what is already there.
  if (sheet.getLastRow() > 1) sheet.setRowHeightsForced(2, sheet.getLastRow() - 1, ROW_HEIGHT);
}

/** Column number by header, for one tab. */
function columns_(sheet) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  var col = {};
  headers.forEach(function (h, i) { if (String(h).trim()) col[String(h).trim()] = i + 1; });
  return col;
}

/** Lead ID -> row number, for one tab. */
function rowsById_(sheet, col) {
  var map = {};
  var last = sheet.getLastRow();
  if (last < 2 || !col['Lead ID']) return map;
  sheet.getRange(2, col['Lead ID'], last - 1, 1).getValues().forEach(function (r, i) { if (r[0]) map[r[0]] = i + 2; });
  return map;
}

/** The timer calls this. Safe to run by hand too. */
function syncLeads() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    var props = PropertiesService.getScriptProperties();
    var started = Date.now();
    for (var page = 0; page < 20 && Date.now() - started < 4 * 60 * 1000; page++) {
      var res = UrlFetchApp.fetch(LEADS_URL, {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        payload: JSON.stringify({ key: LEADS_KEY, cursor: props.getProperty('leadsCursor') || '' }),
      });
      var body = {};
      try { body = JSON.parse(res.getContentText()); } catch (e) { /* not JSON */ }
      if (res.getResponseCode() !== 200 || !body.ok) {
        console.error('Lead agent answered ' + res.getResponseCode() + ': ' + (body.error || res.getContentText().slice(0, 300)));
        return;
      }
      apply_(body.leads || []);
      props.setProperty('leadsCursor', body.next || '');
      if (!body.more) break;
    }
  } finally {
    lock.releaseLock();
  }
}

/**
 * A value as Sheets should keep it: as typed. Without the apostrophe, Sheets
 * reads "+966 55..." as a formula, drops the 0 from "0553...", and treats an
 * enquiry that starts with "=" as a formula. The Outlook link becomes a short
 * clickable "Open email".
 */
function cell_(header, value) {
  var v = value == null ? '' : String(value);
  if (!v) return '';
  if (header === 'Link') return /^https:\/\//.test(v) ? '=HYPERLINK("' + v.replace(/"/g, '%22') + '","Open email")' : '';
  if (header === 'Phone' || /^[=+\-@]/.test(v)) return "'" + v;
  return v;
}

/**
 * Does this lead belong in the Sheet? Qualified leads and the doubtful ones
 * ("Needs review", shown in yellow for the team to decide). `qualified` is
 * the older name the agent still sends with the same meaning.
 */
function inSheet_(lead) {
  return lead.show !== undefined ? Boolean(lead.show) : Boolean(lead.qualified);
}

/** "H" for column 8. */
function columnLetter_(n) {
  var s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/** True when a person has written in the row's Status, Assigned to or Notes. `data` is the tab read once, from row 2. */
function teamTouched_(data, col, row) {
  var values = data[row - 2] || [];
  return TEAM.some(function (h) { return col[h] && String(values[col[h] - 1] == null ? '' : values[col[h] - 1]).trim() !== ''; });
}

/**
 * Qualified leads only (the owner's decision, 2026-10-07): a qualified lead
 * is added to the tab for when it arrived, or refreshed if it is there. A
 * lead that is not (or no longer) qualified is removed, unless someone has
 * written in its Status, Assigned to or Notes; then it stays, with its new
 * verdict showing, so nobody's work disappears. Newest first afterwards.
 */
function apply_(leads) {
  if (!leads.length) return;
  var book = SpreadsheetApp.getActiveSpreadsheet();
  [NEW_TAB, HISTORY_TAB].forEach(function (tabName) {
    var sheet = findTab_(tabName);
    if (!sheet) return;
    var col = columns_(sheet);
    var width = sheet.getLastColumn();
    var byId = rowsById_(sheet, col);
    var data = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues() : [];
    var fresh = [];
    var remove = [];
    var changed = false;
    leads.forEach(function (lead) {
      var row = byId[lead.id];
      if (row) {
        if (!inSheet_(lead) && !teamTouched_(data, col, row)) { remove.push(row); return; }
        // Known: refresh only the agent's cells.
        Object.keys(FIELD).forEach(function (h) {
          if (col[h] && h !== 'Lead ID') sheet.getRange(row, col[h]).setValue(cell_(h, lead[FIELD[h]]));
        });
        changed = true;
        return;
      }
      if (!inSheet_(lead) || TAB_FOR[lead.period] !== tabName) return;
      var values = new Array(width).fill('');
      Object.keys(FIELD).forEach(function (h) { if (col[h]) values[col[h] - 1] = cell_(h, lead[FIELD[h]]); });
      fresh.push(values);
    });
    // Bottom up, so earlier deletions do not move the rows still to delete.
    remove.sort(function (a, b) { return b - a; }).forEach(function (row) { sheet.deleteRow(row); });
    if (fresh.length) {
      var at = sheet.getLastRow() + 1;
      if (at + fresh.length - 1 > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), at + fresh.length - 1 - sheet.getMaxRows() + 50);
      sheet.getRange(at, 1, fresh.length, width).setValues(fresh);
      sheet.setRowHeightsForced(at, fresh.length, ROW_HEIGHT);
    }
    // Newest first. "Received" is "YYYY-MM-DD HH:mm", so text order is time order.
    if ((fresh.length || remove.length || changed) && col['Received'] && sheet.getLastRow() > 2) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, width).sort({ column: col['Received'], ascending: false });
    }
  });
}
