# queueglass

**Live: <https://queueglass.vercel.app>**

![queueglass on the BPI Challenge 2019 example: Goods receipt limits flow, the backlog peaks at 78 items on 31 Oct 2018, and the board shows that day.](docs/queueglass.webp)

For a team lead who wants to know which step of a workflow (PR review, support triage, CI, procurement) limits flow, and how fast a backlog clears. Enter 2 to 8 steps with the throughput you measured for each, an optional WIP limit, and a column of real arrivals from your tracker. Queueglass replays the arrivals through the steps and tells you:

> Goods receipt limits flow. It held work back on 20 of 367 days replayed. The backlog peaks at 78 items on 31 Oct 2018 and clears by 3 Nov 2018, 3 days later. With 47 a day at Goods receipt instead of 46, it would not clear any sooner; waiting would drop from 389 item-days to 363 item-days.

That is the real output for the worked example. The +1 sentence comes from rerunning the whole replay, not from a formula, and the table next to it does the same for every step.

## Your data

- Arrivals can be one count per line, dated counts (`2026-03-02,14`), or the Created column of a Jira, Linear or GitHub CSV export, where each date counts as one item and is tallied per day or per Monday-start week.
- Everything runs in the browser tab. The share link carries the line after the `#`, which browsers never send to a server.

## The worked example

The page opens on purchase-order lines from the BPI Challenge 2019 event log: B. F. van Dongen (2019), 4TU.ResearchData, [doi:10.4121/uuid:d06aff4b-79f0-45e6-8ec8-e19730c248f1](https://doi.org/10.4121/uuid:d06aff4b-79f0-45e6-8ec8-e19730c248f1), licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The log is from a multinational coatings and paints company.

[`scripts/derive-bpi2019.mjs`](scripts/derive-bpi2019.mjs) checks the log against 4TU's published MD5 and counts, for each day of 2018, the lines in the CAPEX & SOCS spend area that reached each activity for the first time. The output is [`data/bpi2019-capex-socs-daily.2026-10-23.csv`](data/bpi2019-capex-socs-daily.2026-10-23.csv). CAPEX & SOCS was picked because its volume is team-sized (about 26 lines a working day) and 77% of its lines pass all three steps. The arrivals are the lines created per day. Each step's capacity is that activity's 90th-percentile daily count on the days it ran: 46 goods receipts, 49 invoice receipts and 142 invoice clearings.

```bash
# BPI_Challenge_2019.xes, 728,558,522 bytes, from the DOI above
node scripts/derive-bpi2019.mjs path/to/BPI_Challenge_2019.xes
```

## How it works

`src/lib/simulation.js` is a deterministic tandem queue. Each period's arrivals join the first step. Steps are served from the last back to the first, oldest work first, each up to its capacity, so an item moves at most one step per period. With a WIP limit, a step stops passing work on while the next step already has that many waiting. After the last arrival the replay runs on until the line is empty.

The backlog is work that was ready to move and couldn't. The bottleneck in a period is the unblocked step that left the most of it; the step that limits flow is the one that was the bottleneck most often. `analyzeLine()` finds the peak, the first period after it with no backlog, and reruns the line with +1 capacity at each step.

```text
src/lib/simulation.js         engine, bottleneck rule, analysis with +1 reruns
src/lib/line.js               arrivals parsing, period labels, share link, example, headline
src/components/SimulatorLab   page state, verdict, +1 table, playback
src/components/LinePanel      the Your line form
src/components/FlowBoard      the steps at the selected period
src/components/Timeline       per-step queue lanes, scrubber, table view
scripts/derive-bpi2019.mjs    builds the example CSV from the BPI 2019 log
```

## Run locally

Node.js 24.

```bash
npm ci
npm run dev
```

## Tests

```bash
npm run verify        # secret scan, lint, types, unit tests, build
npm run build && npm run start -- -p 4173
npm run test:browser  # in a second terminal
```

The browser smoke loads the example and its verdict, plays and scrubs, enters a two-step line from a pasted Created column, sets a WIP limit and weekly periods, adds steps up to eight, reopens the share link in a fresh page and checks that no request carried the line, then checks the 404 page, the phone layout and reduced motion.

## Limits

- Capacity is fixed per period, weekends included. Measure it on a normal busy period.
- Every item passes every step. In the example, 23% of CAPEX & SOCS lines skip at least one step in the real log, so the example overstates the load on later steps.
- Periods are whole days or weeks, and a line takes at least one period per step.
- At most 1,000 periods of arrivals and 8 steps.

MIT licensed. See [CONTRIBUTING.md](CONTRIBUTING.md).
