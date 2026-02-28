// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "../interfaces/IBitcoinLightClient.sol";

/// @title MockBitcoinLightClient — Configurable mock for Hardhat tests
/// @notice Returns true for all verifyInclusion calls. Used in tests since
///         the real Light Client at 0x3100...0001 is only available on Citrea.
contract MockBitcoinLightClient is IBitcoinLightClient {
    uint256 private _blockNumber = 999999;

    function blockNumber() external view returns (uint256) {
        return _blockNumber;
    }

    function setBlockNumber(uint256 n) external {
        _blockNumber = n;
    }

    function getBlockHash(uint256) external pure returns (bytes32) {
        return bytes32(uint256(0xdeadbeef));
    }

    function verifyInclusion(
        uint256,
        bytes32,
        bytes calldata,
        uint256
    ) external pure returns (bool) {
        return true;
    }
}
