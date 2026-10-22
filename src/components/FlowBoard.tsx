import type { Frame } from "@/lib/simulation.js";
import styles from "./FlowBoard.module.css";

type Stage = Frame["stages"][number];

const MAX_TILES = 24;
const MAX_DOTS = 6;

export function stageStatus(stage: Stage, isBottleneck: boolean) {
  if (isBottleneck) return { label: "Bottleneck", tone: "amber" } as const;
  if (stage.blocked) return { label: "Blocked", tone: "red" } as const;
  if (stage.handled > 0) return { label: "Moving", tone: "green" } as const;
  return { label: "Idle", tone: undefined } as const;
}

// Dots that travel the rail during one period: one per item that crossed it, capped.
function Rail({
  count,
  period,
  animate,
  end,
}: {
  count: number;
  period: number;
  animate: boolean;
  end?: "in" | "out";
}) {
  const dots = Math.min(count, MAX_DOTS);
  return (
    <div className={styles.rail} data-end={end} data-active={count > 0} aria-hidden="true">
      <span className={styles.track} />
      {animate &&
        Array.from({ length: dots }, (_, index) => (
          <i
            key={`${period}:${index}`}
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
  unit,
  animate,
  tickMs,
}: {
  frame: Frame;
  unit: string;
  animate: boolean;
  tickMs: number;
}) {
  return (
    <div
      className={styles.board}
      data-many={frame.stages.length > 4 || undefined}
      style={{ "--tick": `${tickMs}ms` } as React.CSSProperties}
    >
      <p className={styles.boardKey}>
        <span className={styles.keyTile} aria-hidden="true" /> one waiting item
        <span className={styles.keyMeter} aria-hidden="true" /> share of this {unit}&rsquo;s capacity used
      </p>
      <ol className={styles.flow} aria-label="The steps work passes through, in order">
        {frame.stages.map((stage, index) => {
          const status = stageStatus(stage, index === frame.bottleneck);
          return (
            <li className={styles.slot} key={index}>
              <Rail
                count={index === 0 ? frame.arrived : frame.stages[index - 1].handled}
                period={frame.period}
                animate={animate}
                end={index === 0 ? "in" : undefined}
              />
              <section
                id={`stage-${index}`}
                className={styles.stage}
                data-status={status.label.toLowerCase()}
                aria-label={`${stage.name}: ${status.label}. ${stage.waiting} waiting, moved ${stage.handled} of ${stage.capacity}.`}
              >
                <header className={styles.stageHead}>
                  <h3>{stage.name}</h3>
                  <span className={styles.status} data-tone={status.tone}>
                    {status.label}
                  </span>
                </header>
                <div className={styles.queue}>
                  <span className={styles.count}>
                    <b>{stage.waiting}</b>
                    <span>waiting</span>
                  </span>
                  <span className={styles.pile} aria-hidden="true">
                    {Array.from({ length: Math.min(stage.waiting, MAX_TILES) }, (_, tile) => (
                      <i key={tile} />
                    ))}
                    {stage.waiting > MAX_TILES && <b className={styles.more}>+{stage.waiting - MAX_TILES}</b>}
                  </span>
                </div>
                <div className={styles.capacity}>
                  <span className={styles.meter} data-blocked={stage.blocked || undefined} aria-hidden="true">
                    <i style={{ width: `${(stage.handled / stage.capacity) * 100}%` }} />
                  </span>
                  <span className={styles.capacityText}>
                    {stage.handled} of {stage.capacity} moved
                  </span>
                </div>
              </section>
              {index === frame.stages.length - 1 && (
                <Rail count={stage.handled} period={frame.period} animate={animate} end="out" />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
