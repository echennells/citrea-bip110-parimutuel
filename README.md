# BIP-110 Bet

A trustless prediction market on whether Bitcoin enforces the OP_RETURN size limit (BIP-110). Both sides deposit cBTC into an escrow contract on [Citrea](https://citrea.xyz) (a Bitcoin L2). The contract settles by verifying real Bitcoin transactions via Citrea's built-in Bitcoin Light Client.

- **BIP-110-Fails** wins by proving a >100 byte OP_RETURN was mined before a deadline
- **BIP-110-Passes** wins if no proof is submitted by the deadline

No oracle, no trusted third party. The only trust assumptions are Bitcoin PoW and the Citrea sequencer.

## How It Works

The bet is a parimutuel pool — depositors on each side split the total pot proportionally. Anyone can deposit on either side before the bet resolves.

The `prove()` function verifies a real Bitcoin transaction on-chain:
1. `sha256(sha256(rawTx)) == wtxId` — proves the raw tx matches the claimed ID
2. Citrea Light Client `verifyInclusion()` — proves the tx is in a real Bitcoin block via witness Merkle proof
3. `OpReturnParser.parseOpReturns()` — extracts OP_RETURN data from the raw tx
4. Checks if any OP_RETURN payload > 100 bytes

## Contracts

These are Solidity smart contracts (`.sol`) — the EVM language used by Citrea, Ethereum, and others (not Solana). They run on Citrea's EVM, which is a Bitcoin L2 that settles to Bitcoin.

| Contract | What |
|----------|------|
| `BIP110Bet.sol` | The main contract. Holds deposited cBTC in escrow, accepts Bitcoin transaction proofs to settle the bet, and pays out winners proportionally from the pool. |
| `OpReturnParser.sol` | Parses raw Bitcoin transactions in Solidity. Handles SegWit, VarInt encoding, and PUSHDATA opcodes to extract OP_RETURN payloads and their sizes. |
| `IBitcoinLightClient.sol` | Interface to Citrea's built-in Bitcoin Light Client — a system contract that tracks Bitcoin block headers and can verify that a transaction was included in a real Bitcoin block via witness Merkle proof. |

## Setup

```bash
npm install
cp .env.example .env  # add PRIVATE_KEY and PRIVATE_KEY_B
```

Two wallets are needed for e2e tests (one bets Passes, the other Fails):
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
| OpReturnParser | 7 | hasOpReturn, parseOpReturns, firstOpReturnAsString |

## E2E Tests (Citrea Testnet)

Both resolution paths have been tested end-to-end on live Citrea testnet against real Bitcoin testnet4 transactions.

### BIP-110-Fails wins (proof submitted)

```bash
npx hardhat run scripts/e2e-fails-wins.ts --network citrea
```

Deploys contract, both wallets deposit, submits a real Bitcoin OP_RETURN proof (>100 bytes), fails side withdraws winnings, passes side correctly reverts.

### BIP-110-Passes wins (timeout)

```bash
npx hardhat run scripts/e2e-passes-wins.ts --network citrea
```

Deploys contract, both wallets deposit, polls the Citrea light client until it passes the deadline, calls `claimTimeout()`, passes side withdraws.

The light client can be slow on testnet. If the script crashes mid-run (RPC timeout, computer sleep, etc.), resume with:

```bash
BET_ADDR=0x... npx hardhat run scripts/resume-passes-wins.ts --network citrea
```

The contract address is printed after deploy. The resume script is idempotent — it skips steps that already completed.

## Helper Scripts

| Script | What |
|--------|------|
| `scripts/witness_proof.py` | Generates witness Merkle proofs from mempool.space for any Bitcoin testnet4 tx |
| `scripts/check_light_client.py` | Queries Citrea Light Client state (current height, block hashes) |

## Security

Audited with [Trail of Bits](https://www.trailofbits.com/) tooling:

- **Slither** (static analysis): no critical findings
- **Echidna** (property-based fuzzing): 1M+ tests on OpReturnParser, all 5 invariant properties passing
