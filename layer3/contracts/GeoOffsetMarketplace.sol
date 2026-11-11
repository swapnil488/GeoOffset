// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title GeoOffsetMarketplace
 * @notice Fixed-price, non-custodial marketplace for GeoOffset credits
 *         (backs the Layer 4 frontend's marketplace page).
 *
 *  - A holder lists `amount` tonnes of a credit batch at a price per tonne
 *    in the stake token (GEO). Credits stay in the seller's wallet; the
 *    seller only grants this contract ERC-1155 operator approval.
 *  - A buyer can take part or all of a listing. Payment goes straight from
 *    buyer to seller and the credits go straight from seller to buyer in
 *    the same transaction, so the marketplace never holds funds or credits.
 *  - If the seller has since moved or retired the credits, the purchase
 *    simply reverts — a listing can never sell tonnes that no longer exist.
 */
contract GeoOffsetMarketplace is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Listing {
        address seller;
        uint256 tokenId;
        uint256 remaining;        // tonnes still for sale
        uint256 pricePerTonne;    // in payment token base units (18 decimals for GEO)
        bool active;
    }

    IERC1155 public immutable credits;
    IERC20 public immutable paymentToken;

    uint256 public nextListingId = 1;
    mapping(uint256 => Listing) public listings;

    event Listed(uint256 indexed listingId, address indexed seller, uint256 indexed tokenId, uint256 amount, uint256 pricePerTonne);
    event Purchased(uint256 indexed listingId, address indexed buyer, uint256 indexed tokenId, uint256 amount, uint256 totalPrice);
    event Cancelled(uint256 indexed listingId);

    constructor(IERC1155 _credits, IERC20 _paymentToken) {
        credits = _credits;
        paymentToken = _paymentToken;
    }

    function list(uint256 tokenId, uint256 amount, uint256 pricePerTonne) external returns (uint256 listingId) {
        require(amount > 0, "Market: zero amount");
        require(pricePerTonne > 0, "Market: zero price");
        require(credits.balanceOf(msg.sender, tokenId) >= amount, "Market: insufficient credits");
        require(credits.isApprovedForAll(msg.sender, address(this)), "Market: approve marketplace first");

        listingId = nextListingId++;
        listings[listingId] = Listing(msg.sender, tokenId, amount, pricePerTonne, true);
        emit Listed(listingId, msg.sender, tokenId, amount, pricePerTonne);
    }

    function buy(uint256 listingId, uint256 amount) external nonReentrant {
        Listing storage l = listings[listingId];
        require(l.active, "Market: listing not active");
        require(amount > 0 && amount <= l.remaining, "Market: bad amount");
        require(msg.sender != l.seller, "Market: seller cannot buy");

        uint256 total = amount * l.pricePerTonne;
        l.remaining -= amount;
        if (l.remaining == 0) l.active = false;

        paymentToken.safeTransferFrom(msg.sender, l.seller, total);
        credits.safeTransferFrom(l.seller, msg.sender, l.tokenId, amount, "");
        emit Purchased(listingId, msg.sender, l.tokenId, amount, total);
    }

    function cancel(uint256 listingId) external {
        Listing storage l = listings[listingId];
        require(l.active, "Market: listing not active");
        require(msg.sender == l.seller, "Market: not seller");
        l.active = false;
        emit Cancelled(listingId);
    }
}
