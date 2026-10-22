// Everything between what a person types or pastes and the engine: arrivals parsing, period
// labels, the share-link fragment and the worked example. The fragment never reaches a server.
import { MAX_PERIODS, normalizeLine } from "./simulation.js";

/**
 * @typedef {import("./simulation.js").Line} Line
 * @typedef {"day"|"week"} Unit
 * @typedef {{line:Line, unit:Unit, start:string|null}} Setup
 */

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAY_MS = 86_400_000;

/**
 * The calendar date at the start of a value, as days since 1970-01-01, or null. Accepts ISO
 * dates and timestamps (GitHub, Linear) and Jira's 05/Mar/26 style. The written date is used
 * as is, with no time zone shift.
 * @param {string} value
 */
export function parseDay(value) {
  const text = value.trim().replace(/^"|"$/g, "");
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/);
  const jira = text.match(/^(\d{1,2})\/([A-Za-z]{3})\/(\d{2}|\d{4})(?:$|\s)/);
  let year, month, day;
  if (iso) [year, month, day] = [Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])];
  else if (jira && MONTHS.includes(jira[2].toLowerCase())) {
    year = Number(jira[3]) + (jira[3].length === 2 ? 2000 : 0);
    month = MONTHS.indexOf(jira[2].toLowerCase());
    day = Number(jira[1]);
  } else return null;
  const time = Date.UTC(year, month, day);
  const check = new Date(time);
  return check.getUTCMonth() === month && check.getUTCDate() === day ? time / DAY_MS : null;
}

/** @param {number} day */
export const formatDay = (day) => new Date(day * DAY_MS).toISOString().slice(0, 10);

const COUNT = /^\d+$/;

/**
 * Turn pasted text into arrivals per period. Two shapes are accepted, one row per line:
 * a count (optionally after a date, as in "2026-03-02,14"), or a bare date per item, such as
 * the Created column of a Jira, Linear or GitHub export, which is tallied per day or week.
 * Lines with neither (headers, blanks) are skipped.
 * @param {string} text @param {Unit} unit
 * @returns {{arrivals:number[], start:string|null, skipped:number} | {error:string}}
 */
export function parseArrivals(text, unit) {
  /** @type {{day:number|null, count:number}[]} */
  const counts = [];
  /** @type {number[]} */
  const items = [];
  let skipped = 0;
  for (const raw of text.split(/\r?\n/)) {
    const cells = raw.split(/[,;\t]/).map((cell) => cell.trim().replace(/^"|"$/g, ""));
    if (!cells.some(Boolean)) continue;
    const last = cells.at(-1) ?? "";
    const day = parseDay(cells[0]);
    if (COUNT.test(last) && (cells.length === 1 || day !== null)) counts.push({ day: cells.length === 1 ? null : day, count: Number(last) });
    else if (day !== null) items.push(day);
    else skipped += 1;
  }
  if (counts.length && items.length) {
    return { error: "Paste either one count per line or one date per item, not both." };
  }
  if (counts.length) {
    if (counts.length > MAX_PERIODS) return { error: `That is ${counts.length} periods. The limit is ${MAX_PERIODS}.` };
    const first = counts[0].day;
    return { arrivals: counts.map(({ count }) => count), start: first === null ? null : formatDay(first), skipped };
  }
  if (!items.length) return { error: "No counts or dates found. Paste one number per line, or a column of dates." };
  const size = unit === "week" ? 7 : 1;
  // Weeks start on Monday; 1970-01-01 was a Thursday.
  const bucket = (day) => (unit === "week" ? day - ((day + 3) % 7) : day);
  const first = bucket(Math.min(...items));
  const periods = Math.floor((bucket(Math.max(...items)) - first) / size) + 1;
  if (periods > MAX_PERIODS) return { error: `Those dates span ${periods} ${unit}s. The limit is ${MAX_PERIODS}.` };
  const arrivals = new Array(periods).fill(0);
  for (const day of items) arrivals[(bucket(day) - first) / size] += 1;
  return { arrivals, start: formatDay(first), skipped };
}

/**
 * A period's label: its date when the start is known, otherwise its number.
 * @param {Setup} setup @param {number} period
 */
export function periodLabel({ unit, start }, period) {
  if (!start) return `${unit} ${period}`;
  const first = parseDay(start);
  if (first === null) return `${unit} ${period}`;
  const day = first + (period - 1) * (unit === "week" ? 7 : 1);
  const date = new Date(day * DAY_MS).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return unit === "week" ? `week of ${date}` : date;
}

/** @param {Setup} setup */
export function encodeSetup({ line, unit, start }) {
  const params = new URLSearchParams();
  for (const stage of line.stages) params.append("s", `${stage.name}:${stage.capacity}`);
  if (line.bufferLimit !== null) params.set("wip", String(line.bufferLimit));
  params.set("unit", unit);
  if (start) params.set("start", start);
  params.set("a", line.arrivals.join(","));
  return params.toString();
}

/** @param {string} fragment @returns {Setup|null} */
export function decodeSetup(fragment) {
  const params = new URLSearchParams(fragment.replace(/^#/, ""));
  const stages = params.getAll("s").map((value) => {
    const at = value.lastIndexOf(":");
    return { name: value.slice(0, at), capacity: Number(value.slice(at + 1)) };
  });
  const line = normalizeLine({
    stages,
    bufferLimit: params.get("wip"),
    arrivals: (params.get("a") ?? "").split(",").filter(Boolean),
  });
  if (!line) return null;
  const start = params.get("start");
  return {
    line,
    unit: params.get("unit") === "week" ? "week" : "day",
    start: start && parseDay(start) !== null ? start : null,
  };
}

// The worked example: CAPEX & SOCS purchase-order lines from the BPI Challenge 2019 log,
// derived by scripts/derive-bpi2019.mjs. Each step's capacity is its measured throughput:
// the count it reached or beat on one working day in ten (90th percentile of days it ran).
export const EXAMPLE_STEPS = [
  ["goods_received", "Goods receipt"],
  ["invoices_received", "Invoice receipt"],
  ["invoices_cleared", "Invoice clearing"],
];

/** @param {number[]} values */
export function busyDay(values) {
  const active = values.filter((value) => value > 0).sort((left, right) => left - right);
  return active[Math.ceil(active.length * 0.9) - 1] ?? 1;
}

/** @param {string} csv @returns {Setup} */
export function exampleSetup(csv) {
  const [header, ...rows] = csv.trim().split("\n").map((row) => row.split(","));
  const column = (name) => rows.map((row) => Number(row[header.indexOf(name)]));
  const line = normalizeLine({
    stages: EXAMPLE_STEPS.map(([key, name]) => ({ name, capacity: busyDay(column(key)) })),
    bufferLimit: null,
    arrivals: column("po_lines_created"),
  });
  if (!line) throw new Error("The example CSV does not describe a runnable line.");
  return { line, unit: "day", start: rows[0][0] };
}
