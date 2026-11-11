/**
 * The dual-pipeline check, drawn literally: one column per Sentinel-2 date.
 * Sentinel-2 tick above the line, its matched Landsat tick below. A solid
 * bridge means the pair agreed within tolerance; a broken one means they
 * disagreed; a lone tick means Landsat had no scene close enough in time.
 */
export default function AgreementStrip({ observations, index = "ndvi", compact = false }) {
  const obs = [...(observations || [])].filter((o) => o.s2_date).sort((a, b) => a.s2_date.localeCompare(b.s2_date));
  if (!obs.length) return <p className="muted">No aligned observations.</p>;

  const t = (d) => new Date(d).getTime();
  const t0 = t(obs[0].s2_date);
  const t1 = t(obs[obs.length - 1].s2_date);
  const W = 1000;
  const H = compact ? 64 : 112;
  const mid = H / 2;
  const span = compact ? 22 : 40;
  const gap = compact ? 4 : 9;
  const x = (d) => 12 + ((t(d) - t0) / Math.max(1, t1 - t0)) * (W - 24);
  const agreeKey = `${index}_agreement`;

  const years = [];
  for (let y = new Date(t0).getFullYear() + 1; y <= new Date(t1).getFullYear(); y++) years.push(y);

  const matched = obs.filter((o) => o.matched);
  const agreed = matched.filter((o) => o[agreeKey]);
  const label =
    `${obs.length} Sentinel-2 dates, ${matched.length} matched with Landsat, ` +
    `${agreed.length} of those agree on ${index.toUpperCase()}.`;

  return (
    <figure className={`strip ${compact ? "strip-compact" : ""}`}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} preserveAspectRatio="none">
        <line x1="0" x2={W} y1={mid} y2={mid} className="strip-axis" />
        {!compact &&
          years.map((y) => {
            const xx = x(`${y}-01-01`);
            return (
              <line key={y} x1={xx} x2={xx} y1={4} y2={H - 4} className="strip-year" />
            );
          })}
        {obs.map((o, i) => {
          const xx = x(o.s2_date);
          const state = !o.matched ? "lone" : o[agreeKey] ? "agree" : "disagree";
          return (
            <g key={i} className={`strip-col strip-${state}`}>
              <title>
                {`${o.s2_date}  S2 ${o[`s2_${index}`]?.toFixed(3)}` +
                  (o.matched ? `  ·  Landsat ${o.landsat_date} ${o[`landsat_${index}`]?.toFixed(3)} (${o.days_apart}d apart)` : "  ·  no Landsat match")}
              </title>
              <line x1={xx} x2={xx} y1={mid - span} y2={mid - gap} className="tick-s2" />
              {o.matched && <line x1={xx} x2={xx} y1={mid + gap} y2={mid + span} className="tick-ls" />}
              {state === "agree" && <line x1={xx} x2={xx} y1={mid - gap} y2={mid + gap} className="bridge" />}
              {state === "disagree" && <circle cx={xx} cy={mid} r="3.5" className="break" />}
            </g>
          );
        })}
      </svg>
      {!compact && (
        <div className="strip-years" aria-hidden="true">
          {years.map((y) => (
            <span key={y} style={{ left: `${(x(`${y}-01-01`) / W) * 100}%` }}>{y}</span>
          ))}
        </div>
      )}
      {!compact && (
        <figcaption className="strip-legend">
          <span><i className="key key-s2" />Sentinel-2 (10 m)</span>
          <span><i className="key key-ls" />Landsat 8/9 (30 m)</span>
          <span><i className="key key-bridge" />Pair agrees</span>
          <span><i className="key key-break" />Pair disagrees</span>
          <span className="muted">{label}</span>
        </figcaption>
      )}
    </figure>
  );
}
