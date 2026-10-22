"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import FlapText from "@/components/FlapText";
import FlowBoard, { type Frame } from "@/components/FlowBoard";
import Timeline from "@/components/Timeline";
import {
  RUN_LENGTH,
  SCENARIOS,
  STAGES,
  hashSeed,
  normalizeSeed,
  normalizeSettings,
  runSimulation,
} from "@/lib/simulation.js";

type ScenarioId = keyof typeof SCENARIOS;
type Settings = ReturnType<typeof normalizeSettings>;
type IconName = "play" | "pause" | "next" | "back" | "reset" | "share" | "shuffle";

const BASE_TICK_MS = 600;
const SPEEDS = [0.5, 1, 2];

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    play: <path d="m8 5 11 7-11 7Z" />,
    pause: <path d="M8 5v14M16 5v14" />,
    next: <path d="m6 5 9 7-9 7ZM18 5v14" />,
    back: <path d="m18 5-9 7 9 7ZM6 5v14" />,
    reset: <path d="M4 10a8 8 0 1 1 1 7M4 4v6h6" />,
    share: <path d="M12 15V3m-4 4 4-4 4 4M5 12v8h14v-8" />,
    shuffle: (
      <path d="M3 6h3c5 0 7 12 12 12h3m-4-4 4 4-4 4M3 18h3c2 0 3-2 4-4m4-4c1-2 2-4 4-4h3m-4-4 4 4-4 4" />
    ),
  };
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
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
    <svg className="brand-mark" width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
      <rect x="2" y="4" width="7" height="20" rx="1.5" />
      <rect x="10.5" y="4" width="7" height="20" rx="1.5" />
      <rect x="19" y="4" width="7" height="20" rx="1.5" data-hot />
      <path d="M2 14h24" />
    </svg>
  );
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const listLabels = (labels: string[]) =>
  labels.length < 2 ? labels.join("") : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;

function describe(frame: Frame) {
  if (frame.tick === 0) {
    return {
      title: "Ready at tick 0",
      detail: "Press play to send simulated work through the four steps.",
    };
  }
  const blocked = frame.stages.filter((stage) => stage.blocked).map((stage) => stage.label);
  const behind = blocked.length
    ? ` ${listLabels(blocked)} ${blocked.length === 1 ? "is" : "are"} blocked behind it.`
    : "";
  const bottleneck = frame.stages.find((stage) => stage.id === frame.bottleneck);
  if (bottleneck) {
    return {
      title: `${bottleneck.label} is the bottleneck`,
      detail: `${plural(bottleneck.leftover, "item")} could not move on from ${bottleneck.label} this tick. It moves at most ${bottleneck.capacity} per tick${bottleneck.faulted ? " while it is slowed" : ""}.${behind}`,
    };
  }
  if (blocked.length) {
    return {
      title: `${listLabels(blocked)} ${blocked.length === 1 ? "is" : "are"} blocked`,
      detail: "The buffer after it is full, so work holds where it is.",
    };
  }
  return {
    title: "Everything is getting through",
    detail: `${plural(frame.arrived, "item")} arrived and ${frame.finished} finished on this tick.`,
  };
}

function runInsight(frames: Frame[]) {
  const counts = STAGES.map((stage) => ({
    label: stage.label,
    ticks: frames.filter((frame) => frame.bottleneck === stage.id).length,
  }))
    .filter((entry) => entry.ticks > 0)
    .sort((left, right) => right.ticks - left.ticks);
  if (!counts.length) {
    return "No step was a bottleneck in this run. Raise the arrivals or lower a capacity to make one.";
  }
  const [first, ...rest] = counts;
  const others = rest.map((entry) => `${entry.label} on ${entry.ticks}`);
  return `Over all ${RUN_LENGTH} ticks, ${first.label} was the bottleneck on ${first.ticks}${others.length ? `, ${listLabels(others)}` : ""}.`;
}

const sameSettings = (left: Settings, right: Settings) =>
  left.traffic === right.traffic && left.capacities.every((value, index) => value === right.capacities[index]);

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
const reducedMotionNow = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

declare global {
  interface Window {
    render_game_to_text?: () => string;
  }
}

export default function SimulatorLab({
  initialSeed,
  initialScenario,
  initialSettings,
}: {
  initialSeed: string;
  initialScenario: ScenarioId;
  initialSettings: Settings;
}) {
  const [seed, setSeed] = useState(initialSeed);
  const [seedDraft, setSeedDraft] = useState(initialSeed);
  const [scenarioId, setScenarioId] = useState(initialScenario);
  const [settings, setSettings] = useState(initialSettings);
  const [tick, setTick] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState<"idle" | "copied" | "blocked">("idle");
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, reducedMotionNow, () => true);

  const frames = useMemo(() => runSimulation(seed, scenarioId, settings), [seed, scenarioId, settings]);
  const frame = frames[tick];
  const tickMs = BASE_TICK_MS / speed;
  const preset = SCENARIOS[scenarioId];
  const edited = !sameSettings(settings, normalizeSettings(scenarioId));
  const message = describe(frame);

  // Start the default replay on load so the first screen is already moving.
  useEffect(() => {
    if (reducedMotionNow()) return;
    const timeout = window.setTimeout(() => setPlaying(true), 500);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!playing) return;
    const timeout = window.setTimeout(() => {
      if (tick >= RUN_LENGTH) setPlaying(false);
      else setTick(tick + 1);
    }, tickMs);
    return () => window.clearTimeout(timeout);
  }, [playing, tick, tickMs]);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("seed", seed);
    url.searchParams.set("scenario", scenarioId);
    if (edited) {
      url.searchParams.set("traffic", String(settings.traffic));
      url.searchParams.set("caps", settings.capacities.join("-"));
    } else {
      url.searchParams.delete("traffic");
      url.searchParams.delete("caps");
    }
    window.history.replaceState(null, "", url);
  }, [seed, scenarioId, settings, edited]);

  useEffect(() => {
    if (copied === "idle") return;
    const timeout = window.setTimeout(() => setCopied("idle"), 2400);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  const togglePlay = () => {
    if (playing) return setPlaying(false);
    if (tick >= RUN_LENGTH) setTick(0);
    setPlaying(true);
  };
  const seek = (next: number) => {
    setPlaying(false);
    setTick(Math.max(0, Math.min(RUN_LENGTH, next)));
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input, select, textarea, [contenteditable]")) return;
      if (event.code === "Space" && !target?.closest("button, a, summary")) {
        event.preventDefault();
        if (!event.repeat) document.getElementById("toggle-play")?.click();
      } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        document.getElementById(event.key === "ArrowRight" ? "step-forward" : "step-back")?.click();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    window.render_game_to_text = () =>
      JSON.stringify({
        label: "SIMULATED queue model. No real systems or telemetry.",
        seed,
        scenario: scenarioId,
        settings,
        playing,
        tick,
        frame,
      });
    return () => {
      delete window.render_game_to_text;
    };
  }, [seed, scenarioId, settings, playing, tick, frame]);

  const loadScenario = (id: ScenarioId) => {
    setScenarioId(id);
    setSettings(normalizeSettings(id));
    setTick(0);
    setPlaying(true);
    setNotice(`Loaded ${SCENARIOS[id].label}. Playing from tick 0.`);
  };
  const applySeed = (next: string) => {
    const normalized = normalizeSeed(next);
    setSeed(normalized);
    setSeedDraft(normalized);
    setTick(0);
    setPlaying(false);
    setNotice(`Seed set to ${normalized}. The replay restarts at tick 0.`);
  };
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied("copied");
      setNotice("Link copied. It reproduces this exact run from tick 0.");
    } catch {
      setCopied("blocked");
      setNotice("Clipboard access was blocked. Copy the address bar instead; it holds the same link.");
    }
  };

  const totals = [
    ["Arrived", frame.metrics.syntheticArrivals],
    ["Finished", frame.metrics.syntheticCompleted],
    ["Waiting now", frame.metrics.queueDepth],
    ["Average ticks to finish", frame.metrics.syntheticCompleted ? frame.metrics.meanSojournTicks : "none yet"],
    ["Retries at a slowed step", frame.metrics.retryDecisions],
  ] as const;

  return (
    <div className="page">
      <a className="skip-link" href="#board">
        Skip to the simulator
      </a>
      <header className="masthead">
        <p className="brand">
          <BrandMark />
          queueglass
        </p>
        <span className="truth-badge">Simulated data</span>
        <button
          id="copy-link"
          type="button"
          className="button ghost"
          data-feedback={copied}
          onClick={copyLink}
        >
          <Icon name="share" />
          <span className="button-label">
            {copied === "copied" ? "Link copied" : copied === "blocked" ? "Copy blocked" : "Share this run"}
          </span>
        </button>
      </header>

      <main>
        <section className="intro" aria-labelledby="page-title">
          <div className="intro-copy">
            <h1 id="page-title">See where work gets stuck.</h1>
            <p>
              A seeded queue simulator. Pick a scenario, watch the bottleneck form and spread, then
              scrub back through every tick.
            </p>
          </div>
          <div className="scenarios" role="group" aria-label="Scenarios">
            {Object.values(SCENARIOS).map((scenario) => (
              <button
                key={scenario.id}
                id={`scenario-${scenario.id}`}
                type="button"
                className="scenario"
                aria-pressed={scenarioId === scenario.id}
                onClick={() => loadScenario(scenario.id as ScenarioId)}
              >
                <span className="scenario-name">{scenario.label}</span>
                <span className="scenario-summary">{scenario.summary}</span>
              </button>
            ))}
          </div>
          <p className="scenario-note">{preset.summary}</p>
        </section>

        <section id="board" className="panel board-panel" aria-labelledby="board-title">
          <div className="board-bar">
            <div className="message">
              <h2 id="board-title">{message.title}</h2>
              <p>{message.detail}</p>
            </div>
            <div className="transport" role="group" aria-label="Playback">
              <button
                id="toggle-play"
                type="button"
                className="button primary"
                aria-pressed={playing}
                onClick={togglePlay}
              >
                <Icon name={playing ? "pause" : "play"} />
                {playing ? "Pause" : tick >= RUN_LENGTH ? "Replay" : "Play"}
              </button>
              <button
                id="step-back"
                type="button"
                className="icon-button"
                aria-label="Back one tick"
                disabled={tick === 0}
                onClick={() => seek(tick - 1)}
              >
                <Icon name="back" />
              </button>
              <button
                id="step-forward"
                type="button"
                className="icon-button"
                aria-label="Forward one tick"
                disabled={tick === RUN_LENGTH}
                onClick={() => seek(tick + 1)}
              >
                <Icon name="next" />
              </button>
              <button
                id="restart"
                type="button"
                className="icon-button"
                aria-label="Back to tick 0"
                onClick={() => seek(0)}
              >
                <Icon name="reset" />
              </button>
              <div className="speed" role="group" aria-label="Playback speed">
                {SPEEDS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={speed === value}
                    onClick={() => setSpeed(value)}
                  >
                    {value}×
                  </button>
                ))}
              </div>
              <span className="tick-readout">
                <FlapText value={`T${String(tick).padStart(2, "0")}`} size="md" />
                <span>of {RUN_LENGTH}</span>
              </span>
            </div>
          </div>

          <FlowBoard
            frame={frame}
            traffic={settings.traffic}
            capacities={settings.capacities}
            animate={playing && !reducedMotion}
            tickMs={tickMs}
            onTraffic={(traffic) => setSettings({ ...settings, traffic })}
            onCapacity={(index, value) =>
              setSettings({
                ...settings,
                capacities: settings.capacities.map((capacity, at) => (at === index ? value : capacity)),
              })
            }
          />
          {edited && (
            <p className="edited-note">
              You changed the {preset.label} settings, so this is a new run.{" "}
              <button
                type="button"
                className="text-button"
                onClick={() => setSettings(normalizeSettings(scenarioId))}
              >
                Back to the preset
              </button>
            </p>
          )}

          <div className="replay">
            <div className="replay-head">
              <h2>Replay</h2>
              <p>
                {runInsight(frames)} Drag across the lanes or use the slider to scrub to any tick.
              </p>
            </div>
            <Timeline frames={frames} tick={tick} scenarioId={scenarioId} onSeek={seek} />
          </div>
        </section>

        <section className="totals" aria-label={`Simulated totals at tick ${tick}`}>
          <h2>
            Totals at tick {tick}
            <span>simulated items</span>
          </h2>
          <dl>
            {totals.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <div className="notes">
          <section className="panel" aria-labelledby="model-title">
            <h2 id="model-title">How the model works</h2>
            <p>
              Each tick, new items arrive at Receive. Steps are served from Finish back to Receive,
              so an item moves at most one step per tick and space freed downstream is visible
              upstream on the same tick. A step serves higher-priority items first, up to its
              capacity.
            </p>
            <p>
              The bottleneck is the step that left the most work unserved on a tick. A step that
              cannot pass work on because the buffer after it is full is marked blocked, not
              bottleneck: it is waiting on the step after it.
            </p>
            <p className="truth">
              Everything here is generated in your browser by a small deterministic model. There
              is no real system, telemetry or benchmark behind it. Capacity is in items per tick
              and time is in ticks.
            </p>
          </section>
          <section className="panel" aria-labelledby="seed-title">
            <h2 id="seed-title">Same seed, same run</h2>
            <p>
              The seed fixes every random draw, so a seed plus a scenario and its settings always
              produces the same {RUN_LENGTH} ticks. The share link carries all three.
            </p>
            <form
              className="seed-form"
              onSubmit={(event) => {
                event.preventDefault();
                applySeed(seedDraft);
              }}
            >
              <label htmlFor="seed-input">Seed</label>
              <input
                id="seed-input"
                value={seedDraft}
                onChange={(event) => setSeedDraft(event.target.value)}
                maxLength={32}
                spellCheck={false}
                autoComplete="off"
              />
              <button type="submit" className="button ghost">
                Apply
              </button>
              <button
                type="button"
                className="button ghost"
                onClick={() => applySeed(`LAB-${hashSeed(`${seed}:${tick}`).toString(36).toUpperCase()}`)}
              >
                <Icon name="shuffle" />
                Another seed
              </button>
            </form>
            <p className="keys">
              <kbd>Space</kbd> plays or pauses. <kbd>←</kbd> <kbd>→</kbd> step one tick.
            </p>
          </section>
        </div>
      </main>

      <footer className="footer">
        <p role="status" aria-live="polite">
          {notice}
        </p>
        <p>
          queueglass is open source.{" "}
          <a href="https://github.com/fortunexbt/queueglass">Read the code on GitHub</a>.
        </p>
      </footer>
    </div>
  );
}
