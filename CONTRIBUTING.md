# Contributing

Queueglass accepts changes that keep the engine deterministic and the numbers on screen traceable to an input.

## Before opening a change

1. Run `npm ci` and `npm run verify`.
2. If controls, layout, or rendering changed, run the browser smoke and inspect both desktop and mobile captures.
3. Add a focused invariant or replay test for engine changes, and a parsing test for new input formats.
4. Confirm `npm run audit:secrets` stays green.

Real data is welcome: new worked examples, tracker export formats, and fixtures taken from public datasets. Commit the derivation script with any derived data, name the source and licence in the README and in the UI, and only use data whose licence allows redistribution. Don't add invented records, quotes or outputs.

Good extensions include more export formats, capacity that varies by weekday, items that skip steps, and comparisons between two saved lines.
