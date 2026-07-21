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

await Promise.all([mkdir(outputDir, { recursive: true }), mkdir(docsDir, { recursive: true })]);

function observe(page, label) {
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(`${label} console: ${message.text()}`);
  });
  page.on("pageerror", (error) => browserErrors.push(`${label} page: ${error.message}`));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== origin && !["data:", "blob:"].includes(url.protocol)) {
      externalRequests.push(`${label}: ${request.method()} ${request.url()}`);
    }
  });
}

async function readState(page) {
  return page.evaluate(() => {
    if (typeof window.render_game_to_text !== "function") throw new Error("render_game_to_text hook missing");
    return JSON.parse(window.render_game_to_text());
  });
}

async function waitForHook(page) {
  await page.waitForFunction(() => typeof window.render_game_to_text === "function");
}

const browser = await chromium.launch({ headless: true });
const proof = {};

try {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await desktop.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
  const page = await desktop.newPage();
  observe(page, "desktop");

  await page.goto(`${baseUrl}/?seed=REPLAY-9&scenario=burst`, { waitUntil: "networkidle" });
  await waitForHook(page);
  let state = await readState(page);
  assert.equal(state.label, "SIMULATED local discrete-event systems model");
  assert.equal(state.seed, "REPLAY-9");
  assert.equal(state.scenario, "burst");
  assert.equal(state.tick, 0);
  assert.match(await page.locator(".truth-panel").innerText(), /model, not a monitored system/i);
  assert.match(await page.locator("body").innerText(), /SIMULATED/);

  await page.locator("#advance-10").click();
  state = await readState(page);
  assert.equal(state.tick, 10);
  assert.ok(state.metrics.syntheticArrivals > 0);
  assert.ok(state.metrics.queueDepth > 0, "burst scenario should create queue pressure by tick 10");

  await page.locator("#advance-1").click();
  assert.equal((await readState(page)).tick, 11);
  await page.locator("#reset-replay").click();
  assert.equal((await readState(page)).tick, 0);

  await page.locator("#scenario-policy_degraded").click();
  state = await readState(page);
  assert.equal(state.scenario, "policy_degraded");
  assert.equal(state.tick, 0);
  await page.locator("#advance-10").click();
  state = await readState(page);
  assert.equal(state.tick, 10);
  assert.equal(state.stages.find((stage) => stage.id === "policy")?.capacity, 1);

  await page.locator("#toggle-run").click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).tick >= 12);
  await page.locator("#toggle-run").click();
  await page.waitForTimeout(80);
  const pausedTick = (await readState(page)).tick;
  await page.waitForTimeout(750);
  assert.equal((await readState(page)).tick, pausedTick, "pause must stop automatic ticks");

  await page.locator(".seed-control input").fill("Mobile replay / 1");
  await page.locator("#apply-seed").click();
  state = await readState(page);
  assert.equal(state.seed, "MOBILE-REPLAY-1");
  assert.equal(state.tick, 0);
  await page.locator("#copy-replay").click();
  await page.waitForFunction(() => /Replay URL copied/.test(document.querySelector(".status-line")?.textContent || ""));
  assert.match(await page.locator(".status-line").innerText(), /Replay URL copied/);
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /seed=MOBILE-REPLAY-1/);

  await page.locator("#toggle-fullscreen").click();
  await page.waitForFunction(() => Boolean(document.fullscreenElement));
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.fullscreenElement);

  await page.locator("#scenario-burst").click();
  await page.locator("#advance-10").click();
  await page.locator("#advance-10").click();
  state = await readState(page);
  assert.equal(state.tick, 20);
  assert.equal(state.scenario, "burst");
  await page.locator(".topology-panel").scrollIntoViewIfNeeded();
  await page.locator(".topology-panel").screenshot({ path: path.join(docsDir, "queueglass.png") });
  await page.locator("canvas").screenshot({ path: path.join(outputDir, "queueglass-topology.png") });
  proof.desktop = {
    seed: state.seed,
    scenario: state.scenario,
    tick: state.tick,
    metrics: state.metrics,
    fullscreenExercised: true,
    replayUrlCopied: true,
  };
  await desktop.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const mobilePage = await mobile.newPage();
  observe(mobilePage, "mobile");
  await mobilePage.goto(`${baseUrl}/?seed=POCKET-3&scenario=nominal`, { waitUntil: "networkidle" });
  await waitForHook(mobilePage);
  await mobilePage.locator("#advance-10").click();
  const mobileState = await readState(mobilePage);
  assert.equal(mobileState.tick, 10);

  const layout = await mobilePage.evaluate(() => {
    const controls = [...document.querySelectorAll(".control-panel button")];
    const canvas = document.querySelector("canvas");
    return {
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      minimumControlHeight: Math.min(...controls.map((control) => control.getBoundingClientRect().height)),
      canvasRight: canvas?.getBoundingClientRect().right ?? 0,
    };
  });
  assert.ok(layout.documentWidth <= layout.viewportWidth + 1, "mobile layout must not overflow horizontally");
  assert.ok(layout.minimumControlHeight >= 44, "mobile control targets must be at least 44px high");
  assert.ok(layout.canvasRight <= layout.viewportWidth + 1, "canvas must remain inside the mobile viewport");
  await mobilePage.screenshot({ path: path.join(outputDir, "queueglass-mobile.png"), fullPage: true });
  proof.mobile = { seed: mobileState.seed, scenario: mobileState.scenario, tick: mobileState.tick, layout };
  await mobile.close();

  assert.deepEqual(externalRequests, [], `unexpected external requests:\n${externalRequests.join("\n")}`);
  assert.deepEqual(browserErrors, [], `browser errors:\n${browserErrors.join("\n")}`);
  proof.externalRequests = externalRequests;
  proof.browserErrors = browserErrors;
  await writeFile(path.join(outputDir, "browser-smoke-state.json"), `${JSON.stringify(proof, null, 2)}\n`);
  console.log("Browser smoke passed: deterministic replay, controls, fullscreen, responsive layout, and captures verified.");
} finally {
  await browser.close();
}
