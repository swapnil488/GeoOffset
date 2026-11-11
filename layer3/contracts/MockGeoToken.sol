// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockGeoToken
 * @notice Test ERC-20 ("GEO") used for project bonds and challenger stakes
 *         on local/testnet deployments. Anyone can mint — NEVER deploy this
 *         to mainnet; point the escrow at a real stablecoin/token instead.
 */
contract MockGeoToken is ERC20 {
    constructor() ERC20("GeoOffset Stake Token", "GEO") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
