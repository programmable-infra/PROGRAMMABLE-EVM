export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type Card = Point & Size;

export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Find the nearest free position, leaving room between cards and connection ports. */
export function freeCardPosition(point: Point, size: Size, area: Size, obstacles: readonly Card[], gap = 24): Point | undefined {
  if (size.width + 24 > area.width || size.height + 24 > area.height) return undefined;
  const minX = size.width / 2 + 12, maxX = Math.max(minX, area.width - minX);
  const minY = size.height / 2 + 12, maxY = Math.max(minY, area.height - minY);
  const bounded = { x: clamp(point.x, minX, maxX), y: clamp(point.y, minY, maxY) };
  const clear = (candidate: Point) => obstacles.every(card =>
    Math.abs(candidate.x - card.x) >= (size.width + card.width) / 2 + gap - .01 ||
    Math.abs(candidate.y - card.y) >= (size.height + card.height) / 2 + gap - .01);
  if (clear(bounded)) return bounded;
  const xs = [bounded.x, minX, maxX], ys = [bounded.y, minY, maxY];
  for (const card of obstacles) {
    xs.push(clamp(card.x - (size.width + card.width) / 2 - gap, minX, maxX),
      clamp(card.x + (size.width + card.width) / 2 + gap, minX, maxX));
    ys.push(clamp(card.y - (size.height + card.height) / 2 - gap, minY, maxY),
      clamp(card.y + (size.height + card.height) / 2 + gap, minY, maxY));
  }
  let best: Point | undefined, distance = Infinity;
  for (const x of xs) for (const y of ys) {
    const candidate = { x, y }, delta = (x - bounded.x) ** 2 + (y - bounded.y) ** 2;
    if (delta < distance && clear(candidate)) { best = candidate; distance = delta; }
  }
  return best;
}

const GAP = 24;
const sideLanes = (width: number, coin: Size, node: Size) => width >= coin.width + 2 * node.width + 4 * GAP + 24;
const columns = (width: number, node: Size) => Math.max(1, Math.min(2, Math.floor(width / (node.width + GAP))));

/** Small screens get more vertical space rather than overlapping cards. */
export function minimumCanvasHeight(width: number, coin: Size, node: Size, count: number): number {
  if (sideLanes(width, coin, node)) return Math.max(coin.height + 24, Math.ceil(count / 2) * (node.height + GAP));
  const rowsPerSide = Math.ceil(Math.ceil(count / columns(width, node)) / 2);
  return coin.height + 2 * rowsPerSide * (node.height + GAP) + 24;
}

/** A guaranteed spaced arrangement to use if previous dragged positions leave no free slot. */
export function defaultCardPositions(area: Size, coin: Size, node: Size, count: number): Point[] {
  if (sideLanes(area.width, coin, node)) {
    const rows = Math.ceil(count / 2);
    return Array.from({ length: count }, (_, index) => ({
      x: index % 2 ? area.width - node.width / 2 - 12 : node.width / 2 + 12,
      y: area.height / 2 + (Math.floor(index / 2) - (rows - 1) / 2) * (node.height + GAP),
    }));
  }
  const cols = columns(area.width, node), rowsPerSide = Math.ceil(Math.ceil(count / cols) / 2);
  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / cols), above = row < rowsPerSide;
    return {
      x: area.width / 2 + (index % cols - (cols - 1) / 2) * (node.width + GAP),
      y: area.height / 2 + (above ? -1 : 1) * (coin.height / 2 + GAP + node.height / 2 + (above ? rowsPerSide - 1 - row : row - rowsPerSide) * (node.height + GAP)),
    };
  });
}
