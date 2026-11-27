import type { PitchSpec } from '../model/pitch';

/** Margin (metres) of grass drawn around the lines. */
export function apronFor(p: PitchSpec): number {
  return Math.max(4, p.length * 0.07);
}

/**
 * The pitch surface, drawn once onto a canvas: mowing stripes and every line, at the
 * same dimensions the 2D view uses. Canvas x runs along the pitch, canvas y across it
 * (y = 0 is the far touchline, as in 2D).
 */
export function drawPitch(p: PitchSpec, small: boolean): HTMLCanvasElement {
  const M = apronFor(p);
  const totalL = p.length + 2 * M;
  const totalW = p.width + 2 * M;
  const ppm = Math.min(28, 4096 / totalL);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(totalL * ppm);
  canvas.height = Math.round(totalW * ppm);
  const g = canvas.getContext('2d')!;
  const X = (x: number) => (x + M) * ppm;
  const Y = (y: number) => (y + M) * ppm;
  const colors = small
    ? { apron: '#1d4a72', a: '#2f6ea3', b: '#2a6497' }
    : { apron: '#2a6a2f', a: '#3b8f40', b: '#347f39' };
  g.fillStyle = colors.apron;
  g.fillRect(0, 0, canvas.width, canvas.height);
  // Mowing stripes across the playing area (and a little beyond, like a real pitch).
  const stripes = small ? 8 : 12;
  const sw = p.length / stripes;
  for (let i = -1; i <= stripes; i++) {
    g.fillStyle = i % 2 ? colors.a : colors.b;
    g.fillRect(X(i * sw), Y(-M * 0.45), sw * ppm + 1, (p.width + M * 0.9) * ppm);
  }
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.lineWidth = Math.max(2, 0.12 * ppm);
  g.lineJoin = 'miter';
  const rect = (x: number, y: number, w: number, h: number) => g.strokeRect(X(x), Y(y), w * ppm, h * ppm);
  const line = (x1: number, y1: number, x2: number, y2: number) => {
    g.beginPath();
    g.moveTo(X(x1), Y(y1));
    g.lineTo(X(x2), Y(y2));
    g.stroke();
  };
  const spot = (x: number, y: number, r = 0.2) => {
    g.beginPath();
    g.arc(X(x), Y(y), Math.max(2, r * ppm), 0, Math.PI * 2);
    g.fill();
  };
  rect(0, 0, p.length, p.width);
  line(p.length / 2, 0, p.length / 2, p.width);
  g.beginPath();
  g.arc(X(p.length / 2), Y(p.width / 2), p.centreRadius * ppm, 0, Math.PI * 2);
  g.stroke();
  spot(p.length / 2, p.width / 2, 0.25);
  const boxTop = (p.width - p.boxWidth) / 2;
  const sixTop = (p.width - p.sixWidth) / 2;
  for (const right of [false, true]) {
    const gx = right ? p.length : 0;
    const dir = right ? -1 : 1;
    rect(right ? p.length - p.boxDepth : 0, boxTop, p.boxDepth, p.boxWidth);
    if (p.sixDepth > 0) rect(right ? p.length - p.sixDepth : 0, sixTop, p.sixDepth, p.sixWidth);
    const spotX = gx + dir * p.penaltySpot;
    spot(spotX, p.width / 2);
    if (!small) {
      // The "D": the part of the circle round the spot outside the box.
      const boxX = gx + dir * p.boxDepth;
      const dx = Math.abs(boxX - spotX);
      if (dx < p.centreRadius) {
        const a = Math.acos(dx / p.centreRadius);
        g.beginPath();
        if (right) g.arc(X(spotX), Y(p.width / 2), p.centreRadius * ppm, Math.PI - a, Math.PI + a);
        else g.arc(X(spotX), Y(p.width / 2), p.centreRadius * ppm, -a, a);
        g.stroke();
      }
      // Corner arcs.
      for (const cy of [0, p.width]) {
        g.beginPath();
        const start = right ? (cy ? Math.PI : Math.PI / 2) : cy ? -Math.PI / 2 : 0;
        g.arc(X(gx), Y(cy), 1 * ppm, start, start + Math.PI / 2);
        g.stroke();
      }
    }
  }
  return canvas;
}
