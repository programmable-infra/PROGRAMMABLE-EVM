import { once } from "node:events";
import type { Server } from "node:http";
import { expect, test, type Page } from "@playwright/test";
// @ts-expect-error The esbuild fixture host is a JavaScript module.
import { createWalletSessionServer } from "./fixtures/wallet-session-server.mjs";

let server: Server, origin: string;
test.beforeAll(async () => {
  server = await createWalletSessionServer({ moduleSigning: true });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture port");
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { server?.close(); if (server) await once(server, "close"); });
test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(origin + "/profile");
  await expect(page.getByLabel("Session ready", { exact: true })).toHaveText("true");
});

async function signing(page: Page) {
  await expect(page.getByRole("dialog", { name: "Transaction signing fixture" })).toBeVisible();
  await expect(page.getByLabel("Module signing prompt count")).toHaveText("1");
  await expect(page.getByLabel("Module request marker count")).toHaveText("1");
  const calls = JSON.parse(await page.getByLabel("SDK calls", { exact: true }).innerText()) as { method: string }[];
  expect(calls.some(call => /^(login|linkWallet|personal_sign|eth_signTypedData_v4|forbidden-wallet-operation)$/.test(call.method))).toBe(false);
}

for (const chain of ["Ethereum", "Robinhood"]) {
  test(`${chain}: SDK method refresh during preparation preserves the real wallet and opens one signing window`, async ({ page }) => {
    if (chain === "Ethereum") {
      await page.getByRole("button", { name: "Request Ethereum wallet network", exact: true }).click();
      await expect(page.getByLabel("Network switch results")).toHaveText("[true]");
    }
    await page.getByRole("button", { name: "Hold fresh validation" }).click();
    await page.getByRole("button", { name: `Launch ${chain} fixture` }).click();
    await expect(page.getByLabel("Module validation count")).toHaveText("1");
    await page.getByRole("button", { name: "Refresh SDK methods without changing provider" }).click();
    await page.getByRole("button", { name: "Finish fresh validation" }).click();
    await signing(page);
    const tx = JSON.parse(await page.getByLabel("Module signing request").innerText())[0];
    expect(tx).toMatchObject({ from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", data: "0x12345678", value: "0x0", nonce: "0x7" });
  });
  test(`${chain}: rejection releases the wallet lock for a new attempt`, async ({ page }) => {
    await page.getByRole("button", { name: `Launch ${chain} fixture` }).click();
    await signing(page);
    await page.getByRole("button", { name: "Reject fixture signature" }).click();
    await expect(page.getByLabel("Module signing result")).toContainText("attempted=true");
    await page.getByRole("button", { name: `Launch ${chain} fixture` }).click();
    await expect(page.getByLabel("Module signing prompt count")).toHaveText("2");
    await expect(page.getByLabel("Module request marker count")).toHaveText("2");
    await page.getByRole("button", { name: "Confirm fixture signature" }).click();
    await expect(page.getByLabel("Module signing result")).toHaveText("submitted");
  });
}

test("Ethereum: a normal SDK network update can rewrap its methods before signing", async ({ page }) => {
  await page.getByRole("button", { name: "Rebuild SDK methods on network update" }).click();
  await page.getByRole("button", { name: "Launch Ethereum fixture" }).click();
  await signing(page);
});

test("a delayed event confirming the verified network does not cancel signing", async ({ page }) => {
  await page.getByRole("button", { name: "Keep the SDK network label stale", exact: true }).click();
  await page.getByLabel("Provider chain format", { exact: true }).selectOption("hex");
  await page.getByRole("button", { name: "Hold fresh validation" }).click();
  await page.getByRole("button", { name: "Launch Ethereum fixture" }).click();
  await expect(page.getByLabel("Module validation count")).toHaveText("1");
  await page.getByRole("button", { name: "Refresh SDK methods without changing provider" }).click();
  await page.getByRole("button", { name: "MetaMask selects Ethereum", exact: true }).click();
  await page.getByRole("button", { name: "Finish fresh validation" }).click();
  await signing(page);
});

for (const change of ["Replace connected wallet capability", "Return a different provider account", "MetaMask selects wallet B", "Change SDK user, same linked addresses", "Return the wrong provider network"]) {
  test(`a pending signature is stopped after: ${change}`, async ({ page }) => {
    await page.getByRole("button", { name: "Request Ethereum wallet network", exact: true }).click();
    await expect(page.getByLabel("Network switch results")).toHaveText("[true]");
    await page.getByRole("button", { name: "Hold fresh validation" }).click();
    await page.getByRole("button", { name: "Launch Ethereum fixture" }).click();
    await expect(page.getByLabel("Module validation count")).toHaveText("1");
    await page.getByRole("button", { name: change, exact: true }).click();
    await page.getByRole("button", { name: "Finish fresh validation" }).click();
    await expect(page.getByLabel("Module signing result")).toContainText("attempted=false");
    await expect(page.getByLabel("Module signing prompt count")).toHaveText("0");
  });
}

test("duplicate launch clicks cannot open a second signing window", async ({ page }) => {
  await page.getByRole("button", { name: "Hold fresh validation" }).click();
  await page.getByRole("button", { name: "Launch Robinhood fixture" }).dblclick();
  await expect(page.getByLabel("Module validation count")).toHaveText("1");
  await page.getByRole("button", { name: "Finish fresh validation" }).click();
  await signing(page);
});

test("embedded Ethereum signing keeps the reviewed chain, gas and nonce", async ({ page }) => {
  await page.getByRole("button", { name: "Use embedded fixture wallet" }).click();
  await page.getByRole("button", { name: "Launch Ethereum fixture" }).click();
  await signing(page);
  expect(JSON.parse(await page.getByLabel("Module signing request").innerText())).toMatchObject({ chainId: 1, nonce: 7, gas: "100000", data: "0x12345678" });
});

test("a network change away and back invalidates the in-flight preparation", async ({ page }) => {
  await page.getByRole("button", { name: "Request Ethereum wallet network", exact: true }).click();
  await expect(page.getByLabel("Network switch results")).toHaveText("[true]");
  await page.getByRole("button", { name: "Hold fresh validation" }).click();
  await page.getByRole("button", { name: "Launch Ethereum fixture" }).click();
  await expect(page.getByLabel("Module validation count")).toHaveText("1");
  await page.getByRole("button", { name: "MetaMask selects Robinhood", exact: true }).click();
  await page.getByRole("button", { name: "MetaMask selects Ethereum", exact: true }).click();
  await page.getByRole("button", { name: "Finish fresh validation" }).click();
  await expect(page.getByLabel("Module signing result")).toContainText("attempted=false");
  await expect(page.getByLabel("Module signing prompt count")).toHaveText("0");
});

test("an unresponsive extension stops passive checks without leaving an endless signing state", async ({ page }) => {
  await page.getByRole("button", { name: "Hold fresh validation" }).click();
  await page.getByRole("button", { name: "Launch Robinhood fixture" }).click();
  await expect(page.getByLabel("Module validation count")).toHaveText("1");
  await page.getByRole("button", { name: "Stop answering account reads" }).click();
  await page.getByRole("button", { name: "Finish fresh validation" }).click();
  await expect(page.getByLabel("Module signing result")).toContainText("not responding", { timeout: 8000 });
  await expect(page.getByLabel("Module signing result")).toContainText("attempted=false");
  await expect(page.getByLabel("Module signing prompt count")).toHaveText("0");
});
