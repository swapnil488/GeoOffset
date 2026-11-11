import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { isDemoMode, onDemoModeChange, LAYER2_URL } from "../lib/api.js";
import { useChain, txErrorMessage } from "../lib/chain.jsx";
import { shortAddr } from "../lib/format.js";

export default function TopBar() {
  const { account, connect, wrongChain, deployment, deploymentError, hasWallet } = useChain();
  const [demo, setDemo] = useState(isDemoMode());
  const [err, setErr] = useState(null);
  useEffect(() => onDemoModeChange(setDemo), []);

  return (
    <>
      <header className="topbar">
        <NavLink to="/" className="wordmark" aria-label="GeoOffset home">
          <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
            <rect width="32" height="32" rx="7" fill="var(--ink)" />
            <path d="M8 13h16" stroke="var(--ls-bright)" strokeWidth="3" strokeLinecap="round" />
            <path d="M8 20h16" stroke="var(--s2-bright)" strokeWidth="3" strokeLinecap="round" />
          </svg>
          GeoOffset
        </NavLink>
        <nav className="nav">
          <NavLink to="/" end>Map</NavLink>
          <NavLink to="/market">Marketplace</NavLink>
          <NavLink to="/portfolio">My credits</NavLink>
          <NavLink to="/register">Register a project</NavLink>
        </nav>
        <div className="wallet">
          {deployment && <span className="chain-name">{deployment.network}</span>}
          {account && !wrongChain ? (
            <span className="addr" title={account}>{shortAddr(account)}</span>
          ) : (
            <button
              className="btn btn-primary btn-small"
              disabled={!hasWallet}
              title={hasWallet ? "" : "Install MetaMask to sign transactions"}
              onClick={() => connect().then(() => setErr(null), (e) => setErr(txErrorMessage(e)))}
            >
              {wrongChain ? "Switch network" : "Connect wallet"}
            </button>
          )}
        </div>
      </header>
      {demo && (
        <div className="banner banner-demo">
          Layer 2 isn't running at {LAYER2_URL}, so you're seeing a saved snapshot of a real verification run. Actions that write data are off.
        </div>
      )}
      {deploymentError && <div className="banner banner-warn">{deploymentError}</div>}
      {err && <div className="banner banner-warn">{err}</div>}
    </>
  );
}
