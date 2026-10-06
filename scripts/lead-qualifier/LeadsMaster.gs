/**
 * ARAK lead agent -> the master leads workbook.
 *
 * Paste this into a NEW, empty Google Sheet (Extensions -> Apps Script),
 * set LEADS_KEY, then run installLeadsMaster once. Steps: docs/LEADS-SETUP.md.
 *
 * Two tabs, kept up to date every 5 minutes on Google's servers:
 *   "All enquiries"  every lead from every source (website, email, ...)
 *   "Qualified"      the qualified ones: the tab the sales team works from
 *
 * The script writes Received .. Link. It NEVER writes Status, Assigned to or
 * Notes: those are the team's. Rows are found by the hidden Lead ID column,
 * so sorting, filtering and moving rows is fine. A lead that is qualified
 * and later corrected stays on "Qualified" with its new verdict shown, so no
 * one's notes disappear. One-way: what you type here does not go back.
 */

var LEADS_URL = 'https://marketing-main-ten.vercel.app/api/leads/export';
// Lead Agent page -> Connection -> Master Sheet key. Keep it out of anything public.
var LEADS_KEY = 'PASTE-THE-MASTER-SHEET-KEY-HERE';

var ALL_TAB = 'All enquiries';
var QUALIFIED_TAB = 'Qualified';
var HEADERS = ['Received', 'Source', 'Name', 'Company', 'Email', 'Phone', 'Brief', 'AI verdict', 'Type', 'AI reason', 'Link', 'Status', 'Assigned to', 'Notes', 'Lead ID'];
// Header -> field in the lead agent's answer. Only these are ever written.
var FIELD = {
  'Received': 'received', 'Source': 'source', 'Name': 'name', 'Company': 'company', 'Email': 'email', 'Phone': 'phone',
  'Brief': 'brief', 'AI verdict': 'verdict', 'Type': 'type', 'AI reason': 'reason', 'Link': 'link', 'Lead ID': 'id',
};

/** Run once, by hand: makes both tabs and starts the 5-minute timer. */
function installLeadsMaster() {
  uninstallLeadsMaster();
  setupTab_(ALL_TAB);
  setupTab_(QUALIFIED_TAB);
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

function setupTab_(name) {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = book.getSheetByName(name);
  if (!sheet) {
    // The first tab of a brand-new workbook is reused for "All enquiries".
    var first = book.getSheets()[0];
    sheet = (name === ALL_TAB && first.getLastRow() === 0 && first.getName() !== QUALIFIED_TAB) ? first.setName(name) : book.insertSheet(name);
  }
  var width = Math.max(sheet.getLastColumn(), 1);
  var headers = sheet.getRange(1, 1, 1, width).getDisplayValues()[0].map(function (h) { return String(h).trim(); });
  if (!headers.some(function (h) { return h; })) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(7, 420);  // Brief
    sheet.setColumnWidth(10, 320); // AI reason
    sheet.hideColumns(HEADERS.length); // Lead ID
    return;
  }
  // An existing tab keeps its own column order; missing columns go at the end.
  var last = sheet.getLastColumn();
  HEADERS.forEach(function (h) {
    if (headers.indexOf(h) === -1) { last += 1; sheet.getRange(1, last).setValue(h).setFontWeight('bold'); }
  });
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
 * enquiry that starts with "=" as a formula.
 */
function cell_(header, value) {
  var v = value == null ? '' : String(value);
  if (!v) return '';
  if (header === 'Phone' || /^[=+\-@]/.test(v)) return "'" + v;
  return v;
}

/** Adds new leads and refreshes known ones, on both tabs. */
function apply_(leads) {
  if (!leads.length) return;
  var book = SpreadsheetApp.getActiveSpreadsheet();
  var tabs = [book.getSheetByName(ALL_TAB), book.getSheetByName(QUALIFIED_TAB)];
  tabs.forEach(function (sheet, t) {
    if (!sheet) return;
    var col = columns_(sheet);
    var width = sheet.getLastColumn();
    var byId = rowsById_(sheet, col);
    var fresh = [];
    leads.forEach(function (lead) {
      var row = byId[lead.id];
      if (row) {
        // Known: refresh only the agent's cells.
        Object.keys(FIELD).forEach(function (h) {
          if (col[h] && h !== 'Lead ID') sheet.getRange(row, col[h]).setValue(cell_(h, lead[FIELD[h]]));
        });
        return;
      }
      if (t === 1 && !lead.qualified) return; // "Qualified" takes qualified leads only
      var values = new Array(width).fill('');
      Object.keys(FIELD).forEach(function (h) { if (col[h]) values[col[h] - 1] = cell_(h, lead[FIELD[h]]); });
      fresh.push(values);
    });
    if (fresh.length) sheet.getRange(sheet.getLastRow() + 1, 1, fresh.length, width).setValues(fresh);
  });
}
