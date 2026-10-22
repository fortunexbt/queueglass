import test from "node:test";
import assert from "node:assert/strict";

import { analyzeLine, clearedBy, findBottleneck, normalizeLine, runSimulation } from "../src/lib/simulation.js";

const stages = (...capacities) => capacities.map((capacity, index) => ({ name: `S${index + 1}`, capacity }));
const burst = [3, 3, 9, 9, 9, 9, 3, 3, 3, 3, 0, 0, 3, 3, 3, 3, 3, 3, 3, 3];

test("the same line produces the same replay", () => {
  const line = { stages: stages(4, 4, 3, 4), bufferLimit: 6, arrivals: burst };
  assert.deepEqual(runSimulation(line), runSimulation(line));
});

test("work is conserved: everything that arrives finishes or is still in the line", () => {
  for (const bufferLimit of [null, 2, 6]) {
    const frames = runSimulation({ stages: stages(4, 2, 3, 5), bufferLimit, arrivals: burst });
    for (const frame of frames.slice(1)) {
      const arrived = burst.slice(0, frame.period).reduce((sum, count) => sum + count, 0);
      assert.equal(arrived, frame.totalFinished + frame.inLine);
    }
    assert.equal(frames.at(-1).inLine, 0);
  }
});

test("the run drains after the last arrival and stops once the line is empty", () => {
  const frames = runSimulation({ stages: stages(2, 2), bufferLimit: null, arrivals: [6] });
  assert.deepEqual(frames.map((frame) => frame.finished), [0, 0, 2, 2, 2]);
  assert.equal(frames.at(-1).inLine, 0);
});

test("an item advances at most one step per period", () => {
  const frames = runSimulation({ stages: stages(9, 9, 9, 9), bufferLimit: null, arrivals: [5, 5, 5] });
  // With spare capacity everywhere, four steps take exactly four periods.
  assert.equal(frames[4].meanPeriodsToFinish, 4);
  for (const [period, frame] of frames.entries()) {
    if (period === 0) continue;
    for (const [index, stage] of frame.stages.entries()) {
      const before = frames[period - 1].stages[index].waiting + (index === 0 ? frame.arrived : 0);
      assert.ok(stage.handled <= before);
    }
  }
});

test("a full buffer blocks the step feeding it, and never the last step", () => {
  const frames = runSimulation({ stages: stages(4, 4, 1, 4), bufferLimit: 6, arrivals: burst });
  assert.ok(frames.some((frame) => frame.stages[1].blocked));
  for (const frame of frames.slice(1)) {
    for (const stage of frame.stages.slice(1)) assert.ok(stage.waiting <= 6 + stage.capacity);
    assert.equal(frame.stages.at(-1).blocked, false);
  }
});

test("the bottleneck is the unblocked step with the most unserved work", () => {
  const stage = (leftover, blocked = false) => ({ leftover, blocked });
  assert.equal(findBottleneck([stage(0), stage(0), stage(0), stage(0)]), -1);
  assert.equal(findBottleneck([stage(2), stage(5), stage(1), stage(0)]), 1);
  assert.equal(findBottleneck([stage(9, true), stage(3), stage(0), stage(0)]), 1);
});

test("lower capacity at one step builds a deeper queue", () => {
  const peak = (line) => Math.max(...runSimulation(line).map((frame) => frame.inLine));
  const arrivals = new Array(30).fill(3);
  assert.ok(peak({ stages: stages(4, 4, 2, 4), bufferLimit: null, arrivals }) > peak({ stages: stages(4, 4, 4, 4), bufferLimit: null, arrivals }));
});

test("backlog counts only work that was ready to move and could not", () => {
  const smooth = runSimulation({ stages: stages(5, 5, 5), bufferLimit: null, arrivals: [5, 5, 5, 5] });
  assert.ok(smooth.every((frame) => frame.backlog === 0));
  assert.ok(smooth.slice(1, 4).every((frame) => frame.inLine > 0));
  const jam = runSimulation({ stages: stages(5, 2, 5), bufferLimit: null, arrivals: [5, 5, 0, 0, 0, 0] });
  assert.deepEqual(jam.map((frame) => frame.backlog).slice(0, 7), [0, 0, 3, 6, 4, 2, 0]);
  assert.equal(clearedBy(jam, 3), 6);
});

test("the analysis names the limiting step, the peak, the clear period and real +1 runs", () => {
  const result = analyzeLine({ stages: stages(5, 2, 5), bufferLimit: null, arrivals: [5, 5, 0, 0, 0, 0] });
  assert.equal(result.limiting, 1);
  assert.deepEqual(result.peak, { period: 3, backlog: 6 });
  assert.equal(result.clearedBy, 6);
  // +1 at the limiting step is rerun, not estimated: 3 per period clears a period sooner.
  assert.equal(result.whatIf[1].capacity, 3);
  assert.equal(result.whatIf[1].clearedBy, 5);
  assert.equal(result.whatIf[0].clearedBy, 6);
  assert.equal(result.whatIf[2].clearedBy, 6);
  assert.equal(result.heldBack, 15);
  assert.equal(result.whatIf[1].heldBack, 7);
});

test("a line that keeps up has no limiting step and no backlog", () => {
  const result = analyzeLine({ stages: stages(9, 9), bufferLimit: null, arrivals: [3, 4, 5] });
  assert.equal(result.limiting, -1);
  assert.equal(result.peak.backlog, 0);
  assert.equal(result.clearedBy, null);
});

test("lines are clamped to what the engine accepts", () => {
  assert.equal(normalizeLine({ stages: stages(3), arrivals: [1] }), null);
  assert.equal(normalizeLine({ stages: stages(3, 3), arrivals: [] }), null);
  assert.equal(normalizeLine({ stages: stages(3, 3), arrivals: ["x"] }), null);
  const line = normalizeLine({
    stages: [{ name: "  ", capacity: 0 }, { name: "Review".repeat(10), capacity: 2.7 }, ...stages(1, 1, 1, 1, 1, 1, 1)],
    bufferLimit: "",
    arrivals: [-4, "7"],
  });
  assert.equal(line.stages.length, 8);
  assert.deepEqual(line.stages[0], { name: "Step 1", capacity: 1 });
  assert.equal(line.stages[1].name.length, 24);
  assert.equal(line.stages[1].capacity, 2);
  assert.equal(line.bufferLimit, null);
  assert.deepEqual(line.arrivals, [0, 7]);
});
