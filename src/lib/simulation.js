// Deterministic, synthetic queue simulator. No production data or wall-clock input.

export const STAGES = [
  { id: "intake", label: "Intake", cost: 1 },
  { id: "classify", label: "Classify", cost: 2 },
  { id: "policy", label: "Policy", cost: 3 },
  { id: "dispatch", label: "Dispatch", cost: 1 },
];

export const SCENARIOS = {
  nominal: {
    id: "nominal",
    label: "Nominal flow",
    summary: "Low synthetic arrival pressure with balanced stage capacity.",
    baseArrivals: 1,
    arrivalJitter: 2,
    capacities: [3, 3, 2, 3],
  },
  burst: {
    id: "burst",
    label: "Burst pressure",
    summary: "A deterministic arrival burst tests queue growth and recovery.",
    baseArrivals: 1,
    arrivalJitter: 2,
    capacities: [3, 3, 2, 3],
  },
  policy_degraded: {
    id: "policy_degraded",
    label: "Policy constrained",
    summary: "The synthetic policy stage loses capacity and may retry work.",
    baseArrivals: 1,
    arrivalJitter: 1,
    capacities: [3, 3, 2, 3],
  },
};

/** @param {string} seed */
export function normalizeSeed(seed) {
  const cleaned = String(seed ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return cleaned || "LAB-42";
}

/** @param {string} input */
export function hashSeed(input) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** @param {number} state */
export function nextRandom(state) {
  const nextState = (state + 0x6d2b79f5) >>> 0;
  let value = nextState;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return { state: nextState, value: ((value ^ (value >>> 14)) >>> 0) / 4294967296 };
}

/**
 * @typedef {{id:string, createdTick:number, stage:number, priority:number, retries:number}} WorkItem
 * @typedef {{tick:number, kind:"arrival"|"flow"|"constraint"|"retry", message:string}} SimulationEvent
 * @typedef {{id:string, label:string, capacity:number, handled:number, waiting:number, status:"ready"|"busy"|"constrained"}} StageState
 * @typedef {{seed:string, scenarioId:keyof typeof SCENARIOS, tick:number, rngState:number, nextItemId:number, arrivals:number, completed:number, retries:number, computeUnits:number, totalSojournTicks:number, queue:WorkItem[], stages:StageState[], events:SimulationEvent[]}} SimulationState
 */

/** @param {string} seed @param {string} [scenarioId] @returns {SimulationState} */
export function createSimulation(seed, scenarioId = "nominal") {
  const normalizedSeed = normalizeSeed(seed);
  const safeScenario = Object.hasOwn(SCENARIOS, scenarioId) ? scenarioId : "nominal";
  const scenario = SCENARIOS[safeScenario];
  return {
    seed: normalizedSeed,
    scenarioId: /** @type {keyof typeof SCENARIOS} */ (safeScenario),
    tick: 0,
    rngState: hashSeed(`${normalizedSeed}:${safeScenario}`),
    nextItemId: 1,
    arrivals: 0,
    completed: 0,
    retries: 0,
    computeUnits: 0,
    totalSojournTicks: 0,
    queue: [],
    stages: STAGES.map((stage, index) => ({
      id: stage.id,
      label: stage.label,
      capacity: scenario.capacities[index],
      handled: 0,
      waiting: 0,
      status: "ready",
    })),
    events: [
      {
        tick: 0,
        kind: "flow",
        message: `Synthetic replay initialized from seed ${normalizedSeed}.`,
      },
    ],
  };
}

/** @param {SimulationState} state */
function stepOnce(state) {
  const scenario = SCENARIOS[state.scenarioId];
  const tick = state.tick + 1;
  let rngState = state.rngState;
  let nextItemId = state.nextItemId;
  let arrivals = state.arrivals;
  let completed = state.completed;
  let retries = state.retries;
  let computeUnits = state.computeUnits;
  let totalSojournTicks = state.totalSojournTicks;
  let queue = state.queue.map((item) => ({ ...item }));
  /** @type {SimulationEvent[]} */
  const tickEvents = [];

  let arrivalBase = scenario.baseArrivals;
  if (state.scenarioId === "burst" && tick >= 6 && tick <= 13) arrivalBase += 4;
  let random = nextRandom(rngState);
  rngState = random.state;
  const arrivalCount = arrivalBase + Math.floor(random.value * (scenario.arrivalJitter + 1));

  for (let index = 0; index < arrivalCount; index += 1) {
    random = nextRandom(rngState);
    rngState = random.state;
    queue.push({
      id: `SIM-${String(nextItemId).padStart(4, "0")}`,
      createdTick: tick,
      stage: 0,
      priority: 1 + Math.floor(random.value * 3),
      retries: 0,
    });
    nextItemId += 1;
  }
  arrivals += arrivalCount;
  tickEvents.push({ tick, kind: "arrival", message: `${arrivalCount} synthetic work item${arrivalCount === 1 ? "" : "s"} entered the model.` });

  const stageStats = STAGES.map((stage, stageIndex) => {
    const baseCapacity = scenario.capacities[stageIndex];
    const degraded = state.scenarioId === "policy_degraded" && stage.id === "policy" && tick >= 7 && tick <= 19;
    const capacity = degraded ? 1 : baseCapacity;
    const candidates = queue
      .filter((item) => item.stage === stageIndex)
      .sort((left, right) => right.priority - left.priority || left.createdTick - right.createdTick || left.id.localeCompare(right.id));
    const selected = candidates.slice(0, capacity);
    let handled = 0;

    for (const item of selected) {
      const target = queue.find((queued) => queued.id === item.id);
      if (!target) continue;
      let shouldRetry = false;
      if (degraded) {
        random = nextRandom(rngState);
        rngState = random.state;
        shouldRetry = random.value < 0.24;
      }
      if (shouldRetry) {
        target.retries += 1;
        retries += 1;
        tickEvents.push({ tick, kind: "retry", message: `${target.id} received a synthetic policy retry decision.` });
        continue;
      }
      handled += 1;
      computeUnits += stage.cost;
      if (stageIndex === STAGES.length - 1) {
        completed += 1;
        totalSojournTicks += tick - target.createdTick + 1;
        target.stage = STAGES.length;
      } else {
        target.stage += 1;
      }
    }

    const constrained = candidates.length > capacity || degraded;
    if (constrained) {
      tickEvents.push({
        tick,
        kind: "constraint",
        message: `${stage.label} capacity was constrained in the synthetic scenario.`,
      });
    }
    return { id: stage.id, label: stage.label, capacity, handled, waiting: 0, status: constrained ? "constrained" : handled > 0 ? "busy" : "ready" };
  });

  queue = queue.filter((item) => item.stage < STAGES.length);
  for (const stage of stageStats) stage.waiting = queue.filter((item) => STAGES[item.stage]?.id === stage.id).length;
  const completedThisTick = completed - state.completed;
  if (completedThisTick > 0) {
    tickEvents.push({ tick, kind: "flow", message: `${completedThisTick} synthetic work item${completedThisTick === 1 ? "" : "s"} completed the model.` });
  }

  return {
    ...state,
    tick,
    rngState,
    nextItemId,
    arrivals,
    completed,
    retries,
    computeUnits,
    totalSojournTicks,
    queue,
    stages: stageStats,
    events: [...tickEvents.reverse(), ...state.events].slice(0, 14),
  };
}

/** @param {SimulationState} state @param {number} [count] @returns {SimulationState} */
export function stepSimulation(state, count = 1) {
  const safeCount = Math.max(0, Math.min(10000, Math.floor(count)));
  let next = state;
  for (let index = 0; index < safeCount; index += 1) next = stepOnce(next);
  return next;
}

/** @param {SimulationState} state */
export function getSnapshot(state) {
  return {
    seed: state.seed,
    scenario: state.scenarioId,
    tick: state.tick,
    metrics: {
      syntheticArrivals: state.arrivals,
      syntheticCompleted: state.completed,
      queueDepth: state.queue.length,
      retryDecisions: state.retries,
      computeUnits: state.computeUnits,
      meanSojournTicks: state.completed === 0 ? 0 : Number((state.totalSojournTicks / state.completed).toFixed(2)),
    },
    stages: state.stages.map((stage) => ({ ...stage })),
    activeWork: state.queue.slice(0, 12).map((item) => ({ id: item.id, stage: STAGES[item.stage].id, priority: item.priority, retries: item.retries })),
    events: state.events.slice(0, 8).map((event) => ({ ...event })),
  };
}
