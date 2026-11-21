import type { Geometry } from "./types";
export function mapGeometry(geometries: Geometry[], width = 700, height = 380) {
  const polygons = geometries.map((g) =>
    g.type === "Polygon"
      ? [g.coordinates as number[][][]]
      : (g.coordinates as number[][][][]),
  );
  const points = polygons.flat(2).flat();
  if (!points.length) return [];
  const lat = points.reduce((s, p) => s + p[1], 0) / points.length;
  const factor = Math.cos((lat * Math.PI) / 180),
    xs = points.map((p) => p[0] * factor),
    ys = points.map((p) => -p[1]);
  const minX = Math.min(...xs),
    maxX = Math.max(...xs),
    minY = Math.min(...ys),
    maxY = Math.max(...ys);
  const scale = Math.min(
    (width - 40) / Math.max(0.000001, maxX - minX),
    (height - 40) / Math.max(0.000001, maxY - minY),
  );
  const x = (v: number) => width / 2 + (v * factor - (minX + maxX) / 2) * scale,
    y = (v: number) => height / 2 + (-v - (minY + maxY) / 2) * scale;
  return polygons.map((p) =>
    p
      .map((rings) =>
        rings
          .map(
            (ring) =>
              ring
                .map(
                  (point, i) =>
                    `${i ? "L" : "M"}${x(point[0]).toFixed(2)},${y(point[1]).toFixed(2)}`,
                )
                .join(" ") + " Z",
          )
          .join(" "),
      )
      .join(" "),
  );
}
