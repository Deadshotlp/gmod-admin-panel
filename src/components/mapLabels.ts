/**
 * Beschriftung für Canvas-Karten: setzt einen Namen nur, wenn er keinen
 * schon gesetzten überdeckt. Wer zuerst kommt, gewinnt - wichtige Systeme
 * also zuerst beschriften. So bleibt die Karte bei jedem Zoom lesbar.
 */

const CELL = 6;

export function createLabeler(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const cols = Math.ceil(w / CELL) + 1;
  const rows = Math.ceil(h / CELL) + 1;
  const used = new Uint8Array(cols * rows);

  const cells = (x0: number, y0: number, x1: number, y1: number) => {
    const out: number[] = [];
    for (let cy = Math.max(0, Math.floor(y0 / CELL)); cy <= Math.min(rows - 1, Math.floor(y1 / CELL)); cy++) {
      for (let cx = Math.max(0, Math.floor(x0 / CELL)); cx <= Math.min(cols - 1, Math.floor(x1 / CELL)); cx++) out.push(cy * cols + cx);
    }
    return out;
  };

  /** Fläche als belegt markieren (z. B. Symbole oder fest gezeichnete Texte) */
  const reserve = (x0: number, y0: number, x1: number, y1: number) => {
    for (const i of cells(x0, y0, x1, y1)) used[i] = 1;
  };

  /** Text links oben bei (x, y - Grundlinie) setzen, wenn frei. true = gezeichnet */
  const place = (text: string, x: number, y: number, color: string): boolean => {
    if (x > w || y < 0 || y - 12 > h) return false;
    const tw = ctx.measureText(text).width;
    const list = cells(x, y - 11, x + tw, y + 2);
    if (list.length === 0 || list.some((i) => used[i])) return false;
    for (const i of list) used[i] = 1;
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    return true;
  };

  return { place, reserve };
}
