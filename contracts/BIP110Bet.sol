// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "./interfaces/IBitcoinLightClient.sol";
import "./OpReturnParser.sol";

/// @title BIP110Bet — Escrow betting pool on whether >100 byte OP_RETURNs exist
/// @notice Both sides deposit cBTC. BIP-110-Fails wins by proving a >100 byte OP_RETURN
///         was mined before the deadline. BIP-110-Passes wins if no proof is submitted.
contract BIP110Bet {
    enum Side { Passes, Fails }
    enum Outcome { Unresolved, FailsWins, PassesWins }

    IBitcoinLightClient public immutable LIGHT_CLIENT;
    OpReturnParser public immutable parser;
    uint256 public immutable deadline; // Bitcoin block height

    Outcome public outcome;
    bool public resolved;
    bytes32 public provenWtxId;

    uint256 public passesPool;
    uint256 public failsPool;
    mapping(address => uint256) public passesDeposits;
    mapping(address => uint256) public failsDeposits;
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

    /// @notice Deposit cBTC on either the Passes or Fails side
    function deposit(Side side) external payable {
        if (resolved) revert AlreadyResolved();
        if (LIGHT_CLIENT.blockNumber() > deadline) revert DeadlinePassed();
        if (msg.value == 0) revert ZeroDeposit();

        if (side == Side.Passes) {
            passesDeposits[msg.sender] += msg.value;
            passesPool += msg.value;
        } else {
            failsDeposits[msg.sender] += msg.value;
            failsPool += msg.value;
        }

        emit Deposited(msg.sender, side, msg.value);
    }

    /// @notice Prove a >100 byte OP_RETURN was mined before the deadline. BIP-110-Fails wins.
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

        // 6. Resolve: BIP-110-Fails wins
        resolved = true;
        outcome = Outcome.FailsWins;
        provenWtxId = wtxId;

        emit Resolved(Outcome.FailsWins, wtxId);
    }

    /// @notice After deadline passes with no proof, resolve as BIP-110-Passes wins
    function claimTimeout() external {
        if (resolved) revert AlreadyResolved();
        if (LIGHT_CLIENT.blockNumber() <= deadline) revert DeadlineNotPassed();

        resolved = true;
        outcome = Outcome.PassesWins;

        emit Resolved(Outcome.PassesWins, bytes32(0));
    }

    /// @notice Winners withdraw their proportional share of the total pool
    function withdraw() external {
        if (!resolved) revert NotResolved();
        if (claimed[msg.sender]) revert AlreadyClaimed();

        uint256 userDeposit;
        uint256 winningPool;

        if (outcome == Outcome.PassesWins) {
            userDeposit = passesDeposits[msg.sender];
            winningPool = passesPool;
        } else {
            userDeposit = failsDeposits[msg.sender];
            winningPool = failsPool;
        }

        if (userDeposit == 0) revert NotWinner();

        claimed[msg.sender] = true;

        uint256 totalPool = passesPool + failsPool;
        uint256 payout = (userDeposit * totalPool) / winningPool;

        (bool success,) = msg.sender.call{value: payout}("");
        if (!success) revert TransferFailed();

        emit Withdrawn(msg.sender, payout);
    }
}
