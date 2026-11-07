"use strict";
// Project planner calculations, shared by the browser (window.AXION_PLAN) and the server (require).
// Tasks: { id, name, parentId, owner, start, end, deps:[ids], milestone, critical (manual flag), status, progress 0-100 }
// Dates are calendar dates "YYYY-MM-DD"; durations count both ends (a one-day task has start === end).
(function (root) {
  const STATUSES = ["Not started", "In progress", "Blocked", "Done", "Cancelled"];
  const D = (s) => { const [y, m, d] = String(s).split("-").map(Number); return Date.UTC(y, m - 1, d); };
  const S = (ms) => new Date(ms).toISOString().slice(0, 10);
  const add = (s, n) => S(D(s) + n * 864e5);
  const span = (a, b) => Math.round((D(b) - D(a)) / 864e5);
  const valid = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");

  function analyse(project, today) {
    const tasks = (project.tasks || []).map((t) => ({ ...t, deps: (t.deps || []).slice() }));
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const kids = new Map(); for (const t of tasks) { if (t.parentId && byId.has(t.parentId)) { if (!kids.has(t.parentId)) kids.set(t.parentId, []); kids.get(t.parentId).push(t); } }
    const isLeaf = (t) => !kids.has(t.id);
    const leavesOf = (t) => isLeaf(t) ? [t] : kids.get(t.id).flatMap(leavesOf);
    const done = (t) => t.status === "Done" || t.status === "Cancelled";

    // WBS numbering in display order (parents first, children under them, by start date then name)
    const order = [];
    const sortKids = (arr) => arr.slice().sort((a, b) => (a.start || "9").localeCompare(b.start || "9") || (a.seq ?? 0) - (b.seq ?? 0));
    const walk = (list, prefix, depth) => sortKids(list).forEach((t, i) => { t.wbs = prefix ? `${prefix}.${i + 1}` : `${i + 1}`; t.depth = depth; order.push(t); if (kids.has(t.id)) walk(kids.get(t.id), t.wbs, depth + 1); });
    walk(tasks.filter((t) => !t.parentId || !byId.has(t.parentId)), "", 0);

    // Roll-ups for parent tasks: dates, progress (duration-weighted), status
    const roll = (t) => {
      if (isLeaf(t)) { t.dur = valid(t.start) && valid(t.end) ? Math.max(1, span(t.start, t.end) + 1) : 1; t.pct = done(t) ? 100 : Math.max(0, Math.min(100, +t.progress || 0)); return t; }
      const ch = kids.get(t.id).map(roll);
      const st = ch.map((c) => c.start).filter(valid).sort(), en = ch.map((c) => c.end).filter(valid).sort();
      t.start = st[0] || t.start; t.end = en[en.length - 1] || t.end;
      t.dur = valid(t.start) && valid(t.end) ? Math.max(1, span(t.start, t.end) + 1) : 1;
      const w = ch.reduce((s, c) => s + c.dur, 0) || 1;
      t.pct = Math.round(ch.reduce((s, c) => s + c.pct * c.dur, 0) / w);
      t.status = ch.every(done) ? "Done" : ch.some((c) => c.status === "Blocked") ? "Blocked" : ch.some((c) => c.status !== "Not started") ? "In progress" : "Not started";
      t.rollup = true; return t;
    };
    tasks.filter((t) => !t.parentId || !byId.has(t.parentId)).forEach(roll);

    // Critical path (finish-to-start), on leaf tasks; a dependency on a parent means all of its sub-tasks
    const leaves = tasks.filter(isLeaf).filter((t) => valid(t.start) && valid(t.end) && t.status !== "Cancelled");
    const preds = new Map(leaves.map((t) => [t.id, []]));
    const expand = (id) => byId.has(id) ? leavesOf(byId.get(id)).map((x) => x.id) : [];
    for (const t of leaves) {
      const own = [...new Set([...(t.deps || []), ...(t.parentId && byId.get(t.parentId) ? (byId.get(t.parentId).deps || []) : [])])];
      for (const d of own) for (const p of expand(d)) if (p !== t.id && preds.has(p)) preds.get(t.id).push(p);
    }
    // topological order (Kahn); a loop is reported and the calculation skipped
    const indeg = new Map(leaves.map((t) => [t.id, preds.get(t.id).length])), succ = new Map(leaves.map((t) => [t.id, []]));
    for (const [id, ps] of preds) for (const p of ps) succ.get(p).push(id);
    const q = leaves.filter((t) => !indeg.get(t.id)).map((t) => t.id), topo = [];
    while (q.length) { const id = q.shift(); topo.push(id); for (const s2 of succ.get(id)) { indeg.set(s2, indeg.get(s2) - 1); if (!indeg.get(s2)) q.push(s2); } }
    const loop = topo.length !== leaves.length;
    let finish = null;
    if (!loop && leaves.length) {
      for (const id of topo) {
        const t = byId.get(id);
        // As soon as possible: tasks with dependencies start the day after the last one finishes;
        // tasks without dependencies start on their planned date
        const ps = preds.get(id);
        let es = ps.length ? Math.max(...ps.map((p) => D(byId.get(p).ef) + 864e5)) : D(t.start);
        t.es = S(es); t.ef = add(t.es, t.dur - 1);
        t.clash = t.es > t.start; // planned to start before what it depends on finishes
      }
      finish = leaves.map((t) => t.ef).sort().pop();
      for (const id of topo.slice().reverse()) {
        const t = byId.get(id);
        let lf = D(finish);
        for (const s2 of succ.get(id)) lf = Math.min(lf, D(byId.get(s2).ls) - 864e5);
        t.lf = S(lf); t.ls = add(t.lf, -(t.dur - 1));
        t.slack = span(t.es, t.ls);
        t.onPath = t.slack <= 0;
      }
    }
    // Parents are on the critical path if any sub-task is
    for (const t of order) if (!isLeaf(t)) { const l = leavesOf(t); t.onPath = l.some((x) => x.onPath); t.slack = l.length ? Math.min(...l.map((x) => x.slack ?? 9999)) : null; t.clash = l.some((x) => x.clash); }
    for (const t of tasks) { t.isCritical = !!t.critical || !!t.onPath; t.late = !done(t) && valid(t.end) && t.end < today; t.dueSoon = !done(t) && valid(t.end) && t.end >= today && t.end <= add(today, 7); }

    // Progress against plan (leaf tasks, weighted by duration)
    const L = tasks.filter(isLeaf).filter((t) => t.status !== "Cancelled");
    const W = L.reduce((s, t) => s + t.dur, 0) || 1;
    const actual = Math.round(L.reduce((s, t) => s + t.pct * t.dur, 0) / W);
    const plannedFrac = (t) => !valid(t.start) || !valid(t.end) ? 0 : today < t.start ? 0 : today >= t.end ? 1 : (span(t.start, today) + 1) / t.dur;
    const planned = Math.round(L.reduce((s, t) => s + plannedFrac(t) * 100 * t.dur, 0) / W);
    const count = (f) => L.filter(f).length;
    const stats = {
      tasks: L.length, done: count(done), inProgress: count((t) => t.status === "In progress"), notStarted: count((t) => t.status === "Not started"),
      blocked: count((t) => t.status === "Blocked"), late: count((t) => t.late), criticalLate: count((t) => t.late && t.isCritical),
      critical: count((t) => t.isCritical), actual, planned, variance: actual - planned, finish, loop,
      plannedFinish: L.map((t) => t.end).filter(valid).sort().pop() || null,
      milestones: tasks.filter((t) => t.milestone).sort((a, b) => (a.end || "").localeCompare(b.end || "")),
    };
    stats.health = loop ? "Check dependencies" : stats.criticalLate || stats.blocked && tasks.some((t) => t.status === "Blocked" && t.isCritical) ? "Off track" : (stats.late || stats.variance < -10) ? "At risk" : stats.done === stats.tasks && stats.tasks ? "Complete" : "On track";
    const ps = (project.start && valid(project.start)) ? project.start : order.map((t) => t.start).filter(valid).sort()[0];
    const pe = [project.end, finish, ...order.map((t) => t.end)].filter(valid).sort().pop();
    return { order, byId, stats, start: ps, end: pe, isLeaf };
  }
  const api = { STATUSES, analyse, add, span, valid };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.AXION_PLAN = api;
})(typeof window !== "undefined" ? window : globalThis);
