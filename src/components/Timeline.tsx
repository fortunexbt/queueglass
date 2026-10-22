import { useId, useRef, useState } from "react";

import type { Frame } from "@/lib/simulation.js";
import styles from "./Timeline.module.css";

// Lane geometry in viewBox units: x is the period, y runs 0..LANE with a marker strip below
// the baseline for bottleneck and blocked periods.
const LANE = 40;
const BASE = 33;

// About six round-numbered axis marks, whatever the run length.
function axisMarks(last: number) {
  const raw = last / 6;
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  const step = [1, 2, 5, 10].map((factor) => factor * magnitude).find((value) => value >= raw) ?? raw;
  const marks = [];
  for (let period = 0; period <= last; period += step) marks.push(period);
  return marks;
}

export default function Timeline({
  frames,
  tick,
  window,
  label,
  axisLabel,
  onSeek,
}: {
  frames: Frame[];
  tick: number;
  window: { from: number; to: number; label: string } | null;
  label: (period: number) => string;
  axisLabel: (period: number) => string;
  onSeek: (tick: number) => void;
}) {
  const clipBase = useId().replace(/[^\w-]/g, "");
  const plotRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [tableOpen, setTableOpen] = useState(false);
  const last = frames.length - 1;
  const names = frames[0].stages.map((stage) => stage.name);
  const peak = Math.max(4, ...frames.flatMap((frame) => frame.stages.map((stage) => stage.waiting)));
  const yMax = Math.ceil(peak / 4) * 4;
  const y = (value: number) => BASE - (value / yMax) * (BASE - 3);
  const at = (period: number) => `calc(var(--pad) + (100% - 2 * var(--pad)) * ${period / last})`;

  const tickAt = (clientX: number) => {
    const plot = plotRef.current;
    if (!plot) return 0;
    const pad = parseFloat(getComputedStyle(plot).getPropertyValue("--pad"));
    const rect = plot.getBoundingClientRect();
    const ratio = (clientX - rect.left - pad) / (rect.width - 2 * pad);
    return Math.max(0, Math.min(last, Math.round(ratio * last)));
  };

  const shown = hover ?? tick;
  const hoverFrame = hover === null ? null : frames[hover];
  const bottleneckName = (frame: Frame) => (frame.bottleneck === -1 ? null : names[frame.bottleneck]);

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
          <i className={styles.keyBlocked} /> Blocked by the WIP limit
        </span>
        {window && (
          <span>
            <i className={styles.keyWindow} /> {window.label}
          </span>
        )}
      </div>
      <div className={styles.grid}>
        <ul className={styles.labels} aria-hidden="true">
          {names.map((name, index) => (
            <li key={index}>
              <span>{name}</span>
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
                width: `calc((100% - 2 * var(--pad)) * ${(window.to - window.from + 1) / last})`,
              }}
            />
          )}
          {names.map((name, index) => {
            const points = frames.map((frame) => `${frame.period},${y(frame.stages[index].waiting).toFixed(2)}`);
            const line = `M${points.join("L")}`;
            const area = `M0,${BASE}L${points.join("L")}L${last},${BASE}Z`;
            const clip = `${clipBase}-lane${index}`;
            return (
              <svg
                key={index}
                className={styles.lane}
                viewBox={`0 0 ${last} ${LANE}`}
                preserveAspectRatio="none"
              >
                <clipPath id={clip}>
                  <rect x="-1" y="0" width={tick + 1} height={LANE} />
                </clipPath>
                <line className={styles.baseline} x1="0" x2={last} y1={BASE} y2={BASE} />
                <path className={styles.futureArea} d={area} />
                <path className={styles.futureLine} d={line} />
                <g clipPath={`url(#${clip})`}>
                  <path className={styles.area} d={area} />
                  <path className={styles.line} d={line} />
                </g>
                {frames.map((frame) => {
                  const kind =
                    frame.bottleneck === index
                      ? styles.markBottleneck
                      : frame.stages[index].blocked
                        ? styles.markBlocked
                        : null;
                  return (
                    kind && (
                      <rect
                        key={frame.period}
                        className={kind}
                        data-future={frame.period > tick || undefined}
                        x={frame.period - 0.5}
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
              <span className={styles.crosshair} style={{ left: at(hoverFrame.period) }} />
              <div
                className={styles.tooltip}
                data-flip={hoverFrame.period > last * 0.6 || undefined}
                style={{ left: at(hoverFrame.period) }}
              >
                <strong>{label(hoverFrame.period)}</strong>
                {hoverFrame.stages.map((stage, index) => (
                  <span key={index}>
                    <b>{stage.waiting}</b> waiting at {stage.name}
                  </span>
                ))}
                <span className={styles.tooltipNote}>
                  {bottleneckName(hoverFrame) ? `Bottleneck: ${bottleneckName(hoverFrame)}` : "No bottleneck"}
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
            max={last}
            step={1}
            value={tick}
            aria-label="Replay position"
            aria-valuetext={label(tick)}
            onChange={(event) => onSeek(Number(event.target.value))}
          />
          <div className={styles.axis} aria-hidden="true">
            {axisMarks(last).map((value) => (
              <span key={value} style={{ left: at(value) }}>
                {axisLabel(value)}
              </span>
            ))}
          </div>
        </div>
      </div>
      <details className={styles.table} onToggle={(event) => setTableOpen(event.currentTarget.open)}>
        <summary>Show every period as a table</summary>
        {tableOpen && (
          <div className={styles.tableScroll}>
            <table>
              <caption className="sr-only">Replayed values at the end of each period</caption>
              <thead>
                <tr>
                  <th scope="col">Period</th>
                  <th scope="col">Arrived</th>
                  <th scope="col">Finished</th>
                  {names.map((name, index) => (
                    <th scope="col" key={index}>
                      {name} waiting
                    </th>
                  ))}
                  <th scope="col">Bottleneck</th>
                </tr>
              </thead>
              <tbody>
                {frames.map((frame) => (
                  <tr key={frame.period} data-current={frame.period === tick || undefined}>
                    <th scope="row">{label(frame.period)}</th>
                    <td>{frame.arrived}</td>
                    <td>{frame.finished}</td>
                    {frame.stages.map((stage, index) => (
                      <td key={index}>
                        {stage.waiting}
                        {stage.blocked ? " (blocked)" : ""}
                      </td>
                    ))}
                    <td>{bottleneckName(frame) ?? "None"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>
    </div>
  );
}
