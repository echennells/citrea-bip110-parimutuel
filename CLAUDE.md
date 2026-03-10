# BIP-110 Bet - Project Guide

## Project Overview

Trustless prediction market on BIP-110 activation, deployed on Citrea (Bitcoin L2 with EVM).
The contract checks for >100 byte OP_RETURNs in real Bitcoin blocks via Citrea's Light Client.

## Key Architecture

- `BIP110Bet.sol` - Main contract: escrow pool, proof verification, payout
- `OpReturnParser.sol` - Parses raw Bitcoin tx bytes to extract OP_RETURN data
- `IBitcoinLightClient.sol` - Interface to Citrea's system precompile at `0x3100000000000000000000000000000000000001`
- Betting sides: `Side.Passes` (BIP-110 enforced) and `Side.Fails` (BIP-110 not enforced)
- Outcomes: `Outcome.PassesWins` (timeout, no proof), `Outcome.FailsWins` (valid proof submitted)

## Commands

### Unit Tests (local Hardhat EVM, no network needed)
```bash
npx hardhat test                              # all 29 tests
npx hardhat test test/BIP110Bet.test.ts       # just bet tests (22)
npx hardhat test test/OpReturnParser.test.ts   # just parser tests (7)
```

### Compile
```bash
npx hardhat compile
```

### End-to-End Tests (requires Citrea testnet + funded wallets in .env)
```bash
# BIP-110-Fails wins via proof
npx hardhat run scripts/e2e-fails-wins.ts --network citrea

# BIP-110-Passes wins via timeout
npx hardhat run scripts/e2e-passes-wins.ts --network citrea

# Resume passes-wins if it crashed mid-run
BET_ADDR=0x... npx hardhat run scripts/resume-passes-wins.ts --network citrea
```

### Helper Scripts
```bash
# Generate witness Merkle proof for a Bitcoin testnet4 tx
python scripts/witness_proof.py <txid>

# Check Citrea Light Client height
python scripts/check_light_client.py
```

### Security Tools (Trail of Bits, requires eth-security-toolbox Docker image)
```bash
# Slither static analysis
slither contracts/BIP110Bet.sol

# Echidna fuzzing (config in echidna.yaml, harness in contracts/test/OpReturnParserFuzz.sol)
echidna contracts/test/OpReturnParserFuzz.sol --contract OpReturnParserFuzz --config echidna.yaml
```

## Environment Setup

Requires `.env` with:
```
PRIVATE_KEY=0x...    # Wallet A (Citrea testnet)
PRIVATE_KEY_B=0x...  # Wallet B (Citrea testnet)
```

Two wallets needed for end-to-end tests (one bets each side). Both need cBTC from Citrea testnet faucet.

## Network Details

- Citrea testnet RPC: `https://rpc.testnet.citrea.xyz`
- Chain ID: 5115
- Citrea uses Bitcoin testnet4
- Light Client precompile: `0x3100000000000000000000000000000000000001`
- OpReturnParser deployed at: `0x5BB078C8aC361be88A27195307138A678562D281`

## Known Issues

- Citrea testnet light client can be very slow (minutes per Bitcoin block), causing e2e timeout scripts to run for a long time or crash. Use resume-passes-wins.ts to pick up where it left off.
- The e2e-passes-wins.ts script prints the contract address after deploy. Save it in case you need to resume.
- Python scripts require `pip install requests` (and `mnemonic bip32` for op_return_testnet.py in parent dir).
