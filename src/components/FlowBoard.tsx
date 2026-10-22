import FlapText from "@/components/FlapText";
import {
  ARRIVAL_JITTER,
  CAPACITY_RANGE,
  STAGES,
  TRAFFIC_RANGE,
  type runSimulation,
} from "@/lib/simulation.js";
import styles from "./FlowBoard.module.css";

export type Frame = ReturnType<typeof runSimulation>[number];
type Stage = Frame["stages"][number];

const MAX_TILES = 24;
const MAX_DOTS = 6;

export function stageStatus(stage: Stage, isBottleneck: boolean) {
  if (isBottleneck) return { label: "Bottleneck", tone: "amber" } as const;
  if (stage.blocked) return { label: "Blocked", tone: "red" } as const;
  if (stage.faulted) return { label: "Slowed", tone: "red" } as const;
  if (stage.handled > 0) return { label: "Moving", tone: "green" } as const;
  return { label: "Idle", tone: undefined } as const;
}

function StepIcon({ plus }: { plus?: boolean }) {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
      <path d={plus ? "M2 6h8M6 2v8" : "M2 6h8"} />
    </svg>
  );
}

function Stepper({
  label,
  caption,
  value,
  range: [min, max],
  onChange,
}: {
  label: string;
  caption: string;
  value: number;
  range: readonly [number, number];
  onChange: (value: number) => void;
}) {
  return (
    <div className={styles.stepper} role="group" aria-label={label}>
      <span className={styles.stepperCaption}>{caption}</span>
      <button
        type="button"
        aria-label={`Lower ${label.toLowerCase()}`}
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
      >
        <StepIcon />
      </button>
      <output aria-live="polite">{value}</output>
      <button
        type="button"
        aria-label={`Raise ${label.toLowerCase()}`}
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
      >
        <StepIcon plus />
      </button>
    </div>
  );
}

// Dots that travel the rail during one tick: one per item that crossed it, capped.
function Rail({
  count,
  tick,
  animate,
  end,
}: {
  count: number;
  tick: number;
  animate: boolean;
  end?: "in" | "out";
}) {
  const dots = Math.min(count, MAX_DOTS);
  return (
    <div
      className={styles.rail}
      data-end={end}
      data-active={count > 0}
      aria-hidden="true"
    >
      <span className={styles.track} />
      {animate &&
        Array.from({ length: dots }, (_, index) => (
          <i
            key={`${tick}:${index}`}
            style={{ animationDelay: `calc(var(--tick) * ${(index / Math.max(dots, 1)) * 0.45})` }}
          />
        ))}
      {end && (
        <span className={styles.railCount}>
          {end === "in" ? `+${count}` : count}
          <small>{end === "in" ? "in" : "out"}</small>
        </span>
      )}
    </div>
  );
}

export default function FlowBoard({
  frame,
  traffic,
  capacities,
  animate,
  tickMs,
  onTraffic,
  onCapacity,
}: {
  frame: Frame;
  traffic: number;
  capacities: number[];
  animate: boolean;
  tickMs: number;
  onTraffic: (value: number) => void;
  onCapacity: (index: number, value: number) => void;
}) {
  const bottleneck = STAGES.findIndex((stage) => stage.id === frame.bottleneck);
  return (
    <div className={styles.board} style={{ "--tick": `${tickMs}ms` } as React.CSSProperties}>
      <div className={styles.boardHead}>
        <Stepper
          label="Arrivals per tick"
          caption={`Arrivals per tick, plus 0 to ${ARRIVAL_JITTER} random`}
          value={traffic}
          range={TRAFFIC_RANGE}
          onChange={onTraffic}
        />
        <p className={styles.boardKey}>
          <span className={styles.keyTile} aria-hidden="true" /> one waiting item
          <span className={styles.keySlot} aria-hidden="true" /> one item moved this tick
        </p>
      </div>
      <ol className={styles.flow} aria-label="The four steps work passes through">
        {frame.stages.map((stage, index) => {
          const status = stageStatus(stage, index === bottleneck);
          const configured = capacities[index];
          return (
            <li className={styles.slot} key={stage.id}>
              <Rail
                count={index === 0 ? frame.arrived : frame.stages[index - 1].handled}
                tick={frame.tick}
                animate={animate}
                end={index === 0 ? "in" : undefined}
              />
              <section
                className={styles.stage}
                data-status={status.label.toLowerCase()}
                aria-label={`${stage.label}: ${status.label}. ${stage.waiting} waiting, moved ${stage.handled} of ${stage.capacity} this tick.`}
                id={`stage-${stage.id}`}
              >
                <header className={styles.stageHead}>
                  <h3>{stage.label}</h3>
                  <FlapText value={status.label.toUpperCase()} tone={status.tone} size="sm" />
                </header>
                <div className={styles.queue}>
                  <span className={styles.count}>
                    <FlapText value={String(stage.waiting).padStart(2, "0")} size="lg" />
                    <span>waiting</span>
                  </span>
                  <span className={styles.pile} aria-hidden="true">
                    {Array.from({ length: Math.min(stage.waiting, MAX_TILES) }, (_, tile) => (
                      <i key={tile} />
                    ))}
                    {stage.waiting > MAX_TILES && (
                      <b className={styles.more}>+{stage.waiting - MAX_TILES}</b>
                    )}
                  </span>
                </div>
                <div className={styles.capacity}>
                  <span className={styles.cells} aria-hidden="true">
                    {Array.from({ length: configured }, (_, cell) => (
                      <i
                        key={cell}
                        data-state={
                          cell < stage.handled ? "moved" : cell >= stage.capacity ? "lost" : undefined
                        }
                      />
                    ))}
                  </span>
                  <span className={styles.capacityText}>
                    {stage.handled} of {stage.capacity} moved
                    {stage.faulted && stage.capacity < configured ? `, slowed from ${configured}` : ""}
                  </span>
                </div>
                <Stepper
                  label={`${stage.label} capacity`}
                  caption="Capacity"
                  value={configured}
                  range={CAPACITY_RANGE}
                  onChange={(value) => onCapacity(index, value)}
                />
              </section>
              {index === frame.stages.length - 1 && (
                <Rail count={stage.handled} tick={frame.tick} animate={animate} end="out" />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
