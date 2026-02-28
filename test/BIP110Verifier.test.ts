import { expect } from "chai";
import hre from "hardhat";

describe("BIP110Verifier", function () {
  // Light Client precompile address on Citrea
  const LIGHT_CLIENT_ADDR = "0x3100000000000000000000000000000000000001";

  // Known preimage and its sha256 hash for testing
  const PREIMAGE = hre.ethers.toUtf8Bytes("bip110-test-preimage-secret");
  const PREIMAGE_HEX = hre.ethers.hexlify(PREIMAGE);

  // Real testnet3 tx with 100-byte OP_RETURN (should NOT trigger reveal)
  const TX_100_BYTES =
    "0x02000000000101c3fec6ac0f0824dbf563dd29bc36a9afbaf09bd0ac78b11ee24d15c752224f950000000000fdffffff020000000000000000676a4c6475506c25314bbfcc1b9aa7c05b12dd9b72f9e052064986be85ab9bdded4bdfa6b0c4730f96924f6a8a8bab2fe097fe6270112417318f9a6ae5f7b65f67d6ceded2e3d75e7e27ed2dc37304799f1fa1582036b15b329b55824e1e745e95641a2f090d6c3c20030000000000001600147b5be3b33fc7a3dc1e62ddbf167ff2b5049b0e610247304402207f53ef56e8d4feb234073f9d7f347b9c992e640ab3ea51dc1a87f471ab995fce022036ece97a75768ff58446e1d3f551bdd7bb5e2fea36fd93c072250aea989e32e001210362ae86b42b370f3204bcbcd3dc6a8f8339930ca8d926989c20706464a25d636c00000000";

  // Build a hand-crafted tx with 101-byte OP_RETURN (SHOULD trigger reveal)
  function buildLargeOpReturnTx(): string {
    const version = "01000000"; // version 1 LE
    const inputCount = "01";
    const prevTxid = "aa".repeat(32); // dummy
    const prevVout = "01000000";
    const scriptSigLen = "00";
    const sequence = "ffffffff";
    const outputCount = "01";
    const value = "0000000000000000"; // 0 sats
    // 101 bytes of OP_RETURN data
    const data = "42".repeat(101);
    // Script: OP_RETURN (6a) + PUSHDATA1 (4c) + length (65 = 101) + data
    const script = "6a" + "4c" + "65" + data;
    const scriptLen = (script.length / 2).toString(16).padStart(2, "0");
    const locktime = "00000000";

    return (
      "0x" +
      version +
      inputCount +
      prevTxid +
      prevVout +
      scriptSigLen +
      sequence +
      outputCount +
      value +
      scriptLen +
      script +
      locktime
    );
  }

  const TX_101_BYTES = buildLargeOpReturnTx();

  // Compute double-SHA256 (wtxId) of a raw tx
  async function computeWtxId(rawTx: string): Promise<string> {
    const txBytes = hre.ethers.getBytes(rawTx);
    const hash1 = hre.ethers.sha256(txBytes);
    const hash2 = hre.ethers.sha256(hre.ethers.getBytes(hash1));
    return hash2;
  }

  // Compute sha256 of the preimage for the hashlock
  function computeHashlockHash(): string {
    return hre.ethers.sha256(PREIMAGE_HEX);
  }

  async function deployFixture() {
    // Deploy mock Light Client bytecode at the precompile address
    const MockLC = await hre.ethers.getContractFactory("MockBitcoinLightClient");
    const mockDeployed = await MockLC.deploy();
    const mockCode = await hre.ethers.provider.getCode(await mockDeployed.getAddress());

    await hre.network.provider.send("hardhat_setCode", [
      LIGHT_CLIENT_ADDR,
      mockCode,
    ]);

    // Deploy OpReturnParser
    const Parser = await hre.ethers.getContractFactory("OpReturnParser");
    const parser = await Parser.deploy();
    const parserAddr = await parser.getAddress();

    // Deploy BIP110Verifier
    const hashlockHash = computeHashlockHash();
    const Verifier = await hre.ethers.getContractFactory("BIP110Verifier");
    const verifier = await Verifier.deploy(
      LIGHT_CLIENT_ADDR,
      parserAddr,
      hashlockHash,
      PREIMAGE_HEX
    );

    return { verifier, parser, hashlockHash };
  }

  describe("deployment", function () {
    it("should deploy with correct hashlock hash", async function () {
      const { verifier, hashlockHash } = await deployFixture();
      expect(await verifier.hashlockHash()).to.equal(hashlockHash);
    });

    it("should not be revealed initially", async function () {
      const { verifier } = await deployFixture();
      expect(await verifier.revealed()).to.be.false;
    });

    it("should reject invalid preimage at deploy", async function () {
      const MockLC = await hre.ethers.getContractFactory("MockBitcoinLightClient");
      const mockDeployed = await MockLC.deploy();
      const mockCode = await hre.ethers.provider.getCode(await mockDeployed.getAddress());
      await hre.network.provider.send("hardhat_setCode", [
        LIGHT_CLIENT_ADDR,
        mockCode,
      ]);

      const Parser = await hre.ethers.getContractFactory("OpReturnParser");
      const parser = await Parser.deploy();

      const hashlockHash = computeHashlockHash();
      const Verifier = await hre.ethers.getContractFactory("BIP110Verifier");
      await expect(
        Verifier.deploy(LIGHT_CLIENT_ADDR, await parser.getAddress(), hashlockHash, "0xdeadbeef")
      ).to.be.revertedWithCustomError(Verifier, "InvalidPreimage");
    });
  });

  describe("verifyAndReveal", function () {
    it("should reject zero wtxId", async function () {
      const { verifier } = await deployFixture();
      const zeroWtxId = hre.ethers.ZeroHash;
      await expect(
        verifier.verifyAndReveal(100, TX_101_BYTES, zeroWtxId, "0x", 0)
      ).to.be.revertedWithCustomError(verifier, "ZeroWtxId");
    });

    it("should reject mismatched wtxId", async function () {
      const { verifier } = await deployFixture();
      const fakeWtxId = "0x" + "ab".repeat(32);
      await expect(
        verifier.verifyAndReveal(100, TX_101_BYTES, fakeWtxId, "0x", 0)
      ).to.be.revertedWithCustomError(verifier, "TxIdMismatch");
    });

    it("should reject tx with 100-byte OP_RETURN (not > 100)", async function () {
      const { verifier } = await deployFixture();
      const wtxId = await computeWtxId(TX_100_BYTES);
      await expect(
        verifier.verifyAndReveal(100, TX_100_BYTES, wtxId, "0x", 0)
      ).to.be.revertedWithCustomError(verifier, "NoLargeOpReturn");
    });

    it("should reveal preimage for tx with 101-byte OP_RETURN", async function () {
      const { verifier, hashlockHash } = await deployFixture();
      const wtxId = await computeWtxId(TX_101_BYTES);

      await expect(
        verifier.verifyAndReveal(100, TX_101_BYTES, wtxId, "0x", 0)
      )
        .to.emit(verifier, "PreimageRevealed")
        .withArgs(hashlockHash, PREIMAGE_HEX, wtxId, 100);

      expect(await verifier.revealed()).to.be.true;
      expect(await verifier.provenWtxId()).to.equal(wtxId);
    });

    it("should not re-emit on double submission", async function () {
      const { verifier } = await deployFixture();
      const wtxId = await computeWtxId(TX_101_BYTES);

      // First call — emits event
      await verifier.verifyAndReveal(100, TX_101_BYTES, wtxId, "0x", 0);
      expect(await verifier.revealed()).to.be.true;

      // Second call — succeeds but does NOT emit PreimageRevealed
      await expect(
        verifier.verifyAndReveal(100, TX_101_BYTES, wtxId, "0x", 0)
      ).to.not.emit(verifier, "PreimageRevealed");
    });
  });
});
