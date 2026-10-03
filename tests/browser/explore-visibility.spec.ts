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
