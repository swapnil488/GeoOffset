/**
 * Layer 2 -> Layer 3 oracle relay.
 *
 * Reads verdicts from the running Layer 2 FastAPI service and writes them
 * on-chain with the ORACLE_ROLE key. Layer 2 never touches a wallet; this
 * relay is the only bridge, and the escrow contract still enforces timing
 * and payout amounts itself.
 *
 * Usage (from layer3/):
 *   npx hardhat run scripts/relay.js --network localhost
 * with env vars:
 *   RELAY_ACTION=record   VERIFICATION_ID=1      # PROVISIONALLY_VERIFIED -> open challenge window
 *   RELAY_ACTION=resolve  DISPUTE_ID=1           # relay escrow verdict of a resolved dispute
 *   RELAY_ACTION=finalize VERIFICATION_ID=1      # mint after unchallenged window
 *   RELAY_ACTION=status   VERIFICATION_ID=1      # print on-chain state
 *   LAYER2_URL=http://localhost:8000              # default
 *
 * (Hardhat's `run` doesn't forward CLI args, hence env vars. On Windows
 *  PowerShell: $env:RELAY_ACTION="record"; $env:VERIFICATION_ID="1")
 */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const STATUS = ["None", "OpenForChallenge", "UnderDispute", "FinalizedMintable", "FinalizedRejected"];

async function getJson(url) {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

function loadDeployment(networkName) {
  const file = path.join(__dirname, "..", "deployments", `${networkName}.json`);
  if (!fs.existsSync(file)) throw new Error(`No ${file}. Run scripts/deploy.js on this network first.`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

async function main() {
  const { ethers, network } = hre;
  const action = process.env.RELAY_ACTION;
  const layer2 = (process.env.LAYER2_URL || "http://localhost:8000").replace(/\/$/, "");
  const dep = loadDeployment(network.name);
  const escrow = await ethers.getContractAt("GeoOffsetEscrow", dep.escrow);

  if (action === "record") {
    const id = Number(process.env.VERIFICATION_ID);
    const rec = await getJson(`${layer2}/verifications/${id}`);
    if (rec.verification_outcome !== "PROVISIONALLY_VERIFIED") {
      throw new Error(`Verification ${id} is ${rec.verification_outcome}; only PROVISIONALLY_VERIFIED is recorded on-chain.`);
    }
    if (rec.is_recheck) throw new Error(`Verification ${id} is a dispute recheck, not an original claim.`);
    const tonnes = Math.floor(rec.estimated_tons_co2e || 0);
    if (tonnes <= 0) throw new Error(`Verification ${id} has no positive CO2e estimate.`);

    const tx = await escrow.recordVerification(rec.project_id, id, tonnes);
    await tx.wait();
    const v = await escrow.verifications(id);
    console.log(`Recorded verification ${id} (${rec.project_id}, ${tonnes} tCO2e). ` +
      `Challenge window closes ${new Date(Number(v.challengeExpiresAt) * 1000).toISOString()}  tx=${tx.hash}`);
  } else if (action === "resolve") {
    const disputeId = Number(process.env.DISPUTE_ID);
    const d = await getJson(`${layer2}/disputes/${disputeId}`);
    if (d.status === "OPEN") throw new Error(`Dispute ${disputeId} is still OPEN in Layer 2 — resolve it there first.`);
    const challengerWon = d.status === "RESOLVED_CHALLENGER_WON";
    const tx = await escrow.resolveDispute(d.verification_record_id, challengerWon);
    await tx.wait();
    console.log(`Dispute ${disputeId} on verification ${d.verification_record_id} settled on-chain: ` +
      `${challengerWon ? "challenger" : "project"} won  tx=${tx.hash}`);
  } else if (action === "finalize") {
    const id = Number(process.env.VERIFICATION_ID);
    const tx = await escrow.finalize(id);
    await tx.wait();
    console.log(`Verification ${id} finalized; credits minted  tx=${tx.hash}`);
  } else if (action === "status") {
    const id = Number(process.env.VERIFICATION_ID);
    const v = await escrow.verifications(id);
    console.log({
      verificationId: id,
      status: STATUS[Number(v.status)],
      tonnesCO2e: v.tonnesCO2e.toString(),
      challengeExpiresAt: new Date(Number(v.challengeExpiresAt) * 1000).toISOString(),
    });
  } else {
    throw new Error("Set RELAY_ACTION to record | resolve | finalize | status");
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exitCode = 1;
});
