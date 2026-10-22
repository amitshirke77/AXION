"use strict";
// Outgoing email over SMTP (Microsoft 365, Gmail, SendGrid, Brevo... any SMTP server).
const nodemailer = require("nodemailer");

const cfg = {
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  user: process.env.SMTP_USER,
  pass: process.env.SMTP_PASS,
  from: process.env.MAIL_FROM || process.env.SMTP_USER,
};
const enabled = () => !!(cfg.host && cfg.user && cfg.pass && cfg.from);
let transport = null;
function t() {
  if (!transport) transport = nodemailer.createTransport({ host: cfg.host, port: cfg.port, secure: cfg.port === 465, auth: { user: cfg.user, pass: cfg.pass } });
  return transport;
}
async function send({ to, cc, subject, html, text, replyTo }) {
  if (!enabled()) throw Object.assign(new Error("Email isn't set up on this server yet (SMTP settings missing)."), { status: 503 });
  const list = (x) => (Array.isArray(x) ? x : String(x || "").split(/[,;\s]+/)).map((s) => s.trim()).filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
  const toL = list(to), ccL = list(cc);
  if (!toL.length) throw Object.assign(new Error("Add at least one valid recipient email."), { status: 400 });
  if (toL.length + ccL.length > 50) throw Object.assign(new Error("Too many recipients (50 maximum)."), { status: 400 });
  return t().sendMail({ from: cfg.from, to: toL, cc: ccL, subject: String(subject || "").slice(0, 250), html, text, replyTo });
}
/** Checks the SMTP server accepts the login (no email is sent). */
async function verify() { if (!enabled()) throw new Error("not set up"); await t().verify(); return { host: cfg.host }; }
module.exports = { enabled, send, verify };
