"use strict";
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

const PORT = Number(process.env.PORT || 3000);
const APP_URL = (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const SECURE = APP_URL.startsWith("https://");
const PUB = path.join(__dirname, "public");

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
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

// ---------- helpers ----------
const err = (status, message) => Object.assign(new Error(message), { status });
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  if (!e.status || e.status >= 500) console.error(e);
  res.status(e.status || 500).json({ error: e.status && e.status < 500 ? e.message : "Something went wrong on the server. Try again." });
});
function loadUser(req) {
  const pid = store.sessionPerson(req.cookies.sid);
  if (!pid) return null;
  const u = store.getUser(pid);
  if (!u || !u.loginEnabled) return null;
  const p = store.getDoc("people/" + pid);
  return { ...u, name: p ? p.data.name : u.email, clientId: p ? p.data.clientId || "" : "" };
}
const needUser = (req) => { const u = loadUser(req); if (!u) throw err(401, "Please sign in."); return u; };
const needAdmin = (req) => { const u = needUser(req); if (u.role !== "admin") throw err(403, "Only admins can do this."); return u; };
function setSession(res, personId) {
  const token = store.createSession(personId);
  store.touchLogin(personId);
  res.cookie("sid", token, { httpOnly: true, secure: SECURE, sameSite: "lax", maxAge: 30 * 864e5, path: "/" });
}
// Simple CSRF guard: browsers can't add this header cross-site without CORS, which we never allow
app.use("/api", (req, res, next) => { if (req.method !== "GET" && req.get("x-tracker") !== "1") return res.status(403).json({ error: "Bad request." }); next(); });

// Login throttle: 10 failures per 15 minutes per IP+email
const fails = new Map();
const throttleKey = (req, email) => `${req.ip}|${String(email || "").toLowerCase()}`;
function throttled(req, email) { const f = fails.get(throttleKey(req, email)); return f && f.n >= 10 && f.t > Date.now() - 15 * 6e4; }
function fail(req, email) { const k = throttleKey(req, email); const f = fails.get(k); fails.set(k, f && f.t > Date.now() - 15 * 6e4 ? { n: f.n + 1, t: f.t } : { n: 1, t: Date.now() }); }

// ---------- public ----------
app.get("/healthz", (req, res) => res.json({ ok: true }));
app.get("/api/config", (req, res) => res.json({ msEnabled: ms.enabled(), mailEnabled: mail.enabled(), appUrl: APP_URL }));
for (const p of ["/login", "/invite/:token", "/reset/:token"]) app.get(p, (req, res) => res.sendFile(path.join(PUB, "login.html")));

app.post("/api/auth/login", wrap(async (req, res) => {
  const { email, password } = req.body || {};
  if (throttled(req, email)) throw err(429, "Too many attempts. Wait 15 minutes or reset your password.");
  const u = store.getUserByEmail(email);
  const hash = u && store.getHash(u.personId);
  if (!u || !u.loginEnabled || !hash || !(await bcrypt.compare(String(password || ""), hash))) {
    fail(req, email);
    throw err(401, u && u.loginEnabled && !hash ? "No password is set for this account yet. Use your invite link, “Forgot password”, or Sign in with Microsoft." : "Email or password is incorrect.");
  }
  setSession(res, u.personId);
  res.json({ ok: true });
}));
app.post("/api/auth/logout", wrap(async (req, res) => { store.destroySession(req.cookies.sid); res.clearCookie("sid", { path: "/" }); res.json({ ok: true }); }));
app.post("/api/auth/forgot", wrap(async (req, res) => {
  const u = store.getUserByEmail((req.body || {}).email);
  if (u && u.loginEnabled && mail.enabled()) {
    const token = store.createToken(u.personId, "reset", 2);
    const p = store.getDoc("people/" + u.personId);
    await mail.send({ to: u.email, subject: "Reset your Action Tracker password", html: `<p>Hi ${p ? p.data.name : ""},</p><p><a href="${APP_URL}/reset/${token}">Set a new password</a>. This link works for 2 hours.</p><p>If you didn't ask for this, ignore this email.</p>` }).catch((e) => console.error("forgot mail", e.message));
  }
  res.json({ ok: true, mailEnabled: mail.enabled() });
}));
app.get("/api/auth/token/:token", wrap(async (req, res) => {
  const t = store.peekToken(req.params.token);
  if (!t) return res.json({ valid: false });
  const u = store.getUser(t.personId), p = store.getDoc("people/" + t.personId);
  res.json({ valid: !!u, purpose: t.purpose, email: u && u.email, name: p ? p.data.name : "" });
}));
app.post("/api/auth/set-password", wrap(async (req, res) => {
  const { token, password } = req.body || {};
  const t = store.peekToken(token);
  if (!t) throw err(400, "This link has expired or was already used. Ask your admin for a new one.");
  if (String(password || "").length < 10) throw err(400, "Use at least 10 characters.");
  const u = store.getUser(t.personId);
  if (!u || !u.loginEnabled) throw err(403, "This account isn't enabled.");
  store.setPasswordHash(t.personId, await bcrypt.hash(String(password), 12));
  store.useToken(token);
  store.destroySessionsFor(t.personId);
  setSession(res, t.personId);
  res.json({ ok: true });
}));
app.post("/api/auth/change-password", wrap(async (req, res) => {
  const u = needUser(req);
  const { current, next } = req.body || {};
  const hash = store.getHash(u.personId);
  if (hash && !(await bcrypt.compare(String(current || ""), hash))) throw err(400, "Your current password is incorrect.");
  if (String(next || "").length < 10) throw err(400, "Use at least 10 characters.");
  store.setPasswordHash(u.personId, await bcrypt.hash(String(next), 12));
  store.destroySessionsFor(u.personId);
  setSession(res, u.personId);
  res.json({ ok: true });
}));

app.get("/auth/microsoft", (req, res) => {
  if (!ms.enabled()) return res.redirect("/login?e=" + encodeURIComponent("Microsoft sign-in isn't set up yet."));
  res.redirect(ms.startUrl(APP_URL));
});
app.get("/auth/microsoft/callback", async (req, res) => {
  try {
    if (req.query.error) throw new Error(req.query.error_description || "Microsoft sign-in was cancelled.");
    const { email } = await ms.finish(APP_URL, { code: String(req.query.code || ""), state: String(req.query.state || "") });
    const u = store.getUserByEmail(email);
    if (!u || !u.loginEnabled) throw new Error(`${email} doesn't have access to the tracker. Ask Amit to add you.`);
    if (!u.msAllowed) throw new Error("Microsoft sign-in is turned off for your account. Use your email and password.");
    setSession(res, u.personId);
    res.redirect("/");
  } catch (e) {
    res.redirect("/login?e=" + encodeURIComponent(e.message));
  }
});

// ---------- signed-in ----------
app.get("/api/auth/me", wrap(async (req, res) => {
  const u = needUser(req);
  res.json({ personId: u.personId, name: u.name, email: u.email, role: u.role, scopes: u.scopes, clientId: u.clientId, hasPassword: u.hasPassword, mailEnabled: mail.enabled(), msEnabled: ms.enabled() });
}));
app.get("/api/rev", wrap(async (req, res) => { needUser(req); res.json({ rev: store.rev() }); }));

const shape = (d, data) => ({ id: d.id, exists: true, data, version: d.version });
app.get("/api/db/doc", wrap(async (req, res) => {
  const u = needUser(req);
  const segs = store.splitPath(req.query.path);
  if (segs.length % 2) throw err(400, "Not a document path.");
  const d = store.getDoc(segs.join("/"));
  if (!d || !access.canReadDoc(u, segs, d.data)) return res.json({ id: segs[segs.length - 1], exists: false });
  res.json(shape(d, access.redact(u, segs, d.data)));
}));
app.get("/api/db/coll", wrap(async (req, res) => {
  const u = needUser(req);
  const segs = store.splitPath(req.query.path);
  if (!(segs.length % 2)) throw err(400, "Not a collection path.");
  if (segs[0] === "actions" && segs.length === 3) {
    const a = store.getDoc(`actions/${segs[1]}`);
    if (!a || !access.canReadAction(u, a.data)) return res.json({ docs: [] });
  }
  const docs = [];
  for (const d of store.listColl(segs.join("/"))) {
    const ds = [...segs, d.id];
    if (access.canReadDoc(u, ds, d.data)) docs.push(shape(d, access.redact(u, ds, d.data)));
  }
  res.json({ docs });
}));

function write(u, path_, op, data) {
  const segs = store.splitPath(path_);
  if (segs.length % 2) throw err(400, "Not a document path.");
  const p = segs.join("/");
  const old = store.getDoc(p);
  if ((op === "update" || op === "delete") && !old) throw err(400, "That item no longer exists.");
  if (data !== null && (typeof data !== "object" || Array.isArray(data))) throw err(400, "Bad data.");
  const next = op === "delete" ? null : op === "update" ? store.mergeDeep(old.data, data) : data;
  const out = access.checkWrite(u, segs, old ? old.data : null, next, op === "delete" ? "delete" : old ? "set" : "create");
  if (op === "delete") { store.deleteDoc(p); return { id: segs[segs.length - 1], deleted: true }; }
  const saved = store.putDoc(p, out);
  if (segs[0] === "people" && segs.length === 2 && old && out.email !== old.data.email) {
    const usr = store.getUser(segs[1]);
    if (usr && out.email) { try { store.upsertUser({ ...usr, email: out.email }); } catch (_) { throw err(400, "Another login already uses that email."); } }
  }
  return { id: saved.id, version: saved.version };
}
app.post("/api/db/set", wrap(async (req, res) => res.json(write(needUser(req), req.body.path, "set", req.body.data))));
app.post("/api/db/update", wrap(async (req, res) => res.json(write(needUser(req), req.body.path, "update", req.body.data))));
app.post("/api/db/delete", wrap(async (req, res) => res.json(write(needUser(req), req.body.path, "delete", null))));
app.post("/api/db/add", wrap(async (req, res) => {
  const u = needUser(req);
  const segs = store.splitPath(req.body.coll);
  if (!(segs.length % 2)) throw err(400, "Not a collection path.");
  res.json(write(u, `${segs.join("/")}/${store.randomId()}`, "set", req.body.data));
}));

app.post("/api/mail/send", wrap(async (req, res) => {
  const u = needUser(req);
  if (!["admin", "editor"].includes(u.role)) throw err(403, "Only admins and editors can send updates.");
  const { to, cc, subject, html } = req.body || {};
  await mail.send({ to, cc, subject, html, replyTo: u.email });
  res.json({ ok: true });
}));

// ---------- admin: logins ----------
app.get("/api/admin/users", wrap(async (req, res) => { needAdmin(req); res.json({ users: store.listUsers() }); }));
app.post("/api/admin/users/:personId", wrap(async (req, res) => {
  const me = needAdmin(req);
  const pid = req.params.personId;
  const p = store.getDoc("people/" + pid);
  if (!p) throw err(404, "Person not found.");
  const { role, scopes, loginEnabled, msAllowed } = req.body || {};
  if (!access.ROLES.includes(role)) throw err(400, "Choose a role.");
  if (!p.data.email) throw err(400, "Add an email address for this person first.");
  if (pid === me.personId && (role !== "admin" || !loginEnabled)) throw err(400, "You can't remove your own admin access.");
  if (role === "client" && !p.data.clientId) throw err(400, "Set this person's client in the directory before giving client access.");
  const clean = Array.isArray(scopes) ? scopes.filter((s) => typeof s === "string" && /^[*A-Za-z0-9_\-:.]{1,120}$/.test(s)).slice(0, 50) : [];
  const other = store.getUserByEmail(p.data.email);
  if (other && other.personId !== pid) throw err(400, "Another person already has a login with this email.");
  const u = store.upsertUser({ personId: pid, email: p.data.email, role, scopes: role === "admin" ? ["*"] : clean, loginEnabled: !!loginEnabled, msAllowed: msAllowed !== false });
  if (!u.loginEnabled) store.destroySessionsFor(pid);
  res.json({ user: u });
}));
app.delete("/api/admin/users/:personId", wrap(async (req, res) => {
  const me = needAdmin(req);
  if (req.params.personId === me.personId) throw err(400, "You can't remove your own login.");
  store.removeUser(req.params.personId);
  res.json({ ok: true });
}));
app.post("/api/admin/users/:personId/invite", wrap(async (req, res) => {
  needAdmin(req);
  const u = store.getUser(req.params.personId);
  if (!u || !u.loginEnabled) throw err(400, "Give this person access first.");
  const p = store.getDoc("people/" + u.personId);
  const token = store.createToken(u.personId, u.hasPassword ? "reset" : "invite", 7 * 24);
  const link = `${APP_URL}/invite/${token}`;
  let emailed = false, mailError = null;
  if (mail.enabled() && (req.body || {}).send !== false) {
    try {
      await mail.send({ to: u.email, subject: "You've been added to the Action Tracker", html: `<p>Hi ${p ? p.data.name : ""},</p><p>Amit has given you access to the group Action Tracker, where you can see your action items and post updates.</p><p><a href="${link}">Set your password and sign in</a> (link valid for 7 days).</p>${ms.enabled() && u.msAllowed ? `<p>If you have a Microsoft work account with this email, you can also use “Sign in with Microsoft” at <a href="${APP_URL}/login">${APP_URL}/login</a>.</p>` : ""}` });
      emailed = true;
    } catch (e) { mailError = e.message; }
  }
  res.json({ link, emailed, mailError });
}));
app.post("/api/admin/run/:job", wrap(async (req, res) => {
  needAdmin(req);
  const dryRun = (req.body || {}).dryRun !== false;
  if (req.params.job === "requests") return res.json(await scheduler.sendUpdateRequests(APP_URL, { dryRun }));
  if (req.params.job === "digest") return res.json(await scheduler.sendDigest(APP_URL, { dryRun }));
  throw err(404, "Unknown job.");
}));

// ---------- app shell ----------
app.get("/", (req, res) => { if (!loadUser(req)) return res.redirect("/login"); res.sendFile(path.join(PUB, "index.html")); });
app.use(express.static(PUB, { index: false }));
app.use((req, res) => res.status(404).send("Not found"));

// ---------- first start ----------
function bootstrap() {
  const seedFile = path.join(__dirname, "seed", "seed.json");
  if (!store.listColl("org").length && fs.existsSync(seedFile)) {
    const seed = JSON.parse(fs.readFileSync(seedFile, "utf8"));
    const tx = store.db.transaction(() => { for (const [p, d] of Object.entries(seed.docs || {})) store.putDoc(p, d); });
    tx();
    console.log(`[seed] loaded ${Object.keys(seed.docs || {}).length} documents`);
  }
  if (!store.getDoc("org/settings")) store.putDoc("org/settings", { requestsEnabled: false, digestEnabled: false, hideDueFor: ["exp"] });
  const adminEmail = (process.env.ADMIN_EMAIL || "amit.shirke@zipstacc.com").toLowerCase();
  if (!store.listUsers().some((u) => u.role === "admin")) {
    let person = store.listColl("people").find((d) => String(d.data.email || "").toLowerCase() === adminEmail);
    if (!person) person = store.putDoc("people/admin", { name: process.env.ADMIN_NAME || "Admin", email: adminEmail, role: "Leadership", side: "internal", companyId: "", clientId: "", teamId: "", active: true });
    store.upsertUser({ personId: person.id, email: adminEmail, role: "admin", scopes: ["*"], loginEnabled: true, msAllowed: true });
    console.log(`[bootstrap] admin login created for ${adminEmail}`);
  }
  const admin = store.getUserByEmail(adminEmail);
  if (admin && !admin.hasPassword && process.env.ADMIN_PASSWORD) {
    store.setPasswordHash(admin.personId, bcrypt.hashSync(process.env.ADMIN_PASSWORD, 12));
    console.log("[bootstrap] admin password set from ADMIN_PASSWORD");
  }
}

bootstrap();
scheduler.start(APP_URL);
app.listen(PORT, () => console.log(`Action Tracker on ${APP_URL} (port ${PORT}) · email ${mail.enabled() ? "on" : "off"} · Microsoft sign-in ${ms.enabled() ? "on" : "off"}`));
