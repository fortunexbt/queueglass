// Deterministic tandem queue: work arrives at the first step and passes through every step
// in order. Counts are whole items and time is in periods (whatever the arrivals are counted
// per: a day, a week).

export const STEP_COUNT = /** @type {const} */ ([2, 8]);
export const CAPACITY_RANGE = /** @type {const} */ ([1, 99999]);
export const MAX_PERIODS = 1000;
export const NAME_LENGTH = 24;

/**
 * @typedef {{name:string, capacity:number}} Stage
 * @typedef {{stages:Stage[], bufferLimit:number|null, arrivals:number[]}} Line
 * @typedef {{name:string, capacity:number, handled:number, waiting:number, leftover:number, blocked:boolean}} StageState
 * @typedef {{period:number, arrived:number, finished:number, inLine:number, backlog:number, totalFinished:number, meanPeriodsToFinish:number, bottleneck:number, stages:StageState[]}} Frame
 */

/** @param {unknown} value @param {readonly [number, number]} range */
function clampInt(value, [min, max]) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : null;
}

/**
 * Clamp a line to what the engine accepts, or return null when it can't be run.
 * @param {{stages?:Partial<Stage>[], bufferLimit?:unknown, arrivals?:unknown[]}} input
 * @returns {Line|null}
 */
export function normalizeLine(input) {
  const stages = (input.stages ?? []).slice(0, STEP_COUNT[1]).map((stage, index) => ({
    name: String(stage.name ?? "").trim().slice(0, NAME_LENGTH) || `Step ${index + 1}`,
    capacity: clampInt(stage.capacity, CAPACITY_RANGE),
  }));
  const arrivals = (input.arrivals ?? []).slice(0, MAX_PERIODS).map((count) => clampInt(count, [0, 1e7]));
  if (stages.length < STEP_COUNT[0] || stages.some((stage) => stage.capacity === null)) return null;
  if (!arrivals.length || arrivals.some((count) => count === null)) return null;
  const bufferLimit = input.bufferLimit === null || input.bufferLimit === undefined || input.bufferLimit === "" ? null : clampInt(input.bufferLimit, CAPACITY_RANGE);
  return {
    stages: /** @type {Stage[]} */ (stages),
    bufferLimit,
    arrivals: /** @type {number[]} */ (arrivals),
  };
}

/** @param {[number, number][]} queue */
const total = (queue) => queue.reduce((sum, [, count]) => sum + count, 0);

/**
 * Take `count` items off the front of a FIFO queue of [arrivalPeriod, count] cohorts.
 * @param {[number, number][]} queue @param {number} count
 */
function take(queue, count) {
  /** @type {[number, number][]} */
  const taken = [];
  let left = count;
  while (left > 0) {
    const head = queue[0];
    const moved = Math.min(left, head[1]);
    taken.push([head[0], moved]);
    head[1] -= moved;
    if (head[1] === 0) queue.shift();
    left -= moved;
  }
  return taken;
}

/**
 * The step limiting flow this period: the unblocked step that left the most work unserved.
 * Blocked steps are victims of a full buffer downstream, not the cause.
 * @param {Pick<StageState, "leftover"|"blocked">[]} stages
 */
export function findBottleneck(stages) {
  let bottleneck = -1;
  for (const [index, stage] of stages.entries()) {
    if (stage.blocked || stage.leftover === 0) continue;
    if (bottleneck === -1 || stage.leftover >= stages[bottleneck].leftover) bottleneck = index;
  }
  return bottleneck;
}

/**
 * Replay a line period by period. After the last arrival the run keeps going with no new
 * work until the line is empty, for at most MAX_PERIODS extra periods.
 * Stages are served downstream first, so space freed at a later step is visible to the step
 * feeding it, and every item advances at most one step per period.
 * @param {Line} line @returns {Frame[]}
 */
export function runSimulation({ stages, bufferLimit, arrivals }) {
  /** @type {[number, number][][]} */
  const queues = stages.map(() => []);
  const last = stages.length - 1;
  let totalFinished = 0;
  let totalPeriodsToFinish = 0;
  /** @type {Frame[]} */
  const frames = [
    {
      period: 0,
      arrived: 0,
      finished: 0,
      inLine: 0,
      backlog: 0,
      totalFinished: 0,
      meanPeriodsToFinish: 0,
      bottleneck: -1,
      stages: stages.map(({ name, capacity }) => ({ name, capacity, handled: 0, waiting: 0, leftover: 0, blocked: false })),
    },
  ];

  for (let period = 1; period <= arrivals.length + MAX_PERIODS; period += 1) {
    const arrived = arrivals[period - 1] ?? 0;
    if (period > arrivals.length && frames.at(-1)?.inLine === 0) break;
    if (arrived > 0) queues[0].push([period, arrived]);

    let finished = 0;
    /** @type {StageState[]} */
    const states = new Array(stages.length);
    for (let index = last; index >= 0; index -= 1) {
      const { name, capacity } = stages[index];
      const ready = total(queues[index]);
      const wanted = Math.min(capacity, ready);
      const room = index === last || bufferLimit === null ? Infinity : Math.max(0, bufferLimit - total(queues[index + 1]));
      const handled = Math.min(wanted, room);
      for (const [arrivedAt, count] of take(queues[index], handled)) {
        if (index === last) {
          finished += count;
          totalPeriodsToFinish += count * (period - arrivedAt + 1);
        } else {
          const next = queues[index + 1];
          const tail = next.at(-1);
          if (tail && tail[0] === arrivedAt) tail[1] += count;
          else next.push([arrivedAt, count]);
        }
      }
      states[index] = { name, capacity, handled, waiting: 0, leftover: ready - handled, blocked: handled < wanted };
    }
    for (const [index, state] of states.entries()) state.waiting = total(queues[index]);
    totalFinished += finished;

    frames.push({
      period,
      arrived,
      finished,
      inLine: states.reduce((sum, state) => sum + state.waiting, 0),
      backlog: states.reduce((sum, state) => sum + state.leftover, 0),
      totalFinished,
      meanPeriodsToFinish: totalFinished === 0 ? 0 : Number((totalPeriodsToFinish / totalFinished).toFixed(2)),
      bottleneck: findBottleneck(states),
      stages: states,
    });
  }
  return frames;
}

/**
 * The first period at or after `from` when nothing was held back.
 * @param {Frame[]} frames @param {number} from
 */
export function clearedBy(frames, from) {
  return frames.find((frame) => frame.period >= from && frame.backlog === 0)?.period ?? null;
}

/**
 * Item-periods of waiting that capacity caused: each period, every item that was ready to
 * move and could not counts once.
 * @param {Frame[]} frames
 */
const totalBacklog = (frames) => frames.reduce((sum, frame) => sum + frame.backlog, 0);

/**
 * Everything the headline says, computed rather than inferred from the inputs: which step
 * held work back most often, when the backlog peaked and cleared, and what one more unit of
 * capacity at each step would have changed.
 * @param {Line} line
 */
export function analyzeLine(line) {
  const frames = runSimulation(line);
  const periodsLimiting = line.stages.map((_, index) => frames.filter((frame) => frame.bottleneck === index).length);
  const heldBack = line.stages.map((_, index) => frames.reduce((sum, frame) => sum + (frame.bottleneck === index ? frame.stages[index].leftover : 0), 0));
  let limiting = -1;
  for (const [index, periods] of periodsLimiting.entries()) {
    if (periods === 0) continue;
    if (limiting === -1 || periods > periodsLimiting[limiting] || (periods === periodsLimiting[limiting] && heldBack[index] > heldBack[limiting])) limiting = index;
  }
  const peak = frames.reduce((best, frame) => (frame.backlog > best.backlog ? frame : best), frames[0]);
  const whatIf = line.stages.map((stage, index) => {
    const stages = line.stages.map((other, at) => (at === index ? { ...other, capacity: other.capacity + 1 } : other));
    const plusOne = runSimulation({ ...line, stages });
    return {
      name: stage.name,
      capacity: stage.capacity + 1,
      peakBacklog: Math.max(...plusOne.map((frame) => frame.backlog)),
      heldBack: totalBacklog(plusOne),
      clearedBy: clearedBy(plusOne, peak.period),
      periods: plusOne.length - 1,
    };
  });
  return {
    frames,
    limiting,
    periodsLimiting,
    peak: { period: peak.period, backlog: peak.backlog },
    clearedBy: peak.backlog === 0 ? null : clearedBy(frames, peak.period),
    heldBack: totalBacklog(frames),
    whatIf,
  };
}
