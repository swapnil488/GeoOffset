# GeoOffset — Layer 3: Smart Contracts (Solidity, ERC-1155)

Executes Layer 2's verdicts on-chain. Layer 2 decides *whether* a claim is
trustworthy (dual-pipeline satellite check + independent recheck on dispute);
Layer 3 holds the money and the credits, enforces the 72-hour challenge window
itself, and only mints carbon credits once a claim is final.

## 0. Design summary

| Contract | Role |
|---|---|
| `GeoOffsetEscrow.sol` | Project bonds, 72h challenge window, challenger stakes, dispute settlement, triggers minting |
| `GeoOffsetCredits.sol` | ERC-1155 credits. Token id = Layer 2 verification id, 1 token = 1 tCO2e. `retire()` burns permanently |
| `GeoOffsetMarketplace.sol` | Fixed-price listings for credits, paid in GEO. Non-custodial: credits and payment move wallet-to-wallet in one transaction |
| `MockGeoToken.sol` | Test ERC-20 ("GEO") for bonds/stakes on local/testnets only |

**Lifecycle (mirrors Layer 2 `FinalizationStatus`):**

```
registerProject(bond, AOI hash)            owner
        │
recordVerification(projectId, id, tCO2e)   ORACLE  (Layer 2 said PROVISIONALLY_VERIFIED)
        │  -> OpenForChallenge, 72h window starts ON-CHAIN, bond locked
        ├── no challenge, 72h pass → finalize(id)  anyone → FinalizedMintable, credits minted to owner
        └── challenge(id, stake ≥ bond)  anyone → UnderDispute
                 │
           resolveDispute(id, challengerWon)  ORACLE (Layer 2 recheck verdict)
                 ├── project won    → stake → owner, credits minted
                 └── challenger won → stake refunded + min(stake, bond) from bond, no credits
```

**Trust split (worth saying in review):** the oracle only reports *what* the
satellite verdict was. Timing, stake minimums, payout amounts and custody are
all enforced by the contract, so the oracle can't skip the challenge window,
mint without a verdict, or redirect funds. Payout amounts use the same rule as
Layer 2's `adjudicate()`.

**Cross-border double counting:**
1. *Registration* — the AOI hash (keccak256 of the canonical GeoJSON) must be
   unique, so the same polygon can't be registered twice under two project ids
   (e.g. once per country). Partial overlaps are caught by Layer 2's PostGIS
   query before the oracle records anything.
2. *Retirement* — `retire(id, tonnes, beneficiary, jurisdiction)` burns the
   credits and records where the claim was made. A burned tonne can't be
   claimed again anywhere.

## 1. Project structure

```
layer3/
├── contracts/
│   ├── GeoOffsetEscrow.sol
│   ├── GeoOffsetCredits.sol
│   ├── GeoOffsetMarketplace.sol
│   └── MockGeoToken.sol
├── scripts/
│   ├── deploy.js     # deploys all four, grants MINTER_ROLE, writes deployments/<network>.json (+ layer4/public/deployments/)
│   ├── relay.js      # Layer 2 API -> chain oracle bridge (record / resolve / finalize / status)
│   └── demo.js       # full lifecycle on a local chain, no Layer 2 needed
├── test/GeoOffset.test.js   # 19 tests
├── hardhat.config.js        # hardhat, localhost, polygonAmoy, arbitrumSepolia
└── .env.example
```

## 2. Install

Requires Node.js 18+ (20/22 LTS recommended).

```powershell
cd E:\GeoOffset\layer3
npm install
copy .env.example .env      # only needed for testnets / custom settings
```

## 3. Test and demo

```powershell
npx hardhat test                  # 19 passing
npx hardhat run scripts/demo.js   # walk-through of both paths
```

## 4. Run against Layer 2 locally

Terminal 1 — local chain:
```powershell
npx hardhat node
```
Terminal 2 — deploy (deployer = oracle by default):
```powershell
npx hardhat run scripts/deploy.js --network localhost
```
Terminal 3 — Layer 2 API (`uvicorn app.main:app --port 8000` in `layer2/`).

The project owner registers on-chain with `registerProject(projectId, aoiHash, bond)`
using the same `project_id` as in Layer 2. Then relay Layer 2 verdicts (PowerShell):

```powershell
# After POST /projects/{id}/verifications returns PROVISIONALLY_VERIFIED (say id 1)
$env:RELAY_ACTION="record"; $env:VERIFICATION_ID="1"
npx hardhat run scripts/relay.js --network localhost

# After a dispute is resolved in Layer 2 (POST /disputes/{id}/resolve), say dispute 1
$env:RELAY_ACTION="resolve"; $env:DISPUTE_ID="1"
npx hardhat run scripts/relay.js --network localhost

# After 72h with no challenge (on a local node: npx hardhat console -> time travel)
$env:RELAY_ACTION="finalize"; $env:VERIFICATION_ID="1"
npx hardhat run scripts/relay.js --network localhost

$env:RELAY_ACTION="status"; $env:VERIFICATION_ID="1"
npx hardhat run scripts/relay.js --network localhost
```

## 5. Testnet deploy

Fill `PRIVATE_KEY` in `.env` with a **testnet-only** wallet funded from a faucet, then:

```powershell
npm run deploy:amoy          # Polygon Amoy (chainId 80002)
npm run deploy:arbsepolia    # Arbitrum Sepolia (chainId 421614)
```

## 6. Known MVP simplifications

- Single oracle key. Production would use a multisig or several independent
  relayers (or a signed-verdict scheme verified on-chain).
- `MockGeoToken` lets anyone mint; replace with a real stablecoin via
  `STAKE_TOKEN_ADDRESS` outside testing.
- Credits are minted in whole tonnes (`floor(estimated_tons_co2e)`).
- One active dispute per verification (same as Layer 2).
- Wallet ownership isn't yet checked against Layer 2's `owner_address`; the
  relay could compare them before recording.
