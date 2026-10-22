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
 * Turn pasted text into arrivals per period, one row per line: a bare count, a date and a
 * count ("2026-03-02,14"), or a bare date for each item, such as the Created column of a
 * Jira, Linear or GitHub export. Dated rows are summed into days or Monday-start weeks with
 * empty periods filled in; bare counts are taken in order. Rows with neither are skipped.
 * @param {string} text @param {Unit} unit
 * @returns {{arrivals:number[], start:string|null, skipped:number} | {error:string}}
 */
export function parseArrivals(text, unit) {
  /** @type {number[]} */
  const counts = [];
  /** @type {[number, number][]} */
  const dated = [];
  let skipped = 0;
  for (const raw of text.split(/\r?\n/)) {
    const cells = raw.split(/[,;\t]/).map((cell) => cell.trim().replace(/^"|"$/g, ""));
    if (!cells.some(Boolean)) continue;
    const last = cells.at(-1) ?? "";
    const day = parseDay(cells[0]);
    if (cells.length === 1 && COUNT.test(last)) counts.push(Number(last));
    else if (day !== null) dated.push([day, cells.length > 1 && COUNT.test(last) ? Number(last) : 1]);
    else skipped += 1;
  }
  if (counts.length && dated.length) return { error: "Paste either plain counts or dated rows, not both." };
  if (!counts.length && !dated.length) {
    return { error: "No counts or dates found. Paste one number per line, or a column of dates." };
  }
  if (counts.length) {
    if (counts.length > MAX_PERIODS) return { error: `That is ${counts.length} periods. The limit is ${MAX_PERIODS}.` };
    return { arrivals: counts, start: null, skipped };
  }
  const size = unit === "week" ? 7 : 1;
  // Weeks start on Monday; 1970-01-01 was a Thursday.
  const bucket = (/** @type {number} */ day) => (unit === "week" ? day - ((day + 3) % 7) : day);
  const days = dated.map(([day]) => day);
  const first = bucket(Math.min(...days));
  const periods = (bucket(Math.max(...days)) - first) / size + 1;
  if (periods > MAX_PERIODS) return { error: `Those dates span ${periods} ${unit}s. The limit is ${MAX_PERIODS}.` };
  const arrivals = new Array(periods).fill(0);
  for (const [day, count] of dated) arrivals[(bucket(day) - first) / size] += count;
  return { arrivals, start: formatDay(first), skipped };
}

/**
 * The ISO date a period starts on, or null when the start is unknown.
 * @param {Pick<Setup, "unit"|"start">} setup @param {number} period
 */
export function periodDate({ unit, start }, period) {
  const first = start ? parseDay(start) : null;
  return first === null ? null : formatDay(first + (period - 1) * (unit === "week" ? 7 : 1));
}

/**
 * A period's label: its date when the start is known, otherwise its number.
 * @param {Pick<Setup, "unit"|"start">} setup @param {number} period
 */
export function periodLabel(setup, period) {
  if (period === 0) return "Start";
  const date = periodDate(setup, period);
  if (!date) return `${setup.unit} ${period}`;
  const text = new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return setup.unit === "week" ? `week of ${text}` : text;
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
export const EXAMPLE_FILE = "bpi2019-capex-socs-daily.2026-10-23.csv";
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

/** @param {number} count @param {string} word */
const plural = (count, word) => `${count.toLocaleString("en-GB")} ${word}${count === 1 ? "" : "s"}`;

/**
 * The verdict in words, built only from the replay and its +1 reruns.
 * @param {Setup} setup @param {ReturnType<typeof import("./simulation.js").analyzeLine>} analysis
 */
export function headline(setup, { frames, limiting, periodsLimiting, peak, clearedBy, heldBack, whatIf }) {
  const { unit } = setup;
  const label = (period) => periodLabel(setup, period);
  const when = (period) => (unit === "week" ? `in the ${label(period)}` : `on ${label(period)}`);
  if (limiting === -1) {
    const busiest = frames.reduce((best, frame) => (frame.arrived > best.arrived ? frame : best), frames[0]);
    return {
      title: "No step held work back.",
      detail: [
        `Every step kept up with every ${unit}'s arrivals, including the busiest: ${plural(busiest.arrived, "item")} ${when(busiest.period)}.`,
      ],
    };
  }
  const name = setup.line.stages[limiting].name;
  const capacity = setup.line.stages[limiting].capacity;
  const detail = [
    `It held work back on ${periodsLimiting[limiting]} of ${plural(frames.length - 1, unit)} replayed.`,
    clearedBy === null
      ? `The backlog peaks at ${plural(peak.backlog, "item")} ${when(peak.period)} and has not cleared by the end of the run.`
      : `The backlog peaks at ${plural(peak.backlog, "item")} ${when(peak.period)} and clears by ${label(clearedBy)}, ${plural(clearedBy - peak.period, unit)} later.`,
  ];
  const plusOne = whatIf[limiting];
  const change = `With ${plusOne.capacity} a ${unit} at ${name} instead of ${capacity}`;
  if (plusOne.clearedBy === peak.period) detail.push(`${change}, that peak never forms.`);
  else if (plusOne.clearedBy !== null && (clearedBy === null || plusOne.clearedBy < clearedBy)) {
    detail.push(`${change}, it clears by ${label(plusOne.clearedBy)}, ${plural(plusOne.clearedBy - peak.period, unit)} after the peak.`);
  } else {
    detail.push(
      `${change}, it would not clear any sooner; waiting would drop from ${plural(heldBack, `item-${unit}`)} to ${plural(plusOne.heldBack, `item-${unit}`)}.`,
    );
  }
  return { title: `${name} limits flow.`, detail };
}
