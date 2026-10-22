import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

import { busyDay, decodeSetup, encodeSetup, exampleSetup, parseArrivals, parseDay, periodLabel } from "../src/lib/line.js";
import { analyzeLine } from "../src/lib/simulation.js";

const dataDir = new URL("../data/", import.meta.url);
const exampleCsv = async () => {
  const [file] = (await readdir(dataDir)).filter((name) => name.startsWith("bpi2019-"));
  return readFile(new URL(file, dataDir), "utf8");
};

test("dates parse from ISO timestamps and Jira exports, and nonsense does not", () => {
  assert.equal(parseDay("2026-03-02"), parseDay("2026-03-02T23:59:00Z"));
  assert.equal(parseDay("02/Mar/26 9:15 AM"), parseDay("2026-03-02"));
  assert.equal(parseDay("2026-02-30"), null);
  assert.equal(parseDay("Created"), null);
  assert.equal(parseDay("14"), null);
});

test("a column of counts becomes arrivals, with the start date when rows are dated", () => {
  assert.deepEqual(parseArrivals("opened\n3\n0\n12\n", "day"), { arrivals: [3, 0, 12], start: null, skipped: 1 });
  assert.deepEqual(parseArrivals("date,opened\n2026-03-02,4\n2026-03-03,6", "day"), {
    arrivals: [4, 6],
    start: "2026-03-02",
    skipped: 1,
  });
});

test("a column of item dates is tallied per day or per Monday week, gaps included", () => {
  const created = "Created\n2026-03-02T10:00:00Z\n2026-03-02T16:00:00Z\n2026-03-04T09:00:00Z\n2026-03-10T09:00:00Z";
  assert.deepEqual(parseArrivals(created, "day"), { arrivals: [2, 0, 1, 0, 0, 0, 0, 0, 1], start: "2026-03-02", skipped: 1 });
  assert.deepEqual(parseArrivals(created, "week"), { arrivals: [3, 1], start: "2026-03-02", skipped: 1 });
});

test("unusable pastes explain themselves", () => {
  assert.match(parseArrivals("hello\nworld", "day").error, /No counts or dates/);
  assert.match(parseArrivals("4\n2026-03-02", "day").error, /not both/);
  assert.match(parseArrivals("1\n".repeat(1001), "day").error, /limit is 1000/);
});

test("a setup survives the share-link fragment", () => {
  const setup = {
    line: { stages: [{ name: "Code review: PRs", capacity: 6 }, { name: "QA & merge", capacity: 4 }], bufferLimit: 5, arrivals: [3, 0, 7] },
    unit: "day",
    start: "2026-03-02",
  };
  assert.deepEqual(decodeSetup(`#${encodeSetup(setup)}`), setup);
  assert.equal(decodeSetup("#a=1,2"), null);
});

test("periods are labelled by date when the start is known", () => {
  const setup = { line: null, unit: "day", start: "2018-01-01" };
  assert.equal(periodLabel(setup, 1), "1 Jan 2018");
  assert.equal(periodLabel(setup, 365), "31 Dec 2018");
  assert.equal(periodLabel({ ...setup, unit: "week" }, 2), "week of 8 Jan 2018");
  assert.equal(periodLabel({ ...setup, start: null }, 7), "day 7");
});

test("the BPI 2019 example is the committed derivation, with measured capacities", async () => {
  const csv = await exampleCsv();
  const { line, start, unit } = exampleSetup(csv);
  assert.equal(start, "2018-01-01");
  assert.equal(unit, "day");
  assert.equal(line.arrivals.length, 365);
  assert.equal(line.arrivals.reduce((sum, count) => sum + count, 0), 6749);
  assert.deepEqual(line.stages.map((stage) => stage.capacity), [46, 49, 142]);
  assert.equal(busyDay([0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), 9);
  const result = analyzeLine(line);
  assert.equal(result.frames.at(-1).totalFinished, 6749);
  assert.equal(result.limiting, 0);
});
