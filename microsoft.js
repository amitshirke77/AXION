"use strict";
// "Sign in with Microsoft" (OpenID Connect, authorization code + PKCE).
// Needs an app registration in Microsoft Entra ID; see README. Disabled until MS_CLIENT_ID is set.
const crypto = require("crypto");

const CLIENT_ID = process.env.MS_CLIENT_ID;
const CLIENT_SECRET = process.env.MS_CLIENT_SECRET;
const TENANT = process.env.MS_TENANT || "organizations"; // a tenant id limits sign-in to one organisation
const enabled = () => !!(CLIENT_ID && CLIENT_SECRET);

// Sign-in state travels in a short-lived signed cookie, so it works across serverless instances.
const SECRET = process.env.SESSION_SECRET || crypto.createHash("sha256").update("axion:" + (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "local")).digest("hex");
const sign = (v) => crypto.createHmac("sha256", SECRET).update(v).digest("base64url");
function pack(obj) { const v = Buffer.from(JSON.stringify(obj)).toString("base64url"); return `${v}.${sign(v)}`; }
function unpack(c) {
  const [v, sig] = String(c || "").split(".");
  if (!v || !sig) return null;
  const a = Buffer.from(sign(v)), b = Buffer.from(sig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { const o = JSON.parse(Buffer.from(v, "base64url").toString()); return o.exp > Date.now() ? o : null; } catch (_) { return null; }
}

let jwks = null;
async function keys() {
  if (!jwks) { const { createRemoteJWKSet } = await import("jose"); jwks = createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${TENANT === "organizations" || TENANT === "common" ? "common" : TENANT}/discovery/v2.0/keys`)); }
  return jwks;
}
const redirectUri = (appUrl) => `${appUrl.replace(/\/$/, "")}/auth/microsoft/callback`;

function startUrl(appUrl) {
  const state = crypto.randomBytes(16).toString("base64url");
  const nonce = crypto.randomBytes(16).toString("base64url");
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const cookie = pack({ state, verifier, nonce, exp: Date.now() + 10 * 6e4 });
  const q = new URLSearchParams({ client_id: CLIENT_ID, response_type: "code", redirect_uri: redirectUri(appUrl), response_mode: "query", scope: "openid profile email", state, nonce, code_challenge: challenge, code_challenge_method: "S256", prompt: "select_account" });
  return { url: `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize?${q}`, cookie };
}

async function finish(appUrl, { code, state }, cookie) {
  const p = unpack(cookie);
  if (!p || p.state !== state) throw new Error("This sign-in attempt has expired. Please try again.");
  const res = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: "authorization_code", code, redirect_uri: redirectUri(appUrl), code_verifier: p.verifier }),
  });
  const tok = await res.json();
  if (!res.ok || !tok.id_token) throw new Error("Microsoft sign-in failed: " + (tok.error_description || tok.error || res.status));
  const { jwtVerify } = await import("jose");
  const { payload } = await jwtVerify(tok.id_token, await keys(), { audience: CLIENT_ID });
  if (!/^https:\/\/login\.microsoftonline\.com\/[0-9a-f-]{36}\/v2\.0$/.test(String(payload.iss))) throw new Error("Unexpected token issuer.");
  if (TENANT !== "organizations" && TENANT !== "common" && payload.tid !== TENANT) throw new Error("This Microsoft account belongs to a different organisation.");
  if (payload.nonce !== p.nonce) throw new Error("Sign-in check failed. Please try again.");
  const email = String(payload.email || payload.preferred_username || "").toLowerCase();
  if (!email.includes("@")) throw new Error("Your Microsoft account didn't share an email address.");
  return { email, name: payload.name || "" };
}

module.exports = { enabled, startUrl, finish };
