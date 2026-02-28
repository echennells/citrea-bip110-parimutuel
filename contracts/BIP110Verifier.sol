// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "./interfaces/IBitcoinLightClient.sol";
import "./OpReturnParser.sol";

/// @title BIP110Verifier — Phase 2: Trustless OP_RETURN verification via Light Client
/// @notice Verifies that a Bitcoin transaction with a >100 byte OP_RETURN is actually
///         mined in a block, using Citrea's Bitcoin Light Client for Merkle proof
///         verification. On successful proof, reveals a hashlock preimage.
contract BIP110Verifier {
    /// @notice Citrea Bitcoin Light Client precompile address
    IBitcoinLightClient public immutable LIGHT_CLIENT;

    /// @notice Phase 1 OP_RETURN parser
    OpReturnParser public immutable parser;

    /// @notice The hash that locks the preimage: sha256(preimage) == hashlockHash
    bytes32 public immutable hashlockHash;

    /// @notice The preimage to reveal when a >100 byte OP_RETURN is proven
    bytes public preimage;

    /// @notice Whether the preimage has been revealed
    bool public revealed;

    /// @notice The raw Bitcoin tx that triggered the reveal
    bytes public provenTx;

    /// @notice The wtxId of the proven transaction
    bytes32 public provenWtxId;

    event PreimageRevealed(bytes32 indexed hash, bytes preimage, bytes32 wtxId, uint256 blockHeight);

    error ZeroWtxId();
    error TxIdMismatch(bytes32 expected, bytes32 actual);
    error InclusionProofFailed();
    error NoLargeOpReturn();
    error InvalidPreimage();

    /// @param _lightClient Address of the Bitcoin Light Client (0x3100...0001 on Citrea)
    /// @param _parser Address of the deployed OpReturnParser
    /// @param _hashlockHash The SHA-256 hash that the preimage must satisfy
    /// @param _preimage The secret preimage; verified against _hashlockHash in constructor
    constructor(
        address _lightClient,
        address _parser,
        bytes32 _hashlockHash,
        bytes memory _preimage
    ) {
        // Verify the preimage matches the hash at deploy time
        if (sha256(_preimage) != _hashlockHash) revert InvalidPreimage();

        LIGHT_CLIENT = IBitcoinLightClient(_lightClient);
        parser = OpReturnParser(_parser);
        hashlockHash = _hashlockHash;
        preimage = _preimage;
    }

    /// @notice Verify a Bitcoin tx is mined and contains a >100 byte OP_RETURN.
    ///         If so, reveals the hashlock preimage.
    /// @param blockHeight Bitcoin block height containing the transaction
    /// @param rawTx The full serialized Bitcoin transaction (with witness data)
    /// @param wtxId The witness transaction ID (sha256d of serialized witness tx)
    /// @param proof Concatenated Merkle proof siblings (32 bytes each)
    /// @param index Transaction index in the witness Merkle tree
    /// @return success Whether the verification and reveal succeeded
    function verifyAndReveal(
        uint256 blockHeight,
        bytes calldata rawTx,
        bytes32 wtxId,
        bytes calldata proof,
        uint256 index
    ) external returns (bool success) {
        // 1. Reject zero wtxId (coinbase transactions have wtxid = 0x00...00)
        if (wtxId == bytes32(0)) revert ZeroWtxId();

        // 2. Verify sha256(sha256(rawTx)) == wtxId to prevent mismatched submissions
        bytes32 computedId = sha256(abi.encodePacked(sha256(rawTx)));
        if (computedId != wtxId) revert TxIdMismatch(wtxId, computedId);

        // 3. Verify the transaction is included in the Bitcoin block
        bool included = LIGHT_CLIENT.verifyInclusion(blockHeight, wtxId, proof, index);
        if (!included) revert InclusionProofFailed();

        // 4. Parse OP_RETURN outputs
        (OpReturnParser.OpReturnResult[] memory results,,) = parser.parseOpReturns(rawTx);

        // 5. Check if any OP_RETURN has > 100 bytes of data
        bool hasLarge = false;
        for (uint256 i = 0; i < results.length; i++) {
            if (results[i].size > 100) {
                hasLarge = true;
                break;
            }
        }
        if (!hasLarge) revert NoLargeOpReturn();

        // 6. Reveal preimage if not already revealed
        if (!revealed) {
            revealed = true;
            provenTx = rawTx;
            provenWtxId = wtxId;
            emit PreimageRevealed(hashlockHash, preimage, wtxId, blockHeight);
        }

        return true;
    }
}
