"use strict";
// Who may read and write what. Every API read is filtered here and every write is checked here,
// so a client contact opening the public link can only ever receive what this file allows.
// All functions here are synchronous; the server loads what they need first into `ctx`:
//   ctx.parent   the parent action's data, for comments
//   ctx.refs     (client logins) ids of people named on the items they can see
//   ctx.hideDue  (client logins) company ids whose due dates are hidden from clients

const INTERNAL = ["admin", "editor", "contributor"];
const isInternal = (u) => INTERNAL.includes(u.role);
const ROLES = ["admin", "editor", "contributor", "client"];

// Contributors and clients may change only these action fields
const UPDATE_FIELDS = new Set(["status", "nba", "nbd", "lastUpdateAt", "lastUpdateText", "lastUpdateBy", "lastClientUpdate", "closedAt", "closureNote", "closeRequested", "recur"]);

function containerKey(a) { return `${a.companyId || ""}:${a.clientId || "_co"}:${a.teamId || ""}`; }
function inScopes(a, scopes) {
  if (!Array.isArray(scopes)) return false;
  const key = containerKey(a);
  return scopes.some((s) => s === "*" || key === s || key.startsWith(s + ":") || (s.split(":").length === 2 && key.startsWith(s + ":")));
}

const isOpen = (a) => !!a && !["Done", "Cancelled"].includes(a.status);
// master = the main task when `a` is a sub-task. Anyone internal who can see the main task also sees its sub-tasks.
function canReadAction(u, a, master) {
  if (!a) return false;
  if (u.role === "admin") return true;
  if (u.role === "client") return !!a.sharedWithClient && !!u.clientId && a.clientId === u.clientId;
  const involved = [a.accountable, ...(a.responsible || []), ...(a.consulted || []), ...(a.informed || [])].includes(u.personId);
  return inScopes(a, u.scopes) || involved || (!!a.parentId && !!master && canReadAction(u, master));
}
/** The task owner is the main task's Accountable person. */
const isTaskOwner = (u, master) => isInternal(u) && !!master && master.accountable === u.personId;
/** Sub-task people must be internal to the main task's company (or group-wide). */
function sameOrg(p, companyId) { return !!p && p.active !== false && p.side !== "client" && (!p.companyId || p.companyId === companyId); }
const arciIds = (a) => [a.accountable, ...(a.responsible || []), ...(a.consulted || []), ...(a.informed || [])].filter(Boolean);
function isInvolved(u, a) { return [a.accountable, ...(a.responsible || []), ...(a.consulted || [])].includes(u.personId); }
function canEditAction(u, a) { return u.role === "admin" || (u.role === "editor" && inScopes(a, u.scopes)); }
function canUpdateAction(u, a) { return canEditAction(u, a) || (u.role === "contributor" && canReadAction(u, a) && isInvolved(u, a)); }

// Strip what a viewer may not see from a document before it leaves the server
function redact(u, segs, data, ctx = {}) {
  const [c0] = segs;
  if (c0 === "people" && segs.length === 2 && u.role === "client") {
    return { name: data.name, role: data.side === "client" ? data.role : "", side: data.side, clientId: data.side === "client" ? data.clientId : "", companyId: "", active: data.active };
  }
  if (c0 === "actions" && segs.length === 2 && u.role === "client") {
    const { lastUpdateText, lastUpdateBy, description, consulted, informed, lastRequestAt, lastRequestTo, closeRequested, parentTitle, ...rest } = data;
    const hideDue = (ctx.hideDue || ["exp"]).includes(data.companyId);
    return { ...rest, lastUpdateText: data.lastClientUpdate || null, description: "", updateEvery: 0, ...(hideDue ? { due: null } : {}) };
  }
  return data;
}

// Read check for a single document (segs = path segments, even length)
function canReadDoc(u, segs, data, ctx = {}) {
  const [c0, id0, c1] = segs;
  if (c0 === "org") return id0 === "structure" || u.role === "admin";
  if (c0 === "people") {
    if (u.role !== "client") return true;
    if (data.clientId && data.clientId === u.clientId && data.active !== false) return true;
    return !!ctx.refs && ctx.refs.has(id0);
  }
  if (c0 === "updates") return isInternal(u);
  if (c0 === "actions") {
    const a = segs.length === 2 ? data : ctx.parent;
    const m = a && a.parentId ? (ctx.masters ? ctx.masters[a.parentId] : ctx.master) : null;
    if (!canReadAction(u, a, m)) return false;
    if (segs.length === 4 && c1 === "comments") return u.role !== "client" || !!data.visibleToClient;
    return segs.length === 2;
  }
  return false;
}

// Write check. old = current data or null, next = resulting data or null (delete). Returns the data to store, or throws.
function checkWrite(u, segs, old, next, op, ctx = {}) {
  const deny = (m) => { throw Object.assign(new Error(m || "You don't have permission to change this."), { status: 403 }); };
  const [c0, id0, c1] = segs;
  if (c0 === "org") { if (u.role !== "admin") deny(); return next; }
  if (c0 === "updates") { if (!["admin", "editor"].includes(u.role)) deny(); return next; }
  if (c0 === "people" && segs.length === 2) {
    if (u.role === "admin") return next;
    if (u.role === "editor" && !old && op !== "delete") return next; // quick-add from an action
    deny();
  }
  if (c0 === "actions" && segs.length === 2) {
    const m = ctx.master || null, kids = ctx.children || [];
    if (op === "delete") {
      if (u.role !== "admin") deny();
      if (kids.length) deny(`Delete its ${kids.length} sub-task${kids.length > 1 ? "s" : ""} first.`);
      return null;
    }
    // Sub-task people: internal, same organisation as the main task
    const checkPeople = (n, o, companyId) => {
      const before = new Set(o ? arciIds(o) : []);
      for (const id of arciIds(n)) if (!before.has(id) && !sameOrg((ctx.people || {})[id], companyId))
        deny(`${((ctx.people || {})[id] || {}).name || "That person"} can't be given a sub-task: sub-tasks go to people in the same organisation as the main task.`);
    };
    if (!old) {
      if (!next.parentId) { if (!canEditAction(u, next)) deny("You can only create actions in the companies and clients assigned to you."); return next; }
      if (!m) deny("The main task no longer exists.");
      if (m.parentId) deny("A sub-task can't have its own sub-tasks.");
      if (!isOpen(m)) deny("Reopen the main task before adding sub-tasks.");
      const editor = canEditAction(u, m);
      if (!editor && !isTaskOwner(u, m)) deny("Only the task owner (the Accountable person) or an editor can add sub-tasks.");
      if (next.companyId !== m.companyId || (next.clientId || "") !== (m.clientId || "") || (next.teamId || "") !== (m.teamId || "")) deny("A sub-task stays in its main task's company, client and team.");
      checkPeople(next, null, m.companyId);
      return { ...next, parentRef: m.ref || null, parentTitle: m.title || null, sharedWithClient: editor ? !!next.sharedWithClient : false };
    }
    if ((old.parentId || null) !== (next.parentId || null)) deny("A sub-task can't be moved to another main task.");
    // A main task closes only after every sub-task is Done or Cancelled
    if (!isOpen(next) && isOpen(old)) {
      const open = kids.filter(isOpen);
      if (open.length) deny(`Finish the open sub-task${open.length > 1 ? "s" : ""} first: ${open.slice(0, 6).map((k) => k.ref || k.title).join(", ")}${open.length > 6 ? "…" : ""}. Sub-tasks must be Done or Cancelled before the main task can close.`);
    }
    if (old.parentId) {
      checkPeople(next, old, (m || old).companyId);
      if (m && m.title && next.parentTitle !== m.title) next = { ...next, parentTitle: m.title, parentRef: m.ref };
    }
    if (canEditAction(u, old) && canEditAction(u, next)) return next;
    // The task owner manages their sub-tasks fully, except moving them or sharing them with the client
    if (old.parentId && isTaskOwner(u, m)) {
      for (const k of ["companyId", "clientId", "teamId", "sharedWithClient"]) if (JSON.stringify(old[k] ?? null) !== JSON.stringify(next[k] ?? null)) deny(`The task owner can't change "${k}" on a sub-task.`);
      return next;
    }
    if (canUpdateAction(u, old)) {
      for (const k of new Set([...Object.keys(old), ...Object.keys(next)])) {
        if (UPDATE_FIELDS.has(k)) continue;
        if (JSON.stringify(old[k] ?? null) !== JSON.stringify(next[k] ?? null)) deny(`You can update status, next step and dates on your items, but not "${k}".`);
      }
      // Only the Accountable person (or an editor) may close an item; others raise a closure request
      if (["Done", "Cancelled"].includes(next.status) && !["Done", "Cancelled"].includes(old.status) && old.accountable !== u.personId) deny("Only the Accountable person can close this item. Post an update asking them to close it.");
      return next;
    }
    deny();
  }
  if (c0 === "actions" && segs.length === 4 && c1 === "comments") {
    const a = ctx.parent;
    if (op === "delete" || old) { if (u.role !== "admin") deny(); return next; }
    if (!canReadAction(u, a, ctx.master)) deny();
    if (u.role === "client") return { ...next, kind: "note", authorId: u.personId, onBehalfOf: null, visibleToClient: true, at: new Date().toISOString() };
    const out = { ...next, authorId: u.personId, at: new Date().toISOString() };
    const owner = !!a && !!a.parentId && isTaskOwner(u, ctx.master);
    if (out.kind === "system" && !canEditAction(u, a) && !canUpdateAction(u, a) && !owner) out.kind = "note";
    if (out.onBehalfOf && !canEditAction(u, a) && !owner) out.onBehalfOf = null;
    return out;
  }
  deny();
}

function clientRefs(u, actions) {
  const refs = new Set();
  for (const a of actions) if (canReadAction(u, a)) [a.accountable, ...(a.responsible || [])].forEach((x) => x && refs.add(x));
  return refs;
}

module.exports = { isOpen, sameOrg, isTaskOwner, ROLES, INTERNAL, isInternal, inScopes, canReadAction, canEditAction, canUpdateAction, canReadDoc, checkWrite, redact, clientRefs, containerKey };
