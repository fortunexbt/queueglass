"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import FlowBoard from "@/components/FlowBoard";
import LinePanel from "@/components/LinePanel";
import Timeline from "@/components/Timeline";
import { type Setup, decodeSetup, encodeSetup, headline, periodDate, periodLabel } from "@/lib/line.js";
import { type Frame, analyzeLine } from "@/lib/simulation.js";

type IconName = "play" | "pause" | "next" | "back" | "reset" | "share";

// A whole replay plays in about 24 seconds at 1x, however many periods it has.
const RUN_MS = 24_000;
const SPEEDS = [0.5, 1, 2];
const MOVING_DOTS_MIN_MS = 200;

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    play: <path d="m8 5 11 7-11 7Z" />,
    pause: <path d="M8 5v14M16 5v14" />,
    next: <path d="m6 5 9 7-9 7ZM18 5v14" />,
    back: <path d="m18 5-9 7 9 7ZM6 5v14" />,
    reset: <path d="M4 10a8 8 0 1 1 1 7M4 4v6h6" />,
    share: <path d="M12 15V3m-4 4 4-4 4 4M5 12v8h14v-8" />,
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

const plural = (count: number, word: string) => `${count.toLocaleString("en-GB")} ${word}${count === 1 ? "" : "s"}`;

function describe(frame: Frame, when: string) {
  if (frame.period === 0) {
    return { title: "Start", detail: "Nothing has arrived yet. Press play or drag the replay." };
  }
  const blocked = frame.stages.filter((stage) => stage.blocked).map((stage) => stage.name);
  const behind = blocked.length ? ` Held by the WIP limit: ${blocked.join(", ")}.` : "";
  const bottleneck = frame.stages[frame.bottleneck];
  if (bottleneck) {
    return {
      title: `${when}: ${bottleneck.name} is the bottleneck`,
      detail: `${plural(bottleneck.leftover, "item")} could not move on from ${bottleneck.name}, which finishes at most ${bottleneck.capacity}.${behind}`,
    };
  }
  if (blocked.length) {
    return { title: `${when}: blocked by the WIP limit`, detail: `${blocked.join(", ")} cannot pass work on until the next step drains.` };
  }
  return {
    title: `${when}: everything moved`,
    detail: `${plural(frame.arrived, "item")} arrived and ${frame.finished} finished.`,
  };
}

// The share-link fragment is the single source of truth for the line. It never reaches a
// server. `version` counts loads from outside the panel (a pasted link, the example button),
// which is when the panel's drafts have to be thrown away.
const listeners = new Set<() => void>();
let version = 0;
function subscribeFragment(onChange: () => void) {
  const onHashChange = () => {
    version += 1;
    onChange();
  };
  listeners.add(onChange);
  window.addEventListener("hashchange", onHashChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("hashchange", onHashChange);
  };
}
const fragmentNow = () => `${version}#${window.location.hash.slice(1)}`;
function writeFragment(fragment: string, external: boolean) {
  const url = new URL(window.location.href);
  url.hash = fragment;
  window.history.replaceState(null, "", fragment ? url : url.href.replace(/#.*$/, ""));
  if (external) version += 1;
  for (const listener of listeners) listener();
}

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

export default function SimulatorLab({ example }: { example: Setup }) {
  const snapshot = useSyncExternalStore(subscribeFragment, fragmentNow, () => "server#");
  const panelKey = snapshot.slice(0, snapshot.indexOf("#"));
  const fragment = snapshot.slice(snapshot.indexOf("#") + 1);
  const exampleFragment = useMemo(() => encodeSetup(example), [example]);
  const setup = useMemo(() => (fragment && decodeSetup(fragment)) || example, [fragment, example]);
  const key = encodeSetup(setup);
  const isExample = key === exampleFragment;
  const analysis = useMemo(() => analyzeLine(setup.line), [setup]);
  const verdict = headline(setup, analysis);
  const { frames, peak, clearedBy, limiting, whatIf } = analysis;
  const last = frames.length - 1;

  // The replay opens on the worst period. A new line moves it to that line's worst period.
  const [cursor, setCursor] = useState({ key: "", tick: 0 });
  const tick = cursor.key === key ? Math.min(cursor.tick, last) : peak.period;
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState<"idle" | "copied" | "blocked">("idle");
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, reducedMotionNow, () => true);

  const frame = frames[tick];
  const tickMs = Math.min(600, Math.max(40, RUN_MS / last)) / speed;
  const label = (period: number) => periodLabel(setup, period);
  const unitPlural = `${setup.unit}s`;
  const message = describe(frame, label(tick));

  useEffect(() => {
    if (!playing) return;
    const timeout = window.setTimeout(() => {
      if (tick >= last) setPlaying(false);
      else setCursor({ key, tick: tick + 1 });
    }, tickMs);
    return () => window.clearTimeout(timeout);
  }, [playing, tick, tickMs, last, key]);

  useEffect(() => {
    if (copied === "idle") return;
    const timeout = window.setTimeout(() => setCopied("idle"), 2400);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  const seek = (next: number) => {
    setPlaying(false);
    setCursor({ key, tick: Math.max(0, Math.min(last, next)) });
  };
  const togglePlay = () => {
    if (playing) return setPlaying(false);
    setCursor({ key, tick: tick >= last ? 0 : tick });
    setPlaying(true);
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
      JSON.stringify({ setup, isExample, verdict, peak, clearedBy, limiting, whatIf, playing, tick, last, frame });
    return () => {
      delete window.render_game_to_text;
    };
  }, [setup, isExample, verdict, peak, clearedBy, limiting, whatIf, playing, tick, last, frame]);

  const changeSetup = (next: Setup) => {
    const encoded = encodeSetup(next);
    writeFragment(encoded === exampleFragment ? "" : encoded, false);
  };
  const loadExample = () => {
    writeFragment("", true);
    setNotice("Loaded the BPI Challenge 2019 example.");
  };
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied("copied");
      setNotice("Link copied. The line and its arrivals are in the part after #, which browsers never send to a server.");
    } catch {
      setCopied("blocked");
      setNotice("Clipboard access was blocked. Copy the address bar instead; it holds the same link.");
    }
  };

  const window_ = clearedBy === null ? null : { from: peak.period, to: clearedBy, label: "Peak to cleared" };
  const axisLabel = (period: number) => {
    if (period === 0) return "Start";
    const date = periodDate(setup, period);
    return date
      ? new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })
      : String(period);
  };
  const totals = [
    ["Arrived so far", frames.slice(1, tick + 1).reduce((sum, item) => sum + item.arrived, 0)],
    ["Finished so far", frame.totalFinished],
    ["In the line now", frame.inLine],
    ["Held back this " + setup.unit, frame.backlog],
    [`Average ${unitPlural} to finish`, frame.totalFinished ? frame.meanPeriodsToFinish : "none yet"],
  ] as const;

  return (
    <div className="page">
      <a className="skip-link" href="#your-line">
        Skip to your line
      </a>
      <header className="masthead">
        <p className="brand">
          <BrandMark />
          queueglass
        </p>
        <span className="truth-badge">Runs in your browser</span>
        <button id="copy-link" type="button" className="button ghost" data-feedback={copied} onClick={copyLink}>
          <Icon name="share" />
          <span className="button-label">
            {copied === "copied" ? "Link copied" : copied === "blocked" ? "Copy blocked" : "Share this line"}
          </span>
        </button>
      </header>

      <main>
        <section className="intro" aria-labelledby="page-title">
          <div className="intro-copy">
            <h1 id="page-title">Which step is holding your team up?</h1>
            <p>
              Enter your workflow&rsquo;s steps, what each finishes per day, and real arrivals from your tracker.
              Queueglass replays them, names the step that limits flow and reruns the line with one more unit of
              capacity at each step.
            </p>
          </div>
          <a className="button primary intro-cta" href="#your-line">
            Enter your line
          </a>
        </section>

        <div className="answer">
          <section className="panel verdict" aria-labelledby="verdict-title" aria-live="polite">
            <p className="source">
              {isExample ? (
                <>
                  Example: purchase-order lines in the CAPEX &amp; SOCS spend area of the{" "}
                  <a href="#example-source">BPI Challenge 2019 log</a>, 2018, per day
                </>
              ) : (
                <>
                  Your line: {plural(setup.line.arrivals.length, setup.unit)} of arrivals through{" "}
                  {plural(setup.line.stages.length, "step")}
                </>
              )}
            </p>
            <h2 id="verdict-title">{verdict.title}</h2>
            {verdict.detail.map((sentence) => (
              <p key={sentence}>{sentence}</p>
            ))}
            {peak.backlog > 0 && (
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  seek(peak.period);
                  document.getElementById("board")?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth" });
                }}
              >
                Show the board at the peak
              </button>
            )}
          </section>

          <section className="panel what-if" aria-labelledby="what-if-title">
            <h2 id="what-if-title">One more per {setup.unit} at each step</h2>
            <p>Each row is a full rerun of the same arrivals with that step&rsquo;s capacity raised by one.</p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Capacity change</th>
                    <th scope="col">Peak backlog</th>
                    <th scope="col">Backlog cleared</th>
                    <th scope="col">Item-{unitPlural} waiting</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">As entered</th>
                    <td>{peak.backlog.toLocaleString("en-GB")}</td>
                    <td>{clearedBy === null ? "no backlog" : label(clearedBy)}</td>
                    <td>{analysis.heldBack.toLocaleString("en-GB")}</td>
                  </tr>
                  {whatIf.map((row, index) => (
                    <tr key={index} data-limiting={index === limiting || undefined}>
                      <th scope="row">
                        {row.name} {row.capacity - 1} &rarr; {row.capacity}
                      </th>
                      <td>{row.peakBacklog.toLocaleString("en-GB")}</td>
                      <td>
                        {clearedBy === null ? "no backlog" : row.clearedBy === null ? "not cleared" : label(row.clearedBy)}
                      </td>
                      <td>{row.heldBack.toLocaleString("en-GB")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="table-note">
              Item-{unitPlural} waiting adds up, over the whole replay, every item that was ready to move and
              couldn&rsquo;t.
            </p>
          </section>
        </div>

        <LinePanel
          key={panelKey}
          setup={setup}
          isExample={isExample}
          onChange={changeSetup}
          onLoadExample={loadExample}
        />

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
                {playing ? "Pause" : tick >= last ? "Replay" : "Play"}
              </button>
              <button
                id="step-back"
                type="button"
                className="icon-button"
                aria-label={`Back one ${setup.unit}`}
                disabled={tick === 0}
                onClick={() => seek(tick - 1)}
              >
                <Icon name="back" />
              </button>
              <button
                id="step-forward"
                type="button"
                className="icon-button"
                aria-label={`Forward one ${setup.unit}`}
                disabled={tick === last}
                onClick={() => seek(tick + 1)}
              >
                <Icon name="next" />
              </button>
              <button id="restart" type="button" className="icon-button" aria-label="Back to the start" onClick={() => seek(0)}>
                <Icon name="reset" />
              </button>
              <div className="speed" role="group" aria-label="Playback speed">
                {SPEEDS.map((value) => (
                  <button key={value} type="button" aria-pressed={speed === value} onClick={() => setSpeed(value)}>
                    {value}×
                  </button>
                ))}
              </div>
            </div>
          </div>

          <FlowBoard
            frame={frame}
            unit={setup.unit}
            animate={playing && !reducedMotion && tickMs >= MOVING_DOTS_MIN_MS}
            tickMs={tickMs}
          />

          <div className="replay">
            <div className="replay-head">
              <h2>Replay</h2>
              <p>
                {plural(last, setup.unit)}, including the {setup.unit}s after the last arrival while the line drains.
                Drag across the lanes or use the slider.
              </p>
            </div>
            <Timeline frames={frames} tick={tick} window={window_} label={label} axisLabel={axisLabel} onSeek={seek} />
          </div>
        </section>

        <section className="totals" aria-label={`Totals at ${label(tick)}`}>
          <h2>
            At {label(tick)}
            <span>items</span>
          </h2>
          <dl>
            {totals.map(([name, value]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <div className="notes">
          <section className="panel" aria-labelledby="model-title">
            <h2 id="model-title">How the replay works</h2>
            <p>
              Each {setup.unit}, that {setup.unit}&rsquo;s arrivals join the first step. Steps are served from the last
              back to the first, oldest work first, each up to its capacity. An item moves at most one step per{" "}
              {setup.unit}, so a line of {setup.line.stages.length} steps takes at least {setup.line.stages.length}{" "}
              {unitPlural} end to end. With a WIP limit, a step stops passing work on while the next step already has
              that many waiting.
            </p>
            <p>
              The backlog is the work that was ready to move and couldn&rsquo;t. The bottleneck in a {setup.unit} is
              the step that left the most of it, and the step that limits flow is the one that was the bottleneck most
              often. The +1 rows are not estimates: each is the whole replay run again.
            </p>
            <p>
              Capacity should be measured, not hoped for: count what each step actually finished on a busy{" "}
              {setup.unit}. The model assumes every item passes every step and that capacity is the same every{" "}
              {setup.unit}, weekends included.
            </p>
            <p className="keys">
              <kbd>Space</kbd> plays or pauses. <kbd>←</kbd> <kbd>→</kbd> step one {setup.unit}.
            </p>
          </section>
          <section className="panel" id="example-source" aria-labelledby="source-title">
            <h2 id="source-title">Where the example comes from</h2>
            <p>
              The arrivals are the purchase-order lines created each day of 2018 in the CAPEX &amp; SOCS spend area of
              the BPI Challenge 2019 event log from a coatings and paints company: B. F. van Dongen, 4TU.ResearchData,{" "}
              <a href="https://doi.org/10.4121/uuid:d06aff4b-79f0-45e6-8ec8-e19730c248f1">
                doi:10.4121/uuid:d06aff4b-79f0-45e6-8ec8-e19730c248f1
              </a>
              , licensed{" "}
              <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>.
            </p>
            <p>
              The three steps are the log&rsquo;s goods receipt, invoice receipt and invoice clearing. Each
              capacity is that activity&rsquo;s 90th-percentile daily count on the days it ran. Queueglass changed the
              data by counting events per day; the{" "}
              <a href="https://github.com/fortunexbt/queueglass/blob/main/scripts/derive-bpi2019.mjs">
                derivation script
              </a>{" "}
              and the derived CSV are in the repository.
            </p>
            <h2 id="privacy-title">Your data</h2>
            <p>
              Your steps and arrivals are replayed in this tab. The share link keeps them after the #, which browsers
              do not send to any server, so the link itself is the only copy.
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
