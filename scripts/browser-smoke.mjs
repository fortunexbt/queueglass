import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(root, "output");
const docsDir = path.join(root, "docs");
const baseUrl = process.env.QUEUEGLASS_BASE_URL ?? "http://127.0.0.1:4173";
const origin = new URL(baseUrl).origin;
const browserErrors = [];
const externalRequests = [];

await Promise.all([
  mkdir(outputDir, { recursive: true }),
  mkdir(docsDir, { recursive: true }),
]);

function observe(page, label) {
  page.on("console", (message) => {
    if (message.type() === "error")
      browserErrors.push(`${label} console: ${message.text()}`);
  });
  page.on("pageerror", (error) =>
    browserErrors.push(`${label} page: ${error.message}`),
  );
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== origin && !["data:", "blob:"].includes(url.protocol)) {
      externalRequests.push(`${label}: ${request.method()} ${request.url()}`);
    }
  });
}

async function readState(page) {
  return page.evaluate(() => {
    if (typeof window.render_game_to_text !== "function")
      throw new Error("render_game_to_text hook missing");
    return JSON.parse(window.render_game_to_text());
  });
}

async function waitForHook(page) {
  await page.waitForFunction(
    () => typeof window.render_game_to_text === "function",
  );
}

async function setDisclosure(page, selector, open) {
  const disclosure = page.locator(selector);
  if ((await disclosure.evaluate((element) => element.open)) !== open) {
    await disclosure.locator("summary").click();
  }
  assert.equal(await disclosure.evaluate((element) => element.open), open);
}

async function advanceTen(page) {
  await setDisclosure(page, "#numbers-panel", true);
  await page.locator("#advance-10").click();
}

function assertHistory(state) {
  assert.deepEqual(state.historyUnits, {
    tick: "simulation ticks",
    depth: "synthetic items after processing",
    arrived: "synthetic items per tick",
    completed: "synthetic items per tick",
  });
  assert.ok(Array.isArray(state.history), "snapshot must include tick history");
  const firstTick = Math.max(0, state.tick - 79);
  assert.equal(
    state.history.length,
    Math.min(state.tick + 1, 80),
    "history must retain T0 and the latest 80 ticks",
  );
  assert.deepEqual(
    state.history.map((point) => point.tick),
    Array.from(
      { length: state.history.length },
      (_, index) => firstTick + index,
    ),
    "history must include every intermediate tick",
  );
  for (const point of state.history) {
    for (const key of ["depth", "arrived", "completed"]) {
      assert.ok(
        Number.isFinite(point[key]) && point[key] >= 0,
        `history ${key} must be a nonnegative number`,
      );
    }
  }
  const latest = state.history.at(-1);
  assert.equal(latest.tick, state.tick);
  assert.equal(latest.depth, state.metrics.queueDepth);
  for (let index = 1; index < state.history.length; index += 1) {
    const point = state.history[index];
    assert.equal(
      point.depth,
      state.history[index - 1].depth + point.arrived - point.completed,
      "each tick must conserve work using per-tick arrivals and completions",
    );
  }
  if (firstTick === 0) {
    assert.equal(
      state.history.reduce((sum, point) => sum + point.arrived, 0),
      state.metrics.syntheticArrivals,
    );
    assert.equal(
      state.history.reduce((sum, point) => sum + point.completed, 0),
      state.metrics.syntheticCompleted,
    );
  }
}

async function assertMainFlow(page, state) {
  for (const stage of state.stages) {
    const button = page.locator(`#stage-${stage.id}`);
    assert.equal(
      await button.getByTestId("stage-movement").innerText(),
      `${stage.handled} of ${stage.capacity} moved`,
    );
    assert.equal(
      await button.locator('[data-filled="true"]').count(),
      stage.handled,
      "filled processing slots must represent successful movement this tick",
    );
  }
  if (state.tick > 0) {
    const latest = state.history.at(-1);
    assert.equal(
      await page.locator("#tick-arrived").innerText(),
      `${latest.arrived} arrived`,
    );
    assert.equal(
      await page.locator("#tick-finished").innerText(),
      `${latest.completed} finished`,
    );
    const delta = latest.arrived - latest.completed;
    assert.equal(
      await page.locator("#tick-queue-change").innerText(),
      delta === 0
        ? "Queue unchanged"
        : `${Math.abs(delta)} ${delta > 0 ? "more" : "fewer"} waiting`,
    );
  }
}

async function focusBackground(page) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
  });
  assert.equal(
    await page.evaluate(() => document.activeElement?.tagName),
    "BODY",
  );
}

const browser = await chromium.launch({ headless: true });
const proof = {};

try {
  const desktop = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await desktop.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin,
  });
  const page = await desktop.newPage();
  observe(page, "desktop");

  await page.goto(`${baseUrl}/?seed=REPLAY-9&scenario=burst`, {
    waitUntil: "networkidle",
  });
  await waitForHook(page);
  let state = await readState(page);
  assert.equal(state.label, "SIMULATED local discrete-event systems model");
  assert.equal(state.seed, "REPLAY-9");
  assert.equal(state.scenario, "burst");
  assert.equal(state.tick, 0);
  assertHistory(state);
  assert.equal(
    await page.locator("#numbers-panel").evaluate((element) => element.open),
    false,
  );
  assert.equal(
    await page.locator("#replay-settings").evaluate((element) => element.open),
    false,
  );
  assert.equal(await page.locator("#stage-inspector").count(), 0);
  const provenance = page.locator(".truth-panel");
  assert.equal(
    await provenance.evaluate((element) => element.tagName),
    "DETAILS",
  );
  await setDisclosure(page, ".truth-panel", true);
  assert.match(await provenance.innerText(), /model, not a monitored system/i);
  await setDisclosure(page, ".truth-panel", false);
  assert.equal(await provenance.evaluate((element) => element.open), false);
  assert.match(await page.locator("body").innerText(), /SIMULATED/);

  await advanceTen(page);
  state = await readState(page);
  assert.equal(state.tick, 10);
  assert.ok(state.metrics.syntheticArrivals > 0);
  assert.ok(
    state.metrics.queueDepth > 0,
    "burst scenario should create queue pressure by tick 10",
  );
  assertHistory(state);
  await assertMainFlow(page, state);
  const firstTenTicks = state;

  await page.locator("#reset-replay").click();
  state = await readState(page);
  assert.equal(state.tick, 0);
  assertHistory(state);
  for (let tick = 1; tick <= 10; tick += 1) {
    await page.locator("#advance-1").click();
    state = await readState(page);
    assert.equal(state.tick, tick);
    assertHistory(state);
  }
  assert.deepEqual(
    state,
    firstTenTicks,
    "Advance 10 must match ten individual ticks, including their history",
  );

  await page.locator("#reset-replay").click();
  assertHistory(await readState(page));
  await advanceTen(page);
  assert.deepEqual(
    await readState(page),
    firstTenTicks,
    "reset and replay must reproduce the entire snapshot",
  );

  await page.locator("#advance-1").focus();
  await page.keyboard.press("Space");
  state = await readState(page);
  assert.equal(
    state.tick,
    11,
    "Space on a focused step button must activate it exactly once",
  );
  assert.equal(
    state.running,
    false,
    "Space on a button must not toggle auto-run",
  );
  assertHistory(state);

  await page.locator("#scenario-policy_degraded").click();
  state = await readState(page);
  assert.equal(state.scenario, "policy_degraded");
  assert.equal(state.tick, 0);
  assertHistory(state);
  await advanceTen(page);
  state = await readState(page);
  assert.equal(state.tick, 10);
  assert.equal(
    state.stages.find((stage) => stage.id === "policy")?.capacity,
    1,
  );
  assertHistory(state);
  await page.locator("#stage-policy").click();
  assert.equal(
    await page.locator("#stage-inspector").getAttribute("data-stage"),
    "policy",
  );
  await page.waitForFunction(
    () => document.activeElement?.id === "inspector-title",
    {},
    { timeout: 1500 },
  );
  const inspectorVisibility = await page
    .locator("#stage-inspector")
    .evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.top >= -1 && rect.bottom <= innerHeight + 1;
    });
  assert.ok(
    inspectorVisibility,
    "opening a stage must reveal its inspector in the viewport",
  );
  assert.match(
    await page.locator("#stage-inspector").innerText(),
    /Inside Check/,
  );
  const policyStage = state.stages.find((stage) => stage.id === "policy");
  assert.deepEqual(
    await page
      .locator("#stage-inspector .inspector-metrics dd")
      .allTextContents(),
    [policyStage.capacity, policyStage.handled, policyStage.waiting].map(
      String,
    ),
    "inspector values must reflect the selected stage",
  );
  const visibleItems = await page
    .locator("#stage-inspector .work-list li > span:first-child")
    .allTextContents();
  assert.equal(visibleItems.length, Math.min(policyStage.waiting, 5));
  for (const id of visibleItems) {
    assert.ok(
      state.activeWork.some(
        (item) => item.id === id && item.stage === "policy",
      ),
      "inspector must show actual work queued at the selected stage",
    );
  }

  await page
    .locator("#stage-inspector")
    .screenshot({ path: path.join(outputDir, "queueglass-inspector.png") });
  const inspectedTick = (await readState(page)).tick;
  await page.keyboard.press("Space");
  await page.waitForFunction(
    (tick) => JSON.parse(window.render_game_to_text()).tick > tick,
    inspectedTick,
  );
  assert.equal(
    await page.evaluate(() => document.activeElement?.id),
    "inspector-title",
    "automatic ticks must preserve inspection focus",
  );
  await page.keyboard.press("Space");
  assert.equal((await readState(page)).running, false);
  await page.locator("#close-inspector").focus();
  await page.keyboard.press("Enter");
  assert.equal(
    await page.evaluate(() => document.activeElement?.id),
    "stage-policy",
    "closing inspection must return focus to the selected step",
  );
  assert.equal(await page.locator("#stage-inspector").count(), 0);

  await setDisclosure(page, "#numbers-panel", true);
  const playbackSpeed = page.getByRole("combobox", {
    name: "Playback speed",
    exact: true,
  });
  const defaultSpeed = await playbackSpeed.inputValue();
  const alternateSpeed = await playbackSpeed
    .locator("option")
    .evaluateAll(
      (options, current) =>
        options.find((option) => !option.disabled && option.value !== current)
          ?.value,
      defaultSpeed,
    );
  assert.ok(alternateSpeed, "playback speed must offer an alternative rate");
  await playbackSpeed.selectOption(alternateSpeed);
  assert.equal(await playbackSpeed.inputValue(), alternateSpeed);

  await page.locator("#toggle-run").click();
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).tick >= 12,
  );
  await page.locator("#toggle-run").click();
  await page.waitForTimeout(80);
  await assertMainFlow(page, await readState(page));
  const pausedTick = (await readState(page)).tick;
  await page.waitForTimeout(750);
  assert.equal(
    (await readState(page)).tick,
    pausedTick,
    "pause must stop automatic ticks",
  );
  assertHistory(await readState(page));
  await playbackSpeed.selectOption(defaultSpeed);

  await focusBackground(page);
  await page.keyboard.press("Space");
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).running === true,
  );
  await page.waitForFunction(
    (tick) => JSON.parse(window.render_game_to_text()).tick > tick,
    pausedTick,
  );
  await page.keyboard.press("Space");
  state = await readState(page);
  assert.equal(
    state.running,
    false,
    "Space on the page background must pause auto-run",
  );
  const keyboardPausedTick = state.tick;
  await page.waitForTimeout(750);
  assert.equal(
    (await readState(page)).tick,
    keyboardPausedTick,
    "keyboard pause must stop automatic ticks",
  );

  await setDisclosure(page, "#replay-settings", true);
  await page.locator(".seed-control input").fill("Mobile replay / 1");
  await page.locator("#apply-seed").click();
  state = await readState(page);
  assert.equal(state.seed, "MOBILE-REPLAY-1");
  assert.equal(state.tick, 0);
  assertHistory(state);
  await page.locator("#copy-replay").click();
  await page.waitForFunction(() =>
    /Replay URL copied/.test(
      document.querySelector(".status-line")?.textContent || "",
    ),
  );
  assert.match(
    await page.locator(".status-line").innerText(),
    /Replay URL copied/,
  );
  assert.equal(
    await page.locator("#copy-replay").innerText(),
    "Copied",
    "sharing must give feedback beside the action",
  );
  const sharedUrl = new URL(
    await page.evaluate(() => navigator.clipboard.readText()),
  );
  assert.equal(sharedUrl.searchParams.get("seed"), "MOBILE-REPLAY-1");
  assert.equal(sharedUrl.searchParams.get("scenario"), "policy_degraded");
  const sharedPage = await desktop.newPage();
  observe(sharedPage, "shared replay");
  await sharedPage.goto(sharedUrl.href, { waitUntil: "networkidle" });
  await waitForHook(sharedPage);
  const sharedState = await readState(sharedPage);
  assert.equal(sharedState.seed, "MOBILE-REPLAY-1");
  assert.equal(sharedState.scenario, "policy_degraded");
  assert.equal(sharedState.tick, 0);
  await sharedPage.evaluate(() => {
    navigator.clipboard.writeText = async () => {
      throw new DOMException("Clipboard denied", "NotAllowedError");
    };
  });
  await sharedPage.locator("#copy-replay").click();
  await sharedPage.waitForFunction(() =>
    document
      .querySelector("#copy-replay")
      ?.textContent?.includes("Copy blocked"),
  );
  assert.match(
    await sharedPage.locator("#copy-replay").getAttribute("title"),
    /address bar/,
  );
  await sharedPage.close();

  await page.locator("#toggle-fullscreen").click();
  await page.waitForFunction(() => Boolean(document.fullscreenElement));
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.fullscreenElement);
  await page.locator("#stage-policy").focus();
  await page.keyboard.press("f");
  await page.waitForFunction(() => Boolean(document.fullscreenElement));
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.fullscreenElement);

  await page.locator("#scenario-burst").click();
  assertHistory(await readState(page));
  for (let tick = 10; tick <= 100; tick += 10) {
    await advanceTen(page);
    state = await readState(page);
    assert.equal(state.tick, tick);
    assertHistory(state);
  }
  assert.equal(state.history.length, 80);
  assert.equal(state.history[0].tick, 21);
  const retainedHistory = {
    firstTick: state.history[0].tick,
    lastTick: state.history.at(-1).tick,
    length: state.history.length,
  };

  await page.locator("#reset-replay").click();
  state = await readState(page);
  assert.equal(state.tick, 0);
  assertHistory(state);
  await advanceTen(page);
  await advanceTen(page);
  state = await readState(page);
  assert.equal(state.tick, 20);
  assert.equal(state.scenario, "burst");
  assertHistory(state);
  await setDisclosure(page, "#numbers-panel", false);
  await setDisclosure(page, "#replay-settings", false);
  await page.waitForFunction(
    () =>
      document.querySelector("#copy-replay")?.getAttribute("data-feedback") ===
      "idle",
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: path.join(docsDir, "queueglass.png"),
    fullPage: true,
  });
  await page
    .locator(".pipeline-topology")
    .screenshot({ path: path.join(outputDir, "queueglass-topology.png") });
  proof.desktop = {
    seed: state.seed,
    scenario: state.scenario,
    tick: state.tick,
    metrics: state.metrics,
    fullscreenExercised: true,
    replayUrlCopied: true,
    nativeButtonSpaceExercised: true,
    backgroundKeyboardShortcutsExercised: true,
    playbackSpeedExercised: true,
    policyInspectorExercised: true,
    historyReplayVerified: true,
    movementCountsVerified: true,
    inspectionFocusDuringPlayback: true,
    clipboardDeniedFeedbackSimulated: true,
    retainedHistory,
  };
  await desktop.close();

  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
  });
  const mobilePage = await mobile.newPage();
  observe(mobilePage, "mobile");
  await mobilePage.goto(`${baseUrl}/?seed=POCKET-3&scenario=nominal`, {
    waitUntil: "networkidle",
  });
  await waitForHook(mobilePage);
  const firstScreen = await mobilePage.evaluate(() => ({
    controlsTop: document.querySelector("#controls").getBoundingClientRect()
      .top,
    resultBottom: document
      .querySelector(".flow-summary")
      .getBoundingClientRect().bottom,
    viewportHeight: innerHeight,
  }));
  assert.ok(
    firstScreen.controlsTop >= 0 &&
      firstScreen.resultBottom <= firstScreen.viewportHeight,
    "the initial phone viewport must contain playback, all four steps, and the result",
  );
  await advanceTen(mobilePage);
  const mobileState = await readState(mobilePage);
  assert.equal(mobileState.tick, 10);
  assertHistory(mobileState);
  await assertMainFlow(mobilePage, mobileState);
  await setDisclosure(mobilePage, "#numbers-panel", false);
  await mobilePage.locator("#stage-policy").click();
  assert.equal(
    await mobilePage.locator("#stage-inspector").getAttribute("data-stage"),
    "policy",
  );
  await mobilePage.waitForFunction(
    () => document.activeElement?.id === "inspector-title",
  );
  assert.ok(
    await mobilePage.locator("#stage-inspector").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.top >= -1 && rect.bottom <= innerHeight + 1;
    }),
    "phone stage inspection must be immediately visible",
  );
  await mobilePage.locator("#close-inspector").click();
  assert.equal(await mobilePage.locator("#stage-inspector").count(), 0);

  const layout = await mobilePage.evaluate(() => {
    const controls = [
      ...document.querySelectorAll("button, input, select, summary"),
    ].filter(
      (control) =>
        control.getClientRects().length > 0 &&
        window.getComputedStyle(control).visibility !== "hidden",
    );
    const topology = document.querySelector(".pipeline-topology");
    return {
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      controlCount: controls.length,
      minimumControlHeight: Math.min(
        ...controls.map((control) => control.getBoundingClientRect().height),
      ),
      topologyLeft: topology?.getBoundingClientRect().left ?? null,
      topologyRight: topology?.getBoundingClientRect().right ?? null,
    };
  });
  assert.ok(
    layout.documentWidth <= layout.viewportWidth + 1,
    "mobile layout must not overflow horizontally",
  );
  assert.ok(layout.controlCount > 0, "mobile controls must be present");
  assert.ok(
    layout.minimumControlHeight >= 44,
    "mobile control targets must be at least 44px high",
  );
  assert.ok(
    layout.topologyLeft !== null && layout.topologyLeft >= 0,
    "topology must start inside the mobile viewport",
  );
  assert.ok(
    layout.topologyRight !== null &&
      layout.topologyRight <= layout.viewportWidth + 1,
    "topology must remain inside the mobile viewport",
  );
  await mobilePage.evaluate(() => window.scrollTo(0, 0));
  await mobilePage.screenshot({
    path: path.join(outputDir, "queueglass-mobile.png"),
    fullPage: true,
  });
  proof.mobile = {
    seed: mobileState.seed,
    scenario: mobileState.scenario,
    tick: mobileState.tick,
    layout,
    firstScreen,
  };
  await mobile.close();

  const narrowContext = await browser.newContext({
    viewport: { width: 320, height: 844 },
    isMobile: true,
  });
  const narrowPage = await narrowContext.newPage();
  observe(narrowPage, "narrow phone");
  const narrowLayouts = [];
  for (const scenario of ["nominal", "burst", "policy_degraded"]) {
    await narrowPage.goto(`${baseUrl}/?seed=POCKET-3&scenario=${scenario}`, {
      waitUntil: "networkidle",
    });
    await waitForHook(narrowPage);
    const bounds = await narrowPage.evaluate(() => ({
      viewportWidth: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      resultBottom: document
        .querySelector(".flow-summary")
        .getBoundingClientRect().bottom,
      viewportHeight: innerHeight,
    }));
    narrowLayouts.push({ scenario, ...bounds });
    assert.ok(
      bounds.documentWidth <= bounds.viewportWidth,
      `${scenario} must fit a narrow phone`,
    );
    assert.ok(
      bounds.resultBottom <= bounds.viewportHeight,
      `${scenario} must keep the initial flow and result in view`,
    );
  }
  await narrowContext.close();
  proof.narrowPhones = narrowLayouts;

  assert.deepEqual(
    externalRequests,
    [],
    `unexpected external requests:\n${externalRequests.join("\n")}`,
  );
  assert.deepEqual(
    browserErrors,
    [],
    `browser errors:\n${browserErrors.join("\n")}`,
  );
  proof.externalRequests = externalRequests;
  proof.browserErrors = browserErrors;
  await writeFile(
    path.join(outputDir, "browser-smoke-state.json"),
    `${JSON.stringify(proof, null, 2)}\n`,
  );
  console.log(
    "Browser smoke passed: deterministic tick history, controls, keyboard, inspector, fullscreen, responsive layout, and captures verified.",
  );
} finally {
  await browser.close();
}
