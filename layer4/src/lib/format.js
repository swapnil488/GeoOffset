import { formatUnits } from "ethers";

export const shortAddr = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
export const sameAddr = (a, b) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());

export const pct = (x, digits = 0) => (x == null ? "–" : `${(x * 100).toFixed(digits)}%`);

export function num(x, digits = 0) {
  if (x == null || Number.isNaN(Number(x))) return "–";
  return Number(x).toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

/** GEO token amounts (18 decimals) */
export const geo = (wei, digits = 2) => (wei == null ? "–" : num(formatUnits(wei, 18), digits));

export function date(d) {
  if (!d) return "–";
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
export function dateTime(d) {
  if (!d) return "–";
  return new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function duration(seconds) {
  if (seconds <= 0) return "0m";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : h ? `${h}h ${m}m` : `${m}m`;
}

// Layer 2 enums -> plain words
export const OUTCOME_LABEL = {
  PROVISIONALLY_VERIFIED: "Satellites agree",
  REJECTED: "Satellites disagree",
  INSUFFICIENT_DATA: "Not enough data",
};
export const FINAL_LABEL = {
  NOT_APPLICABLE: "Not eligible",
  OPEN_FOR_CHALLENGE: "Open for challenge",
  UNDER_DISPUTE: "Under dispute",
  FINALIZED_MINTABLE: "Final, mintable",
  FINALIZED_REJECTED: "Final, rejected",
};
export const DISPUTE_LABEL = {
  OPEN: "Recheck pending",
  RESOLVED_PROJECT_WON: "Project upheld",
  RESOLVED_CHALLENGER_WON: "Challenger upheld",
};

/** One status tone per verification, used for map polygons and pills. */
export function tone(v) {
  if (!v) return "none";
  if (v.finalization_status === "FINALIZED_MINTABLE") return "good";
  if (v.finalization_status === "OPEN_FOR_CHALLENGE") return "open";
  if (v.finalization_status === "UNDER_DISPUTE") return "dispute";
  if (v.verification_outcome === "INSUFFICIENT_DATA") return "none";
  return "bad";
}

/** Tone for the satellite verdict alone (ignores the challenge window). */
export const outcomeTone = (v) =>
  ({ PROVISIONALLY_VERIFIED: "good", REJECTED: "bad", INSUFFICIENT_DATA: "none" })[v?.verification_outcome] || "none";
