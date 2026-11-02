"use strict";
// Branded weekly status update → PDF (A4). The browser builds the report (the same content as the
// weekly email, already limited to what the signed-in person may see) and posts it here to be laid out.
const PDFDocument = require("pdfkit");
const fs = require("fs");
const { clean, orgLogo, LOGO } = require("./mom");

const NAVY = "#182432", INK = "#111111", MUTED = "#5f6368", LINE = "#d9dce3", RED = "#b3131a";
// Section header colours: light backgrounds, black text, a darker edge
const SECTION = {
  closed:    { bg: "#cdeed6", edge: "#2e9e55" },
  blocked:   { bg: "#f8c9c9", edge: "#c62828" },
  overdue:   { bg: "#fddcb5", edge: "#e07b00" },
  focus:     { bg: "#ffeaa0", edge: "#c9a000" },
  coming:    { bg: "#cfe3fb", edge: "#2f6fd6" },
  created:   { bg: "#e4d8f8", edge: "#7a4fd0" },
  recurring: { bg: "#cdeeea", edge: "#14917f" },
  pending:   { bg: "#f1e4c6", edge: "#a6772c" },
};
const fmtDate = (d) => {
  if (!d) return "—";
  const x = new Date(String(d).length === 10 ? d + "T00:00:00Z" : d);
  return isNaN(x) ? String(d) : x.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
};
const str = (v, n = 600) => clean(String(v == null ? "" : v)).slice(0, n);

/**
 * data: { title, label, start, end, audience, companyId, greeting, closing, preparedBy,
 *         stats:{open,closed,blocked,overdue,p12,created}, sections:[{key,title,items:[{ref,title,container,priority,status,owner,doing,nba,nbd,due,update,closure,closedOn}]}] }
 */
function buildWeeklyPdf(data) {
  return new Promise((resolve, reject) => {
    const client = data.audience === "client";
    const doc = new PDFDocument({ size: "A4", margins: { top: 48, bottom: 60, left: 48, right: 48 }, bufferPages: true,
      info: { Title: str(`${data.title} - ${data.label}`), Author: str(data.preparedBy), Creator: "AXION (internal tool)" } });
    const chunks = []; doc.on("data", (c) => chunks.push(c)); doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject);
    const W = doc.page.width - 96, X = 48, bottom = () => doc.page.height - doc.page.margins.bottom;
    const ensure = (h) => { if (doc.y + h > bottom()) doc.addPage(); };

    // ---- header band with AXION monogram and the company logo ----
    doc.rect(0, 0, doc.page.width, 112).fill(NAVY);
    try { if (fs.existsSync(LOGO)) doc.image(LOGO, X, 30, { width: 52, height: 52 }); } catch (_) {}
    const logos = data.companyId ? [orgLogo(data.companyId)].filter(Boolean) : ["poc", "exp", "ukb"].map(orgLogo).filter(Boolean);
    const boxW = logos.length > 1 ? 196 : logos.length ? 128 : 0;
    if (logos.length) {
      const bx = X + W - boxW, by = 28;
      doc.roundedRect(bx, by, boxW, 56, 6).fill("#ffffff");
      const slot = (boxW - 12) / logos.length;
      logos.forEach((lg, i) => { try { doc.image(lg, bx + 6 + i * slot + 4, by + 8, { fit: [slot - 8, 40], align: "center", valign: "center" }); } catch (_) {} });
    }
    const tw = W - 66 - (boxW ? boxW + 14 : 0);
    doc.fillColor("#aeb8c7").font("Helvetica").fontSize(9).text(client ? "WEEKLY STATUS UPDATE" : "WEEKLY ACTION UPDATE", X + 66, 30, { characterSpacing: 1.2 });
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(17).text(str(data.label, 120), X + 66, 44, { width: tw, height: 40, ellipsis: true });
    doc.fillColor("#aeb8c7").font("Helvetica").fontSize(9.5).text(`Week ${fmtDate(data.start)} – ${fmtDate(data.end)}`, X + 66, Math.min(doc.y + 3, 92), { width: tw });
    doc.y = 130;

    // ---- greeting ----
    if (data.greeting) { doc.fillColor(INK).font("Helvetica").fontSize(10.5).text(str(data.greeting, 1200), X, doc.y, { width: W }); doc.moveDown(0.8); }

    // ---- summary tiles ----
    const st = data.stats || {};
    const tiles = [["Open", st.open], ["Closed this week", st.closed], ["Blocked", st.blocked], ...(client ? [] : [["Past due", st.overdue]]), ["P1 / P2 open", st.p12], ["New this week", st.created]]
      .filter(([, v]) => v !== undefined && v !== null);
    const tg = 8, tW = (W - tg * (tiles.length - 1)) / tiles.length, ty = doc.y;
    tiles.forEach(([k, v], i) => {
      const tx = X + i * (tW + tg);
      doc.roundedRect(tx, ty, tW, 50, 6).fill("#f3f5f9");
      const hot = (k === "Blocked" || k === "Past due") && +v > 0;
      doc.fillColor(hot ? RED : INK).font("Helvetica-Bold").fontSize(18).text(String(v ?? 0), tx + 10, ty + 8, { width: tW - 20 });
      doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(k.toUpperCase(), tx + 10, ty + 32, { width: tW - 20, characterSpacing: 0.4 });
    });
    doc.y = ty + 64;

    // ---- sections ----
    const sections = (data.sections || []).filter((sct) => (sct.items || []).length);
    if (!sections.length) { doc.fillColor(MUTED).font("Helvetica").fontSize(10.5).text("No open or closed items in this period.", X, doc.y); }
    for (const sct of sections) {
      const col = SECTION[sct.key] || { bg: "#e6e8ee", edge: "#8a8f99" };
      ensure(70);
      const hy = doc.y + 4;
      doc.roundedRect(X, hy, W, 26, 5).fill(col.bg);
      doc.rect(X, hy, 5, 26).fill(col.edge);
      doc.fillColor("#000000").font("Helvetica-Bold").fontSize(11.5).text(`${str(sct.title, 80)}  (${sct.items.length})`, X + 14, hy + 8, { width: W - 28 });
      doc.y = hy + 34;
      for (const it of sct.items) {
        const title = `${str(it.ref, 30)}  ·  ${str(it.title, 300)}`;
        const meta = [it.priority, it.status === "Blocked" ? null : it.status, it.owner ? "Owner " + it.owner : "", it.doing ? "Doing: " + it.doing : "", it.container || ""].filter(Boolean).map((x) => str(x, 120)).join("   ·   ");
        const lines = [];
        if (sct.key === "closed") { if (it.closedOn) lines.push(["Closed", fmtDate(it.closedOn)]); if (it.closure) lines.push(["Outcome", it.closure]); }
        else {
          lines.push(["Next step", `${it.nba || "—"}${it.nbd ? "  (by " + fmtDate(it.nbd) + ")" : ""}`]);
          if (it.due) lines.push(["Due", fmtDate(it.due)]);
          if (it.blockedNote && sct.key === "blocked") lines.push(["Blocker", it.blockedNote]);
          if (it.update && String(it.update).trim().toLowerCase() !== String(it.nba || "").trim().toLowerCase()) lines.push(["Latest", it.update]);
          if (it.recurNext) lines.push(["Next occurrence", fmtDate(it.recurNext)]);
          if (it.pendingNote) lines.push(["Update", it.pendingNote]);
        }
        doc.font("Helvetica-Bold").fontSize(10); const hT = doc.heightOfString(title, { width: W - 16 });
        doc.font("Helvetica").fontSize(8.5); const hM = meta ? doc.heightOfString(meta, { width: W - 16 }) : 0;
        doc.font("Helvetica").fontSize(9); const hL = lines.reduce((s2, [k, v]) => s2 + doc.heightOfString(`${k}: ${str(v)}`, { width: W - 16 }) + 2, 0);
        const blockH = hT + hM + hL + 18;
        ensure(blockH);
        const y = doc.y;
        doc.rect(X, y + 2, 2, blockH - 10).fill(col.edge);
        doc.fillColor(INK).font("Helvetica-Bold").fontSize(10).text(title, X + 12, y + 2, { width: W - 16 });
        let yy = y + 2 + hT + 2;
        if (meta) { doc.fillColor(it.status === "Blocked" ? RED : MUTED).font("Helvetica").fontSize(8.5).text(it.status === "Blocked" ? "BLOCKED   ·   " + meta : meta, X + 12, yy, { width: W - 16 }); yy += hM + 3; }
        for (const [k, v] of lines) {
          doc.font("Helvetica-Bold").fontSize(9).fillColor(k === "Blocker" ? RED : INK).text(`${k}: `, X + 12, yy, { continued: true, width: W - 16 })
            .font("Helvetica").fillColor(k === "Blocker" ? RED : "#2b2b2b").text(str(v), { width: W - 16 });
          yy = doc.y + 2;
        }
        doc.y = Math.max(yy, y + blockH - 6);
        doc.moveTo(X + 12, doc.y).lineTo(X + W, doc.y).lineWidth(0.4).strokeColor(LINE).stroke();
        doc.y += 8;
      }
      doc.moveDown(0.4);
    }

    if (data.closing) { ensure(40); doc.moveDown(0.6); doc.fillColor(INK).font("Helvetica").fontSize(10.5).text(str(data.closing, 1200), X, doc.y, { width: W }); }

    // ---- footer ----
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const bm = doc.page.margins.bottom; doc.page.margins.bottom = 0;
      const fy = doc.page.height - 38;
      doc.moveTo(X, fy - 8).lineTo(X + W, fy - 8).lineWidth(0.5).strokeColor(LINE).stroke();
      doc.fillColor(MUTED).font("Helvetica").fontSize(7.5)
        .text(str(`${client ? "Prepared for " + (data.label || "you") : "Internal"} · ${data.preparedBy ? "Prepared by " + data.preparedBy + " · " : ""}Generated from AXION, an internal, non-commercial tool. "AXION" is an internal name only.`, 300), X, fy, { width: W - 70 });
      doc.text(`Page ${i - range.start + 1} of ${range.count}`, X + W - 70, fy, { width: 70, align: "right" });
      doc.page.margins.bottom = bm;
    }
    doc.end();
  });
}

module.exports = { buildWeeklyPdf, SECTION };
