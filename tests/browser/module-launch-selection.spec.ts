import { once } from "node:events";
import type { Server } from "node:http";
import { expect, test } from "@playwright/test";
// @ts-expect-error Local executable browser fixture with no wallet or RPC calls.
import { createModuleLaunchSelectionServer } from "./fixtures/module-launch-selection-server.mjs";
// @ts-expect-error Local executable studio fixture with no wallet or RPC calls.
import { createModuleStudioServer } from "./fixtures/module-studio-server.mjs";

let server: Server, origin: string;
test.beforeAll(async () => {
  server = await createModuleLaunchSelectionServer(); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture did not start");
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { if (server) { server.close(); await once(server, "close"); } });

test("restoring a completed launch keeps the new draft open without background recovery reads", async ({ page }) => {
  const studio = await createModuleStudioServer(); studio.listen(0, "127.0.0.1"); await once(studio, "listening");
  const address = studio.address(); if (!address || typeof address === "string") throw new Error("Fixture did not start");
  const apiCalls: string[] = [];
  page.on("request", request => { if (new URL(request.url()).pathname.startsWith("/api/")) apiCalls.push(request.url()); });
  try {
    const url = `http://127.0.0.1:${address.port}/?mode=restored-launch`;
    await page.goto(url);
    await expect(page.getByRole("heading", { name: "Module Mode", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open your previous coin", exact: true })).toBeVisible();
    await page.getByLabel("Name", { exact: true }).fill("My next coin");
    await expect(page).toHaveURL(url);
    expect(apiCalls).toEqual([]);
    await page.getByRole("button", { name: "Open your previous coin", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText("Your previous launch could not be checked yet. Try opening it again.");
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("My next coin");
    await expect(page).toHaveURL(url);
    expect(apiCalls).toHaveLength(1);
  } finally { studio.close(); await once(studio, "close"); }
});

for (const width of [1440, 390, 320]) {
  test(`selection explains fees, keeps button size, and restores settings at ${width}px`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.setViewportSize({ width, height: 900 }); await page.goto(origin);
    const summary = page.getByRole("complementary");
    await expect(summary).toContainText("Includes the 0.10% platform fee.");
    const trigger = page.getByRole("button", { name: "Add modules", exact: true });
    await trigger.press("Enter");
    const dialog = page.getByRole("dialog"), card = dialog.getByRole("article");
    await expect(dialog.getByText("Estimated platform fee: 0.30% per trade.", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("searchbox")).toBeHidden();
    await expect(card).toHaveCount(1);
    const add = dialog.getByRole("button", { name: "Add Opening buy cap", exact: true });
    const before = await add.boundingBox(), cardBefore = await card.boundingBox();
    expect(before!.height).toBeGreaterThanOrEqual(44);
    await add.press("Enter");
    const remove = dialog.getByRole("button", { name: "Remove Opening buy cap", exact: true });
    await expect(remove).toHaveText("Remove"); await expect(remove).toHaveAttribute("aria-pressed", "true");
    const after = await remove.boundingBox(), cardAfter = await card.boundingBox();
    expect(after!.width).toBeCloseTo(before!.width, 0); expect(after!.height).toBeCloseTo(before!.height, 0);
    expect(cardAfter!.height).toBeCloseTo(cardBefore!.height, 0);
    await page.screenshot({ path: testInfo.outputPath(`selection-${width}.png`) });
    await remove.press("Enter"); await expect(add).toHaveText("Add"); await add.press("Enter");
    await dialog.getByRole("button", { name: "Done", exact: true }).press("Enter");
    await expect(trigger).toBeFocused();
    await expect(summary).toContainText("Includes the 0.30% platform fee.");
    const configure = page.getByRole("button", { name: "Configure Opening buy cap", exact: true });
    await configure.press("Enter");
    await dialog.getByLabel("Maximum ETH per wallet (ETH)", { exact: true }).fill("0.25");
    await page.keyboard.press("Escape"); await expect(configure).toBeFocused();
    await page.getByRole("button", { name: "Remove Opening buy cap", exact: true }).press("Enter");
    await expect(summary).toContainText("Includes the 0.10% platform fee.");
    await page.getByRole("button", { name: "Undo", exact: true }).press("Enter");
    await expect(configure).toBeFocused(); await configure.press("Enter");
    await expect(dialog.getByLabel("Maximum ETH per wallet (ETH)", { exact: true })).toHaveValue("0.25");
    await page.screenshot({ path: testInfo.outputPath(`configuration-${width}.png`) });
    await page.keyboard.press("Escape");
    await page.emulateMedia({ reducedMotion: "reduce" }); await trigger.click();
    expect(await dialog.evaluate(element => element.getAnimations().length)).toBe(0);
    await dialog.getByRole("button", { name: "Done", exact: true }).click(); await expect(dialog).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test("a delayed remove frame cannot steal the next Undo keyboard activation", async ({ page }) => {
  await page.addInitScript(() => {
    const requestFrame = window.requestAnimationFrame.bind(window);
    const cancelFrame = window.cancelAnimationFrame.bind(window);
    const frames = new Map<number, FrameRequestCallback>();
    let hold = false, nextId = -1;
    window.addEventListener("hold-module-selection-frames", () => { hold = true; });
    window.addEventListener("flush-module-selection-frames", () => {
      hold = false;
      const pending = [...frames.values()]; frames.clear();
      for (const callback of pending) callback(performance.now());
    });
    window.requestAnimationFrame = callback => {
      if (!hold) return requestFrame(callback);
      const id = nextId--; frames.set(id, callback); return id;
    };
    window.cancelAnimationFrame = id => { if (!frames.delete(id)) cancelFrame(id); };
  });
  await page.setViewportSize({ width: 320, height: 900 }); await page.goto(origin);
  const trigger = page.getByRole("button", { name: "Add modules", exact: true });
  await trigger.press("Enter");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Add Opening buy cap", exact: true }).press("Enter");
  await dialog.getByRole("button", { name: "Done", exact: true }).press("Enter");
  const configure = page.getByRole("button", { name: "Configure Opening buy cap", exact: true });
  await configure.press("Enter");
  await dialog.getByLabel("Maximum ETH per wallet (ETH)", { exact: true }).fill("0.25");
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.dispatchEvent(new Event("hold-module-selection-frames")));
  await page.getByRole("button", { name: "Remove Opening buy cap", exact: true }).press("Enter");
  await expect(page.getByRole("complementary")).toContainText("Includes the 0.10% platform fee.");
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await undo.focus();
  await page.evaluate(() => window.dispatchEvent(new Event("flush-module-selection-frames")));
  await expect(undo).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(configure).toBeFocused();
  await expect(page.getByRole("complementary")).toContainText("Includes the 0.30% platform fee.");
  await configure.press("Enter");
  await expect(dialog.getByLabel("Maximum ETH per wallet (ETH)", { exact: true })).toHaveValue("0.25");
});

test("empty and single-template libraries keep irrelevant controls out of the flow", async ({ page }) => {
  await page.goto(`${origin}?mode=empty`); await page.getByRole("button", { name: "Add modules", exact: true }).click();
  await expect(page.getByText("No modules available yet", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear filters", exact: true })).toHaveCount(0);
  await page.goto(`${origin}?mode=engine`);
  await expect(page.getByRole("button", { name: "Choose module Timed escrow", exact: true })).toBeVisible();
  await expect(page.getByRole("searchbox")).toBeHidden(); await expect(page.getByRole("combobox")).toBeHidden();
  await page.goto(`${origin}?mode=unknown`); await page.getByRole("button", { name: "Add modules", exact: true }).click();
  await expect(page.getByText("Platform fee unavailable.", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).not.toContainText("0.30%");
});

test.describe("Module Studio", () => {
  let studioServer: Server, studioOrigin: string;
  test.beforeAll(async () => {
    studioServer = await createModuleStudioServer(); studioServer.listen(0, "127.0.0.1"); await once(studioServer, "listening");
    const address = studioServer.address(); if (!address || typeof address === "string") throw new Error("Fixture did not start");
    studioOrigin = `http://127.0.0.1:${address.port}`;
  });
  test.afterAll(async () => { if (studioServer) { studioServer.close(); await once(studioServer, "close"); } });

  test("quote toggle restores a saved choice but respects an explicitly cleared address", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 }); await page.goto(studioOrigin);
    const toggle = page.getByRole("switch", { name: "Any Quote Pool", exact: true });
    const address = page.getByLabel("Quote token address", { exact: true });
    const node = page.locator('[data-node-id="quote"]');
    await expect(node).toHaveCount(0);
    await toggle.click(); await address.fill("0x1111111111111111111111111111111111111111");
    await toggle.click(); await expect(node).toHaveCount(0);
    await expect(page.locator('[data-node-id="coin"]')).toContainText("$COIN / ETH");
    await toggle.click(); await expect(address).toHaveValue("0x1111111111111111111111111111111111111111");
    await address.fill(""); await toggle.click(); await toggle.click();
    await expect(address).toHaveValue(""); await expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  test("coin fields keep exact names after validation and describe their errors", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 }); await page.goto(`${studioOrigin}?mode=error`);
    const name = page.getByLabel("Name", { exact: true });
    await expect(name).toHaveAccessibleDescription("Enter a coin name");
    await name.fill("Garden");
    await page.getByLabel("Ticker", { exact: true }).fill("$GARDEN");
    await expect(page.getByLabel("Ticker", { exact: true })).toHaveValue("GARDEN");
    await page.getByRole("button", { name: "Links", exact: true }).click();
    await page.getByLabel("X", { exact: true }).fill("@ garden");
    await page.getByLabel("Telegram", { exact: true }).fill("@garden");
    await page.getByRole("button", { name: "Add other link", exact: true }).click();
    await expect(page.getByLabel("X", { exact: true })).toHaveValue("https://x.com/garden");
    await expect(page.getByLabel("Telegram", { exact: true })).toHaveValue("https://t.me/garden");
    await page.getByLabel("Other link 1", { exact: true }).fill("garden.example");
    await page.getByRole("button", { name: "Links", exact: true }).click();
    await expect(page.getByRole("button", { name: "Links", exact: true })).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("textbox", { name: "Other link 1", exact: true })).toHaveCount(0);
  });

  test("a creator fee error returns to its visible coin field from a module", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 }); await page.goto(`${studioOrigin}?mode=fees`);
    const navigation = page.getByRole("navigation", { name: "Studio panels" });
    await navigation.getByRole("button", { name: "Modules", exact: true }).click();
    await page.getByRole("switch", { name: "Initial wallet buy limit", exact: true }).click();
    await page.getByRole("button", { name: "Review coin", exact: true }).click();
    const fee = page.getByLabel("Creator fees · %", { exact: true });
    await expect(fee).toBeVisible();
    await expect(fee).toHaveAttribute("aria-invalid", "true");
    await expect(fee).toHaveAccessibleDescription("Choose a whole percentage from 0% to 10%.");
    await expect(page.getByRole("heading", { name: "Coin details", exact: true })).toBeVisible();
  });

  for (const width of [390, 320]) {
    test(`validation highlights the visible panel and still allows navigation at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 }); await page.goto(`${studioOrigin}?mode=error`);
      const navigation = page.getByRole("navigation", { name: "Studio panels" });
      const settings = navigation.getByRole("button", { name: "Settings", exact: true });
      const modules = navigation.getByRole("button", { name: "Modules", exact: true });
      const canvas = navigation.getByRole("button", { name: "Your coin", exact: true });
      await expect(settings).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("#foundation-name")).toBeVisible();
      await modules.click(); await expect(modules).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("switch", { name: "Any Quote Pool", exact: true })).toBeVisible();
      await expect(page.locator("#foundation-name")).toBeHidden();
      await canvas.click(); await expect(canvas).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("button", { name: "Edit coin details", exact: true })).toBeVisible();
      await settings.click(); await expect(page.locator("#foundation-name")).toBeVisible();
    });
  }

  test("resubmitting unchanged validation errors reveals coin details from a module inspector", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 }); await page.goto(`${studioOrigin}?mode=error`);
    await page.getByRole("switch", { name: "Initial wallet buy limit", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Initial wallet buy limit", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Review coin", exact: true }).click();
    await expect(page.locator("#foundation-name")).toBeVisible();
    await page.getByRole("button", { name: "Edit Initial wallet buy limit", exact: true }).click();
    await page.getByRole("button", { name: "Review coin", exact: true }).click();
    await expect(page.locator("#foundation-name")).toBeVisible();
    await expect(page.getByText("Enter a coin name", { exact: true })).toBeVisible();
  });

  test("dragging a module flower moves its card and line while the coin stays centered", async ({ page }) => {
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 900 }); await page.goto(studioOrigin);
    await page.getByRole("switch", { name: "Initial wallet buy limit", exact: true }).click();
    const moduleCard = page.locator('[data-node-id="wallet-cap-fixture"]');
    const coin = page.locator('[data-node-id="coin"]');
    await expect(moduleCard).toBeVisible();
    const before = await moduleCard.boundingBox(), coinBefore = await coin.boundingBox();
    const flower = await moduleCard.locator('[data-flower]').boundingBox();
    const line = page.locator('section[aria-label="Coin composition"] svg path').first();
    await expect(line).toBeVisible(); const pathBefore = await line.getAttribute("d");
    await page.mouse.move(flower!.x + flower!.width / 2, flower!.y + flower!.height / 2);
    await page.mouse.down(); await page.mouse.move(flower!.x + flower!.width / 2 + 30, flower!.y + flower!.height / 2 + 150, { steps: 8 }); await page.mouse.up();
    await expect.poll(async () => (await moduleCard.boundingBox())!.y).toBeGreaterThan(before!.y + 40);
    const after = await moduleCard.boundingBox(), coinAfter = await coin.boundingBox();
    expect(coinAfter!.x).toBeCloseTo(coinBefore!.x, 1); expect(coinAfter!.y).toBeCloseTo(coinBefore!.y, 1);
    expect(after!.x + after!.width <= coinAfter!.x || after!.x >= coinAfter!.x + coinAfter!.width || after!.y + after!.height <= coinAfter!.y || after!.y >= coinAfter!.y + coinAfter!.height).toBe(true);
    await expect(line).not.toHaveAttribute("d", pathBefore!);
    expect(errors).toEqual([]);
  });
});
