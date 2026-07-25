// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MaliciousToken — a TEST FIXTURE, never for deployment
 * @notice This contract deliberately contains the abuse patterns that the
 *         auditor is built to detect. It exists so the test suite can prove the
 *         detector actually fires, instead of us assuming it does.
 *
 *         It is the scanner's target practice. Do not deploy it anywhere real.
 *
 * Patterns included:
 *   - `mint`             → supply can be inflated, diluting holders
 *   - `blacklist`        → a holder can be stopped from selling (honeypot)
 *   - `pause`            → all transfers can be frozen
 *   - `setFee`           → the tax can be changed after someone buys
 *   - `setMaxTxAmount`   → sell size can be capped to nearly zero
 *   - a live `owner()`   → all of the above is reachable
 */
contract MaliciousToken is ERC20, Ownable {
    mapping(address => bool) public blocked;
    bool public paused;
    uint256 public fee;
    uint256 public maxTxAmount = type(uint256).max;

    constructor(address initialOwner)
        ERC20("Rug Pull Inu", "RUG")
        Ownable(initialOwner)
    {
        _mint(initialOwner, 1_000_000_000 ether);
    }

    // --- Supply inflation ---
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    // --- Sell blocking ---
    function blacklist(address who) external onlyOwner {
        blocked[who] = true;
    }

    function pause() external onlyOwner {
        paused = true;
    }

    function unpause() external onlyOwner {
        paused = false;
    }

    // --- Economics changed after the buy ---
    function setFee(uint256 newFee) external onlyOwner {
        fee = newFee;
    }

    function setMaxTxAmount(uint256 newMax) external onlyOwner {
        maxTxAmount = newMax;
    }

    /// @dev The trap itself: a blacklisted holder simply cannot move tokens.
    function _update(address from, address to, uint256 value) internal override {
        require(!paused, "RUG: paused");
        require(!blocked[from], "RUG: blacklisted");
        require(from == address(0) || value <= maxTxAmount, "RUG: over max tx");
        super._update(from, to, value);
    }
}
