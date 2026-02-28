#!/usr/bin/env python3
"""
Light Client Diagnostic Script

Checks the Citrea Bitcoin Light Client's state to determine if end-to-end
verification is possible for a given transaction.

Usage:
    python scripts/check_light_client.py [txid]

If txid is provided, also checks whether the Light Client has that tx's block.

Requires:
    pip install requests web3
"""

import sys
import json
import requests

CITREA_RPC = "https://rpc.testnet.citrea.xyz"
LIGHT_CLIENT_ADDR = "0x3100000000000000000000000000000000000001"
MEMPOOL_API = "https://mempool.space/testnet4/api"


def eth_call(to: str, data: str) -> str:
    """Make an eth_call to Citrea testnet."""
    payload = {
        "jsonrpc": "2.0",
        "method": "eth_call",
        "params": [{"to": to, "data": data}, "latest"],
        "id": 1,
    }
    resp = requests.post(CITREA_RPC, json=payload, timeout=30)
    resp.raise_for_status()
    result = resp.json()
    if "error" in result:
        return f"ERROR: {result['error']}"
    return result.get("result", "0x")


def get_block_number() -> int | str:
    """Call blockNumber() on the Light Client."""
    # blockNumber() selector: 0x57e871e7
    result = eth_call(LIGHT_CLIENT_ADDR, "0x57e871e7")
    if isinstance(result, str) and result.startswith("ERROR"):
        return result
    try:
        return int(result, 16)
    except (ValueError, TypeError):
        return f"Unexpected result: {result}"


def get_block_hash(height: int) -> str:
    """Call getBlockHash(uint256) on the Light Client."""
    # getBlockHash(uint256) selector: 0xee82ac5e
    height_hex = hex(height)[2:].zfill(64)
    result = eth_call(LIGHT_CLIENT_ADDR, f"0xee82ac5e{height_hex}")
    return result


def fetch_tx_info(txid: str) -> dict | None:
    """Fetch transaction info from mempool.space."""
    try:
        url = f"{MEMPOOL_API}/tx/{txid}"
        resp = requests.get(url, timeout=30)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        print(f"  Failed to fetch tx info: {e}")
        return None


def main():
    print("=" * 60)
    print("Citrea Bitcoin Light Client Diagnostic")
    print("=" * 60)
    print(f"\nLight Client address: {LIGHT_CLIENT_ADDR}")
    print(f"Citrea RPC: {CITREA_RPC}")

    # 1. Check latest Bitcoin height
    print("\n--- Latest Bitcoin Height ---")
    height = get_block_number()
    if isinstance(height, int):
        print(f"Latest Bitcoin height known to Light Client: {height}")
    else:
        print(f"Could not read blockNumber(): {height}")
        print("(This might mean the Light Client interface differs from expected)")

    # 2. Check block hash for latest height
    if isinstance(height, int) and height > 0:
        print(f"\n--- Block Hash at Height {height} ---")
        block_hash = get_block_hash(height)
        print(f"Block hash: {block_hash}")

    # 3. If txid provided, check if its block is covered
    if len(sys.argv) > 1:
        txid = sys.argv[1]
        print(f"\n--- Transaction Check: {txid} ---")

        tx_info = fetch_tx_info(txid)
        if tx_info is None:
            print("Could not fetch transaction info")
        elif not tx_info.get("status", {}).get("confirmed"):
            print("Transaction is NOT confirmed yet")
        else:
            tx_height = tx_info["status"]["block_height"]
            tx_block = tx_info["status"]["block_hash"]
            print(f"Transaction block height: {tx_height}")
            print(f"Transaction block hash:   {tx_block}")

            if isinstance(height, int):
                if tx_height <= height:
                    print(f"\nLight Client has this block (height {tx_height} <= {height})")

                    # Verify the block hash matches
                    lc_hash = get_block_hash(tx_height)
                    print(f"Light Client block hash at {tx_height}: {lc_hash}")

                    # Compare (mempool returns display order, LC returns LE bytes32)
                    # Convert mempool hash to bytes32 format for comparison
                    expected_bytes32 = "0x" + bytes.fromhex(tx_block)[::-1].hex().zfill(64)
                    if lc_hash.lower() == expected_bytes32.lower():
                        print("Block hashes MATCH — e2e verification should work!")
                    else:
                        print(f"Block hashes DO NOT MATCH")
                        print(f"  Expected (from mempool, reversed): {expected_bytes32}")
                        print(f"  Got (from Light Client):           {lc_hash}")
                else:
                    print(
                        f"\nLight Client does NOT have this block yet "
                        f"(need height {tx_height}, have {height})"
                    )
                    print(f"Need to wait for {tx_height - height} more blocks")

    # 4. Try to check if verifyInclusion exists
    print("\n--- Interface Check ---")
    # Try calling verifyInclusion with dummy data to see if it reverts normally
    # verifyInclusion(uint256,bytes32,bytes,uint256) selector
    # keccak256("verifyInclusion(uint256,bytes32,bytes,uint256)") = need to compute
    # For now just report what we found
    print("blockNumber() selector:      0x57e871e7")
    print("getBlockHash() selector:      0xee82ac5e")
    print("verifyInclusion() selector:   (check Citrea docs for exact ABI)")

    print(f"\n{'=' * 60}")
    if isinstance(height, int) and height > 0:
        print("Light Client is ACTIVE and responding")
    else:
        print("Light Client may not be active or interface may differ")
    print("=" * 60)


if __name__ == "__main__":
    main()
