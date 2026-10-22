# Product

## Platform
web

## Stack
Next.js 16 App Router, React 19, plain CSS. Pure JS engine in src/lib/simulation.js, input handling in src/lib/line.js.

## Users
Team leads and engineering or operations managers who own a multi-step workflow (PR review, support triage, CI, procurement) and need to decide where to add capacity. They have a tracker export and a rough count of what each step finishes per day or week.

## Product Purpose
Replay a team's real arrivals through its steps and say which step limits flow, when the backlog peaks and clears, and whether one more unit of capacity at each step would clear it sooner.

## Positioning
A quick decision aid for capacity questions, not a monitoring product or a forecasting service. One page, no account, no backend.

## Operating Context
Single page. All computation in the browser; the share link keeps the line in the URL fragment. Laptop first, works on a phone.

## Capabilities and Constraints
2 to 8 steps, whole-number capacity per period, optional WIP limit, up to 1,000 periods of arrivals. Every item passes every step. The worked example is real public data (BPI Challenge 2019, CC BY 4.0) with its derivation committed.

## Brand Commitments
Name "queueglass". Plain, specific copy. Numbers on screen come from the replay, never from invented data.

## Evidence on Hand
The BPI Challenge 2019 example and whatever the user pastes.

## Product Principles
Answer first, mechanism second. Counterfactuals are reruns, not estimates. The user's data stays with the user.

## Accessibility & Inclusion
WCAG AA contrast, keyboard operable, visible focus, reduced-motion path, works at 360px.
