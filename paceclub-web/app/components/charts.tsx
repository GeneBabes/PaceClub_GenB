"use client";
export type Datum = { label: string; value: number };
export function Chart({
  title,
  unit,
  points,
  line = false,
}: {
  title: string;
  unit: string;
  points: Datum[];
  line?: boolean;
}) {
  const w = 560,
    h = 210,
    pad = 35,
    max = Math.max(1, ...points.map((p) => p.value));
  const x = (i: number) =>
      pad + ((i + 0.5) * (w - 2 * pad)) / Math.max(1, points.length),
    y = (v: number) => h - pad - (v / max) * (h - 2 * pad);
  return (
    <section className="card chart-card">
      <div className="section-heading">
        <h2>{title}</h2>
        <span className="muted">{unit}</span>
      </div>
      {!points.length ? (
        <p className="empty-note">Your verified activities will appear here.</p>
      ) : (
        <>
          <svg
            viewBox={`0 0 ${w} ${h}`}
            role="img"
            aria-label={`${title}, ${unit}`}
          >
            <path
              d={`M${pad} ${pad} V${h - pad} H${w - pad}`}
              fill="none"
              stroke="#cddbd2"
            />
            {[0, 0.5, 1].map((f) => (
              <g key={f}>
                <path
                  d={`M${pad} ${y(max * f)} H${w - pad}`}
                  stroke="#e4ece6"
                  strokeDasharray="4 4"
                />
                <text x="2" y={y(max * f) + 4} fontSize="10" fill="#5b6c62">
                  {(max * f).toFixed(1)}
                </text>
              </g>
            ))}
            {line && (
              <path
                d={points
                  .map((p, i) => `${i ? "L" : "M"}${x(i)} ${y(p.value)}`)
                  .join(" ")}
                fill="none"
                stroke="#245741"
                strokeWidth="3"
              />
            )}
            {points.map((p, i) => (
              <g key={i}>
                {line ? (
                  <circle cx={x(i)} cy={y(p.value)} r="4" fill="#245741">
                    <title>
                      {p.label}: {p.value.toFixed(2)} {unit}
                    </title>
                  </circle>
                ) : (
                  <rect
                    x={x(i) - Math.min(28, (w - 2 * pad) / points.length / 3)}
                    y={y(p.value)}
                    width={Math.min(56, (w - 2 * pad) / points.length / 1.5)}
                    height={h - pad - y(p.value)}
                    rx="5"
                    fill="#779d67"
                  >
                    <title>
                      {p.label}: {p.value.toFixed(2)} {unit}
                    </title>
                  </rect>
                )}
                <text
                  x={x(i)}
                  y={h - 12}
                  textAnchor="middle"
                  fontSize="9"
                  fill="#5b6c62"
                >
                  {p.label.slice(5)}
                </text>
              </g>
            ))}
          </svg>
          <details>
            <summary>View chart data</summary>
            <table>
              <thead>
                <tr>
                  <th>Period</th>
                  <th>{unit}</th>
                </tr>
              </thead>
              <tbody>
                {points.map((p, i) => (
                  <tr key={i}>
                    <td>{p.label}</td>
                    <td>{p.value.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </section>
  );
}
