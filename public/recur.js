"use strict";
// Reminder schedules, shared by the browser (window.AXION_RECUR) and the server (require).
// A schedule is { freq, start: "YYYY-MM-DD", end?: "YYYY-MM-DD" }. Dates are calendar dates (IST).
(function (root) {
  const FREQS = [
    ["once", "Once"], ["daily", "Every day"], ["weekdays", "Every weekday (Mon–Fri)"], ["weekly", "Every week"],
    ["fortnightly", "Every 2 weeks"], ["monthly", "Every month"], ["quarterly", "Every quarter"], ["yearly", "Every year"],
  ];
  const D = (s) => { const [y, m, d] = String(s).split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const S = (dt) => dt.toISOString().slice(0, 10);
  const days = (a, b) => Math.round((D(b) - D(a)) / 864e5);
  const lastDay = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  function monthsMatch(start, date, every) {
    const a = D(start), b = D(date);
    const diff = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
    if (diff < 0 || diff % every) return false;
    const want = Math.min(a.getUTCDate(), lastDay(b.getUTCFullYear(), b.getUTCMonth())); // 31st → last day of shorter months
    return b.getUTCDate() === want;
  }
  /** Is there an occurrence on this date? */
  function isDue(r, date) {
    if (!r || !r.start || !date || date < r.start || (r.end && date > r.end)) return false;
    const dow = D(date).getUTCDay();
    switch (r.freq) {
      case "once": return date === r.start;
      case "daily": return true;
      case "weekdays": return dow >= 1 && dow <= 5;
      case "weekly": return days(r.start, date) % 7 === 0;
      case "fortnightly": return days(r.start, date) % 14 === 0;
      case "monthly": return monthsMatch(r.start, date, 1);
      case "quarterly": return monthsMatch(r.start, date, 3);
      case "yearly": return monthsMatch(r.start, date, 12);
      default: return false;
    }
  }
  /** Next n occurrence dates on or after `from`. */
  function next(r, from, n = 3, horizon = 800) {
    const out = []; let dt = D(from < (r.start || from) ? r.start : from);
    for (let i = 0; i < horizon && out.length < n; i++) { const s = S(dt); if (r.end && s > r.end) break; if (isDue(r, s)) out.push(s); dt = new Date(dt.getTime() + 864e5); }
    return out;
  }
  /** Most recent occurrence on or before `date` (within `back` days). */
  function last(r, date, back = 400) {
    let dt = D(date);
    for (let i = 0; i <= back; i++) { const s = S(dt); if (s < r.start) return null; if (isDue(r, s)) return s; dt = new Date(dt.getTime() - 864e5); }
    return null;
  }
  const label = (f) => (FREQS.find((x) => x[0] === f) || [f, f])[1];
  const api = { FREQS, isDue, next, last, label };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.AXION_RECUR = api;
})(typeof window !== "undefined" ? window : globalThis);
