"use client";

import { useState } from "react";

import { type Setup, type Unit, parseArrivals, periodDate, periodLabel } from "@/lib/line.js";
import { CAPACITY_RANGE, NAME_LENGTH, STEP_COUNT, normalizeLine } from "@/lib/simulation.js";

type Row = { name: string; capacity: string };

const arrivalsText = (setup: Setup) =>
  setup.line.arrivals.map((count, index) => (setup.start ? `${periodDate(setup, index + 1)},${count}` : count)).join("\n");

export default function LinePanel({
  setup,
  isExample,
  onChange,
  onLoadExample,
}: {
  setup: Setup;
  isExample: boolean;
  onChange: (setup: Setup) => void;
  onLoadExample: () => void;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    setup.line.stages.map((stage) => ({ name: stage.name, capacity: String(stage.capacity) })),
  );
  const [wip, setWip] = useState(setup.line.bufferLimit === null ? "" : String(setup.line.bufferLimit));
  const [text, setText] = useState(() => arrivalsText(setup));
  const [message, setMessage] = useState("");

  const commit = (next: { rows?: Row[]; wip?: string; arrivals?: number[]; unit?: Unit; start?: string | null }) => {
    const line = normalizeLine({
      stages: (next.rows ?? rows).map((row) => ({ name: row.name, capacity: row.capacity === "" ? undefined : Number(row.capacity) })),
      bufferLimit: next.wip ?? wip,
      arrivals: next.arrivals ?? setup.line.arrivals,
    });
    if (!line) return;
    onChange({ line, unit: next.unit ?? setup.unit, start: next.start === undefined ? setup.start : next.start });
  };
  const editRows = (next: Row[]) => {
    setRows(next);
    commit({ rows: next });
  };
  const applyArrivals = (unit: Unit) => {
    const parsed = parseArrivals(text, unit);
    if ("error" in parsed) {
      setMessage(parsed.error);
      return false;
    }
    commit({ arrivals: parsed.arrivals, unit, start: parsed.start });
    const first = parsed.start ? `, starting ${periodLabel({ ...setup, unit, start: parsed.start }, 1)}` : "";
    setMessage(
      `Replaying ${parsed.arrivals.length} ${unit}${parsed.arrivals.length === 1 ? "" : "s"}${first}.${parsed.skipped ? ` Skipped ${parsed.skipped} line${parsed.skipped === 1 ? "" : "s"} with no count or date.` : ""}`,
    );
    return true;
  };

  return (
    <section id="your-line" className="panel line-panel" aria-labelledby="line-title">
      <div className="line-head">
        <h2 id="line-title">Your line</h2>
        <p>Steps in order, what each finishes per {setup.unit}, and the work that arrived. It all stays in this browser.</p>
      </div>

      <fieldset className="steps">
        <legend>Steps, in order, with measured throughput</legend>
        <ol>
          {rows.map((row, index) => (
            <li key={index}>
              <span className="step-index" aria-hidden="true">
                {index + 1}
              </span>
              <label className="sr-only" htmlFor={`step-name-${index}`}>
                Step {index + 1} name
              </label>
              <input
                id={`step-name-${index}`}
                className="step-name"
                value={row.name}
                maxLength={NAME_LENGTH}
                autoComplete="off"
                onChange={(event) =>
                  editRows(rows.map((other, at) => (at === index ? { ...other, name: event.target.value } : other)))
                }
              />
              <label className="sr-only" htmlFor={`step-capacity-${index}`}>
                Step {index + 1} items finished per {setup.unit}
              </label>
              <input
                id={`step-capacity-${index}`}
                className="step-capacity"
                type="number"
                inputMode="numeric"
                min={CAPACITY_RANGE[0]}
                max={CAPACITY_RANGE[1]}
                step={1}
                value={row.capacity}
                aria-invalid={row.capacity === "" || Number(row.capacity) < 1 || undefined}
                onChange={(event) =>
                  editRows(rows.map((other, at) => (at === index ? { ...other, capacity: event.target.value } : other)))
                }
              />
              <span className="step-unit" aria-hidden="true">
                per {setup.unit}
              </span>
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove step ${index + 1}`}
                disabled={rows.length <= STEP_COUNT[0]}
                onClick={() => editRows(rows.filter((_, at) => at !== index))}
              >
                <svg width="14" height="14" viewBox="0 0 12 12" aria-hidden="true">
                  <path d="M3 3l6 6M9 3l-6 6" />
                </svg>
              </button>
            </li>
          ))}
        </ol>
        <button
          type="button"
          className="button ghost"
          disabled={rows.length >= STEP_COUNT[1]}
          onClick={() => editRows([...rows, { name: `Step ${rows.length + 1}`, capacity: rows.at(-1)?.capacity ?? "1" }])}
        >
          Add a step
        </button>
      </fieldset>

      <div className="line-options">
        <div className="segmented" role="group" aria-label="Period">
          {(["day", "week"] as const).map((unit) => (
            <button
              key={unit}
              type="button"
              aria-pressed={setup.unit === unit}
              onClick={() => {
                if (!applyArrivals(unit)) commit({ unit });
              }}
            >
              Per {unit}
            </button>
          ))}
        </div>
        <label className="wip">
          <span>WIP limit</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            placeholder="none"
            value={wip}
            onChange={(event) => {
              setWip(event.target.value);
              commit({ wip: event.target.value });
            }}
          />
          <small>Most items that may wait at each step after the first.</small>
        </label>
      </div>

      <form
        className="arrivals"
        onSubmit={(event) => {
          event.preventDefault();
          applyArrivals(setup.unit);
        }}
      >
        <label htmlFor="arrivals-input">Arrivals</label>
        <p id="arrivals-help">
          One count per line, optionally after a date (<code>2026-03-02,14</code>), or paste the Created column
          of a Jira, Linear or GitHub CSV export and each date counts as one item.
        </p>
        <textarea
          id="arrivals-input"
          rows={7}
          spellCheck={false}
          aria-describedby="arrivals-help"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <div className="arrivals-actions">
          <button type="submit" className="button primary">
            Replay these arrivals
          </button>
          {!isExample && (
            <button type="button" className="button ghost" onClick={onLoadExample}>
              Load the BPI 2019 example
            </button>
          )}
        </div>
        <p className="arrivals-status" role="status">
          {message}
        </p>
      </form>
    </section>
  );
}
