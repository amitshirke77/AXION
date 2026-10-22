"use strict";
// Postgres storage (Neon / Vercel Postgres / any Postgres): a small document store the tracker UI
// uses, plus tables for logins, sessions and one-time tokens that never leave the server.
// Every function is async; nothing lives in server memory, so it works on serverless hosts.
const crypto = require("crypto");
const { Pool } = require("pg");

const URL_ = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL;
if (!URL_) console.error("[db] DATABASE_URL is not set");
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(URL_ || "");
const pool = new Pool({ connectionString: URL_, ssl: local ? false : { rejectUnauthorized: false }, max: Number(process.env.PG_POOL_MAX || 3), idleTimeoutMillis: 10000 });

const q = (text, params) => pool.query(text, params);
const now = () => Date.now();
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const randomId = (n = 20) => {
  const a = "abcdefghijklmnopqrstuvwxyz0123456789";
  const b = crypto.randomBytes(n);
  let s = "";
  for (let i = 0; i < n; i++) s += a[b[i] % a.length];
  return s;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS docs (path TEXT PRIMARY KEY, coll TEXT NOT NULL, id TEXT NOT NULL, data JSONB NOT NULL, version INTEGER NOT NULL DEFAULT 1, updated_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS docs_coll ON docs(coll);
CREATE TABLE IF NOT EXISTS users (person_id TEXT PRIMARY KEY, email TEXT NOT NULL, role TEXT NOT NULL, scopes JSONB NOT NULL DEFAULT '[]', login_enabled BOOLEAN NOT NULL DEFAULT TRUE, ms_allowed BOOLEAN NOT NULL DEFAULT TRUE, password_hash TEXT, last_login BIGINT, created_at BIGINT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users (lower(email));
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, person_id TEXT NOT NULL, created_at BIGINT NOT NULL, expires_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS tokens (token_hash TEXT PRIMARY KEY, person_id TEXT NOT NULL, purpose TEXT NOT NULL, expires_at BIGINT NOT NULL, used BOOLEAN NOT NULL DEFAULT FALSE);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS counters (k TEXT PRIMARY KEY, v BIGINT NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS login_fails (k TEXT PRIMARY KEY, n INTEGER NOT NULL, t BIGINT NOT NULL);
`;
async function migrate(client = pool) { await client.query(SCHEMA); }

// ---------- meta / change counter ----------
async function getMeta(k, d = null) { const r = await q("SELECT v FROM meta WHERE k=$1", [k]); return r.rows.length ? r.rows[0].v : d; }
async function setMeta(k, v) { await q("INSERT INTO meta(k,v) VALUES($1,$2) ON CONFLICT(k) DO UPDATE SET v=EXCLUDED.v", [k, String(v)]); }
/** Set a meta key only if it doesn't already hold this value; true if this call claimed it (once-a-day jobs). */
async function claimMeta(k, v) {
  const r = await q("INSERT INTO meta(k,v) VALUES($1,$2) ON CONFLICT(k) DO UPDATE SET v=EXCLUDED.v WHERE meta.v IS DISTINCT FROM EXCLUDED.v RETURNING k", [k, String(v)]);
  return r.rowCount === 1;
}
async function bump(client = pool) { await client.query("INSERT INTO counters(k,v) VALUES('rev',1) ON CONFLICT(k) DO UPDATE SET v=counters.v+1"); }
async function rev() { const r = await q("SELECT v FROM counters WHERE k='rev'"); return r.rows.length ? Number(r.rows[0].v) : 0; }

// ---------- documents ----------
function splitPath(p) {
  const segs = String(p || "").split("/").filter(Boolean);
  if (!segs.length || segs.length > 16) throw Object.assign(new Error("bad path"), { status: 400 });
  for (const s of segs) if (!/^[A-Za-z0-9_\-.~:@+]{1,200}$/.test(s) || s === "." || s === "..") throw Object.assign(new Error("bad path segment"), { status: 400 });
  return segs;
}
const rowDoc = (r) => ({ path: r.path, coll: r.coll, id: r.id, data: r.data, version: r.version, updatedAt: Number(r.updated_at) });
async function getDoc(p) { const r = await q("SELECT * FROM docs WHERE path=$1", [p]); return r.rows.length ? rowDoc(r.rows[0]) : null; }
async function listColl(coll) { const r = await q("SELECT * FROM docs WHERE coll=$1", [coll]); return r.rows.map(rowDoc); }
async function putDoc(p, data, client = pool) {
  const segs = splitPath(p);
  if (segs.length % 2) throw Object.assign(new Error("not a document path"), { status: 400 });
  const json = JSON.stringify(data);
  if (json.length > 256 * 1024) throw Object.assign(new Error("document too large"), { status: 400 });
  const r = await client.query(
    `INSERT INTO docs(path,coll,id,data,version,updated_at) VALUES($1,$2,$3,$4::jsonb,1,$5)
     ON CONFLICT(path) DO UPDATE SET data=EXCLUDED.data, version=docs.version+1, updated_at=EXCLUDED.updated_at RETURNING *`,
    [p, segs.slice(0, -1).join("/"), segs[segs.length - 1], json, now()]);
  await bump(client);
  return rowDoc(r.rows[0]);
}
async function deleteDoc(p) { await q("DELETE FROM docs WHERE path=$1", [p]); await bump(); }
async function countColl(coll) { const r = await q("SELECT count(*)::int AS n FROM docs WHERE coll=$1", [coll]); return r.rows[0].n; }
function mergeDeep(a, b) {
  const out = { ...(a || {}) };
  for (const [k, v] of Object.entries(b || {})) {
    if (v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" && !Array.isArray(out[k])) out[k] = mergeDeep(out[k], v);
    else out[k] = v;
  }
  return out;
}
/** Run fn(client) in one transaction holding a lock, so two cold starts never seed twice. */
async function withLock(key, fn) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [key]);
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; }
  finally { c.release(); }
}

// ---------- users ----------
const userRow = (r) => r && ({ personId: r.person_id, email: r.email, role: r.role, scopes: r.scopes || [], loginEnabled: !!r.login_enabled, msAllowed: !!r.ms_allowed, hasPassword: !!r.password_hash, lastLogin: r.last_login ? Number(r.last_login) : null, createdAt: Number(r.created_at) });
async function getUser(personId) { const r = await q("SELECT * FROM users WHERE person_id=$1", [personId]); return userRow(r.rows[0]); }
async function getUserByEmail(email) { const r = await q("SELECT * FROM users WHERE lower(email)=lower($1)", [String(email || "").trim()]); return userRow(r.rows[0]); }
async function getHash(personId) { const r = await q("SELECT password_hash FROM users WHERE person_id=$1", [personId]); return r.rows.length ? r.rows[0].password_hash : null; }
async function listUsers() { const r = await q("SELECT * FROM users"); return r.rows.map(userRow); }
async function upsertUser(u, client = pool) {
  await client.query(
    `INSERT INTO users(person_id,email,role,scopes,login_enabled,ms_allowed,created_at) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7)
     ON CONFLICT(person_id) DO UPDATE SET email=EXCLUDED.email, role=EXCLUDED.role, scopes=EXCLUDED.scopes, login_enabled=EXCLUDED.login_enabled, ms_allowed=EXCLUDED.ms_allowed`,
    [u.personId, u.email, u.role, JSON.stringify(u.scopes || []), !!u.loginEnabled, !!u.msAllowed, now()]);
  const r = await client.query("SELECT * FROM users WHERE person_id=$1", [u.personId]);
  return userRow(r.rows[0]);
}
async function removeUser(personId) { await q("DELETE FROM users WHERE person_id=$1", [personId]); await q("DELETE FROM sessions WHERE person_id=$1", [personId]); }
async function setPasswordHash(personId, hash) { await q("UPDATE users SET password_hash=$2 WHERE person_id=$1", [personId, hash]); }
async function touchLogin(personId) { await q("UPDATE users SET last_login=$2 WHERE person_id=$1", [personId, now()]); }

// ---------- sessions ----------
const SESSION_DAYS = 30;
async function createSession(personId) {
  const token = crypto.randomBytes(32).toString("base64url");
  await q("INSERT INTO sessions(token_hash,person_id,created_at,expires_at) VALUES($1,$2,$3,$4)", [sha(token), personId, now(), now() + SESSION_DAYS * 864e5]);
  return token;
}
async function sessionPerson(token) {
  if (!token) return null;
  const r = await q("SELECT person_id, expires_at FROM sessions WHERE token_hash=$1", [sha(token)]);
  if (!r.rows.length || Number(r.rows[0].expires_at) < now()) return null;
  return r.rows[0].person_id;
}
async function destroySession(token) { if (token) await q("DELETE FROM sessions WHERE token_hash=$1", [sha(token)]); }
async function destroySessionsFor(personId) { await q("DELETE FROM sessions WHERE person_id=$1", [personId]); }

// ---------- one-time tokens ----------
async function createToken(personId, purpose, hours) {
  const token = crypto.randomBytes(24).toString("base64url");
  await q("UPDATE tokens SET used=TRUE WHERE person_id=$1 AND purpose=$2 AND used=FALSE", [personId, purpose]);
  await q("INSERT INTO tokens(token_hash,person_id,purpose,expires_at) VALUES($1,$2,$3,$4)", [sha(token), personId, purpose, now() + hours * 36e5]);
  return token;
}
async function peekToken(token) {
  const r = await q("SELECT * FROM tokens WHERE token_hash=$1", [sha(String(token || ""))]);
  const t = r.rows[0];
  if (!t || t.used || Number(t.expires_at) < now()) return null;
  return { personId: t.person_id, purpose: t.purpose };
}
async function useToken(token) { await q("UPDATE tokens SET used=TRUE WHERE token_hash=$1", [sha(String(token || ""))]); }

// ---------- login throttle (10 failures / 15 min per IP+email) ----------
async function isThrottled(key) { const r = await q("SELECT n,t FROM login_fails WHERE k=$1", [key]); const f = r.rows[0]; return !!f && f.n >= 10 && Number(f.t) > now() - 15 * 6e4; }
async function recordFail(key) {
  await q(`INSERT INTO login_fails(k,n,t) VALUES($1,1,$2) ON CONFLICT(k) DO UPDATE SET
    n = CASE WHEN login_fails.t > $2 - 900000 THEN login_fails.n + 1 ELSE 1 END,
    t = CASE WHEN login_fails.t > $2 - 900000 THEN login_fails.t ELSE $2 END`, [key, now()]);
}
async function cleanup() {
  await q("DELETE FROM sessions WHERE expires_at < $1", [now()]);
  await q("DELETE FROM tokens WHERE expires_at < $1", [now() - 7 * 864e5]);
  await q("DELETE FROM login_fails WHERE t < $1", [now() - 864e5]);
}

module.exports = {
  pool, migrate, randomId, splitPath, getDoc, listColl, putDoc, deleteDoc, countColl, mergeDeep, withLock, rev, getMeta, setMeta, claimMeta,
  getUser, getUserByEmail, getHash, listUsers, upsertUser, removeUser, setPasswordHash, touchLogin,
  createSession, sessionPerson, destroySession, destroySessionsFor, createToken, peekToken, useToken, isThrottled, recordFail, cleanup,
};
