const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const BOND = ethers.parseEther("1000");
const PROJECT = "demo-project-001";
const AOI = ethers.keccak256(ethers.toUtf8Bytes('{"type":"Polygon","coordinates":[[[73.0,18.9],[73.1,18.9],[73.1,19.0],[73.0,18.9]]]}'));
const WINDOW = 72 * 3600;

describe("GeoOffset Layer 3", function () {
  async function deploy() {
    const [admin, oracle, owner, challenger, buyer, stranger] = await ethers.getSigners();
    const token = await ethers.deployContract("MockGeoToken");
    const credits = await ethers.deployContract("GeoOffsetCredits", ["ipfs://x/{id}.json", admin.address]);
    const escrow = await ethers.deployContract("GeoOffsetEscrow", [
      await token.getAddress(), await credits.getAddress(), admin.address, oracle.address,
    ]);
    await credits.grantRole(await credits.MINTER_ROLE(), await escrow.getAddress());

    for (const s of [owner, challenger]) {
      await token.mint(s.address, ethers.parseEther("10000"));
      await token.connect(s).approve(await escrow.getAddress(), ethers.MaxUint256);
    }
    await escrow.connect(owner).registerProject(PROJECT, AOI, BOND);
    const key = await escrow.projectKeyOf(PROJECT);
    return { admin, oracle, owner, challenger, buyer, stranger, token, credits, escrow, key };
  }

  async function recorded() {
    const f = await deploy();
    await f.escrow.connect(f.oracle).recordVerification(PROJECT, 1, 1200);
    return f;
  }

  describe("registration", function () {
    it("escrows the bond", async function () {
      const { escrow, token, key } = await loadFixture(deploy);
      expect((await escrow.projects(key)).bond).to.equal(BOND);
      expect(await token.balanceOf(await escrow.getAddress())).to.equal(BOND);
    });

    it("rejects the same AOI registered twice (cross-border double-count guard)", async function () {
      const { escrow, challenger } = await loadFixture(deploy);
      await expect(escrow.connect(challenger).registerProject("other-country-copy", AOI, BOND))
        .to.be.revertedWith("Escrow: AOI already registered");
    });

    it("rejects duplicate project ids", async function () {
      const { escrow, owner } = await loadFixture(deploy);
      await expect(escrow.connect(owner).registerProject(PROJECT, ethers.id("aoi2"), BOND))
        .to.be.revertedWith("Escrow: project exists");
    });
  });

  describe("oracle", function () {
    it("only ORACLE_ROLE can record verifications", async function () {
      const { escrow, stranger } = await loadFixture(deploy);
      await expect(escrow.connect(stranger).recordVerification(PROJECT, 1, 100))
        .to.be.revertedWithCustomError(escrow, "AccessControlUnauthorizedAccount");
    });

    it("cannot record the same verification twice", async function () {
      const { escrow, oracle } = await loadFixture(recorded);
      await expect(escrow.connect(oracle).recordVerification(PROJECT, 1, 100))
        .to.be.revertedWith("Escrow: already recorded");
    });

    it("opens a 72h challenge window and locks the bond", async function () {
      const { escrow, owner, key } = await loadFixture(recorded);
      const v = await escrow.verifications(1);
      expect(v.status).to.equal(1); // OpenForChallenge
      expect(v.challengeExpiresAt - BigInt(await time.latest())).to.equal(BigInt(WINDOW));
      await expect(escrow.connect(owner).withdrawBond(key, 1)).to.be.revertedWith("Escrow: bond locked");
    });
  });

  describe("unchallenged path", function () {
    it("cannot finalize before the window closes", async function () {
      const { escrow } = await loadFixture(recorded);
      await expect(escrow.finalize(1)).to.be.revertedWith("Escrow: challenge window still open");
    });

    it("anyone can finalize after 72h; owner receives ERC-1155 credits", async function () {
      const { escrow, credits, owner, stranger, key } = await loadFixture(recorded);
      await time.increase(WINDOW);
      await expect(escrow.connect(stranger).finalize(1)).to.emit(escrow, "Finalized").withArgs(1, 3, 1200);
      expect(await credits.balanceOf(owner.address, 1)).to.equal(1200);
      expect((await credits.batches(1)).projectId).to.equal(PROJECT);
      // bond unlocked again
      await escrow.connect(owner).withdrawBond(key, BOND);
      expect((await escrow.projects(key)).bond).to.equal(0);
    });

    it("cannot challenge after the window closes", async function () {
      const { escrow, challenger } = await loadFixture(recorded);
      await time.increase(WINDOW);
      await expect(escrow.connect(challenger).challenge(1, BOND))
        .to.be.revertedWith("Escrow: challenge window closed");
    });
  });

  describe("disputes", function () {
    it("requires stake >= bond", async function () {
      const { escrow, challenger } = await loadFixture(recorded);
      await expect(escrow.connect(challenger).challenge(1, BOND - 1n))
        .to.be.revertedWith("Escrow: stake below minimum");
    });

    it("owner cannot challenge their own project", async function () {
      const { escrow, owner } = await loadFixture(recorded);
      await expect(escrow.connect(owner).challenge(1, BOND)).to.be.revertedWith("Escrow: owner cannot challenge");
    });

    it("project wins: challenger stake goes to owner, credits minted", async function () {
      const { escrow, credits, token, oracle, owner, challenger } = await loadFixture(recorded);
      await escrow.connect(challenger).challenge(1, BOND);
      expect((await escrow.verifications(1)).status).to.equal(2); // UnderDispute
      await expect(escrow.finalize(1)).to.be.revertedWith("Escrow: not finalizable");

      const ownerBefore = await token.balanceOf(owner.address);
      const chBefore = await token.balanceOf(challenger.address);
      await escrow.connect(oracle).resolveDispute(1, false);

      expect(await token.balanceOf(owner.address)).to.equal(ownerBefore + BOND);
      expect(await token.balanceOf(challenger.address)).to.equal(chBefore);
      expect((await escrow.verifications(1)).status).to.equal(3); // FinalizedMintable
      expect(await credits.balanceOf(owner.address, 1)).to.equal(1200);
    });

    it("challenger wins: refund + min(stake, bond) from bond, no credits", async function () {
      const { escrow, credits, token, oracle, owner, challenger, key } = await loadFixture(recorded);
      const stake = ethers.parseEther("1500"); // over-stakes; payout capped at bond
      const chBefore = await token.balanceOf(challenger.address);
      await escrow.connect(challenger).challenge(1, stake);
      await expect(escrow.connect(oracle).resolveDispute(1, true))
        .to.emit(escrow, "DisputeResolved").withArgs(1, true, owner.address, challenger.address, BOND);

      expect(await token.balanceOf(challenger.address)).to.equal(chBefore + BOND);
      expect((await escrow.projects(key)).bond).to.equal(0);
      expect((await escrow.verifications(1)).status).to.equal(4); // FinalizedRejected
      expect(await credits.balanceOf(owner.address, 1)).to.equal(0);
    });

    it("only the oracle can resolve, and only once", async function () {
      const { escrow, oracle, challenger, stranger } = await loadFixture(recorded);
      await escrow.connect(challenger).challenge(1, BOND);
      await expect(escrow.connect(stranger).resolveDispute(1, true))
        .to.be.revertedWithCustomError(escrow, "AccessControlUnauthorizedAccount");
      await escrow.connect(oracle).resolveDispute(1, true);
      await expect(escrow.connect(oracle).resolveDispute(1, false)).to.be.revertedWith("Escrow: no open dispute");
    });
  });

  describe("credits", function () {
    it("only the escrow can mint", async function () {
      const { credits, stranger } = await loadFixture(deploy);
      await expect(credits.connect(stranger).mintBatch(stranger.address, 9, 1, "x", 9))
        .to.be.revertedWithCustomError(credits, "AccessControlUnauthorizedAccount");
    });

    it("credits are tradable and retirement burns them permanently", async function () {
      const { escrow, credits, owner, buyer } = await loadFixture(recorded);
      await time.increase(WINDOW);
      await escrow.finalize(1);

      await credits.connect(owner).safeTransferFrom(owner.address, buyer.address, 1, 500, "0x");
      await expect(credits.connect(buyer).retire(1, 300, "Acme Ltd", "IN"))
        .to.emit(credits, "Retired").withArgs(1, buyer.address, 300, "Acme Ltd", "IN");

      expect(await credits.balanceOf(buyer.address, 1)).to.equal(200);
      expect(await credits.retiredSupply(1)).to.equal(300);
      expect(await credits["totalSupply(uint256)"](1)).to.equal(900);
      await expect(credits.connect(buyer).retire(1, 201, "Acme Ltd", "IN"))
        .to.be.revertedWithCustomError(credits, "ERC1155InsufficientBalance");
    });
  });
  describe("marketplace", function () {
    const PRICE = ethers.parseEther("2"); // 2 GEO per tonne

    async function minted() {
      const f = await recorded();
      await time.increase(WINDOW);
      await f.escrow.finalize(1); // owner now holds 1200 credits of token id 1
      const market = await ethers.deployContract("GeoOffsetMarketplace", [
        await f.credits.getAddress(), await f.token.getAddress(),
      ]);
      await f.token.mint(f.buyer.address, ethers.parseEther("10000"));
      await f.token.connect(f.buyer).approve(await market.getAddress(), ethers.MaxUint256);
      return { ...f, market };
    }

    it("requires operator approval and enough credits to list", async function () {
      const { market, credits, owner } = await loadFixture(minted);
      await expect(market.connect(owner).list(1, 100, PRICE)).to.be.revertedWith("Market: approve marketplace first");
      await credits.connect(owner).setApprovalForAll(await market.getAddress(), true);
      await expect(market.connect(owner).list(1, 5000, PRICE)).to.be.revertedWith("Market: insufficient credits");
    });

    it("partial buy pays the seller and moves credits atomically, without custody", async function () {
      const { market, credits, token, owner, buyer } = await loadFixture(minted);
      const marketAddr = await market.getAddress();
      await credits.connect(owner).setApprovalForAll(marketAddr, true);
      await market.connect(owner).list(1, 500, PRICE);

      const ownerBefore = await token.balanceOf(owner.address);
      await expect(market.connect(buyer).buy(1, 200))
        .to.emit(market, "Purchased").withArgs(1, buyer.address, 1, 200, PRICE * 200n);

      expect(await credits.balanceOf(buyer.address, 1)).to.equal(200);
      expect(await credits.balanceOf(owner.address, 1)).to.equal(1000);
      expect((await token.balanceOf(owner.address)) - ownerBefore).to.equal(PRICE * 200n);
      expect(await credits.balanceOf(marketAddr, 1)).to.equal(0);
      expect(await token.balanceOf(marketAddr)).to.equal(0);
      expect((await market.listings(1)).remaining).to.equal(300);

      await market.connect(buyer).buy(1, 300);
      expect((await market.listings(1)).active).to.equal(false);
      await expect(market.connect(buyer).buy(1, 1)).to.be.revertedWith("Market: listing not active");
    });

    it("only the seller can cancel; a listing can't sell credits already retired", async function () {
      const { market, credits, owner, buyer } = await loadFixture(minted);
      await credits.connect(owner).setApprovalForAll(await market.getAddress(), true);
      await market.connect(owner).list(1, 1200, PRICE);
      await expect(market.connect(buyer).cancel(1)).to.be.revertedWith("Market: not seller");

      await credits.connect(owner).retire(1, 1000, "Owner Corp", "BR");
      await expect(market.connect(buyer).buy(1, 500))
        .to.be.revertedWithCustomError(credits, "ERC1155InsufficientBalance");

      await market.connect(owner).cancel(1);
      expect((await market.listings(1)).active).to.equal(false);
    });
  });
});
