import { CartesianGrid, Legend, Line, ComposedChart, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";

/** NDVI or EVI over time, Sentinel-2 vs Landsat on one axis. */
export default function IndexChart({ observations, index = "ndvi" }) {
  const rows = (observations || [])
    .filter((o) => o.s2_date)
    .map((o) => ({
      t: new Date(o.s2_date).getTime(),
      s2: o[`s2_${index}`],
      ls: o.matched ? o[`landsat_${index}`] : null,
    }))
    .sort((a, b) => a.t - b.t);
  const ls = rows.filter((r) => r.ls != null);
  const fmt = (t) => new Date(t).toLocaleDateString("en-GB", { month: "short", year: "2-digit" });

  return (
    <div className="chart">
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
          <CartesianGrid stroke="var(--rule)" vertical={false} />
          <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={fmt} stroke="var(--ink-soft)" fontSize={12} />
          <YAxis domain={["auto", "auto"]} stroke="var(--ink-soft)" fontSize={12} tickFormatter={(v) => v.toFixed(2)} />
          <Tooltip
            labelFormatter={(t) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
            formatter={(v, name) => [Number(v).toFixed(3), name]}
            contentStyle={{ borderRadius: 6, border: "1px solid var(--rule)", fontSize: 13 }}
          />
          <Legend iconType="plainline" wrapperStyle={{ fontSize: 13 }} />
          <Line data={rows} dataKey="s2" name={`Sentinel-2 ${index.toUpperCase()}`} stroke="var(--s2)" strokeWidth={2} dot={{ r: 2.5 }} isAnimationActive={false} />
          <Scatter data={ls} dataKey="ls" name={`Landsat ${index.toUpperCase()}`} fill="var(--ls)" shape="diamond" isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
