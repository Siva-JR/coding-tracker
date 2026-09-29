import { useEffect, useId, useRef, useState } from 'react';

export const COLORS = { leetcode: '#2b6cdf', hackerrank: '#b45309' };

export function Sparkline({ data, color = COLORS.leetcode }) {
  const id = useId().replace(/:/g, '');
  if (!data || data.length < 2) return null;
  const W = 200, H = 44, pad = 3;
  const min = Math.min(...data), max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => [pad + (i / (data.length - 1)) * (W - pad * 2), H - pad - ((v - min) / span) * (H - pad * 2 - 4)]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity=".28" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${W - pad} ${H} L${pad} ${H} Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const niceMax = (v) => {
  if (v <= 0) return 10;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
};

/**
 * Two-series area/line chart. Second series is dashed so the two platforms
 * stay distinguishable without relying on colour alone.
 * series: [{ key, label, color, dash }], data: [{ date, [key]: number }]
 */
export function LineChart({ data, series, formatX, height = 260, yLabel }) {
  const ref = useRef(null);
  const wrap = useRef(null);
  const [hover, setHover] = useState(null);
  const [W, setW] = useState(720); // measured, so 1 viewBox unit = 1 CSS px and text stays 12px
  const uid = useId().replace(/:/g, '');
  useEffect(() => {
    const el = wrap.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  if (!data?.length) return null;

  const H = height, L = 44, R = 14, T = 14, B = 30;
  const maxV = niceMax(Math.max(...data.flatMap((d) => series.map((s) => d[s.key] ?? 0))));
  const x = (i) => L + (data.length === 1 ? 0.5 : i / (data.length - 1)) * (W - L - R);
  const y = (v) => T + (1 - v / maxV) * (H - T - B);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * maxV);
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor((W - L - R) / 90))));

  const path = (key) => {
    let d = '';
    data.forEach((row, i) => {
      if (row[key] == null) return;
      d += `${d ? 'L' : 'M'}${x(i).toFixed(1)} ${y(row[key]).toFixed(1)} `;
    });
    return d;
  };

  const onMove = (e) => {
    const rect = ref.current.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - L) / (W - L - R)) * (data.length - 1));
    setHover(Math.max(0, Math.min(data.length - 1, i)));
  };

  const hv = hover != null ? data[hover] : null;
  return (
    <div style={{ position: 'relative' }} ref={wrap}>
      <svg
        ref={ref}
        className="chart"
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        role="img"
        aria-label={`Line chart of ${series.map((s) => s.label).join(' and ')} over time`}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`${uid}${s.key}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={s.color} stopOpacity=".22" />
              <stop offset="1" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#d9e7de" strokeDasharray={t === 0 ? '' : '3 5'} />
            <text x={L - 8} y={y(t) + 4} textAnchor="end">{Math.round(t)}</text>
          </g>
        ))}
        {data.map((d, i) => ((i % labelEvery === 0 && data.length - 1 - i >= labelEvery * 0.6) || i === data.length - 1) && (
          <text key={i} x={x(i)} y={H - 8} textAnchor="middle">{formatX ? formatX(d.date) : d.date}</text>
        ))}
        {series.map((s) => {
          const idx = data.map((d, i) => (d[s.key] != null ? i : -1)).filter((i) => i >= 0);
          if (!idx.length) return null; // a platform with no data (for example no HackerRank profile) draws nothing
          const first = idx[0];
          const last = idx[idx.length - 1];
          return (
            <g key={s.key}>
              {/* An area needs two points; a single day of data is drawn as a dot only. */}
              {idx.length > 1 && <path d={`${path(s.key)} L${x(last)} ${y(0)} L${x(first)} ${y(0)} Z`} fill={`url(#${uid}${s.key})`} />}
              {idx.length > 1 && <path d={path(s.key)} fill="none" stroke={s.color} strokeWidth="3" strokeDasharray={s.dash ? '7 5' : ''} strokeLinecap="round" strokeLinejoin="round" />}
              {data.map((d, i) => d[s.key] != null && (i === last || hover === i) && (
                <circle key={i} cx={x(i)} cy={y(d[s.key])} r="5" fill="#fff" stroke={s.color} strokeWidth="3" />
              ))}
            </g>
          );
        })}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="#8fa89a" strokeDasharray="3 4" />}
        {yLabel && <text x={L} y={T - 2} textAnchor="start" style={{ fontSize: 11 }}>{yLabel}</text>}
      </svg>
      {hv && (
        <div className="tooltip" style={{ left: `${(x(hover) / W) * 100}%`, top: `${(Math.min(...series.map((s) => (hv[s.key] != null ? y(hv[s.key]) : H))) / H) * 100}%` }}>
          <b>{formatX ? formatX(hv.date) : hv.date}</b>
          {series.map((s) => hv[s.key] != null && (
            <div key={s.key}><span style={{ color: s.color === COLORS.leetcode ? '#9cc0ff' : '#f5b471' }}>●</span> {s.label}: {hv[s.key]}</div>
          ))}
        </div>
      )}
      <table className="sr-only">
        <caption>Data for the chart above</caption>
        <thead><tr><th>Date</th>{series.map((s) => <th key={s.key}>{s.label}</th>)}</tr></thead>
        <tbody>{data.map((d) => <tr key={d.date}><td>{d.date}</td>{series.map((s) => <td key={s.key}>{d[s.key]}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
