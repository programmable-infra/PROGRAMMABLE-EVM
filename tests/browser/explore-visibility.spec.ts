import { once } from 'node:events';
import type { Server } from 'node:http';
import { expect, test } from '@playwright/test';
// @ts-expect-error Executable fixture with no production provider calls.
import { createExploreVisibilityServer } from './fixtures/explore-visibility-server.mjs';
let server: Server, origin: string;
test.beforeAll(async () => {
  server = await createExploreVisibilityServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address=server.address(); if(!address||typeof address==='string') throw Error('Fixture did not start');
  origin=`http://127.0.0.1:${address.port}`;
});
test.afterAll(async()=>{if(server){server.close(); await once(server,'close');}});

test('embedded Explore loads on approach, pauses offscreen, and reuses its recent result',async({page})=>{
  let requests=0; page.on('request',r=>{if(new URL(r.url()).pathname==='/api/explore/launches') requests++;});
  await page.clock.install(); await page.goto(origin);
  await expect(page.getByRole('heading',{name:'Explore',exact:true})).toHaveCount(1);
  await page.clock.runFor(31_000); expect(requests).toBe(0);
  await page.getByRole('heading',{name:'Explore',exact:true}).scrollIntoViewIfNeeded();
  await expect(page.getByRole('heading',{name:'No launches yet',exact:true})).toBeVisible(); expect(requests).toBe(1);
  await page.getByRole('heading',{name:'Introduction',exact:true}).scrollIntoViewIfNeeded();
  await expect(page.getByRole('heading',{name:'Explore',exact:true})).not.toBeInViewport();
  await page.clock.runFor(1_000);
  await page.getByRole('heading',{name:'Explore',exact:true}).scrollIntoViewIfNeeded();
  await page.clock.runFor(1_000); expect(requests).toBe(1);
  await page.getByRole('heading',{name:'Introduction',exact:true}).scrollIntoViewIfNeeded();
  await expect(page.getByRole('heading',{name:'Explore',exact:true})).not.toBeInViewport();
  await page.clock.runFor(61_000); expect(requests).toBe(1);
  await page.getByRole('heading',{name:'Explore',exact:true}).scrollIntoViewIfNeeded();
  await expect.poll(()=>requests).toBe(2);
});
test('standalone Explore fetches immediately',async({page})=>{
  let requests=0;page.on('request',r=>{if(new URL(r.url()).pathname==='/api/explore/launches')requests++;});
  await page.goto(origin+'?standalone'); await expect(page.getByRole('heading',{name:'No launches yet',exact:true})).toBeVisible();
  expect(requests).toBe(1);
});

test('Ethereum cards retain the unified index mode instead of Robinhood source heuristics', async ({page}) => {
  const address = `0x${'11'.repeat(20)}`, hash = `0x${'22'.repeat(32)}`;
  const modes = ['module', 'custom', 'classic'];
  const items = modes.map((mode, index) => ({
    chainId: 1, mode, category: mode === 'classic' ? 'classic' : 'custom',
    launchId: `ethereum-${index}`, tokenAddress: `0x${String(index + 3).repeat(40)}`,
    hookAddress: address, creator: address, transactionHash: hash, blockNumber: '100',
    launchedAt: new Date().toISOString(), name: `Ethereum fixture ${index}`, symbol: `T${index}`, decimals: 18,
  }));
  await page.route('**/api/explore/launches?*', route => route.fulfill({json: {
    scope: 'all', status: 'ready', updatedAt: new Date().toISOString(), items, presentations: [],
    page: {number: 1, size: 10, totalItems: 3, totalPages: 1, hasMore: false},
  }}));
  await page.goto(origin + '?standalone');
  for (const [index, label] of ['Module', 'Custom', 'Classic'].entries()) {
    const card = page.getByRole('link', {name: new RegExp(`Ethereum fixture ${index}`)});
    await expect(card).toContainText(label);
    await expect(card.getByRole('img', {name: 'Ethereum'})).toBeVisible();
  }
});
