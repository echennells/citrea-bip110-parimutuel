# BIP-110 Bet

A trustless parimutuel prediction market on whether BIP-110 is activated on Bitcoin.

Both sides deposit cBTC into an escrow contract on [Citrea](https://citrea.xyz) (a Bitcoin L2). After the BIP-110 activation block, anyone can prove that a transaction with an OP_RETURN over 100 bytes was mined. If such a transaction exists, BIP-110 was not enforced and the **BIP-110-Fails** side wins. If nobody submits a valid proof within 2016 blocks (~2 weeks, one difficulty period), the funds go to the **BIP-110-Passes** side.

**This is a testnet contract.** It runs on Citrea testnet (chain 5115) against Bitcoin testnet4. The deadline (activation block) is set at deploy time and can be any Bitcoin block height. For testing, the end-to-end scripts set short deadlines relative to the current light client height so you don't have to wait long.

## How It Works

The bet is a parimutuel pool. All deposits from both sides go into one pot. When the bet resolves, the winning side splits the entire pot in proportion to how much each winner deposited. For example, if the Passes pool has 3 BTC and the Fails pool has 1 BTC, and Passes wins, a depositor who put in 1 BTC of that 3 BTC gets 1/3 of the total 4 BTC pot (1.33 BTC). Anyone can deposit on either side before the bet resolves.

The `prove()` function verifies a real Bitcoin transaction on-chain:
1. `sha256(sha256(rawTx)) == wtxId` verifies the raw tx matches the claimed ID
2. Citrea Light Client `verifyInclusion()` verifies the tx is in a real Bitcoin block via witness Merkle proof
3. `OpReturnParser.parseOpReturns()` extracts OP_RETURN data from the raw tx
4. Checks if any OP_RETURN payload > 100 bytes

### Deploying

The contract takes three constructor arguments:
- `_lightClient` - Citrea's Bitcoin Light Client address (`0x3100000000000000000000000000000000000001`)
- `_parser` - deployed OpReturnParser address
- `_deadline` - Bitcoin block height after which the bet can be resolved. For a real BIP-110 bet this would be the activation block + 2016. For testing, set it to the current light client height + a few blocks.

## Contracts

These are EVM smart contracts written in Solidity. Citrea is a Bitcoin L2 that runs an EVM and settles to Bitcoin.

| Contract | What |
|----------|------|
| `BIP110Bet.sol` | The main contract. Holds deposited cBTC in escrow, accepts Bitcoin transaction proofs to settle the bet, and pays out winners proportionally from the pool. |
| `OpReturnParser.sol` | Parses raw Bitcoin transactions in Solidity. Handles SegWit, VarInt encoding, and PUSHDATA opcodes to extract OP_RETURN payloads and their sizes. |
| `IBitcoinLightClient.sol` | Interface to Citrea's built-in Bitcoin Light Client, a system contract that tracks Bitcoin block headers and can verify that a transaction was included in a real Bitcoin block via witness Merkle proof. |

## Setup

```bash
npm install
cp .env.example .env  # add PRIVATE_KEY and PRIVATE_KEY_B
```

Two wallets are needed for end-to-end tests (one bets Passes, the other Fails). Both need cBTC from the Citrea testnet faucet.
```
PRIVATE_KEY=0x...    # Wallet A
PRIVATE_KEY_B=0x...  # Wallet B
```

## Tests

Unit tests run on a local Hardhat EVM with a mock light client. No testnet connection needed.
```bash
npx hardhat test
```

| Suite | Tests | Coverage |
|-------|-------|----------|
| BIP110Bet | 22 | Deposits, prove, timeout, withdraw, edge cases |
| OpReturnParser | 7 | hasOpReturn, parseOpReturns, firstOpReturnAsString |

## End-to-End Tests (Citrea Testnet)

These scripts deploy a fresh contract on Citrea testnet, deposit on both sides with two wallets, and test the full resolution flow against real Bitcoin testnet4 transactions.

### BIP-110-Fails wins (proof submitted)

```bash
npx hardhat run scripts/e2e-fails-wins.ts --network citrea
```

Sets the deadline far in the future, then submits a real >100 byte OP_RETURN proof from a Bitcoin testnet4 block. Fails side withdraws winnings, passes side correctly reverts.

### BIP-110-Passes wins (timeout)

```bash
npx hardhat run scripts/e2e-passes-wins.ts --network citrea
```

Sets the deadline to the current light client height + 25 blocks, then polls until the light client catches up. Calls `claimTimeout()`, passes side withdraws.

The Citrea testnet light client can be slow. If the script crashes mid-run (RPC timeout, computer sleep, etc.), resume with:

```bash
BET_ADDR=0x... npx hardhat run scripts/resume-passes-wins.ts --network citrea
```

The contract address is printed after deploy. The resume script is idempotent and skips steps that already completed.

## Helper Scripts

| Script | What |
|--------|------|
| `scripts/witness_proof.py` | Generates witness Merkle proofs from mempool.space for any Bitcoin testnet4 tx |
| `scripts/check_light_client.py` | Queries Citrea Light Client state (current height, block hashes) |

## Security

Audited with [Trail of Bits](https://www.trailofbits.com/) tooling:

- **Slither** (static analysis): no critical findings
- **Echidna** (property-based fuzzing): 1M+ tests on OpReturnParser, all 5 invariant properties passing
