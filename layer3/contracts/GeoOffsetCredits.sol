// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {ERC1155Supply} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title GeoOffsetCredits
 * @notice ERC-1155 carbon credits. One token id per FINALIZED_MINTABLE
 *         verification record from Layer 2 (i.e. one id = one verified
 *         batch / vintage for one project). 1 token = 1 tonne CO2e.
 *
 *         Only the escrow contract (MINTER_ROLE) can mint, and it only
 *         does so after the 72-hour challenge window has passed with no
 *         successful dispute. Retiring a credit burns it permanently and
 *         emits a Retired event — that burn is what stops the same tonne
 *         being claimed twice (including across borders).
 */
contract GeoOffsetCredits is ERC1155, ERC1155Supply, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    struct BatchInfo {
        string projectId;        // Layer 2 project_id, e.g. "demo-project-001"
        uint256 verificationId;  // Layer 2 verification_records.id
        uint64 mintedAt;
    }

    /// tokenId => batch provenance
    mapping(uint256 => BatchInfo) public batches;

    /// tokenId => total tonnes retired (burned) so far
    mapping(uint256 => uint256) public retiredSupply;

    event BatchMinted(uint256 indexed tokenId, string projectId, address indexed to, uint256 tonnes);
    event Retired(
        uint256 indexed tokenId,
        address indexed holder,
        uint256 tonnes,
        string beneficiary,
        string jurisdiction
    );

    constructor(string memory baseUri, address admin) ERC1155(baseUri) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function mintBatch(
        address to,
        uint256 tokenId,
        uint256 tonnes,
        string calldata projectId,
        uint256 verificationId
    ) external onlyRole(MINTER_ROLE) {
        require(tonnes > 0, "Credits: zero amount");
        require(batches[tokenId].mintedAt == 0, "Credits: batch already minted");

        batches[tokenId] = BatchInfo(projectId, verificationId, uint64(block.timestamp));
        _mint(to, tokenId, tonnes, "");
        emit BatchMinted(tokenId, projectId, to, tonnes);
    }

    /**
     * @notice Permanently retire (burn) credits to claim the offset.
     * @param beneficiary  who the offset is claimed for (company / person)
     * @param jurisdiction country/registry the claim is reported in — recorded
     *                     on-chain so a second claim elsewhere is impossible
     *                     (the tokens no longer exist).
     */
    function retire(
        uint256 tokenId,
        uint256 tonnes,
        string calldata beneficiary,
        string calldata jurisdiction
    ) external {
        require(tonnes > 0, "Credits: zero amount");
        _burn(msg.sender, tokenId, tonnes);
        retiredSupply[tokenId] += tonnes;
        emit Retired(tokenId, msg.sender, tonnes, beneficiary, jurisdiction);
    }

    function setURI(string calldata newUri) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setURI(newUri);
    }

    // ---- required overrides ----
    function _update(address from, address to, uint256[] memory ids, uint256[] memory values)
        internal
        override(ERC1155, ERC1155Supply)
    {
        super._update(from, to, ids, values);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC1155, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
