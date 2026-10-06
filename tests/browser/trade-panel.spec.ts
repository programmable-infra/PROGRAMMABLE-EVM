import { once } from "node:events";
import type { Server } from "node:http";
import { expect, test } from "@playwright/test";
// @ts-expect-error Executable fixture using the production native dialog components.
import { createTradePanelServer } from "./fixtures/trade-panel-server.mjs";

let server: Server, origin: string;
test.beforeAll(async () => {
  server = await createTradePanelServer(); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture failed");
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { server.close(); await once(server, "close"); });

test("mobile trade stays open when pool loading replaces the adapter", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto(origin);
  await page.getByRole("button", { name: "Trade TEST", exact: true }).click();
  await page.getByRole("button", { name: "Finish loading" }).click();
  await expect(page.getByLabel("Amount")).toBeVisible();
  expect(await page.getByRole("dialog").evaluate(element => element.matches(":modal"))).toBe(true);
  await page.getByRole("button", { name: "Refresh adapter" }).click();
  await expect(page.getByLabel("Amount")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("button", { name: "Trade TEST", exact: true })).toBeFocused();
  expect(errors).toEqual([]);
});

test("closed sheets stay closed after loading and wallet handoff", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto(origin);
  await page.getByRole("button", { name: "Trade TEST", exact: true }).click();
  await page.getByRole("button", { name: "Close trade" }).click();
  await page.getByRole("button", { name: "Resolve pool externally" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", { name: "Trade TEST", exact: true }).click();
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", { name: "Trade TEST", exact: true }).click();
  await page.getByRole("button", { name: "Next coin" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("desktop remains nonmodal and resizing does not reopen the mobile sheet", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 }); await page.goto(origin);
  await page.getByRole("button", { name: "Finish loading" }).click();
  await expect(page.getByLabel("Amount")).toBeVisible();
  expect(await page.getByRole("dialog").evaluate(element => element.matches(":modal"))).toBe(false);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", { name: "Trade TEST", exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByLabel("Amount")).toBeVisible();
  await expect.poll(() => page.getByRole("dialog").evaluate(element => element.matches(":modal"))).toBe(false);
});
