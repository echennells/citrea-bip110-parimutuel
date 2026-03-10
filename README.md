# BIP-110 Bet

A trustless prediction market on whether Bitcoin enforces the OP_RETURN size limit (BIP-110). Both sides deposit cBTC into an escrow contract on [Citrea](https://citrea.xyz) (a Bitcoin L2). The contract settles by verifying real Bitcoin transactions via Citrea's built-in Bitcoin Light Client.

- **Anti-BIP-110** wins by proving a >100 byte OP_RETURN was mined before a deadline
- **Pro-BIP-110** wins if no proof is submitted by the deadline

No oracle, no trusted third party. The only trust assumptions are Bitcoin PoW and the Citrea sequencer.

## How It Works

The bet is a parimutuel pool — depositors on each side split the total pot proportionally. Anyone can deposit on either side before the bet resolves.

The `prove()` function verifies a real Bitcoin transaction on-chain:
1. `sha256(sha256(rawTx)) == wtxId` — proves the raw tx matches the claimed ID
2. Citrea Light Client `verifyInclusion()` — proves the tx is in a real Bitcoin block via witness Merkle proof
3. `OpReturnParser.parseOpReturns()` — extracts OP_RETURN data from the raw tx
4. Checks if any OP_RETURN payload > 100 bytes

## Contracts

| Contract | What |
|----------|------|
| `BIP110Bet.sol` | Escrow betting pool — deposit, prove, timeout, withdraw |
| `OpReturnParser.sol` | Pure Solidity Bitcoin transaction parser (SegWit, VarInt, PUSHDATA1/2) |
| `BIP110Verifier.sol` | Phase 2 predecessor — same verification, hashlock reveal instead of bet |
| `IBitcoinLightClient.sol` | Interface to Citrea's system precompile at `0x31...0001` |

## Deployed (Citrea Testnet, chain 5115)

| Contract | Address |
|----------|---------|
| OpReturnParser | `0x5BB078C8aC361be88A27195307138A678562D281` |
| BIP110Verifier | `0x54e5668929a6D8c80FAcB3fee3Ca430487224C1F` |
| Bitcoin Light Client | `0x3100000000000000000000000000000000000001` (system precompile) |

## Setup

```bash
npm install
cp .env.example .env  # add PRIVATE_KEY and PRIVATE_KEY_B
```

Two wallets are needed for e2e tests (one bets Pro, the other Anti):
```
PRIVATE_KEY=0x...    # Wallet A
PRIVATE_KEY_B=0x...  # Wallet B
```

## Tests

Unit tests (local Hardhat EVM with mock light client):
```bash
npx hardhat test
```

| Suite | Tests | Coverage |
|-------|-------|----------|
| BIP110Bet | 22 | Deposits, prove, timeout, withdraw, edge cases |
| BIP110Verifier | 8 | Deploy, hashlock, preimage reveal |
| OpReturnParser | 7 | hasOpReturn, parseOpReturns, firstOpReturnAsString |

## E2E Tests (Citrea Testnet)

Both resolution paths have been tested end-to-end on live Citrea testnet against real Bitcoin testnet4 transactions.

### Anti wins (proof submitted)

```bash
npx hardhat run scripts/e2e-anti-wins.ts --network citrea
```

Deploys contract, both wallets deposit, submits a real Bitcoin OP_RETURN proof (>100 bytes), anti side withdraws winnings, pro side correctly reverts.

### Pro wins (timeout)

```bash
npx hardhat run scripts/e2e-pro-wins.ts --network citrea
```

Deploys contract, both wallets deposit, polls the Citrea light client until it passes the deadline, calls `claimTimeout()`, pro side withdraws.

The light client can be slow on testnet. If the script crashes mid-run (RPC timeout, computer sleep, etc.), resume with:

```bash
BET_ADDR=0x... npx hardhat run scripts/resume-pro-wins.ts --network citrea
```

The contract address is printed after deploy. The resume script is idempotent — it skips steps that already completed.

## Helper Scripts

| Script | What |
|--------|------|
| `scripts/witness_proof.py` | Generates witness Merkle proofs from mempool.space for any Bitcoin testnet4 tx |
| `scripts/check_light_client.py` | Queries Citrea Light Client state (current height, block hashes) |

## Security

- **Slither** static analysis: no critical findings. The reentrancy warning on `withdraw()` is a false positive (guarded by `claimed` mapping).
- **Echidna** fuzz testing: 1M+ tests on OpReturnParser, all 5 properties passing (no panics, consistent counts, valid indices).
