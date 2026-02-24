import { expect } from "chai";
import hre from "hardhat";

describe("OpReturnParser", function () {
  async function deployParser() {
    const Parser = await hre.ethers.getContractFactory("OpReturnParser");
    const parser = await Parser.deploy();
    return { parser };
  }

  // Real testnet3 OP_RETURN transaction 1: c054a2bf...
  // 1 OP_RETURN output at index 0 with 100 bytes of data, SegWit
  const TX1 =
    "0x02000000000101c3fec6ac0f0824dbf563dd29bc36a9afbaf09bd0ac78b11ee24d15c752224f950000000000fdffffff020000000000000000676a4c6475506c25314bbfcc1b9aa7c05b12dd9b72f9e052064986be85ab9bdded4bdfa6b0c4730f96924f6a8a8bab2fe097fe6270112417318f9a6ae5f7b65f67d6ceded2e3d75e7e27ed2dc37304799f1fa1582036b15b329b55824e1e745e95641a2f090d6c3c20030000000000001600147b5be3b33fc7a3dc1e62ddbf167ff2b5049b0e610247304402207f53ef56e8d4feb234073f9d7f347b9c992e640ab3ea51dc1a87f471ab995fce022036ece97a75768ff58446e1d3f551bdd7bb5e2fea36fd93c072250aea989e32e001210362ae86b42b370f3204bcbcd3dc6a8f8339930ca8d926989c20706464a25d636c00000000";

  // Real testnet3 OP_RETURN transaction 2: 5e9df794...
  // 1 OP_RETURN output at index 0 with 100 bytes of data, SegWit
  const TX2 =
    "0x02000000000101e4cb0d2b9914840c1cf9d90286b0ec78b37f5119f4219281f6f6c72d2ba662a60000000000fdffffff020000000000000000676a4c64d26cb34a589e7914fa06be327fd13c1e8c765f9d1c6cfcc30deda0f86f0ca1f96b29f63f125552431bc2538bbdc06e9b21eaa1cd132359e9271319d10bc5953377737872ebbd488c5fa53a51dc4308440d0790b65cff823f8b486f800242955c332a289e8ae10200000000001600145853950bb0b9d1db41e7e78cc1951ea63f2af6500247304402202fb695a6ef1f4b2e27ac6da19c1e523e43147b6b44a0ed8d73352e005d21926b02202a965b5d0ca4c92103ccccc425a2d105926bc13951728a2c18fe42e51463a4190121030de44c740fdcb2ee944cbf5ad240820edc85ebe2791fe4fb1016f3e78128050500000000";

  // Hand-crafted minimal non-segwit tx with OP_RETURN "Hello Citrea!"
  // version(4) + inputcount(1) + txid(32) + vout(4) + scriptSigLen(1=0) + sequence(4)
  // + outputcount(1) + value(8) + scriptLen(1) + script(OP_RETURN + push + "Hello Citrea!")
  //
  // "Hello Citrea!" = 13 bytes = 0x48656c6c6f20436974726561210d
  // Wait: "Hello Citrea!" in hex:
  // H=48 e=65 l=6c l=6c o=6f ' '=20 C=43 i=69 t=74 r=72 e=65 a=61 !=21
  // = 13 bytes
  // Script: 6a 0d 48656c6c6f2043697472656121  (15 bytes: OP_RETURN + push13 + 13 bytes)
  const HELLO_TX = buildHelloCitreaTx();

  function buildHelloCitreaTx(): string {
    // Non-segwit minimal tx
    const version = "01000000"; // version 1 LE
    const inputCount = "01";
    const prevTxid = "00".repeat(32); // dummy
    const prevVout = "00000000";
    const scriptSigLen = "00"; // empty scriptSig (not valid but parseable)
    const sequence = "ffffffff";
    const outputCount = "01";
    const value = "0000000000000000"; // 0 sats
    // Script: OP_RETURN (6a) + push 13 bytes (0d) + "Hello Citrea!"
    const helloHex = Buffer.from("Hello Citrea!").toString("hex");
    const script = "6a" + "0d" + helloHex;
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

  describe("hasOpReturn", function () {
    it("should detect OP_RETURN in TX1", async function () {
      const { parser } = await deployParser();
      const [found, totalBytes, count] = await parser.hasOpReturn(TX1);
      expect(found).to.be.true;
      expect(totalBytes).to.equal(100);
      expect(count).to.equal(1);
    });

    it("should detect OP_RETURN in TX2", async function () {
      const { parser } = await deployParser();
      const [found, totalBytes, count] = await parser.hasOpReturn(TX2);
      expect(found).to.be.true;
      expect(totalBytes).to.equal(100);
      expect(count).to.equal(1);
    });

    it("should detect OP_RETURN in Hello Citrea! tx", async function () {
      const { parser } = await deployParser();
      const [found, totalBytes, count] = await parser.hasOpReturn(HELLO_TX);
      expect(found).to.be.true;
      expect(totalBytes).to.equal(13);
      expect(count).to.equal(1);
    });
  });

  describe("parseOpReturns", function () {
    it("should parse TX1 correctly", async function () {
      const { parser } = await deployParser();
      const [results, version, isSegwit] = await parser.parseOpReturns(TX1);
      expect(version).to.equal(2);
      expect(isSegwit).to.be.true;
      expect(results.length).to.equal(1);
      expect(results[0].size).to.equal(100);
      expect(results[0].outputIndex).to.equal(0);
    });

    it("should parse TX2 correctly", async function () {
      const { parser } = await deployParser();
      const [results, version, isSegwit] = await parser.parseOpReturns(TX2);
      expect(version).to.equal(2);
      expect(isSegwit).to.be.true;
      expect(results.length).to.equal(1);
      expect(results[0].size).to.equal(100);
      expect(results[0].outputIndex).to.equal(0);
    });

    it("should return different data payloads for TX1 vs TX2", async function () {
      const { parser } = await deployParser();
      const [results1] = await parser.parseOpReturns(TX1);
      const [results2] = await parser.parseOpReturns(TX2);
      expect(results1[0].data).to.not.equal(results2[0].data);
    });
  });

  describe("firstOpReturnAsString", function () {
    it("should return 'Hello Citrea!' from the hand-crafted tx", async function () {
      const { parser } = await deployParser();
      const [data, size, found] = await parser.firstOpReturnAsString(HELLO_TX);
      expect(found).to.be.true;
      expect(size).to.equal(13);
      expect(data).to.equal("Hello Citrea!");
    });
  });
});
