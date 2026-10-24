"use strict";
// Minutes of meeting → PDF (A4), built with pdfkit and its built-in Helvetica.
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

const NAVY = "#182432", BLUE = "#2f5bd3", INK = "#1d1d1f", MUTED = "#6e6e73", LINE = "#d9dce3", SOFT = "#f3f5f9", RED = "#c4161c";
const LOGO = path.join(__dirname, "..", "public", "monogram.png");
// Organisation logo shown top-right, by company id
const ORG_LOGO = { poc: "poc.png", exp: "exp.png", ukb: "ukb.png" };
const orgLogo = (companyId) => { const f = ORG_LOGO[companyId]; const p = f && path.join(__dirname, "..", "assets", "logos", f); return p && fs.existsSync(p) ? p : null; };

// Built-in PDF fonts only cover Western European characters: map common symbols and drop the rest.
const MAP = { "→": "->", "←": "<-", "⇒": "=>", "✓": "v", "✔": "v", "✗": "x", "₹": "Rs ", "≥": ">=", "≤": "<=", "≠": "!=", "×": "x", "−": "-", "‑": "-", " ": " ", "⛔": "", "🔒": "" };
const CP1252 = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");
function clean(s) {
  return String(s == null ? "" : s).replace(/[^\n\t\x20-\x7e]/g, (ch) => {
    if (ch in MAP) return MAP[ch];
    const c = ch.codePointAt(0);
    if ((c >= 0xa0 && c <= 0xff) || CP1252.has(ch)) return ch;
    return "";
  });
}
const fmtDate = (d) => {
  if (!d) return "—";
  const x = new Date(String(d).length === 10 ? d + "T00:00:00Z" : d);
  return isNaN(x) ? String(d) : x.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
};

/**
 * @param m        meeting document data
 * @param ctx      { actions:[{...data,id}], people:{id:data}, containerLabel, audience, hideDue, preparedBy }
 * @returns Promise<Buffer>
 */
function buildPdf(m, ctx) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margins: { top: 48, bottom: 60, left: 48, right: 48 }, bufferPages: true,
      info: { Title: clean(`Minutes of meeting - ${m.title || ""}`), Author: clean(ctx.preparedBy || ""), Creator: "AXION (internal tool)" } });
    const chunks = []; doc.on("data", (c) => chunks.push(c)); doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject);
    const W = doc.page.width - 96, X = 48;
    const pn = (id) => (ctx.people[id] ? ctx.people[id].name : "") || "—";
    const client = ctx.audience === "client";

    // ---- header band ----
    doc.rect(0, 0, doc.page.width, 104).fill(NAVY);
    try { if (fs.existsSync(LOGO)) doc.image(LOGO, X, 26, { width: 52, height: 52 }); } catch (_) {}
    const org = orgLogo(m.companyId), boxW = org ? 128 : 0;
    if (org) {
      const bx = X + W - boxW, by = 24;
      doc.roundedRect(bx, by, boxW, 56, 6).fill("#ffffff");
      try { doc.image(org, bx + 9, by + 8, { fit: [boxW - 18, 40], align: "center", valign: "center" }); } catch (_) {}
    }
    const tw = W - 66 - (org ? boxW + 14 : 0);
    doc.fillColor("#aeb8c7").font("Helvetica").fontSize(9).text("MINUTES OF MEETING", X + 66, 26, { characterSpacing: 1.2 });
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(15.5).text(clean(m.title || "Meeting"), X + 66, 39, { width: tw, height: 38, ellipsis: true, lineGap: 1 });
    doc.fillColor("#aeb8c7").font("Helvetica").fontSize(9.5).text(clean(ctx.containerLabel || ""), X + 66, Math.min(doc.y + 3, 84), { width: tw });
    doc.y = 124;

    // ---- details grid ----
    const details = [
      ["Date", `${fmtDate(m.date)}${m.time ? "  ·  " + m.time : ""}`],
      ["Meeting type", m.type || "—"],
      ["Venue / mode", m.venue || "—"],
      ["Prepared by", ctx.preparedBy || "—"],
    ];
    const colW = W / 2;
    details.forEach(([k, v], i) => {
      const cx = X + (i % 2) * colW, cy = 124 + Math.floor(i / 2) * 34;
      doc.fillColor(MUTED).font("Helvetica").fontSize(8.5).text(k.toUpperCase(), cx, cy, { characterSpacing: 0.6 });
      doc.fillColor(INK).font("Helvetica-Bold").fontSize(10.5).text(clean(v), cx, cy + 12, { width: colW - 12 });
    });
    doc.y = 124 + 2 * 34 + 6;

    const ensure = (h) => { if (doc.y + h > doc.page.height - doc.page.margins.bottom) doc.addPage(); };
    const heading = (t) => {
      ensure(40); doc.moveDown(0.6);
      const y = doc.y; doc.rect(X, y, 3, 14).fill(BLUE);
      doc.fillColor(INK).font("Helvetica-Bold").fontSize(12).text(t, X + 10, y + 1); doc.moveDown(0.35);
    };
    const para = (t) => {
      const lines = clean(t).trim().split(/\n+/).filter(Boolean);
      doc.font("Helvetica").fontSize(10).fillColor(INK);
      for (const ln of lines) {
        const bullet = /^\s*([-*•]|\d+[.)])\s+/.test(ln);
        const text = ln.replace(/^\s*[-*•]\s+/, "");
        ensure(16);
        if (bullet && !/^\s*\d+[.)]/.test(ln)) { const y = doc.y; doc.circle(X + 4, y + 5.2, 1.6).fill(INK); doc.fillColor(INK).text(text, X + 12, y, { width: W - 12 }); }
        else doc.text(text, X, doc.y, { width: W });
        doc.moveDown(0.25);
      }
    };

    // ---- attendees ----
    const att = (m.attendees || []).map((id) => { const p = ctx.people[id]; return p ? `${p.name}${p.role ? " (" + p.role + ")" : ""}` : null; }).filter(Boolean);
    const guests = String(m.guests || "").split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
    if (att.length || guests.length) {
      heading("Attendees");
      doc.font("Helvetica").fontSize(10).fillColor(INK).text(clean([...att, ...guests].join("  ·  ")), X, doc.y, { width: W });
      if ((m.absent || "").trim()) { doc.moveDown(0.3); doc.fillColor(MUTED).text(clean("Apologies: " + m.absent), { width: W }); }
    }
    if ((m.agenda || "").trim()) { heading("Agenda"); para(m.agenda); }
    if ((m.notes || "").trim()) { heading("Discussion"); para(m.notes); }
    if ((m.decisions || "").trim()) { heading("Decisions"); para(m.decisions); }

    // ---- action items table ----
    const acts = ctx.actions || [];
    heading(`Action items (${acts.length})`);
    if (!acts.length) { doc.font("Helvetica").fontSize(10).fillColor(MUTED).text("No action items recorded.", X, doc.y); }
    else {
      const showDue = !ctx.hideDue;
      const cols = showDue
        ? [["Ref", 78], ["Action · next step", 0], ["Owner", 90], ["NBD", 52], ["Due", 52], ["Status", 58]]
        : [["Ref", 78], ["Action · next step", 0], ["Owner", 100], ["NBD", 56], ["Status", 62]];
      const fixed = cols.reduce((s, c) => s + c[1], 0); cols[1][1] = W - fixed;
      const head = () => {
        let x = X; const y = doc.y;
        doc.rect(X, y, W, 18).fill(SOFT);
        doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(8);
        for (const [t, w] of cols) { doc.text(t.toUpperCase(), x + 5, y + 6, { width: w - 10, characterSpacing: 0.4 }); x += w; }
        doc.y = y + 18;
      };
      head();
      for (const a of acts) {
        const owner = `${pn(a.accountable)}${(a.responsible || []).filter((r) => r !== a.accountable).length ? "\nR: " + (a.responsible || []).filter((r) => r !== a.accountable).map(pn).join(", ") : ""}`;
        const upd = client ? a.lastClientUpdate : a.lastUpdateText;
        const same = upd && a.nba && String(upd).trim().toLowerCase() === String(a.nba).trim().toLowerCase();
        const main = clean(a.title), sub = clean([a.nba ? "Next: " + a.nba : "", upd && !same ? "Latest: " + upd : ""].filter(Boolean).join("\n"));
        const cells = showDue ? [a.ref || "", null, owner, fmtDate(a.nbd), fmtDate(a.due), a.status || ""] : [a.ref || "", null, owner, fmtDate(a.nbd), a.status || ""];
        doc.font("Helvetica-Bold").fontSize(9.5); const hMain = doc.heightOfString(main, { width: cols[1][1] - 10 });
        doc.font("Helvetica").fontSize(8.5); const hSub = sub ? doc.heightOfString(sub, { width: cols[1][1] - 10 }) + 3 : 0;
        const hOwner = doc.heightOfString(clean(owner), { width: cols[2][1] - 10 });
        const rowH = Math.max(hMain + hSub, hOwner, 12) + 12;
        if (doc.y + rowH > doc.page.height - doc.page.margins.bottom) { doc.addPage(); head(); }
        const y = doc.y; let x = X;
        cols.forEach(([, w], i) => {
          if (i === 1) {
            doc.fillColor(INK).font("Helvetica-Bold").fontSize(9.5).text(main, x + 5, y + 6, { width: w - 10 });
            if (sub) doc.fillColor(MUTED).font("Helvetica").fontSize(8.5).text(sub, x + 5, y + 6 + hMain + 3, { width: w - 10 });
          } else {
            const v = clean(cells[i]); const blocked = i === cols.length - 1 && v === "Blocked";
            doc.fillColor(blocked ? RED : i === 0 ? MUTED : INK).font(i === 0 || blocked ? "Helvetica-Bold" : "Helvetica").fontSize(i === 0 ? 8.5 : 9).text(v, x + 5, y + 6, { width: w - 10 });
          }
          x += w;
        });
        doc.moveTo(X, y + rowH).lineTo(X + W, y + rowH).lineWidth(0.5).strokeColor(LINE).stroke();
        doc.y = y + rowH;
      }
    }
    if ((m.nextMeeting || "").trim()) { heading("Next meeting"); para(m.nextMeeting); }

    // ---- footer on every page ----
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const bm = doc.page.margins.bottom; doc.page.margins.bottom = 0;
      const fy = doc.page.height - 38;
      doc.moveTo(X, fy - 8).lineTo(X + W, fy - 8).lineWidth(0.5).strokeColor(LINE).stroke();
      doc.fillColor(MUTED).font("Helvetica").fontSize(7.5)
        .text(clean(`${client ? "Shared with you by the team" : "Internal"} · Generated ${fmtDate(new Date().toISOString())} from AXION, an internal, non-commercial tool. "AXION" is an internal name only.`), X, fy, { width: W - 70 });
      doc.text(`Page ${i - range.start + 1} of ${range.count}`, X + W - 70, fy, { width: 70, align: "right" });
      doc.page.margins.bottom = bm;
    }
    doc.end();
  });
}

module.exports = { buildPdf, clean };
