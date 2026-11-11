import { useState } from "react";
import { Link } from "react-router-dom";
import { parseUnits } from "ethers";
import { ActionButton, Loading, Notice, Stat } from "../components/ui.jsx";
import { useChain } from "../lib/chain.jsx";
import { useCreditData } from "../lib/credits.js";
import { useAsync } from "../lib/hooks.js";
import { geo, num } from "../lib/format.js";

export default function Portfolio() {
  const { contracts, account, wrongChain, connect, refreshKey, refresh, deploymentError } = useChain();
  const data = useCreditData();
  const balance = useAsync(async () => (contracts && account ? contracts.token.balanceOf(account) : null), [contracts, account, refreshKey]);

  if (deploymentError) return <div className="page"><h1>My credits</h1><Notice kind="warn">{deploymentError}</Notice></div>;
  if (!account || wrongChain) {
    return (
      <div className="page">
        <h1>My credits</h1>
        <Notice title={wrongChain ? "Your wallet is on another network" : "Connect a wallet to see your credits"}
          action={<button className="btn btn-primary" onClick={() => connect().catch(() => {})}>{wrongChain ? "Switch network" : "Connect wallet"}</button>} />
      </div>
    );
  }
  if (!contracts || data.loading || (!data.data && !data.error)) return <div className="page"><h1>My credits</h1><Loading /></div>;
  if (data.error) return <div className="page"><h1>My credits</h1><Notice kind="error">{data.error.message}</Notice></div>;

  const held = data.data.batches.filter((b) => b.mine > 0n);
  const totalHeld = held.reduce((s, b) => s + b.mine, 0n);
  const myRetired = data.data.retirements.filter((r) => r.holder.toLowerCase() === account.toLowerCase());
  const done = () => { refresh(); data.reload(); };

  return (
    <div className="page portfolio">
      <h1>My credits</h1>
      <div className="stats">
        <Stat label="Credits held (tCO₂e)" value={num(totalHeld)} />
        <Stat label="Retired by you (tCO₂e)" value={num(myRetired.reduce((s, r) => s + r.tonnes, 0n))} />
        <Stat label="GEO balance" value={geo(balance.data)} hint="Used for bonds, stakes and purchases" />
      </div>
      <div className="row">
        <ActionButton variant="quiet" busyLabel="Minting…" onAction={async () => (await contracts.token.mint(account, parseUnits("5000", 18))).wait()} onDone={done}>
          Get 5,000 test GEO
        </ActionButton>
        <span className="field-hint">Test token only. Anyone can mint MockGeoToken on local and test networks.</span>
      </div>

      <section className="section">
        <h2>Holdings</h2>
        {held.length === 0 && (
          <p className="muted">You don't hold any credits. Buy some on the <Link to="/market">marketplace</Link>, or finalize a verified project you own.</p>
        )}
        {held.map((b) => <Holding key={b.tokenId} batch={b} listings={data.data.listings} onDone={done} />)}
      </section>
    </div>
  );
}

function Holding({ batch, listings, onDone }) {
  const { contracts, account } = useChain();
  const [mode, setMode] = useState(null);
  const listed = listings.filter((l) => l.active && l.tokenId === batch.tokenId && l.seller.toLowerCase() === account.toLowerCase())
    .reduce((s, l) => s + l.remaining, 0n);

  return (
    <article className="holding">
      <header className="holding-head">
        <div>
          <h3>Batch #{batch.tokenId.toString()} <Link to={`/projects/${batch.projectId}`} className="muted">{batch.projectId}</Link></h3>
          <p className="muted">{num(batch.mine)} tCO₂e in your wallet{listed > 0n ? `, ${num(listed)} of them listed for sale` : ""}</p>
        </div>
        <div className="seg" role="group" aria-label="Action">
          <button className={mode === "sell" ? "is-active" : ""} aria-pressed={mode === "sell"} onClick={() => setMode(mode === "sell" ? null : "sell")}>Sell</button>
          <button className={mode === "retire" ? "is-active" : ""} aria-pressed={mode === "retire"} onClick={() => setMode(mode === "retire" ? null : "retire")}>Retire</button>
        </div>
      </header>
      {mode === "sell" && <SellForm batch={batch} contracts={contracts} account={account} onDone={() => { setMode(null); onDone(); }} />}
      {mode === "retire" && <RetireForm batch={batch} contracts={contracts} onDone={() => { setMode(null); onDone(); }} />}
    </article>
  );
}

function SellForm({ batch, contracts, account, onDone }) {
  const [amount, setAmount] = useState(batch.mine.toString());
  const [price, setPrice] = useState("2");
  const n = BigInt(Math.max(0, Math.floor(Number(amount) || 0)));
  let priceWei = 0n;
  try { priceWei = parseUnits(price || "0", 18); } catch { /* invalid */ }
  const valid = n > 0n && n <= batch.mine && priceWei > 0n;

  if (!contracts.market) return <Notice kind="warn">No marketplace contract in this deployment.</Notice>;
  return (
    <div className="row form-row">
      <label className="field"><span>Tonnes</span><input type="number" min="1" max={batch.mine.toString()} step="1" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      <label className="field"><span>Price per tonne (GEO)</span><input type="number" min="0" step="any" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
      <ActionButton
        disabled={!valid}
        onAction={async () => {
          const { credits, market } = contracts;
          const marketAddr = await market.getAddress();
          if (!(await credits.isApprovedForAll(account, marketAddr))) await (await credits.setApprovalForAll(marketAddr, true)).wait();
          await (await market.list(batch.tokenId, n, priceWei)).wait();
        }}
        onDone={onDone}
      >
        List {num(n)} tonnes
      </ActionButton>
      <p className="field-hint">The credits stay in your wallet until someone buys. The marketplace only gets permission to move them at sale time.</p>
    </div>
  );
}

function RetireForm({ batch, contracts, onDone }) {
  const [amount, setAmount] = useState("1");
  const [beneficiary, setBeneficiary] = useState("");
  const [jurisdiction, setJurisdiction] = useState("IN");
  const n = BigInt(Math.max(0, Math.floor(Number(amount) || 0)));
  const valid = n > 0n && n <= batch.mine && beneficiary.trim() && jurisdiction.trim();

  return (
    <div className="row form-row">
      <label className="field"><span>Tonnes</span><input type="number" min="1" max={batch.mine.toString()} step="1" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      <label className="field"><span>Claimed for</span><input value={beneficiary} onChange={(e) => setBeneficiary(e.target.value)} placeholder="Company or person" /></label>
      <label className="field field-narrow"><span>Country code</span><input value={jurisdiction} maxLength={8} onChange={(e) => setJurisdiction(e.target.value.toUpperCase())} /></label>
      <ActionButton
        variant="danger"
        disabled={!valid}
        onAction={async () => (await contracts.credits.retire(batch.tokenId, n, beneficiary.trim(), jurisdiction.trim())).wait()}
        onDone={onDone}
      >
        Retire {num(n)} tonnes
      </ActionButton>
      <p className="field-hint">Retiring burns the credits permanently. This can't be undone.</p>
    </div>
  );
}
