# BIP-110 Bet: Project Report

## What This Is

A trustless prediction market on whether Bitcoin enforces the OP_RETURN size limit (BIP-110). Both sides deposit cBTC into an escrow contract on Citrea (a Bitcoin L2). The contract settles by verifying real Bitcoin transactions via Citrea's built-in Bitcoin Light Client.

- **Anti-BIP-110** wins by proving a >100 byte OP_RETURN was mined before a deadline
- **Pro-BIP-110** wins if no proof is submitted by the deadline

No oracle, no trusted third party. The only trust assumptions are Bitcoin PoW and the Citrea sequencer — both already assumed by anyone using these networks.

---

## Project Structure

Everything lives in **one repo**: `/Users/eric/blah/citrea-testnet/`

There's also a spec doc and Bitcoin Core source at `/Users/eric/blah/bip110/`, and a Bitcoin testnet3 helper script at `/Users/eric/blah/op_return_testnet.py`, but the working code is all in `citrea-testnet/`.

```
citrea-testnet/
├── contracts/
│   ├── BIP110Bet.sol              ← Phase 3: Escrow betting pool (THE CONTRACT)
│   ├── BIP110Verifier.sol         ← Phase 2: Hashlock preimage reveal (predecessor)
│   ├── OpReturnParser.sol         ← Phase 1: Raw Bitcoin tx parser
│   ├── BEPSI.sol                  ← Unrelated ERC20 token
│   ├── BIP110Bet.sol.bak          ← Dead: old Chainlink oracle approach
│   ├── interfaces/
│   │   └── IBitcoinLightClient.sol  ← Interface to Citrea's Light Client precompile
│   └── mocks/
│       └── MockBitcoinLightClient.sol ← Hardhat test mock (configurable block height)
│
├── test/
│   ├── BIP110Bet.test.ts          ← 22 tests: deposits, prove, timeout, withdraw
│   ├── BIP110Verifier.test.ts     ← 8 tests: Phase 2 verification
│   └── OpReturnParser.test.ts     ← 7 tests: Phase 1 parsing
│
├── scripts/
│   ├── e2e-bet.ts                 ← E2E deploy+test on Citrea testnet
│   ├── witness_proof.py           ← Generates witness Merkle proofs from mempool.space
│   └── check_light_client.py      ← Diagnostic: queries Light Client state on Citrea
│
├── ignition/modules/
│   ├── BIP110Bet.ts               ← Deploy module (param: deadlineBlockHeight)
│   ├── BIP110Verifier.ts          ← Deploy module (params: hashlockHash, preimage)
│   ├── OpReturnParser.ts          ← Deploy module (no params)
│   └── BEPSI.ts                   ← Unrelated
│
├── hardhat.config.ts              ← Solidity 0.8.27, Citrea testnet (chain 5115)
├── package.json                   ← hardhat, @openzeppelin/contracts, dotenv
└── .env                           ← PRIVATE_KEY for Citrea testnet
```

### Other locations

| Path | What |
|------|------|
| `/Users/eric/blah/bip110/BIP110-BET-SPEC.md` | Original design spec (Phase 0 planning) |
| `/Users/eric/blah/bip110/bitcoin/` | Bitcoin Core source (BIP-110 branch) |
| `/Users/eric/blah/op_return_testnet.py` | Python tool for creating OP_RETURN txs on Bitcoin testnet3 |
| `/Users/eric/blah/testnet_key.json` | Bitcoin testnet3 private key |

---

## Contracts

### BIP110Bet.sol (Phase 3 — current)

The escrow betting pool. This is the contract that matters.

| Function | What it does |
|----------|-------------|
| `deposit(Side.Pro)` | Deposit cBTC betting that BIP-110 WILL be enforced |
| `deposit(Side.Anti)` | Deposit cBTC betting that BIP-110 will NOT be enforced |
| `prove(blockHeight, rawTx, wtxId, proof, index)` | Submit a >100 byte OP_RETURN proof. Resolves to AntiWins. |
| `claimTimeout()` | After deadline + no proof, resolves to ProWins |
| `withdraw()` | Winners withdraw proportional share of total pool |

Verification chain inside `prove()`:
1. `sha256(sha256(rawTx)) == wtxId` — proves rawTx matches claimed ID
2. `LIGHT_CLIENT.verifyInclusion(height, wtxId, proof, index)` — proves tx is in a real Bitcoin block
3. `parser.parseOpReturns(rawTx)` — extracts OP_RETURN data
4. Checks if any OP_RETURN > 100 bytes

### OpReturnParser.sol (Phase 1)

Pure Bitcoin transaction parser. No external dependencies. Handles SegWit, VarInt, PUSHDATA1/2. Used by both BIP110Verifier and BIP110Bet.

### BIP110Verifier.sol (Phase 2 — predecessor)

Same verification logic as BIP110Bet's `prove()`, but instead of resolving a bet, it reveals a hashlock preimage. This was the stepping stone to Phase 3. Still deployed and working but superseded by BIP110Bet for the actual bet.

### IBitcoinLightClient.sol

Interface to Citrea's system precompile at `0x3100000000000000000000000000000000000001`. This contract is baked into the Citrea chain itself — the sequencer feeds it Bitcoin block headers. It exposes:
- `blockNumber()` — latest Bitcoin height
- `getBlockHash(height)` — block hash for any synced height
- `verifyInclusion(height, wtxId, proof, index)` — Merkle proof verification

---

## Deployed Contracts (Citrea Testnet, chain 5115)

| Contract | Address | Status |
|----------|---------|--------|
| OpReturnParser | `0x5BB078C8aC361be88A27195307138A678562D281` | Live, Phase 1 |
| BIP110Verifier | `0x54e5668929a6D8c80FAcB3fee3Ca430487224C1F` | Live, Phase 2 |
| BIP110Bet | `0x92dbD48Bed82F81A75B8fAC5a02066a7157Dd91D` | Live, Phase 3 (e2e tested) |
| Bitcoin Light Client | `0x3100000000000000000000000000000000000001` | System precompile |

---

## Scripts

### `scripts/e2e-bet.ts`

Full end-to-end test on Citrea testnet. Run with:
```
npx hardhat run scripts/e2e-bet.ts --network citrea
```

Does: deploy BIP110Bet → deposit on both sides → submit real Bitcoin proof → withdraw winnings.

### `scripts/witness_proof.py`

Generates witness Merkle proofs for any Bitcoin testnet4 transaction. Run with:
```
python scripts/witness_proof.py <txid>
```

Fetches the raw block from mempool.space, computes all wtxids, builds the Merkle tree, extracts the proof path. Outputs parameters ready to paste into `prove()` or `verifyAndReveal()`. Requires `pip install requests`.

### `scripts/check_light_client.py`

Diagnostic tool — queries the Citrea Light Client to check current Bitcoin height, block hashes, and whether a specific tx's block has been synced. Requires `pip install requests`.

---

## Tests

Run all 37 tests:
```
npx hardhat test
```

Run just the bet tests (22 tests):
```
npx hardhat test test/BIP110Bet.test.ts
```

| Suite | Tests | What's covered |
|-------|-------|---------------|
| BIP110Bet | 22 | Deposits (pro/anti/accumulation/rejects), prove (valid/invalid/deadline), timeout (valid/early/double), withdraw (proportional payout/losers/double) |
| BIP110Verifier | 8 | Deploy, hashlock, preimage reveal, wtxId validation |
| OpReturnParser | 7 | hasOpReturn, parseOpReturns, firstOpReturnAsString |

---

## E2E Test Results (Citrea Testnet, Feb 27 2026)

Tested with real Bitcoin testnet4 transaction `de37ab904d8f93c070a2fc3ef1777d2609ceb6e3acd4b5d5946f7441ae51c991` from block 123,716. This tx contains a 101-byte OP_RETURN with the message:

> "BIP110 Phase 2: Trustless OP_RETURN verification via Citrea Light Client proves this tx is mined!"

| Step | Tx Hash | Result |
|------|---------|--------|
| Deploy | (contract creation) | `0x92dbD48Bed82F81A75B8fAC5a02066a7157Dd91D` |
| Pro deposit (0.0001 cBTC) | `0xfce20a48...` | Success |
| Anti deposit (0.0002 cBTC) | `0xe26f2413...` | Success |
| Prove (101-byte OP_RETURN) | `0xba130935...` | AntiWins, 179,761 gas |
| Withdraw | `0xf0125131...` | 0.0003 cBTC payout |

The prove step verified:
- wtxId `0xafabd687c327b4df84c5c57c0c06c88b2b1be0142ef02e80e2366313e6a61f2f` matches double-SHA256 of the raw tx
- Citrea's Light Client confirmed the tx is in Bitcoin testnet4 block 123,716 via witness Merkle proof (7 siblings, index 31 in a 105-tx block)
- OpReturnParser confirmed the OP_RETURN payload is 101 bytes (> 100 threshold)

---

## Citrea Testnet Account

| | |
|---|---|
| Address | `0xA50d2B5A1d5B208F533Aeda0123De3811C031c57` |
| Balance | ~0.00199 cBTC (after e2e test) |
| RPC | `https://rpc.testnet.citrea.xyz` |
| Chain ID | 5115 |

---

## Build Phases

| Phase | Status | What |
|-------|--------|------|
| Phase 1 | Done | OpReturnParser — pure Bitcoin tx parsing |
| Phase 2 | Done | BIP110Verifier — Light Client Merkle proof + hashlock reveal |
| Phase 3 | Done | BIP110Bet — escrow betting pool, e2e tested on Citrea testnet |
| Phase 4 | Not started | Off-chain submitter (auto-watch Bitcoin, submit proofs) |

---

## What's NOT in this repo

- No Bitcoin Script (P2WSH timelock/hashlock) implementation yet — the original spec described settlement on Bitcoin L1, but Phase 3 moved to Citrea-only escrow
- No off-chain watcher/submitter — someone still has to manually run `witness_proof.py` and submit the proof
- The `op_return_testnet.py` script (for creating Bitcoin testnet3 OP_RETURN txs) is in the parent directory, not in this repo
