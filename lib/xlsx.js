"use strict";
// Excel workbooks with a clickable index: weekly action-item report and project plans (exceljs).
const ExcelJS = require("exceljs");

const NAVY = "FF182432", WHITE = "FFFFFFFF", MUTED = "FF5F6368", LINE = "FFD9DCE3";
// Same section colours as the PDF: light fill, black text
const SECTION_FILL = { closed: "FFCDEED6", blocked: "FFF8C9C9", overdue: "FFFDDCB5", focus: "FFFFEAA0", coming: "FFCFE3FB", created: "FFE4D8F8", recurring: "FFCDEEEA", pending: "FFF1E4C6", open: "FFE6E8EE", all: "FFE6E8EE" };
const clean = (v) => String(v == null ? "" : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").slice(0, 32000);
const asDate = (s) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? new Date(s.slice(0, 10) + "T00:00:00Z") : null);
// Sheet names: max 31 chars, no []:*?/\ and unique
function sheetName(wb, want) {
  let base = String(want).replace(/[\[\]:*?\/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "Sheet", n = base, i = 2;
  while (wb.getWorksheet(n)) n = `${base.slice(0, 27)} (${i++})`;
  return n;
}
const link = (sheet) => ({ text: sheet, hyperlink: `#'${sheet.replace(/'/g, "''")}'!A1` });

function titleBlock(ws, title, sub, cols) {
  ws.mergeCells(1, 1, 1, cols); ws.mergeCells(2, 1, 2, cols);
  const a = ws.getCell(1, 1); a.value = title; a.font = { bold: true, size: 15, color: { argb: WHITE } }; a.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } }; a.alignment = { vertical: "middle", indent: 1 };
  const b = ws.getCell(2, 1); b.value = sub; b.font = { size: 10, color: { argb: "FFAEB8C7" } }; b.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } }; b.alignment = { indent: 1 };
  ws.getRow(1).height = 26; ws.getRow(2).height = 18;
}
function backLink(ws, row, cols) {
  const c = ws.getCell(3, 1); c.value = { text: "← Back to index", hyperlink: "#'Index'!A1" }; c.font = { color: { argb: "FF2F5BD3" }, underline: true, size: 10 };
}
/** A table sheet: header row coloured, auto filter, frozen header, column widths */
function tableSheet(wb, name, title, sub, cols, rows, fill) {
  const ws = wb.addWorksheet(sheetName(wb, name), { views: [{ state: "frozen", ySplit: 4 }], properties: { tabColor: { argb: fill || "FFE6E8EE" } } });
  titleBlock(ws, title, sub, cols.length); backLink(ws, 2, cols.length);
  ws.columns = cols.map((c) => ({ key: c.key, width: c.width || 14 }));
  const hr = ws.getRow(4); hr.values = cols.map((c) => c.header); hr.height = 20;
  hr.eachCell((c) => { c.font = { bold: true, color: { argb: "FF000000" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill || "FFE6E8EE" } }; c.border = { bottom: { style: "thin", color: { argb: LINE } } }; c.alignment = { vertical: "middle", wrapText: true }; });
  rows.forEach((r, i) => {
    const row = ws.getRow(5 + i);
    cols.forEach((c, j) => { const v = r[c.key]; const cell = row.getCell(j + 1); cell.value = c.date ? asDate(v) : (typeof v === "number" ? v : clean(v)); if (c.date) cell.numFmt = "dd mmm yyyy"; if (c.pct) cell.numFmt = "0%"; cell.alignment = { vertical: "top", wrapText: !!c.wrap }; });
    if (r._red) row.getCell(cols.findIndex((c) => c.key === r._red) + 1).font = { color: { argb: "FFB3131A" }, bold: true };
  });
  if (rows.length) ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + rows.length, column: cols.length } };
  else { ws.getCell(5, 1).value = "Nothing in this list."; ws.getCell(5, 1).font = { italic: true, color: { argb: MUTED } }; }
  return ws;
}
function indexSheet(wb, title, sub, entries, notes) {
  const ws = wb.getWorksheet("Index");
  titleBlock(ws, title, sub, 3);
  ws.columns = [{ width: 38 }, { width: 12 }, { width: 70 }];
  const hr = ws.getRow(4); hr.values = ["Sheet (click to open)", "Rows", "What it holds"]; hr.font = { bold: true };
  hr.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6E8EE" } }; });
  entries.forEach((e, i) => {
    const r = ws.getRow(5 + i);
    r.getCell(1).value = link(e.sheet); r.getCell(1).font = { color: { argb: "FF2F5BD3" }, underline: true, bold: true };
    r.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: e.fill || "FFFFFFFF" } };
    r.getCell(2).value = e.rows; r.getCell(3).value = e.about; r.getCell(3).alignment = { wrapText: true };
  });
  let y = 6 + entries.length;
  for (const n of notes || []) { ws.mergeCells(y, 1, y, 3); const c = ws.getCell(y, 1); c.value = n; c.font = { size: 9, color: { argb: MUTED } }; c.alignment = { wrapText: true }; y++; }
  return ws;
}

/** Weekly action-item report: same data as the weekly PDF, one sheet per section plus all open items */
async function weeklyXlsx(d) {
  const wb = new ExcelJS.Workbook(); wb.creator = d.preparedBy || "AXION"; wb.created = new Date();
  wb.addWorksheet("Index", { properties: { tabColor: { argb: NAVY } } });
  const client = d.audience === "client";
  const cols = [
    { header: "Ref", key: "ref", width: 15 }, { header: "Action item", key: "title", width: 48, wrap: true },
    ...(d.multi ? [{ header: "Company · client · team", key: "container", width: 28, wrap: true }] : []),
    { header: "Priority", key: "priority", width: 9 }, { header: "Status", key: "status", width: 13 },
    { header: "Owner (A)", key: "owner", width: 18 }, { header: "Doing (R)", key: "doing", width: 22, wrap: true },
    { header: "Next step", key: "nba", width: 42, wrap: true }, { header: "Next step by", key: "nbd", width: 13, date: true },
    ...(d.hideDue ? [] : [{ header: "Due", key: "due", width: 13, date: true }]),
    { header: "Latest update", key: "update", width: 48, wrap: true },
  ];
  const extra = {
    closed: [{ header: "Closed on", key: "closedOn", width: 13, date: true }, { header: "Outcome", key: "closure", width: 48, wrap: true }],
    blocked: client ? [] : [{ header: "Blocker", key: "blockedNote", width: 40, wrap: true }],
    recurring: [{ header: "Next occurrence", key: "recurNext", width: 15, date: true }],
    pending: [{ header: "Update status", key: "pendingNote", width: 34, wrap: true }],
  };
  const ABOUT = { closed: "Items marked Done in this period, with their outcome", blocked: "Open items currently blocked", overdue: "Open items past their due date", focus: "Open P1 and P2 items", coming: "Items whose next step or due date falls in the next 7 days", created: "Items created in this period", recurring: "Repeating items with an occurrence coming up", pending: "Items whose progress update is overdue", open: "Every open item in scope" };
  const entries = [];
  // Summary sheet
  const st = d.stats || {};
  const sum = wb.addWorksheet(sheetName(wb, "Summary"), { properties: { tabColor: { argb: "FF2F5BD3" } } });
  titleBlock(sum, d.label || "Weekly update", `Week ${d.start || ""} to ${d.end || ""}`, 3); backLink(sum, 2, 3);
  sum.columns = [{ width: 30 }, { width: 12 }, { width: 40 }];
  [["Open", st.open], ["Closed this week", st.closed], ["Blocked", st.blocked], ...(client ? [] : [["Past due", st.overdue]]), ["P1 / P2 open", st.p12], ["New this week", st.created]]
    .forEach(([k, v], i) => { const r = sum.getRow(4 + i); r.getCell(1).value = k; r.getCell(2).value = +v || 0; r.getCell(1).font = { bold: true }; if ((k === "Blocked" || k === "Past due") && +v) r.getCell(2).font = { bold: true, color: { argb: "FFB3131A" } }; });
  entries.push({ sheet: sum.name, rows: "", about: "Headline numbers for the week", fill: "FFFFFFFF" });
  for (const s of d.sections || []) {
    const c2 = [...cols, ...(extra[s.key] || [])];
    const rows = (s.items || []).map((it) => ({ ...it, _red: it.status === "Blocked" ? "status" : null }));
    const ws = tableSheet(wb, s.title, s.title, `${d.label || ""} · ${rows.length} item${rows.length === 1 ? "" : "s"}`, c2, rows, SECTION_FILL[s.key]);
    entries.push({ sheet: ws.name, rows: rows.length, about: ABOUT[s.key] || "", fill: SECTION_FILL[s.key] });
  }
  indexSheet(wb, `${d.title || "Weekly update"}: ${d.label || ""}`, `Week ${d.start || ""} to ${d.end || ""} · prepared by ${d.preparedBy || ""}`, entries,
    [client ? "Client version: only items and updates shared with the client." : "Internal version.", "Generated from AXION, an internal, non-commercial tool. \"AXION\" is an internal name only."]);
  return wb.xlsx.writeBuffer();
}

/** Project plan workbook from AXION_PLAN.analyse() output */
async function projectXlsx(p, r, pn, label, preparedBy) {
  const wb = new ExcelJS.Workbook(); wb.creator = preparedBy || "AXION"; wb.created = new Date();
  wb.addWorksheet("Index", { properties: { tabColor: { argb: NAVY } } });
  const st = r.stats;
  const row = (t) => ({ wbs: t.wbs, name: `${"   ".repeat(t.depth || 0)}${t.milestone ? "◆ " : ""}${t.name}`, owner: t.owner ? pn(t.owner) : "", start: t.start, end: t.end, dur: t.dur, slack: t.slack == null ? "" : t.slack,
    deps: (t.deps || []).map((x) => r.byId.get(x) && r.byId.get(x).wbs).filter(Boolean).join(", "), pct: (t.pct || 0) / 100, status: t.status || "Not started", critical: t.isCritical ? (t.critical ? "Yes (marked)" : "Yes") : "", late: t.late ? "Late" : "", note: t.note || "",
    _red: t.late ? "late" : t.isCritical ? "critical" : null });
  const cols = [
    { header: "#", key: "wbs", width: 8 }, { header: "Task", key: "name", width: 46, wrap: true }, { header: "Owner", key: "owner", width: 18 },
    { header: "Start", key: "start", width: 13, date: true }, { header: "End", key: "end", width: 13, date: true }, { header: "Days", key: "dur", width: 7 },
    { header: "Slack (days)", key: "slack", width: 10 }, { header: "Depends on", key: "deps", width: 14 }, { header: "Progress", key: "pct", width: 10, pct: true },
    { header: "Status", key: "status", width: 13 }, { header: "Critical", key: "critical", width: 13 }, { header: "Late", key: "late", width: 8 }, { header: "Note", key: "note", width: 40, wrap: true },
  ];
  const sum = wb.addWorksheet("Summary", { properties: { tabColor: { argb: "FF2F5BD3" } } });
  titleBlock(sum, p.name, label, 2); backLink(sum, 2, 2); sum.columns = [{ width: 32 }, { width: 46 }];
  [["Health", st.health], ["Complete", `${st.actual}%`], ["Planned by today", `${st.planned}%`], ["Ahead / behind plan", `${st.variance >= 0 ? "+" : ""}${st.variance} points`],
   ["Tasks done", `${st.done} of ${st.tasks}`], ["In progress", st.inProgress], ["Not started", st.notStarted], ["Blocked", st.blocked], ["Late", st.late], ["Critical and late", st.criticalLate],
   ["Critical tasks", st.critical], ["Owner", p.owner ? pn(p.owner) : ""], ["Start", r.start || ""], ["Target finish", p.end || ""], ["Calculated finish", st.finish || ""], ["Status", p.status || ""]]
    .forEach(([k, v], i) => { const x = sum.getRow(4 + i); x.getCell(1).value = k; x.getCell(1).font = { bold: true }; x.getCell(2).value = v; });
  const entries = [{ sheet: "Summary", rows: "", about: "Health, progress against plan, counts and dates" }];
  const sheets = [
    ["Plan", "Full plan", r.order, "Every task and sub-task in plan order, with dates, slack, dependencies and progress", "FFE6E8EE"],
    ["Critical path", "Critical path", r.order.filter((t) => t.isCritical && !t.rollup), "Tasks with no slack (or marked critical): a delay here moves the finish date", "FFF8C9C9"],
    ["Late", "Late tasks", r.order.filter((t) => t.late && !t.rollup), "Tasks past their end date and not done", "FFFDDCB5"],
    ["Due next 7 days", "Due in the next 7 days", r.order.filter((t) => t.dueSoon && !t.rollup), "Tasks ending in the coming week", "FFCFE3FB"],
    ["Milestones", "Milestones", st.milestones, "Milestones and their status", "FFE4D8F8"],
    ["Done", "Completed tasks", r.order.filter((t) => t.status === "Done" && !t.rollup), "Tasks finished so far", "FFCDEED6"],
  ];
  for (const [nm, title, list, about, fill] of sheets) {
    const ws = tableSheet(wb, nm, `${p.name}: ${title}`, label, cols, list.map(row), fill);
    entries.push({ sheet: ws.name, rows: list.length, about, fill });
  }
  indexSheet(wb, p.name, `${label} · generated ${new Date().toISOString().slice(0, 10)}${preparedBy ? " by " + preparedBy : ""}`, entries,
    ["Slack: days a task can slip without moving the project finish. Critical: zero slack, or marked critical by hand.", "Generated from AXION, an internal, non-commercial tool."]);
  return wb.xlsx.writeBuffer();
}

module.exports = { weeklyXlsx, projectXlsx };
