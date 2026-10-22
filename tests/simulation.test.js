import test from "node:test";
import assert from "node:assert/strict";

import {
  CAPACITY_RANGE,
  RUN_LENGTH,
  STAGES,
  TRAFFIC_RANGE,
  createSimulation,
  findBottleneck,
  getSnapshot,
  normalizeSeed,
  normalizeSettings,
  runSimulation,
  stepSimulation,
} from "../src/lib/simulation.js";

test("the same seed and scenario produce the same replay", () => {
  const left = stepSimulation(createSimulation("QUEUEGLASS-7", "burst"), 30);
  const right = stepSimulation(createSimulation("QUEUEGLASS-7", "burst"), 30);
  assert.deepEqual(getSnapshot(left), getSnapshot(right));
});

test("chunked stepping is equivalent to one deterministic run", () => {
  const initial = createSimulation("QUEUE-11", "cascade");
  const chunked = stepSimulation(stepSimulation(initial, 7), 19);
  const continuous = stepSimulation(initial, 26);
  assert.deepEqual(chunked, continuous);
});

test("work conservation holds across every scenario", () => {
  for (const scenario of ["nominal", "burst", "cascade"]) {
    const state = stepSimulation(createSimulation("CONSERVE-3", scenario), 60);
    assert.equal(state.arrivals, state.completed + state.queue.length);
    assert.ok(state.computeUnits >= state.completed);
  }
});

test("burst pressure creates a larger deterministic queue than nominal flow", () => {
  const nominal = stepSimulation(createSimulation("PRESSURE-9", "nominal"), 13);
  const burst = stepSimulation(createSimulation("PRESSURE-9", "burst"), 13);
  assert.ok(burst.queue.length > nominal.queue.length);
  assert.ok(burst.arrivals > nominal.arrivals);
});

test("a degraded Check step records only synthetic retry decisions", () => {
  const state = stepSimulation(createSimulation("RETRY-2", "cascade"), 35);
  assert.ok(state.retries > 0);
  assert.ok(state.events.every((event) => !/client|identity|revenue|observed/i.test(event.message)));
});

test("seed normalization is bounded and replay-safe", () => {
  assert.equal(normalizeSeed("  lab replay / 42  "), "LAB-REPLAY-42");
  assert.equal(normalizeSeed(""), "LAB-42");
  assert.equal(normalizeSeed("x".repeat(80)).length, 32);
});

test("an item advances at most one step per tick", () => {
  let state = createSimulation("ONE-STEP-1", "nominal");
  for (let tick = 1; tick <= 20; tick += 1) {
    const before = new Map(state.queue.map((item) => [item.id, item.stage]));
    state = stepSimulation(state);
    for (const item of state.queue) {
      if (before.has(item.id)) assert.ok(item.stage - before.get(item.id) <= 1);
    }
  }
});

test("a full buffer blocks the step feeding it in the cascade scenario", () => {
  const frames = runSimulation("BUFFER-4", "cascade");
  const blocked = frames.flatMap((frame) => frame.stages.filter((stage) => stage.blocked));
  assert.ok(blocked.length > 0);
  for (const frame of frames.slice(1)) {
    for (const stage of frame.stages.slice(1)) assert.ok(stage.waiting <= 6 + stage.capacity);
  }
  assert.ok(frames.slice(1).every((frame) => frame.stages.every((stage) => !stage.blocked || stage.id !== "dispatch")));
});

test("the bottleneck is the unblocked step with the most unserved work", () => {
  const stage = (leftover, blocked = false) => ({ leftover, blocked });
  assert.equal(findBottleneck([stage(0), stage(0), stage(0), stage(0)]), -1);
  assert.equal(findBottleneck([stage(2), stage(5), stage(1), stage(0)]), 1);
  assert.equal(findBottleneck([stage(9, true), stage(3), stage(0), stage(0)]), 1);
});

test("the cascade names Check as the bottleneck during the fault", () => {
  const frame = runSimulation("CASCADE-5", "cascade")[15];
  assert.equal(frame.bottleneck, "policy");
  assert.ok(frame.stages[2].faulted);
});

test("a precomputed run is deterministic and has one frame per tick", () => {
  const left = runSimulation("RUN-1", "burst");
  const right = runSimulation("RUN-1", "burst");
  assert.equal(left.length, RUN_LENGTH + 1);
  assert.deepEqual(left, right);
  assert.deepEqual(left.map((frame) => frame.tick), Array.from({ length: RUN_LENGTH + 1 }, (_, tick) => tick));
  assert.deepEqual(getSnapshot(stepSimulation(createSimulation("RUN-1", "burst"), 25)).metrics, left[25].metrics);
});

test("settings are clamped to their ranges and fall back to the preset", () => {
  const clamped = normalizeSettings("nominal", { traffic: 99, capacities: [0, 99, 2.7] });
  assert.equal(clamped.traffic, TRAFFIC_RANGE[1]);
  assert.deepEqual(clamped.capacities, [CAPACITY_RANGE[0], CAPACITY_RANGE[1], 2, 4]);
  assert.deepEqual(normalizeSettings("cascade", {}), { traffic: 1, capacities: [4, 4, 3, 4] });
  assert.equal(STAGES.length, 4);
});

test("lower capacity at one step builds a deeper queue", () => {
  const base = stepSimulation(createSimulation("CAP-8", "nominal"), 40);
  const pinched = stepSimulation(createSimulation("CAP-8", "nominal", { capacities: [4, 4, 1, 4] }), 40);
  assert.ok(pinched.queue.length > base.queue.length);
});
