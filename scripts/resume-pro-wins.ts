import hre from "hardhat";

/**
 * Resume script for e2e-pro-wins.ts
 *
 * Use this when the main e2e-pro-wins.ts script crashes mid-run
 * (e.g. RPC timeout, computer sleep, network drop). The contract
 * is already deployed and funded — this picks up from where it
 * left off: waits for the light client, calls claimTimeout, and
 * runs the withdraw/revert checks.
 *
 * Usage:
 *   BET_ADDR=0x... npx hardhat run scripts/resume-pro-wins.ts --network citrea
 */
async function main() {
  const BET_ADDR = process.env.BET_ADDR;
  if (!BET_ADDR) {
    console.error("Missing BET_ADDR environment variable.");
    console.error("Usage: BET_ADDR=0x... npx hardhat run scripts/resume-pro-wins.ts --network citrea");
    process.exit(1);
  }

  const [walletA, walletB] = await hre.ethers.getSigners();
  const bet = await hre.ethers.getContractAt("BIP110Bet", BET_ADDR);

  const lc = await hre.ethers.getContractAt("IBitcoinLightClient", "0x3100000000000000000000000000000000000001");
  const lcHeight = Number(await lc.blockNumber());
  const deadline = Number(await bet.deadline());
  const resolved = await bet.resolved();

  console.log("Contract:", BET_ADDR);
  console.log("Light Client:", lcHeight);
  console.log("Deadline:", deadline);
  console.log("Resolved:", resolved);

  // Wait for light client if it hasn't passed the deadline yet
  if (!resolved && lcHeight <= deadline) {
    console.log("\n=== Waiting for Light Client to pass deadline ===");
    let current = lcHeight;
    while (current <= deadline) {
      await new Promise((r) => setTimeout(r, 15000));
      try {
        current = Number(await lc.blockNumber());
        console.log(`  Light Client: ${current} / ${deadline + 1} needed`);
      } catch {
        console.log("  RPC error, retrying...");
      }
    }
    console.log("Light Client passed deadline!");
  }

  // claimTimeout (skip if already resolved)
  if (!resolved) {
    console.log("\n=== claimTimeout ===");
    const tx3 = await bet.claimTimeout();
    const receipt3 = await tx3.wait();
    console.log("Tx:", tx3.hash);
    console.log("Gas used:", receipt3!.gasUsed.toString());
  }
  console.log("Outcome:", (await bet.outcome()) === 2n ? "ProWins" : "???");

  // Wallet A withdraws (winner) — skip if already claimed
  if (await bet.claimed(walletA.address)) {
    console.log("\n=== Wallet A already withdrew (skipping) ===");
  } else {
    console.log("\n=== Wallet A withdraws (winner) ===");
    const aBefore = await hre.ethers.provider.getBalance(walletA.address);
    const tx4 = await bet.connect(walletA).withdraw();
    const receipt4 = await tx4.wait();
    const aAfter = await hre.ethers.provider.getBalance(walletA.address);
    const gas4 = receipt4!.gasUsed * receipt4!.gasPrice;
    const payout = aAfter - aBefore + gas4;
    console.log("Tx:", tx4.hash);
    console.log("Payout:", hre.ethers.formatEther(payout), "cBTC");
  }

  // Wallet B tries to withdraw (loser)
  console.log("\n=== Wallet B tries to withdraw (should fail) ===");
  try {
    await bet.connect(walletB).withdraw();
    console.log("ERROR: Should have reverted!");
  } catch (e: any) {
    console.log("Correctly reverted:", e.message.includes("NotWinner") ? "NotWinner" : e.message);
  }

  console.log("\n=== Final Balances ===");
  console.log("Wallet A:", hre.ethers.formatEther(await hre.ethers.provider.getBalance(walletA.address)), "cBTC");
  console.log("Wallet B:", hre.ethers.formatEther(await hre.ethers.provider.getBalance(walletB.address)), "cBTC");
  console.log("\n=== E2E Pro-Wins Complete ===");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
