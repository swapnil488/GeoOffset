import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import AoiMap from "../components/AoiMap.jsx";
import { Loading, Notice, Pill } from "../components/ui.jsx";
import { api } from "../lib/api.js";
import { useAsync } from "../lib/hooks.js";
import { FINAL_LABEL, OUTCOME_LABEL, num, pct, tone } from "../lib/format.js";

function statusText(v) {
  if (!v) return "No verification yet";
  return v.verification_outcome === "PROVISIONALLY_VERIFIED" ? FINAL_LABEL[v.finalization_status] : OUTCOME_LABEL[v.verification_outcome];
}

export default function Explorer() {
  const { data: projects, error, loading } = useAsync(() => api.listProjects(), []);
  const [selected, setSelected] = useState(null);
  const navigate = useNavigate();

  const items = (projects || []).map((p) => ({
    id: p.project_id,
    name: p.name,
    geometry: p.aoi_geojson,
    verification: p.latest_verification,
  }));

  return (
    <div className="explorer">
      <aside className="explorer-list" aria-label="Projects">
        <div className="explorer-head">
          <h1>Projects</h1>
          <p className="muted">
            Each area is checked by two satellites. Credits are only minted after both agree and the 72-hour challenge window passes.
          </p>
        </div>
        {loading && <Loading />}
        {error && <Notice kind="error" title="Couldn't load projects">{error.message}</Notice>}
        {projects && projects.length === 0 && (
          <Notice title="No projects yet">
            <Link to="/register">Register the first project</Link> by uploading its area as GeoJSON.
          </Notice>
        )}
        <ul className="project-list">
          {(projects || []).map((p) => {
            const v = p.latest_verification;
            return (
              <li key={p.project_id}>
                <button
                  className={`project-row ${selected === p.project_id ? "is-selected" : ""}`}
                  onClick={() => setSelected(p.project_id)}
                  onDoubleClick={() => navigate(`/projects/${p.project_id}`)}
                >
                  <span className="project-row-name">{p.name}</span>
                  <span className="project-row-id">{p.project_id}</span>
                  <span className="project-row-meta">
                    <Pill tone={tone(v)}>{statusText(v)}</Pill>
                    <span>{num(p.aoi_area_km2, 1)} km²</span>
                  </span>
                  {v && (
                    <span className="agree-meter" title={`${pct(v.agreement_rate)} of matched pairs agree`}>
                      <span style={{ width: pct(v.agreement_rate) }} />
                    </span>
                  )}
                </button>
                {selected === p.project_id && (
                  <div className="project-row-detail">
                    {v ? (
                      <dl className="kv">
                        <dt>Satellite agreement</dt><dd>{pct(v.agreement_rate)} of {v.matched_pair_count} matched pairs</dd>
                        <dt>Scenes</dt><dd>{v.s2_scene_count} Sentinel-2, {v.landsat_scene_count} Landsat</dd>
                        <dt>Estimate</dt><dd>{num(v.estimated_tons_co2e)} tCO₂e per year</dd>
                      </dl>
                    ) : (
                      <p className="muted">Waiting for a Layer 1 satellite export.</p>
                    )}
                    <Link className="btn btn-primary btn-small" to={`/projects/${p.project_id}`}>Open project</Link>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <div className="map-legend" aria-label="Map colours">
          <span><Pill tone="good">Final, mintable</Pill></span>
          <span><Pill tone="open">Open for challenge</Pill></span>
          <span><Pill tone="dispute">Under dispute</Pill></span>
          <span><Pill tone="bad">Rejected</Pill></span>
        </div>
      </aside>
      <section className="explorer-map" aria-label="Map of project areas">
        <AoiMap items={items} selectedId={selected} onSelect={setSelected} />
      </section>
    </div>
  );
}
