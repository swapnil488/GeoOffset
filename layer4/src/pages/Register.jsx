import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { parseUnits } from "ethers";
import AoiMap from "../components/AoiMap.jsx";
import { FilePick, Notice } from "../components/ui.jsx";
import { api, isDemoMode } from "../lib/api.js";
import { parseAoi } from "../lib/aoi.js";
import { txErrorMessage, useChain } from "../lib/chain.jsx";
import { num, sameAddr, shortAddr } from "../lib/format.js";

const slug = (s) => s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
const ZERO = "0x0000000000000000000000000000000000000000000000000000000000000000";

export default function Register() {
  const { account, contracts, wrongChain, connect } = useChain();
  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState("");
  const [idTouched, setIdTouched] = useState(false);
  const [aoiText, setAoiText] = useState("");
  const [bond, setBond] = useState("1000");
  const [exportText, setExportText] = useState(null);
  const [steps, setSteps] = useState(null);
  const [running, setRunning] = useState(false);

  const aoi = useMemo(() => {
    if (!aoiText.trim()) return null;
    try { return parseAoi(aoiText); } catch (e) { return { error: e.message }; }
  }, [aoiText]);

  const id = idTouched ? projectId : slug(name);
  const bondValid = Number(bond) > 0;
  const ready = name.trim() && id && aoi && !aoi.error && bondValid && account && !wrongChain && contracts && !isDemoMode();

  async function submit(e) {
    e.preventDefault();
    const plan = [
      { key: "check", label: "Check the area and id are free on-chain and you hold the bond" },
      { key: "layer2", label: "Save the project and its area in Layer 2" },
      { key: "approve", label: `Allow the escrow to take the ${num(bond)} GEO bond` },
      { key: "register", label: "Register the project and post the bond on-chain" },
      ...(exportText ? [{ key: "verify", label: "Submit the Layer 1 satellite export for verification" }] : []),
    ].map((s) => ({ ...s, state: "todo" }));
    setSteps(plan);
    setRunning(true);
    const mark = (key, state, note) => setSteps((all) => all.map((s) => (s.key === key ? { ...s, state, note } : s)));

    let current = "check";
    try {
      const { escrow, token } = contracts;
      mark("check", "doing");
      if ((await escrow.aoiOwnerProject(aoi.aoiHash)) !== ZERO) {
        throw new Error("This exact area is already registered under another project. The same polygon can't earn credits twice.");
      }
      if ((await escrow.projects(await escrow.projectKeyOf(id))).exists) throw new Error(`Project id "${id}" is already taken on-chain.`);
      const amount = parseUnits(bond, 18);
      if ((await token.balanceOf(account)) < amount) {
        throw new Error(`Your wallet doesn't hold ${num(bond)} GEO. Get test GEO on the My credits page, then try again.`);
      }
      mark("check", "done");

      current = "layer2";
      mark("layer2", "doing");
      try {
        await api.createProject({
          project_id: id,
          name: name.trim(),
          aoi_geojson: aoi.geometry,
          aoi_area_km2: aoi.areaKm2,
          bond_deposit_amount: bond,
          owner_address: account,
        });
        mark("layer2", "done");
      } catch (e) {
        // A retry after a later step failed: Layer 2 already has it. Carry on if it's ours.
        if (e.status !== 409) throw e;
        const existing = await api.getProject(id);
        if (!sameAddr(existing.owner_address, account)) throw new Error(`Project id "${id}" is already used by another owner in Layer 2.`);
        mark("layer2", "done", "Already saved from an earlier attempt");
      }

      current = "approve";
      mark("approve", "doing");
      const escrowAddr = await escrow.getAddress();
      if ((await token.allowance(account, escrowAddr)) < amount) await (await token.approve(escrowAddr, amount)).wait();
      mark("approve", "done");

      current = "register";
      mark("register", "doing");
      await (await escrow.registerProject(id, aoi.aoiHash, amount)).wait();
      mark("register", "done");

      if (exportText) {
        current = "verify";
        mark("verify", "doing");
        const payload = JSON.parse(exportText.text);
        payload.project_id = id;
        const rec = await api.submitVerification(id, payload);
        mark("verify", "done", `Run #${rec.id}: ${rec.verification_outcome.replaceAll("_", " ").toLowerCase()}`);
      }
      setSteps((all) => [...all, { key: "end", state: "end" }]);
    } catch (err) {
      mark(current, "failed", err?.status !== undefined ? err.message : txErrorMessage(err));
    } finally {
      setRunning(false);
    }
  }

  const finished = steps?.some((s) => s.state === "end");

  return (
    <div className="page register">
      <h1>Register a project</h1>
      <p className="lede">
        Upload the project's area as GeoJSON and post a bond. The bond is what a challenger can win if the satellites later contradict your claim.
      </p>

      {isDemoMode() && <Notice kind="warn" title="Layer 2 is offline">Start the Layer 2 API to register projects.</Notice>}

      <form className="register-grid" onSubmit={submit}>
        <div className="register-fields">
          <label className="field">
            <span>Project name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ulwe mangrove restoration" required />
          </label>
          <label className="field">
            <span>Project id</span>
            <input value={id} onChange={(e) => { setIdTouched(true); setProjectId(slug(e.target.value)); }} placeholder="ulwe-mangrove-restoration" required />
            <span className="field-hint">Use the same id when you run Layer 1 (--project-id).</span>
          </label>

          <div className="field">
            <span>Area of interest (GeoJSON Polygon)</span>
            <textarea rows={8} value={aoiText} onChange={(e) => setAoiText(e.target.value)} placeholder='{"type": "Polygon", "coordinates": [[[lon, lat], …]]}' spellCheck={false} />
            <div className="row">
              <FilePick label="Upload .geojson" onText={(t) => { setAoiText(t); const n = JSON.parse(t)?.properties?.name; if (n && !name) setName(n); }} />
              {aoi && !aoi.error && <span className="field-ok">{num(aoi.areaKm2, 2)} km², hash {aoi.aoiHash.slice(0, 10)}…</span>}
            </div>
            {aoi?.error && <span className="field-error">{aoi.error}</span>}
          </div>

          <label className="field">
            <span>Bond (GEO)</span>
            <input type="number" min="0" step="any" value={bond} onChange={(e) => setBond(e.target.value)} />
            <span className="field-hint">Challengers must stake at least this much.</span>
          </label>

          <div className="field">
            <span>Layer 1 satellite export (optional)</span>
            <div className="row">
              <FilePick label={exportText ? "Replace file" : "Upload _timeseries.json"} onText={(text, fname) => setExportText({ text, fname })} />
              {exportText && <span className="field-ok">{exportText.fname}</span>}
            </div>
            <span className="field-hint">You can also add it later from the project page.</span>
          </div>

          <div className="field">
            <span>Owner wallet</span>
            {account && !wrongChain ? (
              <span>{shortAddr(account)}</span>
            ) : (
              <button type="button" className="btn btn-quiet" onClick={() => connect().catch(() => {})}>Connect wallet</button>
            )}
          </div>

          <button className="btn btn-primary" type="submit" disabled={!ready || running}>
            {running ? "Registering…" : "Register and post bond"}
          </button>
          {!contracts && <span className="field-hint">Layer 3 contracts aren't deployed on this network yet.</span>}
        </div>

        <div className="register-side">
          <div className="register-map">
            {aoi && !aoi.error ? (
              <AoiMap items={[{ id: "draft", name: name || "New project", geometry: aoi.geometry }]} padding={30} />
            ) : (
              <div className="map-empty">Your area appears here once the GeoJSON is valid.</div>
            )}
          </div>
          {steps && (
            <ol className="steps" aria-live="polite">
              {steps.filter((s) => s.key !== "end").map((s) => (
                <li key={s.key} className={`step step-${s.state}`}>
                  <span>{s.label}</span>
                  {s.note && <span className={s.state === "failed" ? "field-error" : "muted"}>{s.note}</span>}
                </li>
              ))}
            </ol>
          )}
          {finished && <Link className="btn btn-primary" to={`/projects/${id}`}>Open {id}</Link>}
        </div>
      </form>
    </div>
  );
}
