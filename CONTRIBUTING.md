# Contributing

Queueglass accepts changes that keep the simulator deterministic, inspectable, and unmistakably synthetic.

## Before opening a change

1. Run `npm ci` and `npm run verify`.
2. If controls, layout, or rendering changed, run the browser smoke and inspect both desktop and mobile captures.
3. Add a focused invariant or replay test for simulation changes.
4. Confirm `npm run audit:claims` and `npm run audit:secrets` remain green.

Do not add production data, identity-like examples, named external services, monetary estimates, staffing estimates, benchmarks, or measured-performance language. New metrics must state their synthetic unit in-product and in the text-state hook.

Good extensions include additional deterministic queue disciplines, visual comparisons between two identical seeds, property-based conservation checks, and keyboard improvements.
