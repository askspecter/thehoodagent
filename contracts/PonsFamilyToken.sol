// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

/**
 * @title  Pons Family Token ($PONS)
 * @notice Fixed-supply ERC-20 for the Pons Family launch (ponsfamily.com).
 *
 * Design goals — trust by simplicity. This contract deliberately has:
 *   - A FIXED total supply of 1,000,000,000 PONS, minted ONCE at deployment
 *     to the `treasury` address. There is NO mint function afterwards, so the
 *     supply can never be inflated — it can only ever go DOWN via burn().
 *   - NO owner / admin. There are zero privileged functions. Nobody can pause
 *     trading, blacklist a wallet, change fees, or touch anyone's balance.
 *   - NO transfer tax, NO honeypot logic, NO hidden hooks. Anyone who can hold
 *     $PONS can always transfer and sell it. This is what makes it safe to buy.
 *
 * Because there are no admin powers, holders can verify on a block explorer
 * that the deployer cannot rug the contract itself. (Liquidity safety is a
 * separate step — see the deployment guide about locking/burning LP tokens.)
 */
contract PonsFamilyToken is ERC20, ERC20Burnable {
    /// @notice Total (and maximum) supply: 1,000,000,000 * 10**18.
    uint256 public constant INITIAL_SUPPLY = 1_000_000_000 ether;

    /**
     * @param treasury Address that receives the entire initial supply.
     *                 Typically your deployer wallet; you then move tokens
     *                 into a DEX liquidity pool to make $PONS tradeable.
     */
    constructor(address treasury) ERC20("Pons Family", "PONS") {
        require(treasury != address(0), "PONS: treasury is zero address");
        _mint(treasury, INITIAL_SUPPLY);
    }
}
