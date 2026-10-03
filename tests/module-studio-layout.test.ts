import { describe, expect, it } from "vitest";
import { defaultCardPositions, freeCardPosition, minimumCanvasHeight, type Card } from "@/components/module-studio/canvas-layout";
import { skyAt, skyMask } from "@/components/module-studio/sky-mask";

function assertClear(cards: Card[], area: { width: number; height: number }) {
  for (const [index, card] of cards.entries()) {
    expect(card.x - card.width / 2).toBeGreaterThanOrEqual(11.99);
    expect(card.x + card.width / 2).toBeLessThanOrEqual(area.width - 11.99);
    expect(card.y - card.height / 2).toBeGreaterThanOrEqual(11.99);
    expect(card.y + card.height / 2).toBeLessThanOrEqual(area.height - 11.99);
    for (const other of cards.slice(index + 1)) {
      expect(Math.abs(card.x - other.x) >= (card.width + other.width) / 2 + 23.99
        || Math.abs(card.y - other.y) >= (card.height + other.height) / 2 + 23.99).toBe(true);
    }
  }
}

describe("Module Studio map layout", () => {
  it("keeps all supported nodes apart on desktop, mobile and short viewports", () => {
    for (const width of [292, 368, 756, 970]) for (let count = 1; count <= 10; count++) {
      const node = { width: width < 380 ? 136 : 198, height: 88 };
      const coin = { width: width < 380 ? 154 : 240, height: 335 };
      const area = { width, height: Math.max(360, minimumCanvasHeight(width, coin, node, count)) };
      const cards: Card[] = [{ ...coin, x: width / 2, y: area.height / 2 },
        ...defaultCardPositions(area, coin, node, count).map(point => ({ ...node, ...point }))];
      assertClear(cards, area);
    }
  });

  it("moves dragged cards around obstacles and clamps them to the canvas", () => {
    const area = { width: 970, height: 900 }, coin = { width: 240, height: 335 }, node = { width: 198, height: 88 };
    const center: Card = { ...coin, x: area.width / 2, y: area.height / 2 };
    const cards: Card[] = [center, ...defaultCardPositions(area, coin, node, 10).map(point => ({ ...node, ...point }))];
    for (let attempt = 0; attempt < 300; attempt++) {
      const index = 1 + attempt % 10;
      const next = freeCardPosition({ x: (attempt * 137) % 1300 - 150, y: (attempt * 271) % 1200 - 150 }, node, area, cards.filter((_, i) => i !== index));
      if (next) cards[index] = { ...node, ...next };
      assertClear(cards, area);
      expect(cards[0]).toEqual(center);
    }
  });

  it("reports no space instead of returning an overlapping or overflowing point", () => {
    const size = { width: 180, height: 90 }, area = { width: 220, height: 150 };
    expect(freeCardPosition({ x: 110, y: 75 }, size, area, [{ ...size, x: 110, y: 75 }])).toBeUndefined();
    expect(freeCardPosition({ x: 50, y: 50 }, size, { width: 100, height: 150 }, [])).toBeUndefined();
  });
});

function garden() {
  const width = 100, height = 200, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sky = x >= 20 && x < 80 && y < 90;
    const darkGardenPocket = x >= 30 && x < 70 && y >= 120 && y < 160;
    data.set([sky || darkGardenPocket ? 0 : 70, 0, sky || darkGardenPocket ? 0 : 40, 255], (y * width + x) * 4);
  }
  return { width, height, data };
}

describe("Module Studio sky mask", () => {
  it("allows stars in open black sky and excludes flowers, edges and dark garden pockets", () => {
    const pixels = garden(), mask = skyMask(pixels), area = { width: 100, height: 200 };
    expect(skyAt(mask, pixels, area, { x: 50, y: 30 })).toBe(true);
    for (const point of [{ x: 10, y: 30 }, { x: 21, y: 30 }, { x: 50, y: 89 }, { x: 50, y: 140 }]) {
      expect(skyAt(mask, pixels, area, point)).toBe(false);
    }
  });

  it("matches the centered, bottom-aligned cover crop on wide screens", () => {
    const pixels = garden(), mask = skyMask(pixels), area = { width: 200, height: 200 };
    // The whole sky is above the crop, even though this screen coordinate is near the top.
    expect(skyAt(mask, pixels, area, { x: 100, y: 10 })).toBe(false);
    expect(skyAt(mask, pixels, area, { x: -1, y: 10 })).toBe(false);
  });

  it("does not connect sky through a narrow dark gap between colored petals", () => {
    const pixels = garden();
    for (let y = 45; y < 50; y++) for (let x = 20; x < 80; x++) {
      if (x !== 50) pixels.data.set([90, 0, 60, 255], (y * pixels.width + x) * 4);
    }
    const mask = skyMask(pixels), area = { width: 100, height: 200 };
    expect(skyAt(mask, pixels, area, { x: 50, y: 30 })).toBe(true);
    expect(skyAt(mask, pixels, area, { x: 50, y: 65 })).toBe(false);
  });
});
