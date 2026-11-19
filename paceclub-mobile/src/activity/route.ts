import type { Point } from './model';
export function routeGeometry(points: Pick<Point, 'latitude' | 'longitude' | 'segment'>[], width = 320, height = 220) {
  if (!points.length) return { paths: [] as string[], first: null, last: null };
  const rad = Math.PI / 180, origin = points[0];
  const raw = points.map(p => ({ x: (((p.longitude - origin.longitude + 540) % 360) - 180) * Math.cos(origin.latitude * rad), y: -(p.latitude - origin.latitude), segment: p.segment }));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of raw) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  const scale = Math.min((width - 40) / Math.max(maxX - minX, 0.0001), (height - 40) / Math.max(maxY - minY, 0.0001));
  const projected = raw.map(p => ({ x: (p.x - (minX + maxX) / 2) * scale + width / 2, y: (p.y - (minY + maxY) / 2) * scale + height / 2, segment: p.segment }));
  const paths: string[] = [];
  for (let i = 0; i < projected.length; i++) {
    const p = projected[i];
    if (i === 0 || p.segment !== projected[i - 1].segment) paths.push(`M${p.x.toFixed(1)},${p.y.toFixed(1)}`);
    else paths[paths.length - 1] += ` L${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  }
  return { paths, first: projected[0], last: projected[projected.length - 1] };
}
