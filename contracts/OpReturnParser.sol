// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @title OpReturnParser — Pure Solidity Bitcoin OP_RETURN parser
/// @notice Phase 1 of BIP-110 Bet: parses raw Bitcoin transactions for OP_RETURN outputs
contract OpReturnParser {

    struct OpReturnResult {
        bytes data;
        uint256 size;
        uint256 outputIndex;
    }

    error TxTooShort();
    error OffsetOutOfBounds();

    /// @notice Check if a raw Bitcoin transaction contains OP_RETURN outputs
    function hasOpReturn(bytes calldata rawTx)
        external
        pure
        returns (bool found, uint256 totalBytes, uint256 count)
    {
        (OpReturnResult[] memory results,,) = _parseOpReturns(rawTx);
        count = results.length;
        found = count > 0;
        for (uint256 i = 0; i < count; i++) {
            totalBytes += results[i].size;
        }
    }

    /// @notice Parse all OP_RETURN outputs from a raw Bitcoin transaction
    function parseOpReturns(bytes calldata rawTx)
        external
        pure
        returns (OpReturnResult[] memory results, uint32 version, bool isSegwit)
    {
        return _parseOpReturns(rawTx);
    }

    /// @notice Convenience: return the first OP_RETURN payload as a UTF-8 string
    function firstOpReturnAsString(bytes calldata rawTx)
        external
        pure
        returns (string memory data, uint256 size, bool found)
    {
        (OpReturnResult[] memory results,,) = _parseOpReturns(rawTx);
        if (results.length > 0) {
            found = true;
            size = results[0].size;
            data = string(results[0].data);
        }
    }

    // ─── Internal parsing ────────────────────────────────────────────

    function _parseOpReturns(bytes calldata rawTx)
        internal
        pure
        returns (OpReturnResult[] memory, uint32 version, bool isSegwit)
    {
        if (rawTx.length < 10) revert TxTooShort();

        uint256 offset = 0;

        // 1. Version (4 bytes LE)
        version = _readUint32LE(rawTx, offset);
        offset += 4;

        // 2. SegWit flag detection
        if (rawTx[offset] == 0x00 && rawTx[offset + 1] == 0x01) {
            isSegwit = true;
            offset += 2;
        }

        // 3. Skip inputs
        offset = _skipInputs(rawTx, offset);

        // 4. Parse outputs for OP_RETURNs
        return (_parseOutputs(rawTx, offset), version, isSegwit);
    }

    /// @dev Skip all transaction inputs, return offset after last input
    function _skipInputs(bytes calldata rawTx, uint256 offset)
        internal
        pure
        returns (uint256)
    {
        (uint256 inputCount, uint256 viLen) = _readVarInt(rawTx, offset);
        offset += viLen;

        for (uint256 i = 0; i < inputCount; i++) {
            offset += 36; // txid (32) + vout (4)
            uint256 scriptLen;
            (scriptLen, viLen) = _readVarInt(rawTx, offset);
            offset += viLen + scriptLen + 4; // scriptSig + sequence
        }
        return offset;
    }

    /// @dev Two-pass output parsing: count OP_RETURNs, then extract them
    function _parseOutputs(bytes calldata rawTx, uint256 offset)
        internal
        pure
        returns (OpReturnResult[] memory)
    {
        (uint256 outputCount, uint256 viLen) = _readVarInt(rawTx, offset);
        offset += viLen;

        // First pass: count OP_RETURNs
        uint256 savedOffset = offset;
        uint256 opReturnCount = 0;

        for (uint256 i = 0; i < outputCount; i++) {
            offset += 8; // value
            uint256 scriptLen;
            (scriptLen, viLen) = _readVarInt(rawTx, offset);
            offset += viLen;
            if (scriptLen > 0 && rawTx[offset] == 0x6a) {
                opReturnCount++;
            }
            offset += scriptLen;
        }

        // Second pass: extract data
        OpReturnResult[] memory results = new OpReturnResult[](opReturnCount);
        offset = savedOffset;
        uint256 idx = 0;

        for (uint256 i = 0; i < outputCount; i++) {
            offset += 8;
            uint256 scriptLen;
            (scriptLen, viLen) = _readVarInt(rawTx, offset);
            offset += viLen;

            if (scriptLen > 0 && rawTx[offset] == 0x6a) {
                bytes memory payload = _extractOpReturnData(rawTx, offset, scriptLen);
                results[idx++] = OpReturnResult(payload, payload.length, i);
            }
            offset += scriptLen;
        }

        return results;
    }

    /// @dev Extract concatenated push data from an OP_RETURN script
    function _extractOpReturnData(bytes calldata rawTx, uint256 scriptStart, uint256 scriptLen)
        internal
        pure
        returns (bytes memory)
    {
        uint256 scriptEnd = scriptStart + scriptLen;
        uint256 pos = scriptStart + 1; // skip OP_RETURN (0x6a)

        // Calculate total data length
        uint256 totalLen = 0;
        uint256 tempPos = pos;
        while (tempPos < scriptEnd) {
            (uint256 pushLen, uint256 headerLen) = _readPushOpcode(rawTx, tempPos);
            if (headerLen == 0) break;
            totalLen += pushLen;
            tempPos += headerLen + pushLen;
        }

        // Copy data
        bytes memory result = new bytes(totalLen);
        uint256 writePos = 0;
        pos = scriptStart + 1;

        while (pos < scriptEnd) {
            (uint256 pushLen, uint256 headerLen) = _readPushOpcode(rawTx, pos);
            if (headerLen == 0) break;
            pos += headerLen;
            for (uint256 j = 0; j < pushLen; j++) {
                result[writePos++] = rawTx[pos + j];
            }
            pos += pushLen;
        }

        return result;
    }

    /// @dev Decode a push opcode at the given position
    /// @return pushLen Number of data bytes to push
    /// @return headerLen Bytes consumed by the opcode itself (0 = unknown opcode)
    function _readPushOpcode(bytes calldata rawTx, uint256 pos)
        internal
        pure
        returns (uint256 pushLen, uint256 headerLen)
    {
        uint8 opcode = uint8(rawTx[pos]);
        if (opcode >= 0x01 && opcode <= 0x4b) {
            return (opcode, 1);
        } else if (opcode == 0x4c) {
            // PUSHDATA1
            return (uint8(rawTx[pos + 1]), 2);
        } else if (opcode == 0x4d) {
            // PUSHDATA2
            uint256 len = uint256(uint8(rawTx[pos + 1])) | (uint256(uint8(rawTx[pos + 2])) << 8);
            return (len, 3);
        }
        // Unknown opcode
        return (0, 0);
    }

    // ─── Helpers ─────────────────────────────────────────────────────

    function _readUint32LE(bytes calldata data, uint256 offset)
        internal
        pure
        returns (uint32)
    {
        return uint32(uint8(data[offset]))
            | (uint32(uint8(data[offset + 1])) << 8)
            | (uint32(uint8(data[offset + 2])) << 16)
            | (uint32(uint8(data[offset + 3])) << 24);
    }

    /// @dev Read a Bitcoin CompactSize VarInt. Returns (value, bytesConsumed).
    function _readVarInt(bytes calldata data, uint256 offset)
        internal
        pure
        returns (uint256 value, uint256 size)
    {
        if (offset >= data.length) revert OffsetOutOfBounds();
        uint8 first = uint8(data[offset]);

        if (first < 0xfd) {
            return (first, 1);
        } else if (first == 0xfd) {
            value = uint256(uint8(data[offset + 1]))
                | (uint256(uint8(data[offset + 2])) << 8);
            return (value, 3);
        } else if (first == 0xfe) {
            value = uint256(uint8(data[offset + 1]))
                | (uint256(uint8(data[offset + 2])) << 8)
                | (uint256(uint8(data[offset + 3])) << 16)
                | (uint256(uint8(data[offset + 4])) << 24);
            return (value, 5);
        } else {
            value = uint256(uint8(data[offset + 1]))
                | (uint256(uint8(data[offset + 2])) << 8)
                | (uint256(uint8(data[offset + 3])) << 16)
                | (uint256(uint8(data[offset + 4])) << 24)
                | (uint256(uint8(data[offset + 5])) << 32)
                | (uint256(uint8(data[offset + 6])) << 40)
                | (uint256(uint8(data[offset + 7])) << 48)
                | (uint256(uint8(data[offset + 8])) << 56);
            return (value, 9);
        }
    }
}
