// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "./interfaces/IBitcoinLightClient.sol";
import "./OpReturnParser.sol";

/// @title BIP110Bet — Phase 3: Escrow betting pool on whether >100 byte OP_RETURNs exist
/// @notice Both sides deposit cBTC. Anti-BIP-110 wins by proving a >100 byte OP_RETURN
///         was mined before the deadline. Pro-BIP-110 wins if no proof is submitted.
contract BIP110Bet {
    enum Side { Pro, Anti }
    enum Outcome { Unresolved, AntiWins, ProWins }

    IBitcoinLightClient public immutable LIGHT_CLIENT;
    OpReturnParser public immutable parser;
    uint256 public immutable deadline; // Bitcoin block height

    Outcome public outcome;
    bool public resolved;
    bytes32 public provenWtxId;

    uint256 public proPool;
    uint256 public antiPool;
    mapping(address => uint256) public proDeposits;
    mapping(address => uint256) public antiDeposits;
    mapping(address => bool) public claimed;

    event Deposited(address indexed depositor, Side side, uint256 amount);
    event Resolved(Outcome outcome, bytes32 wtxId);
    event Withdrawn(address indexed withdrawer, uint256 amount);

    error AlreadyResolved();
    error DeadlinePassed();
    error DeadlineNotPassed();
    error ZeroDeposit();
    error ZeroWtxId();
    error TxIdMismatch(bytes32 expected, bytes32 actual);
    error InclusionProofFailed();
    error NoLargeOpReturn();
    error NotResolved();
    error NotWinner();
    error AlreadyClaimed();
    error TransferFailed();

    constructor(address _lightClient, address _parser, uint256 _deadline) {
        LIGHT_CLIENT = IBitcoinLightClient(_lightClient);
        parser = OpReturnParser(_parser);
        deadline = _deadline;
    }

    /// @notice Deposit cBTC on either the Pro or Anti side
    function deposit(Side side) external payable {
        if (resolved) revert AlreadyResolved();
        if (LIGHT_CLIENT.blockNumber() > deadline) revert DeadlinePassed();
        if (msg.value == 0) revert ZeroDeposit();

        if (side == Side.Pro) {
            proDeposits[msg.sender] += msg.value;
            proPool += msg.value;
        } else {
            antiDeposits[msg.sender] += msg.value;
            antiPool += msg.value;
        }

        emit Deposited(msg.sender, side, msg.value);
    }

    /// @notice Prove a >100 byte OP_RETURN was mined before the deadline. Anti wins.
    function prove(
        uint256 blockHeight,
        bytes calldata rawTx,
        bytes32 wtxId,
        bytes calldata proof,
        uint256 index
    ) external {
        if (resolved) revert AlreadyResolved();
        if (LIGHT_CLIENT.blockNumber() > deadline) revert DeadlinePassed();

        // 1. Reject zero wtxId (coinbase)
        if (wtxId == bytes32(0)) revert ZeroWtxId();

        // 2. Verify sha256(sha256(rawTx)) == wtxId
        bytes32 computedId = sha256(abi.encodePacked(sha256(rawTx)));
        if (computedId != wtxId) revert TxIdMismatch(wtxId, computedId);

        // 3. Verify inclusion in Bitcoin block
        bool included = LIGHT_CLIENT.verifyInclusion(blockHeight, wtxId, proof, index);
        if (!included) revert InclusionProofFailed();

        // 4. Parse OP_RETURN outputs
        (OpReturnParser.OpReturnResult[] memory results,,) = parser.parseOpReturns(rawTx);

        // 5. Check for > 100 byte OP_RETURN
        bool hasLarge = false;
        for (uint256 i = 0; i < results.length; i++) {
            if (results[i].size > 100) {
                hasLarge = true;
                break;
            }
        }
        if (!hasLarge) revert NoLargeOpReturn();

        // 6. Resolve: Anti wins
        resolved = true;
        outcome = Outcome.AntiWins;
        provenWtxId = wtxId;

        emit Resolved(Outcome.AntiWins, wtxId);
    }

    /// @notice After deadline passes with no proof, resolve as Pro wins
    function claimTimeout() external {
        if (resolved) revert AlreadyResolved();
        if (LIGHT_CLIENT.blockNumber() <= deadline) revert DeadlineNotPassed();

        resolved = true;
        outcome = Outcome.ProWins;

        emit Resolved(Outcome.ProWins, bytes32(0));
    }

    /// @notice Winners withdraw their proportional share of the total pool
    function withdraw() external {
        if (!resolved) revert NotResolved();
        if (claimed[msg.sender]) revert AlreadyClaimed();

        uint256 userDeposit;
        uint256 winningPool;

        if (outcome == Outcome.ProWins) {
            userDeposit = proDeposits[msg.sender];
            winningPool = proPool;
        } else {
            userDeposit = antiDeposits[msg.sender];
            winningPool = antiPool;
        }

        if (userDeposit == 0) revert NotWinner();

        claimed[msg.sender] = true;

        uint256 totalPool = proPool + antiPool;
        uint256 payout = (userDeposit * totalPool) / winningPool;

        (bool success,) = msg.sender.call{value: payout}("");
        if (!success) revert TransferFailed();

        emit Withdrawn(msg.sender, payout);
    }
}
