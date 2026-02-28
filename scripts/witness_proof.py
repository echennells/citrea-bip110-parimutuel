#!/usr/bin/env python3
"""
Witness Merkle Proof Generator for BIP110Verifier

Fetches a raw Bitcoin block from mempool.space, builds the witness Merkle tree,
and extracts the proof path for a given transaction. Outputs the parameters
needed to call BIP110Verifier.verifyAndReveal().

Usage:
    python scripts/witness_proof.py <txid>

Requires:
    pip install requests bitcoin-utils
"""

import sys
import hashlib
import struct
import requests

MEMPOOL_API = "https://mempool.space/testnet4/api"


def sha256d(data: bytes) -> bytes:
    """Double SHA-256."""
    return hashlib.sha256(hashlib.sha256(data).digest()).digest()


def fetch_tx_info(txid: str) -> dict:
    """Fetch transaction info from mempool.space API."""
    url = f"{MEMPOOL_API}/tx/{txid}"
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    return resp.json()


def fetch_raw_tx(txid: str) -> bytes:
    """Fetch raw transaction bytes from mempool.space API."""
    url = f"{MEMPOOL_API}/tx/{txid}/raw"
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    return resp.content


def fetch_block_txids(block_hash: str) -> list[str]:
    """Fetch the list of txids in a block."""
    url = f"{MEMPOOL_API}/block/{block_hash}/txids"
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    return resp.json()


def fetch_block_info(block_hash: str) -> dict:
    """Fetch block header info."""
    url = f"{MEMPOOL_API}/block/{block_hash}"
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    return resp.json()


def read_varint(data: bytes, offset: int) -> tuple[int, int]:
    """Read a Bitcoin CompactSize varint. Returns (value, bytes_consumed)."""
    first = data[offset]
    if first < 0xFD:
        return first, 1
    elif first == 0xFD:
        return struct.unpack_from("<H", data, offset + 1)[0], 3
    elif first == 0xFE:
        return struct.unpack_from("<I", data, offset + 1)[0], 5
    else:
        return struct.unpack_from("<Q", data, offset + 1)[0], 9


def compute_wtxid(raw_tx: bytes) -> bytes:
    """Compute the witness txid (double-SHA256 of the full serialized tx including witness)."""
    return sha256d(raw_tx)


def compute_txid(raw_tx: bytes) -> bytes:
    """
    Compute the legacy txid (double-SHA256 of the tx without witness data).
    For non-segwit transactions, this is the same as wtxid.
    """
    # Check for segwit marker
    if len(raw_tx) > 5 and raw_tx[4] == 0x00 and raw_tx[5] == 0x01:
        # Strip witness data: version + inputs + outputs + locktime
        version = raw_tx[:4]
        offset = 6  # skip version(4) + marker(1) + flag(1)

        # Read and skip inputs
        input_count, vlen = read_varint(raw_tx, offset)
        input_start = offset
        offset += vlen
        for _ in range(input_count):
            offset += 36  # prevout
            script_len, vlen = read_varint(raw_tx, offset)
            offset += vlen + script_len + 4  # scriptSig + sequence

        # Read and skip outputs
        output_count, vlen = read_varint(raw_tx, offset)
        offset += vlen
        for _ in range(output_count):
            offset += 8  # value
            script_len, vlen = read_varint(raw_tx, offset)
            offset += vlen + script_len

        # Locktime is last 4 bytes
        locktime = raw_tx[-4:]

        # Reconstruct without witness: version + varint(inputs) + inputs + varint(outputs) + outputs + locktime
        stripped = version + raw_tx[input_start:offset] + locktime
        return sha256d(stripped)
    else:
        return sha256d(raw_tx)


def build_merkle_tree(leaves: list[bytes]) -> list[list[bytes]]:
    """
    Build a full Merkle tree from a list of 32-byte leaves.
    Returns list of levels, where level[0] = leaves, level[-1] = [root].
    """
    if not leaves:
        return [[b"\x00" * 32]]

    tree = [leaves[:]]
    current = leaves[:]

    while len(current) > 1:
        next_level = []
        for i in range(0, len(current), 2):
            left = current[i]
            # If odd number of elements, duplicate the last one
            right = current[i + 1] if i + 1 < len(current) else current[i]
            next_level.append(sha256d(left + right))
        tree.append(next_level)
        current = next_level

    return tree


def extract_proof(tree: list[list[bytes]], index: int) -> list[bytes]:
    """Extract the Merkle proof siblings for a given leaf index."""
    proof = []
    for level in tree[:-1]:  # skip root
        if index % 2 == 0:
            # Sibling is to the right
            sibling_idx = index + 1
            if sibling_idx < len(level):
                proof.append(level[sibling_idx])
            else:
                proof.append(level[index])  # duplicate last
        else:
            # Sibling is to the left
            proof.append(level[index - 1])
        index //= 2
    return proof


def main():
    if len(sys.argv) < 2:
        print("Usage: python scripts/witness_proof.py <txid>")
        sys.exit(1)

    target_txid = sys.argv[1]
    print(f"Target txid: {target_txid}")

    # 1. Get tx info to find the block
    print("\nFetching transaction info...")
    tx_info = fetch_tx_info(target_txid)

    if not tx_info.get("status", {}).get("confirmed"):
        print("ERROR: Transaction is not confirmed yet!")
        sys.exit(1)

    block_hash = tx_info["status"]["block_hash"]
    block_height = tx_info["status"]["block_height"]
    print(f"Block: {block_hash}")
    print(f"Height: {block_height}")

    # 2. Get all txids in the block to find our tx's index
    print("\nFetching block txids...")
    txids = fetch_block_txids(block_hash)
    print(f"Block has {len(txids)} transactions")

    if target_txid not in txids:
        print(f"ERROR: txid {target_txid} not found in block!")
        sys.exit(1)

    tx_index = txids.index(target_txid)
    print(f"Transaction index: {tx_index}")

    if tx_index == 0:
        print("WARNING: This is the coinbase transaction. wtxId must be 0x00...00")

    # 3. Fetch raw tx for our target
    print("\nFetching raw transaction...")
    raw_tx = fetch_raw_tx(target_txid)
    print(f"Raw tx size: {len(raw_tx)} bytes")

    # 4. Compute wtxid
    wtxid = compute_wtxid(raw_tx)
    txid_computed = compute_txid(raw_tx)
    print(f"Computed txid:  {txid_computed[::-1].hex()}")
    print(f"Computed wtxid: {wtxid[::-1].hex()}")

    # 5. Build witness Merkle tree
    # For the witness Merkle tree:
    # - Coinbase (index 0) has wtxid = 0x00...00
    # - All other txs use their actual wtxid
    print("\nBuilding witness Merkle tree...")
    print(f"Fetching raw transactions for all {len(txids)} txids...")

    wtxids = []
    for i, txid in enumerate(txids):
        if i == 0:
            # Coinbase wtxid is always 0x00...00
            wtxids.append(b"\x00" * 32)
        else:
            raw = fetch_raw_tx(txid)
            wid = compute_wtxid(raw)
            wtxids.append(wid)
        if (i + 1) % 50 == 0 or i == len(txids) - 1:
            print(f"  Processed {i + 1}/{len(txids)} transactions")

    tree = build_merkle_tree(wtxids)
    witness_root = tree[-1][0]
    print(f"Witness Merkle root: {witness_root[::-1].hex()}")

    # 6. Extract proof for our transaction
    proof_siblings = extract_proof(tree, tx_index)
    proof_bytes = b"".join(proof_siblings)

    print(f"\n{'=' * 60}")
    print("PARAMETERS FOR verifyAndReveal():")
    print(f"{'=' * 60}")
    print(f"blockHeight: {block_height}")
    print(f"rawTx:       0x{raw_tx.hex()}")
    print(f"wtxId:       0x{wtxid.hex()}")
    print(f"proof:       0x{proof_bytes.hex()}")
    print(f"index:       {tx_index}")
    print(f"{'=' * 60}")

    # Also print as a single-line call for convenience
    print(f"\nSolidity call:")
    print(f'verifyAndReveal({block_height}, "0x{raw_tx.hex()}", "0x{wtxid.hex()}", "0x{proof_bytes.hex()}", {tx_index})')


if __name__ == "__main__":
    main()
