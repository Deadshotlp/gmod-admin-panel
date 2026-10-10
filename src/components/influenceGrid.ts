/**
 * Einflussraster für Frontlinien (wie im Gamemode): jede Zelle gehört der
 * Partei des nächsten Systems mit Besitzer, sofern es näher als `radius` ist.
 * Liefert waagerechte Streifen zum Füllen und Grenzkanten (true = zwischen
 * zwei Parteien, also Front; false = Rand zum Niemandsland).
 */
export function influenceGrid(owned: Array<{ x: number; y: number; f: string }>, cell: number, radius: number) {
  if (owned.length === 0) return null;
  const buckets = new Map<string, typeof owned>();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const o of owned) {
    const key = `${Math.floor(o.x / radius)}:${Math.floor(o.y / radius)}`;
    buckets.set(key, [...(buckets.get(key) ?? []), o]);
    x0 = Math.min(x0, o.x); y0 = Math.min(y0, o.y); x1 = Math.max(x1, o.x); y1 = Math.max(y1, o.y);
  }
  x0 -= radius; y0 -= radius; x1 += radius; y1 += radius;
  const nx = Math.ceil((x1 - x0) / cell), ny = Math.ceil((y1 - y0) / cell);
  const owner: Array<Array<string | null>> = [];
  for (let j = 0; j < ny; j++) {
    const row: Array<string | null> = [];
    const cy = y0 + (j + 0.5) * cell;
    for (let i = 0; i < nx; i++) {
      const cx = x0 + (i + 0.5) * cell;
      const bx = Math.floor(cx / radius), by = Math.floor(cy / radius);
      let best: string | null = null, bestD = radius * radius;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        for (const o of buckets.get(`${bx + dx}:${by + dy}`) ?? []) {
          const d = (o.x - cx) ** 2 + (o.y - cy) ** 2;
          if (d < bestD) { best = o.f; bestD = d; }
        }
      }
      row.push(best);
    }
    owner.push(row);
  }
  const strips: Array<{ x: number; y: number; w: number; f: string }> = [];
  const fronts: Array<[number, number, number, number, boolean]> = [];
  for (let j = 0; j < ny; j++) {
    let i = 0;
    while (i < nx) {
      const f = owner[j][i];
      const start = i;
      while (i < nx && owner[j][i] === f) i++;
      if (f) strips.push({ x: x0 + start * cell, y: y0 + j * cell, w: (i - start) * cell, f });
    }
    for (let k = 0; k < nx; k++) {
      const a = owner[j][k];
      if (k + 1 < nx) {
        const b = owner[j][k + 1];
        if (a !== b && (a || b)) fronts.push([x0 + (k + 1) * cell, y0 + j * cell, x0 + (k + 1) * cell, y0 + (j + 1) * cell, Boolean(a && b)]);
      }
      if (j + 1 < ny) {
        const b = owner[j + 1][k];
        if (a !== b && (a || b)) fronts.push([x0 + k * cell, y0 + (j + 1) * cell, x0 + (k + 1) * cell, y0 + (j + 1) * cell, Boolean(a && b)]);
      }
    }
  }
  return { strips, fronts, cell };
}
