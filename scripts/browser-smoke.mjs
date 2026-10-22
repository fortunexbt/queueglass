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
  await open(page);

  // The default cascade replay starts on its own and is labelled as simulated.
  const initial = await readState(page);
  assert.equal(initial.scenario, "cascade");
  assert.match(initial.label, /SIMULATED/);
  await assert.doesNotReject(page.locator(".truth-badge").waitFor());
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).tick >= 2);
  assert.equal((await readState(page)).playing, true);

  // Transport: pause holds the tick, steps move exactly one tick, restart returns to 0.
  await page.locator("#toggle-play").click();
  const paused = (await readState(page)).tick;
  await page.waitForTimeout(900);
  assert.equal((await readState(page)).tick, paused);
  await page.locator("#step-forward").click();
  assert.equal((await readState(page)).tick, paused + 1);
  await page.locator("#step-back").click();
  assert.equal((await readState(page)).tick, paused);
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

  // Scrubbing to the fault window shows Check as the highlighted bottleneck.
  await seek(page, 15);
  const cascade = await readState(page);
  assert.equal(cascade.frame.bottleneck, "policy");
  assert.equal(await page.locator("#stage-policy").getAttribute("data-status"), "bottleneck");
  assert.match(await page.locator("#board-title").innerText(), /check is the bottleneck/i);
  for (const stage of cascade.frame.stages.filter((entry) => entry.blocked)) {
    assert.equal(await page.locator(`#stage-${stage.id}`).getAttribute("data-status"), "blocked");
  }
  await page.screenshot({ path: path.join(outputDir, "queueglass-desktop.png") });

  // Dragging across the lanes seeks too.
  const plot = await page.locator("[class*='plot']").boundingBox();
  await page.mouse.click(plot.x + plot.width / 2, plot.y + 20);
  const dragged = (await readState(page)).tick;
  assert.ok(dragged >= 28 && dragged <= 32, `pointer seek landed on tick ${dragged}`);

  // Presets reset the settings and replay from tick 0.
  await page.locator("#scenario-burst").click();
  const burst = await readState(page);
  assert.equal(burst.scenario, "burst");
  assert.equal(burst.tick, 0);
  assert.equal(await page.locator("#scenario-burst").getAttribute("aria-pressed"), "true");
  await page.locator("#toggle-play").click();

  // Capacity edits recompute the run and travel in the share link.
  await page.getByRole("button", { name: "Lower check capacity" }).click();
  const edited = await readState(page);
  assert.deepEqual(edited.settings.capacities, [4, 4, 2, 4]);
  assert.match(page.url(), /caps=4-4-2-4/);
  await page.getByRole("button", { name: "Back to the preset" }).click();
  assert.doesNotMatch(page.url(), /caps=/);

  // A seed, scenario and settings reproduce the same frames in a fresh page.
  await page.locator("#seed-input").fill("smoke replay");
  await page.getByRole("button", { name: "Apply" }).click();
  await page.getByRole("button", { name: "Raise arrivals per tick" }).click();
  await seek(page, 30);
  const original = await readState(page);
  assert.equal(original.seed, "SMOKE-REPLAY");
  await page.locator("#copy-link").click();
  await page.getByText("Link copied", { exact: true }).waitFor();
  const shared = await page.evaluate(() => navigator.clipboard.readText());
  const replay = await context.newPage();
  observe(replay, "replay");
  await replay.goto(shared);
  await replay.waitForFunction(() => typeof window.render_game_to_text === "function");
  await seek(replay, 30);
  assert.deepEqual((await readState(replay)).frame, original.frame);

  // Unknown routes get the 404 page. Not observed: the browser logs the 404 response itself.
  const lost = await context.newPage();
  const missing = await lost.goto(`${baseUrl}/not-a-page`);
  assert.equal(missing.status(), 404);
  assert.match(await lost.locator("h1").innerText(), /not in the run/i);

  // Phone: the flow stacks top to bottom without sideways scrolling.
  const phone = await browser.newContext({ ...devices["iPhone 13"] });
  const mobile = await phone.newPage();
  observe(mobile, "mobile");
  await open(mobile);
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  const receive = await mobile.locator("#stage-intake").boundingBox();
  const finish = await mobile.locator("#stage-dispatch").boundingBox();
  assert.ok(finish.y > receive.y + receive.height, "steps stack vertically on a phone");
  await mobile.screenshot({ path: path.join(outputDir, "queueglass-mobile.png") });

  // Reduced motion: nothing starts moving on its own.
  const calm = await browser.newContext({ reducedMotion: "reduce" });
  const still = await calm.newPage();
  observe(still, "reduced-motion");
  await open(still);
  await still.waitForTimeout(1500);
  assert.equal((await readState(still)).tick, 0);

  assert.deepEqual(browserErrors, []);
  assert.deepEqual(externalRequests, []);
  console.log("Browser smoke passed: playback, scrubbing, presets, settings, replay links, 404, phone and reduced motion.");
} finally {
  await browser.close();
}
