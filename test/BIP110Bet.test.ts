import { expect } from "chai";
import hre from "hardhat";

describe("BIP110Bet", function () {
  const LIGHT_CLIENT_ADDR = "0x3100000000000000000000000000000000000001";
  const DEADLINE = 200000; // Bitcoin block height deadline

  // Build a hand-crafted tx with 101-byte OP_RETURN
  function buildLargeOpReturnTx(): string {
    const version = "01000000";
    const inputCount = "01";
    const prevTxid = "aa".repeat(32);
    const prevVout = "01000000";
    const scriptSigLen = "00";
    const sequence = "ffffffff";
    const outputCount = "01";
    const value = "0000000000000000";
    const data = "42".repeat(101);
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

  // Real testnet3 tx with exactly 100-byte OP_RETURN (should NOT trigger proof)
  const TX_100_BYTES =
    "0x02000000000101c3fec6ac0f0824dbf563dd29bc36a9afbaf09bd0ac78b11ee24d15c752224f950000000000fdffffff020000000000000000676a4c6475506c25314bbfcc1b9aa7c05b12dd9b72f9e052064986be85ab9bdded4bdfa6b0c4730f96924f6a8a8bab2fe097fe6270112417318f9a6ae5f7b65f67d6ceded2e3d75e7e27ed2dc37304799f1fa1582036b15b329b55824e1e745e95641a2f090d6c3c20030000000000001600147b5be3b33fc7a3dc1e62ddbf167ff2b5049b0e610247304402207f53ef56e8d4feb234073f9d7f347b9c992e640ab3ea51dc1a87f471ab995fce022036ece97a75768ff58446e1d3f551bdd7bb5e2fea36fd93c072250aea989e32e001210362ae86b42b370f3204bcbcd3dc6a8f8339930ca8d926989c20706464a25d636c00000000";

  async function computeWtxId(rawTx: string): Promise<string> {
    const txBytes = hre.ethers.getBytes(rawTx);
    const hash1 = hre.ethers.sha256(txBytes);
    const hash2 = hre.ethers.sha256(hre.ethers.getBytes(hash1));
    return hash2;
  }

  async function deployFixture() {
    const [owner, alice, bob, carol] = await hre.ethers.getSigners();

    // Deploy mock Light Client and set at precompile address
    const MockLC = await hre.ethers.getContractFactory("MockBitcoinLightClient");
    const mockDeployed = await MockLC.deploy();
    const mockCode = await hre.ethers.provider.getCode(await mockDeployed.getAddress());

    await hre.network.provider.send("hardhat_setCode", [
      LIGHT_CLIENT_ADDR,
      mockCode,
    ]);

    // Get a handle to the mock at the precompile address so we can call setBlockNumber
    const mockLC = MockLC.attach(LIGHT_CLIENT_ADDR);

    // Set block number to before the deadline
    await mockLC.setBlockNumber(DEADLINE - 100);

    // Deploy OpReturnParser
    const Parser = await hre.ethers.getContractFactory("OpReturnParser");
    const parser = await Parser.deploy();

    // Deploy BIP110Bet
    const Bet = await hre.ethers.getContractFactory("BIP110Bet");
    const bet = await Bet.deploy(LIGHT_CLIENT_ADDR, await parser.getAddress(), DEADLINE);

    return { bet, parser, mockLC, owner, alice, bob, carol };
  }

  describe("deposits", function () {
    it("should accept passes deposits", async function () {
      const { bet, alice } = await deployFixture();
      const amount = hre.ethers.parseEther("1.0");

      await expect(bet.connect(alice).deposit(0, { value: amount })) // Side.Passes = 0
        .to.emit(bet, "Deposited")
        .withArgs(alice.address, 0, amount);

      expect(await bet.passesPool()).to.equal(amount);
      expect(await bet.passesDeposits(alice.address)).to.equal(amount);
    });

    it("should accept fails deposits", async function () {
      const { bet, bob } = await deployFixture();
      const amount = hre.ethers.parseEther("2.0");

      await expect(bet.connect(bob).deposit(1, { value: amount })) // Side.Fails = 1
        .to.emit(bet, "Deposited")
        .withArgs(bob.address, 1, amount);

      expect(await bet.failsPool()).to.equal(amount);
      expect(await bet.failsDeposits(bob.address)).to.equal(amount);
    });

    it("should accumulate multiple deposits from same address", async function () {
      const { bet, alice } = await deployFixture();
      const amount1 = hre.ethers.parseEther("1.0");
      const amount2 = hre.ethers.parseEther("0.5");

      await bet.connect(alice).deposit(0, { value: amount1 });
      await bet.connect(alice).deposit(0, { value: amount2 });

      expect(await bet.passesDeposits(alice.address)).to.equal(amount1 + amount2);
      expect(await bet.passesPool()).to.equal(amount1 + amount2);
    });

    it("should reject zero deposit", async function () {
      const { bet, alice } = await deployFixture();
      await expect(
        bet.connect(alice).deposit(0, { value: 0 })
      ).to.be.revertedWithCustomError(bet, "ZeroDeposit");
    });

    it("should reject deposit after deadline", async function () {
      const { bet, mockLC, alice } = await deployFixture();
      await mockLC.setBlockNumber(DEADLINE + 1);

      await expect(
        bet.connect(alice).deposit(0, { value: hre.ethers.parseEther("1.0") })
      ).to.be.revertedWithCustomError(bet, "DeadlinePassed");
    });

    it("should reject deposit after resolved", async function () {
      const { bet, mockLC, alice, bob } = await deployFixture();

      // Deposit first
      await bet.connect(alice).deposit(0, { value: hre.ethers.parseEther("1.0") });

      // Resolve via timeout
      await mockLC.setBlockNumber(DEADLINE + 1);
      await bet.claimTimeout();

      // Now try to deposit
      await expect(
        bet.connect(bob).deposit(1, { value: hre.ethers.parseEther("1.0") })
      ).to.be.revertedWithCustomError(bet, "AlreadyResolved");
    });
  });

  describe("prove (bip-110-fails wins)", function () {
    it("should resolve to FailsWins on valid proof", async function () {
      const { bet, alice, bob } = await deployFixture();
      const wtxId = await computeWtxId(TX_101_BYTES);

      // Deposits
      await bet.connect(alice).deposit(0, { value: hre.ethers.parseEther("1.0") });
      await bet.connect(bob).deposit(1, { value: hre.ethers.parseEther("1.0") });

      // Prove
      await expect(bet.prove(100, TX_101_BYTES, wtxId, "0x", 0))
        .to.emit(bet, "Resolved")
        .withArgs(1, wtxId); // Outcome.FailsWins = 1

      expect(await bet.resolved()).to.be.true;
      expect(await bet.outcome()).to.equal(1);
      expect(await bet.provenWtxId()).to.equal(wtxId);
    });

    it("should reject zero wtxId", async function () {
      const { bet } = await deployFixture();
      await expect(
        bet.prove(100, TX_101_BYTES, hre.ethers.ZeroHash, "0x", 0)
      ).to.be.revertedWithCustomError(bet, "ZeroWtxId");
    });

    it("should reject mismatched wtxId", async function () {
      const { bet } = await deployFixture();
      const fakeWtxId = "0x" + "ab".repeat(32);
      await expect(
        bet.prove(100, TX_101_BYTES, fakeWtxId, "0x", 0)
      ).to.be.revertedWithCustomError(bet, "TxIdMismatch");
    });

    it("should reject tx with 100-byte OP_RETURN (not > 100)", async function () {
      const { bet } = await deployFixture();
      const wtxId = await computeWtxId(TX_100_BYTES);
      await expect(
        bet.prove(100, TX_100_BYTES, wtxId, "0x", 0)
      ).to.be.revertedWithCustomError(bet, "NoLargeOpReturn");
    });

    it("should reject proof after deadline", async function () {
      const { bet, mockLC } = await deployFixture();
      const wtxId = await computeWtxId(TX_101_BYTES);

      await mockLC.setBlockNumber(DEADLINE + 1);

      await expect(
        bet.prove(100, TX_101_BYTES, wtxId, "0x", 0)
      ).to.be.revertedWithCustomError(bet, "DeadlinePassed");
    });

    it("should reject proof after already resolved", async function () {
      const { bet, mockLC } = await deployFixture();
      const wtxId = await computeWtxId(TX_101_BYTES);

      // Resolve via timeout
      await mockLC.setBlockNumber(DEADLINE + 1);
      await bet.claimTimeout();

      // Now try to prove (block number doesn't matter, already resolved)
      await expect(
        bet.prove(100, TX_101_BYTES, wtxId, "0x", 0)
      ).to.be.revertedWithCustomError(bet, "AlreadyResolved");
    });
  });

  describe("claimTimeout (bip-110-passes wins)", function () {
    it("should resolve to PassesWins after deadline", async function () {
      const { bet, mockLC, alice } = await deployFixture();

      await bet.connect(alice).deposit(0, { value: hre.ethers.parseEther("1.0") });

      await mockLC.setBlockNumber(DEADLINE + 1);

      await expect(bet.claimTimeout())
        .to.emit(bet, "Resolved")
        .withArgs(2, hre.ethers.ZeroHash); // Outcome.PassesWins = 2

      expect(await bet.resolved()).to.be.true;
      expect(await bet.outcome()).to.equal(2);
    });

    it("should reject claimTimeout before deadline", async function () {
      const { bet } = await deployFixture();
      await expect(
        bet.claimTimeout()
      ).to.be.revertedWithCustomError(bet, "DeadlineNotPassed");
    });

    it("should reject claimTimeout at exactly deadline", async function () {
      const { bet, mockLC } = await deployFixture();
      await mockLC.setBlockNumber(DEADLINE);
      await expect(
        bet.claimTimeout()
      ).to.be.revertedWithCustomError(bet, "DeadlineNotPassed");
    });

    it("should reject claimTimeout if already resolved", async function () {
      const { bet, mockLC } = await deployFixture();
      await mockLC.setBlockNumber(DEADLINE + 1);
      await bet.claimTimeout();
      await expect(
        bet.claimTimeout()
      ).to.be.revertedWithCustomError(bet, "AlreadyResolved");
    });
  });

  describe("withdraw", function () {
    it("should pay fails side proportionally when fails wins", async function () {
      const { bet, alice, bob, carol } = await deployFixture();

      // Passes deposits 3 ETH, Fails deposits: alice 1 ETH, bob 2 ETH
      await bet.connect(carol).deposit(0, { value: hre.ethers.parseEther("3.0") });
      await bet.connect(alice).deposit(1, { value: hre.ethers.parseEther("1.0") });
      await bet.connect(bob).deposit(1, { value: hre.ethers.parseEther("2.0") });

      // Fails wins via proof
      const wtxId = await computeWtxId(TX_101_BYTES);
      await bet.prove(100, TX_101_BYTES, wtxId, "0x", 0);

      // Total pool = 6 ETH, fails pool = 3 ETH
      // Alice gets 1/3 * 6 = 2 ETH, Bob gets 2/3 * 6 = 4 ETH
      const aliceBefore = await hre.ethers.provider.getBalance(alice.address);
      const tx1 = await bet.connect(alice).withdraw();
      const receipt1 = await tx1.wait();
      const aliceAfter = await hre.ethers.provider.getBalance(alice.address);
      const aliceGas = receipt1!.gasUsed * receipt1!.gasPrice;
      const alicePayout = aliceAfter - aliceBefore + aliceGas;

      expect(alicePayout).to.equal(hre.ethers.parseEther("2.0"));

      const bobBefore = await hre.ethers.provider.getBalance(bob.address);
      const tx2 = await bet.connect(bob).withdraw();
      const receipt2 = await tx2.wait();
      const bobAfter = await hre.ethers.provider.getBalance(bob.address);
      const bobGas = receipt2!.gasUsed * receipt2!.gasPrice;
      const bobPayout = bobAfter - bobBefore + bobGas;

      expect(bobPayout).to.equal(hre.ethers.parseEther("4.0"));
    });

    it("should pay passes side proportionally when passes wins", async function () {
      const { bet, mockLC, alice, bob, carol } = await deployFixture();

      // Passes deposits: alice 1 ETH, bob 3 ETH. Fails deposits: carol 2 ETH
      await bet.connect(alice).deposit(0, { value: hre.ethers.parseEther("1.0") });
      await bet.connect(bob).deposit(0, { value: hre.ethers.parseEther("3.0") });
      await bet.connect(carol).deposit(1, { value: hre.ethers.parseEther("2.0") });

      // Passes wins via timeout
      await mockLC.setBlockNumber(DEADLINE + 1);
      await bet.claimTimeout();

      // Total pool = 6 ETH, passes pool = 4 ETH
      // Alice gets 1/4 * 6 = 1.5 ETH, Bob gets 3/4 * 6 = 4.5 ETH
      const aliceBefore = await hre.ethers.provider.getBalance(alice.address);
      const tx1 = await bet.connect(alice).withdraw();
      const receipt1 = await tx1.wait();
      const aliceAfter = await hre.ethers.provider.getBalance(alice.address);
      const aliceGas = receipt1!.gasUsed * receipt1!.gasPrice;
      const alicePayout = aliceAfter - aliceBefore + aliceGas;

      expect(alicePayout).to.equal(hre.ethers.parseEther("1.5"));

      const bobBefore = await hre.ethers.provider.getBalance(bob.address);
      const tx2 = await bet.connect(bob).withdraw();
      const receipt2 = await tx2.wait();
      const bobAfter = await hre.ethers.provider.getBalance(bob.address);
      const bobGas = receipt2!.gasUsed * receipt2!.gasPrice;
      const bobPayout = bobAfter - bobBefore + bobGas;

      expect(bobPayout).to.equal(hre.ethers.parseEther("4.5"));
    });

    it("should emit Withdrawn event", async function () {
      const { bet, alice, bob } = await deployFixture();

      await bet.connect(alice).deposit(1, { value: hre.ethers.parseEther("1.0") });
      await bet.connect(bob).deposit(0, { value: hre.ethers.parseEther("1.0") });

      const wtxId = await computeWtxId(TX_101_BYTES);
      await bet.prove(100, TX_101_BYTES, wtxId, "0x", 0);

      await expect(bet.connect(alice).withdraw())
        .to.emit(bet, "Withdrawn")
        .withArgs(alice.address, hre.ethers.parseEther("2.0"));
    });

    it("should reject withdraw before resolved", async function () {
      const { bet, alice } = await deployFixture();
      await bet.connect(alice).deposit(0, { value: hre.ethers.parseEther("1.0") });

      await expect(
        bet.connect(alice).withdraw()
      ).to.be.revertedWithCustomError(bet, "NotResolved");
    });

    it("should reject withdraw for losers", async function () {
      const { bet, alice, bob } = await deployFixture();

      await bet.connect(alice).deposit(0, { value: hre.ethers.parseEther("1.0") }); // Passes
      await bet.connect(bob).deposit(1, { value: hre.ethers.parseEther("1.0") }); // Fails

      // Fails wins
      const wtxId = await computeWtxId(TX_101_BYTES);
      await bet.prove(100, TX_101_BYTES, wtxId, "0x", 0);

      // Passes side (alice) tries to withdraw
      await expect(
        bet.connect(alice).withdraw()
      ).to.be.revertedWithCustomError(bet, "NotWinner");
    });

    it("should reject double withdraw", async function () {
      const { bet, alice, bob } = await deployFixture();

      await bet.connect(alice).deposit(1, { value: hre.ethers.parseEther("1.0") });
      await bet.connect(bob).deposit(0, { value: hre.ethers.parseEther("1.0") });

      const wtxId = await computeWtxId(TX_101_BYTES);
      await bet.prove(100, TX_101_BYTES, wtxId, "0x", 0);

      await bet.connect(alice).withdraw();

      await expect(
        bet.connect(alice).withdraw()
      ).to.be.revertedWithCustomError(bet, "AlreadyClaimed");
    });
  });
});
