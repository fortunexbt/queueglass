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
        {stages.map((stage, index) => (
          <li className={styles.stageSlot} key={stage.id}>
            <button
              className={styles.stage}
              type="button"
              id={`stage-${stage.id}`}
              aria-expanded={selectedStage === stage.id}
              aria-controls={
                selectedStage === stage.id ? "stage-inspector" : undefined
              }
              aria-label={`${STEP_NAMES[stage.id]}: ${stage.handled} moved of ${stage.capacity} capacity this tick; ${stage.waiting} waiting. Inspect step.`}
              data-waiting={stage.waiting > 0}
              onClick={() => onSelectStage(stage.id)}
            >
              <span className={styles.stageName}>
                <span className={styles.stageNumber}>0{index + 1}</span>
                {STEP_NAMES[stage.id]}
                <svg
                  className={styles.disclosureArrow}
                  viewBox="0 0 12 12"
                  width="12"
                  height="12"
                  aria-hidden="true"
                >
                  <path d="m3 4 3 3 3-3" />
                </svg>
              </span>
              <span className={styles.processing}>
                <span className={styles.slots} aria-hidden="true">
                  {Array.from({ length: stage.capacity }, (_, slot) => (
                    <span
                      className={styles.slot}
                      data-filled={slot < stage.handled}
                      key={slot}
                    />
                  ))}
                </span>
                <span className={styles.movement} data-testid="stage-movement">
                  <b>{stage.handled}</b> of {stage.capacity} moved
                </span>
              </span>
              <span className={styles.queue}>
                <span className={styles.queueVisual} aria-hidden="true">
                  {stage.waiting ? (
                    <>
                      <span className={styles.slips}>
                        {Array.from(
                          { length: Math.min(stage.waiting, 8) },
                          (_, slip) => (
                            <span className={styles.slip} key={slip} />
                          ),
                        )}
                      </span>
                      {stage.waiting > 8 && (
                        <span className={styles.overflow}>
                          +{stage.waiting - 8}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className={styles.emptyQueue}>—</span>
                  )}
                </span>
                <span className={styles.waitingLabel}>
                  {stage.waiting ? (
                    <>
                      <b>{stage.waiting}</b> waiting
                    </>
                  ) : (
                    "No queue"
                  )}
                </span>
              </span>
            </button>
            {index < stages.length - 1 && (
              <span
                className={styles.connector}
                data-active={stage.handled > 0}
                aria-hidden="true"
              >
                <svg viewBox="0 0 48 12" preserveAspectRatio="none">
                  <path d="M0 6H46M41 1L46 6L41 11" />
                  {running && stage.handled > 0 && (
                    <path className={styles.flowMark} d="M0 6H4" />
                  )}
                </svg>
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
