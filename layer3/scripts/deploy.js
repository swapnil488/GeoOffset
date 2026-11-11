/**
 * Deploys Layer 3: stake token (mock, unless STAKE_TOKEN_ADDRESS is set),
 * GeoOffsetCredits (ERC-1155), GeoOffsetEscrow and GeoOffsetMarketplace, then
 * grants the escrow MINTER_ROLE on the credits contract.
 *
 *   npx hardhat run scripts/deploy.js --network localhost
 *   npx hardhat run scripts/deploy.js --network polygonAmoy
 *
 * Addresses are written to deployments/<network>.json, which relay.js reads,
 * and copied to ../layer4/public/deployments/<network>.json for the frontend.
 */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const { ethers, network } = hre;
  const [deployer] = await ethers.getSigners();
  const oracle = process.env.ORACLE_ADDRESS || deployer.address;
  const baseUri = process.env.CREDITS_BASE_URI || "https://geooffset.example/credits/{id}.json";

  console.log(`Network: ${network.name}  deployer: ${deployer.address}  oracle: ${oracle}`);

  let stakeTokenAddress = process.env.STAKE_TOKEN_ADDRESS;
  if (!stakeTokenAddress) {
    const token = await ethers.deployContract("MockGeoToken");
    await token.waitForDeployment();
    stakeTokenAddress = await token.getAddress();
    console.log(`MockGeoToken     ${stakeTokenAddress}`);
  }

  const credits = await ethers.deployContract("GeoOffsetCredits", [baseUri, deployer.address]);
  await credits.waitForDeployment();
  console.log(`GeoOffsetCredits ${await credits.getAddress()}`);

  const escrow = await ethers.deployContract("GeoOffsetEscrow", [
    stakeTokenAddress,
    await credits.getAddress(),
    deployer.address,
    oracle,
  ]);
  await escrow.waitForDeployment();
  console.log(`GeoOffsetEscrow  ${await escrow.getAddress()}`);

  const market = await ethers.deployContract("GeoOffsetMarketplace", [
    await credits.getAddress(),
    stakeTokenAddress,
  ]);
  await market.waitForDeployment();
  console.log(`GeoOffsetMarket  ${await market.getAddress()}`);

  await (await credits.grantRole(await credits.MINTER_ROLE(), await escrow.getAddress())).wait();
  console.log("Granted MINTER_ROLE to escrow");

  const out = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    stakeToken: stakeTokenAddress,
    credits: await credits.getAddress(),
    escrow: await escrow.getAddress(),
    marketplace: await market.getAddress(),
    oracle,
    deployBlock: await ethers.provider.getBlockNumber(),
    deployedAt: new Date().toISOString(),
  };
  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${network.name}.json`), JSON.stringify(out, null, 2));
  console.log(`Saved deployments/${network.name}.json`);

  const frontendDir = path.join(__dirname, "..", "..", "layer4", "public", "deployments");
  if (fs.existsSync(path.join(__dirname, "..", "..", "layer4"))) {
    fs.mkdirSync(frontendDir, { recursive: true });
    fs.writeFileSync(path.join(frontendDir, `${network.name}.json`), JSON.stringify(out, null, 2));
    console.log(`Copied to layer4/public/deployments/${network.name}.json`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
