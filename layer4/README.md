# GeoOffset — Layer 4: Frontend (React)

The part people actually use. It reads verdicts from Layer 2, reads and writes
Layer 3's contracts through the user's wallet, and draws project areas on a
satellite map.

| Page | What it does | Talks to |
|---|---|---|
| **Map** (`/`) | Every project's AOI on a satellite basemap, coloured by status; list with agreement rate | Layer 2 `GET /projects` |
| **Project** (`/projects/:id`) | Agreement strip + NDVI/EVI chart (Sentinel-2 vs Landsat), verification stats, live 72h challenge window, challenge / finalize, dispute history, upload a Layer 1 export | Layer 2 + escrow contract |
| **Register a project** | Paste/upload GeoJSON, preview on the map, area computed client-side, saves to Layer 2 then posts the bond on-chain (AOI hash checked for double registration first) | Layer 2 `POST /projects` + `registerProject` |
| **Marketplace** | Active listings with partial buy, all minted batches, public retirement ledger | marketplace + credits contracts |
| **My credits** | GEO balance + test faucet, holdings per batch, list for sale, retire (burn) with beneficiary and country | credits + marketplace contracts |

Two extras for demos and reviews:

- **Oracle relay panel.** If the connected wallet holds `ORACLE_ROLE` (on localhost
  that's Hardhat account #0, the deployer), the project page shows buttons that do
  what `layer3/scripts/relay.js` does: record a verified run on-chain, and upload a
  recheck to settle a dispute (Layer 2 judges it, then the verdict goes on-chain).
- **Skip to the end of the window.** On a local Hardhat chain only, fast-forwards
  chain time past the 72h window so you can finalize and mint without waiting.

If Layer 2 isn't running, read pages fall back to `src/demo/demoData.json`, a
saved snapshot of a real Layer 2 run on `data/demo-project-001_timeseries.json`.
A banner says so, and anything that writes is turned off.

## Stack

Vite 5, React 18, React Router, Leaflet / react-leaflet (Esri World Imagery +
OSM basemaps), Recharts, ethers v6, @turf/area.

```
layer4/
├── public/deployments/      # <network>.json written by layer3/scripts/deploy.js
├── src/
│   ├── lib/api.js           # Layer 2 client + offline snapshot fallback
│   ├── lib/chain.jsx        # contract ABIs, deployment loader, wallet, local time travel
│   ├── lib/credits.js       # minted batches, retirements, listings (from events/state)
│   ├── lib/aoi.js           # GeoJSON validation, area, on-chain AOI hash
│   ├── components/          # AoiMap, AgreementStrip, IndexChart, shared UI
│   ├── pages/               # Explorer, ProjectPage, Register, Marketplace, Portfolio
│   └── demo/demoData.json   # offline snapshot
└── vite.config.js           # dev server on port 3000 (matches Layer 2 CORS)
```

## Run it locally (Windows / PowerShell)

Needs Node.js 18+ and a browser wallet (MetaMask).

```powershell
# Terminal 1 - local chain
cd E:\GeoOffset\layer3
npx hardhat node

# Terminal 2 - deploy contracts (also writes layer4\public\deployments\localhost.json)
cd E:\GeoOffset\layer3
npx hardhat run scripts/deploy.js --network localhost

# Terminal 3 - Layer 2 API
cd E:\GeoOffset\layer2
uvicorn app.main:app --reload --port 8000

# Terminal 4 - frontend
cd E:\GeoOffset\layer4
npm install
npm run dev          # http://localhost:3000
```

Open **http://localhost:3000** (not 127.0.0.1: Layer 2's CORS allows the
`localhost` origin).

### MetaMask on the local chain

1. Add a network: RPC `http://127.0.0.1:8545`, chain id `31337`, symbol ETH
   (or click **Connect wallet** and let the app add it).
2. Import a few of the private keys `npx hardhat node` prints:
   - account #0: deployer + **oracle**
   - account #1: project owner
   - account #2: challenger
   - account #3: buyer
3. After restarting `hardhat node`, use MetaMask's *Settings → Advanced → Clear
   activity tab data* for each account, or it will send stale nonces.

## Demo script (about 5 minutes)

1. **Owner (#1):** My credits → *Get 5,000 test GEO*. Register a project → upload
   `data/sample_aoi.geojson`, bond 1000, and attach a Layer 1 export → *Register
   and post bond*. The steps list shows each Layer 2 / on-chain step as it lands.
2. **Map:** the AOI appears on the satellite map; click it for agreement stats.
3. **Oracle (#0):** open the project → *Record run #N on-chain*. The window bar
   starts.
4. **Challenger (#2):** get test GEO → *Stake and challenge*. Status: under dispute.
5. **Oracle (#0):** *Upload recheck and settle* with an independent Layer 1 run.
   If it agrees, the project is upheld, the challenger's stake goes to the owner
   and credits are minted. Or skip steps 4–5 and use *Skip to the end of the
   window* → *Finalize and mint*.
6. **Owner (#1):** My credits → *Sell* 500 tonnes at 2 GEO.
7. **Buyer (#3):** get test GEO → Marketplace → *Buy*; then My credits → *Retire*
   with a beneficiary and country code. It shows up in the retirement ledger.

> The bundled `data/demo-project-001_timeseries.json` has a slightly **negative**
> NDVI trend, so Layer 2 estimates negative tCO₂e for it and there's nothing to
> mint (the page says so). For the mint/market part of the demo, use a Layer 1
> run over an area with increasing vegetation.

## Configuration

Copy `.env.example` to `.env` to change any of these:

| Variable | Default | |
|---|---|---|
| `VITE_LAYER2_URL` | `http://localhost:8000` | Layer 2 API |
| `VITE_CHAIN_NETWORK` | `localhost` | which `public/deployments/<network>.json` to load (`polygonAmoy`, `arbitrumSepolia`) |
| `VITE_RPC_URL` | `http://127.0.0.1:8545` | read-only RPC when no wallet is connected |

For a testnet: deploy with `npm run deploy:amoy` in `layer3/`, set
`VITE_CHAIN_NETWORK=polygonAmoy` and `VITE_RPC_URL` to an Amoy RPC.

## Notes

- The frontend hashes the AOI **geometry** (`{type, coordinates}`) for
  `registerProject`, so the hash from an uploaded file and from Layer 2's stored
  copy always match. `layer3/scripts/demo.js` hashes the whole Feature file, so
  the two scripts' hashes for the same polygon differ.
- Layer 2 tracks the 72h window on wall-clock time; the contract uses chain time.
  After a local time skip the chain says *finalized* while Layer 2 still says *open*;
  the page explains this. Minting follows the chain.
- On-chain verification and token ids are Layer 2 ids. If you reset the Layer 2
  database, restart `hardhat node` and redeploy too. The project page detects a
  mismatch and says so instead of showing another project's state.
- Batches and retirements come from contract events scanned from the deploy
  block. Fine for local and testnets; a production deployment would use an indexer.
