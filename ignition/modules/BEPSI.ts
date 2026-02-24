import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const BEPSIModule = buildModule("BEPSIModule", (m) => {
  const bepsi = m.contract("BEPSI");
  return { bepsi };
});

export default BEPSIModule;
