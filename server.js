"use strict";
// AXION — group action tracker. Runs on Vercel (api/index.js exports this app) or any Node host (`node server.js`).
const path = require("path");
const fs = require("fs");
const express = require("express");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const store = require("./lib/db");
const access = require("./lib/access");
const mail = require("./lib/mail");
const ms = require("./lib/microsoft");
const scheduler = require("./lib/scheduler");
const obs = require("./lib/obs");
const STARTED = Date.now();
const VERSION = (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 7) || "local";

const PORT = Number(process.env.PORT || 3000);
const APP_URL = (process.env.APP_URL
  || (process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`)
  || process.env.RENDER_EXTERNAL_URL
  || `http://localhost:${PORT}`).replace(/\/$/, "");
const SECURE = APP_URL.startsWith("https://");
const VIEWS = path.join(__dirname, "views");
const PUB = path.join(__dirname, "public");

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(obs.requestLogger());
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use((req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  });
  next();
});

// ---------- first request on each instance: schema, seed, admin ----------
let ready = null;
// Tables and functions come from supabase/01_schema.sql (run once in the Supabase SQL Editor).
// Data: run supabase/02_seed.sql too, or leave SEED_ON_FIRST_START unset and the app loads seed/seed.json
// into an empty tracker on its first request.
async function bootstrap() {
  await store.checkSchema();
  const seedFile = path.join(__dirname, "seed", "seed.json");
  const seedOn = process.env.SEED_ON_FIRST_START !== "false";
  const empty = !(await store.getDoc("org/structure"));
  const docs = seedOn && empty && fs.existsSync(seedFile) ? JSON.parse(fs.readFileSync(seedFile, "utf8")).docs : null;
  const adminEmail = (process.env.ADMIN_EMAIL || "amit.shirke@zipstacc.com").toLowerCase();
  const r = await store.bootstrap({ docs, settings: { requestsEnabled: false, digestEnabled: false, hideDueFor: ["exp"] }, adminEmail, adminName: process.env.ADMIN_NAME || "Admin" });
  if (r && r.seeded) { obs.log("info", "seed loaded", { documents: r.seeded }); await obs.record("audit", { message: "seed.loaded", data: { documents: r.seeded } }); }
  if (r && r.adminCreated) obs.log("info", "admin login created", { email: adminEmail });
  if (process.env.ADMIN_PASSWORD && (await store.setPasswordIfEmpty(adminEmail, bcrypt.hashSync(process.env.ADMIN_PASSWORD, 12)))) obs.log("info", "admin password set from ADMIN_PASSWORD");
  obs.log("info", "instance ready", { version: VERSION, region: process.env.VERCEL_REGION, coldStartMs: Date.now() - STARTED });
}
app.use((req, res, next) => {
  if (req.path === "/healthz" || req.path === "/api/health") return next();
  if (!ready) ready = bootstrap().catch((e) => { ready = null; throw e; });
  ready.then(() => next(), (e) => {
    obs.log("error", "bootstrap failed", { reqId: req.id, error: e.message });
    res.status(503).type("text").send(/Tables are missing|rejected the key|isn't configured/.test(e.message) ? e.message : "The tracker can't reach Supabase right now. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, then reload.");
  });
});

// ---------- helpers ----------
const err = (status, message) => Object.assign(new Error(message), { status });
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch(async (e) => {
  if (e.status && e.status < 500) return res.status(e.status).json({ error: e.message });
  const ref = await obs.captureError(e, req);
  res.status(e.status || 500).json({ error: `Something went wrong on the server. Try again. (Reference ${ref})`, ref });
});
async function loadUser(req) {
  if (req._user !== undefined) return req._user;
  const pid = await store.sessionPerson(req.cookies.sid);
  const u = pid ? await store.getUser(pid) : null;
  if (!u || !u.loginEnabled) return (req._user = null);
  const p = await store.getDoc("people/" + pid);
  return (req._user = { ...u, name: p ? p.data.name : u.email, clientId: p ? p.data.clientId || "" : "" });
}
const needUser = async (req) => { const u = await loadUser(req); if (!u) throw err(401, "Please sign in."); return u; };
const needAdmin = async (req) => { const u = await needUser(req); if (u.role !== "admin") throw err(403, "Only admins can do this."); return u; };
async function setSession(res, personId) {
  const token = await store.createSession(personId);
  await store.touchLogin(personId);
  res.cookie("sid", token, { httpOnly: true, secure: SECURE, sameSite: "lax", maxAge: 30 * 864e5, path: "/" });
}
// CSRF guard: browsers can't add this header cross-site without CORS, which we never allow
app.use("/api", (req, res, next) => { if (req.method !== "GET" && !req.path.startsWith("/cron/") && req.get("x-tracker") !== "1") return res.status(403).json({ error: "Bad request." }); next(); });
const throttleKey = (req, email) => `${req.ip}|${String(email || "").toLowerCase()}`;
async function settingsData() { return ((await store.getDoc("org/settings")) || { data: {} }).data; }

// ---------- public ----------
app.get("/healthz", (req, res) => res.json({ ok: true }));
app.get("/api/config", (req, res) => res.json({ msEnabled: ms.enabled(), mailEnabled: mail.enabled(), appUrl: APP_URL }));
for (const p of ["/login", "/invite/:token", "/reset/:token"]) app.get(p, (req, res) => res.sendFile(path.join(VIEWS, "login.html")));

app.post("/api/auth/login", wrap(async (req, res) => {
  const { email, password } = req.body || {};
  const key = throttleKey(req, email);
  if (await store.isThrottled(key)) throw err(429, "Too many attempts. Wait 15 minutes or reset your password.");
  const u = await store.getUserByEmail(email);
  const hash = u && (await store.getHash(u.personId));
  if (!u || !u.loginEnabled || !hash || !(await bcrypt.compare(String(password || ""), hash))) {
    await store.recordFail(key);
    await obs.audit(req, "signin.failed", { email: String(email || "").toLowerCase().slice(0, 120), reason: !u ? "unknown email" : !u.loginEnabled ? "login disabled" : !hash ? "no password" : "wrong password" });
    throw err(401, u && u.loginEnabled && !hash ? "No password is set for this account yet. Use your invite link, “Forgot password”, or Sign in with Microsoft." : "Email or password is incorrect.");
  }
  await setSession(res, u.personId);
  await obs.audit(req, "signin", { personId: u.personId, method: "password" });
  res.json({ ok: true });
}));
app.post("/api/auth/logout", wrap(async (req, res) => { await loadUser(req); await store.destroySession(req.cookies.sid); res.clearCookie("sid", { path: "/" }); if (req._user) await obs.audit(req, "signout"); res.json({ ok: true }); }));
app.post("/api/auth/forgot", wrap(async (req, res) => {
  const u = await store.getUserByEmail((req.body || {}).email);
  if (u && u.loginEnabled && mail.enabled()) {
    const token = await store.createToken(u.personId, "reset", 2);
    const p = await store.getDoc("people/" + u.personId);
    await mail.send({ to: u.email, subject: "Reset your AXION password", html: `<p>Hi ${p ? p.data.name : ""},</p><p><a href="${APP_URL}/reset/${token}">Set a new password</a>. This link works for 2 hours.</p><p>If you didn't ask for this, ignore this email.</p>` }).catch((e) => obs.captureError(e, req, { during: "password reset email" }));
    await obs.audit(req, "password.reset_requested", { personId: u.personId });
  }
  res.json({ ok: true, mailEnabled: mail.enabled() });
}));
app.get("/api/auth/token/:token", wrap(async (req, res) => {
  const t = await store.peekToken(req.params.token);
  if (!t) return res.json({ valid: false });
  const u = await store.getUser(t.personId), p = await store.getDoc("people/" + t.personId);
  res.json({ valid: !!u, purpose: t.purpose, email: u && u.email, name: p ? p.data.name : "" });
}));
app.post("/api/auth/set-password", wrap(async (req, res) => {
  const { token, password } = req.body || {};
  const t = await store.peekToken(token);
  if (!t) throw err(400, "This link has expired or was already used. Ask your admin for a new one.");
  if (String(password || "").length < 10) throw err(400, "Use at least 10 characters.");
  const u = await store.getUser(t.personId);
  if (!u || !u.loginEnabled) throw err(403, "This account isn't enabled.");
  await store.setPasswordHash(t.personId, await bcrypt.hash(String(password), 12));
  await store.useToken(token);
  await store.destroySessionsFor(t.personId);
  await setSession(res, t.personId);
  await obs.audit(req, t.purpose === "invite" ? "invite.accepted" : "password.reset", { personId: t.personId });
  res.json({ ok: true });
}));
app.post("/api/auth/change-password", wrap(async (req, res) => {
  const u = await needUser(req);
  const { current, next } = req.body || {};
  const hash = await store.getHash(u.personId);
  if (hash && !(await bcrypt.compare(String(current || ""), hash))) throw err(400, "Your current password is incorrect.");
  if (String(next || "").length < 10) throw err(400, "Use at least 10 characters.");
  await store.setPasswordHash(u.personId, await bcrypt.hash(String(next), 12));
  await store.destroySessionsFor(u.personId);
  await setSession(res, u.personId);
  await obs.audit(req, "password.changed");
  res.json({ ok: true });
}));

app.get("/auth/microsoft", (req, res) => {
  if (!ms.enabled()) return res.redirect("/login?e=" + encodeURIComponent("Microsoft sign-in isn't set up yet."));
  const { url, cookie } = ms.startUrl(APP_URL);
  res.cookie("msst", cookie, { httpOnly: true, secure: SECURE, sameSite: "lax", maxAge: 10 * 6e4, path: "/auth/microsoft" });
  res.redirect(url);
});
app.get("/auth/microsoft/callback", async (req, res) => {
  try {
    if (req.query.error) throw new Error(req.query.error_description || "Microsoft sign-in was cancelled.");
    const { email } = await ms.finish(APP_URL, { code: String(req.query.code || ""), state: String(req.query.state || "") }, req.cookies.msst);
    res.clearCookie("msst", { path: "/auth/microsoft" });
    const u = await store.getUserByEmail(email);
    if (!u || !u.loginEnabled) throw new Error(`${email} doesn't have access to the tracker. Ask Amit to add you.`);
    if (!u.msAllowed) throw new Error("Microsoft sign-in is turned off for your account. Use your email and password.");
    await setSession(res, u.personId);
    await obs.audit(req, "signin", { personId: u.personId, method: "microsoft" });
    res.redirect("/");
  } catch (e) {
    await obs.audit(req, "signin.failed", { method: "microsoft", reason: e.message.slice(0, 200) });
    res.redirect("/login?e=" + encodeURIComponent(e.message));
  }
});

// ---------- scheduled emails (Vercel Cron calls these with "Authorization: Bearer $CRON_SECRET") ----------
app.get("/api/cron/:job", wrap(async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.get("authorization") !== `Bearer ${secret}`) throw err(401, "Not allowed.");
  const t0 = Date.now();
  let r;
  try { r = await scheduler.runScheduled(req.params.job, APP_URL); }
  catch (e) { await obs.record("cron", { level: "error", requestId: req.id, path: req.params.job, message: "failed: " + e.message, data: { ms: Date.now() - t0 } }); throw e; }
  await store.cleanup().catch(() => {});
  await obs.prune();
  await obs.record("cron", { level: "info", requestId: req.id, path: req.params.job, message: typeof r.skipped === "string" ? "skipped: " + r.skipped : "ran", data: { ...r, ms: Date.now() - t0 } });
  obs.log("info", "cron", { job: req.params.job, ms: Date.now() - t0, result: r });
  res.json(r);
}));

// ---------- signed-in ----------
app.get("/api/auth/me", wrap(async (req, res) => {
  const u = await needUser(req);
  res.json({ personId: u.personId, name: u.name, email: u.email, role: u.role, scopes: u.scopes, clientId: u.clientId, hasPassword: u.hasPassword, mailEnabled: mail.enabled(), msEnabled: ms.enabled() });
}));
app.get("/api/rev", wrap(async (req, res) => { await needUser(req); res.json({ rev: await store.rev() }); }));

// Load what the access rules need for this path (parent action, client's people refs, hidden due dates)
async function ctxFor(u, segs) {
  const ctx = {};
  if (segs[0] === "actions" && segs.length >= 3) { const a = await store.getDoc(`actions/${segs[1]}`); ctx.parent = a ? a.data : null; }
  if (u.role === "client") {
    ctx.hideDue = (await settingsData()).hideDueFor || ["exp"];
    if (segs[0] === "people") ctx.refs = access.clientRefs(u, (await store.listColl("actions")).map((d) => d.data));
  }
  return ctx;
}
const shape = (d, data) => ({ id: d.id, exists: true, data, version: d.version });
app.get("/api/db/doc", wrap(async (req, res) => {
  const u = await needUser(req);
  const segs = store.splitPath(req.query.path);
  if (segs.length % 2) throw err(400, "Not a document path.");
  const d = await store.getDoc(segs.join("/"));
  const ctx = await ctxFor(u, segs);
  if (!d || !access.canReadDoc(u, segs, d.data, ctx)) return res.json({ id: segs[segs.length - 1], exists: false });
  res.json(shape(d, access.redact(u, segs, d.data, ctx)));
}));
app.get("/api/db/coll", wrap(async (req, res) => {
  const u = await needUser(req);
  const segs = store.splitPath(req.query.path);
  if (!(segs.length % 2)) throw err(400, "Not a collection path.");
  const ctx = await ctxFor(u, segs);
  if (segs[0] === "actions" && segs.length === 3 && !access.canReadAction(u, ctx.parent)) return res.json({ docs: [] });
  const docs = [];
  for (const d of await store.listColl(segs.join("/"))) {
    const ds = [...segs, d.id];
    if (access.canReadDoc(u, ds, d.data, ctx)) docs.push(shape(d, access.redact(u, ds, d.data, ctx)));
  }
  res.json({ docs });
}));

async function write(u, path_, op, data, req) {
  const segs = store.splitPath(path_);
  if (segs.length % 2) throw err(400, "Not a document path.");
  const p = segs.join("/");
  const old = await store.getDoc(p);
  if ((op === "update" || op === "delete") && !old) throw err(400, "That item no longer exists.");
  if (data !== null && (typeof data !== "object" || Array.isArray(data))) throw err(400, "Bad data.");
  const next = op === "delete" ? null : op === "update" ? store.mergeDeep(old.data, data) : data;
  const ctx = await ctxFor(u, segs);
  const out = access.checkWrite(u, segs, old ? old.data : null, next, op === "delete" ? "delete" : old ? "set" : "create", ctx);
  const label = (out || (old && old.data) || {}).ref || (out || (old && old.data) || {}).name || null;
  if (op === "delete") { await store.deleteDoc(p); await obs.audit(req, "doc.delete", { path: p, label }); return { id: segs[segs.length - 1], deleted: true }; }
  const saved = await store.putDoc(p, out);
  const changed = old ? Object.keys({ ...old.data, ...out }).filter((k) => JSON.stringify(old.data[k] ?? null) !== JSON.stringify(out[k] ?? null)).slice(0, 30) : null;
  if (!(segs[0] === "actions" && segs.length === 4)) await obs.audit(req, old ? "doc.update" : "doc.create", { path: p, label, changed });
  else await obs.audit(req, "comment.add", { path: p, label: (ctx.parent || {}).ref || null, kind: out.kind });
  if (segs[0] === "people" && segs.length === 2 && old && out.email !== old.data.email) {
    const usr = await store.getUser(segs[1]);
    if (usr && out.email) { try { await store.upsertUser({ ...usr, email: out.email }); } catch (_) { throw err(400, "Another login already uses that email."); } }
  }
  return { id: saved.id, version: saved.version };
}
app.post("/api/db/set", wrap(async (req, res) => res.json(await write(await needUser(req), req.body.path, "set", req.body.data, req))));
app.post("/api/db/update", wrap(async (req, res) => res.json(await write(await needUser(req), req.body.path, "update", req.body.data, req))));
app.post("/api/db/delete", wrap(async (req, res) => res.json(await write(await needUser(req), req.body.path, "delete", null, req))));
app.post("/api/db/add", wrap(async (req, res) => {
  const u = await needUser(req);
  const segs = store.splitPath(req.body.coll);
  if (!(segs.length % 2)) throw err(400, "Not a collection path.");
  res.json(await write(u, `${segs.join("/")}/${store.randomId()}`, "set", req.body.data, req));
}));

app.post("/api/mail/send", wrap(async (req, res) => {
  const u = await needUser(req);
  if (!["admin", "editor"].includes(u.role)) throw err(403, "Only admins and editors can send updates.");
  const { to, cc, subject, html } = req.body || {};
  await mail.send({ to, cc, subject, html, replyTo: u.email });
  await obs.audit(req, "mail.weekly_update", { subject: String(subject || "").slice(0, 200), recipients: [].concat(to || [], cc || []).length });
  res.json({ ok: true });
}));

// ---------- admin: logins ----------
app.get("/api/admin/users", wrap(async (req, res) => { await needAdmin(req); res.json({ users: await store.listUsers() }); }));
app.post("/api/admin/users/:personId", wrap(async (req, res) => {
  const me = await needAdmin(req);
  const pid = req.params.personId;
  const p = await store.getDoc("people/" + pid);
  if (!p) throw err(404, "Person not found.");
  const { role, scopes, loginEnabled, msAllowed } = req.body || {};
  if (!access.ROLES.includes(role)) throw err(400, "Choose a role.");
  if (!p.data.email) throw err(400, "Add an email address for this person first.");
  if (pid === me.personId && (role !== "admin" || !loginEnabled)) throw err(400, "You can't remove your own admin access.");
  if (role === "client" && !p.data.clientId) throw err(400, "Set this person's client in the directory before giving client access.");
  const clean = Array.isArray(scopes) ? scopes.filter((s) => typeof s === "string" && /^[*A-Za-z0-9_\-:.]{1,120}$/.test(s)).slice(0, 50) : [];
  const other = await store.getUserByEmail(p.data.email);
  if (other && other.personId !== pid) throw err(400, "Another person already has a login with this email.");
  const u = await store.upsertUser({ personId: pid, email: p.data.email, role, scopes: role === "admin" ? ["*"] : clean, loginEnabled: !!loginEnabled, msAllowed: msAllowed !== false });
  if (!u.loginEnabled) await store.destroySessionsFor(pid);
  await obs.audit(req, "access.set", { target: pid, role: u.role, scopes: u.scopes, loginEnabled: u.loginEnabled });
  res.json({ user: u });
}));
app.delete("/api/admin/users/:personId", wrap(async (req, res) => {
  const me = await needAdmin(req);
  if (req.params.personId === me.personId) throw err(400, "You can't remove your own login.");
  await store.removeUser(req.params.personId);
  await obs.audit(req, "access.removed", { target: req.params.personId });
  res.json({ ok: true });
}));
app.post("/api/admin/users/:personId/invite", wrap(async (req, res) => {
  await needAdmin(req);
  const u = await store.getUser(req.params.personId);
  if (!u || !u.loginEnabled) throw err(400, "Give this person access first.");
  const p = await store.getDoc("people/" + u.personId);
  const token = await store.createToken(u.personId, u.hasPassword ? "reset" : "invite", 7 * 24);
  const link = `${APP_URL}/invite/${token}`;
  let emailed = false, mailError = null;
  if (mail.enabled() && (req.body || {}).send !== false) {
    try {
      await mail.send({ to: u.email, subject: "You've been added to AXION, the group action tracker", html: `<p>Hi ${p ? p.data.name : ""},</p><p>Amit has given you access to AXION, the group action tracker, where you can see your action items and post updates.</p><p><a href="${link}">Set your password and sign in</a> (link valid for 7 days).</p>${ms.enabled() && u.msAllowed ? `<p>If you have a Microsoft work account with this email, you can also use “Sign in with Microsoft” at <a href="${APP_URL}/login">${APP_URL}/login</a>.</p>` : ""}` });
      emailed = true;
    } catch (e) { mailError = e.message; await obs.captureError(e, req, { during: "invite email" }); }
  }
  await obs.audit(req, "invite.created", { target: u.personId, emailed });
  res.json({ link, emailed, mailError });
}));
app.post("/api/admin/run/:job", wrap(async (req, res) => {
  await needAdmin(req);
  const dryRun = (req.body || {}).dryRun !== false;
  if (!dryRun) await obs.audit(req, "job.run_now", { job: req.params.job });
  if (req.params.job === "requests") return res.json(await scheduler.sendUpdateRequests(APP_URL, { dryRun }));
  if (req.params.job === "digest") return res.json(await scheduler.sendDigest(APP_URL, { dryRun }));
  throw err(404, "Unknown job.");
}));

// ---------- health & status ----------
// Public: for uptime monitors (UptimeRobot, Better Stack…). 200 when the app can reach Supabase, 503 when not.
app.get("/api/health", async (req, res) => {
  try { const dbMs = await store.ping(); res.json({ ok: true, dbMs, version: VERSION }); }
  catch (e) { obs.log("error", "health check failed", { reqId: req.id, error: e.message }); res.status(503).json({ ok: false, error: "database unreachable", version: VERSION }); }
});
// Admin: everything on the System status page
app.get("/api/admin/status", wrap(async (req, res) => {
  await needAdmin(req);
  const day = Date.now() - 864e5, week = Date.now() - 7 * 864e5;
  const check = async (fn) => { const t = Date.now(); try { const v = await fn(); return { ok: true, ms: Date.now() - t, ...(v && typeof v === "object" ? v : {}) }; } catch (e) { return { ok: false, ms: Date.now() - t, error: e.message }; } };
  const db = await check(() => store.ping());
  const eventsTable = await check(() => store.countEvents("error", day).then((n) => ({ errors24h: n })));
  const smtp = mail.enabled() && req.query.smtp === "1" ? await check(() => mail.verify()) : { ok: mail.enabled(), skipped: mail.enabled() ? "press Test email to check the mail server" : "not set up" };
  const settings = await settingsData();
  const users = await store.listUsers();
  const actions = (await store.listColl("actions")).map((d) => d.data);
  const lastCron = {};
  if (eventsTable.ok) for (const e of await store.listEvents({ kind: "cron", limit: 40 })) if (!lastCron[e.path]) lastCron[e.path] = e;
  res.json({
    version: VERSION, region: process.env.VERCEL_REGION || null, env: process.env.VERCEL_ENV || "local", appUrl: APP_URL, uptimeS: Math.round((Date.now() - STARTED) / 1000),
    checks: {
      database: db,
      eventsTable,
      email: smtp,
      microsoft: { ok: ms.enabled(), skipped: ms.enabled() ? null : "not set up" },
      cronSecret: { ok: !!process.env.CRON_SECRET, skipped: process.env.CRON_SECRET ? null : "CRON_SECRET missing: scheduled emails can't run" },
      sessionSecret: { ok: !!process.env.SESSION_SECRET, skipped: process.env.SESSION_SECRET ? null : "SESSION_SECRET not set (a fallback is used)" },
    },
    jobs: { requestsEnabled: !!settings.requestsEnabled, digestEnabled: !!settings.digestEnabled, lastRequests: lastCron.requests || null, lastDigest: lastCron.digest || null },
    usage: {
      logins: users.filter((u) => u.loginEnabled).length,
      activeLast7d: users.filter((u) => u.lastLogin && u.lastLogin > week).length,
      neverSignedIn: users.filter((u) => u.loginEnabled && !u.lastLogin).length,
      actionsOpen: actions.filter((a) => !["Done", "Cancelled"].includes(a.status)).length,
      actionsTotal: actions.length,
      errors24h: eventsTable.ok ? eventsTable.errors24h : null,
      clientErrors24h: eventsTable.ok ? await store.countEvents("client_error", day) : null,
      slow24h: eventsTable.ok ? await store.countEvents("slow", day) : null,
    },
  });
}));
app.get("/api/admin/events", wrap(async (req, res) => {
  await needAdmin(req);
  const kinds = String(req.query.kinds || "").split(",").filter((k) => ["audit", "error", "client_error", "slow", "cron"].includes(k));
  res.json({ events: await store.listEvents({ kinds: kinds.length ? kinds : undefined, limit: Number(req.query.limit || 100) }) });
}));
// Browser errors (signed-in users only, capped)
app.post("/api/client-error", wrap(async (req, res) => {
  const u = await needUser(req);
  const b = req.body || {};
  obs.log("warn", "browser error", { reqId: req.id, user: u.personId, message: String(b.message || "").slice(0, 300), url: String(b.url || "").slice(0, 200) });
  await obs.record("client_error", { level: "warn", personId: u.personId, requestId: req.id, path: String(b.url || "").slice(0, 300), message: String(b.message || "").slice(0, 1000), data: { stack: String(b.stack || "").slice(0, 3000), ua: String(req.get("user-agent") || "").slice(0, 200) } });
  res.json({ ok: true });
}));

// ---------- app shell ----------
app.get("/", async (req, res) => {
  try { if (!(await loadUser(req))) return res.redirect("/login"); res.sendFile(path.join(VIEWS, "index.html")); }
  catch (e) { const ref = await obs.captureError(e, req); res.status(500).send(`Something went wrong. Reload the page. (Reference ${ref})`); }
});
app.use(express.static(PUB, { index: false }));
app.use((req, res) => res.status(404).send("Not found"));

module.exports = app;

if (require.main === module) {
  scheduler.start(APP_URL);
  app.listen(PORT, () => obs.log("info", "AXION listening", { appUrl: APP_URL, port: PORT, email: mail.enabled(), microsoft: ms.enabled(), version: VERSION }));
}
