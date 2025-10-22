// src/utils/helpers.js
export const iso = (d) => d.toISOString().slice(0, 10);
export const fmtShort = (d) => `${String(d.getDate()).padStart(2, "0")} ${d.toLocaleString("en-US", { month: "short" }).slice(0,3)} ${String(d.getFullYear()).slice(2)}`;

// Parse YYYY-MM-DD into a Date in local timezone (avoid UTC parsing / timezone shift bug)
export function parseIsoToLocalDate(isoStr) {
  if (!isoStr) return null;
  const [y, m, d] = isoStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// get weekday as "Sun","Mon",... for local date
export function weekdayNameFromIso(isoStr) {
  const d = parseIsoToLocalDate(isoStr);
  return ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getDay()];
}

// add minutes to a "HH:MM" string
export function addMinutesToTimeStr(timeStr, minutesToAdd) {
  const [hh, mm] = (timeStr || "00:00").split(":").map(Number);
  let total = hh*60 + mm + minutesToAdd;
  total = ((total % (24*60)) + (24*60)) % (24*60);
  const nh = Math.floor(total/60);
  const nm = total % 60;
  return `${String(nh).padStart(2,"0")}:${String(nm).padStart(2,"0")}`;
}

// ensure endTime > startTime; if not, return startTime + 10 minutes (except if start after 23:50)
export function ensureEndAfterStart(startTime, endTime) {
  if (!startTime) return endTime || startTime;
  const [sh, sm] = (startTime || "00:00").split(":").map(Number);
  const [eh, em] = (endTime || startTime || "00:00").split(":").map(Number);
  const startMinutes = sh*60 + sm;
  const endMinutes = eh*60 + em;
  // if start is after 23:50 (i.e., >= 23*60 + 50), do not auto shift beyond midnight; keep endTime as is
  if (startMinutes >= 23*60 + 50) return endTime;
  if (endMinutes <= startMinutes) {
    const newEnd = startMinutes + 10;
    const nh = Math.floor(newEnd/60) % 24;
    const nm = newEnd % 60;
    return `${String(nh).padStart(2,"0")}:${String(nm).padStart(2,"0")}`;
  }
  return endTime;
}