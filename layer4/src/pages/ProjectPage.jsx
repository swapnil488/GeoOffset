import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { formatUnits, keccak256, parseUnits, toUtf8Bytes } from "ethers";
import AoiMap from "../components/AoiMap.jsx";
import AgreementStrip from "../components/AgreementStrip.jsx";
import IndexChart from "../components/IndexChart.jsx";
import { ActionButton, FilePick, Loading, Notice, Pill, Stat } from "../components/ui.jsx";
import { api, isDemoMode } from "../lib/api.js";
import { aoiHashOf } from "../lib/aoi.js";
import { ESCROW_STATUS, useChain } from "../lib/chain.jsx";
import { useAsync, useNow } from "../lib/hooks.js";
import {
  DISPUTE_LABEL, FINAL_LABEL, OUTCOME_LABEL, outcomeTone, date, dateTime, duration, geo, num, pct, sameAddr, shortAddr, tone,
} from "../lib/format.js";

export default function ProjectPage() {
  const { projectId } = useParams();
  const project = useAsync(() => api.getProject(projectId), [projectId]);
  const records = useAsync(() => api.listVerifications(projectId), [projectId]);
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    if (records.data?.length && !records.data.some((r) => r.id === selectedId)) {
      setSelectedId((records.data.find((r) => !r.is_recheck) || records.data[0]).id);
    }
  }, [records.data, selectedId]);

  if (project.loading) return <div className="page"><Loading /></div>;
  if (project.error) {
    return (
      <div className="page">
        <Notice kind="error" title="Couldn't load this project">{project.error.message}</Notice>
        <Link to="/">Back to the map</Link>
      </div>
    );
  }
  const p = project.data;

  return (
    <div className="page project">
      <header className="project-head">
        <div>
          <Link to="/" className="crumb">All projects</Link>
          <h1>{p.name}</h1>
          <p className="muted">
            {p.project_id}, {num(p.aoi_area_km2, 2)} km², owned by {shortAddr(p.owner_address)}, bond {num(p.bond_deposit_amount)} GEO
          </p>
        </div>
        <div className="project-head-map">
          <AoiMap items={[{ id: p.project_id, name: p.name, geometry: p.aoi_geojson }]} padding={24} />
        </div>
      </header>

      <OnchainProject project={p} />

      <section className="section">
        <div className="section-head">
          <h2>Verification runs</h2>
          <SubmitExport projectId={p.project_id} onDone={(rec) => { records.reload(); setSelectedId(rec.id); }} />
        </div>
        {records.loading && <Loading />}
        {records.error && <Notice kind="error">{records.error.message}</Notice>}
        {records.data?.length === 0 && (
          <Notice title="No satellite data yet">
            Run Layer 1 for this area (python -m src.pipeline …) and upload the JSON it writes.
          </Notice>
        )}
        {records.data?.length > 0 && (
          <div className="run-tabs" role="tablist">
            {records.data.map((r) => (
              <button
                key={r.id}
                role="tab"
                aria-selected={r.id === selectedId}
                className={`run-tab ${r.id === selectedId ? "is-active" : ""}`}
                onClick={() => setSelectedId(r.id)}
              >
                <span>Run #{r.id}{r.is_recheck ? " (dispute recheck)" : ""}</span>
                <span className="muted">{date(r.ingested_at)}</span>
                <Pill tone={outcomeTone(r)}>{OUTCOME_LABEL[r.verification_outcome]}</Pill>
              </button>
            ))}
          </div>
        )}
      </section>

      {selectedId && <VerificationView key={selectedId} id={selectedId} project={p} onChanged={records.reload} />}
    </div>
  );
}

function VerificationView({ id, project, onChanged }) {
  const rec = useAsync(() => api.getVerification(id), [id]);
  const [index, setIndex] = useState("ndvi");
  if (rec.loading) return <Loading />;
  if (rec.error) return <Notice kind="error">{rec.error.message}</Notice>;
  const v = rec.data;
  const trendUp = (v.ndvi_trend_per_year ?? 0) > 0;

  return (
    <>
      <section className="section">
        <div className="verdict">
          <Pill tone={outcomeTone(v)}>{OUTCOME_LABEL[v.verification_outcome]}</Pill>
          {v.verification_outcome === "PROVISIONALLY_VERIFIED" && <Pill tone={tone(v)}>{FINAL_LABEL[v.finalization_status]}</Pill>}
          <span className="muted">Layer 1 export generated {dateTime(v.generated_at)}</span>
        </div>
        <div className="stats">
          <Stat label="Matched pairs that agree" value={pct(v.agreement_rate)} hint={`${v.ndvi_agreement_pass_count} of ${v.matched_pair_count}; needs 70%`} />
          <Stat label="Sentinel-2 dates with a Landsat match" value={pct(v.coverage_ratio)} hint={`${v.s2_scene_count} S2 and ${v.landsat_scene_count} Landsat scenes`} />
          <Stat label="NDVI trend per year" value={v.ndvi_trend_per_year == null ? "–" : `${trendUp ? "+" : ""}${v.ndvi_trend_per_year.toFixed(4)}`} hint={trendUp ? "Vegetation increasing" : "Vegetation flat or declining"} />
          <Stat label="Estimated tCO₂e per year" value={num(v.estimated_tons_co2e)} hint="Placeholder linear NDVI model" />
        </div>
        {v.estimated_tons_co2e != null && v.estimated_tons_co2e <= 0 && (
          <Notice kind="warn" title="Nothing to mint from this run">
            The satellites agree, but the NDVI trend is negative, so the CO₂e estimate is below zero. The relay only records runs with a positive estimate.
          </Notice>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Do the two satellites agree?</h2>
          <div className="seg" role="group" aria-label="Vegetation index">
            {["ndvi", "evi"].map((k) => (
              <button key={k} className={index === k ? "is-active" : ""} aria-pressed={index === k} onClick={() => setIndex(k)}>
                {k.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <AgreementStrip observations={v.aligned_observations} index={index} />
        <IndexChart observations={v.aligned_observations} index={index} />
      </section>

      {!v.is_recheck && v.verification_outcome === "PROVISIONALLY_VERIFIED" && (
        <ChallengeSection record={v} project={project} onChanged={() => { rec.reload(); onChanged(); }} />
      )}
    </>
  );
}

/** Project registration on Layer 3 (bond + AOI hash). */
function OnchainProject({ project }) {
  const { contracts, account, refreshKey, refresh } = useChain();
  const key = keccak256(toUtf8Bytes(project.project_id));
  const state = useAsync(async () => (contracts && !isDemoMode() ? contracts.escrow.projects(key) : null), [contracts, key, refreshKey]);
  if (!contracts || !state.data) return null;
  const onchain = state.data;

  if (onchain.exists) {
    return (
      <p className="onchain-line">
        On-chain: registered, bond {geo(onchain.bond)} GEO held in escrow
        {onchain.activeCount > 0n ? `, locked by ${onchain.activeCount} open verification${onchain.activeCount > 1n ? "s" : ""}` : ""}.
      </p>
    );
  }
  const bond = parseUnits(String(project.bond_deposit_amount), 18);
  const isOwner = sameAddr(account, project.owner_address);
  return (
    <Notice
      kind="warn"
      title="Not registered on-chain yet"
      action={
        isOwner && (
          <ActionButton
            onAction={async () => {
              const { token, escrow } = contracts;
              if ((await token.allowance(account, await escrow.getAddress())) < bond) {
                await (await token.approve(await escrow.getAddress(), bond)).wait();
              }
              await (await escrow.registerProject(project.project_id, aoiHashOf(project.aoi_geojson), bond)).wait();
            }}
            onDone={refresh}
          >
            Post {num(project.bond_deposit_amount)} GEO bond
          </ActionButton>
        )
      }
    >
      {isOwner
        ? "Post the bond so verified runs can open a challenge window and mint credits."
        : `The owner (${shortAddr(project.owner_address)}) needs to post the bond from their wallet.`}
    </Notice>
  );
}

function SubmitExport({ projectId, onDone }) {
  const [msg, setMsg] = useState(null);
  if (isDemoMode()) return null;
  return (
    <div className="inline-action">
      <FilePick
        label="Upload a Layer 1 export"
        onText={async (text) => {
          setMsg(null);
          try {
            const payload = JSON.parse(text);
            if (payload.project_id !== projectId) payload.project_id = projectId;
            const rec = await api.submitVerification(projectId, payload);
            setMsg({ kind: "ok", text: `Run #${rec.id} added: ${OUTCOME_LABEL[rec.verification_outcome]}.` });
            onDone(rec);
          } catch (e) {
            setMsg({ kind: "error", text: e.message });
          }
        }}
      />
      {msg && <p className={msg.kind === "error" ? "field-error" : "field-ok"}>{msg.text}</p>}
    </div>
  );
}

function ChallengeSection({ record, project, onChanged }) {
  const { contracts, account, wrongChain, isLocalChain, advanceTime, chainNow, refreshKey, refresh } = useChain();
  const now = useNow(1000);
  const disputes = useAsync(() => api.listDisputes(record.id), [record.id, refreshKey]);

  const chain = useAsync(async () => {
    if (!contracts || isDemoMode()) return null;
    const { escrow, token } = contracts;
    const [v, d, minStake, ts] = await Promise.all([
      escrow.verifications(record.id),
      escrow.disputes(record.id),
      escrow.minStakeFor(record.id),
      chainNow(),
    ]);
    let isOracle = false, balance = null;
    if (account) {
      [isOracle, balance] = await Promise.all([escrow.hasRole(await escrow.ORACLE_ROLE(), account), token.balanceOf(account)]);
    }
    // Token/verification ids on-chain are Layer 2 ids. If Layer 2's database was
    // reset after the chain was deployed, an id can point at another project.
    const foreign = Number(v.status) !== 0 && v.projectKey !== keccak256(toUtf8Bytes(record.project_id));
    return { v, d, minStake, chainTs: ts, fetchedAt: Date.now(), isOracle, balance, foreign };
  }, [contracts, record.id, account, refreshKey]);

  const done = () => { refresh(); onChanged(); };
  if (chain.data?.foreign) {
    return (
      <section className="section challenge">
        <h2>Challenge window</h2>
        <Notice kind="error" title={`On-chain record #${record.id} belongs to a different project`}>
          Layer 2's database was probably reset after the contracts were deployed, so its ids now clash with the chain. Restart the local chain and redeploy Layer 3, or reset Layer 2 to match.
        </Notice>
      </section>
    );
  }
  const c = chain.data;
  const status = c ? Number(c.v.status) : 0;
  const expires = c ? Number(c.v.challengeExpiresAt) : 0;
  const chainNowTs = c ? c.chainTs + Math.floor((now - c.fetchedAt) / 1000) : 0;
  const remaining = expires - chainNowTs;
  const canWrite = account && !wrongChain && !isDemoMode();

  return (
    <section className="section challenge">
      <div className="section-head">
        <h2>Challenge window</h2>
        {c && <Pill tone={["none", "open", "dispute", "good", "bad"][status]}>{ESCROW_STATUS[status]}</Pill>}
      </div>

      {isDemoMode() && <p className="muted">On-chain state isn't shown for the offline snapshot.</p>}
      {!contracts && !isDemoMode() && <p className="muted">Deploy Layer 3 to see the on-chain window and challenge this claim.</p>}

      {c && status === 0 && (
        <p className="muted">
          Layer 2 opened a window that closes {dateTime(record.challenge_window_expires_at)}. The oracle hasn't recorded this run on-chain yet, so there's nothing to challenge.
        </p>
      )}

      {c && status >= 1 && (
        <div className="window">
          <WindowBar expires={expires} windowSeconds={72 * 3600} nowTs={chainNowTs} status={status} />
          <dl className="kv">
            <dt>{status === 3 ? "Credits minted" : status === 4 ? "Credits" : "Credits if final"}</dt><dd>{status === 4 ? "None, the challenge succeeded" : `${num(c.v.tonnesCO2e)} tCO₂e (token #${record.id})`}</dd>
            <dt>Window closes</dt><dd>{dateTime(expires * 1000)} chain time{status === 1 && remaining > 0 ? `, ${duration(remaining)} left` : ""}</dd>
            <dt>Minimum stake</dt><dd>{geo(c.minStake)} GEO, equal to the project bond</dd>
            {c.d.challenger !== "0x0000000000000000000000000000000000000000" && (
              <><dt>Challenger</dt><dd>{shortAddr(c.d.challenger)} staked {geo(c.d.stake)} GEO</dd></>
            )}
          </dl>
        </div>
      )}

      {c && status >= 3 && ["OPEN_FOR_CHALLENGE", "UNDER_DISPUTE"].includes(record.finalization_status) && (
        <p className="muted">
          Layer 2 still shows this run as {FINAL_LABEL[record.finalization_status].toLowerCase()}: it keeps its own wall-clock window and catches up once that passes. The chain is the record for minting.
        </p>
      )}

      {c && status === 1 && remaining > 0 && (
        <ChallengeForm record={record} project={project} chainState={c} canWrite={canWrite} onDone={done} />
      )}

      {c && status === 1 && remaining <= 0 && (
        <div className="row">
          <p>Nobody challenged within 72 hours. Anyone can finalize to mint the credits to the owner.</p>
          <ActionButton disabled={!canWrite} onAction={async () => (await contracts.escrow.finalize(record.id)).wait()} onDone={done}>
            Finalize and mint
          </ActionButton>
        </div>
      )}

      {disputes.data?.length > 0 && (
        <div className="disputes">
          <h3>Disputes</h3>
          <ul>
            {disputes.data.map((d) => (
              <li key={d.id}>
                <Pill tone={d.status === "OPEN" ? "dispute" : d.status === "RESOLVED_PROJECT_WON" ? "good" : "bad"}>{DISPUTE_LABEL[d.status]}</Pill>
                <span>#{d.id} by {shortAddr(d.challenger_address)}, stake {num(d.challenger_stake_amount)} GEO, opened {dateTime(d.opened_at)}</span>
                {d.resolution_notes && <span className="muted">{d.resolution_notes}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {c?.isOracle && canWrite && (status === 0 || status === 2) && (
        <OraclePanel record={record} status={status} disputes={disputes.data || []} contracts={contracts} onDone={done} />
      )}

      {isLocalChain && c && status === 1 && remaining > 0 && (
        <div className="devbar">
          <span>Local Hardhat chain</span>
          <ActionButton variant="quiet" busyLabel="Mining…" onAction={() => advanceTime(remaining + 1)}>
            Skip to the end of the window
          </ActionButton>
        </div>
      )}
    </section>
  );
}

function WindowBar({ expires, windowSeconds, nowTs, status }) {
  const start = expires - windowSeconds;
  const frac = status === 1 ? Math.min(1, Math.max(0, (nowTs - start) / windowSeconds)) : 1;
  return (
    <div className={`windowbar windowbar-${status}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(frac * 100)} aria-label="Challenge window elapsed">
      <span style={{ width: `${frac * 100}%` }} />
      {[24, 48].map((h) => <i key={h} style={{ left: `${(h / 72) * 100}%` }} />)}
    </div>
  );
}

function ChallengeForm({ record, project, chainState, canWrite, onDone }) {
  const { contracts, account } = useChain();
  const [amount, setAmount] = useState(() => formatUnits(chainState.minStake, 18));
  const isOwner = sameAddr(account, project.owner_address);
  let stake = 0n;
  try { stake = parseUnits(amount || "0", 18); } catch { /* invalid input */ }
  const tooLow = stake < chainState.minStake;
  const tooHigh = chainState.balance != null && stake > chainState.balance;

  return (
    <div className="challenge-form">
      <p>
        Think the satellite data is wrong? Stake at least the project's bond. An independent recheck decides: if it fails, you get your stake back plus the bond; if it passes, your stake goes to the owner.
      </p>
      <div className="row">
        <label className="field">
          <span>Your stake (GEO)</span>
          <input type="number" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} />
          {tooLow && <span className="field-error">Must be at least {geo(chainState.minStake)} GEO.</span>}
          {!tooLow && tooHigh && <span className="field-error">Your wallet holds {geo(chainState.balance)} GEO.</span>}
        </label>
        <ActionButton
          variant="danger"
          disabled={!canWrite || isOwner || tooLow || tooHigh}
          onAction={async () => {
            const { token, escrow } = contracts;
            const escrowAddr = await escrow.getAddress();
            if ((await token.allowance(account, escrowAddr)) < stake) await (await token.approve(escrowAddr, stake)).wait();
            await (await escrow.challenge(record.id, stake)).wait();
            await api.openDispute(record.id, { challenger_address: account, challenger_stake_amount: formatUnits(stake, 18) });
          }}
          onDone={onDone}
        >
          Stake and challenge
        </ActionButton>
      </div>
      {!account && <p className="muted">Connect a wallet to challenge.</p>}
      {isOwner && <p className="muted">You own this project, so you can't challenge it.</p>}
    </div>
  );
}

/** Visible only to the ORACLE_ROLE wallet: does what layer3/scripts/relay.js does. */
function OraclePanel({ record, status, disputes, contracts, onDone }) {
  const tonnes = Math.floor(record.estimated_tons_co2e || 0);
  const open = disputes.find((d) => d.status === "OPEN");
  const resolved = disputes.find((d) => d.status !== "OPEN");
  const [err, setErr] = useState(null);

  return (
    <div className="oracle">
      <h3>Oracle relay</h3>
      <p className="muted">Your wallet holds ORACLE_ROLE. These buttons do the same job as layer3/scripts/relay.js.</p>
      {status === 0 && (
        tonnes > 0 ? (
          <ActionButton onAction={async () => (await contracts.escrow.recordVerification(record.project_id, record.id, tonnes)).wait()} onDone={onDone}>
            Record run #{record.id} on-chain ({num(tonnes)} tCO₂e)
          </ActionButton>
        ) : (
          <p>Run #{record.id} can't be recorded: its CO₂e estimate isn't positive.</p>
        )
      )}
      {status === 2 && open && (
        <div className="row">
          <p>Upload the independent recheck for dispute #{open.id}. Layer 2 judges it, then the verdict is sent on-chain.</p>
          <FilePick
            label="Upload recheck and settle"
            onText={async (text) => {
              setErr(null);
              try {
                const payload = JSON.parse(text);
                payload.project_id = record.project_id;
                const res = await api.resolveDispute(open.id, payload);
                await (await contracts.escrow.resolveDispute(record.id, res.escrow_verdict.winner === "challenger")).wait();
                onDone();
              } catch (e) {
                setErr(e.message || String(e));
              }
            }}
          />
        </div>
      )}
      {status === 2 && !open && resolved && (
        <ActionButton
          onAction={async () => (await contracts.escrow.resolveDispute(record.id, resolved.status === "RESOLVED_CHALLENGER_WON")).wait()}
          onDone={onDone}
        >
          Send Layer 2's verdict on-chain ({DISPUTE_LABEL[resolved.status].toLowerCase()})
        </ActionButton>
      )}
      {err && <p className="field-error">{err}</p>}
    </div>
  );
}
