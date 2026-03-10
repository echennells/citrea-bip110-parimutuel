import hre from "hardhat";

/**
 * E2E test: BIP-110-Passes wins via timeout
 *
 * 1. Deploy BIP110Bet (deadline = lcHeight + 25, already mined on Bitcoin)
 * 2. Wallet A deposits on Passes side
 * 3. Wallet B deposits on Fails side
 * 4. Poll light client until it passes the deadline
 * 5. Call claimTimeout — BIP-110-Passes wins
 * 6. Wallet A (winner) withdraws — gets entire pool
 * 7. Wallet B (loser) tries to withdraw — reverts
 *
 * If this script crashes mid-run (RPC timeout, network drop, computer sleep),
 * use resume-passes-wins.ts to pick up where it left off:
 *   BET_ADDR=0x... npx hardhat run scripts/resume-passes-wins.ts --network citrea
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
  const lcHeight = Number(await lc.blockNumber());
  console.log("\nLight Client height:", lcHeight);

  // Deadline: 25 blocks ahead of light client.
  // Since the light client lags ~100 blocks behind Bitcoin tip,
  // these blocks are already mined — the LC just needs to catch up.
  const DEADLINE = lcHeight + 25;
  const DEPOSIT = hre.ethers.parseEther("0.0001");

  console.log("Deadline:", DEADLINE, `(LC needs to pass this — ~25 blocks of catchup)`);

  // --- Step 1: Deploy ---
  console.log("\n=== Step 1: Deploy BIP110Bet ===");
  const Bet = await hre.ethers.getContractFactory("BIP110Bet");
  const bet = await Bet.deploy(LIGHT_CLIENT_ADDR, PARSER_ADDR, DEADLINE);
  await bet.waitForDeployment();
  const betAddr = await bet.getAddress();
  console.log("BIP110Bet deployed at:", betAddr);
  console.log("(save this address — if the script crashes, resume with:)");
  console.log(`  BET_ADDR=${betAddr} npx hardhat run scripts/resume-passes-wins.ts --network citrea`);

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

  // --- Step 4: Wait for light client to pass deadline ---
  console.log("\n=== Step 4: Waiting for Light Client to pass deadline ===");
  let currentHeight = lcHeight;
  while (currentHeight <= DEADLINE) {
    await new Promise((r) => setTimeout(r, 15000)); // poll every 15s
    try {
      currentHeight = Number(await lc.blockNumber());
      console.log(`  Light Client: ${currentHeight} / ${DEADLINE + 1} needed`);
    } catch {
      console.log("  RPC error, retrying...");
    }
  }
  console.log("Light Client passed deadline!");

  // --- Step 5: Claim timeout (bip-110-passes wins) ---
  console.log("\n=== Step 5: claimTimeout ===");
  const tx3 = await bet.claimTimeout();
  const receipt3 = await tx3.wait();
  console.log("Tx:", tx3.hash);
  console.log("Gas used:", receipt3!.gasUsed.toString());
  console.log("Outcome:", (await bet.outcome()) === 2n ? "PassesWins" : "???");

  // --- Step 6: Wallet A withdraws (winner) ---
  console.log("\n=== Step 6: Wallet A withdraws (winner) ===");
  const aBefore = await hre.ethers.provider.getBalance(walletA.address);
  const tx4 = await bet.connect(walletA).withdraw();
  const receipt4 = await tx4.wait();
  const aAfter = await hre.ethers.provider.getBalance(walletA.address);
  const gas4 = receipt4!.gasUsed * receipt4!.gasPrice;
  const payout = aAfter - aBefore + gas4;
  console.log("Tx:", tx4.hash);
  console.log("Payout:", hre.ethers.formatEther(payout), "cBTC");
  console.log("Expected:", hre.ethers.formatEther(DEPOSIT * 2n), "cBTC (entire pool)");

  // --- Step 7: Wallet B tries to withdraw (loser) ---
  console.log("\n=== Step 7: Wallet B tries to withdraw (should fail) ===");
  try {
    await bet.connect(walletB).withdraw();
    console.log("ERROR: Should have reverted!");
  } catch (e: any) {
    console.log("Correctly reverted:", e.message.includes("NotWinner") ? "NotWinner" : e.message);
  }

  // --- Final balances ---
  console.log("\n=== Final Balances ===");
  console.log("Wallet A:", hre.ethers.formatEther(await hre.ethers.provider.getBalance(walletA.address)), "cBTC");
  console.log("Wallet B:", hre.ethers.formatEther(await hre.ethers.provider.getBalance(walletB.address)), "cBTC");

  console.log("\n=== E2E BIP-110-Passes-Wins Complete ===");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
