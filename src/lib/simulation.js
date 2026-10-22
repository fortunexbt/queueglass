// Deterministic, synthetic queue simulator. No production data or wall-clock input.

export const STAGES = [
  { id: "intake", label: "Receive", cost: 1 },
  { id: "classify", label: "Sort", cost: 2 },
  { id: "policy", label: "Check", cost: 3 },
  { id: "dispatch", label: "Finish", cost: 1 },
];

export const RUN_LENGTH = 60;
export const TRAFFIC_RANGE = /** @type {const} */ ([0, 4]);
export const CAPACITY_RANGE = /** @type {const} */ ([1, 8]);
export const ARRIVAL_JITTER = 2;

/**
 * @typedef {{from:number, to:number, extraArrivals:number}} Burst
 * @typedef {{stage:number, from:number, to:number, capacity:number, retryRate:number}} Fault
 * @typedef {{id:string, label:string, summary:string, traffic:number, capacities:number[], burst:Burst|null, fault:Fault|null, bufferLimit:number|null}} Scenario
 */

/** @type {Record<"nominal"|"burst"|"cascade", Scenario>} */
export const SCENARIOS = {
  nominal: {
    id: "nominal",
    label: "Steady",
    summary: "Arrivals stay below every step's capacity, so queues stay short.",
    traffic: 1,
    capacities: [4, 4, 3, 4],
    burst: null,
    fault: null,
    bufferLimit: null,
  },
  burst: {
    id: "burst",
    label: "Burst",
    summary: "Four extra items arrive per tick from tick 6 to tick 13.",
    traffic: 1,
    capacities: [4, 4, 3, 4],
    burst: { from: 6, to: 13, extraArrivals: 4 },
    fault: null,
    bufferLimit: null,
  },
  cascade: {
    id: "cascade",
    label: "Cascading failure",
    summary: "Check slows to one item per tick from tick 10 to tick 24. Buffers between steps hold six items, so the jam spreads upstream.",
    traffic: 1,
    capacities: [4, 4, 3, 4],
    burst: null,
    fault: { stage: 2, from: 10, to: 24, capacity: 1, retryRate: 0.3 },
    bufferLimit: 6,
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

/** @param {unknown} value @param {readonly [number, number]} range @param {number} fallback */
function clampInt(value, [min, max], fallback) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

/** @param {string} scenarioId */
export function normalizeScenario(scenarioId) {
  return /** @type {ScenarioId} */ (Object.hasOwn(SCENARIOS, scenarioId) ? scenarioId : "cascade");
}

/**
 * @typedef {keyof typeof SCENARIOS} ScenarioId
 * @typedef {{traffic:number, capacities:number[]}} Settings
 * @param {ScenarioId} scenarioId @param {Partial<Settings>} [overrides] @returns {Settings}
 */
export function normalizeSettings(scenarioId, overrides = {}) {
  const scenario = SCENARIOS[scenarioId];
  return {
    traffic: clampInt(overrides.traffic, TRAFFIC_RANGE, scenario.traffic),
    capacities: scenario.capacities.map((fallback, index) =>
      clampInt(overrides.capacities?.[index], CAPACITY_RANGE, fallback),
    ),
  };
}

/**
 * @typedef {{id:string, createdTick:number, stage:number, priority:number, retries:number}} WorkItem
 * @typedef {{tick:number, kind:"arrival"|"flow"|"constraint"|"retry"|"blocked", message:string}} SimulationEvent
 * @typedef {{id:string, label:string, capacity:number, handled:number, waiting:number, leftover:number, blocked:boolean, faulted:boolean}} StageState
 * @typedef {{seed:string, scenarioId:ScenarioId, settings:Settings, tick:number, rngState:number, nextItemId:number, arrivals:number, completed:number, retries:number, computeUnits:number, totalSojournTicks:number, queue:WorkItem[], stages:StageState[], events:SimulationEvent[]}} SimulationState
 */

/** @param {string} seed @param {string} [scenarioId] @param {Partial<Settings>} [overrides] @returns {SimulationState} */
export function createSimulation(seed, scenarioId = "cascade", overrides = {}) {
  const normalizedSeed = normalizeSeed(seed);
  const safeScenario = normalizeScenario(scenarioId);
  const settings = normalizeSettings(safeScenario, overrides);
  return {
    seed: normalizedSeed,
    scenarioId: safeScenario,
    settings,
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
      capacity: settings.capacities[index],
      handled: 0,
      waiting: 0,
      leftover: 0,
      blocked: false,
      faulted: false,
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

/** @param {WorkItem} left @param {WorkItem} right */
function serviceOrder(left, right) {
  return right.priority - left.priority || left.createdTick - right.createdTick || left.id.localeCompare(right.id);
}

// Stages are served downstream first, so space freed at a later step is visible to the step
// feeding it, and every item advances at most one step per tick.
/** @param {SimulationState} state */
function stepOnce(state) {
  const scenario = SCENARIOS[state.scenarioId];
  const { settings } = state;
  const tick = state.tick + 1;
  let rngState = state.rngState;
  let nextItemId = state.nextItemId;
  let completed = state.completed;
  let retries = state.retries;
  let computeUnits = state.computeUnits;
  let totalSojournTicks = state.totalSojournTicks;
  const queue = state.queue.map((item) => ({ ...item }));
  /** @type {SimulationEvent[]} */
  const tickEvents = [];

  const inBurst = scenario.burst && tick >= scenario.burst.from && tick <= scenario.burst.to;
  let random = nextRandom(rngState);
  rngState = random.state;
  const arrivalCount =
    settings.traffic + (inBurst ? scenario.burst.extraArrivals : 0) + Math.floor(random.value * (ARRIVAL_JITTER + 1));

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
  tickEvents.push({ tick, kind: "arrival", message: `${arrivalCount} synthetic work item${arrivalCount === 1 ? "" : "s"} entered the model.` });

  /** @type {StageState[]} */
  const stageStats = new Array(STAGES.length);
  for (let stageIndex = STAGES.length - 1; stageIndex >= 0; stageIndex -= 1) {
    const stage = STAGES[stageIndex];
    const fault = scenario.fault;
    const faulted = Boolean(fault && fault.stage === stageIndex && tick >= fault.from && tick <= fault.to);
    const capacity = faulted && fault ? Math.min(fault.capacity, settings.capacities[stageIndex]) : settings.capacities[stageIndex];
    const candidates = queue.filter((item) => item.stage === stageIndex).sort(serviceOrder);
    const isLast = stageIndex === STAGES.length - 1;
    let downstreamCount = isLast ? 0 : queue.filter((item) => item.stage === stageIndex + 1).length;
    let handled = 0;
    let served = 0;
    let blocked = false;

    for (const item of candidates) {
      if (served === capacity) break;
      if (!isLast && scenario.bufferLimit !== null && downstreamCount >= scenario.bufferLimit) {
        blocked = true;
        break;
      }
      served += 1;
      if (faulted && fault) {
        random = nextRandom(rngState);
        rngState = random.state;
        if (random.value < fault.retryRate) {
          item.retries += 1;
          retries += 1;
          tickEvents.push({ tick, kind: "retry", message: `${item.id} received a synthetic ${stage.label.toLowerCase()} retry decision.` });
          continue;
        }
      }
      handled += 1;
      computeUnits += stage.cost;
      if (isLast) {
        completed += 1;
        totalSojournTicks += tick - item.createdTick + 1;
      } else {
        downstreamCount += 1;
      }
      item.stage += 1;
    }

    const leftover = candidates.length - handled;
    if (blocked) {
      tickEvents.push({ tick, kind: "blocked", message: `${stage.label} was blocked because the buffer after it was full.` });
    } else if (leftover > 0 || faulted) {
      tickEvents.push({ tick, kind: "constraint", message: `${stage.label} capacity was constrained in the synthetic scenario.` });
    }
    stageStats[stageIndex] = { id: stage.id, label: stage.label, capacity, handled, waiting: 0, leftover, blocked, faulted };
  }

  const remaining = queue.filter((item) => item.stage < STAGES.length);
  for (const [index, stage] of stageStats.entries()) stage.waiting = remaining.filter((item) => item.stage === index).length;
  const completedThisTick = completed - state.completed;
  if (completedThisTick > 0) {
    tickEvents.push({ tick, kind: "flow", message: `${completedThisTick} synthetic work item${completedThisTick === 1 ? "" : "s"} completed the model.` });
  }

  return {
    ...state,
    tick,
    rngState,
    nextItemId,
    arrivals: state.arrivals + arrivalCount,
    completed,
    retries,
    computeUnits,
    totalSojournTicks,
    queue: remaining,
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

/**
 * The stage limiting flow this tick: the unblocked stage that left the most work unserved.
 * Blocked stages are victims of a full buffer downstream, not the cause.
 * @param {StageState[]} stages
 */
export function findBottleneck(stages) {
  let bottleneck = -1;
  for (const [index, stage] of stages.entries()) {
    if (stage.blocked || stage.leftover === 0) continue;
    if (bottleneck === -1 || stage.leftover >= stages[bottleneck].leftover) bottleneck = index;
  }
  return bottleneck;
}

/** @param {SimulationState} state */
export function getSnapshot(state) {
  return {
    seed: state.seed,
    scenario: state.scenarioId,
    settings: { traffic: state.settings.traffic, capacities: [...state.settings.capacities] },
    tick: state.tick,
    metrics: {
      syntheticArrivals: state.arrivals,
      syntheticCompleted: state.completed,
      queueDepth: state.queue.length,
      retryDecisions: state.retries,
      computeUnits: state.computeUnits,
      meanSojournTicks: state.completed === 0 ? 0 : Number((state.totalSojournTicks / state.completed).toFixed(2)),
    },
    bottleneck: STAGES[findBottleneck(state.stages)]?.id ?? null,
    stages: state.stages.map((stage) => ({ ...stage })),
    activeWork: state.queue.slice(0, 12).map((item) => ({ id: item.id, stage: STAGES[item.stage].id, priority: item.priority, retries: item.retries })),
    events: state.events.slice(0, 8).map((event) => ({ ...event })),
  };
}

/**
 * Precompute a whole replay so playback and scrubbing only index into it.
 * @param {string} seed @param {string} scenarioId @param {Partial<Settings>} [overrides] @param {number} [length]
 */
export function runSimulation(seed, scenarioId, overrides = {}, length = RUN_LENGTH) {
  let state = createSimulation(seed, scenarioId, overrides);
  const frames = [{ ...getSnapshot(state), arrived: 0, finished: 0 }];
  for (let tick = 1; tick <= length; tick += 1) {
    const previous = state;
    state = stepOnce(state);
    frames.push({
      ...getSnapshot(state),
      arrived: state.arrivals - previous.arrivals,
      finished: state.completed - previous.completed,
      events: state.events.filter((event) => event.tick === state.tick),
    });
  }
  return frames;
}
