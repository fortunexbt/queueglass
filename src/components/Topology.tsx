import type { createSimulation } from "@/lib/simulation.js";

import styles from "./Topology.module.css";

type SimulationState = ReturnType<typeof createSimulation>;

interface TopologyProps {
  stages: SimulationState["stages"];
  selectedStage: string;
  onSelectStage: (id: string) => void;
  running: boolean;
}

export const STEP_NAMES: Record<string, string> = {
  intake: "Receive",
  classify: "Sort",
  policy: "Check",
  dispatch: "Finish",
};

export default function Topology({
  stages,
  selectedStage,
  onSelectStage,
  running,
}: TopologyProps) {
  return (
    <div className={`pipeline-topology ${styles.topology}`}>
      <ol
        className={styles.pipeline}
        aria-label="The four steps work passes through"
      >
        {stages.map((stage, index) => {
          const visibleWork = Array.from({
            length: Math.min(stage.waiting, 8),
          });
          const name = STEP_NAMES[stage.id] ?? stage.label;

          return (
            <li className={styles.stageSlot} key={stage.id}>
              <button
                className={styles.stage}
                type="button"
                id={`stage-${stage.id}`}
                aria-pressed={selectedStage === stage.id}
                aria-expanded={selectedStage === stage.id}
                aria-controls={
                  selectedStage === stage.id ? "stage-inspector" : undefined
                }
                aria-label={`${name} (${stage.label}): ${stage.waiting} waiting, ${stage.handled} moved this tick, capacity ${stage.capacity} per tick. ${stage.status}. Inspect step.`}
                data-waiting={stage.waiting > 0}
                onClick={() => onSelectStage(stage.id)}
              >
                <span className={styles.stageName}>{name}</span>

                <span className={styles.queueVisual} aria-hidden="true">
                  {visibleWork.length > 0 ? (
                    <span className={styles.slips}>
                      {visibleWork.map((_, slipIndex) => (
                        <span className={styles.slip} key={slipIndex} />
                      ))}
                    </span>
                  ) : (
                    <span className={styles.emptySymbol} />
                  )}
                </span>

                <span className={styles.queueMetric}>
                  <span
                    className={
                      stage.waiting > 0 ? styles.queueCount : styles.clearLabel
                    }
                  >
                    {stage.waiting > 0 ? stage.waiting : "Clear"}
                  </span>
                  <span className={styles.waitingLabel}>
                    {stage.waiting > 0 ? "waiting" : "0 waiting"}
                  </span>
                </span>

                <span className={styles.capacity}>
                  Up to {stage.capacity} per tick
                </span>
              </button>

              {index < stages.length - 1 && (
                <span className={styles.connector} aria-hidden="true">
                  <svg viewBox="0 0 56 12" preserveAspectRatio="none">
                    <path d="M0 6H54M49 1L54 6L49 11" />
                    {running && stage.handled > 0 && (
                      <path className={styles.flowMark} d="M0 6H4" />
                    )}
                  </svg>
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
