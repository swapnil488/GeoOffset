import { useState } from "react";
import { Link } from "react-router-dom";
import { ActionButton, Loading, Notice } from "../components/ui.jsx";
import { useChain } from "../lib/chain.jsx";
import { useCreditData } from "../lib/credits.js";
import { date, geo, num, sameAddr, shortAddr } from "../lib/format.js";

export default function Marketplace() {
  const { contracts, deploymentError } = useChain();
  const data = useCreditData();

  if (deploymentError) return <div className="page"><h1>Marketplace</h1><Notice kind="warn">{deploymentError}</Notice></div>;
  if (!contracts || data.loading || (!data.data && !data.error)) return <div className="page"><h1>Marketplace</h1><Loading /></div>;
  if (data.error) return <div className="page"><h1>Marketplace</h1><Notice kind="error" title="Couldn't read the chain">{data.error.message}</Notice></div>;
  const { batches, retirements, listings } = data.data;
  const active = listings.filter((l) => l.active);

  return (
    <div className="page market">
      <h1>Marketplace</h1>
      <p className="lede">
        Each credit is one tonne of CO₂e from a verification run that both satellites agreed on and nobody successfully challenged. Payment and credits swap in one transaction, straight between wallets.
      </p>

      <section className="section">
        <h2>For sale</h2>
        {!contracts.market && <Notice kind="warn">This deployment has no marketplace contract. Redeploy Layer 3 to add it.</Notice>}
        {contracts.market && active.length === 0 && (
          <Notice title="Nothing listed right now">Credit holders can list from <Link to="/portfolio">My credits</Link>.</Notice>
        )}
        {active.length > 0 && (
          <table className="table">
            <thead>
              <tr><th>Batch</th><th>Project</th><th className="num">Tonnes left</th><th className="num">Price per tonne</th><th>Seller</th><th>Buy</th></tr>
            </thead>
            <tbody>
              {active.map((l) => <ListingRow key={l.id} listing={l} onDone={data.reload} />)}
            </tbody>
          </table>
        )}
      </section>

      <section className="section">
        <h2>Credit batches</h2>
        {batches.length === 0 ? (
          <p className="muted">No credits minted yet. A batch appears here when a verification run is finalized on-chain.</p>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Batch</th><th>Project</th><th>Minted</th><th className="num">Issued</th><th className="num">In circulation</th><th className="num">Retired</th></tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.tokenId}>
                  <td>#{b.tokenId.toString()}</td>
                  <td><Link to={`/projects/${b.projectId}`}>{b.projectId}</Link></td>
                  <td>{date(b.mintedAt)}</td>
                  <td className="num">{num(b.mintedTonnes)}</td>
                  <td className="num">{num(b.supply)}</td>
                  <td className="num">{num(b.retired)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="section">
        <h2>Retirements</h2>
        <p className="muted">Retired credits are burned, and the country the claim was made in is recorded with them. A burned tonne can't be claimed again anywhere.</p>
        {retirements.length === 0 ? (
          <p className="muted">No credits retired yet.</p>
        ) : (
          <table className="table">
            <thead><tr><th>When</th><th>Batch</th><th className="num">Tonnes</th><th>Claimed for</th><th>Jurisdiction</th><th>By</th></tr></thead>
            <tbody>
              {retirements.map((r) => (
                <tr key={r.txHash + r.tokenId}>
                  <td>{date(r.time)}</td>
                  <td>#{r.tokenId.toString()}</td>
                  <td className="num">{num(r.tonnes)}</td>
                  <td>{r.beneficiary}</td>
                  <td>{r.jurisdiction}</td>
                  <td>{shortAddr(r.holder)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function ListingRow({ listing, onDone }) {
  const { contracts, account, wrongChain } = useChain();
  const [amount, setAmount] = useState("1");
  const n = BigInt(Math.max(0, Math.floor(Number(amount) || 0)));
  const total = n * listing.pricePerTonne;
  const mine = sameAddr(account, listing.seller);
  const valid = n > 0n && n <= listing.remaining;

  return (
    <tr>
      <td>#{listing.tokenId.toString()}</td>
      <td>{listing.projectId ? <Link to={`/projects/${listing.projectId}`}>{listing.projectId}</Link> : "–"}</td>
      <td className="num">{num(listing.remaining)}</td>
      <td className="num">{geo(listing.pricePerTonne)} GEO</td>
      <td>{mine ? "You" : shortAddr(listing.seller)}</td>
      <td>
        {mine ? (
          <ActionButton variant="quiet" disabled={wrongChain} onAction={async () => (await contracts.market.cancel(listing.id)).wait()} onDone={onDone}>
            Cancel listing
          </ActionButton>
        ) : (
          <div className="buy">
            <input type="number" min="1" max={listing.remaining.toString()} step="1" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Tonnes to buy" />
            <ActionButton
              disabled={!account || wrongChain || !valid}
              onAction={async () => {
                const { token, market } = contracts;
                const marketAddr = await market.getAddress();
                if ((await token.balanceOf(account)) < total) throw new Error(`You need ${geo(total)} GEO for this purchase.`);
                if ((await token.allowance(account, marketAddr)) < total) await (await token.approve(marketAddr, total)).wait();
                await (await market.buy(listing.id, n)).wait();
              }}
              onDone={onDone}
            >
              Buy for {geo(total)} GEO
            </ActionButton>
          </div>
        )}
      </td>
    </tr>
  );
}
