import { useAsync } from "./hooks.js";
import { useChain } from "./chain.jsx";

/**
 * Every minted credit batch (one per finalized verification), read from
 * BatchMinted events plus live supply/retired counts. Also the retirement
 * ledger and marketplace listings. Event scans start at the deploy block.
 */
export function useCreditData() {
  const { contracts, deployment, account, refreshKey } = useChain();
  return useAsync(async () => {
    if (!contracts) return null;
    const { credits, market } = contracts;
    const from = deployment.deployBlock || 0;

    const minted = await credits.queryFilter(credits.filters.BatchMinted(), from);
    const batches = await Promise.all(
      minted.map(async (ev) => {
        const tokenId = ev.args.tokenId;
        const [info, supply, retired, mine] = await Promise.all([
          credits.batches(tokenId),
          credits.totalSupply(tokenId),
          credits.retiredSupply(tokenId),
          account ? credits.balanceOf(account, tokenId) : 0n,
        ]);
        const block = await ev.getBlock();
        return {
          tokenId,
          projectId: info.projectId,
          mintedTo: ev.args.to,
          mintedTonnes: ev.args.tonnes,
          mintedAt: Number(info.mintedAt) * 1000,
          supply,
          retired,
          mine,
          txHash: ev.transactionHash,
          blockTime: block.timestamp * 1000,
        };
      }),
    );

    const retiredEvents = await credits.queryFilter(credits.filters.Retired(), from);
    const retirements = await Promise.all(
      retiredEvents.map(async (ev) => ({
        tokenId: ev.args.tokenId,
        holder: ev.args.holder,
        tonnes: ev.args.tonnes,
        beneficiary: ev.args.beneficiary,
        jurisdiction: ev.args.jurisdiction,
        time: (await ev.getBlock()).timestamp * 1000,
        txHash: ev.transactionHash,
      })),
    );

    let listings = [];
    if (market) {
      const next = Number(await market.nextListingId());
      const ids = Array.from({ length: Math.max(0, next - 1) }, (_, i) => i + 1);
      listings = (await Promise.all(ids.map(async (id) => ({ id, ...(await market.listings(id)).toObject() })))).map((l) => ({
        ...l,
        projectId: batches.find((b) => b.tokenId === l.tokenId)?.projectId,
      }));
    }
    return { batches, retirements: retirements.reverse(), listings };
  }, [contracts, account, refreshKey]);
}
