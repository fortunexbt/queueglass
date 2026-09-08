"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Topology, { STEP_NAMES } from "@/components/Topology";
import {
  SCENARIOS,
  createSimulation,
  getSnapshot,
  hashSeed,
  stepSimulation,
} from "@/lib/simulation.js";

type ScenarioId = keyof typeof SCENARIOS;
type HistoryPoint = {
  tick: number;
  depth: number;
  arrived: number;
  completed: number;
};
type IconName =
  | "play"
  | "pause"
  | "step"
  | "reset"
  | "share"
  | "expand"
  | "shuffle";

const TICK_MS = 600;
const DEFAULT_SEED = "QUEUEGLASS-7";
const PROVENANCE =
  "All values are generated locally by a deterministic toy model. No production telemetry, identity records, external services, benchmarks, monetary estimates, or observed operational results are used.";
const SCENARIO_PRESENTATION: Record<
  ScenarioId,
  {
    label: string;
    description: string;
    window: [number, number] | null;
    active: string;
    after: string;
  }
> = {
  nominal: {
    label: "Steady traffic",
    description:
      "Work arrives at a steady pace. Small queues can still build up.",
    window: null,
    active: "Steady arrivals",
    after: "Steady arrivals",
  },
  burst: {
    label: "Sudden rush",
    description:
      "A rush of extra work arrives at tick 6. Normal traffic returns at tick 14.",
    window: [6, 13],
    active: "Burst in progress",
    after: "Burst ended",
  },
  policy_degraded: {
    label: "Slower checkpoint",
    description:
      "The Check step slows down at tick 7 and returns to normal at tick 20.",
    window: [7, 19],
    active: "Capacity reduced",
    after: "Capacity restored",
  },
};

function getPhase(scenario: ScenarioId, tick: number) {
  const presentation = SCENARIO_PRESENTATION[scenario];
  if (!presentation.window) return presentation.active;
  if (tick < presentation.window[0])
    return `Starts at T${presentation.window[0]}`;
  if (tick <= presentation.window[1]) return presentation.active;
  return presentation.after;
}
const STAGE_NOTES: Record<string, string> = {
  intake: "Admits incoming work into the model.",
  classify: "Orders work by priority, then age.",
  policy: "Applies the scenario’s capacity and retry rules.",
  dispatch: "Completes work and records its time in the model.",
};

function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    play: <path d="m8 5 11 7-11 7Z" />,
    pause: (
      <>
        <path d="M8 5v14M16 5v14" />
      </>
    ),
    step: (
      <>
        <path d="m5 5 10 7-10 7Z" />
        <path d="M19 5v14" />
      </>
    ),
    reset: (
      <>
        <path d="M4 10a8 8 0 1 1 1 7M4 4v6h6" />
      </>
    ),
    share: (
      <>
        <path d="M12 15V3m-4 4 4-4 4 4M5 12v8h14v-8" />
      </>
    ),
    expand: <path d="M9 4H4v5m11-5h5v5M4 15v5h5m6 0h5v-5" />,
    shuffle: (
      <>
        <path d="M3 6h3c5 0 7 12 12 12h3m-4-4 4 4-4 4M3 18h3c2 0 3-2 4-4m4-4c1-2 2-4 4-4h3m-4-4 4 4-4 4" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

function BrandMark() {
  return (
    <svg
      className="brand-mark"
      width="30"
      height="30"
      viewBox="0 0 30 30"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M5 5h8v8H5zM17 17h8v8h-8z"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path d="M13 9h8v8M9 13v8h8" stroke="currentColor" strokeWidth="2" />
      <path d="m21 8 4 4m-8 10 4 4" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function newReplay(seed: string, scenario: ScenarioId) {
  return {
    simulation: createSimulation(seed, scenario),
    history: [
      { tick: 0, depth: 0, arrived: 0, completed: 0 },
    ] as HistoryPoint[],
  };
}

function PressureChart({
  history,
  scenario,
}: {
  history: HistoryPoint[];
  scenario: ScenarioId;
}) {
  const first = history[0].tick;
  const last = history[history.length - 1];
  const end = Math.max(first + 30, last.tick);
  const ceiling = Math.max(
    8,
    Math.ceil(Math.max(...history.map((point) => point.depth)) / 4) * 4,
  );
  const x = (tick: number) => 38 + ((tick - first) / (end - first)) * 548;
  const y = (depth: number) => 151 - (depth / ceiling) * 128;
  const line = history
    .map(
      (point, index) =>
        `${index ? "L" : "M"}${x(point.tick)},${y(point.depth)}`,
    )
    .join(" ");
  const window = SCENARIO_PRESENTATION[scenario].window;
  const bandStart = window ? Math.max(first, window[0]) : 0;
  const bandEnd = window ? Math.min(end, window[1]) : 0;
  return (
    <div className="pressure-chart">
      <svg
        viewBox="0 0 610 185"
        role="img"
        aria-label={`Queue depth over ${history.length} recorded ticks. Current queue: ${last.depth} items.`}
      >
        {[0, 1, 2, 3, 4].map((n) => (
          <g key={n}>
            <line
              x1="38"
              x2="586"
              y1={y((ceiling * n) / 4)}
              y2={y((ceiling * n) / 4)}
              stroke="var(--line)"
              strokeDasharray={n ? "2 4" : undefined}
            />
            <text x="25" y={y((ceiling * n) / 4) + 4} textAnchor="end">
              {(ceiling * n) / 4}
            </text>
          </g>
        ))}
        {window && bandEnd >= bandStart && (
          <g>
            <rect
              x={x(bandStart)}
              y="17"
              width={Math.max(0, x(bandEnd) - x(bandStart))}
              height="134"
              fill="var(--orange)"
              opacity=".075"
            />
            <text x={x(bandStart) + 5} y="13" className="chart-annotation">
              {scenario === "burst" ? "ARRIVAL BURST" : "REDUCED CAPACITY"}
            </text>
          </g>
        )}
        <path
          d={`${line} L${x(last.tick)},151 L${x(first)},151 Z`}
          fill="var(--blue)"
          opacity=".055"
        />
        <path
          d={line}
          stroke="var(--blue)"
          strokeWidth="2"
          fill="none"
          strokeLinejoin="round"
        />
        <circle
          cx={x(last.tick)}
          cy={y(last.depth)}
          r="3.5"
          fill="var(--blue)"
          stroke="var(--surface)"
          strokeWidth="1.5"
        />
        {[first, Math.round((first + end) / 2), end].map((tick) => (
          <text key={tick} x={x(tick)} y="175" textAnchor="middle">
            T{String(tick).padStart(2, "0")}
          </text>
        ))}
        {last.tick === 0 && (
          <g>
            <text x="310" y="76" textAnchor="middle" className="chart-empty">
              Every queue has a starting point.
            </text>
            <text x="310" y="97" textAnchor="middle">
              Run the model to trace what happens next.
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

declare global {
  interface Window {
    render_game_to_text?: () => string;
    advanceTime?: (ms: number) => void;
  }
}

export default function SimulatorLab({
  initialSeed = DEFAULT_SEED,
  initialScenario = "nominal",
}: {
  initialSeed?: string;
  initialScenario?: ScenarioId;
}) {
  const [replay, setReplay] = useState(() =>
    newReplay(initialSeed, initialScenario),
  );
  const replayRef = useRef(replay);
  const { simulation, history } = replay;
  const [seedDraft, setSeedDraft] = useState(simulation.seed);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [selectedStage, setSelectedStage] = useState("");
  const [notice, setNotice] = useState(
    "Your experiment stays in this browser.",
  );
  const [isFullscreen, setIsFullscreen] = useState(false);
  const virtualRemainderRef = useRef(0);
  const labRef = useRef<HTMLElement>(null);

  const replaceReplay = useCallback((next: ReturnType<typeof newReplay>) => {
    replayRef.current = next;
    setReplay(next);
  }, []);

  const advance = useCallback(
    (count: number) => {
      const ticks = Math.max(0, Math.min(10000, Math.floor(count)));
      if (!Number.isFinite(ticks) || ticks === 0) return;
      let next = replayRef.current.simulation;
      const points = [...replayRef.current.history];
      for (let index = 0; index < ticks; index += 1) {
        const previous = next;
        next = stepSimulation(previous, 1);
        points.push({
          tick: next.tick,
          depth: next.queue.length,
          arrived: next.arrivals - previous.arrivals,
          completed: next.completed - previous.completed,
        });
        if (points.length > 80) points.shift();
      }
      replaceReplay({ simulation: next, history: points });
    },
    [replaceReplay],
  );

  const reset = useCallback(
    (
      seed = seedDraft,
      scenario: ScenarioId = replayRef.current.simulation.scenarioId,
    ) => {
      const next = newReplay(seed, scenario);
      setSeedDraft(next.simulation.seed);
      virtualRemainderRef.current = 0;
      replaceReplay(next);
      setRunning(false);
      setNotice(`Replay reset to ${next.simulation.seed}.`);
    },
    [replaceReplay, seedDraft],
  );

  const toggleRun = useCallback(() => setRunning((value) => !value), []);
  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (labRef.current) await labRef.current.requestFullscreen();
    } catch {
      setNotice("Fullscreen is unavailable in this browser.");
    }
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("seed", simulation.seed);
    url.searchParams.set("scenario", simulation.scenarioId);
    window.history.replaceState({}, "", url);
  }, [simulation.seed, simulation.scenarioId]);

  useEffect(() => {
    if (!running) return;
    const interval = window.setInterval(() => advance(1), TICK_MS / speed);
    return () => window.clearInterval(interval);
  }, [advance, running, speed]);

  useEffect(() => {
    window.render_game_to_text = () =>
      JSON.stringify({
        label: "SIMULATED local discrete-event systems model",
        provenance: PROVENANCE,
        limitations: [
          "Capacities and compute units are arbitrary model units.",
          "The model is not a benchmark, forecast, service-level claim, or production architecture.",
          "No AI model, network, external service, identity data, or monetary data is involved.",
        ],
        coordinateSystem:
          "Responsive DOM topology; stages ordered Intake, Classify, Policy, Dispatch.",
        running,
        playbackSpeed: speed,
        ...getSnapshot(replayRef.current.simulation),
        history: replayRef.current.history,
        historyUnits: {
          tick: "simulation ticks",
          depth: "synthetic items after processing",
          arrived: "synthetic items per tick",
          completed: "synthetic items per tick",
        },
      });
    window.advanceTime = (ms: number) => {
      const duration = Number(ms);
      if (!Number.isFinite(duration)) return;
      virtualRemainderRef.current += Math.max(0, duration);
      const ticks = Math.floor(virtualRemainderRef.current / TICK_MS);
      if (ticks > 0) {
        virtualRemainderRef.current -= ticks * TICK_MS;
        advance(ticks);
      }
    };
    return () => {
      delete window.render_game_to_text;
      delete window.advanceTime;
    };
  }, [advance, running, speed]);

  useEffect(() => {
    const onFullscreen = () =>
      setIsFullscreen(Boolean(document.fullscreenElement));
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey)
        return;
      if (event.key === "Escape" && document.fullscreenElement) {
        event.preventDefault();
        void toggleFullscreen();
        return;
      }
      if (
        target instanceof Element &&
        target.closest("input, select, textarea, [contenteditable]")
      )
        return;
      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        void toggleFullscreen();
      }
      if (
        event.code === "Space" &&
        !(target instanceof Element && target.closest("button, a, summary"))
      ) {
        event.preventDefault();
        toggleRun();
      }
    };
    document.addEventListener("fullscreenchange", onFullscreen);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreen);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [toggleFullscreen, toggleRun]);

  const closeInspector = () => {
    document.getElementById(`stage-${selectedStage}`)?.focus();
    setSelectedStage("");
  };

  const snapshot = getSnapshot(simulation);
  const scenarioNote = SCENARIO_PRESENTATION[simulation.scenarioId];
  const latest = history[history.length - 1];
  const selected = simulation.stages.find(
    (stage) => stage.id === selectedStage,
  );
  const stageIndex = selected ? simulation.stages.indexOf(selected) : -1;
  const stageWork = selected
    ? simulation.queue
        .filter((item) => item.stage === stageIndex)
        .sort(
          (a, b) =>
            b.priority - a.priority ||
            a.createdTick - b.createdTick ||
            a.id.localeCompare(b.id),
        )
    : [];
  const largestQueue = simulation.stages.reduce(
    (largest, stage) => (stage.waiting > largest.waiting ? stage : largest),
    simulation.stages[0],
  );
  const phase = getPhase(simulation.scenarioId, simulation.tick);

  const copyReplay = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setNotice(
        "Replay URL copied. The seed and scenario reproduce the same run from tick 0.",
      );
    } catch {
      setNotice(
        "Clipboard access was blocked; copy the URL from the address bar.",
      );
    }
  };

  const explanation =
    simulation.tick === 0
      ? "Ready to send the first items through."
      : largestQueue.waiting
        ? `Work is waiting at ${STEP_NAMES[largestQueue.id]}.`
        : "Everything is getting through.";
  const explanationDetail =
    simulation.tick === 0
      ? "Press Run. Each tick sends new work through the four steps."
      : largestQueue.waiting
        ? `${largestQueue.waiting} ${largestQueue.waiting === 1 ? "item is" : "items are"} waiting there. This step can process up to ${largestQueue.capacity} per tick.`
        : `${simulation.completed} ${simulation.completed === 1 ? "item has" : "items have"} finished. Nothing is waiting at the end of this tick.`;

  return (
    <main ref={labRef} className="lab-shell">
      <a className="skip-link" href="#controls">
        Skip to simulator controls
      </a>
      <header className="app-header">
        <a
          className="brand"
          href="#workspace"
          aria-label="Queueglass workspace"
        >
          <BrandMark />
          <span>
            queueglass<span className="brand-period">.</span>
          </span>
        </a>
        <div className="header-actions">
          <span className="simulation-label">A small systems simulator</span>
          <button
            id="copy-replay"
            className="button share-button"
            onClick={copyReplay}
          >
            <Icon name="share" />
            Share replay
          </button>
        </div>
      </header>
      <div className="workspace" id="workspace">
        <section className="introduction">
          <h1>See where work gets stuck.</h1>
          <p>
            Send work through four steps. Change the traffic. Watch the queue.
          </p>
        </section>
        <section className="situation-picker" aria-label="Synthetic scenarios">
          <span className="field-label">Try a situation</span>
          <div className="scenario-list">
            {Object.values(SCENARIOS).map((item) => (
              <button
                key={item.id}
                id={`scenario-${item.id}`}
                className={`scenario-card ${simulation.scenarioId === item.id ? "selected" : ""}`}
                aria-pressed={simulation.scenarioId === item.id}
                onClick={() => {
                  reset(simulation.seed, item.id as ScenarioId);
                  setSelectedStage("");
                }}
              >
                {SCENARIO_PRESENTATION[item.id as ScenarioId].label}
              </button>
            ))}
          </div>
          <p className="situation-description">{scenarioNote.description}</p>
        </section>

        <section
          className="topology-panel"
          aria-label="Work moves through four steps"
        >
          <div
            id="controls"
            className="control-panel flow-heading"
            role="group"
            aria-label="Simulator controls"
          >
            <div className="transport">
              <button
                id="toggle-run"
                className="button primary"
                aria-pressed={running}
                onClick={toggleRun}
              >
                <Icon name={running ? "pause" : "play"} />
                {running ? "Pause" : simulation.tick ? "Continue" : "Run"}
              </button>
              <button
                id="advance-1"
                className="button step-button"
                onClick={() => advance(1)}
              >
                <Icon name="step" />1 tick
              </button>
              <button
                id="reset-replay"
                className="icon-button"
                aria-label="Reset replay"
                title="Start again"
                onClick={() => reset(simulation.seed, simulation.scenarioId)}
              >
                <Icon name="reset" />
              </button>
            </div>
            <span className="flow-hint">Click a step to look inside</span>
            <button
              id="toggle-fullscreen"
              className="icon-button"
              aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
              title="Fullscreen (F)"
              aria-pressed={isFullscreen}
              onClick={toggleFullscreen}
            >
              <Icon name="expand" />
            </button>
          </div>
          <Topology
            stages={simulation.stages}
            selectedStage={selectedStage}
            onSelectStage={(id) =>
              setSelectedStage((current) => (current === id ? "" : id))
            }
            running={running}
          />
          <div className="flow-summary">
            <div>
              <span
                className={
                  simulation.queue.length
                    ? "queue-count pressure"
                    : "queue-count"
                }
              >
                <b>{simulation.queue.length}</b> waiting
              </span>
              <span>
                <b>{simulation.completed}</b> finished
              </span>
            </div>
            <span className="tick-readout">
              tick <b>{String(simulation.tick).padStart(3, "0")}</b>
              <i className={running ? "running" : ""} />
            </span>
          </div>
        </section>

        <section className="explanation-panel" aria-label="What is happening">
          <div className="run-explanation">
            <h2>{explanation}</h2>
            <p>{explanationDetail}</p>
            {simulation.tick > 0 && scenarioNote.window && (
              <span className="phase-note">{phase}</span>
            )}
          </div>
        </section>

        {selected && (
          <section
            id="stage-inspector"
            className="stage-inspector"
            data-stage={selectedStage}
            aria-labelledby="inspector-title"
          >
            <div className="section-heading">
              <h2 id="inspector-title">
                Inside {STEP_NAMES[selectedStage]} <span>{selected.label}</span>
              </h2>
              <button
                id="close-inspector"
                className="icon-button close-button"
                aria-label="Close stage inspector"
                onClick={closeInspector}
              >
                ×
              </button>
            </div>
            <p className="inspector-description">
              {STAGE_NOTES[selectedStage]}
            </p>
            <dl className="inspector-metrics">
              <div>
                <dt>Can process per tick</dt>
                <dd>{selected.capacity}</dd>
              </div>
              <div>
                <dt>Moved this tick</dt>
                <dd>{selected.handled}</dd>
              </div>
              <div>
                <dt>Still waiting</dt>
                <dd>{selected.waiting}</dd>
              </div>
            </dl>
            <div className="work-list">
              <div className="work-list-heading">
                <span>WAITING ITEMS</span>
                <span>PRIORITY / RETRIES</span>
              </div>
              {stageWork.length ? (
                <ul>
                  {stageWork.slice(0, 5).map((item) => (
                    <li key={item.id}>
                      <span>{item.id}</span>
                      <span>
                        <b>P{item.priority}</b>
                        <span className={item.retries ? "has-retries" : ""}>
                          {item.retries}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="empty-work">
                  {simulation.tick
                    ? "No work is waiting at this step."
                    : "Run the simulation to send work through this step."}
                </p>
              )}
              {stageWork.length > 5 && (
                <p className="work-overflow">
                  First 5 of {stageWork.length}, in processing order. Higher
                  priority goes first.
                </p>
              )}
            </div>
          </section>
        )}

        <div className="details-area">
          <details id="numbers-panel" className="disclosure">
            <summary>
              <span>Explore the run</span>
              <span className="summary-description">
                Chart, counts & decisions
              </span>
              <span className="detail-plus">+</span>
            </summary>
            <div className="disclosure-content">
              <div className="advanced-controls">
                <button
                  id="advance-10"
                  className="button"
                  onClick={() => advance(10)}
                >
                  Advance 10 ticks
                </button>
                <label>
                  Playback speed{" "}
                  <select
                    aria-label="Playback speed"
                    value={speed}
                    onChange={(event) => setSpeed(Number(event.target.value))}
                  >
                    <option value={0.5}>0.5×</option>
                    <option value={1}>1×</option>
                    <option value={2}>2×</option>
                  </select>
                </label>
              </div>
              <section
                className="pressure-panel"
                aria-labelledby="pressure-title"
              >
                <div className="section-heading">
                  <h2 id="pressure-title">Waiting over time</h2>
                  <span className="chart-key">
                    <i />
                    Items in the queue
                  </span>
                </div>
                <PressureChart
                  history={history}
                  scenario={simulation.scenarioId}
                />
                <div className="chart-stats">
                  <span>
                    <b>+{latest.arrived}</b> arrived this tick
                  </span>
                  <span>
                    <b>−{latest.completed}</b> finished this tick
                  </span>
                  <span className="chart-tick">
                    T{String(simulation.tick).padStart(3, "0")}
                  </span>
                </div>
                <p className="chart-footnote">
                  {history.length === 80
                    ? "Last 80 ticks"
                    : "Every tick recorded"}{" "}
                  · queue depth after processing
                </p>
              </section>
              <section className="metric-strip" aria-label="Synthetic metrics">
                {[
                  [
                    "Total arrivals",
                    snapshot.metrics.syntheticArrivals,
                    "generated items",
                  ],
                  [
                    "Mean time to finish",
                    simulation.completed
                      ? snapshot.metrics.meanSojournTicks
                      : "—",
                    "simulation ticks · completed items",
                  ],
                  [
                    "Retries",
                    snapshot.metrics.retryDecisions,
                    "synthetic decisions",
                  ],
                  [
                    "Compute",
                    snapshot.metrics.computeUnits,
                    "arbitrary model units",
                  ],
                ].map(([label, value, unit]) => (
                  <article className="metric" key={label}>
                    <h3>{label}</h3>
                    <strong>{value}</strong>
                    <span>{unit}</span>
                  </article>
                ))}
              </section>
              <section className="event-panel" aria-labelledby="events-title">
                <div className="section-heading">
                  <h2 id="events-title">Recent decisions</h2>
                  <span className="field-label">NEWEST FIRST</span>
                </div>
                <ol className="event-list">
                  {snapshot.events.map((event, index) => (
                    <li key={`${event.tick}-${event.kind}-${index}`}>
                      <span className="event-tick">
                        T{String(event.tick).padStart(3, "0")}
                      </span>
                      <span className={`event-kind ${event.kind}`}>
                        {event.kind}
                      </span>
                      <p>{event.message}</p>
                    </li>
                  ))}
                </ol>
              </section>
            </div>
          </details>
          <details id="replay-settings" className="disclosure">
            <summary>
              <span>Replay settings</span>
              <span className="summary-description">
                Repeat the same experiment
              </span>
              <span className="detail-plus">+</span>
            </summary>
            <div className="disclosure-content replay-content">
              <div>
                <p>
                  The same seed and situation produce the same decisions. Shared
                  links start at tick 0.
                </p>
                <form
                  className="seed-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    reset();
                  }}
                >
                  <label className="seed-control">
                    <span>Replay seed</span>
                    <input
                      value={seedDraft}
                      onChange={(event) => setSeedDraft(event.target.value)}
                      maxLength={32}
                      spellCheck={false}
                      autoComplete="off"
                    />
                  </label>
                  <button id="apply-seed" className="button" type="submit">
                    Apply seed
                  </button>
                </form>
                <button
                  id="derive-seed"
                  className="text-button"
                  onClick={() =>
                    reset(
                      `LAB-${hashSeed(`${simulation.seed}:${simulation.tick}`).toString(36).toUpperCase()}`,
                      simulation.scenarioId,
                    )
                  }
                >
                  <Icon name="shuffle" />
                  Try another seed
                </button>
              </div>
              <div className="keyboard-hints">
                <span>
                  <kbd>space</kbd> Run or pause
                </span>
                <span>
                  <kbd>F</kbd> Fullscreen
                </span>
              </div>
            </div>
          </details>
          <details className="disclosure truth-panel">
            <summary>
              <span>How this model works</span>
              <span className="truth-badge">SIMULATED DATA</span>
              <span className="detail-plus">+</span>
            </summary>
            <div className="disclosure-content">
              <h3>This is a model, not a monitored system.</h3>
              <p>
                One tick is one round of processing. Items enter at Receive and
                can pass through all four steps in the same tick. When a step
                cannot keep up, work waits there for a later tick.
              </p>
              <p>{PROVENANCE}</p>
              <p>
                Capacity and compute use arbitrary units. Time is measured in
                simulation ticks. Results are educational, not forecasts or
                performance claims.
              </p>
            </div>
          </details>
        </div>
        <footer className="workspace-footer">
          <p className="status-line" role="status" aria-live="polite">
            {notice}
          </p>
          <span>Local. Seeded. Repeatable.</span>
        </footer>
      </div>
    </main>
  );
}
