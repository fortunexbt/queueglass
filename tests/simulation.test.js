import test from "node:test";
import assert from "node:assert/strict";

import { createSimulation, getSnapshot, normalizeSeed, stepSimulation } from "../src/lib/simulation.js";

test("the same seed and scenario produce the same replay", () => {
  const left = stepSimulation(createSimulation("QUEUEGLASS-7", "burst"), 30);
  const right = stepSimulation(createSimulation("QUEUEGLASS-7", "burst"), 30);
  assert.deepEqual(getSnapshot(left), getSnapshot(right));
});

test("chunked stepping is equivalent to one deterministic run", () => {
  const initial = createSimulation("QUEUE-11", "policy_degraded");
  const chunked = stepSimulation(stepSimulation(initial, 7), 19);
  const continuous = stepSimulation(initial, 26);
  assert.deepEqual(chunked, continuous);
});

test("work conservation holds across every scenario", () => {
  for (const scenario of ["nominal", "burst", "policy_degraded"]) {
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

test("policy degradation records only synthetic retry decisions", () => {
  const state = stepSimulation(createSimulation("RETRY-2", "policy_degraded"), 35);
  assert.ok(state.retries > 0);
  assert.ok(state.events.every((event) => !/client|identity|revenue|observed/i.test(event.message)));
});

test("seed normalization is bounded and replay-safe", () => {
  assert.equal(normalizeSeed("  lab replay / 42  "), "LAB-REPLAY-42");
  assert.equal(normalizeSeed(""), "LAB-42");
  assert.equal(normalizeSeed("x".repeat(80)).length, 32);
});
