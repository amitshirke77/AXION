"use strict";
const obs = require("./obs");
// Automatic emails, both off until an admin switches them on in People & setup:
//  - weekday 09:45 IST: one "please update" email per person who has items needing an update
//  - Monday 08:30 IST: summary for admins (closed last week, late, P1/P2, updates owed)
// On Vercel these run from Vercel Cron (see vercel.json → /api/cron/...); elsewhere from a timer.
const store = require("./db");
const mail = require("./mail");

const IST_MS = 5.5 * 36e5;
const istNow = () => new Date(Date.now() + IST_MS); // read with getUTC* = IST wall clock
const ymd = (d) => d.toISOString().slice(0, 10);
const today = () => ymd(istNow());
const addDays = (s, n) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
const diff = (a, b) => Math.round((new Date(a + "T00:00:00Z") - new Date(b + "T00:00:00Z")) / 864e5);
const istDay = (iso) => (iso ? ymd(new Date(new Date(iso).getTime() + IST_MS)) : "");
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmt = (s) => { if (!s) return "—"; const [, m, d] = s.slice(0, 10).split("-"); return `${+d} ${MON[+m - 1]}`; };
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const CLOSED = ["Done", "Cancelled"];
const PR = { P1: 1, P2: 2, P3: 3, P4: 4 };

async function settings() { return ((await store.getDoc("org/settings")) || { data: {} }).data; }
async function people() { const m = {}; for (const d of await store.listColl("people")) m[d.id] = { id: d.id, ...d.data }; return m; }
async function actions() { return (await store.listColl("actions")).map((d) => ({ id: d.id, ...d.data })); }
let HIDE = ["exp"];
const noDue = (a) => HIDE.includes(a.companyId);

function needsUpdate(a, t) {
  if (CLOSED.includes(a.status)) return null;
  const last = istDay(a.lastUpdateAt || a.createdAt) || t;
  const since = diff(t, last);
  const why = [];
  if (a.due && a.due < t) why.push(noDue(a) ? "past its due date" : `past due by ${diff(t, a.due)} days`);
  if (a.nbd && a.nbd < t) why.push(`next step was due ${fmt(a.nbd)}`);
  if ((+a.updateEvery || 0) > 0 && since >= +a.updateEvery) why.push(`last update ${since} days ago`);
  return why.length ? { why, since } : null;
}

async function sendUpdateRequests(appUrl, { dryRun = false } = {}) {
  HIDE = (await settings()).hideDueFor || ["exp"];
  const t = today(), P = await people(), out = { sent: [], skipped: [] };
  const byPerson = {};
  for (const a of await actions()) {
    const n = needsUpdate(a, t); if (!n) continue;
    const gap = Math.max(+a.updateEvery || 0, 3);
    if (a.lastRequestAt && diff(t, istDay(a.lastRequestAt)) < gap) continue;
    const who = (a.responsible && a.responsible.length ? a.responsible : [a.accountable]).filter(Boolean);
    for (const pid of who) (byPerson[pid] = byPerson[pid] || []).push({ a, n });
  }
  for (const [pid, items] of Object.entries(byPerson)) {
    const p = P[pid], u = await store.getUser(pid);
    if (!p || p.active === false || !p.email || p.emailRequests === false || !u || !u.loginEnabled) { out.skipped.push(p ? p.name : pid); continue; }
    items.sort((x, y) => (x.a.due && x.a.due < t ? 0 : 1) - (y.a.due && y.a.due < t ? 0 : 1) || (PR[x.a.priority] || 9) - (PR[y.a.priority] || 9));
    const list = items.slice(0, 15).map(({ a, n }) => `<li><b>${esc(a.ref)} · ${esc(a.title)}</b><br>${esc(a.priority)} · ${esc(a.status)}${noDue(a) ? "" : ` · Due ${fmt(a.due)}`} · <b>${esc(n.why.join(", "))}</b><br>Next step: ${esc(a.nba || "—")} by ${fmt(a.nbd)}<br><a href="${appUrl}/#item-${encodeURIComponent(a.id)}">Open and post your update</a></li>`).join("");
    const html = `<p>Hi ${esc(p.name)},</p><p>These action items need a short update from you. Open each one, post a progress update, and set the next step and date.</p><ul>${list}</ul>${items.length > 15 ? `<p>…and ${items.length - 15} more in the tracker.</p>` : ""}<p><a href="${appUrl}">Open the action tracker</a></p><p>Thank you,<br>Amit</p>`;
    if (!dryRun) {
      await mail.send({ to: p.email, subject: `Action update request — ${p.name} — ${fmt(t)}`, html });
      for (const { a } of items) {
        const d = await store.getDoc("actions/" + a.id);
        await store.putDoc("actions/" + a.id, { ...d.data, lastRequestAt: new Date().toISOString(), lastRequestTo: [...new Set([...(d.data.lastRequestTo || []), pid])] });
      }
    }
    out.sent.push({ name: p.name, items: items.length });
  }
  return out;
}

async function sendDigest(appUrl, { dryRun = false } = {}) {
  HIDE = (await settings()).hideDueFor || ["exp"];
  const t = today(), P = await people(), A = await actions();
  const dow = (istNow().getUTCDay() + 6) % 7, mon = addDays(t, -dow), lwS = addDays(mon, -7), lwE = addDays(mon, -1);
  const pn = (id) => (P[id] ? P[id].name : "—");
  const open = A.filter((a) => !CLOSED.includes(a.status));
  const closed = A.filter((a) => a.status === "Done" && a.closedAt && istDay(a.closedAt) >= lwS && istDay(a.closedAt) <= lwE);
  const late = open.filter((a) => a.due && a.due < t);
  const p12 = open.filter((a) => (a.priority === "P1" || a.priority === "P2") && !(a.due && a.due < t));
  const owed = open.filter((a) => needsUpdate(a, t) && (+a.updateEvery || 0) > 0 && diff(t, istDay(a.lastUpdateAt || a.createdAt)) >= +a.updateEvery);
  const li = (a, extra) => `<li><b>${esc(a.ref)} · ${esc(a.title)}</b> — ${esc(pn(a.accountable))}${extra ? ` · ${extra}` : ""}</li>`;
  const html = `<h2>Weekly action summary — w/e ${fmt(lwE)}</h2>
  <table><tr><th>Open</th><th>Late</th><th>P1/P2</th><th>Closed last week</th></tr><tr><td>${open.length}</td><td>${late.length}</td><td>${open.filter((a) => a.priority === "P1" || a.priority === "P2").length}</td><td>${closed.length}</td></tr></table>
  <h3>Closed last week (${closed.length})</h3><ul>${closed.map((a) => li(a, esc(a.closureNote || "Completed"))).join("") || "<li>None</li>"}</ul>
  <h3>Past due (${late.length})</h3><ul>${late.map((a) => li(a, noDue(a) ? "late" : `due ${fmt(a.due)}`)).join("") || "<li>None</li>"}</ul>
  <h3>Open P1/P2 (${p12.length})</h3><ul>${p12.map((a) => li(a, esc(a.nba || ""))).join("") || "<li>None</li>"}</ul>
  <h3>Updates owed (${owed.length})</h3><ul>${owed.map((a) => li(a, "from " + esc((a.responsible || []).map(pn).join(", ") || pn(a.accountable)))).join("") || "<li>None</li>"}</ul>
  <p><a href="${appUrl}">Open the action tracker</a></p>`;
  const admins = (await store.listUsers()).filter((u) => u.role === "admin" && u.loginEnabled).map((u) => u.email);
  if (!dryRun && admins.length) await mail.send({ to: admins, subject: `Weekly action summary — w/e ${fmt(lwE)}`, html });
  return { to: admins, closed: closed.length, late: late.length };
}

/** Run a scheduled job if it's switched on and hasn't run today. Safe to call repeatedly. */
async function runScheduled(kind, appUrl) {
  const s = await settings();
  if (!mail.enabled()) return { skipped: "email not set up" };
  const d = today();
  if (kind === "requests") {
    if (!s.requestsEnabled) return { skipped: "reminders switched off" };
    const dow = istNow().getUTCDay(); if (dow < 1 || dow > 5) return { skipped: "weekend" };
    if (!(await store.claimMeta("lastRequests", d))) return { skipped: "already ran today" };
    return sendUpdateRequests(appUrl);
  }
  if (kind === "digest") {
    if (!s.digestEnabled) return { skipped: "summary switched off" };
    if (istNow().getUTCDay() !== 1) return { skipped: "not Monday" };
    if (!(await store.claimMeta("lastDigest", d))) return { skipped: "already ran today" };
    return sendDigest(appUrl);
  }
  return { skipped: "unknown job" };
}

/** Timer for long-running hosts (not used on Vercel). */
function start(appUrl) {
  const tick = async () => {
    try {
      const n = istNow(), hm = n.getUTCHours() * 60 + n.getUTCMinutes();
      for (const [job, at] of [["requests", 9 * 60 + 45], ["digest", 8 * 60 + 30]]) {
        if (hm < at) continue;
        const r = await runScheduled(job, appUrl);
        if (typeof r.skipped === "string") { obs.log("debug", "scheduler", { job, result: r }); continue; }
        obs.log("info", "scheduler", { job, result: r });
        await obs.record("cron", { path: job, message: "ran", data: r });
      }
    } catch (e) { obs.log("error", "scheduler failed", { error: e.message }); await obs.record("cron", { level: "error", path: "scheduler", message: "failed: " + e.message }); }
  };
  setInterval(tick, 5 * 6e4).unref(); setTimeout(tick, 15e3).unref();
}

module.exports = { start, runScheduled, sendUpdateRequests, sendDigest };
