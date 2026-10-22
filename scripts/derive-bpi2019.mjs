// Derive the worked example from the BPI Challenge 2019 event log.
//
// Source: van Dongen, B.F. (2019) BPI Challenge 2019. 4TU.ResearchData.
// doi:10.4121/uuid:d06aff4b-79f0-45e6-8ec8-e19730c248f1, licensed CC BY 4.0.
// Download BPI_Challenge_2019.xes (728,558,522 bytes) from the DOI, then run:
//
//   node scripts/derive-bpi2019.mjs path/to/BPI_Challenge_2019.xes
//
// For each calendar day of 2018 it counts the purchase-order lines in the CAPEX & SOCS spend
// area that reached each step for the first time on that day. The file is checked against the
// MD5 that 4TU publishes, so a different copy of the log can't silently change the numbers.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_MD5 = "4eb909242351193a61e1c15b9c3cc814";
const SPEND_AREA = "CAPEX & SOCS";
const YEAR = "2018";
const COLUMNS = [
  ["po_lines_created", "Create Purchase Order Item"],
  ["goods_received", "Record Goods Receipt"],
  ["invoices_received", "Record Invoice Receipt"],
  ["invoices_cleared", "Clear Invoice"],
];
const OUTPUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "bpi2019-capex-socs-daily.2026-10-23.csv");

const unescape = (value) =>
  value.replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[name]);
const attribute = (xml, key) => {
  const match = xml.match(new RegExp(`<(?:string|date) key="${key}" value="([^"]*)"`));
  return match ? unescape(match[1]) : "";
};

const source = process.argv[2];
if (!source) {
  console.error("Usage: node scripts/derive-bpi2019.mjs path/to/BPI_Challenge_2019.xes");
  process.exit(1);
}

const hash = createHash("md5");
const activities = new Map(COLUMNS.map(([column, activity]) => [activity, column]));
const counts = new Map(COLUMNS.map(([column]) => [column, new Map()]));
let buffer = "";
let traces = 0;

for await (const chunk of createReadStream(source, { encoding: "utf8", highWaterMark: 1 << 22 })) {
  hash.update(chunk, "utf8");
  buffer += chunk;
  let end;
  while ((end = buffer.indexOf("</trace>")) !== -1) {
    const trace = buffer.slice(buffer.indexOf("<trace>"), end);
    buffer = buffer.slice(end + "</trace>".length);
    traces += 1;
    const [head, ...events] = trace.split("<event>");
    if (attribute(head, "Spend area text") !== SPEND_AREA) continue;
    const firstDay = new Map();
    for (const event of events) {
      const column = activities.get(attribute(event, "concept:name"));
      const day = attribute(event, "time:timestamp").slice(0, 10);
      if (column && (!firstDay.has(column) || day < firstDay.get(column))) firstDay.set(column, day);
    }
    for (const [column, day] of firstDay) counts.get(column).set(day, (counts.get(column).get(day) ?? 0) + 1);
  }
}

const md5 = hash.digest("hex");
if (md5 !== SOURCE_MD5) {
  console.error(`MD5 ${md5} does not match the published ${SOURCE_MD5}. Use the file from the DOI.`);
  process.exit(1);
}

const rows = [["date", ...COLUMNS.map(([column]) => column)].join(",")];
for (let day = new Date(`${YEAR}-01-01T00:00:00Z`); day.getUTCFullYear() === Number(YEAR); day.setUTCDate(day.getUTCDate() + 1)) {
  const date = day.toISOString().slice(0, 10);
  rows.push([date, ...COLUMNS.map(([column]) => counts.get(column).get(date) ?? 0)].join(","));
}
await writeFile(OUTPUT, `${rows.join("\n")}\n`);
console.log(`Read ${traces} traces (MD5 ${md5}). Wrote ${rows.length - 1} days to ${path.relative(process.cwd(), OUTPUT)}.`);
