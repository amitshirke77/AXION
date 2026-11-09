"use strict";
// Storage through the Supabase API (supabase-js, service_role key, server side only).
// A small document store the tracker UI uses, plus logins, sessions and one-time tokens.
// Writes that must be atomic go through Postgres functions defined in supabase/01_schema.sql.
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

// Names match what Supabase shows (Project Settings → API) and what Vercel's Supabase integration sets.
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const configured = !!(SUPABASE_URL && SUPABASE_KEY);
if (!configured) console.error("[db] Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (server-side secret key).");
const sb = configured ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }) : null;
require("./obs").setClient(sb);

const now = () => Date.now();
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const randomId = (n = 20) => {
  const a = "abcdefghijklmnopqrstuvwxyz0123456789";
  const b = crypto.randomBytes(n);
  let s = "";
  for (let i = 0; i < n; i++) s += a[b[i] % a.length];
  return s;
};
function client() { if (!sb) throw Object.assign(new Error("Supabase isn't configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)."), { status: 503 }); return sb; }
/** Unwrap a supabase-js result; throw on error. */
function must({ data, error }) {
  if (error) {
    const e = new Error(error.message || "Database error");
    e.code = error.code; e.details = error.details;
    if (error.code === "23505") e.status = 409;
    throw e;
  }
  return data;
}
const lc = (s) => String(s || "").trim().toLowerCase();

// ---------- setup ----------
/** Throws a clear message if supabase/01_schema.sql hasn't been run or the key is wrong. */
async function checkSchema() {
  const { error } = await client().from("docs").select("path", { head: true, count: "exact" }).limit(1);
  if (error) {
    if (/Invalid API key|JWT|JWS|No API key/i.test(error.message || "") || ["PGRST301", "PGRST302"].includes(error.code)) throw new Error("Supabase rejected the key. Check SUPABASE_SERVICE_ROLE_KEY.");
    if (["42P01", "PGRST205", "PGRST202", "42883"].includes(error.code) || /does not exist|schema cache/i.test(error.message || ""))
      throw new Error("Tables are missing. Run supabase/01_schema.sql in the Supabase SQL Editor.");
    throw new Error("Supabase error: " + (error.message || error.code || "unknown"));
  }
}
async function bootstrap({ docs, settings, adminEmail, adminName }) {
  return must(await client().rpc("axion_bootstrap", { p_docs: docs || null, p_settings: settings, p_admin_email: adminEmail, p_admin_name: adminName }));
}

// ---------- meta / change counter ----------
async function getMeta(k, d = null) { const r = must(await client().from("meta").select("v").eq("k", k).maybeSingle()); return r ? r.v : d; }
async function setMeta(k, v) { must(await client().from("meta").upsert({ k, v: String(v) }, { onConflict: "k" })); }
async function claimMeta(k, v) { return !!must(await client().rpc("axion_claim_meta", { p_k: k, p_v: String(v) })); }
async function rev() { const r = must(await client().from("counters").select("v").eq("k", "rev").maybeSingle()); return r ? Number(r.v) : 0; }

// ---------- documents ----------
function splitPath(p) {
  const segs = String(p || "").split("/").filter(Boolean);
  if (!segs.length || segs.length > 16) throw Object.assign(new Error("bad path"), { status: 400 });
  for (const s of segs) if (!/^[A-Za-z0-9_\-.~:@+]{1,200}$/.test(s) || s === "." || s === "..") throw Object.assign(new Error("bad path segment"), { status: 400 });
  return segs;
}
const rowDoc = (r) => ({ path: r.path, coll: r.coll, id: r.id, data: r.data, version: r.version, updatedAt: Number(r.updated_at) });
async function getDoc(p) { const r = must(await client().from("docs").select("*").eq("path", p).maybeSingle()); return r ? rowDoc(r) : null; }
async function listColl(coll) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const rows = must(await client().from("docs").select("*").eq("coll", coll).order("path").range(from, from + 999));
    out.push(...rows.map(rowDoc));
    if (rows.length < 1000) break;
  }
  return out;
}
async function putDoc(p, data) {
  const segs = splitPath(p);
  if (segs.length % 2) throw Object.assign(new Error("not a document path"), { status: 400 });
  if (JSON.stringify(data).length > 256 * 1024) throw Object.assign(new Error("document too large"), { status: 400 });
  const r = must(await client().rpc("axion_put_doc", { p_path: p, p_coll: segs.slice(0, -1).join("/"), p_id: segs[segs.length - 1], p_data: data }));
  return rowDoc(Array.isArray(r) ? r[0] : r);
}
async function deleteDoc(p) { must(await client().rpc("axion_delete_doc", { p_path: p })); }
function mergeDeep(a, b) {
  const out = { ...(a || {}) };
  for (const [k, v] of Object.entries(b || {})) {
    if (v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" && !Array.isArray(out[k])) out[k] = mergeDeep(out[k], v);
    else out[k] = v;
  }
  return out;
}

/** Sub-tasks of an action (docs whose data.parentId is that id). */
async function listChildren(id) {
  return must(await client().from("docs").select("id,data").eq("coll", "actions").eq("data->>parentId", id).limit(500)).map((r) => ({ id: r.id, ...r.data }));
}

// ---------- users ----------
const userRow = (r) => r && ({ personId: r.person_id, email: r.email, role: r.role, scopes: r.scopes || [], loginEnabled: !!r.login_enabled, msAllowed: !!r.ms_allowed, hasPassword: !!r.password_hash, lastLogin: r.last_login ? Number(r.last_login) : null, createdAt: Number(r.created_at) });
async function getUser(personId) { return userRow(must(await client().from("users").select("*").eq("person_id", personId).maybeSingle())); }
async function getUserByEmail(email) { if (!lc(email)) return null; return userRow(must(await client().from("users").select("*").eq("email", lc(email)).maybeSingle())); }
async function getHash(personId) { const r = must(await client().from("users").select("password_hash").eq("person_id", personId).maybeSingle()); return r ? r.password_hash : null; }
async function listUsers() { return must(await client().from("users").select("*")).map(userRow); }
async function upsertUser(u) {
  const r = must(await client().rpc("axion_upsert_user", { p_person_id: u.personId, p_email: lc(u.email), p_role: u.role, p_scopes: u.scopes || [], p_login_enabled: !!u.loginEnabled, p_ms_allowed: !!u.msAllowed }));
  return userRow(Array.isArray(r) ? r[0] : r);
}
async function removeUser(personId) { must(await client().from("users").delete().eq("person_id", personId)); await destroySessionsFor(personId); }
async function setPasswordHash(personId, hash) { must(await client().from("users").update({ password_hash: hash }).eq("person_id", personId)); }
async function setPasswordIfEmpty(email, hash) { const r = must(await client().from("users").update({ password_hash: hash }).eq("email", lc(email)).is("password_hash", null).select("person_id")); return r.length > 0; }
async function touchLogin(personId) { must(await client().from("users").update({ last_login: now() }).eq("person_id", personId)); }

// ---------- sessions ----------
const SESSION_DAYS = 30;
async function createSession(personId) {
  const token = crypto.randomBytes(32).toString("base64url");
  must(await client().from("sessions").insert({ token_hash: sha(token), person_id: personId, created_at: now(), expires_at: now() + SESSION_DAYS * 864e5 }));
  return token;
}
async function sessionPerson(token) {
  if (!token) return null;
  const r = must(await client().from("sessions").select("person_id,expires_at").eq("token_hash", sha(token)).maybeSingle());
  if (!r || Number(r.expires_at) < now()) return null;
  return r.person_id;
}
async function destroySession(token) { if (token) must(await client().from("sessions").delete().eq("token_hash", sha(token))); }
async function destroySessionsFor(personId) { must(await client().from("sessions").delete().eq("person_id", personId)); }

// ---------- one-time tokens ----------
async function createToken(personId, purpose, hours) {
  const token = crypto.randomBytes(24).toString("base64url");
  must(await client().from("tokens").update({ used: true }).eq("person_id", personId).eq("purpose", purpose).eq("used", false));
  must(await client().from("tokens").insert({ token_hash: sha(token), person_id: personId, purpose, expires_at: now() + hours * 36e5 }));
  return token;
}
async function peekToken(token) {
  const t = must(await client().from("tokens").select("*").eq("token_hash", sha(String(token || ""))).maybeSingle());
  if (!t || t.used || Number(t.expires_at) < now()) return null;
  return { personId: t.person_id, purpose: t.purpose };
}
async function useToken(token) { must(await client().from("tokens").update({ used: true }).eq("token_hash", sha(String(token || "")))); }

// ---------- login throttle (10 failures / 15 min per IP+email) ----------
async function isThrottled(key) { const f = must(await client().from("login_fails").select("n,t").eq("k", key).maybeSingle()); return !!f && f.n >= 10 && Number(f.t) > now() - 15 * 6e4; }
async function recordFail(key) { must(await client().rpc("axion_record_fail", { p_k: key, p_now: now() })); }
async function cleanup() {
  must(await client().from("sessions").delete().lt("expires_at", now()));
  must(await client().from("tokens").delete().lt("expires_at", now() - 7 * 864e5));
  must(await client().from("login_fails").delete().lt("t", now() - 864e5));
}

// ---------- observability queries ----------
/** Round-trip time to Supabase in ms (throws if unreachable). */
async function ping() { const t = Date.now(); must(await client().from("counters").select("v").limit(1)); return Date.now() - t; }
async function listEvents({ kind, kinds, limit = 50, since } = {}) {
  let q = client().from("events").select("*").order("at", { ascending: false }).limit(Math.min(limit, 500));
  if (kind) q = q.eq("kind", kind);
  if (kinds) q = q.in("kind", kinds);
  if (since) q = q.gte("at", since);
  return must(await q).map((r) => ({ id: r.id, at: Number(r.at), kind: r.kind, level: r.level, personId: r.person_id, requestId: r.request_id, path: r.path, message: r.message, data: r.data }));
}
async function countEvents(kind, since) { const r = await client().from("events").select("id", { head: true, count: "exact" }).eq("kind", kind).gte("at", since); must(r); return r.count || 0; }

module.exports = {
  ping, listEvents, countEvents, listChildren,
  configured, checkSchema, bootstrap, randomId, splitPath, getDoc, listColl, putDoc, deleteDoc, mergeDeep, rev, getMeta, setMeta, claimMeta,
  getUser, getUserByEmail, getHash, listUsers, upsertUser, removeUser, setPasswordHash, setPasswordIfEmpty, touchLogin,
  createSession, sessionPerson, destroySession, destroySessionsFor, createToken, peekToken, useToken, isThrottled, recordFail, cleanup,
};
