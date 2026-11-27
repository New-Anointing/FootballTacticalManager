import type { Vec } from '../model/types';

export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);

export const lerp = (a: Vec, b: Vec, t: number): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export function pathLength(points: Vec[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1], points[i]);
  return total;
}

/** Point at fraction t (0..1) of the way along a polyline, by arc length. */
export function pointAlong(points: Vec[], t: number): Vec {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1 || t <= 0) return points[0];
  if (t >= 1) return points[points.length - 1];
  const total = pathLength(points);
  if (total === 0) return points[0];
  let target = total * t;
  for (let i = 1; i < points.length; i++) {
    const seg = dist(points[i - 1], points[i]);
    if (target <= seg) return lerp(points[i - 1], points[i], seg === 0 ? 0 : target / seg);
    target -= seg;
  }
  return points[points.length - 1];
}

/** Shortest distance from point p to segment ab, plus the projection fraction along ab. */
export function distToSegment(p: Vec, a: Vec, b: Vec): { d: number; t: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { d: dist(p, a), t: 0 };
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1);
  return { d: dist(p, { x: a.x + t * dx, y: a.y + t * dy }), t };
}

/** Angle (radians) subtended by the goal mouth from a shooting position. */
export function goalAngle(from: Vec, goalCentre: Vec, goalWidth: number): number {
  const p1 = { x: goalCentre.x, y: goalCentre.y - goalWidth / 2 };
  const p2 = { x: goalCentre.x, y: goalCentre.y + goalWidth / 2 };
  const a1 = Math.atan2(p1.y - from.y, p1.x - from.x);
  const a2 = Math.atan2(p2.y - from.y, p2.x - from.x);
  let d = Math.abs(a1 - a2);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return d;
}

/** The first fraction `f` (by distance) of a polyline. */
export function cutPath(path: Vec[], f: number): Vec[] {
  const total = pathLength(path);
  let left = total * f;
  const out = [path[0]];
  for (let i = 1; i < path.length; i++) {
    const seg = dist(path[i - 1], path[i]);
    if (left <= seg) {
      out.push(pointAlong([path[i - 1], path[i]], seg === 0 ? 0 : left / seg));
      return out;
    }
    out.push(path[i]);
    left -= seg;
  }
  return out;
}
