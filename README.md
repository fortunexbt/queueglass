# Queueglass

**SIMULATED · LOCAL · SEEDED · REPLAYABLE**

A small, deterministic queue simulator. Send work through four steps, change the traffic, and see where it gets stuck. All data is generated locally by an educational model.

![Queueglass running a seeded burst scenario](docs/queueglass.png)

## Truth boundary

Every displayed value is generated in the browser from a seed and one of three toy scenarios. The repository contains:

- no production telemetry or network client;
- no identity, account, communication, monetary, commercial, or staffing data;
- no AI inference or third-party services;
- no measured throughput, latency, accuracy, uptime, cost, savings, or service-level claims.

Item counts are synthetic. Capacity and compute are arbitrary model units. Latency is expressed only as **simulation ticks**. Outputs are not benchmarks, forecasts, architecture recommendations, or evidence of real operational performance.

## What can be explored

- **Steady traffic** (`nominal`) — 1–3 generated arrivals per tick.
- **Sudden rush** (`burst`) — extra arrivals at ticks 6–13, then a return to baseline traffic. Queue recovery is not guaranteed.
- **Slower checkpoint** (`policy_degraded`) — reduced Check capacity at ticks 7–19, with seeded retry decisions.
- **Run, pause, or step** — playback controls stay beside the flow. Select a step to inspect its capacity, movement, and waiting work.
- **Explore the run** — expand the pressure chart, counts, decision trail, ten-tick stepping, and playback speed.
- **Replay settings** — apply or derive a seed. Shared `?seed=&scenario=` links reproduce the run from tick 0.

The interface uses **Receive → Sort → Check → Finish** for the model's intake, classify, policy, and dispatch stages. Items may traverse all four steps in one tick; queues show work remaining after processing.

The conservation invariant is explicit:

```text
synthetic arrivals = completed items + items still in the model
```

## Run locally

Requires Node.js 24 or a compatible Node release supported by Next.js 16.

```bash
npm ci
npm run dev
```

Open <http://localhost:3000/?seed=QUEUEGLASS-7&scenario=burst>.

## Verify

```bash
npm run verify
```

The verification gate scans for removed claim language and likely secrets, lints, type-checks, runs six deterministic/invariant tests, and creates a production build.

For the real-browser smoke, start the built app and run:

```bash
npm run build
npm run start -- -p 4173
# in another terminal
npm run test:browser
```

The browser smoke checks seed/scenario replay, every intermediate tick in batched steps, the rolling 80-tick history, reset, playback, keyboard focus, stage inspection, fullscreen/Escape, mobile targets, and browser errors. It refreshes the real capture in `docs/`.

## Automation hooks

- `window.render_game_to_text()` returns concise JSON containing the truth boundary, coordinate system, seed, scenario, tick, metrics, stages, current synthetic work, recent model decisions, and up to 80 history points. History records `{ tick, depth, arrived, completed }`; arrivals and completions are per-tick deltas.
- `window.advanceTime(ms)` advances fixed 600 ms simulation ticks without using wall-clock values in model state.

## Architecture

```text
src/lib/simulation.js          pure seeded state transitions
src/components/SimulatorLab   controls, tick history, inspection, state hooks
src/components/Topology       accessible responsive stage flow
tests/simulation.test.js       replay and conservation invariants
scripts/browser-smoke.mjs      asserted Chromium interaction/capture
scripts/*-scan.mjs             release truth and secret gates
```

## Provenance

This public-facing lab is a clean-room reframing of a contained local interface prototype. The staged revival removed its original theatrical data generator, timer-driven metrics, unsupported operational language, named external connectors, and identity-like examples. No adjacent company documents, dashboards, notes, screenshots, workflows, or datasets were inspected or copied into this project.

## Limitations

- The queue model is intentionally small and single-process.
- Capacities, priorities, retries, and compute costs are pedagogical parameters.
- Scenario behavior is deterministic, not statistically calibrated.
- Browser automation currently targets Chromium.
- The project must not be presented as evidence about any company, product, team, deployment, or operating environment.

MIT licensed. Contributions that preserve the truth boundary are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).
