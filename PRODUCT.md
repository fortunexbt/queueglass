# Product

(Inferred from the repo and the showcase brief; no user interview was possible.)

## Platform
web

## Stack
Next.js 16 App Router, React 19, plain CSS. Pure JS simulation core in src/lib/simulation.js.

## Users
Hackathon judges and curious engineers opening a link cold, on a laptop or a phone, with about ten seconds of attention.

## Product Purpose
A seeded discrete-event queue simulator. Work flows through four stages (Receive, Sort, Check, Finish). Change the traffic and capacity and watch where it jams. Every run is deterministic and replayable from a seed.

## Positioning
A teaching instrument for queueing intuition: bottlenecks, burst recovery, cascading slowdowns. Not a monitoring product.

## Operating Context
Single page, local, no backend, no keys. Short sessions. Phone and laptop.

## Capabilities and Constraints
All data is simulated and must be labelled as such (truth boundary). No real telemetry, benchmarks or performance claims. Time is in ticks; capacity in arbitrary units.

## Brand Commitments
Name "queueglass". Truth-boundary labelling. Plain, specific copy.

## Evidence on Hand
The simulation itself; nothing else.

## Product Principles
Show the mechanism, not a claim about it. One click to the insight. Replayable means scrubbable.

## Accessibility & Inclusion
WCAG AA contrast, keyboard operable, visible focus, reduced-motion path, works at 360px.
