import hre from "hardhat";

/**
 * E2E test: BIP-110-Fails wins via proof
 *
 * 1. Deploy BIP110Bet (deadline = lcHeight + 1000)
 * 2. Wallet A deposits on Passes side
 * 3. Wallet B deposits on Fails side
 * 4. Submit real 101-byte OP_RETURN proof from Bitcoin testnet4 block 125,274
 * 5. Wallet B (winner) withdraws — gets entire pool
 * 6. Wallet A (loser) tries to withdraw — reverts
 */
async function main() {
  const [walletA, walletB] = await hre.ethers.getSigners();
  console.log("Wallet A (Passes):", await walletA.getAddress());
  console.log("Wallet B (Fails):", await walletB.getAddress());

  const balA = await hre.ethers.provider.getBalance(walletA.address);
  const balB = await hre.ethers.provider.getBalance(walletB.address);
  console.log("Balance A:", hre.ethers.formatEther(balA), "cBTC");
  console.log("Balance B:", hre.ethers.formatEther(balB), "cBTC");

  // Light Client
  const LIGHT_CLIENT_ADDR = "0x3100000000000000000000000000000000000001";
  const PARSER_ADDR = "0x5BB078C8aC361be88A27195307138A678562D281";

  const lc = await hre.ethers.getContractAt("IBitcoinLightClient", LIGHT_CLIENT_ADDR);
  const lcHeight = await lc.blockNumber();
  console.log("\nLight Client height:", lcHeight.toString());

  // Proof data from Bitcoin testnet4 block 125,274 — "Hello Citrea!" 101-byte OP_RETURN
  const BLOCK_HEIGHT = 125274;
  const RAW_TX = "0x02000000000101a2352a674af62eda884c10b2950bacb7ffd2bbb17b2cfd5fb197c5d17f34196d0100000000fdffffff020000000000000000686a4c6548656c6c6f204369747265612100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000541906000000000016001456ff4a884fefd7d8c089f4079898e548407da6600247304402200a3375ab19c64f0c0107424287ee9029ccbcfbb1ff3c82df0eb0a2a09e7beba6022037608b3265931a997d24a5610d33eaa11c204de63c8766e8da8ee65375cb35420121030a49750922f41a247c6277cdbd256411f501dbb7df7ef06d0c1002319536543100000000";
  const WTXID = "0xc989bfc9cc2e12e4f3ecb5bf2c4c38eaac4511b27d2a147b23a4c52e440f49d9";
  const PROOF = "0x7dc770c19948228d550ea88c4cece6b55b291e5c4783e6763c75f49ccdd7796b0f066d09484054e197df73ef3bf8a150fca438e721272b00aed0f022549cce356d48cf1aa0095c088e347a8427e51c73cafecca8be48196c95e69d90e1ba82d6d5fd8a3b0327621aa9bfc71a713b53e38586733d403677f3143e434cedb9c43abcc02ab2dc0ef34b92ef48716c33bd655e66191450e6ccf916474f40574393b6a92821488541d638e7d0e6214fbfbe67a91553dffb47e3a5ee49fa34bfb4d119a6ce1d5cf214c6170ff4ccd6630fec277c5e59a9437af4ee76acc1d7a319a502cac0389f7204183c2e0a67ab2f4342de13343f107b9e08c4f5be21aeb629536d";
  const INDEX = 76;

  const DEADLINE = Number(lcHeight) + 1000;
  const DEPOSIT = hre.ethers.parseEther("0.0001");

  // --- Step 1: Deploy ---
  console.log("\n=== Step 1: Deploy BIP110Bet ===");
  const Bet = await hre.ethers.getContractFactory("BIP110Bet");
  const bet = await Bet.deploy(LIGHT_CLIENT_ADDR, PARSER_ADDR, DEADLINE);
  await bet.waitForDeployment();
  console.log("BIP110Bet deployed at:", await bet.getAddress());
  console.log("Deadline:", DEADLINE);

  // --- Step 2: Wallet A deposits Passes ---
  console.log("\n=== Step 2: Wallet A deposits Passes ===");
  const tx1 = await bet.connect(walletA).deposit(0, { value: DEPOSIT });
  await tx1.wait();
  console.log("Tx:", tx1.hash);

  // --- Step 3: Wallet B deposits Fails ---
  console.log("\n=== Step 3: Wallet B deposits Fails ===");
  const tx2 = await bet.connect(walletB).deposit(1, { value: DEPOSIT });
  await tx2.wait();
  console.log("Tx:", tx2.hash);

  console.log("Passes pool:", hre.ethers.formatEther(await bet.passesPool()), "cBTC");
  console.log("Fails pool:", hre.ethers.formatEther(await bet.failsPool()), "cBTC");

  // --- Step 4: Prove (bip-110-fails wins) ---
  console.log("\n=== Step 4: Prove (101-byte OP_RETURN) ===");
  const tx3 = await bet.prove(BLOCK_HEIGHT, RAW_TX, WTXID, PROOF, INDEX);
  const receipt3 = await tx3.wait();
  console.log("Tx:", tx3.hash);
  console.log("Gas used:", receipt3!.gasUsed.toString());
  console.log("Outcome:", (await bet.outcome()) === 1n ? "FailsWins" : "???");

  // --- Step 5: Wallet B withdraws (winner) ---
  console.log("\n=== Step 5: Wallet B withdraws (winner) ===");
  const bBefore = await hre.ethers.provider.getBalance(walletB.address);
  const tx4 = await bet.connect(walletB).withdraw();
  const receipt4 = await tx4.wait();
  const bAfter = await hre.ethers.provider.getBalance(walletB.address);
  const gas4 = receipt4!.gasUsed * receipt4!.gasPrice;
  const payout = bAfter - bBefore + gas4;
  console.log("Tx:", tx4.hash);
  console.log("Payout:", hre.ethers.formatEther(payout), "cBTC");
  console.log("Expected:", hre.ethers.formatEther(DEPOSIT * 2n), "cBTC (entire pool)");

  // --- Step 6: Wallet A tries to withdraw (loser) ---
  console.log("\n=== Step 6: Wallet A tries to withdraw (should fail) ===");
  try {
    await bet.connect(walletA).withdraw();
    console.log("ERROR: Should have reverted!");
  } catch (e: any) {
    console.log("Correctly reverted:", e.message.includes("NotWinner") ? "NotWinner" : e.message);
  }

  // --- Final balances ---
  console.log("\n=== Final Balances ===");
  console.log("Wallet A:", hre.ethers.formatEther(await hre.ethers.provider.getBalance(walletA.address)), "cBTC");
  console.log("Wallet B:", hre.ethers.formatEther(await hre.ethers.provider.getBalance(walletB.address)), "cBTC");

  console.log("\n=== E2E BIP-110-Fails-Wins Complete ===");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
