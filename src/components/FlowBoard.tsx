import type { Frame } from "@/lib/simulation.js";
import styles from "./FlowBoard.module.css";

type Stage = Frame["stages"][number];

const MAX_TILES = 160;
const MAX_DOTS = 6;

export function stageStatus(stage: Stage, isBottleneck: boolean) {
  if (isBottleneck) return { label: "Bottleneck", tone: "hazard" } as const;
  if (stage.blocked) return { label: "Blocked", tone: "stop" } as const;
  if (stage.handled > 0) return { label: "Moving", tone: "go" } as const;
  return { label: "Idle", tone: undefined } as const;
}

// The belt between two steps. Dots travel it during one period: one per item that crossed, capped.
function Belt({
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
    <div className={styles.belt} data-end={end} data-active={count > 0} aria-hidden="true">
      <span className={styles.track} />
      {animate &&
        Array.from({ length: dots }, (_, index) => (
          <i
            key={`${period}:${index}`}
            style={{ animationDelay: `calc(var(--tick) * ${(index / Math.max(dots, 1)) * 0.45})` }}
          />
        ))}
      <span className={styles.beltCount}>{end === "out" ? `${count} out` : end === "in" ? `${count} in` : count}</span>
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
      <ol className={styles.flow} aria-label="The steps work passes through, in order">
        {frame.stages.map((stage, index) => {
          const status = stageStatus(stage, index === frame.bottleneck);
          const shown = Math.min(stage.waiting, MAX_TILES);
          // Held items were ready this period and could not move. The rest were passed in by the
          // step before after this one had served, so they are ready next period. Held work is
          // older, so it sits at the bottom of the pile.
          const held = Math.min(stage.leftover, shown);
          return (
            <li className={styles.slot} key={index}>
              <Belt
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
                <div className={styles.glass} aria-hidden="true">
                  <span className={styles.pile}>
                    {Array.from({ length: shown }, (_, tile) => (
                      <i key={tile} data-held={tile < held || undefined} />
                    ))}
                  </span>
                  {stage.waiting > MAX_TILES && (
                    <span className={styles.more}>+{(stage.waiting - MAX_TILES).toLocaleString("en-GB")} not drawn</span>
                  )}
                </div>
                <p className={styles.readout}>
                  <span>
                    <b>{stage.waiting.toLocaleString("en-GB")}</b> waiting
                    {stage.leftover > 0 && <>, {stage.leftover.toLocaleString("en-GB")} held back</>}
                  </span>
                  <span className={styles.gauge}>
                    <span className={styles.meter} data-blocked={stage.blocked || undefined}>
                      <i style={{ width: `${(stage.handled / stage.capacity) * 100}%` }} />
                    </span>
                    {stage.handled} of {stage.capacity} moved this {unit}
                  </span>
                </p>
              </section>
              {index === frame.stages.length - 1 && (
                <Belt count={stage.handled} period={frame.period} animate={animate} end="out" />
              )}
            </li>
          );
        })}
      </ol>
      <p className={styles.key}>
        <span>
          <i data-held aria-hidden="true" /> was ready this {unit} and could not move
        </span>
        <span>
          <i aria-hidden="true" /> moved in this {unit}, ready the next
        </span>
      </p>
    </div>
  );
}
