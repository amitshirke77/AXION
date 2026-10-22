"use strict";
// Observability: structured JSON logs (Vercel → Logs / Log Drains), request ids, and an `events`
// table in Supabase holding the audit trail, server errors, browser errors and scheduled-job runs.
const crypto = require("crypto");

let sb = null; // set by db.js once the Supabase client exists
const setClient = (c) => { sb = c; };
const LOG_LEVEL_OF = { debug: 10, info: 20, warn: 30, error: 40 };
const LOG_LEVEL = LOG_LEVEL_OF[(process.env.LOG_LEVEL || "info").toLowerCase()] || 20;
const SLOW_MS = Number(process.env.SLOW_REQUEST_MS || 1500);
const RETENTION_DAYS = Number(process.env.EVENT_RETENTION_DAYS || 180);

/** One JSON object per line, so Vercel and any log drain can filter by field. */
function log(level, msg, fields = {}) {
  if ((LOG_LEVEL_OF[level] || 20) < LOG_LEVEL) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields });
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
}

const clip = (s, n) => (s == null ? null : String(s).slice(0, n));
/** Store an event. Never throws: observability must not break the app. */
async function record(kind, { level = "info", personId = null, requestId = null, path = null, message = null, data = null } = {}) {
  if (!sb) return;
  try {
    const { error } = await sb.from("events").insert({ at: Date.now(), kind, level, person_id: personId, request_id: requestId, path: clip(path, 300), message: clip(message, 2000), data });
    if (error) log("warn", "event not stored", { kind, error: error.message });
  } catch (e) { log("warn", "event not stored", { kind, error: e.message }); }
}

/** Express middleware: request id, timing, one log line per request, slow-request warnings. */
function requestLogger() {
  return (req, res, next) => {
    const incoming = req.get("x-request-id");
    req.id = incoming && /^[A-Za-z0-9_-]{8,64}$/.test(incoming) ? incoming : crypto.randomBytes(8).toString("hex");
    res.set("X-Request-Id", req.id);
    const start = process.hrtime.bigint();
    res.on("finish", () => {
      const ms = Math.round(Number(process.hrtime.bigint() - start) / 1e6);
      if (req.path === "/api/rev" && res.statusCode < 400) return; // the 6-second refresh poll would drown everything else
      const fields = { reqId: req.id, method: req.method, path: req.path, status: res.statusCode, ms, user: req._user ? req._user.personId : undefined, role: req._user ? req._user.role : undefined, region: process.env.VERCEL_REGION };
      const level = res.statusCode >= 500 ? "error" : ms > SLOW_MS ? "warn" : res.statusCode >= 400 ? "info" : "debug";
      log(level, ms > SLOW_MS ? "slow request" : "request", fields);
      if (ms > SLOW_MS && !req.path.startsWith("/api/cron/")) record("slow", { level: "warn", personId: fields.user, requestId: req.id, path: `${req.method} ${req.path}`, message: `${ms} ms`, data: { status: res.statusCode, ms } });
    });
    next();
  };
}

/** Log + store a server error; returns the reference shown to the user. */
async function captureError(err, req, extra = {}) {
  const ref = req && req.id ? req.id : crypto.randomBytes(6).toString("hex");
  log("error", err.message || "error", { reqId: ref, path: req && req.path, method: req && req.method, user: req && req._user ? req._user.personId : undefined, stack: clip(err.stack, 4000), ...extra });
  await record("error", { level: "error", personId: req && req._user ? req._user.personId : null, requestId: ref, path: req ? `${req.method} ${req.path}` : null, message: err.message, data: { stack: clip(err.stack, 4000), code: err.code || null, ...extra } });
  return ref;
}

/** Audit trail entry for something a person did. */
function audit(req, action, details = {}) {
  const u = req && req._user;
  log("info", "audit", { reqId: req && req.id, action, user: u ? u.personId : details.personId, ...details });
  return record("audit", { personId: u ? u.personId : details.personId || null, requestId: req && req.id, path: details.path || null, message: action, data: { ...details, ip: req ? req.ip : null } });
}

async function prune() {
  if (!sb) return;
  try { await sb.from("events").delete().lt("at", Date.now() - RETENTION_DAYS * 864e5); } catch (_) {}
}

module.exports = { setClient, log, record, requestLogger, captureError, audit, prune, SLOW_MS };
