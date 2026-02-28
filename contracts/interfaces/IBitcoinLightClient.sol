// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @title IBitcoinLightClient — Interface for Citrea's Bitcoin Light Client precompile
/// @notice Deployed at 0x3100000000000000000000000000000000000001 on Citrea
interface IBitcoinLightClient {
    /// @notice Returns the latest Bitcoin block height known to the Light Client
    function blockNumber() external view returns (uint256);

    /// @notice Returns the block hash for a given Bitcoin block height
    function getBlockHash(uint256 height) external view returns (bytes32);

    /// @notice Verifies that a witness transaction is included in a Bitcoin block
    /// @param height The Bitcoin block height
    /// @param wtxId The witness transaction ID (double-SHA256 of the serialized witness tx)
    /// @param proof Concatenated Merkle sibling hashes (32 bytes each)
    /// @param index The transaction's index in the witness Merkle tree
    function verifyInclusion(
        uint256 height,
        bytes32 wtxId,
        bytes calldata proof,
        uint256 index
    ) external view returns (bool);
}
