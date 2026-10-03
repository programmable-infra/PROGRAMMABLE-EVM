type Pixels = { width: number; height: number; data: ArrayLike<number> };

/** Only open sky connected to the top edge can contain stars. Dark garden pockets cannot. */
export function skyMask(pixels: Pixels): Uint8Array {
  const { width, height, data } = pixels;
  const open = new Uint8Array(width * height), sky = new Uint8Array(width * height);
  // Erode colored edges before flood filling so gaps between petals and branches stay excluded.
  const radius = Math.max(2, Math.round(width / 120));
  for (let y = 0; y < height * .48; y++) for (let x = radius; x < width - radius; x++) {
    let dark = true;
    for (let dy = -radius; dy <= radius && dark; dy++) for (let dx = -radius; dx <= radius; dx++) {
      const py = y + dy;
      if (py < 0) continue;
      const at = (py * width + x + dx) * 4;
      if (data[at + 3] > 24 && Math.max(data[at], data[at + 1], data[at + 2]) > 24) { dark = false; break; }
    }
    if (dark) open[y * width + x] = 1;
  }
  const queue: number[] = [];
  for (let x = 0; x < width; x++) if (open[x]) { sky[x] = 1; queue.push(x); }
  for (let at = 0; at < queue.length; at++) {
    const index = queue[at], x = index % width;
    for (const next of [x ? index - 1 : -1, x < width - 1 ? index + 1 : -1, index - width, index + width]) {
      if (next >= 0 && next < open.length && open[next] && !sky[next]) { sky[next] = 1; queue.push(next); }
    }
  }
  return sky;
}

export function skyAt(mask: Uint8Array, pixels: Pick<Pixels, "width" | "height">, area: { width: number; height: number }, point: { x: number; y: number }): boolean {
  const scale = Math.max(area.width / pixels.width, area.height / pixels.height);
  const x = Math.round((point.x - (area.width - pixels.width * scale) / 2) / scale);
  const y = Math.round((point.y - (area.height - pixels.height * scale)) / scale);
  return x >= 0 && x < pixels.width && y >= 0 && y < pixels.height && mask[y * pixels.width + x] === 1;
}
