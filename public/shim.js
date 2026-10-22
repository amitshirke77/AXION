"use strict";
// Data layer for the tracker UI. It offers the same doc/collection/onSnapshot interface the
// tracker was written against, backed by this server's API. Changes from other users arrive
// by polling a cheap revision counter and refetching only when something changed.
(function () {
  const API = async (url, body) => {
    const r = await fetch(url, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", "x-tracker": "1" }, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" });
    if (r.status === 401) { location.href = "/login" + location.hash; throw { code: "revoked", message: "Signed out" }; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw { code: r.status === 403 ? "invalid_argument" : r.status === 400 ? "bad_request" : "unavailable", status: r.status, message: j.error || "Request failed" };
    return j;
  };
  window.trackerApi = API;

  const subs = new Set();
  let lastRev = -1, polling = false;
  async function refreshAll() { await Promise.all([...subs].map((s) => s.fetch().catch((e) => s.onErr && s.onErr(e)))); }
  async function poll() {
    if (polling || document.hidden) return;
    polling = true;
    try { const { rev } = await API("/api/rev"); if (rev !== lastRev) { lastRev = rev; await refreshAll(); } } catch (_) {}
    polling = false;
  }
  setInterval(poll, 6000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
  const afterWrite = () => setTimeout(() => { lastRev = -1; poll(); }, 30);

  const snapDoc = (d) => ({ id: d.id, exists: !!d.exists, data: () => (d.exists ? d.data : undefined), metadata: { fromCache: false, hasPendingWrites: false }, _v: d.version });
  const cmp = (a, b) => (a === b ? 0 : a === undefined || a === null ? 1 : b === undefined || b === null ? -1 : a < b ? -1 : 1);
  const test = (v, op, x) => {
    switch (op) {
      case "==": return v === x; case "!=": return v !== x; case "<": return v < x; case "<=": return v <= x; case ">": return v > x; case ">=": return v >= x;
      case "in": return Array.isArray(x) && x.includes(v); case "not-in": return Array.isArray(x) && !x.includes(v);
      case "array-contains": return Array.isArray(v) && v.includes(x); default: return false;
    }
  };

  function makeQuery(path, opts) {
    const q = {
      path,
      where: (f, op, v) => makeQuery(path, { ...opts, where: [...(opts.where || []), [f, op, v]] }),
      orderBy: (f, dir = "asc") => makeQuery(path, { ...opts, order: [f, dir] }),
      limit: (n) => makeQuery(path, { ...opts, limit: n }),
      async get() {
        const { docs } = await API("/api/db/coll?path=" + encodeURIComponent(path));
        let list = docs.filter((d) => (opts.where || []).every(([f, op, v]) => test(d.data[f], op, v)));
        if (opts.order) { const [f, dir] = opts.order; list.sort((a, b) => cmp(a.data[f], b.data[f]) * (dir === "desc" ? -1 : 1)); }
        else list.sort((a, b) => cmp(a.id, b.id));
        if (opts.limit) list = list.slice(0, opts.limit);
        const ds = list.map(snapDoc);
        return { docs: ds, size: ds.length, empty: !ds.length, docChanges: () => ds.map((d, i) => ({ type: "added", doc: d, oldIndex: -1, newIndex: i })), metadata: { fromCache: false, hasPendingWrites: false } };
      },
      onSnapshot(next, onErr) {
        let last = null;
        const s = { onErr, fetch: async () => { const snap = await q.get(); const sig = snap.docs.map((d) => d.id + ":" + d._v).join(","); if (sig !== last) { last = sig; next(snap); } } };
        subs.add(s); s.fetch().catch((e) => onErr && onErr(e));
        return () => subs.delete(s);
      },
    };
    return q;
  }
  function collection(path) {
    const q = makeQuery(path, {});
    q.doc = (id) => doc(`${path}/${id || randomId()}`);
    q.add = async (data) => { const r = await API("/api/db/add", { coll: path, data }); afterWrite(); return doc(`${path}/${r.id}`); };
    return q;
  }
  function doc(path) {
    const parts = path.split("/");
    const ref = {
      id: parts[parts.length - 1], path,
      async get() { return snapDoc(await API("/api/db/doc?path=" + encodeURIComponent(path))); },
      async set(data) { await API("/api/db/set", { path, data }); afterWrite(); },
      async update(data) { await API("/api/db/update", { path, data }); afterWrite(); },
      async delete() { await API("/api/db/delete", { path }); afterWrite(); },
      collection: (sub) => collection(`${path}/${sub}`),
      onSnapshot(next, onErr) {
        let last = null;
        const s = { onErr, fetch: async () => { const d = await ref.get(); const sig = d.exists + ":" + d._v; if (sig !== last) { last = sig; next(d); } } };
        subs.add(s); s.fetch().catch((e) => onErr && onErr(e));
        return () => subs.delete(s);
      },
    };
    return ref;
  }
  function randomId() { const a = "abcdefghijklmnopqrstuvwxyz0123456789"; let s = ""; const b = crypto.getRandomValues(new Uint8Array(20)); for (const x of b) s += a[x % a.length]; return s; }

  window.trackerDb = { doc, collection };
})();
