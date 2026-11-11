/**
 * Full Layer 3 lifecycle on a local chain — no Layer 2 needed. Good for
 * reviews/viva: shows both the unchallenged mint path and a dispute.
 *
 *   npx hardhat run scripts/demo.js            (in-process Hardhat network)
 *
 * The AOI hash is computed from ../data/sample_aoi.geojson (Layer 1's
 * sample AOI), so the on-chain registration is tied to the real polygon.
 */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

async function main() {
  const { ethers } = hre;
  const [admin, oracle, owner, challenger, buyer] = await ethers.getSigners();
  const fmt = (x) => ethers.formatEther(x);

  const token = await ethers.deployContract("MockGeoToken");
  const credits = await ethers.deployContract("GeoOffsetCredits", ["ipfs://geooffset/{id}.json", admin.address]);
  const escrow = await ethers.deployContract("GeoOffsetEscrow", [
    await token.getAddress(), await credits.getAddress(), admin.address, oracle.address,
  ]);
  await credits.grantRole(await credits.MINTER_ROLE(), await escrow.getAddress());
  console.log("Deployed token / credits / escrow\n");

  for (const s of [owner, challenger]) {
    await token.mint(s.address, ethers.parseEther("5000"));
    await token.connect(s).approve(await escrow.getAddress(), ethers.MaxUint256);
  }

  const aoiPath = path.join(__dirname, "..", "..", "data", "sample_aoi.geojson");
  // Canonicalise (parse + re-stringify) so whitespace changes don't change the hash.
  const aoiText = fs.existsSync(aoiPath) ? JSON.stringify(JSON.parse(fs.readFileSync(aoiPath, "utf8"))) : "demo-aoi";
  const aoiHash = ethers.keccak256(ethers.toUtf8Bytes(aoiText));
  const bond = ethers.parseEther("1000");

  await escrow.connect(owner).registerProject("demo-project-001", aoiHash, bond);
  console.log(`1. Owner registered demo-project-001, bond ${fmt(bond)} GEO, AOI hash ${aoiHash.slice(0, 18)}…`);

  try {
    await escrow.connect(challenger).registerProject("copy-in-another-country", aoiHash, bond);
  } catch (e) {
    console.log("   Same AOI under a second project id -> rejected (double-count guard)");
  }

  // --- Path A: unchallenged ---
  await escrow.connect(oracle).recordVerification("demo-project-001", 1, 1200);
  console.log("\n2A. Oracle recorded verification #1 (1200 tCO2e) -> 72h challenge window open");
  await time.increase(72 * 3600);
  await escrow.finalize(1);
  console.log(`    72h passed unchallenged -> finalized; owner holds ${await credits.balanceOf(owner.address, 1)} credits (token id 1)`);

  await credits.connect(owner).safeTransferFrom(owner.address, buyer.address, 1, 400, "0x");
  await credits.connect(buyer).retire(1, 250, "Acme Ltd", "IN");
  console.log(`    Buyer bought 400, retired 250 -> balance ${await credits.balanceOf(buyer.address, 1)}, retired ${await credits.retiredSupply(1)}`);

  // --- Path B: disputed, challenger wins ---
  await escrow.connect(oracle).recordVerification("demo-project-001", 2, 900);
  console.log("\n2B. Oracle recorded verification #2 (900 tCO2e)");
  const chBefore = await token.balanceOf(challenger.address);
  await escrow.connect(challenger).challenge(2, bond);
  console.log(`    Challenger staked ${fmt(bond)} GEO -> UNDER_DISPUTE`);
  await escrow.connect(oracle).resolveDispute(2, true);
  const key = await escrow.projectKeyOf("demo-project-001");
  console.log(`    Independent recheck failed -> challenger won ${fmt((await token.balanceOf(challenger.address)) - chBefore)} GEO; ` +
    `project bond now ${fmt((await escrow.projects(key)).bond)} GEO; credits for #2: ${await credits["totalSupply(uint256)"](2)}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
