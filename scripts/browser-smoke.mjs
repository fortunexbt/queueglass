import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, devices } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(root, "output");
const baseUrl = process.env.QUEUEGLASS_BASE_URL ?? "http://127.0.0.1:4173";
const origin = new URL(baseUrl).origin;
const browserErrors = [];
const externalRequests = [];

await mkdir(outputDir, { recursive: true });

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
  return page.evaluate(() => JSON.parse(window.render_game_to_text()));
}

async function open(page, query = "") {
  await page.goto(`${baseUrl}/${query}`);
  await page.waitForFunction(() => typeof window.render_game_to_text === "function");
}

async function seek(page, tick) {
  const slider = page.locator("#timeline-scrubber");
  await slider.focus();
  await page.keyboard.press("Home");
  for (let step = 0; step < tick; step += 1) await page.keyboard.press("ArrowRight");
  assert.equal((await readState(page)).tick, tick);
}

const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  observe(page, "desktop");
  const serverUrls = [];
  page.on("request", (request) => serverUrls.push(request.url()));
  await open(page);

  // The BPI 2019 example opens on its worst day with a computed verdict.
  const initial = await readState(page);
  assert.equal(initial.isExample, true);
  assert.equal(initial.verdict.title, "Goods receipt limits flow.");
  assert.equal(initial.tick, initial.peak.period);
  assert.equal(initial.playing, false);
  assert.equal(await page.locator("#stage-0").getAttribute("data-status"), "bottleneck");
  assert.match(await page.locator(".verdict").innerText(), /BPI Challenge 2019/);
  await page.screenshot({ path: path.join(outputDir, "queueglass-desktop.png") });

  // Transport: play advances, pause holds, steps move exactly one period, restart returns to 0.
  await page.locator("#toggle-play").click();
  await page.waitForFunction((from) => JSON.parse(window.render_game_to_text()).tick > from, initial.tick);
  await page.locator("#toggle-play").click();
  const paused = (await readState(page)).tick;
  await page.waitForTimeout(400);
  assert.equal((await readState(page)).tick, paused);
  await page.locator("#step-back").click();
  assert.equal((await readState(page)).tick, paused - 1);
  await page.locator("#restart").click();
  assert.equal((await readState(page)).tick, 0);
  assert.equal(await page.locator("#step-back").isDisabled(), true);

  // Keyboard: arrows step and Space plays or pauses when nothing interactive has focus.
  await page.locator("h1").click();
  await page.keyboard.press("ArrowRight");
  assert.equal((await readState(page)).tick, 1);
  await page.keyboard.press("Space");
  assert.equal((await readState(page)).playing, true);
  await page.keyboard.press("Space");
  assert.equal((await readState(page)).playing, false);

  // The slider and the lanes both seek.
  await seek(page, 12);
  const plot = await page.locator("[class*='plot']").boundingBox();
  await page.mouse.click(plot.x + plot.width / 2, plot.y + 20);
  const { tick: dragged, last } = await readState(page);
  assert.ok(Math.abs(dragged - last / 2) <= 3, `pointer seek landed on period ${dragged} of ${last}`);

  // Editing a capacity reruns everything and moves the line into the fragment.
  await page.locator("#step-capacity-0").fill("60");
  const raised = await readState(page);
  assert.equal(raised.isExample, false);
  assert.equal(raised.setup.line.stages[0].capacity, 60);
  assert.notEqual(raised.verdict.title, "Goods receipt limits flow.");
  assert.match(new URL(page.url()).hash, /s=Goods\+receipt%3A60/);
  await page.getByRole("button", { name: "Load the BPI 2019 example" }).click();
  assert.equal((await readState(page)).isExample, true);
  assert.equal(new URL(page.url()).hash, "");

  // A team's own line: two named steps and the Created column of a tracker export.
  await page.locator("#step-name-0").fill("Review");
  await page.locator("#step-capacity-0").fill("3");
  await page.locator("#step-name-1").fill("Merge");
  await page.locator("#step-capacity-1").fill("2");
  await page.getByRole("button", { name: "Remove step 3" }).click();
  const created = ["Created", "2026-03-02T09:00:00Z", "2026-03-02T11:00:00Z", "2026-03-02T15:00:00Z", "2026-03-02T16:00:00Z", "2026-03-03T10:00:00Z", "2026-03-05T10:00:00Z"];
  await page.locator("#arrivals-input").fill(created.join("\n"));
  await page.getByRole("button", { name: "Replay these arrivals" }).click();
  const team = await readState(page);
  assert.deepEqual(team.setup.line.stages, [{ name: "Review", capacity: 3 }, { name: "Merge", capacity: 2 }]);
  assert.deepEqual(team.setup.line.arrivals, [4, 1, 0, 1]);
  assert.equal(team.setup.start, "2026-03-02");
  assert.equal(team.verdict.title, "Merge limits flow.");
  assert.match(await page.locator(".arrivals-status").innerText(), /Replaying 4 days, starting 2 Mar 2026\. Skipped 1 line/);

  // WIP limit and weekly periods travel in the fragment too.
  await page.getByLabel("WIP limit").fill("2");
  await page.getByRole("button", { name: "Per week" }).click();
  const weekly = await readState(page);
  assert.equal(weekly.setup.line.bufferLimit, 2);
  assert.equal(weekly.setup.unit, "week");
  assert.deepEqual(weekly.setup.line.arrivals, [6]);

  // Adding steps stops at eight.
  for (let count = 2; count < 8; count += 1) await page.getByRole("button", { name: "Add a step" }).click();
  assert.equal((await readState(page)).setup.line.stages.length, 8);
  assert.equal(await page.getByRole("button", { name: "Add a step" }).isDisabled(), true);
  await page.screenshot({ path: path.join(outputDir, "queueglass-eight-steps.png") });

  // The share link rebuilds the same line in a fresh page, and the server never sees it.
  const original = await readState(page);
  await page.locator("#copy-link").click();
  await page.getByText("Link copied", { exact: true }).waitFor();
  const shared = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(shared, /#.*a=6/);
  const replay = await context.newPage();
  observe(replay, "replay");
  const replayUrls = [];
  replay.on("request", (request) => replayUrls.push(request.url()));
  await replay.goto(shared);
  await replay.waitForFunction(() => typeof window.render_game_to_text === "function");
  await replay.waitForFunction(() => JSON.parse(window.render_game_to_text()).isExample === false);
  const restored = await readState(replay);
  assert.deepEqual(restored.setup, original.setup);
  assert.deepEqual(restored.verdict, original.verdict);
  assert.equal(await replay.locator("#step-name-0").inputValue(), "Review");
  for (const url of [...serverUrls, ...replayUrls]) assert.doesNotMatch(url, /Review|a=6/);

  // Unknown routes get the 404 page. Not observed: the browser logs the 404 response itself.
  const lost = await context.newPage();
  const missing = await lost.goto(`${baseUrl}/not-a-page`);
  assert.equal(missing.status(), 404);

  // Phone: the flow stacks top to bottom without sideways scrolling.
  const phone = await browser.newContext({ ...devices["iPhone 13"] });
  const mobile = await phone.newPage();
  observe(mobile, "mobile");
  await open(mobile);
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  const first = await mobile.locator("#stage-0").boundingBox();
  const third = await mobile.locator("#stage-2").boundingBox();
  assert.ok(third.y > first.y + first.height, "steps stack vertically on a phone");
  await mobile.screenshot({ path: path.join(outputDir, "queueglass-mobile.png") });

  // Reduced motion: nothing starts moving on its own.
  const calm = await browser.newContext({ reducedMotion: "reduce" });
  const still = await calm.newPage();
  observe(still, "reduced-motion");
  await open(still);
  const start = (await readState(still)).tick;
  await still.waitForTimeout(1000);
  assert.equal((await readState(still)).tick, start);

  assert.deepEqual(browserErrors, []);
  assert.deepEqual(externalRequests, []);
  console.log("Browser smoke passed: example verdict, playback, scrubbing, your own line, WIP and weeks, share links, 404, phone and reduced motion.");
} finally {
  await browser.close();
}
