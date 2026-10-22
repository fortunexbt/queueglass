import { useId, useRef, useState } from "react";

import type { Frame } from "@/components/FlowBoard";
import { RUN_LENGTH, SCENARIOS, STAGES } from "@/lib/simulation.js";
import styles from "./Timeline.module.css";

type ScenarioId = keyof typeof SCENARIOS;

// Lane geometry in viewBox units: x is the tick, y runs 0..LANE with a marker strip below
// the baseline for bottleneck and blocked ticks.
const LANE = 40;
const BASE = 33;
const AXIS = [0, 10, 20, 30, 40, 50, 60];

const at = (tick: number) =>
  `calc(var(--pad) + (100% - 2 * var(--pad)) * ${tick / RUN_LENGTH})`;

export function scenarioWindow(scenarioId: ScenarioId) {
  const { burst, fault } = SCENARIOS[scenarioId];
  if (burst) return { from: burst.from, to: burst.to, label: "Burst" };
  if (fault)
    return { from: fault.from, to: fault.to, label: `${STAGES[fault.stage].label} slowed` };
  return null;
}

export default function Timeline({
  frames,
  tick,
  scenarioId,
  onSeek,
}: {
  frames: Frame[];
  tick: number;
  scenarioId: ScenarioId;
  onSeek: (tick: number) => void;
}) {
  const clipBase = useId().replace(/[^\w-]/g, "");
  const plotRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const peak = Math.max(4, ...frames.flatMap((frame) => frame.stages.map((stage) => stage.waiting)));
  const yMax = Math.ceil(peak / 4) * 4;
  const y = (value: number) => BASE - (value / yMax) * (BASE - 3);
  const window = scenarioWindow(scenarioId);

  const tickAt = (clientX: number) => {
    const plot = plotRef.current;
    if (!plot) return 0;
    const pad = parseFloat(getComputedStyle(plot).getPropertyValue("--pad"));
    const rect = plot.getBoundingClientRect();
    const ratio = (clientX - rect.left - pad) / (rect.width - 2 * pad);
    return Math.max(0, Math.min(RUN_LENGTH, Math.round(ratio * RUN_LENGTH)));
  };

  const shown = hover ?? tick;
  const hoverFrame = hover === null ? null : frames[hover];

  return (
    <div className={styles.timeline}>
      <div className={styles.legend} aria-hidden="true">
        <span>
          <i className={styles.keyArea} /> Items waiting
        </span>
        <span>
          <i className={styles.keyBottleneck} /> Bottleneck
        </span>
        <span>
          <i className={styles.keyBlocked} /> Blocked by a full buffer
        </span>
        {window && (
          <span>
            <i className={styles.keyWindow} /> {window.label}, ticks {window.from} to {window.to}
          </span>
        )}
      </div>
      <div className={styles.grid}>
        <ul className={styles.labels} aria-hidden="true">
          {STAGES.map((stage, index) => (
            <li key={stage.id}>
              <span>{stage.label}</span>
              <b>{frames[shown].stages[index].waiting}</b>
            </li>
          ))}
        </ul>
        <div
          ref={plotRef}
          className={styles.plot}
          aria-hidden="true"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            onSeek(tickAt(event.clientX));
          }}
          onPointerMove={(event) => {
            const next = tickAt(event.clientX);
            if (event.currentTarget.hasPointerCapture(event.pointerId)) onSeek(next);
            if (event.pointerType === "mouse") setHover(next);
          }}
          onPointerLeave={() => setHover(null)}
        >
          {window && (
            <span
              className={styles.window}
              style={{
                left: at(window.from - 0.5),
                width: `calc((100% - 2 * var(--pad)) * ${(window.to - window.from + 1) / RUN_LENGTH})`,
              }}
            />
          )}
          {STAGES.map((stage, index) => {
            const points = frames.map((frame) => `${frame.tick},${y(frame.stages[index].waiting).toFixed(2)}`);
            const line = `M${points.join("L")}`;
            const area = `M0,${BASE}L${points.join("L")}L${RUN_LENGTH},${BASE}Z`;
            const clip = `${clipBase}-lane${index}`;
            return (
              <svg
                key={stage.id}
                className={styles.lane}
                viewBox={`0 0 ${RUN_LENGTH} ${LANE}`}
                preserveAspectRatio="none"
              >
                <clipPath id={clip}>
                  <rect x="-1" y="0" width={tick + 1} height={LANE} />
                </clipPath>
                <line className={styles.baseline} x1="0" x2={RUN_LENGTH} y1={BASE} y2={BASE} />
                <path className={styles.futureArea} d={area} />
                <path className={styles.futureLine} d={line} />
                <g clipPath={`url(#${clip})`}>
                  <path className={styles.area} d={area} />
                  <path className={styles.line} d={line} />
                </g>
                {frames.map((frame) => {
                  const kind =
                    frame.bottleneck === stage.id
                      ? styles.markBottleneck
                      : frame.stages[index].blocked
                        ? styles.markBlocked
                        : null;
                  return (
                    kind && (
                      <rect
                        key={frame.tick}
                        className={kind}
                        data-future={frame.tick > tick || undefined}
                        x={frame.tick - 0.5}
                        y={BASE + 2}
                        width="1"
                        height={LANE - BASE - 3}
                      />
                    )
                  );
                })}
              </svg>
            );
          })}
          <span className={styles.playhead} style={{ left: at(tick) }} />
          {hoverFrame && (
            <>
              <span className={styles.crosshair} style={{ left: at(hoverFrame.tick) }} />
              <div
                className={styles.tooltip}
                data-flip={hoverFrame.tick > RUN_LENGTH * 0.6 || undefined}
                style={{ left: at(hoverFrame.tick) }}
              >
                <strong>Tick {hoverFrame.tick}</strong>
                {hoverFrame.stages.map((stage) => (
                  <span key={stage.id}>
                    <b>{stage.waiting}</b> waiting at {stage.label}
                  </span>
                ))}
                <span className={styles.tooltipNote}>
                  {hoverFrame.bottleneck
                    ? `Bottleneck: ${STAGES.find((stage) => stage.id === hoverFrame.bottleneck)?.label}`
                    : "No bottleneck"}
                </span>
              </div>
            </>
          )}
        </div>
        <span className={styles.scaleNote}>0 to {yMax} items per lane</span>
        <div className={styles.scrub}>
          <input
            id="timeline-scrubber"
            type="range"
            min={0}
            max={RUN_LENGTH}
            step={1}
            value={tick}
            aria-label="Replay position"
            aria-valuetext={`Tick ${tick} of ${RUN_LENGTH}`}
            onChange={(event) => onSeek(Number(event.target.value))}
          />
          <div className={styles.axis} aria-hidden="true">
            {AXIS.map((value) => (
              <span key={value} style={{ left: at(value) }}>
                {value}
              </span>
            ))}
          </div>
        </div>
      </div>
      <details className={styles.table}>
        <summary>Show every tick as a table</summary>
        <div className={styles.tableScroll}>
          <table>
            <caption className="sr-only">Simulated values at the end of each tick</caption>
            <thead>
              <tr>
                <th scope="col">Tick</th>
                <th scope="col">Arrived</th>
                <th scope="col">Finished</th>
                {STAGES.map((stage) => (
                  <th scope="col" key={stage.id}>
                    {stage.label} waiting
                  </th>
                ))}
                <th scope="col">Bottleneck</th>
              </tr>
            </thead>
            <tbody>
              {frames.map((frame) => (
                <tr key={frame.tick} data-current={frame.tick === tick || undefined}>
                  <th scope="row">{frame.tick}</th>
                  <td>{frame.arrived}</td>
                  <td>{frame.finished}</td>
                  {frame.stages.map((stage) => (
                    <td key={stage.id}>
                      {stage.waiting}
                      {stage.blocked ? " (blocked)" : ""}
                    </td>
                  ))}
                  <td>{STAGES.find((stage) => stage.id === frame.bottleneck)?.label ?? "None"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
