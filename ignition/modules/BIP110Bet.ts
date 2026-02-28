import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const LIGHT_CLIENT_ADDR = "0x3100000000000000000000000000000000000001";
const PARSER_ADDR = "0x5BB078C8aC361be88A27195307138A678562D281";

const BIP110BetModule = buildModule("BIP110BetModule", (m) => {
  const deadlineBlockHeight = m.getParameter("deadlineBlockHeight");

  const bet = m.contract("BIP110Bet", [
    LIGHT_CLIENT_ADDR,
    PARSER_ADDR,
    deadlineBlockHeight,
  ]);

  return { bet };
});

export default BIP110BetModule;
