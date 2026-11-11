// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {GeoOffsetCredits} from "./GeoOffsetCredits.sol";

/**
 * @title GeoOffsetEscrow
 * @notice Layer 3 on-chain counterpart of Layer 2's dispute engine.
 *
 *  Lifecycle (mirrors layer2 FinalizationStatus):
 *
 *    registerProject()  -> owner posts a bond (ERC-20) for a project + AOI hash
 *    recordVerification() [ORACLE]
 *                       -> Layer 2 said PROVISIONALLY_VERIFIED; on-chain
 *                          72h challenge window starts  => OPEN_FOR_CHALLENGE
 *    challenge()        -> anyone stakes >= bond * stakeRatio  => UNDER_DISPUTE
 *    resolveDispute() [ORACLE]
 *                       -> relays Layer 2's independent-recheck verdict:
 *                          project won    => challenger stake -> owner, credits minted
 *                          challenger won => min(stake, bond) of bond -> challenger,
 *                                            challenger stake refunded, no credits
 *    finalize()         -> anyone, once the window passes unchallenged
 *                          => FINALIZED_MINTABLE, credits minted to owner
 *
 *  Trust split: the oracle (Layer 2 relay) only reports WHAT the satellite
 *  verdict was. The contract itself enforces the window timing, stake
 *  minimums, payout amounts and custody — the oracle can't move funds
 *  arbitrarily or skip the challenge window.
 */
contract GeoOffsetEscrow is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");

    enum Status {
        None,
        OpenForChallenge,
        UnderDispute,
        FinalizedMintable,
        FinalizedRejected
    }

    struct Project {
        string projectId;      // Layer 2 project_id
        address owner;
        bytes32 aoiHash;       // keccak256 of the canonical AOI GeoJSON
        uint256 bond;          // currently escrowed bond
        uint256 activeCount;   // verifications open / under dispute (bond locked while > 0)
        bool exists;
    }

    struct Verification {
        bytes32 projectKey;
        uint256 tonnesCO2e;          // whole tonnes to mint if finalized
        uint64 challengeExpiresAt;
        Status status;
    }

    struct Dispute {
        address challenger;
        uint256 stake;
        uint256 bondSnapshot;
        bool open;
    }

    IERC20 public immutable stakeToken;
    GeoOffsetCredits public immutable credits;

    uint64 public challengeWindow = 72 hours;   // matches Layer 2 CHALLENGE_WINDOW_HOURS
    uint16 public minStakeRatioBps = 10_000;    // 100% of bond; matches MIN_CHALLENGE_STAKE_RATIO

    mapping(bytes32 => Project) public projects;          // keccak256(projectId) => Project
    mapping(bytes32 => bytes32) public aoiOwnerProject;   // aoiHash => projectKey (double-registration guard)
    mapping(uint256 => Verification) public verifications; // Layer 2 verification id => record
    mapping(uint256 => Dispute) public disputes;           // Layer 2 verification id => dispute

    event ProjectRegistered(bytes32 indexed projectKey, string projectId, address indexed owner, bytes32 aoiHash, uint256 bond);
    event BondDeposited(bytes32 indexed projectKey, uint256 amount, uint256 newBond);
    event BondWithdrawn(bytes32 indexed projectKey, uint256 amount, uint256 newBond);
    event VerificationRecorded(uint256 indexed verificationId, bytes32 indexed projectKey, uint256 tonnesCO2e, uint64 challengeExpiresAt);
    event Challenged(uint256 indexed verificationId, address indexed challenger, uint256 stake, uint256 bondSnapshot);
    event DisputeResolved(uint256 indexed verificationId, bool challengerWon, address paidBy, address paidTo, uint256 amountTransferred);
    event Finalized(uint256 indexed verificationId, Status status, uint256 creditsMinted);
    event ParamsUpdated(uint64 challengeWindow, uint16 minStakeRatioBps);

    constructor(IERC20 _stakeToken, GeoOffsetCredits _credits, address admin, address oracle) {
        stakeToken = _stakeToken;
        credits = _credits;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ORACLE_ROLE, oracle);
    }

    // ------------------------------------------------------------------
    // Project & bond
    // ------------------------------------------------------------------

    function projectKeyOf(string memory projectId) public pure returns (bytes32) {
        return keccak256(bytes(projectId));
    }

    /**
     * @notice Register a project and post its bond. The AOI hash must be
     *         unique: the same polygon can't be registered twice (e.g. once
     *         per country) — the on-chain half of the cross-border
     *         double-counting guard. Partial overlaps are caught by Layer 2's
     *         PostGIS spatial query before the oracle records anything.
     */
    function registerProject(string calldata projectId, bytes32 aoiHash, uint256 bondAmount) external nonReentrant {
        bytes32 key = projectKeyOf(projectId);
        require(bytes(projectId).length > 0, "Escrow: empty projectId");
        require(!projects[key].exists, "Escrow: project exists");
        require(aoiHash != bytes32(0), "Escrow: empty AOI hash");
        require(aoiOwnerProject[aoiHash] == bytes32(0), "Escrow: AOI already registered");
        require(bondAmount > 0, "Escrow: bond required");

        projects[key] = Project(projectId, msg.sender, aoiHash, bondAmount, 0, true);
        aoiOwnerProject[aoiHash] = key;
        stakeToken.safeTransferFrom(msg.sender, address(this), bondAmount);

        emit ProjectRegistered(key, projectId, msg.sender, aoiHash, bondAmount);
    }

    function depositBond(bytes32 projectKey, uint256 amount) external nonReentrant {
        Project storage p = projects[projectKey];
        require(p.exists, "Escrow: unknown project");
        require(msg.sender == p.owner, "Escrow: not owner");
        require(amount > 0, "Escrow: zero amount");
        p.bond += amount;
        stakeToken.safeTransferFrom(msg.sender, address(this), amount);
        emit BondDeposited(projectKey, amount, p.bond);
    }

    /// @notice Bond is locked while any verification is open or disputed.
    function withdrawBond(bytes32 projectKey, uint256 amount) external nonReentrant {
        Project storage p = projects[projectKey];
        require(p.exists, "Escrow: unknown project");
        require(msg.sender == p.owner, "Escrow: not owner");
        require(p.activeCount == 0, "Escrow: bond locked");
        require(amount > 0 && amount <= p.bond, "Escrow: bad amount");
        p.bond -= amount;
        stakeToken.safeTransfer(p.owner, amount);
        emit BondWithdrawn(projectKey, amount, p.bond);
    }

    // ------------------------------------------------------------------
    // Verification (oracle = Layer 2 relay)
    // ------------------------------------------------------------------

    /**
     * @notice Called by the Layer 2 relay for a record whose
     *         verification_outcome is PROVISIONALLY_VERIFIED.
     */
    function recordVerification(string calldata projectId, uint256 verificationId, uint256 tonnesCO2e)
        external
        onlyRole(ORACLE_ROLE)
    {
        bytes32 key = projectKeyOf(projectId);
        Project storage p = projects[key];
        require(p.exists, "Escrow: unknown project");
        require(p.bond > 0, "Escrow: no bond posted");
        require(verifications[verificationId].status == Status.None, "Escrow: already recorded");
        require(tonnesCO2e > 0, "Escrow: zero tonnes");

        uint64 expires = uint64(block.timestamp) + challengeWindow;
        verifications[verificationId] = Verification(key, tonnesCO2e, expires, Status.OpenForChallenge);
        p.activeCount += 1;

        emit VerificationRecorded(verificationId, key, tonnesCO2e, expires);
    }

    // ------------------------------------------------------------------
    // Challenge window
    // ------------------------------------------------------------------

    function minStakeFor(uint256 verificationId) public view returns (uint256) {
        Project storage p = projects[verifications[verificationId].projectKey];
        return (p.bond * minStakeRatioBps) / 10_000;
    }

    function challenge(uint256 verificationId, uint256 stake) external nonReentrant {
        Verification storage v = verifications[verificationId];
        require(v.status == Status.OpenForChallenge, "Escrow: not open for challenge");
        require(block.timestamp < v.challengeExpiresAt, "Escrow: challenge window closed");

        Project storage p = projects[v.projectKey];
        require(msg.sender != p.owner, "Escrow: owner cannot challenge");
        require(stake >= minStakeFor(verificationId), "Escrow: stake below minimum");

        disputes[verificationId] = Dispute(msg.sender, stake, p.bond, true);
        v.status = Status.UnderDispute;
        stakeToken.safeTransferFrom(msg.sender, address(this), stake);

        emit Challenged(verificationId, msg.sender, stake, p.bond);
    }

    /**
     * @notice Relay Layer 2's independent-recheck verdict
     *         (POST /disputes/{id}/resolve -> escrow_verdict.winner).
     *         Payout amounts are computed HERE, not taken from the oracle,
     *         using the same rule as layer2 adjudicate():
     *           project won    -> full challenger stake to project owner
     *           challenger won -> min(stake, bondSnapshot) from bond to challenger
     */
    function resolveDispute(uint256 verificationId, bool challengerWon)
        external
        onlyRole(ORACLE_ROLE)
        nonReentrant
    {
        Verification storage v = verifications[verificationId];
        Dispute storage d = disputes[verificationId];
        require(v.status == Status.UnderDispute && d.open, "Escrow: no open dispute");

        Project storage p = projects[v.projectKey];
        d.open = false;
        p.activeCount -= 1;

        if (!challengerWon) {
            v.status = Status.FinalizedMintable;
            stakeToken.safeTransfer(p.owner, d.stake);
            emit DisputeResolved(verificationId, false, d.challenger, p.owner, d.stake);
            _mintCredits(verificationId, v, p);
        } else {
            v.status = Status.FinalizedRejected;
            uint256 forfeited = d.stake < d.bondSnapshot ? d.stake : d.bondSnapshot;
            if (forfeited > p.bond) forfeited = p.bond; // defensive; bond can't drop mid-dispute
            p.bond -= forfeited;
            stakeToken.safeTransfer(d.challenger, d.stake + forfeited); // refund + reward
            emit DisputeResolved(verificationId, true, p.owner, d.challenger, forfeited);
            emit Finalized(verificationId, Status.FinalizedRejected, 0);
        }
    }

    /// @notice Permissionless: once the window passes unchallenged, mint.
    function finalize(uint256 verificationId) external nonReentrant {
        Verification storage v = verifications[verificationId];
        require(v.status == Status.OpenForChallenge, "Escrow: not finalizable");
        require(block.timestamp >= v.challengeExpiresAt, "Escrow: challenge window still open");

        Project storage p = projects[v.projectKey];
        v.status = Status.FinalizedMintable;
        p.activeCount -= 1;
        _mintCredits(verificationId, v, p);
    }

    function _mintCredits(uint256 verificationId, Verification storage v, Project storage p) internal {
        credits.mintBatch(p.owner, verificationId, v.tonnesCO2e, p.projectId, verificationId);
        emit Finalized(verificationId, Status.FinalizedMintable, v.tonnesCO2e);
    }

    // ------------------------------------------------------------------
    // Admin
    // ------------------------------------------------------------------

    function setParams(uint64 _challengeWindow, uint16 _minStakeRatioBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_challengeWindow >= 1 hours, "Escrow: window too short");
        require(_minStakeRatioBps > 0, "Escrow: ratio zero");
        challengeWindow = _challengeWindow;
        minStakeRatioBps = _minStakeRatioBps;
        emit ParamsUpdated(_challengeWindow, _minStakeRatioBps);
    }
}
