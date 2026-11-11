import { useState } from "react";
import { txErrorMessage } from "../lib/chain.jsx";

export function Pill({ tone = "none", children }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

export function Notice({ kind = "info", title, children, action }) {
  return (
    <div className={`notice notice-${kind}`} role={kind === "error" ? "alert" : "status"}>
      <div>
        {title && <strong className="notice-title">{title}</strong>}
        {children && <div className="notice-body">{children}</div>}
      </div>
      {action}
    </div>
  );
}

/**
 * Button that runs an async action (usually a wallet transaction), shows
 * progress, and reports failure in plain words underneath.
 */
export function ActionButton({ onAction, children, busyLabel = "Waiting for wallet…", variant = "primary", disabled, onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function run() {
    setBusy(true);
    setError(null);
    try {
      const result = await onAction();
      onDone?.(result);
    } catch (e) {
      setError(e?.status !== undefined ? e.message : txErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="action">
      <button type="button" className={`btn btn-${variant}`} onClick={run} disabled={disabled || busy}>
        {busy ? busyLabel : children}
      </button>
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

export function Stat({ label, value, hint }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

export function Loading({ children = "Loading…" }) {
  return <p className="muted loading">{children}</p>;
}

/** Read a picked file as text. */
export function FilePick({ label, accept = ".json,.geojson,application/json", onText }) {
  return (
    <label className="filepick">
      <input
        type="file"
        accept={accept}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) onText(await f.text(), f.name);
          e.target.value = "";
        }}
      />
      <span className="btn btn-quiet">{label}</span>
    </label>
  );
}
