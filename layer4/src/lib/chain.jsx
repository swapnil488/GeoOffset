/**
 * Layer 3 connection: deployment addresses, read-only provider, wallet.
 *
 * Addresses come from public/deployments/<network>.json, which
 * layer3/scripts/deploy.js writes. Reads go through a plain JSON-RPC
 * provider so the app works without a wallet; writes need MetaMask (or any
 * injected EIP-1193 wallet) on the same chain.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { BrowserProvider, Contract, JsonRpcProvider } from "ethers";

const NETWORK = import.meta.env.VITE_CHAIN_NETWORK || "localhost";
const RPC_URL = import.meta.env.VITE_RPC_URL || "http://127.0.0.1:8545";

// Human-readable ABIs: only what the frontend calls. Kept in sync with layer3/contracts.
export const ABI = {
  token: [
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)",
    "function mint(address to, uint256 amount)",
    "function symbol() view returns (string)",
  ],
  escrow: [
    "function ORACLE_ROLE() view returns (bytes32)",
    "function hasRole(bytes32 role, address account) view returns (bool)",
    "function projectKeyOf(string projectId) pure returns (bytes32)",
    "function projects(bytes32) view returns (string projectId, address owner, bytes32 aoiHash, uint256 bond, uint256 activeCount, bool exists)",
    "function aoiOwnerProject(bytes32) view returns (bytes32)",
    "function verifications(uint256) view returns (bytes32 projectKey, uint256 tonnesCO2e, uint64 challengeExpiresAt, uint8 status)",
    "function disputes(uint256) view returns (address challenger, uint256 stake, uint256 bondSnapshot, bool open)",
    "function minStakeFor(uint256 verificationId) view returns (uint256)",
    "function challengeWindow() view returns (uint64)",
    "function registerProject(string projectId, bytes32 aoiHash, uint256 bondAmount)",
    "function depositBond(bytes32 projectKey, uint256 amount)",
    "function recordVerification(string projectId, uint256 verificationId, uint256 tonnesCO2e)",
    "function challenge(uint256 verificationId, uint256 stake)",
    "function resolveDispute(uint256 verificationId, bool challengerWon)",
    "function finalize(uint256 verificationId)",
  ],
  credits: [
    "function balanceOf(address account, uint256 id) view returns (uint256)",
    "function totalSupply(uint256 id) view returns (uint256)",
    "function retiredSupply(uint256 id) view returns (uint256)",
    "function batches(uint256) view returns (string projectId, uint256 verificationId, uint64 mintedAt)",
    "function isApprovedForAll(address account, address operator) view returns (bool)",
    "function setApprovalForAll(address operator, bool approved)",
    "function retire(uint256 tokenId, uint256 tonnes, string beneficiary, string jurisdiction)",
    "event BatchMinted(uint256 indexed tokenId, string projectId, address indexed to, uint256 tonnes)",
    "event Retired(uint256 indexed tokenId, address indexed holder, uint256 tonnes, string beneficiary, string jurisdiction)",
  ],
  market: [
    "function nextListingId() view returns (uint256)",
    "function listings(uint256) view returns (address seller, uint256 tokenId, uint256 remaining, uint256 pricePerTonne, bool active)",
    "function list(uint256 tokenId, uint256 amount, uint256 pricePerTonne) returns (uint256)",
    "function buy(uint256 listingId, uint256 amount)",
    "function cancel(uint256 listingId)",
  ],
};

// Mirrors GeoOffsetEscrow.Status
export const ESCROW_STATUS = ["Not on-chain", "Open for challenge", "Under dispute", "Finalized, minted", "Finalized, rejected"];

const ChainContext = createContext(null);

export function ChainProvider({ children }) {
  const [deployment, setDeployment] = useState(null);
  const [deploymentError, setDeploymentError] = useState(null);
  const [account, setAccount] = useState(null);
  const [walletChainId, setWalletChainId] = useState(null);
  const [signer, setSigner] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const readProvider = useMemo(() => new JsonRpcProvider(RPC_URL, undefined, { staticNetwork: true }), []);

  useEffect(() => {
    fetch(`/deployments/${NETWORK}.json`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setDeployment)
      .catch(() =>
        setDeploymentError(
          `No contract addresses for "${NETWORK}". Deploy Layer 3 (npx hardhat run scripts/deploy.js --network ${NETWORK}) and reload.`,
        ),
      );
  }, []);

  const contracts = useMemo(() => {
    if (!deployment) return null;
    const runner = signer || readProvider;
    return {
      token: new Contract(deployment.stakeToken, ABI.token, runner),
      escrow: new Contract(deployment.escrow, ABI.escrow, runner),
      credits: new Contract(deployment.credits, ABI.credits, runner),
      market: deployment.marketplace ? new Contract(deployment.marketplace, ABI.market, runner) : null,
    };
  }, [deployment, signer, readProvider]);

  const syncWallet = useCallback(async () => {
    if (!window.ethereum) return;
    const provider = new BrowserProvider(window.ethereum);
    const accounts = await provider.send("eth_accounts", []);
    const net = await provider.getNetwork();
    setWalletChainId(Number(net.chainId));
    if (accounts.length) {
      setAccount(accounts[0]);
      setSigner(await provider.getSigner(accounts[0]));
    } else {
      setAccount(null);
      setSigner(null);
    }
  }, []);

  useEffect(() => {
    if (!window.ethereum) return;
    syncWallet();
    const onChange = () => syncWallet();
    window.ethereum.on?.("accountsChanged", onChange);
    window.ethereum.on?.("chainChanged", onChange);
    return () => {
      window.ethereum.removeListener?.("accountsChanged", onChange);
      window.ethereum.removeListener?.("chainChanged", onChange);
    };
  }, [syncWallet]);

  const connect = useCallback(async () => {
    if (!window.ethereum) throw new Error("No browser wallet found. Install MetaMask, then reload.");
    await window.ethereum.request({ method: "eth_requestAccounts" });
    if (deployment && Number(await window.ethereum.request({ method: "eth_chainId" })) !== deployment.chainId) {
      const hex = "0x" + deployment.chainId.toString(16);
      try {
        await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
      } catch (e) {
        if (e.code !== 4902) throw e;
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{ chainId: hex, chainName: `GeoOffset ${deployment.network}`, rpcUrls: [RPC_URL], nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 } }],
        });
      }
    }
    await syncWallet();
  }, [deployment, syncWallet]);

  const wrongChain = Boolean(account && deployment && walletChainId !== deployment.chainId);
  const isLocalChain = deployment?.chainId === 31337;

  /** Local Hardhat node only: jump the chain clock forward (e.g. past the 72h window). */
  const advanceTime = useCallback(
    async (seconds) => {
      await readProvider.send("evm_increaseTime", [seconds]);
      await readProvider.send("evm_mine", []);
      setRefreshKey((k) => k + 1);
    },
    [readProvider],
  );

  const chainNow = useCallback(async () => {
    const block = await readProvider.getBlock("latest");
    return Number(block.timestamp);
  }, [readProvider]);

  const value = {
    network: NETWORK,
    deployment,
    deploymentError,
    contracts,
    readProvider,
    account,
    signer,
    wrongChain,
    isLocalChain,
    hasWallet: typeof window !== "undefined" && Boolean(window.ethereum),
    connect,
    advanceTime,
    chainNow,
    refreshKey,
    refresh: () => setRefreshKey((k) => k + 1),
  };
  return <ChainContext.Provider value={value}>{children}</ChainContext.Provider>;
}

export const useChain = () => useContext(ChainContext);

/** Turn an ethers/contract error into one readable sentence. */
export function txErrorMessage(e) {
  if (e?.code === "ACTION_REJECTED" || e?.code === 4001) return "You rejected the transaction in your wallet.";
  const reason = e?.reason || e?.revert?.args?.[0] || e?.info?.error?.message || e?.shortMessage || e?.message;
  return String(reason || "Transaction failed").replace(/^execution reverted:?\s*/i, "");
}
