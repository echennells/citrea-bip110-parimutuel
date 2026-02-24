// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract BEPSI is ERC20, Ownable {
    uint256 public constant MAX_SUPPLY = 2100 * 10 ** 18;

    constructor() ERC20("BEPSI", "BEPSI") Ownable(msg.sender) {}

    function mint(address to, uint256 amount) public onlyOwner {
        require(totalSupply() + amount <= MAX_SUPPLY, "Exceeds max supply of 2100");
        _mint(to, amount);
    }
}
