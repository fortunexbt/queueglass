# Changelog

## 2.0.0 (2026-10-23)

- Queueglass now replays a team's own line: 2 to 8 named steps with measured throughput, an optional WIP limit, and real arrivals pasted as counts or as the Created column of a Jira, Linear or GitHub export.
- The headline names the step that limits flow, when the backlog peaks and clears, and what one more unit of capacity at that step changes, from a full rerun. A table reruns +1 at every step.
- The line lives in the URL fragment, so it never reaches a server.
- Added a worked example from the BPI Challenge 2019 log (CC BY 4.0) with its derivation script and derived CSV.
- Removed the Steady, Burst and Cascade presets, seeds and random arrivals, the unshown event log, compute units, the claim scan and the split-flap text.

## 1.1.0 (2026-10-22)

- Rebuilt the interface as a departure-board flow: items move between steps, the bottleneck is highlighted and blocked steps are marked.
- Added a scrubbable 60-tick replay with per-step queue lanes and a table view.
- Added Steady, Burst and Cascading failure presets, plus arrival and capacity controls that travel in the share link.
- Reworked the model: downstream-first service, bounded buffers in the cascade, a bottleneck rule and precomputed runs.

## 1.0.0 — 2026-07-22

- Reframed an unsafe theatrical dashboard as an explicitly synthetic deterministic systems lab.
- Removed unsupported monetary, staffing, performance, uptime, accuracy, funnel, external-service, and identity-like content.
- Added three seed-replayable queue scenarios, a canvas topology, time/text automation hooks, and responsive controls.
- Added replay, conservation, pressure, retry, and seed tests; current lint/type/build tooling; CI; truth/secret scans; MIT documentation; and an asserted real-browser capture.
