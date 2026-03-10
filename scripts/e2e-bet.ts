import hre from "hardhat";

/**
 * End-to-end test of BIP110Bet on Citrea testnet:
 * 1. Deploy BIP110Bet with deadline far in the future
 * 2. Deposit on both Passes and Fails sides
 * 3. Submit real 101-byte OP_RETURN proof from Bitcoin testnet4 block 123,716
 * 4. Withdraw winnings (fails side wins)
 */
async function main() {
  const [signer] = await hre.ethers.getSigners();
  const addr = await signer.getAddress();
  console.log("Signer:", addr);

  const balance = await hre.ethers.provider.getBalance(addr);
  console.log("Balance:", hre.ethers.formatEther(balance), "cBTC");

  // Check Light Client height
  const LIGHT_CLIENT_ADDR = "0x3100000000000000000000000000000000000001";
  const PARSER_ADDR = "0x5BB078C8aC361be88A27195307138A678562D281";

  const lc = await hre.ethers.getContractAt("IBitcoinLightClient", LIGHT_CLIENT_ADDR);
  const lcHeight = await lc.blockNumber();
  console.log("Light Client height:", lcHeight.toString());

  // Real proof data from Phase 2 (Bitcoin testnet4 block 123,716)
  const BLOCK_HEIGHT = 123716;
  const RAW_TX = "0x020000000001012e91af0e05799ed222f3f39226c98ca171bfb2ef8f02d6be788288c9cf04d1070100000000fdffffff020000000000000000686a4c6542495031313020506861736520323a2054727573746c657373204f505f52455455524e20766572696669636174696f6e2076696120436974726561204c6967687420436c69656e742070726f7665732074686973207478206973206d696e65642100000000909f0700000000001600145c7ff709dd2583e259c11d8d7a54a70055935c5202483045022100c084eb5aa7696211f68d82df8fd5dea79280fc1d3714564fe6d7a51d6a3de03302204ffa7615f4a3e00e0dda41aa6f2dd36dd4b0d3ecf48d9d3ae2805c760870b70f0121024d1cfad21abc0f7598885d016c898a3e4754c5dd13d909ecac63200205c682ad00000000";
  const WTXID = "0xafabd687c327b4df84c5c57c0c06c88b2b1be0142ef02e80e2366313e6a61f2f";
  const PROOF = "0x3a7ac838ba2d081003f47e078cec07c2d10e2a8d9d8bef862245152a21488cdaa3a204c6a9ceb11917c9f94d32c09d1e263b9b68b7286b510e6fbdcb9ca846f26730e988ac5f5f7e33a04773ab7093dfbc2ea84d5bf230ef76be00cfe1b840d7bbc987853004e2223bf6b0ccfd5d588feb4d1bb382e1e4f44d86e7c84397318b802ef7e277e71cd1d70ddcd5378ec73897c6be2fd413fbf2c76dafa703e87703793ef6f69602006c637e73efbd3263c71d088cac532e8551327db405254c563b1cae0b7c073c0f93e55e0a5ac6ac2679423c9de2273f20d0c4a924eb8222e10f";
  const INDEX = 31;

  // Deadline: far in the future so deposits and proof work
  const DEADLINE = Number(lcHeight) + 1000;
  console.log("Deadline:", DEADLINE);

  // Deposit amounts (tiny — we only have ~0.002 cBTC)
  const PRO_DEPOSIT = hre.ethers.parseEther("0.0001");
  const ANTI_DEPOSIT = hre.ethers.parseEther("0.0002");

  // --- Step 1: Deploy ---
  console.log("\n=== Step 1: Deploy BIP110Bet ===");
  const Bet = await hre.ethers.getContractFactory("BIP110Bet");
  const bet = await Bet.deploy(LIGHT_CLIENT_ADDR, PARSER_ADDR, DEADLINE);
  await bet.waitForDeployment();
  const betAddr = await bet.getAddress();
  console.log("BIP110Bet deployed at:", betAddr);

  // --- Step 2: Deposit on both sides ---
  console.log("\n=== Step 2: Deposit ===");

  console.log("Depositing", hre.ethers.formatEther(PRO_DEPOSIT), "cBTC on Passes side...");
  const tx1 = await bet.deposit(0, { value: PRO_DEPOSIT }); // Side.Passes = 0
  await tx1.wait();
  console.log("Passes deposit tx:", tx1.hash);

  console.log("Depositing", hre.ethers.formatEther(ANTI_DEPOSIT), "cBTC on Fails side...");
  const tx2 = await bet.deposit(1, { value: ANTI_DEPOSIT }); // Side.Fails = 1
  await tx2.wait();
  console.log("Fails deposit tx:", tx2.hash);

  console.log("Passes pool:", hre.ethers.formatEther(await bet.passesPool()), "cBTC");
  console.log("Fails pool:", hre.ethers.formatEther(await bet.failsPool()), "cBTC");

  // --- Step 3: Submit proof (fails wins) ---
  console.log("\n=== Step 3: Prove (101-byte OP_RETURN from block 123,716) ===");
  const tx3 = await bet.prove(BLOCK_HEIGHT, RAW_TX, WTXID, PROOF, INDEX);
  const receipt3 = await tx3.wait();
  console.log("Prove tx:", tx3.hash);
  console.log("Gas used:", receipt3!.gasUsed.toString());

  const outcome = await bet.outcome();
  console.log("Outcome:", outcome === 1n ? "FailsWins" : outcome === 2n ? "PassesWins" : "Unresolved");
  console.log("Resolved:", await bet.resolved());
  console.log("Proven wtxId:", await bet.provenWtxId());

  // --- Step 4: Withdraw (fails side wins, we deposited on fails) ---
  console.log("\n=== Step 4: Withdraw ===");
  const balBefore = await hre.ethers.provider.getBalance(addr);

  const tx4 = await bet.withdraw();
  const receipt4 = await tx4.wait();
  console.log("Withdraw tx:", tx4.hash);

  const balAfter = await hre.ethers.provider.getBalance(addr);
  const gasCost = receipt4!.gasUsed * receipt4!.gasPrice;
  const netGain = balAfter - balBefore + gasCost;
  console.log("Payout received:", hre.ethers.formatEther(netGain), "cBTC");
  console.log("Expected payout:", hre.ethers.formatEther(PRO_DEPOSIT + ANTI_DEPOSIT), "cBTC (total pool, since only anti depositor)");

  const finalBalance = await hre.ethers.provider.getBalance(addr);
  console.log("\nFinal balance:", hre.ethers.formatEther(finalBalance), "cBTC");

  console.log("\n=== E2E Complete ===");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
