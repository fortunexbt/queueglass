"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { SCENARIOS, createSimulation, getSnapshot, hashSeed, normalizeSeed, stepSimulation } from "@/lib/simulation.js";

type SimulationState = ReturnType<typeof createSimulation>;
type ScenarioId = keyof typeof SCENARIOS;

declare global {
  interface Window {
    render_game_to_text?: () => string;
    advanceTime?: (ms: number) => void;
  }
}

const TICK_MS = 600;
const DEFAULT_SEED = "QUEUEGLASS-7";
const PROVENANCE =
  "All values are generated locally by a deterministic toy model. No production telemetry, identity records, external services, benchmarks, monetary estimates, or observed operational results are used.";

interface SimulatorLabProps {
  initialSeed?: string;
  initialScenario?: ScenarioId;
}

function drawTopology(canvas: HTMLCanvasElement, state: SimulationState) {
  const context = canvas.getContext("2d");
  if (!context) return;
  const width = canvas.width;
  const height = canvas.height;
  const stageX = [145, 415, 685, 955];
  const centerY = 225;

  const background = context.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, "#07131f");
  background.addColorStop(0.55, "#0b1623");
  background.addColorStop(1, "#101628");
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  context.save();
  context.strokeStyle = "rgba(135, 177, 195, 0.07)";
  context.lineWidth = 1;
  for (let x = 20; x < width; x += 40) {
    context.beginPath();
    context.moveTo(x + 0.5, 0);
    context.lineTo(x + 0.5, height);
    context.stroke();
  }
  for (let y = 20; y < height; y += 40) {
    context.beginPath();
    context.moveTo(0, y + 0.5);
    context.lineTo(width, y + 0.5);
    context.stroke();
  }
  context.restore();

  context.fillStyle = "#d7f7ee";
  context.font = "700 18px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.fillText("SIMULATED TOPOLOGY", 34, 42);
  context.fillStyle = "rgba(215, 247, 238, 0.58)";
  context.font = "500 13px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.fillText(`SEED ${state.seed}  /  ${SCENARIOS[state.scenarioId].label.toUpperCase()}  /  TICK ${state.tick}`, 34, 66);

  context.lineCap = "round";
  for (let index = 0; index < stageX.length - 1; index += 1) {
    context.strokeStyle = "rgba(89, 232, 190, 0.16)";
    context.lineWidth = 14;
    context.beginPath();
    context.moveTo(stageX[index] + 84, centerY);
    context.lineTo(stageX[index + 1] - 84, centerY);
    context.stroke();
    context.strokeStyle = "rgba(89, 232, 190, 0.54)";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(stageX[index] + 84, centerY);
    context.lineTo(stageX[index + 1] - 84, centerY);
    context.stroke();
  }

  state.stages.forEach((stage, index) => {
    const x = stageX[index];
    const constrained = stage.status === "constrained";
    context.save();
    context.shadowColor = constrained ? "rgba(255, 177, 92, 0.55)" : "rgba(89, 232, 190, 0.38)";
    context.shadowBlur = 24;
    context.fillStyle = constrained ? "#2a1d18" : "#0d2627";
    context.strokeStyle = constrained ? "#ffb15c" : "#59e8be";
    context.lineWidth = 2;
    context.beginPath();
    context.roundRect(x - 84, centerY - 76, 168, 152, 18);
    context.fill();
    context.stroke();
    context.restore();

    context.fillStyle = "#edfdf8";
    context.font = "700 15px ui-monospace, SFMono-Regular, Menlo, monospace";
    context.textAlign = "center";
    context.fillText(`${index + 1}. ${stage.label.toUpperCase()}`, x, centerY - 36);
    context.fillStyle = constrained ? "#ffcc8e" : "#8debd0";
    context.font = "800 30px ui-monospace, SFMono-Regular, Menlo, monospace";
    context.fillText(String(stage.waiting), x, centerY + 8);
    context.fillStyle = "rgba(237, 253, 248, 0.58)";
    context.font = "500 11px ui-monospace, SFMono-Regular, Menlo, monospace";
    context.fillText("QUEUED", x, centerY + 28);
    context.fillText(`CAP ${stage.capacity} / MOVED ${stage.handled}`, x, centerY + 52);
  });

  const visibleWork = state.queue.slice(0, 20);
  visibleWork.forEach((item, index) => {
    const x = stageX[item.stage] + ((index % 5) - 2) * 18;
    const y = centerY + 102 + Math.floor(index / 5) * 16;
    context.fillStyle = item.retries > 0 ? "#ffb15c" : "#59e8be";
    context.beginPath();
    context.arc(x, y, 4 + item.priority * 0.7, 0, Math.PI * 2);
    context.fill();
  });

  context.textAlign = "left";
  context.fillStyle = "rgba(237, 253, 248, 0.54)";
  context.font = "500 12px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.fillText("Dots represent synthetic work items. Counts and capacities are model units, not measured throughput.", 34, height - 28);
}

export default function SimulatorLab({ initialSeed = DEFAULT_SEED, initialScenario = "nominal" }: SimulatorLabProps) {
  const normalizedInitialSeed = normalizeSeed(initialSeed);
  const [simulation, setSimulation] = useState(() => createSimulation(normalizedInitialSeed, initialScenario));
  const simulationRef = useRef(simulation);
  const [seedDraft, setSeedDraft] = useState(normalizedInitialSeed);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState("Replay ready. Advance the model to generate synthetic work.");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const virtualRemainderRef = useRef(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labRef = useRef<HTMLElement>(null);

  const replaceSimulation = useCallback((next: SimulationState) => {
    simulationRef.current = next;
    setSimulation(next);
  }, []);

  const advance = useCallback(
    (count: number) => {
      replaceSimulation(stepSimulation(simulationRef.current, count));
    },
    [replaceSimulation],
  );

  const reset = useCallback(
    (seed = seedDraft, scenario: ScenarioId = simulationRef.current.scenarioId) => {
      const normalized = normalizeSeed(seed);
      setSeedDraft(normalized);
      virtualRemainderRef.current = 0;
      replaceSimulation(createSimulation(normalized, scenario));
      setRunning(false);
      setNotice(`Replay reset to ${normalized}.`);
    },
    [replaceSimulation, seedDraft],
  );

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("seed", simulation.seed);
    url.searchParams.set("scenario", simulation.scenarioId);
    window.history.replaceState({}, "", url);
  }, [simulation.seed, simulation.scenarioId]);

  useEffect(() => {
    if (!running) return undefined;
    const interval = window.setInterval(() => advance(1), TICK_MS);
    return () => window.clearInterval(interval);
  }, [advance, running]);

  useEffect(() => {
    if (canvasRef.current) drawTopology(canvasRef.current, simulation);
  }, [simulation]);

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
        coordinateSystem: "topology canvas pixels; origin top-left; +x right; +y down; 1100x430",
        running,
        ...getSnapshot(simulationRef.current),
      });
    window.advanceTime = (ms: number) => {
      virtualRemainderRef.current += Math.max(0, Number(ms) || 0);
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
  }, [advance, running]);

  useEffect(() => {
    const onFullscreen = () => setIsFullscreen(Boolean(document.fullscreenElement));
    const onKeyDown = (event: KeyboardEvent) => {
      const editing = event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement;
      if (editing) return;
      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        if (document.fullscreenElement) void document.exitFullscreen();
        else if (labRef.current) void labRef.current.requestFullscreen();
      }
      if (event.key === "Escape" && document.fullscreenElement) void document.exitFullscreen();
      if (event.code === "Space") {
        event.preventDefault();
        setRunning((value) => !value);
      }
    };
    document.addEventListener("fullscreenchange", onFullscreen);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreen);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const snapshot = getSnapshot(simulation);
  const deriveSeed = () => {
    const derived = `LAB-${hashSeed(`${simulation.seed}:${simulation.tick}`).toString(36).toUpperCase()}`;
    reset(derived, simulation.scenarioId);
  };

  const copyReplay = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setNotice("Replay URL copied. The seed and scenario reproduce the same run.");
    } catch {
      setNotice("Clipboard access was blocked; copy the URL from the address bar.");
    }
  };

  const toggleFullscreen = async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (labRef.current) await labRef.current.requestFullscreen();
  };

  return (
    <main ref={labRef} className="lab-shell">
      <a className="skip-link" href="#controls">Skip to simulator controls</a>
      <header className="hero">
        <div className="eyebrow-row">
          <span className="truth-badge">SIMULATED</span>
          <span className="local-badge">LOCAL · SEEDED · REPLAYABLE</span>
        </div>
        <div className="hero-grid">
          <div>
        <p className="overline">QUEUEGLASS / DISCRETE EVENT MODEL</p>
            <h1>Stress a control plane.<br />Replay every decision.</h1>
          </div>
          <p className="hero-copy">
            A deterministic browser laboratory for studying queue pressure, stage capacity, retries, and recovery—without pretending synthetic values are operational telemetry.
          </p>
        </div>
      </header>

      <section className="truth-panel" aria-labelledby="truth-title">
        <div>
          <p className="panel-kicker">PROVENANCE / READ THIS FIRST</p>
          <h2 id="truth-title">This is a model, not a monitored system.</h2>
        </div>
        <p>{PROVENANCE}</p>
        <ul>
          <li>Capacity, compute, and latency are arbitrary simulation units.</li>
          <li>Results are not benchmarks, forecasts, service levels, or architecture claims.</li>
          <li>The model contains no AI inference, external services, people, accounts, or production events.</li>
        </ul>
      </section>

      <section id="controls" className="control-panel" aria-label="Simulator controls">
        <label className="seed-control">
          <span>Replay seed</span>
          <input value={seedDraft} onChange={(event) => setSeedDraft(event.target.value)} maxLength={32} spellCheck={false} />
        </label>
        <button id="apply-seed" type="button" onClick={() => reset()}>Apply seed</button>
        <button id="derive-seed" type="button" onClick={deriveSeed}>Derive seed</button>
        <button id="advance-1" className="primary" type="button" onClick={() => advance(1)}>Advance 1 tick</button>
        <button id="advance-10" className="primary" type="button" onClick={() => advance(10)}>Advance 10</button>
        <button id="toggle-run" type="button" aria-pressed={running} onClick={() => setRunning((value) => !value)}>
          {running ? "Pause auto-run" : "Auto-run"}
        </button>
        <button id="reset-replay" type="button" onClick={() => reset(simulation.seed, simulation.scenarioId)}>Reset replay</button>
        <button id="copy-replay" type="button" onClick={copyReplay}>Copy replay URL</button>
        <button id="toggle-fullscreen" type="button" aria-pressed={isFullscreen} onClick={toggleFullscreen}>{isFullscreen ? "Exit fullscreen" : "Fullscreen"}</button>
      </section>
      <p className="status-line" role="status" aria-live="polite">{notice} Space toggles auto-run; F toggles fullscreen.</p>

      <section className="scenario-grid" aria-label="Synthetic scenarios">
        {Object.values(SCENARIOS).map((scenario) => (
          <button
            type="button"
            key={scenario.id}
            id={`scenario-${scenario.id}`}
            className={`scenario-card ${simulation.scenarioId === scenario.id ? "selected" : ""}`}
            aria-pressed={simulation.scenarioId === scenario.id}
            onClick={() => reset(simulation.seed, scenario.id as ScenarioId)}
          >
            <span>SIMULATED SCENARIO</span>
            <strong>{scenario.label}</strong>
            <small>{scenario.summary}</small>
          </button>
        ))}
      </section>

      <section className="topology-panel" aria-labelledby="topology-title">
        <div className="section-heading">
          <div>
            <p className="panel-kicker">CURRENT REPLAY</p>
            <h2 id="topology-title">Synthetic stage topology</h2>
          </div>
          <div className="tick-readout"><span>TICK</span>{snapshot.tick}</div>
        </div>
        <canvas ref={canvasRef} width="1100" height="430" aria-label="Simulated four-stage queue topology" />
      </section>

      <section className="metric-grid" aria-label="Synthetic metrics">
        {[
          ["Synthetic arrivals", snapshot.metrics.syntheticArrivals, "generated items"],
          ["Completed in model", snapshot.metrics.syntheticCompleted, "model completions"],
          ["Current queue", snapshot.metrics.queueDepth, "items in model"],
          ["Mean sojourn", snapshot.metrics.meanSojournTicks, "simulation ticks"],
          ["Retry decisions", snapshot.metrics.retryDecisions, "synthetic retries"],
          ["Compute units", snapshot.metrics.computeUnits, "arbitrary units"],
        ].map(([label, value, unit]) => (
          <article className="metric-card" key={label}>
            <span className="mini-badge">SIMULATED</span>
            <strong>{value}</strong>
            <h3>{label}</h3>
            <p>{unit}</p>
          </article>
        ))}
      </section>

      <section className="lower-grid">
        <article className="data-panel">
          <div className="section-heading compact">
            <div><p className="panel-kicker">MODEL STATE</p><h2>Stage ledger</h2></div>
          </div>
          <div className="stage-list">
            {snapshot.stages.map((stage, index) => (
              <div className="stage-row" key={stage.id}>
                <span className="stage-index">0{index + 1}</span>
                <div><strong>{stage.label}</strong><small>{stage.status}</small></div>
                <dl><div><dt>capacity</dt><dd>{stage.capacity}</dd></div><div><dt>queued</dt><dd>{stage.waiting}</dd></div><div><dt>moved</dt><dd>{stage.handled}</dd></div></dl>
              </div>
            ))}
          </div>
        </article>

        <article className="data-panel">
          <div className="section-heading compact">
            <div><p className="panel-kicker">SYNTHETIC EVENT LOG</p><h2>Recent decisions</h2></div>
          </div>
          <ol className="event-list">
            {snapshot.events.map((event, index) => (
              <li key={`${event.tick}-${event.kind}-${index}`}><span>T{String(event.tick).padStart(3, "0")}</span><div><b>{event.kind}</b><p>{event.message}</p></div></li>
            ))}
          </ol>
        </article>
      </section>

      <footer>
        <p><strong>Queueglass</strong> is an educational simulator. Inspect the deterministic core and its invariants before drawing conclusions.</p>
        <div><span>NO NETWORK</span><span>NO PRODUCTION DATA</span><span>NO PERFORMANCE CLAIMS</span></div>
      </footer>
    </main>
  );
}
